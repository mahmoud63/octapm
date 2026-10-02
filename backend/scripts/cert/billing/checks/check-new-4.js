'use strict';

/**
 * Independent check of NEW-4:
 *   "A signed event whose customer is an object instead of an id is answered 500."
 *
 *   node scripts/cert/billing/checks/check-new-4.js
 *
 * One company of its own (code 929) in a running card trial, so that it holds
 * a real provider customer id. Then the same invoice.payment_failed event is
 * delivered twice, correctly signed both times: once with the customer as an
 * object ({ id, object: 'customer' }) and once with the customer as the id
 * string. Everything else is identical, so the answer differs only because of
 * the shape of that one field.
 *
 * Exit code 2 while the defect exists, 0 when the product is right.
 */

const crypto = require('crypto');
const { check, db, finding, finish, onboard, webhook } = require('../lib');

const stamp = () => crypto.randomBytes(5).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delivers a signed event; a 429 is the shared delivery limit, not an answer about the event. */
const deliver = async (event) => {
  const payload = JSON.stringify(event);
  for (let attempt = 0; ; attempt += 1) {
    const res = await webhook.sendRaw(payload, webhook.sign(payload));
    if (res.status !== 429 || attempt === 4) return res;
    console.log('        (webhook delivery limit reached; waiting 21 s)');
    await sleep(21_000);
  }
};

const invoiceRows = async (stripeInvoiceId) => (await db.prisma()).invoice.count({ where: { stripeInvoiceId } });
const rowOf = async (orgId) => JSON.stringify(await (await db.prisma()).subscription.findUnique({ where: { orgId } }));

const main = async () => {
  // ── a company of this check's own, holding a real provider customer id ────
  const company = await onboard('NEW-4 checker', 929);
  const start = await company.pm.send('POST', '/billing/trial/start', {});
  if (start.status !== 200) throw new Error(`setup: trial/start answered ${start.status}`);
  const confirm = await company.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_visa_${stamp()}` });
  if (confirm.status !== 200) throw new Error(`setup: trial/confirm answered ${confirm.status}`);
  const born = await db.subscription(company.orgId);
  const customer = born.stripeCustomerId;
  check('setup: the company is in a running trial and holds a provider customer id (a string)', ['trialing', 'string', true], [born.status, typeof customer, String(customer).startsWith('cus_')]);

  // ── control 1: the door answers 200 for a signed event that names nobody ──
  const strangerInvoice = `in_new4_stranger_${stamp()}`;
  const stranger = await deliver(webhook.event('invoice.payment_failed', { id: strangerInvoice, object: 'invoice', customer: `cus_nobody_${stamp()}`, amount_due: 49900, currency: 'usd' }));
  check('control: a signed invoice.payment_failed naming a customer id no company holds is answered 200', 200, stranger.status, stranger.text.slice(0, 80));

  // ── why: the lookup the handler makes, asked directly ────────────────────
  let lookupError = null;
  try {
    await (await db.prisma()).subscription.findFirst({ where: { stripeCustomerId: { id: customer, object: 'customer' } } });
  } catch (error) {
    lookupError = error.name;
  }
  check("cause: the handler's own lookup (findFirst where stripeCustomerId = <an object>) is refused by the database client as an invalid query", 'PrismaClientValidationError', lookupError);

  // ── the claim: invoice.payment_failed with the customer as an object ─────
  const objectInvoice = `in_new4_object_${stamp()}`;
  const before = await rowOf(company.orgId);
  const objectEvent = webhook.event('invoice.payment_failed', { id: objectInvoice, object: 'invoice', customer: { id: customer, object: 'customer' }, amount_due: 49900, currency: 'usd' });
  const asObject = await deliver(objectEvent);
  finding('NEW-4', 'a signed invoice.payment_failed whose customer is an object is answered without a server error', true, asObject.status < 500, `answered ${asObject.status} "${asObject.text.slice(0, 80)}"`);
  check('…it leaves no invoice row anywhere', 0, await invoiceRows(objectInvoice));
  check('…and the company that holds that customer id is exactly as it was', true, (await rowOf(company.orgId)) === before);

  // The provider re-sends what was answered 5xx: does a second delivery of the same event fare any better?
  const again = await deliver(objectEvent);
  finding('NEW-4', '…a second delivery of that same event is answered without a server error too (a retry can never succeed)', true, again.status < 500, `answered ${again.status}`);

  // ── the same root in the two other handled event types ───────────────────
  const paidInvoice = `in_new4_paid_${stamp()}`;
  const paid = await deliver(webhook.event('invoice.paid', { id: paidInvoice, object: 'invoice', customer: { id: customer, object: 'customer' }, amount_paid: 49900, currency: 'usd' }));
  finding('NEW-4', 'a signed invoice.paid whose customer is an object is answered without a server error', true, paid.status < 500, `answered ${paid.status} "${paid.text.slice(0, 80)}"`);
  check('…it leaves no invoice row anywhere either', 0, await invoiceRows(paidInvoice));
  const deleted = await deliver(webhook.event('customer.subscription.deleted', { id: { id: `sub_nobody_${stamp()}`, object: 'subscription' }, object: 'subscription', customer }));
  finding('NEW-4', 'a signed customer.subscription.deleted whose id is an object is answered without a server error', true, deleted.status < 500, `answered ${deleted.status} "${deleted.text.slice(0, 80)}"`);
  check('…and after all four deliveries the company is still exactly as it was', true, (await rowOf(company.orgId)) === before);

  // ── control 2: the identical event with the customer as the id string ────
  const stringInvoice = `in_new4_string_${stamp()}`;
  const asString = await deliver(webhook.event('invoice.payment_failed', { id: stringInvoice, object: 'invoice', customer, amount_due: 49900, currency: 'usd' }));
  check('control: the identical event with the customer as the id string is answered 200', 200, asString.status, asString.text.slice(0, 80));
  const after = await db.subscription(company.orgId);
  // The company here is in its card trial (no paid subscription). Since the D2/NEW-1 fix a provider
  // failure is recorded for it but does not demote it: only an active company becomes past due.
  check('…and is recorded for that company (one failed invoice); a company in its trial is not made past due', [before && JSON.parse(before).status, 1], [after.status, await invoiceRows(stringInvoice)]);

  await finish('check NEW-4');
};

main().catch(async (error) => {
  console.error(error);
  await db.close();
  process.exitCode = 1;
});
