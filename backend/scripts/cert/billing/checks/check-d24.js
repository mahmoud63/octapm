'use strict';

/**
 * Independent check of finding D24 — "amounts are always divided by 100".
 *
 *   node scripts/cert/billing/checks/check-d24.js
 *
 * The payment provider states every amount in the smallest unit of its
 * currency: 49900 usd is 499.00 dollars, 5000 jpy is 5000 yen (the yen has no
 * smaller unit), 12345 kwd is 12.345 dinars (three decimals).
 *
 * One company of this check's own (code 929), in a running card trial, is sent
 * correctly signed invoice events in three currencies. Each case then reads
 * the invoice the product recorded for that company — in the database, and
 * through the product's own billing history (GET /billing/transactions).
 *
 * Exit code 0 when every amount is recorded correctly, 2 while D24 exists.
 */

const crypto = require('crypto');
const { check, db, finding, finish, onboard, webhook } = require('../lib');

const stamp = () => crypto.randomBytes(5).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => Math.floor(Date.now() / 1000);

const must = (what, res, status = 200) => {
  if (res.status !== status) throw new Error(`setup: ${what} answered ${res.status} ${String(res.text).slice(0, 200)}`);
};

/** A correctly signed delivery. The webhook door is rate-limited and shared: a 429 is waited out, never taken as an answer. */
const deliver = async (event) => {
  const payload = JSON.stringify(event);
  for (let attempt = 0; ; attempt += 1) {
    const res = await webhook.sendRaw(payload, webhook.sign(payload));
    if (res.status !== 429 || attempt === 3) return res;
    await sleep(21_000);
  }
};

const paid = (customer, amount, currency) =>
  webhook.event('invoice.paid', {
    id: `in_d24_${stamp()}`,
    object: 'invoice',
    customer,
    amount_paid: amount,
    currency,
    lines: { data: [{ description: 'Business (monthly)', period: { start: now(), end: now() + 30 * 86_400 } }] },
  });
const failed = (customer, amount, currency) =>
  webhook.event('invoice.payment_failed', { id: `in_d24_${stamp()}`, object: 'invoice', customer, amount_due: amount, currency });

const main = async () => {
  // ── the company ──
  const company = await onboard('D24 currency check', 929);
  must('trial/start', await company.pm.send('POST', '/billing/trial/start', {}));
  must('trial/confirm', await company.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_visa_${stamp()}` }));
  const prisma = await db.prisma();
  let row = await db.subscription(company.orgId);
  if (!row.stripeCustomerId) throw new Error('setup: the company has no provider customer after the trial');
  // The webhook finds the company by its provider customer id. If the Stripe fake was reset it can hand out an id
  // another company already holds; then this company is given one of its own so the event can only be its own.
  if ((await prisma.subscription.count({ where: { stripeCustomerId: row.stripeCustomerId } })) > 1) {
    row = await db.set(company.orgId, { stripeCustomerId: `cus_d24_${stamp()}` });
    console.log('        (setup: the provider customer id was shared with another company; a fresh one was staged)');
  }
  const customer = row.stripeCustomerId;
  const subscriptionId = row.id;
  console.log(`company ${company.name}`);

  /** Delivers the event and returns what the product recorded for it: [amount, currency], read from the database. */
  const recorded = async (event) => {
    const res = await deliver(event);
    if (res.status !== 200) throw new Error(`setup: a signed ${event.type} was answered ${res.status} ${res.text.slice(0, 120)}`);
    const rows = await prisma.invoice.findMany({ where: { stripeInvoiceId: event.data.object.id } });
    if (rows.length !== 1) throw new Error(`setup: ${rows.length} invoices recorded for ${event.data.object.id}, expected 1`);
    if (rows[0].subscriptionId !== subscriptionId) throw new Error('setup: the invoice was recorded on another company');
    return { id: rows[0].id, value: [Number(rows[0].amount.toString()), rows[0].currency] };
  };

  // ── the control: a two-decimal currency ──
  const usd = await recorded(paid(customer, 49900, 'usd'));
  check('control: a paid invoice of 49900 usd is recorded as 499 USD', [499, 'USD'], usd.value);

  // ── a currency with no decimals ──
  const jpy = await recorded(paid(customer, 5000, 'jpy'));
  finding('D24', 'a paid invoice of 5000 jpy (the yen has no decimals) is recorded as 5000 JPY', [5000, 'JPY'], jpy.value);

  const jpyFailed = await recorded(failed(customer, 5000, 'jpy'));
  finding('D24', 'a failed invoice of 5000 jpy is recorded as 5000 JPY', [5000, 'JPY'], jpyFailed.value);

  // ── a currency with three decimals ──
  // Stripe requires three-decimal currency amounts to be multiples of 10, and Invoice.amount holds two
  // decimals: 12340 is an amount Stripe can send (this check used 12345 before).
  const kwd = await recorded(paid(customer, 12340, 'kwd'));
  finding('D24', 'a paid invoice of 12340 kwd (the dinar has three decimals) is recorded as 12.34 KWD', [12.34, 'KWD'], kwd.value);

  // ── what the company itself is shown ──
  const history = await company.pm.send('GET', '/billing/transactions');
  must('GET /billing/transactions', history);
  const list = history.body?.data?.transactions || history.body?.data || [];
  const shown = (id) => {
    const t = list.find((x) => x.id === id);
    return t ? [Number(t.amount), t.currency] : null;
  };
  check('control: the billing history shows the usd invoice as 499 USD', [499, 'USD'], shown(usd.id));
  finding('D24', 'the billing history shows the yen invoice as 5000 JPY', [5000, 'JPY'], shown(jpy.id));

  await finish('check D24 (currency exponents)');
};

main().catch(async (error) => {
  console.error(error);
  await db.close();
  process.exitCode = 1;
});
