'use strict';

/**
 * Independent check of finding NEW-2.
 *
 *   node scripts/cert/billing/checks/check-new-2.js
 *
 * The claim: nothing stops two companies holding the same provider customer
 * id, and a provider event for that id is then applied to whichever row the
 * database returns first — even when the invoice names the other company's
 * subscription.
 *
 * Two brand-new companies (CERT-929) are taken to an active paid plan through
 * the product's own routes. The duplicate itself can only be staged with a
 * database write (no route accepts a customer id); that is part of the
 * verdict, not hidden. Everything staged is put back at the end.
 *
 * Exit code 2 while the defect exists, 0 when the product is right.
 */

const crypto = require('crypto');
const { check, db, finding, finish, onboard, webhook } = require('../lib');

const stamp = () => crypto.randomBytes(5).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const must = (what, res, status = 200) => {
  if (res.status !== status) throw new Error(`setup: ${what} answered ${res.status} ${String(res.text).slice(0, 200)}`);
};

/** A company on an active business plan, reached only through product routes. */
const paying = async (label) => {
  let company = null;
  for (let attempt = 1; !company; attempt += 1) {
    try {
      company = await onboard(label, 929);
    } catch (error) {
      if (attempt === 4) throw error;
      console.log(`        (setup: sign-up failed under load, trying again: ${String(error.message).slice(0, 90)})`);
      await sleep(3000 * attempt);
    }
  }
  must('trial/start', await company.pm.send('POST', '/billing/trial/start', {}));
  must('trial/confirm', await company.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_visa_${stamp()}` }));
  must('subscribe', await company.pm.send('POST', '/billing/subscribe', { plan: 'business', billingCycle: 'monthly' }));
  const row = await db.subscription(company.orgId);
  if (row.status !== 'active' || !row.stripeCustomerId || !row.stripeSubscriptionId) throw new Error(`setup: ${label} is ${row.plan}/${row.status}`);
  return { ...company, customer: row.stripeCustomerId, subscription: row.stripeSubscriptionId };
};

/** A signed delivery; the door's shared per-minute limit (429) is waited out, it is not an answer. */
const deliver = async (event) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await webhook.send(event);
    if (res.status !== 429 || attempt === 3) return res;
    console.log('        (webhook rate limit reached; waiting 25 s)');
    await sleep(25_000);
  }
};

const main = async () => {
  const prisma = await db.prisma();
  const holders = (field, value) => prisma.subscription.count({ where: { [field]: value } });

  const first = await paying('NEW-2 check first');
  const second = await paying('NEW-2 check second');
  console.log(`        first  = ${first.name}  customer ${first.customer}  subscription ${first.subscription}`);
  console.log(`        second = ${second.name}  customer ${second.customer}  subscription ${second.subscription}`);

  // What the product's own routes produced, before anything is staged.
  check('through the product routes the two companies were given different customer ids', true, first.customer !== second.customer);
  const natural = { first: await holders('stripeCustomerId', first.customer), second: await holders('stripeCustomerId', second.customer) };
  console.log(`        (rows holding each customer id before staging: first ${natural.first}, second ${natural.second} — more than 1 means the Stripe fake was reset and re-issued an id, a test-environment artefact)`);
  // If the fake re-issued ids, give both companies ids of their own so the staged duplicate is the only one.
  for (const company of [first, second]) {
    if ((await holders('stripeCustomerId', company.customer)) > 1) {
      company.customer = `cus_cert929_${stamp()}`;
      await db.set(company.orgId, { stripeCustomerId: company.customer });
    }
    if ((await holders('stripeSubscriptionId', company.subscription)) > 1) {
      company.subscription = `sub_cert929_${stamp()}`;
      await db.set(company.orgId, { stripeSubscriptionId: company.subscription });
    }
  }
  const duplicatesToday = await prisma.$queryRaw`SELECT count(*)::int AS n FROM (SELECT "stripeCustomerId" FROM "Subscription" WHERE "stripeCustomerId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d`;
  console.log(`        (customer ids held by more than one company in the whole database right now: ${duplicatesToday[0].n})`);

  // ── 1. the database ──────────────────────────────────────────────────────
  let staged = 'accepted';
  try {
    await db.set(second.orgId, { stripeCustomerId: first.customer });
  } catch (error) {
    staged = 'refused';
    console.log(`        (the database refused: ${String(error.message).split('\n').pop().slice(0, 140)})`);
  }
  finding('NEW-2', 'the database refuses to give a second company a customer id another company already holds', 'refused', staged);

  const invoiceIds = [];
  try {
    if (staged === 'accepted') {
      check('after staging, exactly two companies hold the shared customer id', 2, await holders('stripeCustomerId', first.customer));

      // ── 2. the event, twice: each time the invoice names the company the bare lookup does NOT return ──
      for (const round of [1, 2]) {
        await db.set(first.orgId, { status: 'active' });
        await db.set(second.orgId, { status: 'active' });
        const looked = await prisma.subscription.findFirst({ where: { stripeCustomerId: first.customer } });
        const [returned, owner] = looked.orgId === first.orgId ? [first, second] : [second, first];
        const invoiceId = `in_cert929_${stamp()}`;
        invoiceIds.push(invoiceId);
        const event = webhook.event('invoice.payment_failed', { id: invoiceId, object: 'invoice', customer: first.customer, subscription: owner.subscription, amount_due: 49900, currency: 'usd' });
        const result = await deliver(event);
        check(`round ${round}: the signed failed-payment event is accepted`, 200, result.status, result.text.slice(0, 100));

        const marked = [];
        for (const company of [first, second]) if ((await db.subscription(company.orgId)).status === 'past_due') marked.push(company.name);
        finding('NEW-2', `round ${round}: with one customer id on two companies, a failed payment marks only the company whose subscription the invoice names`, [owner.name], marked, `invoice names ${owner.subscription} (${owner.name}); the customer lookup returns ${returned.name}`);

        const rows = await prisma.invoice.findMany({ where: { stripeInvoiceId: invoiceId }, include: { subscription: { select: { orgId: true } } } });
        const landed = rows.map((r) => (r.subscription.orgId === first.orgId ? first.name : r.subscription.orgId === second.orgId ? second.name : `ANOTHER COMPANY ${r.subscription.orgId}`));
        finding('NEW-2', `round ${round}: the failed invoice is recorded on the company whose subscription it names`, [owner.name], landed);
      }
    }
  } finally {
    // Put everything back: each company its own customer id, both active, the failed invoices of this check removed.
    await db.set(second.orgId, { stripeCustomerId: second.customer, status: 'active' });
    await db.set(first.orgId, { stripeCustomerId: first.customer, status: 'active' });
    if (invoiceIds.length) await prisma.invoice.deleteMany({ where: { stripeInvoiceId: { in: invoiceIds } } });
  }
  check('afterwards each company holds a customer id no other company holds', [1, 1], [await holders('stripeCustomerId', first.customer), await holders('stripeCustomerId', second.customer)]);

  await finish('check NEW-2');
};

main().catch(async (error) => {
  console.error(error);
  await db.close();
  process.exitCode = 1;
});
