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
 *   fakeBase() / preflight(probe)   the fake's address (refused unless local) and the proof, before a suite
 *                              runs, that the billing API's Stripe calls really reach that fake
 *   ownIds(company)            re-stages provider ids another company already holds (after the fake restarted)
 *   ownerDecision(id, …) / reportOwnerDecisions(suite)   a policy the owner has not decided: reported, not judged
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

/**
 * A POLICY the product owner has not decided. It is neither passed nor failed and never counted: what the
 * product does today is reported, here and again under "owner decisions" at the end of the run.
 */
const decisions = [];
const ownerDecision = (id, question, observed, note = '') => {
  const shown = typeof observed === 'string' ? observed : JSON.stringify(observed);
  decisions.push({ id, question, observed: shown, note });
  console.log(`OWNER DECISION  [${id}] ${question}\n        the product today: ${shown}${note ? `\n        ${note}` : ''}`);
};
const reportOwnerDecisions = (suite) => {
  console.log(`\n${suite}: owner decisions — ${decisions.length} (not cases: a policy the product owner has not decided; what the product does today is shown)`);
  for (const d of decisions) console.log(`  OWNER DECISION  [${d.id}] ${d.question}\n                  the product today: ${d.observed}${d.note ? `\n                  ${d.note}` : ''}`);
  return decisions;
};

// ── the Stripe fake: only ever a local one, and proven to be the one the billing API talks to ──
const LOCAL_FAKE_HOSTS = ['127.0.0.1', 'localhost'];
/** The Stripe fake's base address, refused unless it is this machine (the fake only listens on 127.0.0.1). */
const fakeBase = () => {
  let host = null;
  try {
    host = new URL(FAKE).hostname;
  } catch {
    /* refused below */
  }
  if (!LOCAL_FAKE_HOSTS.includes(host)) throw new Error(`CERT_STRIPE_FAKE_BASE "${FAKE}" is not 127.0.0.1 or localhost: the billing suites only ever talk to a local Stripe fake.`);
  return FAKE;
};

/**
 * Before a billing suite runs anything: the Stripe fake answers on this machine, and the billing API's Stripe
 * calls really reach THIS fake — not a real provider, not another fake. `probe` is a brand-new company of the
 * calling suite (as onboard() returns it); its trial/start must leave, in this fake's log since the mark, the
 * POST /v1/customers that carries its orgId. Anything else stops the run.
 */
const preflight = async (probe) => {
  const base = fakeBase();
  let health;
  try {
    const res = await fetch(`${base}/__health`, { signal: AbortSignal.timeout(5_000) });
    health = res.status === 200 ? await res.json() : { status: res.status };
  } catch (error) {
    throw new Error(`preflight: the Stripe fake at ${base} does not answer (${error.cause?.code || error.message}); start it before the billing suites`);
  }
  if (health?.fake !== 'stripe') throw new Error(`preflight: ${base}/__health did not answer as the Stripe fake: ${JSON.stringify(health).slice(0, 200)}`);

  const mark = Date.now();
  const started = await probe.pm.send('POST', '/billing/trial/start', {});
  if (started.status !== 200) throw new Error(`preflight: trial/start for the probe company answered ${started.status} ${started.body?.error?.code || ''} ${String(started.body?.error?.message || started.text || '').slice(0, 160)}`);
  const customers = (await fake.since(mark)).filter((call) => call.method === 'POST' && call.path === '/v1/customers' && call.body?.metadata?.orgId === probe.orgId);
  if (customers.length === 0) {
    throw new Error(`preflight: the probe company's trial/start answered 200 but the fake at ${base} logged no POST /v1/customers carrying its orgId — the billing API's Stripe calls do not reach this fake (is the API started with stripe-redirect.js and CERT_STRIPE_FAKE_PORT on this fake's port?). Nothing was run.`);
  }
  console.log(`preflight: the Stripe fake at ${base} answers, and the billing API's Stripe calls reach it (probe: ${probe.name || probe.orgId})`);
  return { customerCalls: customers.length };
};

/**
 * The provider ids a company's billing is resolved by (customer, subscription) must be that company's alone. They
 * are, unless the Stripe fake was restarted: its counter starts again and hands out ids the database already holds,
 * and the webhook then refuses an event naming such an id as ambiguous. Fresh ids are then staged on this company's
 * own row (and the fake is told a staged subscription is running). Returns the fields staged ({} when none).
 */
const ownIds = async (company, { tag = 'cert9xx' } = {}) => {
  const client = await prisma();
  const row = await db.subscription(company.orgId);
  const data = {};
  for (const [field, prefix] of [['stripeCustomerId', 'cus'], ['stripeSubscriptionId', 'sub']]) {
    if (row?.[field] && (await client.subscription.count({ where: { [field]: row[field] } })) > 1) data[field] = `${prefix}_${tag}_${crypto.randomBytes(5).toString('hex')}`;
  }
  if (Object.keys(data).length === 0) return data;
  console.log(`        (setup: ${company.name || company.orgId} was handed provider ids another company already holds — the Stripe fake was restarted; staged fresh ones for ${Object.keys(data).join(' and ')})`);
  await db.set(company.orgId, data);
  if (data.stripeSubscriptionId) await fake.set({ subscriptionStatus: { [data.stripeSubscriptionId]: 'active' } });
  return data;
};

const finish = async (suite) => {
  const failed = cases.filter((c) => !c.ok);
  console.log(`\n${suite}: ${cases.length - failed.length} passed, ${failed.length} failed of ${cases.length}`);
  for (const c of failed) console.log(`  FAILED  ${c.name}`);
  await db.close();
  process.exitCode = failed.length ? 2 : 0;
  return { suite, passed: cases.length - failed.length, failed: failed.length, cases };
};

module.exports = { api, check, db, fake, fakeBase, finding, finish, onboard, ownerDecision, ownIds, preflight, reportOwnerDecisions, webhook };
