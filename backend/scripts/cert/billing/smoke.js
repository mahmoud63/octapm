'use strict';

/**
 * First contact with the billing environment: a new person signs up, creates
 * a company, starts and confirms a card trial, subscribes, receives a paid
 * invoice event, and cancels — all against the Stripe fake.
 *
 *   node scripts/cert/billing/smoke.js
 */

const { check, db, fake, finish, onboard, webhook } = require('./lib');

const main = async () => {
  const mark = Date.now();
  const company = await onboard('Billing smoke', 900);
  const born = await db.subscription(company.orgId);
  check('a new company is born on the trial plan, not started', ['trial', 'incomplete'], [born.plan, born.status]);

  const gated = await company.pm.send('POST', '/projects', { name: 'Before any trial' });
  check('before a trial starts the company cannot create a project', 402, gated.status, `code ${gated.body?.error?.code}`);

  const start = await company.pm.send('POST', '/billing/trial/start', {});
  check('trial/start answers with a client secret', [200, true], [start.status, Boolean(start.body?.data?.clientSecret)]);
  const confirm = await company.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: 'pm_card_visa_smoke' });
  check('trial/confirm succeeds', 200, confirm.status, JSON.stringify(confirm.body?.error || {}));
  const trialing = await db.subscription(company.orgId);
  check('the company is now in a running trial with a card on file', ['trial', 'trialing', 1], [trialing.plan, trialing.status, trialing.paymentMethods.length]);

  const project = await company.pm.send('POST', '/projects', { name: 'First project' });
  check('in a trial the company can create its one project', 201, project.status, JSON.stringify(project.body?.error || {}));
  const second = await company.pm.send('POST', '/projects', { name: 'Second project' });
  check('and is refused a second one (trial allows one)', [402, 'PROJECT_LIMIT_REACHED'], [second.status, second.body?.error?.code]);

  const subscribe = await company.pm.send('POST', '/billing/subscribe', { plan: 'business', billingCycle: 'monthly' });
  check('subscribe to business succeeds', 200, subscribe.status, JSON.stringify(subscribe.body?.error || {}));
  const active = await db.subscription(company.orgId);
  check('the company is active on business', ['business', 'active', true], [active.plan, active.status, Boolean(active.stripeSubscriptionId)]);

  const paid = await webhook.send(
    webhook.event('invoice.paid', { id: 'in_smoke_1', customer: active.stripeCustomerId, amount_paid: 49900, currency: 'usd', lines: { data: [{ description: 'Business (monthly)', period: { start: Math.floor(Date.now() / 1000), end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] } })
  );
  check('a signed invoice.paid event is accepted', 200, paid.status, paid.text.slice(0, 120));
  const afterPaid = await db.subscription(company.orgId);
  check('and records one paid invoice of 499.00', [1, '499'], [afterPaid.invoices.length, String(Number(afterPaid.invoices[0]?.amount))]);

  const unsigned = await webhook.sendRaw(JSON.stringify(webhook.event('invoice.paid', { id: 'in_smoke_2', customer: active.stripeCustomerId })), 't=1,v1=00');
  check('an event with a wrong signature is refused', 400, unsigned.status);

  const cancel = await company.pm.send('POST', '/billing/cancel', {});
  check('cancel succeeds', 200, cancel.status, JSON.stringify(cancel.body?.error || {}));
  const canceled = await db.subscription(company.orgId);
  check('the company is cancelled, period still running', ['canceled', true], [canceled.status, canceled.cancelAtPeriodEnd]);

  const calls = await fake.since(mark);
  console.log(`\nStripe fake calls: ${calls.map((c) => `${c.method} ${c.path}`).join(' | ')}`);
  await finish('billing smoke');
};

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
