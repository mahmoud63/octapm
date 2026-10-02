'use strict';

/**
 * Independent check of billing finding D2.
 *
 *   node scripts/cert/billing/checks/check-d2.js
 *
 * The claim: a correctly signed provider event that carries NO company
 * identifier (an invoice event without `customer`, a subscription deletion
 * without `id`, or either of them as null) is applied by the webhook to a
 * company the event never named.
 *
 * How this check decides who was touched
 *   - invoice events: every event carries an invoice id made up for that one
 *     delivery. Whichever company holds an invoice with that id afterwards
 *     was touched by that event and by nothing else.
 *   - deletion events: the company the handler's own lookup returns for the
 *     identifier the event carries (asked just before the delivery), if its
 *     row turned `expired` during the delivery.
 *
 * The companies this run creates (code 929) are witnesses and controls. A
 * company the defect reaches is, by its nature, one this run did not create;
 * each is put back exactly as it was (the invoice removed, the status, period
 * end and update time restored) and the run says whether that succeeded.
 *
 * Exit code 2 while the defect exists, 0 when no stray event touches anyone.
 */

const crypto = require('crypto');
const { check, db, finding, finish, onboard, webhook } = require('../lib');

const DAY = 86_400;
const stamp = () => crypto.randomBytes(5).toString('hex');
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every workspace this run created (company and personal). */
const mine = new Set();

/** lib.js keeps its first connection attempt, failed or not: make sure the database answers first. */
const databaseReady = async () => {
  // eslint-disable-next-line global-require
  const guard = require('../../lib/cert-env');
  for (let n = 1; ; n += 1) {
    try {
      await (await guard.connectCertPrisma()).$disconnect();
      break;
    } catch (error) {
      if (n === 4) throw error;
      await sleep(3000 * n);
    }
  }
  return db.prisma();
};

const must = (what, res, status = 200) => {
  if (res.status !== status) throw new Error(`setup: ${what} answered ${res.status} ${String(res.text).slice(0, 200)}`);
};

const signUp = async (label) => {
  for (let n = 1; ; n += 1) {
    try {
      const company = await onboard(label, 929);
      mine.add(company.orgId);
      if (company.personalOrgId) mine.add(company.personalOrgId);
      return company;
    } catch (error) {
      if (n === 4) throw error;
      console.log(`        (setup: sign-up failed, trying again: ${String(error.message).replace(/\s+/g, ' ').slice(0, 100)})`);
      await sleep(3000 * n);
    }
  }
};

/** The webhook door is rate limited per address and shared: a 429 is the limit, not an answer. */
const deliver = async (event) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await webhook.send(event);
    if (res.status !== 429 || attempt === 3) return res;
    console.log('        (webhook rate limit reached; waiting 30 s)');
    await sleep(30_000);
  }
};

const paidInvoice = (customer) => ({
  id: `in_d2check_${stamp()}`,
  object: 'invoice',
  customer,
  amount_paid: 49900,
  currency: 'usd',
  lines: { data: [{ description: 'Business (monthly)', period: { start: now(), end: now() + 30 * DAY } }] },
});
const failedInvoice = (customer) => ({ id: `in_d2check_${stamp()}`, object: 'invoice', customer, amount_due: 49900, currency: 'usd' });
const without = (object, field) => {
  const copy = { ...object };
  delete copy[field];
  return copy;
};

/** Can the company write? It tries to create a project: [201, null] or [status, error code]. */
const canWrite = async (company) => {
  const res = await company.pm.send('POST', '/projects', { name: `D2 access probe ${stamp()}` });
  return [res.status, res.status === 201 ? null : res.body?.error?.code ?? null];
};

const restored = [];

/**
 * Delivers one event and returns { status, touched, note } where touched
 * lists, by name, every company the event was applied to. Each is then put
 * back as it was.
 */
const applyAndAttribute = async (event) => {
  const prisma = await db.prisma();
  const object = event.data.object;
  const isInvoice = event.type.startsWith('invoice.');
  const where = isInvoice ? { stripeCustomerId: object.customer } : { stripeSubscriptionId: object.id };

  // The handler's own question, asked just before the handler asks it.
  const predicted = await prisma.subscription.findFirst({ where });
  const before = new Map((await prisma.subscription.findMany()).map((r) => [r.id, r]));
  const startedAt = Date.now() - 2000;
  const res = await deliver(event);
  const after = new Map((await prisma.subscription.findMany()).map((r) => [r.id, r]));

  const hit = new Map(); // subscription id -> the invoices this event left on it
  if (isInvoice) {
    const left = await prisma.invoice.findMany({ where: { stripeInvoiceId: object.id } });
    for (const invoice of left) hit.set(invoice.subscriptionId, [...(hit.get(invoice.subscriptionId) || []), invoice.id]);
  } else {
    const newlyExpired = [...after.values()].filter((r) => r.status === 'expired' && before.get(r.id) && before.get(r.id).status !== 'expired' && r.updatedAt.getTime() >= startedAt);
    const byLookup = newlyExpired.filter((r) => predicted && r.id === predicted.id);
    for (const r of byLookup.length ? byLookup : newlyExpired) hit.set(r.id, []);
  }

  const touched = [];
  const notes = [];
  for (const [subscriptionId, invoiceIds] of hit) {
    const was = before.get(subscriptionId);
    const became = after.get(subscriptionId);
    const org = await prisma.organisation.findUnique({ where: { id: became.orgId }, select: { name: true } });
    touched.push(org ? org.name : became.orgId);
    notes.push(`${org?.name}: ${was.plan}/${was.status} -> ${became.plan}/${became.status}`
      + `${invoiceIds.length ? `, ${invoiceIds.length} invoice(s) it never had` : ''}`
      + `; created by this run: ${mine.has(became.orgId) ? 'yes' : 'NO'}`
      + `; is the row the handler's lookup returns: ${predicted && predicted.id === subscriptionId ? 'yes' : 'no'}`);

    // Put it back, only if it is still exactly as the event left it.
    if (invoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    const back = await prisma.subscription.updateMany({
      where: { id: subscriptionId, status: became.status, updatedAt: became.updatedAt },
      data: { status: was.status, currentPeriodEnd: was.currentPeriodEnd, updatedAt: was.updatedAt },
    });
    restored.push({ company: org?.name, ok: back.count === 1 });
  }
  return { status: res.status, touched: touched.sort(), note: `delivery answered ${res.status}${notes.length ? `; ${notes.join(' | ')}` : ''}` };
};

const main = async () => {
  const prisma = await databaseReady();

  // ── witnesses ────────────────────────────────────────────────────────────
  const paying = await signUp('D2 check paying');
  must('trial/start', await paying.pm.send('POST', '/billing/trial/start', {}));
  must('trial/confirm', await paying.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_visa_${stamp()}` }));
  must('subscribe', await paying.pm.send('POST', '/billing/subscribe', { plan: 'business', billingCycle: 'monthly' }));
  let row = await db.subscription(paying.orgId);
  // If the Stripe fake was reset, its counter hands out ids the database already holds: give the witness ids of its own.
  if ((await prisma.subscription.count({ where: { stripeCustomerId: row.stripeCustomerId } })) > 1) {
    row = await db.set(paying.orgId, { stripeCustomerId: `cus_d2check_${stamp()}`, stripeSubscriptionId: `sub_d2check_${stamp()}` });
  }
  const fresh = await signUp('D2 check never started');

  console.log('\n-- controls: an event that names a company, and events that name an unknown one --');
  {
    const { touched, note } = await applyAndAttribute(webhook.event('invoice.payment_failed', failedInvoice(row.stripeCustomerId)));
    check('control: a failed-payment event naming the witness is applied to the witness and nobody else', [paying.name], touched, note);
  }
  {
    const { touched, note } = await applyAndAttribute(webhook.event('invoice.payment_failed', failedInvoice(`cus_nobody_${stamp()}`)));
    check('control: a failed-payment event naming a customer no company holds touches no company', [], touched, note);
  }
  {
    const { touched, note } = await applyAndAttribute(webhook.event('customer.subscription.deleted', { id: `sub_nobody_${stamp()}`, object: 'subscription' }));
    check('control: a deletion naming a subscription no company holds touches no company', [], touched, note);
  }

  console.log('\n-- D2: events that name no company at all --');
  const strays = [
    ['invoice.payment_failed with no customer field', webhook.event('invoice.payment_failed', without(failedInvoice('unused'), 'customer'))],
    ['invoice.paid with no customer field', webhook.event('invoice.paid', without(paidInvoice('unused'), 'customer'))],
    ['invoice.payment_failed with customer: null', webhook.event('invoice.payment_failed', failedInvoice(null))],
    ['invoice.paid with customer: null', webhook.event('invoice.paid', paidInvoice(null))],
    ['customer.subscription.deleted with no id', webhook.event('customer.subscription.deleted', { object: 'subscription' })],
    ['customer.subscription.deleted with id: null', webhook.event('customer.subscription.deleted', { id: null, object: 'subscription' })],
  ];
  for (const [name, event] of strays) {
    const { touched, note } = await applyAndAttribute(event);
    finding('D2', `${name} touches no company`, [], touched, note);
  }

  console.log('\n-- what the states those events leave behind mean for access (staged on this run\'s own witnesses) --');
  check('a company that never started a trial cannot write', [402, 'SUBSCRIPTION_REQUIRED'], await canWrite(fresh));
  await db.set(fresh.orgId, { status: 'past_due' });
  check('the same company in the state a stray failed-payment event leaves it (trial/past_due) can write', [201, null], await canWrite(fresh));
  await db.set(fresh.orgId, { status: 'incomplete' });
  await db.set(paying.orgId, { status: 'past_due' });
  check('a paying company in the state a stray failed-payment event leaves it (past_due) can still write', [201, null], await canWrite(paying));
  await db.set(paying.orgId, { status: 'expired' });
  check('a paying company in the state a stray deletion leaves it (expired) cannot write', [402, 'SUBSCRIPTION_REQUIRED'], await canWrite(paying));
  await db.set(paying.orgId, { status: 'active' });

  console.log('');
  check('every company a stray event reached was put back exactly as it was', true, restored.every((r) => r.ok), `${restored.length} restored: ${restored.map((r) => `${r.company}${r.ok ? '' : ' (NOT restored)'}`).join('; ')}`);
  await finish('check D2');
};

main().catch(async (error) => {
  console.error(error);
  await db.close().catch(() => {});
  process.exitCode = 1;
});
