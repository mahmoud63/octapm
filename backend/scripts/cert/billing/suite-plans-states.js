'use strict';

/**
 * Billing certification — plans, subscription states, limits and seats.
 *
 *   node scripts/cert/billing/suite-plans-states.js
 *
 * The question: can every company be billed independently, and does a
 * company get exactly the access its plan and its subscription state give it?
 *
 * Everything runs against the BILLING certification API (port 5191) whose
 * Stripe SDK talks to the local Stripe fake (port 5390). Before anything else
 * the run proves both (preflight in lib.js): the fake answers on this machine,
 * and a probe company's trial/start leaves its POST /v1/customers in the
 * fake's log; otherwise nothing runs. Every company in this suite is its own:
 * a new person signs up and creates a company through the product (onboard,
 * codes 910–919). No other company is written to.
 *
 * How a state is reached is said in each case name:
 *   "route"     the product's own HTTP routes (trial/start, trial/confirm, subscribe, cancel)
 *   "event"     a signed provider event posted to the product's webhook route
 *   "job"       the product's daily billing check, called for this suite's companies only
 *   "STAGED"    a direct write to this suite's own subscription row — used only where no
 *               route can produce the state (time passing, an unknown plan, a seat number,
 *               an AI counter that only a real AI provider would move)
 *
 * Besides those staged subscription rows, and always scoped to one of its own
 * companies, the suite also: deletes its own subscription row (section 2, a
 * company with no row at all — re-deleted before each attempt of that race);
 * rewrites its own company's membership and user rows (section 12, a company
 * with no owner and no project manager); and re-stages provider ids on its own
 * row when the Stripe fake, after a restart, hands out ids another company
 * already holds (ownIds in lib.js).
 *
 * A case written with finding('<id>', …) documents a defect: it states the
 * CORRECT behaviour as its expectation, so it fails while the defect exists
 * and passes once it is fixed. Ids D5…D28 are the leads of the billing map
 * (section 19); PS-n are defects this suite found itself (PS-1, PS-2, PS-3 were
 * called NEW-1, NEW-2, NEW-3 in earlier runs; NEW-n now belongs to the webhook
 * suite's checks only).
 *
 * A case written with ownerDecision('<id>', …) is a POLICY the product owner has
 * not decided (who holds billing authority — D15; which seat number governs —
 * D9; what an expired person may still do — D6/D10). It is neither passed nor
 * failed: what the product does today is reported, and listed again at the end
 * of the run under "owner decisions".
 *
 * A race passes when it is not reproduced in the attempts made: D17's bursts
 * are fired once each; D22's simultaneous first reads are fired up to ten
 * times, and the case says how many attempts were made.
 *
 * Sections
 *   1  the plan catalogue
 *   2  an unknown plan is never Trial
 *   3  every subscription state: read, write, write through routers with no gate, trial, subscribe, cancel
 *   4  project limits per plan, and creation at the limit
 *   5  the AI allowance
 *   6  seats
 *   7  upgrade, downgrade, cancel, reactivate, expiry, re-subscribe
 *   8  a subscription that nothing ends (active / past_due for ever)
 *   9  the trial: lapse, restart, a second company
 *  10  payment recovery and a declined card
 *  11  who may bill
 *  12  billing mail, the billing limiter, enterprise requests, the mobile app's reading of a 402
 */

const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { api, check, db, fake, finding, finish, onboard, ownerDecision, ownIds, preflight, reportOwnerDecisions, webhook } = require('./lib');
const guard = require('../lib/cert-env');
const { createByInvitation } = require('../lib/invitations');

const BACKEND = path.join(__dirname, '..', '..', '..');
const MOBILE_ERRORS = path.join(BACKEND, '..', 'mobile', 'src', 'api', 'errors.ts');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DAY = 86_400_000;

// ── small helpers ──────────────────────────────────────────────────────────
const hex = (bytes = 4) => crypto.randomBytes(bytes).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const section = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(4, 96 - title.length))}`);
/** An answer as "status" or "status CODE" — what a case compares. */
const answer = (res) => `${res.status}${res.body?.error?.code ? ` ${res.body.error.code}` : ''}`;
const REFUSED = '402 SUBSCRIPTION_REQUIRED';

/** A step that prepares a case. It is not a case: an unexpected answer stops the run. */
const must = (res, status, what) => {
  if (res.status !== status) throw new Error(`setup step "${what}" answered ${answer(res)} (${res.body?.error?.message || String(res.text).slice(0, 160)}), expected ${status}`);
  return res.body?.data;
};

/** Every company this suite onboarded. The billing job is only ever run for these. */
const mine = new Map();
const company = async (label, code) => {
  const created = await onboard(label, code);
  mine.set(created.orgId, created);
  return created;
};

// After every set-up trial and subscribe the company's provider ids are made its own (ownIds): a provider event
// naming an id another company also holds is refused by the webhook as ambiguous, and a case built on it would
// judge an ignored event.
const OWN_IDS = { tag: 'cert91x' };
const startTrial = async (c, card = `pm_card_visa_${hex(3)}`) => {
  must(await c.pm.send('POST', '/billing/trial/start', {}), 200, 'trial/start');
  must(await c.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: card }), 200, 'trial/confirm');
  await ownIds(c, OWN_IDS);
  return card;
};
const subscribe = (session, plan, billingCycle = 'monthly', extra = {}) => session.send('POST', '/billing/subscribe', { plan, billingCycle, ...extra });
const mustSubscribe = async (c, plan, billingCycle = 'monthly', extra = {}) => {
  const data = must(await subscribe(c.pm, plan, billingCycle, extra), 200, `subscribe ${plan}/${billingCycle}`);
  await ownIds(c, OWN_IDS);
  return data;
};
const newProject = (session, name = `Project ${hex(3)}`, extra = {}) => session.send('POST', '/projects', { name, ...extra });
const mustProject = async (c, name) => must(await newProject(c.pm, name), 201, 'create a project').id;
const liveProjects = async (c) => (await db.prisma()).project.count({ where: { orgId: c.orgId, archivedAt: null } });
const row = (c) => db.subscription(c.orgId);
const billingRead = async (session) => (await session.send('GET', '/billing/subscription')).body?.data || {};

/**
 * A member added through POST /users — since D-ID-1 the deprecated alias of POST /users/invitations, which answers
 * 201 with an invitation and creates no account — and accepted by the new e-mail with its own name and password
 * (lib/invitations createByInvitation). Answers as the old POST /users did, so the cases judge the same thing:
 * 201 with { id, email } once the person is a member, else the refusal (of the invitation, or of the acceptance).
 */
const addMember = async (c, role = 'site_engineer', tag = 'member') => {
  const email = `${tag}.${hex(5)}@billing.octapm-cert.test`;
  const made = await createByInvitation({ inviter: c.pm, email, role, name: `Cert ${tag} ${hex(2)}`, via: 'users' });
  if (made.userId) return { status: 201, headers: made.accepted.headers, text: '', body: { success: true, data: { id: made.userId, email } } };
  return made.accepted && made.accepted.status >= 300 ? made.accepted : made.invited;
};
const mustMember = async (c, role, tag) => {
  const user = must(await addMember(c, role, tag), 201, `add a ${role} member`);
  return { ...user, session: api.as(user.email, c.orgId) };
};

/** A signed provider event. The webhook door allows 120 a minute per address; wait if it says so. */
const providerEvent = async (type, object) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await webhook.send(webhook.event(type, object));
    if (res.status === 200) return res;
    if (res.status !== 429) throw new Error(`provider event ${type} answered ${res.status} ${res.text.slice(0, 160)}`);
    await sleep(10_000);
  }
  throw new Error(`provider event ${type}: the webhook route kept answering 429`);
};
const paymentFailed = (subscription, id = `in_cert_${hex(6)}`) => providerEvent('invoice.payment_failed', { id, customer: subscription.stripeCustomerId, amount_due: 49900, currency: 'usd' });
const invoicePaid = (subscription, { startInDays = 30, endInDays = 60, id = `in_cert_${hex(6)}` } = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return providerEvent('invoice.paid', { id, customer: subscription.stripeCustomerId, amount_paid: 49900, currency: 'usd', lines: { data: [{ description: 'Business (monthly)', period: { start: now + startInDays * 86_400, end: now + endInDays * 86_400 } }] } });
};

/** What the Stripe fake was asked about this company since `mark`. */
const providerCalls = async (mark, ids) => (await fake.since(mark)).filter((call) => ids.filter(Boolean).some((id) => call.body?.customer === id || call.path.includes(id)));
/** The provider's own view of a subscription (what GET /v1/subscriptions/<id> answers). */
const providerSays = (subscriptionId, status) => fake.set({ subscriptionStatus: { [subscriptionId]: status } });

const sendFile = async (session, route, filename, bytes, contentType) => api.raw('POST', route, { token: await session.token(), form: api.multipart({ filename, contentType, body: bytes }) });

// ── the product's own daily billing check, in this process ─────────────────
// It is the scheduler's function (src/jobs/billing-scheduler.js), pointed at the certification
// database, with mail sent to a local catcher so a case can read who a reminder went to.
const mail = [];
let productSide = null;
const product = async () => {
  if (productSide) return productSide;
  const catcher = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        mail.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        mail.push({ to: '(unreadable)', subject: '(unreadable)' });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => catcher.listen(0, '127.0.0.1', resolve));
  // The address comes from the certification guard (CERT_DATABASE_URL, refused unless it names octapm_cert),
  // never from whatever DATABASE_URL backend/.env left in this process — as lib/api.js does for CERT_INPROCESS.
  process.env.DATABASE_URL = guard.certDatabaseUrl();
  process.env.EMAIL_WEBHOOK_URL = `http://127.0.0.1:${catcher.address().port}/mail`;
  delete process.env.EMAIL_PROVIDER;
  // eslint-disable-next-line global-require
  const productDb = require(path.join(BACKEND, 'src', 'config', 'db.js'));
  // The product's own client is proven like every certification client before it is used: the server says
  // octapm_cert and the certification marker row is the one in CERT_ENVIRONMENT_ID.
  try {
    await guard.assertCertEnvironment((sql, params = []) => productDb.prisma.$queryRawUnsafe(sql, ...params));
  } catch (error) {
    await productDb.prisma.$disconnect().catch(() => {});
    catcher.close();
    throw error;
  }
  // eslint-disable-next-line global-require
  const scheduler = require(path.join(BACKEND, 'src', 'jobs', 'billing-scheduler.js'));
  productSide = { scheduler, productDb, catcher };
  return productSide;
};
/** Runs the daily billing check for companies of this suite only — never for anybody else's. */
const billingJob = async (companies, now = new Date()) => {
  const orgIds = companies.map((c) => c.orgId);
  if (!orgIds.length || orgIds.some((id) => !mine.has(id))) throw new Error('the billing job may only be run for companies this suite onboarded');
  const { scheduler } = await product();
  return scheduler.runBillingChecks(now, { orgIds });
};

/** 402 bodies the server really sent, kept for the mobile case in section 12. */
const seen402 = {};

// ═══════════════════════════════════════════════════════════════════════════
// 1  The plan catalogue
// ═══════════════════════════════════════════════════════════════════════════
const catalogue = async () => {
  section('1  the plan catalogue');
  // eslint-disable-next-line global-require
  const { PLANS } = require(path.join(BACKEND, 'src', 'config', 'plans.js'));
  check('the catalogue in config/plans.js is exactly trial, individual, business, enterprise', ['trial', 'individual', 'business', 'enterprise'], Object.keys(PLANS));
  check(
    'the catalogue limits are projects 1 / 3 / 25 / unlimited, AI 3 / 10 / 150 / unlimited, seats 1 / 1 / 10 / unlimited',
    [[1, 3, 1], [3, 10, 1], [25, 150, 10], [null, null, null]],
    ['trial', 'individual', 'business', 'enterprise'].map((id) => [PLANS[id].projectLimit, PLANS[id].aiLimit, PLANS[id].seats].map((n) => (n === Infinity ? null : n)))
  );

  const c = await company('plans catalogue', 910);
  const born = await billingRead(c.pm);
  check('a new company reads as the trial plan, never started, without access', ['trial', 'Trial', 'incomplete', false], [born.plan, born.planName, born.status, born.hasAccess]);
  check('a new company is shown the trial limits: one project, three AI generations', { projectLimit: 1, aiLimit: 3 }, born.limits);

  const plans = (await c.pm.send('GET', '/billing/plans')).body?.data || {};
  check('GET /billing/plans offers a new company individual, business and enterprise — trial is not for sale', ['individual', 'business', 'enterprise'], (plans.plans || []).map((p) => p.id));
  check(
    'GET /billing/plans advertises projects / AI / seats / monthly / annual as 3-10-1-49-39, 25-150-10-499-399 and unlimited',
    [[3, 10, 1, 49, 39], [25, 150, 10, 499, 399], [null, null, null, null, null]],
    (plans.plans || []).map((p) => [p.projectLimit, p.aiLimit, p.seats, p.monthly, p.annual])
  );

  check('subscribe refuses the plan "trial"', '400 VALIDATION_ERROR', answer(await subscribe(c.pm, 'trial')));
  check('subscribe refuses the plan "enterprise" (sales only)', '400 VALIDATION_ERROR', answer(await subscribe(c.pm, 'enterprise')));
  check('subscribe refuses a plan outside the catalogue ("standard")', '400 VALIDATION_ERROR', answer(await subscribe(c.pm, 'standard')));
  check('subscribe refuses a billing cycle outside monthly / annual', '400 VALIDATION_ERROR', answer(await subscribe(c.pm, 'business', 'weekly')));
  const after = await row(c);
  check('none of those refusals changed the company: still trial, never started', ['trial', 'incomplete'], [after.plan, after.status]);

  // PS-3 (called NEW-3 in earlier runs): confirming a trial that was never set up with the provider.
  const skipped = await c.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_nostart_${hex(3)}` });
  const afterSkip = await row(c);
  finding(
    'PS-3',
    'trial/confirm without trial/start (no provider customer exists yet) is refused with a 4xx and grants nothing',
    ['refused with a 4xx', 'incomplete'],
    [skipped.status >= 400 && skipped.status < 500 ? 'refused with a 4xx' : `answered ${answer(skipped)}`, afterSkip.status],
    `provider customer on the row: ${afterSkip.stripeCustomerId || 'none'}. The fake attaches a card to no customer; real Stripe would refuse the attach and the route would answer 500.`
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 2  An unknown plan is never Trial
// ═══════════════════════════════════════════════════════════════════════════
const unknownPlan = async () => {
  section('2  an unknown plan is never Trial');
  const c = await company('plans unknown', 910);
  await startTrial(c);
  await mustSubscribe(c, 'business');
  const projectId = await mustProject(c, 'Unknown plan project');
  const workbook = await c.pm.download(`/projects/${projectId}/boq/template`);
  const before = await liveProjects(c);

  // STAGED: no route writes a plan outside the catalogue. The column is free text and
  // NOT NULL, so "null-like" means the empty string and the words a careless writer leaves.
  for (const plan of ['standard', 'premium', '', 'null', 'undefined', 'Trial']) {
    const shown = JSON.stringify(plan);
    await db.set(c.orgId, { plan, status: 'active' });

    const read = await billingRead(c.pm);
    check(
      `plan ${shown} (STAGED): GET /billing/subscription shows a configuration fault — not recognised, no plan name, no limits`,
      [false, null, null, false, false, 'SUBSCRIPTION_PLAN_UNKNOWN'],
      [read.recognized, read.planName, read.limits, 'projectLimit' in read, 'aiLimit' in read, read.configurationError?.code]
    );
    // The stored identifier is echoed back when it is a plain token (and named in the fault's sentence); everything else is looked at.
    const { plan: echoed, configurationError: fault, ...shownFields } = read;
    check(`plan ${shown} (STAGED): nothing else in GET /billing/subscription says "Trial" or carries trial's limits (1 project, 3 AI)`, false, /"Trial"|"projectLimit":1\b|"aiLimit":3\b/.test(JSON.stringify(shownFields)), `plan echoed as ${JSON.stringify(echoed)}; fault ${fault?.code}`);

    const plans = (await c.pm.send('GET', '/billing/plans')).body?.data || {};
    check(`plan ${shown} (STAGED): GET /billing/plans marks no plan as current and never lists trial`, [['individual', 'business', 'enterprise'], []], [(plans.plans || []).map((p) => p.id), (plans.plans || []).filter((p) => p.isCurrent).map((p) => p.id)]);

    check(`plan ${shown} (STAGED): creating a project is refused with SUBSCRIPTION_PLAN_UNKNOWN`, '500 SUBSCRIPTION_PLAN_UNKNOWN', answer(await newProject(c.pm, 'Under an unknown plan')));
    check(`plan ${shown} (STAGED): an AI generation (BOQ upload) is refused with SUBSCRIPTION_PLAN_UNKNOWN`, '500 SUBSCRIPTION_PLAN_UNKNOWN', answer(await sendFile(c.pm, `/projects/${projectId}/boq/upload`, 'boq-template.xlsx', workbook, XLSX)));
    finding(
      'PS-1', // called NEW-1 in earlier runs
      `plan ${shown} (STAGED): any other write (editing a project) is refused with SUBSCRIPTION_PLAN_UNKNOWN`,
      '500 SUBSCRIPTION_PLAN_UNKNOWN',
      answer(await c.pm.send('PATCH', `/projects/${projectId}`, { location: `Unknown plan ${hex(2)}` })),
      `the subscription gate decides on status alone; GET /billing/subscription says hasAccess ${read.hasAccess}`
    );
  }
  check('no project was created under any unknown plan', before, await liveProjects(c));

  // A stored value that is not a plain token.
  await db.set(c.orgId, { plan: 'bad plan <b>x</b>', status: 'active' });
  check('a stored plan that is not a plain token (STAGED) is withheld by GET /billing/subscription', null, (await billingRead(c.pm)).plan);
  // PS-2 was called NEW-2 in earlier runs.
  finding('PS-2', 'a stored plan that is not a plain token (STAGED) is withheld by GET /billing/plans too', null, (await c.pm.send('GET', '/billing/plans')).body?.data?.currentPlan ?? null);

  // The way back is the product's own: subscribing writes a catalogue plan again.
  await db.set(c.orgId, { plan: 'standard', status: 'active' });
  check('a company on an unknown plan can subscribe to a catalogue plan', '200', answer(await subscribe(c.pm, 'business')));
  const repaired = await billingRead(c.pm);
  check('and then reads as Business with its limits', ['business', true, { projectLimit: 25, aiLimit: 150 }], [repaired.plan, repaired.recognized, repaired.limits]);

  // No subscription row at all. A race: each read tries to insert the missing row and the losers answer
  // 409 CONFLICT. It is fired up to D22_ATTEMPTS times — the row (this suite's own) deleted again before
  // each attempt — and stops at the first attempt that reproduces it.
  const bare = await company('plans no row', 910);
  const D22_ATTEMPTS = 10;
  let firstReads = [];
  let attempts = 0;
  let reproduced = false;
  while (!reproduced && attempts < D22_ATTEMPTS) {
    attempts += 1;
    await (await db.prisma()).subscription.deleteMany({ where: { orgId: bare.orgId } }); // STAGED: this company's own row
    firstReads = await Promise.all(Array.from({ length: 12 }, () => bare.pm.send('GET', '/billing/subscription')));
    reproduced = firstReads.some((res) => res.status !== 200);
  }
  console.log(`        (D22 race: ${reproduced ? `reproduced at attempt ${attempts}` : `not reproduced in ${attempts} attempts`}, up to ${D22_ATTEMPTS} allowed)`);
  finding(
    'D22',
    `a company with no subscription row (STAGED): twelve simultaneous first reads all answer 200, in every attempt (a race: up to ${D22_ATTEMPTS} attempts)`,
    Array(12).fill('200'),
    firstReads.map(answer),
    reproduced
      ? `reproduced at attempt ${attempts} of up to ${D22_ATTEMPTS}; the answers shown are that attempt's`
      : `not reproduced in ${attempts} attempts — this pass says only that the race did not occur here, not that it cannot`
  );
  const invented = await row(bare);
  finding('D22', 'a company with no subscription row (STAGED): a read does not write one — nothing stored is not silently "trial"', null, invented ? `${invented.plan}/${invented.status}` : null);
};

// ═══════════════════════════════════════════════════════════════════════════
// 3  Every subscription state
// ═══════════════════════════════════════════════════════════════════════════

/** Writes through routers that carry NO subscription gate (app.js mounts them without one). */
const UNGATED = [
  { router: 'inventory', does: 'adds a warehouse', accepted: '201', run: (c) => c.pm.send('POST', '/inventory/warehouses', { code: `W${hex(3)}`, name: 'State store' }) },
  { router: 'reports', does: 'saves a report', accepted: '201', run: (c) => c.pm.send('POST', '/reports', { name: `State report ${hex(2)}`, source: 'activity' }) },
  { router: 'portfolio', does: 'asks for a portfolio refresh', accepted: '202', run: (c) => c.pm.send('POST', '/portfolio/refresh', {}) },
  { router: 'integrations', does: 'mints an API key', accepted: '201', run: (c) => c.pm.send('POST', '/integrations/api-clients', { name: `State key ${hex(2)}`, scopes: ['inventory:read'] }) },
  { router: 'company security', does: 'changes the single sign-on settings', accepted: '200', run: (c) => c.pm.send('PUT', '/company/security/sso', { enabled: false }) },
  { router: 'conversations', does: 'opens a conversation', accepted: '201', needsPeer: true, run: (c, peer) => c.pm.send('POST', '/conversations', { kind: 'group', title: `State talk ${hex(2)}`, memberUserIds: [peer.id] }) },
  { router: 'assistant', does: 'asks the assistant a question', accepted: '200', needsAssistantOff: true, run: (c) => c.pm.send('POST', '/assistant/ask', { question: 'How many projects does this company have?' }) },
  { router: 'config', does: 'replaces the surcharges applied to every bill', accepted: '200', run: (c) => c.pm.send('PUT', '/config/extra-services', { services: [{ label: 'VAT', percentage: 5 }] }) },
];

const STATES = [
  { key: 'never started', stored: ['trial', 'incomplete'], access: false, how: 'route: sign-up and company creation', trialStart: '200', cancel: '400 NO_ACTIVE_SUBSCRIPTION', subscribe: '400 PAYMENT_METHOD_REQUIRED' },
  { key: 'trial running', stored: ['trial', 'trialing'], access: true, how: 'routes: trial/start, trial/confirm', trialStart: '409 TRIAL_NOT_AVAILABLE', cancel: '400 NO_ACTIVE_SUBSCRIPTION', subscribe: '200' },
  { key: 'trial, end passed', stored: ['trial', 'trialing'], access: false, how: 'routes to a trial, then STAGED trialEndsAt one hour ago (no route moves time)', trialStart: '409 TRIAL_NOT_AVAILABLE', cancel: '400 NO_ACTIVE_SUBSCRIPTION', subscribe: '200' },
  { key: 'active', stored: ['business', 'active'], access: true, how: 'routes: trial, subscribe', trialStart: '409 TRIAL_NOT_AVAILABLE', cancel: '200', subscribe: '200' },
  { key: 'past due', stored: ['business', 'past_due'], access: true, how: 'event: invoice.payment_failed (and the provider says past_due)', trialStart: '409 TRIAL_NOT_AVAILABLE', cancel: '200', cancelFinding: 'D14', subscribe: '200', subscribeCollectsNothing: true },
  { key: 'cancelled, period running', stored: ['business', 'canceled'], access: true, how: 'route: cancel', trialStart: '409 TRIAL_NOT_AVAILABLE', cancel: '400 NO_ACTIVE_SUBSCRIPTION', subscribe: '200' },
  { key: 'cancelled, period over', stored: ['business', 'canceled'], access: false, how: 'route: cancel, then STAGED currentPeriodEnd one hour ago', trialStart: '409 TRIAL_NOT_AVAILABLE', cancel: '400 NO_ACTIVE_SUBSCRIPTION', subscribe: '200' },
  { key: 'expired', stored: ['business', 'expired'], access: false, how: 'event: customer.subscription.deleted', trialStart: '409 TRIAL_NOT_AVAILABLE', trialStartFinding: 'D6', cancel: '400 NO_ACTIVE_SUBSCRIPTION', subscribe: '200' },
];

const reachState = async (state) => {
  const c = await company(`state ${state.key.replace(/[^a-z ]/g, '')}`, 911);
  if (state.key === 'never started') return { c, peer: null, projectId: null };
  await startTrial(c);
  const peer = await mustMember(c, 'site_engineer', 'peer');
  if (state.key === 'trial running') return { c, peer, projectId: null };
  const projectId = await mustProject(c, 'State project');
  if (state.key === 'trial, end passed') {
    await db.set(c.orgId, { trialEndsAt: new Date(Date.now() - 3_600_000) });
    return { c, peer, projectId };
  }
  await mustSubscribe(c, 'business');
  const subscription = await row(c);
  if (state.key === 'past due') {
    await paymentFailed(subscription);
    await providerSays(subscription.stripeSubscriptionId, 'past_due'); // what Stripe says while an invoice of the subscription is unpaid
  }
  if (state.key.startsWith('cancelled')) must(await c.pm.send('POST', '/billing/cancel', {}), 200, 'cancel');
  if (state.key === 'cancelled, period over') {
    await db.set(c.orgId, { currentPeriodEnd: new Date(Date.now() - 3_600_000) });
    await providerSays(subscription.stripeSubscriptionId, 'canceled'); // what Stripe says once a cancelled period has ended
  }
  if (state.key === 'expired') {
    await providerEvent('customer.subscription.deleted', { id: subscription.stripeSubscriptionId, customer: subscription.stripeCustomerId });
    await providerSays(subscription.stripeSubscriptionId, 'canceled');
  }
  return { c, peer, projectId };
};

const states = async (assistantOff) => {
  section('3  every subscription state');
  for (const state of STATES) {
    console.log(`\n   state: ${state.key} — reached by ${state.how}`);
    const { c, peer, projectId } = await reachState(state);
    const tag = `[${state.key}]`;
    const stored = await row(c);
    check(`${tag} the state is reached (${state.how}): the row reads ${state.stored.join(' / ')}`, state.stored, [stored.plan, stored.status]);

    // reads
    check(`${tag} the company can read its projects`, '200', answer(await c.pm.send('GET', '/projects')));
    check(`${tag} GET /billing/subscription says hasAccess ${state.access}`, state.access, (await billingRead(c.pm)).hasAccess);

    // writes through gated routers
    const created = await newProject(c.pm, 'Written in this state');
    check(`${tag} creating a project is ${state.access ? 'accepted' : 'refused: subscription required'}`, state.access ? '201' : REFUSED, answer(created));
    const editable = projectId || created.body?.data?.id || null;
    if (editable) {
      check(`${tag} a write inside a project (editing it) is ${state.access ? 'accepted' : 'refused: subscription required'}`, state.access ? '200' : REFUSED, answer(await c.pm.send('PATCH', `/projects/${editable}`, { location: `State ${hex(2)}` })));
    } else {
      // A company that never had access has no project to write in; the users router carries the same gate.
      check(`${tag} adding a member (the gated users router) is refused: subscription required`, REFUSED, answer(await addMember(c, 'site_engineer', 'never')));
    }

    // writes through routers with no gate
    for (const write of UNGATED) {
      if (write.needsPeer && !peer) continue; // nobody else can be in a company that never had access
      if (write.needsAssistantOff && !assistantOff) continue; // never call a real AI provider
      const name = `${tag} ${write.router}: a request that ${write.does} is ${state.access ? 'accepted' : 'refused: subscription required'}`;
      const got = answer(await write.run(c, peer));
      if (state.access) check(name, write.accepted, got);
      else finding('D10', name, REFUSED, got);
    }
    // The person's own notification preferences. With access, changing them is ordinary use. Without access,
    // whether the person may still write them is a policy the owner has not decided (D10): reported, not judged.
    const preferences = answer(await c.pm.send('PUT', '/notifications/preferences', { preferences: [{ category: 'mention', inAppEnabled: true }] }));
    if (state.access) check(`${tag} notifications: the person can change their own notification preferences`, '200', preferences);
    else ownerDecision('D10', `${tag} may a person whose company has no access still change their own notification preferences (PUT /notifications/preferences)?`, preferences === '200' ? 'yes — answered 200' : `no — answered ${preferences}`);

    if (state.key === 'expired') {
      // Whether a person whose company has expired may still open another company workspace is a policy the
      // owner has not decided (D6 — unlimited workspaces, each with a trial; D10 — writes without the gate).
      // Sign-up itself opens a workspace for a person with none; this is the other case. Reported, not judged —
      // and asked here, while the company is still expired (the subscribe below makes it active again).
      const name = `CERT 911 opened while expired ${hex(4)} (CERT-911)`;
      const opened = await api.as(c.email, c.orgId).send('POST', '/organisations', { name, currency: 'USD', timezone: 'America/Chicago' });
      const openedId = opened.body?.data?.organisation?.id || opened.body?.data?.workspace?.id || opened.body?.data?.id;
      if (openedId) mine.set(openedId, { orgId: openedId });
      ownerDecision('D6/D10', `${tag} may a person whose company has expired open another company workspace (POST /organisations)?`, opened.status === 201 ? 'yes — answered 201, a new workspace was opened' : `no — answered ${answer(opened)}`);
    }

    // billing actions — in this order, because cancel and subscribe move the state
    const trialName = `${tag} starting a trial answers ${state.trialStart}`;
    const trialGot = answer(await c.pm.send('POST', '/billing/trial/start', {}));
    if (state.trialStartFinding) finding(state.trialStartFinding, trialName, state.trialStart, trialGot);
    else check(trialName, state.trialStart, trialGot);

    const cancelName = `${tag} cancelling answers ${state.cancel}`;
    const cancelGot = answer(await c.pm.send('POST', '/billing/cancel', {}));
    if (state.cancelFinding) finding(state.cancelFinding, cancelName, state.cancel, cancelGot);
    else check(cancelName, state.cancel, cancelGot);

    check(`${tag} subscribing to business answers ${state.subscribe}`, state.subscribe, answer(await subscribe(c.pm, 'business')));
    if (state.subscribe === '200' && state.subscribeCollectsNothing) {
      // The provider still says past_due (reachState told the fake so): the subscribe changes the subscription in
      // place and collects nothing, so the company has not paid and is not active.
      const after = await row(c);
      finding('D12', `${tag} re-subscribing while the provider still says past_due does not record the company as active — nothing was collected`, 'not active', after.status === 'active' ? 'active' : 'not active', `row now ${after.plan}/${after.status}, cancelAtPeriodEnd ${after.cancelAtPeriodEnd}`);
    } else if (state.subscribe === '200') {
      const after = await row(c);
      check(`${tag} and the company is then active on business`, ['business', 'active', false], [after.plan, after.status, after.cancelAtPeriodEnd]);
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 4  Project limits
// ═══════════════════════════════════════════════════════════════════════════
const projectLimits = async () => {
  section('4  project limits per plan');
  const c = await company('plans limits', 912);
  await startTrial(c);

  // trial: 1
  const first = await newProject(c.pm, 'Trial first');
  check('trial: the first project is accepted', '201', answer(first));
  const second = await newProject(c.pm, 'Trial second');
  check('trial: a second project is refused — the plan allows one', '402 PROJECT_LIMIT_REACHED', answer(second));
  seen402.PROJECT_LIMIT_REACHED = second.body?.error;
  check('trial: archiving the project answers 200', '200', answer(await c.pm.send('DELETE', `/projects/${first.body.data.id}`)));
  check('trial: an archived project frees its place — the next project is accepted', '201', answer(await newProject(c.pm, 'Trial after archive')));

  // the only way to create a project is POST /projects
  check('there is no project import route (POST /projects/import)', '404 NOT_FOUND', answer(await c.pm.send('POST', '/projects/import', { name: 'Imported' })));
  check('there is no project duplicate route (POST /projects/:id/duplicate)', '404 NOT_FOUND', answer(await c.pm.send('POST', `/projects/${first.body.data.id}/duplicate`, {})));
  check('trial at its limit: naming a template in POST /projects does not get round the limit', '402 PROJECT_LIMIT_REACHED', answer(await newProject(c.pm, 'From a template', { templateId: crypto.randomUUID() })));

  // individual: 3
  await mustSubscribe(c, 'individual');
  await mustProject(c, 'Individual second');
  const third = await mustProject(c, 'Individual third');
  check('individual: with three live projects a fourth is refused', '402 PROJECT_LIMIT_REACHED', answer(await newProject(c.pm, 'Individual fourth')));

  // individual, concurrent creation at the limit: one place left, five requests at once
  must(await c.pm.send('DELETE', `/projects/${third}`), 200, 'archive a project');
  const atLimit = await Promise.all(Array.from({ length: 5 }, (_, i) => newProject(c.pm, `Individual burst ${i + 1}`)));
  finding('D17', 'individual with one place left: of five simultaneous creations exactly one is accepted', 1, atLimit.filter((r) => r.status === 201).length, `answers: ${atLimit.map(answer).join(', ')}; live projects now ${await liveProjects(c)} of 3`);

  // business: 25
  await mustSubscribe(c, 'business');
  for (let live = await liveProjects(c); live < 25; live += 1) await mustProject(c, `Business ${live + 1}`);
  check('business: with twenty-five live projects a twenty-sixth is refused', '402 PROJECT_LIMIT_REACHED', answer(await newProject(c.pm, 'Business twenty-sixth')));

  // enterprise: unlimited. STAGED — no route writes the enterprise plan (it is arranged by sales).
  await db.set(c.orgId, { plan: 'enterprise' });
  check('enterprise (STAGED plan): the twenty-sixth project is accepted', '201', answer(await newProject(c.pm, 'Enterprise twenty-sixth')));
  check('enterprise (STAGED plan): GET /billing/subscription shows no project or AI limit', { projectLimit: null, aiLimit: null }, (await billingRead(c.pm)).limits);
  check('enterprise (STAGED plan): a move down to business is refused', '400 DOWNGRADE_NOT_ALLOWED', answer(await subscribe(c.pm, 'business')));

  // trial, concurrent creation from zero
  const burst = await company('plans limits burst', 912);
  await startTrial(burst);
  const together = await Promise.all(Array.from({ length: 6 }, (_, i) => newProject(burst.pm, `Trial burst ${i + 1}`)));
  finding('D17', 'trial (one project): of six simultaneous creations exactly one is accepted', 1, together.filter((r) => r.status === 201).length, `answers: ${together.map(answer).join(', ')}; live projects now ${await liveProjects(burst)} of 1`);
};

// ═══════════════════════════════════════════════════════════════════════════
// 5  The AI allowance
// ═══════════════════════════════════════════════════════════════════════════
/**
 * A real BOQ upload that the allowance does not stop queues a job that sends the workbook to the AI provider, and
 * AI schedule generation calls it too. Neither request is sent unless the /assistant/status probe in main() says no
 * AI provider is configured on this API (assistantOff) — even the ones expected to be refused, since a regression in
 * the gate would make them real calls. A dry run queues no job (routes/boq.js) and is always sent.
 *
 * The success answer of a real upload is 200: routes/boq.js answers it with sendSuccess(res, …), whose default
 * status is 200 (utils/api-response.js). "Not refused for the allowance" means exactly that answer.
 */
const BOQ_UPLOAD_ACCEPTED = '200';
const aiAllowance = async (assistantOff) => {
  section('5  the AI allowance');
  const c = await company('plans ai', 917);
  await startTrial(c);
  await mustSubscribe(c, 'individual');
  const projectId = await mustProject(c, 'AI allowance project');
  const workbook = await c.pm.download(`/projects/${projectId}/boq/template`);
  const uploadBoq = (query = '') => sendFile(c.pm, `/projects/${projectId}/boq/upload${query}`, 'boq-template.xlsx', workbook, XLSX);
  const skipped = (what) => console.log(`SKIP  ${what} — not sent: an AI provider is configured on this API, and a request the allowance does not stop would call it`);

  // STAGED: the counter moves only after a real AI provider has answered, and none is configured here.
  await db.set(c.orgId, { aiGenerationsUsed: 10 });
  if (assistantOff) {
    const full = await uploadBoq();
    check('individual with 10 of 10 AI generations used (STAGED counter): a BOQ upload is refused', '402 AI_LIMIT_REACHED', answer(full));
    seen402.AI_LIMIT_REACHED = full.body?.error;
  } else skipped('individual with 10 of 10 AI generations used: a real BOQ upload is refused');
  check('a dry-run BOQ upload spends no allowance and is still answered at the limit', '200', answer(await uploadBoq('?dryRun=true')));
  if (assistantOff) finding('D17', 'at the limit, AI schedule generation is refused too (it is an AI generation)', '402 AI_LIMIT_REACHED', answer(await sendFile(c.pm, `/projects/${projectId}/schedule/generate`, 'schedule-source.csv', Buffer.from('code,name\nA1,Excavation\n'), 'text/csv')));
  else skipped('[D17] at the limit, AI schedule generation is refused too');

  // renewal
  const beforeRenewal = await row(c);
  await invoicePaid(beforeRenewal);
  const renewed = await row(c);
  check('a renewal (event: invoice.paid for the next period) moves the period end forward', true, renewed.currentPeriodEnd > beforeRenewal.currentPeriodEnd);
  if (assistantOff) {
    const afterRenewal = await uploadBoq();
    finding(
      'D7',
      `a renewal (event: invoice.paid for the next period) gives the company a fresh AI allowance: the BOQ upload is accepted (${BOQ_UPLOAD_ACCEPTED})`,
      BOQ_UPLOAD_ACCEPTED,
      answer(afterRenewal),
      `counter after the renewal: ${renewed.aiGenerationsUsed} of 10 — it is reset only by subscribe and trial/confirm; periodResetAt is written and never read`
    );
  } else skipped('[D7] after a renewal the BOQ upload is accepted');

  // subscribing again to the plan already held
  await db.set(c.orgId, { aiGenerationsUsed: 10 });
  const sameAgain = await subscribe(c.pm, 'individual', 'monthly');
  finding('D8', 'subscribing again to the plan and cycle already held does not hand back a used-up AI allowance', 10, (await row(c)).aiGenerationsUsed, `the request answered ${answer(sameAgain)}`);

  await db.set(c.orgId, { aiGenerationsUsed: 9 });
  if (assistantOff) {
    const underLimit = await uploadBoq();
    check(`with one generation left (STAGED counter) the BOQ upload is accepted (${BOQ_UPLOAD_ACCEPTED})`, BOQ_UPLOAD_ACCEPTED, answer(underLimit));
  } else skipped('with one generation left the BOQ upload is accepted');
};

// ═══════════════════════════════════════════════════════════════════════════
// 6  Seats
// ═══════════════════════════════════════════════════════════════════════════
/**
 * A seat refusal. The product has no seat error code yet (utils/error-codes.js names none), so only a 402 or a 403
 * whose code names seats or a limit counts as one. Anything else — an acceptance, a 402 SUBSCRIPTION_REQUIRED, a
 * validation error, a 409 — is "not a seat refusal", and the case's note gives the exact status and code seen.
 */
const seatRefusal = (res) => ([402, 403].includes(res.status) && /SEAT|LIMIT/i.test(String(res.body?.error?.code || '')) ? 'refused' : 'not a seat refusal');

const seats = async () => {
  section('6  seats');
  // eslint-disable-next-line global-require
  const { PLANS } = require(path.join(BACKEND, 'src', 'config', 'plans.js'));
  const c = await company('plans seats', 913);
  await startTrial(c);
  await mustSubscribe(c, 'individual');
  let plan = 'individual';
  let members = 1; // the owner
  /** Members asked for, four at a time, until the company holds `target`. Returns what was asked and answered. */
  const grow = async (target) => {
    const missing = Math.max(0, target - members);
    const answers = await api.pool(Array.from({ length: missing }), 4, async () => addMember(c, 'site_engineer', 'seat'));
    const accepted = answers.filter((res) => res.status === 201).length;
    members += accepted;
    return { asked: missing, accepted, others: [...new Set(answers.filter((res) => res.status !== 201).map(answer))] };
  };

  check('individual: the subscription row starts with one seat', 1, (await row(c)).seats);
  check('individual: GET /billing/subscription reports one seat', 1, (await billingRead(c.pm)).seats);

  // Two seat numbers exist: the catalogue's per plan (config/plans.js: individual 1, business 10) and the one on the
  // subscription row (no route writes it; staged here). Members up to the LOWER of the two are ordinary set-up; a
  // member beyond the HIGHER of the two is beyond every seat number, so its refusal is D9 whichever number governs.
  // Members in between depend on which number governs — a policy the owner has not decided: reported, not judged.
  let judgedAt = null;
  for (const seatCount of [1, 2, 5, 10, 25, 50, 100]) {
    if (seatCount === 10) {
      // Business is the plan whose catalogue says ten seats. A seat number sent by the client is not a thing the route knows.
      const mark = Date.now();
      const held = await row(c);
      must(await subscribe(c.pm, 'business', 'monthly', { seats: 10, quantity: 10 }), 200, 'upgrade to business');
      await ownIds(c, OWN_IDS);
      plan = 'business';
      const calls = await providerCalls(mark, [held.stripeCustomerId, held.stripeSubscriptionId]);
      check('upgrading to business with "seats: 10" in the body: the row keeps the number it had — no billing route writes seats', held.seats, (await row(c)).seats);
      check('and the provider is never told a quantity (seats are not billed per seat)', false, calls.some((call) => /quantity/.test(JSON.stringify(call.body))));
    }
    // STAGED from 2 upward, and BEFORE the members are added: no route writes Subscription.seats (the row is born
    // with 1), and a product that enforces seats must hold the number before it is asked for the members.
    if (seatCount > 1) await db.set(c.orgId, { seats: seatCount });
    const staged = seatCount > 1 ? ' (STAGED seats)' : '';
    const catalogue = PLANS[plan].seats;
    const low = Math.min(seatCount, catalogue);
    const high = Math.max(seatCount, catalogue);
    check(`${seatCount} seat(s)${staged} on ${plan}: GET /billing/subscription reports ${seatCount}`, seatCount, (await billingRead(c.pm)).seats);

    const ordinary = await grow(low);
    if (ordinary.accepted !== ordinary.asked) throw new Error(`setup: adding members up to ${low} (within both the row's ${seatCount} and the catalogue's ${catalogue} seats on ${plan}) was refused: ${ordinary.others.join(', ')}`);
    if (high > low) {
      const from = members + 1;
      const between = await grow(high);
      if (between.asked > 0) {
        ownerDecision(
          'D9',
          `${plan} with ${seatCount} seat(s) on the row${staged} and ${catalogue} in the catalogue: which number governs? Members ${from}–${high} (beyond the lower number, within the higher) were asked for (POST /users)`,
          between.accepted === between.asked ? `all ${between.asked} accepted — the higher number governs, or no seat limit is enforced at all (D9)` : `${between.accepted} of ${between.asked} accepted; the others answered ${between.others.join(', ')}`
        );
      }
    }

    if (members >= high) {
      judgedAt = high;
      const extra = await addMember(c, 'site_engineer', 'seat');
      finding('D9', `${seatCount} seat(s)${staged} on ${plan} (catalogue ${catalogue}), ${members} member(s): one more member — beyond every seat number — is refused (POST /users)`, 'refused', seatRefusal(extra), `answered ${answer(extra)}`);
      if (extra.status === 201) members += 1;
    } else {
      console.log(`NOT JUDGED  [D9] ${seatCount} seat(s)${staged} on ${plan}: the product refused members below ${high}, so no member beyond every seat number could be asked for (see the owner decision above)`);
    }
    if (seatCount === 1) {
      const seatsNow = (await row(c)).seats;
      finding('D9', 'nothing staged yet: the company does not hold more members than its subscription has seats', true, members <= seatsNow, `${members} members, ${seatsNow} seat(s) on the row — no route moved the number`);
    }
  }

  // The invitation is beyond every seat number only if the members reached the last (highest) one.
  const lastHigh = Math.max(100, PLANS[plan].seats);
  if (judgedAt === lastHigh && members >= lastHigh) {
    const invited = await c.pm.send('POST', '/users/invitations', { email: `invited.${hex(5)}@billing.octapm-cert.test`, role: 'site_engineer' });
    finding('D9', `100 seats (STAGED) on ${plan}, ${members} members: an invitation for one more — beyond every seat number — is refused (POST /users/invitations)`, 'refused', seatRefusal(invited), `answered ${answer(invited)}`);
  } else {
    console.log(`NOT JUDGED  [D9] an invitation beyond 100 seats: the company holds ${members} members, below ${lastHigh}, so an invitation is not beyond every seat number`);
  }
  const counted = await (await db.prisma()).organizationMembership.count({ where: { orgId: c.orgId, kind: 'member', status: { not: 'left' } } });
  check('the company really holds that many members (membership rows that are not "left")', members, counted);

  // The one member-count rule the product does have: a personal workspace holds one member, whatever its plan.
  must(await c.personal.send('POST', '/billing/trial/start', {}), 200, 'personal workspace trial/start');
  must(await c.personal.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_personal_${hex(3)}` }), 200, 'personal workspace trial/confirm');
  check(
    'a personal workspace refuses a second member (the only member-count rule enforced; it is not a seat rule)',
    '409 PERSONAL_WORKSPACE_CONVERT_REQUIRED',
    // No password field: under D-ID-1 one is refused 400 USER_PASSWORD_NOT_ACCEPTED before the workspace is judged.
    answer(await c.personal.send('POST', '/users', { name: 'Cert second person', email: `second.${hex(5)}@billing.octapm-cert.test`, role: 'site_engineer' }))
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 7  Upgrade, downgrade, cancel, reactivate, expiry, re-subscribe
// ═══════════════════════════════════════════════════════════════════════════
const lifecycle = async () => {
  section('7  upgrade, downgrade, cancel, reactivate, expiry, re-subscribe');
  const mark = Date.now();
  const c = await company('plans lifecycle', 914);
  await startTrial(c);
  await mustSubscribe(c, 'individual');
  const projectId = await mustProject(c, 'Lifecycle project');
  const first = await row(c);
  const ids = [first.stripeCustomerId, first.stripeSubscriptionId];
  const creations = async () => (await providerCalls(mark, ids)).filter((call) => call.method === 'POST' && call.path === '/v1/subscriptions').length;
  const lastUpdate = async () => (await providerCalls(mark, ids)).filter((call) => call.method === 'POST' && call.path === `/v1/subscriptions/${first.stripeSubscriptionId}`).pop()?.body || {};

  // upgrade
  check('upgrade individual → business is answered 200', '200', answer(await subscribe(c.pm, 'business')));
  const upgraded = await row(c);
  check('after the upgrade the company is active on business', ['business', 'active'], [upgraded.plan, upgraded.status]);
  check('the upgrade changed the provider subscription in place — same subscription, no second one created', [first.stripeSubscriptionId, 1], [upgraded.stripeSubscriptionId, await creations()]);
  const upgradeCall = await lastUpdate();
  check('the provider was asked for the business price, invoiced at once (proration)', [String(process.env.CERT_STRIPE_PRICE_BUSINESS_MONTHLY).trim(), 'always_invoice'], [String(upgradeCall.items?.['0']?.price).trim(), upgradeCall.proration_behavior]);

  // downgrade while active
  check('downgrade business → individual while active is refused', '400 DOWNGRADE_NOT_ALLOWED', answer(await subscribe(c.pm, 'individual')));
  check('and the company is still on business', 'business', (await row(c)).plan);
  check('a change of billing cycle on the same plan (monthly → annual) is accepted', '200', answer(await subscribe(c.pm, 'business', 'annual')));

  // cancel
  check('cancel is answered 200', '200', answer(await c.pm.send('POST', '/billing/cancel', {})));
  const cancelled = await row(c);
  check('after cancel the row is cancelled, to end at the period end, with the day it was asked', ['canceled', true, true], [cancelled.status, cancelled.cancelAtPeriodEnd, cancelled.canceledAt instanceof Date]);
  check('the provider was told to cancel at the period end', 'true', (await lastUpdate()).cancel_at_period_end);
  check('a cancelled company keeps working until its period ends', '200', answer(await c.pm.send('PATCH', `/projects/${projectId}`, { location: 'Still paid for' })));

  // reactivate before the period ends
  check('reactivating before the period ends (subscribe to the same plan) is answered 200', '200', answer(await subscribe(c.pm, 'business', 'annual')));
  const reactivated = await row(c);
  check('after reactivation the row is active and the cancellation is gone', ['active', false, null], [reactivated.status, reactivated.cancelAtPeriodEnd, reactivated.canceledAt]);
  check('reactivation withdrew the cancellation on the same provider subscription — still only one ever created', ['false', first.stripeSubscriptionId, 1], [(await lastUpdate()).cancel_at_period_end, reactivated.stripeSubscriptionId, await creations()]);

  // cancel again and let the period end. A second company in the same state stands by, to show the job touches only what it is given.
  must(await c.pm.send('POST', '/billing/cancel', {}), 200, 'cancel again');
  const bystander = await company('plans lifecycle bystander', 914);
  await startTrial(bystander);
  await mustSubscribe(bystander, 'business');
  must(await bystander.pm.send('POST', '/billing/cancel', {}), 200, 'bystander cancel');
  const hourAgo = new Date(Date.now() - 3_600_000);
  await db.set(c.orgId, { currentPeriodEnd: hourAgo }); // STAGED: no route moves time
  await db.set(bystander.orgId, { currentPeriodEnd: hourAgo });

  check('cancelled and the period is over (STAGED period end): a write is refused at once, before any job has run', REFUSED, answer(await c.pm.send('PATCH', `/projects/${projectId}`, { location: 'No longer paid for' })));
  await billingJob([c]);
  check('the daily billing check (job) marks it expired', 'expired', (await row(c)).status);
  check('the job, run for one company, left the other company in the same state untouched', 'canceled', (await row(bystander)).status);
  await billingJob([bystander]);
  check('and expires that one when it is its turn', 'expired', (await row(bystander)).status);
  check('an expired company can still read its projects', '200', answer(await c.pm.send('GET', '/projects')));
  check('an expired company cannot write', REFUSED, answer(await c.pm.send('PATCH', `/projects/${projectId}`, { location: 'Expired' })));

  // re-subscribe after expiry
  await providerSays(first.stripeSubscriptionId, 'canceled'); // what Stripe says once a cancelled period has ended
  check('re-subscribing after expiry is answered 200', '200', answer(await subscribe(c.pm, 'business', 'monthly')));
  const back = await row(c);
  ids.push(back.stripeSubscriptionId);
  check('the company is active on business again', ['business', 'active', false], [back.plan, back.status, back.cancelAtPeriodEnd]);
  check('on a NEW provider subscription — the ended one is not revived', [true, 2], [back.stripeSubscriptionId !== first.stripeSubscriptionId, await creations()]);
  check('and it can write again', '200', answer(await c.pm.send('PATCH', `/projects/${projectId}`, { location: 'Paid for again' })));

  // the no-downgrade rule, after a cancel
  const d = await company('plans downgrade', 914);
  await startTrial(d);
  await mustSubscribe(d, 'business');
  for (let i = 0; i < 5; i += 1) await mustProject(d, `Downgrade ${i + 1}`);
  must(await d.pm.send('POST', '/billing/cancel', {}), 200, 'cancel before a downgrade');
  finding('D11', 'the no-downgrade rule holds after a cancel: business (cancelled, period running) → individual is refused', '400 DOWNGRADE_NOT_ALLOWED', answer(await subscribe(d.pm, 'individual')));
  const down = await row(d);
  finding('D11', 'a company never holds more live projects than its plan allows after a plan change', true, (await liveProjects(d)) <= (down.plan === 'individual' ? 3 : 25), `plan ${down.plan}/${down.status}, live projects ${await liveProjects(d)}`);
};

// ═══════════════════════════════════════════════════════════════════════════
// 8  A subscription that nothing ends
// ═══════════════════════════════════════════════════════════════════════════
const neverEnds = async () => {
  section('8  a paid period that ended long ago');
  const c = await company('plans never ends', 918);
  await startTrial(c);
  await mustSubscribe(c, 'business');
  // STAGED: the period ended two years ago and no provider event ever arrived (a lost webhook, a wrong secret).
  await db.set(c.orgId, { currentPeriodEnd: new Date(Date.now() - 730 * DAY) });
  await billingJob([c]);
  finding('D5', 'active, period ended two years ago (STAGED), no renewal ever recorded, the daily billing check has run: the company no longer reads as having access', false, (await billingRead(c.pm)).hasAccess, `row status ${(await row(c)).status}`);
  finding('D5', 'active, period ended two years ago (STAGED): the company can no longer create a project', REFUSED, answer(await newProject(c.pm, 'Two years unpaid')));

  // STAGED: active again, immediately before the failed payment. Whatever the job above did to the row (once D5 is
  // fixed it ends it), a failed payment demotes only an active company (services/stripe-webhook.service.js), so
  // the past-due case below must not depend on D5 still being there. The status is read before the job runs again
  // for the same reason.
  await db.set(c.orgId, { status: 'active', currentPeriodEnd: new Date(Date.now() - 730 * DAY) });
  await paymentFailed(await row(c));
  check('a failed payment (event) puts the active company past due', 'past_due', (await row(c)).status);
  await db.set(c.orgId, { currentPeriodEnd: new Date(Date.now() - 730 * DAY) });
  await billingJob([c]);
  finding('D5', 'past due, period ended two years ago (STAGED), the daily billing check has run: the company can no longer create a project', REFUSED, answer(await newProject(c.pm, 'Two years past due')), `row status ${(await row(c)).status}`);
};

// ═══════════════════════════════════════════════════════════════════════════
// 9  The trial
// ═══════════════════════════════════════════════════════════════════════════
const trial = async () => {
  section('9  the trial: lapse, restart, a second company');
  const c = await company('plans trial', 915);
  const card = await startTrial(c);
  const started = await row(c);
  check('a confirmed trial runs seven days', 7, Math.round((started.trialEndsAt - started.trialStartsAt) / DAY));
  check('the trial needed no provider subscription — nothing is billed during it', null, started.stripeSubscriptionId);

  await db.set(c.orgId, { trialEndsAt: new Date(Date.now() - 3_600_000), aiGenerationsUsed: 3 }); // STAGED: no route moves time or the AI counter
  finding('D27', 'a trial whose end has passed (STAGED end) reads as expired, not as a trial still "trialing"', 'expired', (await billingRead(c.pm)).status, 'hasAccess is already false; only the label waits for the daily job');
  check('a trial whose end has passed cannot be started again while the row still says trialing', '409 TRIAL_NOT_AVAILABLE', answer(await c.pm.send('POST', '/billing/trial/start', {})));
  await billingJob([c]);
  check('the daily billing check (job) marks the lapsed trial expired', 'expired', (await row(c)).status);

  finding('D6', 'a company whose trial has expired cannot start a second trial', '409 TRIAL_NOT_AVAILABLE', answer(await c.pm.send('POST', '/billing/trial/start', {})));
  const again = await c.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: card });
  const second = await row(c);
  finding('D6', 'confirming a second trial is refused and the company stays expired', ['409 TRIAL_NOT_AVAILABLE', 'expired'], [answer(again), second.status], second.status === 'trialing' ? `granted until ${second.trialEndsAt.toISOString().slice(0, 10)}` : '');
  finding('D6', 'a second trial does not hand back a used-up AI allowance', 3, second.aiGenerationsUsed);

  if (second.status === 'trialing') {
    await db.set(c.orgId, { trialEndsAt: new Date(Date.now() - 3_600_000) });
    await billingJob([c]);
  }
  const third = await c.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: card });
  finding('D6', 'nor a third — a trial is not free use for ever', ['409 TRIAL_NOT_AVAILABLE', 'expired'], [answer(third), (await row(c)).status]);

  // The same person, another company.
  const name = `CERT 915 second company ${hex(4)} (CERT-915)`;
  const opened = must(await c.pm.send('POST', '/organisations', { name, currency: 'USD', timezone: 'America/Chicago' }), 201, 'open a second company');
  const secondOrgId = opened.organisation?.id || opened.workspace?.id || opened.id;
  mine.set(secondOrgId, { orgId: secondOrgId });
  api.forget(c.email);
  const other = api.as(c.email, secondOrgId);
  finding('D6', 'the same person, having used a trial, does not get a fresh trial by opening another company', '409 TRIAL_NOT_AVAILABLE', answer(await other.send('POST', '/billing/trial/start', {})));
};

// ═══════════════════════════════════════════════════════════════════════════
// 10  Payment recovery and a declined card
// ═══════════════════════════════════════════════════════════════════════════
const recovery = async () => {
  section('10  payment recovery and a declined card');
  const c = await company('plans recovery', 915);
  await startTrial(c);
  await mustSubscribe(c, 'business');
  const projectId = await mustProject(c, 'Recovery project');
  const paying = await row(c);

  await paymentFailed(paying);
  check('a failed payment (event: invoice.payment_failed) puts the company past due', 'past_due', (await row(c)).status);
  const history = (await c.pm.send('GET', '/billing/transactions')).body?.data || [];
  check('and records one failed invoice in the billing history', ['failed'], history.map((invoice) => invoice.status));
  check('a past-due company keeps working (a grace, while the provider retries)', '200', answer(await c.pm.send('PATCH', `/projects/${projectId}`, { location: 'Past due' })));

  // Is there any route that lets it enter a new card? trial/start is the only one that issues a card-setup secret today.
  const cardRoutes = ['/billing/payment-method/setup', '/billing/payment-method', '/billing/setup-intent', '/billing/portal', '/billing/trial/start'];
  const offered = [];
  for (const route of cardRoutes) if ((await c.pm.send('POST', route, {})).status === 200) offered.push(route);
  finding('D14', 'a past-due company has a route that lets it enter a new card (a card-setup secret or a billing portal)', true, offered.length > 0, `tried POST ${cardRoutes.join(', ')}`);

  // The only path there is: subscribe again, naming a card the client tokenised by itself.
  await providerSays(paying.stripeSubscriptionId, 'past_due'); // the provider still has an unpaid invoice
  const mark = Date.now();
  const again = await subscribe(c.pm, 'business', 'monthly', { paymentMethodId: `pm_card_recovery_${hex(3)}` });
  const calls = await providerCalls(mark, [paying.stripeCustomerId, paying.stripeSubscriptionId]);
  finding(
    'D12',
    'subscribing again with another card while the provider still says past_due does not record the company as active (nothing was collected)',
    'past_due',
    (await row(c)).status,
    `the request answered ${answer(again)}; provider calls made: ${calls.map((call) => `${call.method} ${call.path.replace(/\/(cus|sub|pm)_[^/]+/g, '/$1_…')}`).join(' | ')}`
  );

  // The payment must be judged on a company that IS past due when it arrives: an event the webhook ignored
  // (an ambiguous customer id, say) would otherwise leave the row as D12 above left it — active — and the case
  // would pass on nothing. So the status just before the payment is part of what the case compares.
  await paymentFailed(await row(c));
  const beforePayment = (await row(c)).status;
  await invoicePaid(await row(c), { startInDays: 0, endInDays: 30 });
  await providerSays(paying.stripeSubscriptionId, 'active');
  check('the provider collecting the payment (event: invoice.paid) is what restores a past-due company to active: past due just before it, active after', ['past_due', 'active'], [beforePayment, (await row(c)).status]);

  // an upgrade the provider could not collect
  const u = await company('plans upgrade unpaid', 915);
  await startTrial(u);
  await mustSubscribe(u, 'individual');
  await providerSays((await row(u)).stripeSubscriptionId, 'past_due'); // Stripe changes the price and leaves the subscription past_due when the proration charge fails
  const upgrade = await subscribe(u.pm, 'business');
  const unpaid = await row(u);
  finding('D12', 'an upgrade whose charge the provider could not collect (it answers past_due) is not recorded as active on the higher plan', false, unpaid.plan === 'business' && unpaid.status === 'active', `the request answered ${answer(upgrade)}; row now ${unpaid.plan}/${unpaid.status}`);

  // a declined card
  const x = await company('plans declined', 915);
  const good = await startTrial(x);
  const declined = await subscribe(x.pm, 'business', 'monthly', { paymentMethodId: `pm_declined_${hex(3)}` });
  check('a declined card on the first purchase is answered 402 CARD_DECLINED', '402 CARD_DECLINED', answer(declined));
  seen402.CARD_DECLINED = declined.body?.error;
  const afterDecline = await row(x);
  check('after the decline the company is still in its trial — no plan was granted', ['trial', 'trialing', null], [afterDecline.plan, afterDecline.status, afterDecline.stripeSubscriptionId]);
  finding('D28', 'after the decline the card on file is still the good card the company had', [good], afterDecline.paymentMethods.map((method) => method.stripePaymentMethodId));
  const retry = await subscribe(x.pm, 'business', 'monthly', { paymentMethodId: `pm_card_second_${hex(3)}` });
  finding('D13', 'after the decline the same plan can be bought with another card', '200', answer(retry), 'the provider idempotency key (subscribe:<row>:<plan>:<cycle>:first) is the same for both attempts while the card differs');

  // a declined card on an upgrade
  // Real Stripe does not refuse this request: the upgrade is an in-place subscriptions.update with no
  // payment_behavior, so Stripe changes the price, fails to collect the proration invoice and leaves the
  // subscription past_due (map D12). The fake instead answers 402 card_error to an update naming a pm_declined
  // card, so the answer here certifies the fake, not the product, and is only reported. What holds with either
  // provider is the D12 rule: an upgrade whose charge was declined is not recorded as active on the higher plan.
  const y = await company('plans declined upgrade', 915);
  await startTrial(y);
  await mustSubscribe(y, 'individual');
  const declinedUpgrade = await subscribe(y.pm, 'business', 'monthly', { paymentMethodId: `pm_declined_${hex(3)}` });
  const kept = await row(y);
  finding(
    'D12',
    'an upgrade whose card was declined is not recorded as active on the higher plan',
    false,
    kept.plan === 'business' && kept.status === 'active',
    `the request answered ${answer(declinedUpgrade)} (the fake's 402; real Stripe accepts the update and leaves the subscription past_due); row now ${kept.plan}/${kept.status}`
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 11  Who may bill
// ═══════════════════════════════════════════════════════════════════════════
const whoMayBill = async () => {
  section('11  who may bill');
  const c = await company('plans roles', 916);
  await startTrial(c);
  await mustSubscribe(c, 'business');
  const secondPm = await mustMember(c, 'pm', 'pm');
  const admin = await mustMember(c, 'site_engineer', 'admin');
  must(await c.pm.send('PATCH', `/users/${admin.id}`, { isCompanyAdmin: true }), 200, 'make a company administrator');
  const coOwner = await mustMember(c, 'qs', 'owner');
  must(await c.pm.send('PATCH', `/users/${coOwner.id}`, { isOwner: true }), 200, 'make a second owner');
  const finance = await mustMember(c, 'finance', 'finance');
  const site = await mustMember(c, 'site_engineer', 'site');

  // Who holds billing authority — the workspace role pm (what the product does: requireRoles('pm') on every billing
  // change, requireRoles('pm', 'finance') on the invoices) or ownership / company administration — is a policy the
  // owner has not decided (D15). Every case whose answer differs between those two rules is an owner decision:
  // reported, not judged. A site engineer, finance member or API key that is neither pm, owner nor administrator
  // gets the same answer under either rule, so those stay cases.
  const authority = (res) => (res.status >= 200 && res.status < 300 ? `allowed — answered ${answer(res)}` : `refused — answered ${answer(res)}`);

  // reading
  check('a site engineer can read whether the company has access (the app needs it to explain a refusal)', true, (await billingRead(site.session)).hasAccess);
  finding('D15', 'a site engineer (neither pm, finance, owner nor administrator) is not shown the company card (brand, last four, expiry)', null, (await billingRead(site.session)).paymentMethod ?? null);
  check('a site engineer cannot read the invoices', '403 FORBIDDEN', answer(await site.session.send('GET', '/billing/transactions')));
  check('a finance user can read the invoices', '200', answer(await finance.session.send('GET', '/billing/transactions')));
  ownerDecision('D15', 'may an owner who is not a project manager read the company invoices (GET /billing/transactions)?', authority(await coOwner.session.send('GET', '/billing/transactions')));

  // an API key with an unrelated scope
  const key = must(await c.pm.send('POST', '/integrations/api-clients', { name: `Inventory reader ${hex(2)}`, scopes: ['inventory:read'] }), 201, 'mint an inventory-only API key').token;
  finding('D15', 'an API key scoped to inventory only cannot read the subscription and the card on file', '403 API_KEY_SCOPE', answer(await api.raw('GET', '/billing/subscription', { token: key })));
  check('an API key scoped to inventory only cannot read the invoices', '403 API_KEY_SCOPE', answer(await api.raw('GET', '/billing/transactions', { token: key })));
  check('an API key scoped to inventory only cannot cancel', '403 API_KEY_SCOPE', answer(await api.raw('POST', '/billing/cancel', { token: key, json: {} })));

  // changing
  check('a finance user cannot cancel', '403 FORBIDDEN', answer(await finance.session.send('POST', '/billing/cancel', {})));
  check('a finance user cannot subscribe', '403 FORBIDDEN', answer(await subscribe(finance.session, 'business')));
  check('a site engineer cannot cancel', '403 FORBIDDEN', answer(await site.session.send('POST', '/billing/cancel', {})));
  ownerDecision('D15', 'may a project manager who is neither owner nor company administrator cancel the company subscription (POST /billing/cancel)?', authority(await secondPm.session.send('POST', '/billing/cancel', {})));
  const afterPm = await row(c);
  if (afterPm.status === 'active') must(await c.pm.send('POST', '/billing/cancel', {}), 200, 'owner cancel (so the next cases have something to undo)');
  ownerDecision('D15', 'may an owner who is not a project manager undo that cancellation (POST /billing/subscribe)?', authority(await subscribe(coOwner.session, 'business')));
  ownerDecision('D15', 'may a company administrator who is not a project manager undo it (POST /billing/subscribe)?', authority(await subscribe(admin.session, 'business')));
  check('the owner who is a project manager can (pm and owner: allowed under either rule)', '200', answer(await subscribe(c.pm, 'business')));
  check('and the company ends active on business', ['business', 'active'], [(await row(c)).plan, (await row(c)).status]);

  // the billing limiter
  // Two refused writes (an invalid plan stops at validation, after the limiter) with one read between them.
  const before = await subscribe(c.pm, 'not-a-plan');
  await c.pm.send('GET', '/billing/subscription');
  const after = await subscribe(c.pm, 'not-a-plan');
  finding(
    'D18',
    'reading the subscription does not spend the hourly allowance that subscribe and cancel need',
    Number(before.headers.get('ratelimit-remaining')) - 1,
    Number(after.headers.get('ratelimit-remaining')),
    `one bucket per user for reads and writes; the product default is 60 an hour (this API runs with ${before.headers.get('ratelimit-limit')}, so the 429 itself is not driven here)`
  );

  // enterprise requests
  check('an enterprise request is recorded (201)', '201', answer(await c.pm.send('POST', '/billing/enterprise-lead', { seatsBand: 'lte_100' })));
  await c.pm.send('POST', '/billing/enterprise-lead', { seatsBand: 'lte_100' });
  finding('D16', 'the same enterprise request sent twice is one open request, not two', 1, await (await db.prisma()).enterpriseLead.count({ where: { orgId: c.orgId } }), 'nothing reads the table and nobody is told');
  check('an enterprise request changes nothing about the subscription', ['business', 'active'], [(await row(c)).plan, (await row(c)).status]);
};

// ═══════════════════════════════════════════════════════════════════════════
// 12  Billing mail, and the mobile app's reading of a 402
// ═══════════════════════════════════════════════════════════════════════════
const mailAndMobile = async (assistantOff) => {
  section('12  billing mail, and how the mobile app reads a 402');
  const c = await company('plans mail', 918);
  await startTrial(c);
  const trialing = await row(c);
  await product();

  mail.length = 0;
  await billingJob([c], new Date(trialing.trialEndsAt.getTime() - 36 * 3_600_000));
  check('two days before a trial ends the reminder goes to the company owner', [c.email], mail.map((message) => message.to));
  await billingJob([c], new Date(trialing.trialEndsAt.getTime() - 35 * 3_600_000));
  check('and is sent once, however often the job runs', 1, mail.length);

  // STAGED: the product refuses to remove a last owner (LAST_OWNER), so a company with no owner and
  // no project manager exists only after a restore or a manual repair.
  const client = await db.prisma();
  await client.organizationMembership.updateMany({ where: { orgId: c.orgId }, data: { isOwner: false, isAdmin: false, role: 'site_engineer' } });
  await client.user.updateMany({ where: { orgId: c.orgId }, data: { role: 'site_engineer' } });
  mail.length = 0;
  await billingJob([c], new Date(trialing.trialEndsAt.getTime() - 12 * 3_600_000));
  finding('D26', 'a company with no owner and no project manager (STAGED): no billing mail is sent to a made-up address', [], mail.map((message) => message.to).filter((to) => !to.endsWith('.octapm-cert.test')));

  // The mobile app's own error module, run as it is written (Node strips the types).
  let mobile = null;
  try {
    // eslint-disable-next-line global-require
    mobile = require(MOBILE_ERRORS);
  } catch (failure) {
    check('the mobile error module (mobile/src/api/errors.ts) can be loaded by this Node', true, false, String(failure.message).slice(0, 200));
  }
  if (mobile) {
    const told = (code) => {
      const body = seen402[code];
      if (!body) return `(the server never answered 402 ${code} in this run)`;
      return /subscription has ended/i.test(String(mobile.fromStatus(402, body).userMessage)) ? 'told: the subscription has ended' : 'told something else';
    };
    finding('D25', 'mobile: a company at its project limit (402 PROJECT_LIMIT_REACHED) is not told its subscription has ended', 'told something else', told('PROJECT_LIMIT_REACHED'));
    if (assistantOff || seen402.AI_LIMIT_REACHED) finding('D25', 'mobile: a company at its AI limit (402 AI_LIMIT_REACHED) is not told its subscription has ended', 'told something else', told('AI_LIMIT_REACHED'));
    else console.log('SKIP  [D25] mobile: a company at its AI limit (402 AI_LIMIT_REACHED) — section 5 sent no BOQ upload (an AI provider is configured), so the server was never asked for that 402');
    finding('D25', 'mobile: a declined card (402 CARD_DECLINED) is not reported as an ended subscription', 'told something else', told('CARD_DECLINED'));
    check('mobile: a real 402 SUBSCRIPTION_REQUIRED is told as an ended subscription', true, /subscription has ended/i.test(String(mobile.fromStatus(402, { code: 'SUBSCRIPTION_REQUIRED', message: 'Your trial or subscription has ended. Subscribe to continue.' }).userMessage)));
  }
};

// ═══════════════════════════════════════════════════════════════════════════
const main = async () => {
  const probe = await company('plans probe', 919);
  // Nothing runs unless the fake is local, answers, and is the one the billing API's Stripe calls reach.
  await preflight(probe);
  const assistant = (await probe.pm.send('GET', '/assistant/status')).body?.data || {};
  const assistantOff = assistant.enabled === false;
  if (!assistantOff) console.log('NOTE  an AI provider is configured on this API: the assistant cases, the real BOQ uploads and the AI schedule generation are skipped so that no real provider is called.');

  await catalogue();
  await unknownPlan();
  await states(assistantOff);
  await projectLimits();
  await aiAllowance(assistantOff);
  await seats();
  await lifecycle();
  await neverEnds();
  await trial();
  await recovery();
  await whoMayBill();
  await mailAndMobile(assistantOff);

  console.log(`\ncompanies onboarded by this run: ${mine.size} (every one its own; no other company was written to)`);
};

const close = async () => {
  if (productSide) {
    productSide.catcher.close();
    await productSide.productDb.prisma.$disconnect().catch(() => {});
  }
};

main()
  .then(async () => {
    await close();
    await finish('billing — plans, states, limits and seats');
    reportOwnerDecisions('billing — plans, states, limits and seats');
  })
  .catch(async (error) => {
    console.error(error);
    await close();
    await finish('billing — plans, states, limits and seats (STOPPED by an error before the end)');
    reportOwnerDecisions('billing — plans, states, limits and seats');
    process.exitCode = 1;
  });
