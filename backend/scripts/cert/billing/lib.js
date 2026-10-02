'use strict';

/**
 * What every billing certification suite shares.
 *
 * The suites talk to the BILLING certification API (CERT_BILLING_API_BASE,
 * port 5191), which is the certification API started with test-shaped Stripe
 * settings and with the Stripe SDK redirected to the local Stripe fake
 * (CERT_STRIPE_FAKE_BASE, port 5390). No real provider is ever called.
 *
 *   const { api, fake, onboard, webhook, db, check, finish } = require('./lib');
 *
 *   onboard('label', 931)      a brand-new person signs up and creates a company through the product's own
 *                              routes — no database editing — and gets { email, orgId, personalOrgId, pm }
 *   webhook.send(event)        posts a provider event signed with the API's webhook secret
 *   webhook.sendRaw(...)       posts with any signature (for the refusals)
 *   fake.calls() / set / reset the Stripe fake's log and switches
 *   db.subscription(orgId)     reads the subscription row (and db.set to stage a state no route produces)
 *   check(name, expected, actual) / finish()   named cases, exit code 0 only if all pass
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

// The billing instance, not the plain certification API. Set before the client is loaded.
process.env.CERT_API_BASE = process.env.CERT_BILLING_API_BASE || 'http://localhost:5191';

const crypto = require('crypto');
const api = require('../lib/api');
const guard = require('../lib/cert-env');

const FAKE = (process.env.CERT_STRIPE_FAKE_BASE || 'http://127.0.0.1:5390').replace(/\/$/, '');
const WEBHOOK_SECRET = process.env.CERT_STRIPE_WEBHOOK_SECRET;

// ── the Stripe fake ────────────────────────────────────────────────────────
const fake = {
  calls: async () => (await (await fetch(`${FAKE}/__calls`)).json()).calls,
  reset: async () => (await fetch(`${FAKE}/__reset`, { method: 'POST' })).status,
  set: async (settings) => (await fetch(`${FAKE}/__set`, { method: 'POST', body: JSON.stringify(settings) })).status,
  /** Calls made since `mark` (a Date.now() value). */
  since: async (mark) => (await fake.calls()).filter((c) => c.at >= mark),
};

// ── provider events ────────────────────────────────────────────────────────
/** Stripe's signature scheme: t=<seconds>,v1=HMAC-SHA256(secret, "<t>.<payload>"). */
const sign = (payload, { secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) =>
  `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;

const webhook = {
  sign,
  /** Posts exactly these bytes with exactly this signature header. Returns { status, text }. */
  sendRaw: async (payload, signature, headers = {}) => {
    const res = await fetch(`${api.API}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(signature === null ? {} : { 'stripe-signature': signature }), ...headers },
      body: payload,
    });
    return { status: res.status, text: await res.text() };
  },
  /** Posts an event object, correctly signed (unless options say otherwise). */
  send: async (event, options = {}) => {
    const payload = JSON.stringify(event);
    return webhook.sendRaw(payload, sign(payload, options));
  },
  event: (type, object, extra = {}) => ({ id: `evt_cert_${crypto.randomBytes(8).toString('hex')}`, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object }, ...extra }),
};

// ── a brand-new company, through the product's own doors ───────────────────
/**
 * A person signs up (which gives them a personal workspace) and creates a
 * company workspace. Names follow the certification naming rule so the
 * certification guard still recognises everything in the database.
 */
const onboard = async (label, code = 900) => {
  const stamp = crypto.randomBytes(4).toString('hex');
  const email = `owner.${stamp}@billing.octapm-cert.test`;
  const password = process.env.CERT_PASSWORD;
  const registered = await api.raw('POST', '/auth/register', { json: { name: `Billing Owner ${stamp}`, email, password } });
  if (registered.status !== 200 && registered.status !== 201) throw new Error(`sign-up refused: ${registered.status} ${registered.text}`);
  const personalOrgId = registered.body?.data?.user?.orgId || null;
  const personal = api.as(email, personalOrgId);
  const name = `CERT ${code} ${label} ${stamp} (CERT-${code})`;
  const created = await personal.send('POST', '/organisations', { name, currency: 'USD', timezone: 'America/Chicago' });
  if (created.status !== 201) throw new Error(`company creation refused: ${created.status} ${created.text}`);
  const data = created.body.data;
  const orgId = data.organisation?.id || data.workspace?.id || data.id || data.org?.id;
  if (!orgId) throw new Error(`company created but no id in the answer: ${JSON.stringify(data).slice(0, 300)}`);
  api.forget(email);
  return { email, name, orgId, personalOrgId, pm: api.as(email, orgId), personal: api.as(email, personalOrgId) };
};

// ── the database, read and (for states no route produces) staged ───────────
let prismaPromise = null;
const prisma = () => (prismaPromise = prismaPromise || guard.connectCertPrisma());
const db = {
  subscription: async (orgId) => (await prisma()).subscription.findUnique({ where: { orgId }, include: { paymentMethods: true, invoices: true } }),
  /** Stages a subscription state. Exactly one row, named by its company. */
  set: async (orgId, data) => {
    const client = await prisma();
    const done = await client.subscription.updateMany({ where: { orgId }, data });
    if (done.count !== 1) throw new Error(`staging a subscription state matched ${done.count} rows for ${orgId}`);
    return client.subscription.findUnique({ where: { orgId } });
  },
  counts: async () => {
    const client = await prisma();
    const rows = await client.subscription.groupBy({ by: ['plan', 'status'], _count: true });
    return Object.fromEntries(rows.map((r) => [`${r.plan}/${r.status}`, r._count]));
  },
  /** Every subscription as "orgId plan status periodEnd" — to prove nothing else moved. */
  snapshot: async () => {
    const client = await prisma();
    const rows = await client.subscription.findMany({ select: { orgId: true, plan: true, status: true, seats: true, currentPeriodEnd: true, trialEndsAt: true, cancelAtPeriodEnd: true, stripeCustomerId: true, stripeSubscriptionId: true, aiGenerationsUsed: true }, orderBy: { orgId: 'asc' } });
    const invoices = await client.invoice.groupBy({ by: ['subscriptionId'], _count: true });
    return { rows: new Map(rows.map((r) => [r.orgId, JSON.stringify(r)])), invoices: invoices.reduce((n, r) => n + r._count, 0) };
  },
  /** The companies whose subscription differs between two snapshots. */
  changed: (before, after) => [...after.rows.entries()].filter(([orgId, row]) => before.rows.get(orgId) !== row).map(([orgId]) => orgId),
  prisma,
  close: async () => prismaPromise && (await prismaPromise).$disconnect(),
};

// ── cases ──────────────────────────────────────────────────────────────────
const cases = [];
const check = (name, expected, actual, note = '') => {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  cases.push({ name, ok, expected, actual, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}${note ? `\n        ${note}` : ''}`);
  return ok;
};
/** A case that records a known defect: passes when the product is right, fails (with the finding's id) when it is not. */
const finding = (id, name, expected, actual, note = '') => check(`[${id}] ${name}`, expected, actual, note);
const finish = async (suite) => {
  const failed = cases.filter((c) => !c.ok);
  console.log(`\n${suite}: ${cases.length - failed.length} passed, ${failed.length} failed of ${cases.length}`);
  for (const c of failed) console.log(`  FAILED  ${c.name}`);
  await db.close();
  process.exitCode = failed.length ? 2 : 0;
  return { suite, passed: cases.length - failed.length, failed: failed.length, cases };
};

module.exports = { api, check, db, fake, finding, finish, onboard, webhook };
