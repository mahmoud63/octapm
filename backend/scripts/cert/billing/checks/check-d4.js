'use strict';

/**
 * Independent check of finding D4 — "no event de-duplication".
 *
 *   node scripts/cert/billing/checks/check-d4.js
 *
 * The question: when the payment provider delivers the SAME event more than
 * once (it delivers at least once, and sends an event again whenever the
 * first answer was slow or was a 5xx), does the company's billing history
 * still show that payment once?
 *
 * Two companies are created here through the product's own sign-up
 * (CERT-929). One receives the events; the other is the witness that nothing
 * of it lands elsewhere. No other company is touched.
 *
 * Exit code 2 while the defect exists, 0 when the product is right.
 */

const crypto = require('crypto');
const { check, db, finding, finish, onboard, webhook } = require('../lib');

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const stamp = () => crypto.randomBytes(5).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const must = (what, res, status = 200) => {
  if (res.status !== status) throw new Error(`setup: ${what} answered ${res.status} ${String(res.text).slice(0, 200)}`);
};

/** The webhook door allows 120 deliveries a minute per address, shared by every suite: a 429 is waited out, it is not an answer. */
const post = async (payload, header) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await webhook.sendRaw(payload, typeof header === 'function' ? header() : header);
    if (res.status !== 429 || attempt === 3) return res;
    console.log('        (webhook delivery limit reached; waiting 30 s)');
    await sleep(30_000);
  }
};

/** A new company, paying for the business plan, whose provider customer id belongs to it alone. */
const paying = async (label) => {
  const company = await onboard(label, 929);
  must('trial/start', await company.pm.send('POST', '/billing/trial/start', {}));
  must('trial/confirm', await company.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_visa_${stamp()}` }));
  must('subscribe', await company.pm.send('POST', '/billing/subscribe', { plan: 'business', billingCycle: 'monthly' }));
  const prisma = await db.prisma();
  let row = await db.subscription(company.orgId);
  // If the Stripe fake was reset its counter hands out customer ids the database already holds: take a fresh one.
  if ((await prisma.subscription.count({ where: { stripeCustomerId: row.stripeCustomerId } })) !== 1) {
    await db.set(company.orgId, { stripeCustomerId: `cus_cert929_${stamp()}` });
    row = await db.subscription(company.orgId);
  }
  if (row.status !== 'active') throw new Error(`setup: ${label} is ${row.plan}/${row.status}, not active`);
  return { ...company, subscriptionRowId: row.id, customer: row.stripeCustomerId };
};

const rowsFor = async (stripeInvoiceId) => (await db.prisma()).invoice.findMany({ where: { stripeInvoiceId }, select: { subscriptionId: true, status: true, amount: true } });
const listed = async (company, description) => {
  const res = await company.pm.send('GET', '/billing/transactions');
  must('GET /billing/transactions', res);
  return (res.body?.data || []).filter((entry) => entry.description === description);
};
const paidInvoice = (customer, description) => ({
  id: `in_cert929_${stamp()}`,
  object: 'invoice',
  customer,
  amount_paid: 49900,
  currency: 'usd',
  lines: { data: [{ description, period: { start: now(), end: now() + 30 * DAY } }] },
});

const main = async () => {
  const company = await paying('D4 check payer');
  const witness = await paying('D4 check witness');
  const witnessBefore = JSON.stringify(await db.subscription(witness.orgId));

  // ── control: one event, delivered once ────────────────────────────────────
  const onceLabel = `Business (monthly) delivered once ${stamp()}`;
  const once = webhook.event('invoice.paid', paidInvoice(company.customer, onceLabel));
  const oncePayload = JSON.stringify(once);
  const onceAnswer = await post(oncePayload, () => webhook.sign(oncePayload));
  check('control: a signed invoice.paid event is accepted', 200, onceAnswer.status, onceAnswer.text.slice(0, 100));
  const onceRows = await rowsFor(once.data.object.id);
  check('control: delivered once, it records one invoice, on the company the event names', [1, company.subscriptionRowId], [onceRows.length, onceRows[0]?.subscriptionId]);
  check('control: the company lists that payment once', 1, (await listed(company, onceLabel)).length);

  // ── (a) the identical delivery twice: same event id, same bytes, same signature header ──
  const label = `Business (monthly) delivered twice ${stamp()}`;
  const event = webhook.event('invoice.paid', paidInvoice(company.customer, label));
  const payload = JSON.stringify(event);
  const header = webhook.sign(payload);
  const first = await post(payload, header);
  const second = await post(payload, header);
  check('both deliveries of the identical request are answered 200', [200, 200], [first.status, second.status]);
  const rows = await rowsFor(event.data.object.id);
  check('every invoice recorded for that event is on the company the event names', [company.subscriptionRowId], [...new Set(rows.map((r) => r.subscriptionId))]);
  finding('D4', 'the identical invoice.paid delivery sent twice records one invoice', 1, rows.length, `event ${event.id}, provider invoice ${event.data.object.id}`);
  const lines = await listed(company, label);
  finding('D4', "the company's billing history (GET /billing/transactions) shows that one payment once", 1, lines.length, `lines: ${lines.map((l) => `${l.status} ${Number(l.amount)} ${l.currency}`).join(' | ')}`);

  // ── (b) what the provider really does on a retry: the same event id, signed afresh at the time of the retry ──
  const retried = webhook.event('invoice.paid', paidInvoice(company.customer, `Business (monthly) retried ${stamp()}`));
  const retriedPayload = JSON.stringify(retried);
  const a = await post(retriedPayload, () => webhook.sign(retriedPayload));
  await sleep(1200);
  const b = await post(retriedPayload, () => webhook.sign(retriedPayload));
  check('the event and its freshly signed retry are both answered 200', [200, 200], [a.status, b.status]);
  finding('D4', 'an invoice.paid event retried with a fresh signature (same event id) records one invoice', 1, (await rowsFor(retried.data.object.id)).length);

  // ── (c) a failed payment delivered twice ──
  const failed = webhook.event('invoice.payment_failed', { id: `in_cert929_${stamp()}`, object: 'invoice', customer: company.customer, amount_due: 49900, currency: 'usd' });
  const failedPayload = JSON.stringify(failed);
  const f1 = await post(failedPayload, () => webhook.sign(failedPayload));
  const f2 = await post(failedPayload, () => webhook.sign(failedPayload));
  check('the failed-payment event and its retry are both answered 200', [200, 200], [f1.status, f2.status]);
  finding('D4', 'an invoice.payment_failed event delivered twice (same event id) records one failed invoice', 1, (await rowsFor(failed.data.object.id)).length);

  // ── the limits of the defect: what the duplicates did NOT do ──
  const after = await db.subscription(company.orgId);
  check('the duplicates multiplied invoices only: the company still holds one subscription, in the state of the last event (past due)', 'past_due', after.status);
  check("the witness company's subscription and invoices are exactly what they were", witnessBefore, JSON.stringify(await db.subscription(witness.orgId)));
  const witnessList = await witness.pm.send('GET', '/billing/transactions');
  check('the witness company lists none of these payments', [200, 0], [witnessList.status, witnessList.body?.data?.length ?? -1]);

  console.log(`\ncompany ${company.name}\ninvoice rows now on it: ${after.invoices.length}, for 4 provider invoices`);
  await finish('check D4 — duplicate deliveries');
};

main().catch(async (error) => {
  console.error(error);
  await db.close().catch(() => {});
  process.exitCode = 1;
});
