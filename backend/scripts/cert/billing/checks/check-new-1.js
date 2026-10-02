'use strict';

/**
 * Independent check of finding NEW-1.
 *
 *   node scripts/cert/billing/checks/check-new-1.js
 *
 * The claim: a signed invoice.paid for a company that is in its free card
 * trial — it has a provider customer and a card, and NO provider subscription —
 * turns the row into trial/active, and "active" has no time limit, so the
 * seven-day trial never ends.
 *
 * Two companies are created here through the product's own sign-up (code 929):
 *   the target     receives the paid event;
 *   the neighbour  is in the same state and receives nothing (it shows the
 *                  change is the event's doing, and lands on one company).
 *
 * Exit code 2 while the defect exists, 0 when the product is right, 1 when
 * the check itself could not be set up.
 */

const crypto = require('crypto');
const { check, db, finding, finish, onboard, webhook } = require('../lib');

const DAY_MS = 86_400_000;
const stamp = () => crypto.randomBytes(5).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REFUSED = [402, 'SUBSCRIPTION_REQUIRED'];

/** Sign-up can run past its transaction under load; that is not a billing answer. */
const patiently = async (what, attempt, tries = 4) => {
  for (let n = 1; ; n += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (n === tries) throw error;
      console.log(`        (setup: ${what} failed — ${String(error.message).replace(/\s+/g, ' ').slice(0, 120)} — trying again)`);
      await sleep(3000 * n);
    }
  }
};

const must = (what, res, status = 200) => {
  if (res.status !== status) throw new Error(`setup: ${what} answered ${res.status} ${String(res.text).slice(0, 200)}`);
};

/** A new company in a running card trial, whose provider customer id no other row holds. */
const trialing = async (label) => {
  const company = await patiently(`the sign-up of "${label}"`, () => onboard(label, 929));
  must('trial/start', await company.pm.send('POST', '/billing/trial/start', {}));
  must('trial/confirm', await company.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_visa_${stamp()}` }));
  const prisma = await db.prisma();
  let row = await db.subscription(company.orgId);
  if ((await prisma.subscription.count({ where: { stripeCustomerId: row.stripeCustomerId } })) > 1) {
    // The Stripe fake was reset at some point and handed out an id the database already holds.
    console.log(`        (setup: ${label} was handed a customer id another row holds; staged a fresh one)`);
    await db.set(company.orgId, { stripeCustomerId: `cus_cert929_${stamp()}` });
    row = await db.subscription(company.orgId);
  }
  return { ...company, customer: row.stripeCustomerId };
};

/** [201, null] when a project is created, [status, error code] when refused. */
const canWrite = async (company) => {
  const res = await company.pm.send('POST', '/projects', { name: `NEW-1 access probe ${stamp()}` });
  return [res.status, res.status === 201 ? null : res.body?.error?.code ?? null];
};

/** Posts a signed event; a 429 is the shared delivery limit, not an answer. */
const deliver = async (event) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await webhook.send(event);
    if (res.status !== 429 || attempt === 3) return res;
    console.log('        (the webhook delivery limit was reached; waiting 25 s)');
    await sleep(25_000);
  }
};

const main = async () => {
  const target = await trialing('NEW-1 target');
  const neighbour = await trialing('NEW-1 neighbour');
  console.log(`target    ${target.name}\nneighbour ${neighbour.name}\n`);

  // ── the state the claim starts from ──────────────────────────────────────
  const started = await db.subscription(target.orgId);
  check('the target is in a running trial', ['trial', 'trialing'], [started.plan, started.status]);
  check('the target has a provider customer and no provider subscription', [true, null], [Boolean(started.stripeCustomerId), started.stripeSubscriptionId]);
  check('the trial ends in about seven days', 7, Math.round((started.trialEndsAt.getTime() - Date.now()) / DAY_MS));
  check('the two companies have different provider customers', true, target.customer !== neighbour.customer);

  // ── control: what the end of a trial means without any event ─────────────
  await db.set(target.orgId, { trialEndsAt: new Date(Date.now() - DAY_MS) });
  check('control: with its trial days over, the target cannot write', REFUSED, await canWrite(target));
  await db.set(target.orgId, { trialEndsAt: started.trialEndsAt });
  const restored = await db.subscription(target.orgId);
  check('control: the target is put back to its running trial', ['trial', 'trialing', started.trialEndsAt.toISOString()], [restored.plan, restored.status, restored.trialEndsAt.toISOString()]);

  // ── the event: a paid one-off invoice on the target's provider customer ──
  // The shape the provider sends for an invoice raised by hand: no subscription.
  const at = Math.floor(Date.now() / 1000);
  const invoiceId = `in_cert929_${stamp()}`;
  const event = webhook.event('invoice.paid', {
    id: invoiceId,
    object: 'invoice',
    customer: target.customer,
    subscription: null,
    billing_reason: 'manual',
    amount_paid: 15000,
    currency: 'usd',
    lines: { data: [{ description: 'Onboarding workshop', period: { start: at, end: at } }] },
  });
  const delivered = await deliver(event);
  check('the signed paid event is accepted', 200, delivered.status, delivered.text.slice(0, 120));

  const prisma = await db.prisma();
  const landed = await prisma.invoice.findMany({ where: { stripeInvoiceId: invoiceId }, select: { subscriptionId: true } });
  check('the event reached the target and nobody else (one invoice row, on the target)', [1, started.id], [landed.length, landed[0]?.subscriptionId ?? null]);

  const after = await db.subscription(target.orgId);
  finding('NEW-1', 'a paid event for a company in its free trial, which has no provider subscription, leaves it a trial', ['trial', 'trialing'], [after.plan, after.status],
    `provider subscription on the row: ${after.stripeSubscriptionId}; trialEndsAt ${after.trialEndsAt?.toISOString()}; currentPeriodEnd ${after.currentPeriodEnd?.toISOString() ?? null}`);

  // ── the consequence: seven days later ────────────────────────────────────
  await db.set(target.orgId, { trialEndsAt: new Date(Date.now() - DAY_MS) });
  finding('NEW-1', 'and once the trial days are over, that company cannot write', REFUSED, await canWrite(target));
  const seen = await target.pm.send('GET', '/billing/subscription');
  finding('NEW-1', 'and the billing screen says it has no access', false, seen.body?.data?.hasAccess ?? null, `screen: plan ${seen.body?.data?.plan}, status ${seen.body?.data?.status}`);

  // ── the neighbour, which received nothing, is the comparison ─────────────
  const beside = await db.subscription(neighbour.orgId);
  check('the neighbour, which received no event, is still a running trial', ['trial', 'trialing'], [beside.plan, beside.status]);
  await db.set(neighbour.orgId, { trialEndsAt: new Date(Date.now() - DAY_MS) });
  check('and with its trial days over the neighbour cannot write', REFUSED, await canWrite(neighbour));

  await finish('check NEW-1');
};

main().catch(async (error) => {
  console.error(error);
  await db.close().catch(() => {});
  process.exitCode = 1;
});
