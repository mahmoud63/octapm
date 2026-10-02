'use strict';

/**
 * Independent check of finding NEW-3.
 *
 *   node scripts/cert/billing/checks/check-new-3.js
 *
 * The claim: the product ignores customer.subscription.updated, so when the
 * provider reports a subscription `unpaid` (every retry failed and the account
 * is set to keep the subscription rather than cancel it) the company keeps
 * reading as active and keeps its access.
 *
 * What is done here, to one company of this check's own (code 929):
 *   1  it signs up, takes the card trial and subscribes — active, can write;
 *   2  the provider (the fake) is told the subscription is `unpaid`, and a
 *      correctly signed customer.subscription.updated says so;
 *   3  the row and the access are read back                     <- the finding
 *   4  control: the SAME subscription id in a signed
 *      customer.subscription.deleted does end the access — so the event in
 *      step 2 was addressed to the right company and believed, only not acted on.
 *
 * Exit code 2 while the defect exists, 0 when the product is right.
 */

const crypto = require('crypto');
const { check, db, fake, finding, finish, onboard, webhook } = require('../lib');

const stamp = () => crypto.randomBytes(4).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const must = (what, res, status = 200) => {
  if (res.status !== status) throw new Error(`setup: ${what} answered ${res.status} ${String(res.text).slice(0, 200)}`);
};

/** The webhook door is rate limited per address and shared with other suites: a 429 is waited out, it is not an answer. */
const deliver = async (event) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await webhook.send(event);
    if (res.status !== 429 || attempt === 3) return res;
    await sleep(21_000);
  }
};

/** Can the company write? [201, null] or [status, error code]. */
const canWrite = async (company) => {
  const res = await company.pm.send('POST', '/projects', { name: `NEW-3 access probe ${stamp()}` });
  return [res.status, res.status === 201 ? null : res.body?.error?.code ?? null];
};
/** What the billing screen is told: [status, hasAccess]. */
const readsAs = async (company) => {
  const res = await company.pm.send('GET', '/billing/subscription');
  return [res.body?.data?.status ?? null, res.body?.data?.hasAccess ?? null];
};

const main = async () => {
  // 1 — a paying company of this check's own.
  const company = await onboard('NEW-3 check', 929);
  must('trial/start', await company.pm.send('POST', '/billing/trial/start', {}));
  must('trial/confirm', await company.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_visa_${stamp()}` }));
  must('subscribe', await company.pm.send('POST', '/billing/subscribe', { plan: 'business', billingCycle: 'monthly' }));

  // The provider ids must be this company's alone (a reset fake hands out ids the database already holds).
  const prisma = await db.prisma();
  let row = await db.subscription(company.orgId);
  const staged = {};
  for (const [field, prefix] of [['stripeCustomerId', 'cus'], ['stripeSubscriptionId', 'sub']]) {
    if ((await prisma.subscription.count({ where: { [field]: row[field] } })) > 1) staged[field] = `${prefix}_cert929_${stamp()}`;
  }
  if (Object.keys(staged).length) row = await db.set(company.orgId, staged);
  const holders = await prisma.subscription.findMany({ where: { stripeSubscriptionId: row.stripeSubscriptionId }, select: { orgId: true } });

  check('setup: the company is active on business', ['business', 'active'], [row.plan, row.status]);
  check('setup: its provider subscription id belongs to it alone', [company.orgId], holders.map((h) => h.orgId));
  check('setup: while active it can create a project', [201, null], await canWrite(company));

  // 2 — the provider now says: unpaid (the shape Stripe sends: the subscription, and what changed).
  await fake.set({ subscriptionStatus: { [row.stripeSubscriptionId]: 'unpaid' } });
  const unpaid = webhook.event('customer.subscription.updated', {
    id: row.stripeSubscriptionId,
    object: 'subscription',
    customer: row.stripeCustomerId,
    status: 'unpaid',
    cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
  });
  unpaid.data.previous_attributes = { status: 'past_due' };
  const before = await db.snapshot();
  const answer = await deliver(unpaid);
  const after = await db.snapshot();
  check('the signed customer.subscription.updated is acknowledged', [200, '{"received":true}'], [answer.status, answer.text]);

  // 3 — the finding: one statement about the row, one about what the company is told, one about what it can do.
  const afterUnpaid = await db.subscription(company.orgId);
  finding('NEW-3', 'after the provider reports the subscription unpaid, the row no longer reads active', false, afterUnpaid.status === 'active', `row status is "${afterUnpaid.status}"; the delivery ${db.changed(before, after).includes(company.orgId) ? 'changed' : 'did not change'} the row`);
  const told = await readsAs(company);
  finding('NEW-3', 'after the provider reports the subscription unpaid, the billing screen says the company has no access', false, told[1], `GET /billing/subscription reads [status, hasAccess] = ${JSON.stringify(told)}`);
  finding('NEW-3', 'after the provider reports the subscription unpaid, the company can no longer create a project', [402, 'SUBSCRIPTION_REQUIRED'], await canWrite(company));

  // 4 — control: the same subscription id, in the one subscription event the product does handle.
  const deleted = webhook.event('customer.subscription.deleted', { id: row.stripeSubscriptionId, object: 'subscription', customer: row.stripeCustomerId, status: 'canceled' });
  const gone = await deliver(deleted);
  check('control: a signed customer.subscription.deleted for the same subscription id is acknowledged', 200, gone.status);
  check('control: and that one does end the subscription', 'expired', (await db.subscription(company.orgId)).status);
  check('control: and the access with it', [402, 'SUBSCRIPTION_REQUIRED'], await canWrite(company));

  await finish('check NEW-3');
};

main().catch(async (error) => {
  console.error(error);
  await db.close().catch(() => {});
  process.exitCode = 1;
});
