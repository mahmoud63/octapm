'use strict';

/**
 * Independent check of billing finding D20.
 *
 *   node scripts/cert/billing/checks/check-d20.js
 *
 * The claim: a company asks to cancel (the product marks it `canceled`,
 * cancelAtPeriodEnd true, access until the end of the paid period). A paid
 * invoice event then arrives from the provider — and the row goes back to
 * `active` while cancelAtPeriodEnd stays true. `active` never lapses by
 * itself, so the cancellation no longer ends the company's access unless the
 * provider's deletion event arrives.
 *
 * One company, created here through the product's own sign-up (code 929).
 * Time is staged by moving currentPeriodEnd of that one row and nothing else.
 * The billing scheduler is switched off in the certification API, so its
 * sweep is run here, by the product's own function, narrowed to this company.
 *
 * Exit code 2 while the defect exists, 0 when the product is right, 1 when
 * the check could not be set up.
 */

const crypto = require('crypto');
const path = require('path');
const { check, db, fake, finding, finish, onboard, webhook } = require('../lib');

const DAY_MS = 86_400_000;
const seconds = () => Math.floor(Date.now() / 1000);
const stamp = () => crypto.randomBytes(5).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REFUSED = [402, 'SUBSCRIPTION_REQUIRED'];

const must = (what, res, status = 200) => {
  if (res.status !== status) throw new Error(`setup: ${what} answered ${res.status} ${String(res.text).slice(0, 200)}`);
};

/** Posts a signed event; the door's per-minute limit is shared with other suites, so a 429 is waited out. */
const deliver = async (event) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await webhook.send(event);
    if (res.status !== 429 || attempt === 3) return res;
    await sleep(21_000);
  }
};

/** Tries to create a project. [201, null] or [status, error code]; `id` is the project's when it was created. */
const tryWrite = async (company) => {
  const res = await company.pm.send('POST', '/projects', { name: `D20 access probe ${stamp()}` });
  return { answer: [res.status, res.status === 201 ? null : res.body?.error?.code ?? null], id: res.body?.data?.id ?? res.body?.data?.project?.id ?? null };
};

const main = async () => {
  const prisma = await db.prisma();

  // ── a paying company of our own ──────────────────────────────────────────
  const company = await onboard('D20 check', 929);
  must('trial/start', await company.pm.send('POST', '/billing/trial/start', {}));
  must('trial/confirm', await company.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_visa_${stamp()}` }));
  must('subscribe', await company.pm.send('POST', '/billing/subscribe', { plan: 'business', billingCycle: 'monthly' }));

  // The webhook finds a company by its provider ids. If the Stripe fake was reset it hands out ids the
  // database already holds; then this company is given fresh ones so the event can only mean this company.
  let row = await db.subscription(company.orgId);
  const fresh = {};
  for (const [field, prefix] of [['stripeCustomerId', 'cus'], ['stripeSubscriptionId', 'sub']]) {
    if ((await prisma.subscription.count({ where: { [field]: row[field] } })) > 1) fresh[field] = `${prefix}_cert929_${stamp()}`;
  }
  if (Object.keys(fresh).length) {
    await db.set(company.orgId, fresh);
    if (fresh.stripeSubscriptionId) await fake.set({ subscriptionStatus: { [fresh.stripeSubscriptionId]: 'active' } });
    console.log(`        (setup: provider ids already held by another company were replaced: ${Object.keys(fresh).join(', ')})`);
    row = await db.subscription(company.orgId);
  }
  console.log(`company ${company.name}\n        org ${company.orgId}, subscription row ${row.id}`);

  check('setup: the company is paying — business, active', ['business', 'active'], [row.plan, row.status]);
  check('setup: its provider customer id is held by this company alone', 1, await prisma.subscription.count({ where: { stripeCustomerId: row.stripeCustomerId } }));
  check('setup: its provider subscription id is held by this company alone', 1, await prisma.subscription.count({ where: { stripeSubscriptionId: row.stripeSubscriptionId } }));

  // ── the company asks to cancel ───────────────────────────────────────────
  const cancel = await company.pm.send('POST', '/billing/cancel', {});
  check('asking to cancel is accepted', 200, cancel.status, JSON.stringify(cancel.body?.error || {}));
  const cancelled = await db.subscription(company.orgId);
  check('the company is cancelled at the end of its paid period', ['canceled', true], [cancelled.status, cancelled.cancelAtPeriodEnd]);
  check('and that period end is in the future', true, cancelled.currentPeriodEnd > new Date());

  // ── controls: what a cancellation means, before any paid event ───────────
  const during = await tryWrite(company);
  check('control: while the paid period runs, the cancelled company can write', [201, null], during.answer);
  check('control: and that 201 is a real project of this company', company.orgId, during.id ? (await prisma.project.findUnique({ where: { id: during.id }, select: { orgId: true } }))?.orgId ?? null : null);
  await db.set(company.orgId, { currentPeriodEnd: new Date(Date.now() - DAY_MS) });
  check('control: once the paid period is over, the cancelled company cannot write', REFUSED, (await tryWrite(company)).answer);
  await db.set(company.orgId, { currentPeriodEnd: cancelled.currentPeriodEnd });

  // ── a paid invoice event arrives after the cancel request ────────────────
  const invoiceId = `in_cert929_${stamp()}`;
  const paid = await deliver(webhook.event('invoice.paid', {
    id: invoiceId, object: 'invoice', customer: row.stripeCustomerId, subscription: row.stripeSubscriptionId,
    amount_paid: 49900, currency: 'usd',
    lines: { data: [{ description: 'Business (monthly)', period: { start: seconds(), end: seconds() + 30 * 86_400 } }] },
  }));
  check('the signed paid event is accepted', 200, paid.status, paid.text.slice(0, 120));
  const landed = await prisma.invoice.findMany({ where: { stripeInvoiceId: invoiceId }, select: { subscriptionId: true } });
  check('the event was applied to this company and to no other', [row.id], landed.map((i) => i.subscriptionId));

  const after = await db.subscription(company.orgId);
  finding('D20', 'a paid event after the cancel request leaves the cancellation standing', ['canceled', true], [after.status, after.cancelAtPeriodEnd]);
  const screen = await company.pm.send('GET', '/billing/subscription');
  finding('D20', 'the billing screen is still told the subscription is cancelled', 'canceled', screen.body?.data?.status ?? `(${screen.status})`, `cancelAtPeriodEnd on the screen: ${screen.body?.data?.cancelAtPeriodEnd}`);

  // ── the paid period ends ─────────────────────────────────────────────────
  await db.set(company.orgId, { currentPeriodEnd: new Date(Date.now() - DAY_MS) });
  const late = await tryWrite(company);
  finding('D20', 'once the paid period is over, the company that cancelled cannot write', REFUSED, late.answer);
  const told = await company.pm.send('GET', '/billing/subscription');
  finding('D20', 'and the billing screen is told it has no access', false, told.body?.data?.hasAccess ?? `(${told.status})`);

  // The product's own daily sweep (billing-scheduler.js runBillingChecks), on the certification
  // database, narrowed to this one company. It is what ends a cancelled company when no event comes.
  process.env.DATABASE_URL = process.env.CERT_DATABASE_URL;
  const product = require(path.join(__dirname, '..', '..', '..', '..', 'src', 'config', 'db'));
  const [where] = await product.prisma.$queryRawUnsafe('select current_database() as database');
  if (where.database !== 'octapm_cert') throw new Error(`setup: the product client is on "${where.database}", not the certification database`);
  const { runBillingChecks } = require(path.join(__dirname, '..', '..', '..', '..', 'src', 'jobs', 'billing-scheduler'));
  await runBillingChecks(new Date(), { orgIds: [company.orgId] });
  await product.prisma.$disconnect();
  finding('D20', 'the daily billing sweep expires the cancelled company whose paid period is over', 'expired', (await db.subscription(company.orgId)).status);

  // ── how long the wrong state can last with the real provider ─────────────
  // At the end of the period the provider deletes the subscription and says so. That event is the
  // only thing left that ends this company's access; this case passes with and without the defect.
  await db.set(company.orgId, { currentPeriodEnd: cancelled.currentPeriodEnd });
  const deleted = await deliver(webhook.event('customer.subscription.deleted', { id: row.stripeSubscriptionId, object: 'subscription', customer: row.stripeCustomerId, status: 'canceled' }));
  check("the provider's end-of-period deletion event expires the company", [200, 'expired'], [deleted.status, (await db.subscription(company.orgId)).status]);
  check('and after it the company cannot write', REFUSED, (await tryWrite(company)).answer);

  await finish('check D20');
};

main().catch(async (error) => {
  console.error(error);
  await db.close().catch(() => {});
  process.exitCode = 1;
});
