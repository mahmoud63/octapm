'use strict';

/**
 * The live proof of the Stripe webhook's company resolution, in the
 * certification database (billing findings D2, D3, D4, D20, D24, NEW-1,
 * NEW-2, NEW-4).
 *
 *   node scripts/cert/billing/webhook-proof.js
 *
 * It runs the product's own Express application in this process (no server is
 * started), pointed at octapm_cert through the certification guard, and sends
 * it correctly signed events. Its own companies are created for the run
 * (named by the certification rule); before and after every event it reads
 * EVERY subscription row and every company's invoice count, and checks that
 * exactly the intended companies changed. If any other company changed — the
 * defect this exists to catch — the case fails and that company's row and
 * invoices are put back as they were.
 *
 * Exit code 0 when every case behaves, 2 otherwise.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const crypto = require('crypto');
const guard = require('../lib/cert-env');

// The application's database is the certification database, proven first.
process.env.DATABASE_URL = guard.certDatabaseUrl();
process.env.NODE_ENV = 'development';
process.env.STRIPE_SECRET_KEY = process.env.CERT_STRIPE_SECRET_KEY;
process.env.STRIPE_WEBHOOK_SECRET = process.env.CERT_STRIPE_WEBHOOK_SECRET;
for (const name of ['JOB_WORKER_ENABLED', 'SCHEDULERS_ENABLED']) process.env[name] = 'false';

const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STAMP = crypto.randomBytes(3).toString('hex');
const RUN_STARTED = new Date();
const results = [];

const sign = (payload, timestamp = Math.floor(Date.now() / 1000)) =>
  `t=${timestamp},v1=${crypto.createHmac('sha256', SECRET).update(`${timestamp}.${payload}`).digest('hex')}`;
const event = (type, object, created = Math.floor(Date.now() / 1000)) => ({ id: `evt_proof_${crypto.randomBytes(6).toString('hex')}`, object: 'event', type, created, data: { object } });

const main = async () => {
  if (!SECRET || !process.env.STRIPE_SECRET_KEY) throw new Error('CERT_STRIPE_SECRET_KEY and CERT_STRIPE_WEBHOOK_SECRET must be set in backend/.env');
  const prisma = await guard.connectCertPrisma();
  // eslint-disable-next-line global-require
  const request = require('supertest');
  // eslint-disable-next-line global-require
  const app = require('../../../src/app').createApp();

  // ── the proof's own companies ───────────────────────────────────────────
  const made = {};
  const company = async (key, subscription) => {
    const name = `CERT 950 Webhook proof ${key} ${STAMP}`;
    const org = await prisma.organisation.create({ data: { name: `${name} (CERT-950)`, slug: `cert-950-webhook-proof-${key.toLowerCase()}-${STAMP}`, kind: 'company' } });
    guard.assertCertOrganisation(org);
    const sub = await prisma.subscription.create({ data: { orgId: org.id, plan: 'business', status: 'active', billingCycle: 'monthly', seats: 10, currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000), reminderDay5SentAt: new Date(), reminderDay7SentAt: new Date(), ...subscription } });
    made[key] = { orgId: org.id, subscriptionId: sub.id, customer: sub.stripeCustomerId, subscription: sub.stripeSubscriptionId };
    return made[key];
  };
  const A = await company('A', { stripeCustomerId: `cus_proofA${STAMP}`, stripeSubscriptionId: `sub_proofA${STAMP}` });
  const B = await company('B', { stripeCustomerId: `cus_proofB${STAMP}`, stripeSubscriptionId: `sub_proofB${STAMP}` });
  const E = await company('E', { stripeCustomerId: `cus_proofE${STAMP}`, stripeSubscriptionId: `sub_proofE${STAMP}` });
  await company('C', { stripeCustomerId: `cus_proofShared${STAMP}`, stripeSubscriptionId: `sub_proofC${STAMP}` });
  await company('D', { stripeCustomerId: `cus_proofShared${STAMP}`, stripeSubscriptionId: `sub_proofD${STAMP}` });
  const T = await company('T', { plan: 'trial', status: 'trialing', billingCycle: null, currentPeriodEnd: null, trialStartsAt: new Date(), trialEndsAt: new Date(Date.now() + 5 * 86_400_000), stripeCustomerId: `cus_proofT${STAMP}`, stripeSubscriptionId: null });
  const X = await company('X', { status: 'canceled', cancelAtPeriodEnd: true, canceledAt: new Date(), stripeCustomerId: `cus_proofX${STAMP}`, stripeSubscriptionId: `sub_proofX${STAMP}` });
  const keyOf = new Map(Object.entries(made).map(([key, m]) => [m.orgId, key]));

  // ── the whole table, before and after ───────────────────────────────────
  const snapshot = async () => {
    const rows = await prisma.subscription.findMany({ orderBy: { id: 'asc' } });
    const counts = await prisma.invoice.groupBy({ by: ['subscriptionId'], _count: true });
    const invoices = new Map(counts.map((c) => [c.subscriptionId, c._count]));
    return new Map(rows.map((r) => [r.orgId, { row: r, json: JSON.stringify({ ...r, updatedAt: undefined }), invoices: invoices.get(r.id) || 0 }]));
  };
  const changedBetween = (before, after) => [...after.keys()].filter((orgId) => before.get(orgId)?.json !== after.get(orgId).json || before.get(orgId)?.invoices !== after.get(orgId).invoices);
  const status = async (m) => (await prisma.subscription.findUnique({ where: { orgId: m.orgId } })).status;

  /** Sends one delivery and checks which companies changed. */
  const deliver = async (label, { payload, signature, expectStatus = 200, expectChanged = [], expectStatuses = {} }) => {
    const before = await snapshot();
    const startedAt = new Date();
    const res = await request(app).post('/api/v1/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', signature ?? sign(payload)).send(payload);
    const after = await snapshot();
    const changed = changedBetween(before, after);
    const changedKeys = changed.map((orgId) => keyOf.get(orgId) || `OTHER:${orgId}`).sort();
    const statuses = {};
    for (const key of Object.keys(expectStatuses)) statuses[key] = await status(made[key]);
    const ok = res.status === expectStatus && JSON.stringify(changedKeys) === JSON.stringify([...expectChanged].sort()) && JSON.stringify(statuses) === JSON.stringify(expectStatuses);
    results.push({ label, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        answered ${res.status} (expected ${expectStatus}); changed ${JSON.stringify(changedKeys)} (expected ${JSON.stringify(expectChanged)})${Object.keys(expectStatuses).length ? `; statuses ${JSON.stringify(statuses)}` : ''}`);
    // Anything outside the proof's own companies that moved is put back exactly.
    for (const orgId of changed.filter((id) => !keyOf.has(id))) {
      const was = before.get(orgId).row;
      const { id, orgId: _org, createdAt, updatedAt, ...fields } = was;
      await prisma.subscription.update({ where: { id }, data: fields });
      const removed = await prisma.invoice.deleteMany({ where: { subscriptionId: id, createdAt: { gte: startedAt } } });
      console.log(`        RESTORED an unrelated company ${orgId} (its row, and ${removed.count} invoice(s) the event added)`);
    }
    return res;
  };
  const send = (label, eventObject, options = {}) => deliver(label, { payload: JSON.stringify(eventObject), ...options });
  const paid = (customer, invoice, extra = {}) => event('invoice.paid', { id: invoice, object: 'invoice', customer, amount_paid: 49900, currency: 'usd', lines: { data: [{ description: 'Business (monthly)', period: { start: Math.floor(Date.now() / 1000), end: Math.floor(Date.now() / 1000) + 30 * 86_400 } }] }, ...extra });
  const failed = (customer, invoice, created, extra = {}) => event('invoice.payment_failed', { id: invoice, object: 'invoice', customer, amount_due: 49900, currency: 'usd', ...extra }, created);
  const deleted = (id, extra = {}) => event('customer.subscription.deleted', { id, object: 'subscription', ...extra });
  const now = () => Math.floor(Date.now() / 1000);

  console.log(`webhook proof ${STAMP} against ${guard.DATABASE_NAME}; its companies: ${Object.keys(made).join(', ')}\n`);

  // ── 1. a company is named by its provider identifier and nothing else ──
  await send('a payment naming A\'s customer changes A only, and A is active', paid(A.customer, `in_proofA1${STAMP}`), { expectChanged: ['A'], expectStatuses: { A: 'active' } });
  await send('a customer id no company holds changes nothing', paid(`cus_nobody${STAMP}`, `in_n1${STAMP}`));
  for (const [what, customer] of [['no customer field', undefined], ['customer: null', null], ['customer: ""', ''], ['customer as an object (answered 200, not 500)', { id: A.customer }]]) {
    await send(`a payment with ${what} changes nothing`, paid(customer, `in_m${STAMP}`));
    await send(`a failed payment with ${what} changes nothing`, failed(customer, `in_mf${STAMP}`, now()));
  }
  await send('a deletion without a subscription id changes nothing', deleted(undefined));
  await send('a deletion with id: null changes nothing', deleted(null));
  await send('an unknown subscription id changes nothing', deleted(`sub_nobody${STAMP}`));
  await send('an event naming A\'s customer and B\'s subscription changes nothing', failed(A.customer, `in_mix${STAMP}`, now(), { subscription: B.subscription }));
  await send('a deletion naming B\'s subscription and A\'s customer changes nothing', deleted(B.subscription, { customer: A.customer }));
  await send('two companies holding the same customer id: neither changes', failed(`cus_proofShared${STAMP}`, `in_sh${STAMP}`, now()));
  await send('the same shared customer id with D\'s subscription id changes D only', failed(`cus_proofShared${STAMP}`, `in_sh2${STAMP}`, now(), { subscription: made.D.subscription }), { expectChanged: ['D'], expectStatuses: { C: 'active', D: 'past_due' } });

  // ── 2. duplicates and replays ────────────────────────────────────────────
  const once = paid(A.customer, `in_proofA2${STAMP}`);
  const bytes = JSON.stringify(once);
  const header = sign(bytes);
  await deliver('a new payment for A records one invoice', { payload: bytes, signature: header, expectChanged: ['A'] });
  await deliver('the same delivery again (same bytes, same signature) records nothing', { payload: bytes, signature: header });
  await deliver('the same event signed again later records nothing', { payload: bytes });
  await deliver('the same event under a new event id records nothing', { payload: JSON.stringify({ ...once, id: `evt_redelivery_${STAMP}` }) });
  await deliver('a delivery replayed after the 300-second tolerance is refused and records nothing', { payload: bytes, signature: sign(bytes, now() - 400), expectStatus: 400 });

  // ── 3. late and out-of-order events ──────────────────────────────────────
  await send('B\'s subscription is deleted: B is expired', deleted(B.subscription), { expectChanged: ['B'], expectStatuses: { B: 'expired' } });
  await send('a failed payment from before the deletion, arriving after it, leaves B expired (the failed attempt is recorded)', failed(B.customer, `in_late1${STAMP}`, now() - 3600), { expectChanged: ['B'], expectStatuses: { B: 'expired' } });
  await send('a payment from before the deletion, arriving after it, leaves B expired (the payment is recorded)', paid(B.customer, `in_late2${STAMP}`), { expectChanged: ['B'], expectStatuses: { B: 'expired' } });
  await send('the deletion delivered again changes nothing', deleted(B.subscription));
  await send('an older failure for A\'s paid invoice leaves A active', failed(A.customer, `in_proofA2${STAMP}`, now() - 3600), { expectChanged: ['A'], expectStatuses: { A: 'active' } });
  await send('a failure created before A\'s recorded payment leaves A active', failed(A.customer, `in_stale${STAMP}`, now() - 3600), { expectChanged: ['A'], expectStatuses: { A: 'active' } });
  await send('a failure created after A\'s payment makes A past due', failed(A.customer, `in_next${STAMP}`, now() + 60), { expectChanged: ['A'], expectStatuses: { A: 'past_due' } });
  await send('the payment of that invoice makes A active again', paid(A.customer, `in_next${STAMP}`), { expectChanged: ['A'], expectStatuses: { A: 'active' } });
  await send('a payment for a company in its free trial does not make it a paying company', paid(T.customer, `in_t${STAMP}`), { expectChanged: ['T'], expectStatuses: { T: 'trialing' } });
  await send('a payment after a cancellation request does not undo the cancellation', paid(X.customer, `in_x${STAMP}`), { expectChanged: ['X'], expectStatuses: { X: 'canceled' } });

  // ── 4. two companies, different subscriptions ───────────────────────────
  await send('a failed payment for E changes E only; A is untouched', failed(E.customer, `in_e1${STAMP}`, now() + 120), { expectChanged: ['E'], expectStatuses: { E: 'past_due', A: 'active' } });
  await send('a payment in yen for E is recorded as 5000, not 50', paid(E.customer, `in_jpy${STAMP}`, { amount_paid: 5000, currency: 'jpy' }), { expectChanged: ['E'], expectStatuses: { E: 'active' } });
  const yen = await prisma.invoice.findFirst({ where: { stripeInvoiceId: `in_jpy${STAMP}` } });
  results.push({ label: 'the yen invoice amount', ok: Number(yen?.amount) === 5000 && yen?.currency === 'JPY' });
  console.log(`${results[results.length - 1].ok ? 'PASS' : 'FAIL'}  the yen invoice amount is 5000 JPY (${yen?.amount} ${yen?.currency})`);

  // ── 5. every outcome on a known company is audited there ────────────────
  const audited = await prisma.auditEvent.count({ where: { orgId: A.orgId, entityType: 'subscription', action: { startsWith: 'billing.provider_event.' } } });
  results.push({ label: 'A\'s provider events are in A\'s audit trail', ok: audited >= 8 });
  console.log(`${audited >= 8 ? 'PASS' : 'FAIL'}  A's provider events are in A's audit trail (${audited} rows)`);
  // This run's rows only: earlier runs (and mutation runs) leave their own behind.
  const elsewhere = await prisma.auditEvent.count({ where: { entityType: 'subscription', action: { startsWith: 'billing.provider_event.' }, occurredAt: { gte: RUN_STARTED }, orgId: { notIn: Object.values(made).map((m) => m.orgId) } } });
  results.push({ label: 'no other company has a provider-event audit row from this run', ok: elsewhere === 0 });
  console.log(`${elsewhere === 0 ? 'PASS' : 'FAIL'}  no other company has a provider-event audit row (${elsewhere})`);

  await prisma.$disconnect();
  const failedCases = results.filter((r) => !r.ok);
  console.log(`\nwebhook proof: ${results.length - failedCases.length} passed, ${failedCases.length} failed of ${results.length}`);
  process.exitCode = failedCases.length ? 2 : 0;
  // The in-process application holds database connections and timers open.
  setTimeout(() => process.exit(process.exitCode), 200).unref?.();
  setTimeout(() => process.exit(process.exitCode), 2000);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
