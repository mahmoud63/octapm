'use strict';

/**
 * Independent check of finding D23.
 *
 *   node scripts/cert/billing/checks/check-d23.js
 *
 * The claim: a correctly signed provider event larger than 100 kb is refused
 * with 413 before its signature is even looked at, and is never processed.
 *
 * What this file does, on a company it creates itself (CERT-929):
 *   - control: an ordinary signed invoice.paid is accepted and recorded;
 *   - control: a signed invoice.paid of exactly 102 400 bytes (the padding
 *     field included) is accepted and recorded — so the padding is harmless;
 *   - finding: the same event one byte longer (102 401 bytes) is accepted;
 *   - finding: the claim's own size (about 110 kb) is accepted and recorded;
 *   - control: an oversized delivery with a WRONG signature records nothing.
 *
 * Exit code 2 while the defect exists, 0 when the product is right.
 */

const crypto = require('crypto');
const { check, db, finding, finish, onboard, webhook } = require('../lib');

const DAY = 86_400;
const LIMIT = 100 * 1024; // express.raw's default: 102 400 bytes
const now = () => Math.floor(Date.now() / 1000);
const stamp = () => crypto.randomBytes(5).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const patiently = async (what, attempt, tries = 4) => {
  for (let n = 1; ; n += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (n === tries) throw error;
      console.log(`        (setup: ${what} failed — ${String(error.message).replace(/\s+/g, ' ').slice(0, 110)} — trying again)`);
      await sleep(3000 * n);
    }
  }
};

const must = (what, res, status = 200) => {
  if (res.status !== status) throw new Error(`setup: ${what} answered ${res.status} ${String(res.text).slice(0, 200)}`);
};

/** The webhook door takes 120 deliveries a minute per address, shared with every suite: a 429 is waited out. */
const deliverRaw = async (payload, signature) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await webhook.sendRaw(payload, typeof signature === 'function' ? signature() : signature);
    if (res.status !== 429 || attempt === 3) return res;
    console.log('        (the webhook delivery limit was reached; waiting 25 s)');
    await sleep(25_000);
  }
};

/** An invoice.paid event for `customer` whose JSON is exactly `bytes` long (or of ordinary size when bytes is null). */
const paidEvent = (customer, bytes = null) => {
  const build = (padding) =>
    webhook.event('invoice.paid', {
      id: `in_cert929_${stamp()}`,
      object: 'invoice',
      customer,
      amount_paid: 49900,
      currency: 'usd',
      lines: { data: [{ description: 'Business (monthly)', period: { start: now(), end: now() + 30 * DAY } }] },
      ...(padding === null ? {} : { cert_padding: padding }),
    });
  if (bytes === null) return build(null);
  const empty = build('');
  const event = { ...empty, data: { object: { ...empty.data.object, cert_padding: 'x'.repeat(bytes - Buffer.byteLength(JSON.stringify(empty))) } } };
  if (Buffer.byteLength(JSON.stringify(event)) !== bytes) throw new Error('setup: the padded event is not the size asked for');
  return event;
};

const invoiceCount = async (stripeInvoiceId) => (await db.prisma()).invoice.count({ where: { stripeInvoiceId } });

const main = async () => {
  // lib.js keeps its first connection attempt, failed or not: make sure the database answers before it is asked.
  // eslint-disable-next-line global-require
  const guard = require('../../lib/cert-env');
  await patiently('the database connection', async () => (await guard.connectCertPrisma()).$disconnect());

  // An active, paying company of this check's own, with a provider customer id nobody else holds.
  const company = await patiently('the sign-up', () => onboard('D23 large event', 929));
  must('trial/start', await company.pm.send('POST', '/billing/trial/start', {}));
  must('trial/confirm', await company.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_visa_${stamp()}` }));
  must('subscribe', await company.pm.send('POST', '/billing/subscribe', { plan: 'business', billingCycle: 'monthly' }));
  let row = await db.subscription(company.orgId);
  const prisma = await db.prisma();
  if ((await prisma.subscription.count({ where: { stripeCustomerId: row.stripeCustomerId } })) > 1) {
    row = await db.set(company.orgId, { stripeCustomerId: `cus_cert929_${stamp()}` });
    console.log('        (setup: the Stripe fake had handed out a customer id another company holds; staged a fresh one)');
  }
  const customer = row.stripeCustomerId;
  const holders = await prisma.subscription.findMany({ where: { stripeCustomerId: customer }, select: { orgId: true } });
  check('setup: the company is active and its customer id belongs to it alone', ['active', [company.orgId]], [(await db.subscription(company.orgId)).status, holders.map((h) => h.orgId)]);
  console.log(`        company ${company.name}`);

  const deliver = async (event) => {
    const payload = JSON.stringify(event);
    const res = await deliverRaw(payload, () => webhook.sign(payload));
    return { ...res, bytes: Buffer.byteLength(payload), recorded: await invoiceCount(event.data.object.id) };
  };

  // 1. control — the door works for this company
  const ordinary = await deliver(paidEvent(customer));
  check(`an ordinary signed invoice.paid (${ordinary.bytes} bytes) is accepted`, 200, ordinary.status, ordinary.text.slice(0, 120));
  check('…and the ordinary invoice is recorded once', 1, ordinary.recorded);

  // 2. control — the padding field is harmless; only the size differs in what follows
  const atLimit = await deliver(paidEvent(customer, LIMIT));
  check(`a signed invoice.paid of exactly ${atLimit.bytes} bytes (100 kb) is accepted`, 200, atLimit.status, atLimit.text.slice(0, 120));
  check('…and the 100 kb invoice is recorded once', 1, atLimit.recorded);

  // 3. the defect — one byte more
  const before = await db.subscription(company.orgId);
  const oneOver = await deliver(paidEvent(customer, LIMIT + 1));
  finding('D23', `a correctly signed invoice.paid of ${oneOver.bytes} bytes (one byte over 100 kb) is accepted`, 200, oneOver.status, `answer: ${oneOver.text.slice(0, 140)}`);
  finding('D23', '…and the one-byte-over invoice is recorded once', 1, oneOver.recorded);

  // 4. the claim's own size
  const large = await deliver(paidEvent(customer, 110 * 1024 + 400));
  finding('D23', `a correctly signed invoice.paid of ${large.bytes} bytes (about 110 kb) is accepted`, 200, large.status, `answer: ${large.text.slice(0, 140)}`);
  finding('D23', '…and the 110 kb invoice is recorded once', 1, large.recorded);
  const after = await db.subscription(company.orgId);
  console.log(`        company row across the two oversized deliveries: status ${before.status} -> ${after.status}, invoices ${before.invoices.length} -> ${after.invoices.length}, period end ${before.currentPeriodEnd?.toISOString()} -> ${after.currentPeriodEnd?.toISOString()}`);

  // 5. control — an oversized delivery nobody signed must never be recorded, whatever the size limit is
  const forged = paidEvent(customer, 110 * 1024 + 400);
  const forgedPayload = JSON.stringify(forged);
  const forgedRes = await deliverRaw(forgedPayload, () => webhook.sign(forgedPayload, { secret: 'whsec_not_the_secret' }));
  check('an oversized delivery with a wrong signature records nothing', 0, await invoiceCount(forged.data.object.id));
  console.log(`        (observation: the wrongly signed oversized delivery was answered ${forgedRes.status} ${forgedRes.text.slice(0, 90)} — ${forgedRes.status === 413 ? 'the size is judged before the signature is read' : 'the signature is judged first'})`);

  await finish('check D23 — a signed event larger than 100 kb');
};

main().catch(async (error) => {
  console.error(error);
  await db.close().catch(() => {});
  process.exitCode = 1;
});
