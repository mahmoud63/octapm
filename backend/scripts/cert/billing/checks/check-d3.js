'use strict';

/**
 * Independent check of billing finding D3 — provider events applied without
 * regard to order.
 *
 *   node scripts/cert/billing/checks/check-d3.js
 *
 * The claim: POST /api/v1/webhooks/stripe writes the status an event implies
 * whatever the company's present state and whenever the event was created.
 * So a company whose subscription the provider DELETED (expired, read-only)
 * is given write access back by any invoice event that arrives afterwards.
 *
 * Every company here is created by this file through the product's own
 * sign-up (code 929), taken through a card trial and a business subscription
 * against the Stripe fake, and is the only company the event names.
 *
 * Exit code 2 while the defect exists, 0 when the product is right.
 * Cases written with finding(...) state the CORRECT behaviour.
 */

const crypto = require('crypto');
const { check, db, fake, finding, finish, onboard, webhook } = require('../lib');

const now = () => Math.floor(Date.now() / 1000);
const DAY = 86_400;
const stamp = () => crypto.randomBytes(5).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REFUSED = [402, 'SUBSCRIPTION_REQUIRED'];

const must = (what, res, status = 200) => {
  if (res.status !== status) throw new Error(`setup: ${what} answered ${res.status} ${String(res.text).slice(0, 200)}`);
};

/** Sign-ups share the machine with other suites; a slow one is tried again, it is not a case. */
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

/** A new company, active on the business plan, whose provider ids no other company holds. */
const paying = async (label) => {
  const company = await patiently(`sign-up of "${label}"`, () => onboard(label, 929));
  must('trial/start', await company.pm.send('POST', '/billing/trial/start', {}));
  must('trial/confirm', await company.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_visa_${stamp()}` }));
  must('subscribe', await company.pm.send('POST', '/billing/subscribe', { plan: 'business', billingCycle: 'monthly' }));
  const prisma = await db.prisma();
  let row = await db.subscription(company.orgId);
  if (row.status !== 'active' || !row.stripeCustomerId || !row.stripeSubscriptionId) throw new Error(`setup: ${label} is ${row.plan}/${row.status}`);
  // The webhook finds a company by these ids. If the Stripe fake was reset it hands out ids again; stage fresh ones on MY row only.
  const fresh = {};
  if ((await prisma.subscription.count({ where: { stripeCustomerId: row.stripeCustomerId } })) > 1) fresh.stripeCustomerId = `cus_cert929_${stamp()}`;
  if ((await prisma.subscription.count({ where: { stripeSubscriptionId: row.stripeSubscriptionId } })) > 1) fresh.stripeSubscriptionId = `sub_cert929_${stamp()}`;
  if (Object.keys(fresh).length) {
    console.log(`        (setup: ${label} shared a provider id with another company — the fake was reset; staged a fresh one on this company only)`);
    row = await db.set(company.orgId, fresh);
    if (fresh.stripeSubscriptionId) await fake.set({ subscriptionStatus: { [fresh.stripeSubscriptionId]: 'active' } });
  }
  return { ...company, customer: row.stripeCustomerId, subscription: row.stripeSubscriptionId };
};

/** Posts a correctly signed event; a 429 is the shared delivery limit, not an answer. */
const deliver = async (event) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await webhook.send(event);
    if (res.status !== 429 || attempt === 4) return res;
    console.log('        (webhook delivery limit reached; waiting 21 s)');
    await sleep(21_000);
  }
};

const statusOf = async (company) => (await db.subscription(company.orgId)).status;
const projectsOf = async (company) => (await db.prisma()).project.count({ where: { orgId: company.orgId } });
const tryToWrite = async (company) => {
  const res = await company.pm.send('POST', '/projects', { name: `D3 check probe ${stamp()}` });
  return [res.status, res.status === 201 ? null : res.body?.error?.code ?? null];
};
const hasAccess = async (company) => (await company.pm.send('GET', '/billing/subscription')).body?.data?.hasAccess;

const deletion = (company, created = now()) =>
  webhook.event('customer.subscription.deleted', { id: company.subscription, object: 'subscription', customer: company.customer, status: 'canceled' }, { created });
const failed = (company, created, id = `in_d3_${stamp()}`) =>
  webhook.event('invoice.payment_failed', { id, object: 'invoice', customer: company.customer, subscription: company.subscription, amount_due: 49900, currency: 'usd' }, { created });
const paid = (company, created, id = `in_d3_${stamp()}`) =>
  webhook.event(
    'invoice.paid',
    { id, object: 'invoice', customer: company.customer, subscription: company.subscription, amount_paid: 49900, currency: 'usd', lines: { data: [{ description: 'Business (monthly)', period: { start: created, end: created + 30 * DAY } }] } },
    { created }
  );

/** Brings a paying company to "the provider deleted its subscription" and proves that state before anything late arrives. */
const deleted = async (tag, label) => {
  const company = await paying(label);
  const at = now();
  const res = await deliver(deletion(company, at));
  check(`${tag} the deletion event is acknowledged`, 200, res.status);
  check(`${tag} after the deletion the company is expired`, 'expired', await statusOf(company));
  check(`${tag} and is refused a write`, REFUSED, await tryToWrite(company));
  check(`${tag} and holds no project`, 0, await projectsOf(company));
  return { company, at };
};

const main = async () => {
  await patiently('the database connection', async () => (await db.prisma()).$queryRaw`SELECT 1`);

  console.log('\n── (a) deletion, then a failed-payment event created an hour BEFORE the deletion ──');
  {
    const { company, at } = await deleted('(a)', 'D3 check a');
    const late = await deliver(failed(company, at - 3600));
    check('(a) the late failed-payment event is acknowledged', 200, late.status);
    finding('D3', '(a) a failed-payment event older than the deletion leaves the company expired', 'expired', await statusOf(company));
    finding('D3', '(a) the billing screen still says the company has no access', false, await hasAccess(company));
    finding('D3', '(a) the company whose subscription was deleted is still refused a write', REFUSED, await tryToWrite(company));
    finding('D3', '(a) and no project was stored for it', 0, await projectsOf(company));
  }

  console.log('\n── (b) deletion, then a paid event created an hour BEFORE the deletion ──');
  {
    const { company, at } = await deleted('(b)', 'D3 check b');
    const late = await deliver(paid(company, at - 3600));
    check('(b) the late paid event is acknowledged', 200, late.status);
    finding('D3', '(b) a paid event older than the deletion leaves the company expired', 'expired', await statusOf(company));
    finding('D3', '(b) the company whose subscription was deleted is still refused a write', REFUSED, await tryToWrite(company));
    finding('D3', '(b) and no project was stored for it', 0, await projectsOf(company));
  }

  console.log('\n── (c) an invoice is paid, then the OLDER failed attempt for the same invoice arrives ──');
  {
    const company = await paying('D3 check c');
    const invoiceId = `in_d3_${stamp()}`;
    const at = now();
    must('invoice.paid', await deliver(paid(company, at, invoiceId)));
    check('(c) after the payment the company is active', 'active', await statusOf(company));
    const late = await deliver(failed(company, at - 3600, invoiceId));
    check('(c) the older failed attempt is acknowledged', 200, late.status);
    finding('D3', '(c) the older failed attempt for a paid invoice leaves the company active', 'active', await statusOf(company));
  }

  // The two orders the provider produces by itself. Neither event is "older than the deletion",
  // so a fix that only compares event.created does not cover them.
  console.log('\n── (d) the last retry fails and the provider cancels: both events carry the SAME second; the deletion is delivered first ──');
  {
    const { company, at } = await deleted('(d)', 'D3 check d');
    const late = await deliver(failed(company, at));
    check('(d) the failed-payment event is acknowledged', 200, late.status);
    finding('D3', '(d) the failed payment that caused the deletion, delivered after it, leaves the company expired', 'expired', await statusOf(company));
    finding('D3', '(d) and the company is still refused a write', REFUSED, await tryToWrite(company));
  }

  console.log('\n── (e) deletion, then an invoice on that customer is paid AFTER the deletion ──');
  {
    const { company, at } = await deleted('(e)', 'D3 check e');
    const late = await deliver(paid(company, at + 5));
    check('(e) the paid event is acknowledged', 200, late.status);
    finding('D3', '(e) a payment after the deletion does not make the company active with no provider subscription', 'expired', await statusOf(company));
    finding('D3', '(e) and the company is still refused a write', REFUSED, await tryToWrite(company));
  }

  await finish('check D3 — provider events out of order');
};

main().catch(async (error) => {
  console.error(error);
  await db.close().catch(() => {});
  process.exitCode = 1;
});
