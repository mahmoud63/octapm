'use strict';

/**
 * Billing certification — isolation between companies, and idempotency.
 *
 *   node scripts/cert/billing/suite-isolation-idempotency.js
 *
 * The question: can one company's billing call ever read or change another
 * company's billing, and does a repeated, parallel or half-failed billing call
 * leave the company's row in step with what the payment provider holds?
 *
 * Everything runs against the billing certification API (port 5191) and the
 * local Stripe fake (port 5390). No real provider is called; no real card
 * exists. The suite onboards its own companies (codes 930–939) through the
 * product's own doors and reads every other company only to prove it did not
 * move.
 *
 * Sections
 *   1. A, B, C        A's project manager sends B's identifiers in every field of every billing route
 *   2. Foreign card   a payment method the provider says belongs to another customer        (lead D19)
 *   3. Two companies  one person, member of two companies: the token decides who is billed
 *   4. Roles and keys who may read the card, plan and status; who may subscribe and cancel  (lead D15)
 *   5. Trial races    two trial/start and two trial/confirm at once                         (lead D21)
 *   6. Subscribe races  two subscribes at once; double cancel; subscribe against cancel
 *   7. Declined, then another card  the provider key that does not change with the attempt  (leads D13, D28)
 *   8. Provider failures  a failure in the middle, the retry, the upgrade whose payment failed (lead D12)
 *   9. The population  no company this suite did not onboard changed while it ran
 *
 * Before anything else the run proves (preflight in lib.js) that the Stripe
 * fake is local and answers, and that a probe company's trial/start leaves its
 * POST /v1/customers in that fake's log; otherwise nothing runs.
 *
 * A case written with finding('<id>', …) records a defect: it fails while the
 * defect exists and passes once it is fixed. Ids D… and A… are the leads of
 * the billing map (section 19 and 22); ISO-n are defects this suite found
 * itself — ISO-1, ISO-2, ISO-3 were called NEW-1, NEW-2, NEW-3 in earlier runs
 * (NEW-n now belongs to the webhook suite's checks only).
 *
 * Races are the exception to "fails while the defect exists": whether two
 * requests overlap is the machine's to decide. The race findings — D21 (two
 * trial/start), ISO-2 (two trial/confirm, two subscribes with two cards) and
 * A11 (subscribe against cancel), and the double cancel of section 6 — PASS
 * when the race was not reproduced in the attempts made (up to five fresh
 * companies per race, twelve rounds for A11, one for the double cancel). Each
 * says how many attempts it made; a pass there is not proof the race cannot
 * happen.
 *
 * A case written with ownerDecision('<id>', …) is a POLICY the product owner
 * has not decided — here, who holds billing authority (D15: the workspace role
 * pm, as the product does today, or ownership / company administration). It
 * is neither passed nor failed: what the product does is reported, and listed
 * again at the end under "owner decisions".
 *
 * The Stripe fake is shared with the other billing suites. Its "fail the next
 * call" switch is one slot for everybody, so a staged failure is always armed
 * so that only this suite's own call can consume it: on a path that names this
 * suite's own subscription, or — for a creation, whose path names nobody — on
 * this suite's own customer (failNext.customer: the fake lets a creation for
 * another customer pass by). The fake records the staged failure on the call
 * that consumed it, and each one is proven from the fake's log to have reached
 * this company's call before anything is concluded from it; another suite
 * re-arming the slot in between, or a fake not restarted since it learned to
 * match the customer, is caught the same way and stops the section.
 */

const crypto = require('crypto');
const fs = require('fs');
const { api, check, db, fake, fakeBase, finding, finish, onboard, ownerDecision, ownIds, preflight, reportOwnerDecisions, webhook } = require('./lib');
const { joinByInvitation } = require('../lib/invitations');

const SUITE = 'billing isolation and idempotency';
const RUN = crypto.randomBytes(3).toString('hex');
// Refused at once unless the fake is 127.0.0.1 or localhost (lib.js fakeBase).
const FAKE = fakeBase();
const STAGED = 'cert_staged_failure';
/** The billing API's log, where it writes every e-mail it would send ("[email:local] -> <to> | <subject>"). */
const BILLING_API_LOG = process.env.CERT_BILLING_API_LOG || 'C:/Temp/octapm-cert/logs/billing-api.log';
const OWN_IDS = { tag: 'cert93x' };

// ── small tools ────────────────────────────────────────────────────────────

/** Payment method ids are made up per run, so the fake's log can be read by id. */
const visa = (label) => `pm_card_visa_${label}_${RUN}`;
const amex = (label) => `pm_card_amex_${label}_${RUN}`;
const declined = (label) => `pm_declined_${label}_${RUN}`;
const foreignCard = (label) => `pm_foreign_${label}_${RUN}`;

const priceOf = (plan, cycle) => String(process.env[`CERT_STRIPE_PRICE_${plan.toUpperCase()}_${cycle.toUpperCase()}`] || '').trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const together = (...thunks) => Promise.all(thunks.map((thunk) => thunk()));
/** Opens two connections for a session, so that the two calls of a race leave at the same moment. */
const warm = (session) => together(() => session.send('GET', '/billing/plans'), () => session.send('GET', '/billing/plans'));
/**
 * Whether two requests overlap is the machine's to decide. `once(pair)` fires one pair on a fresh company and
 * returns what it saw; a pair that did not overlap (nothing learned) is fired again on another fresh company,
 * RACE_PAIRS times at most. The result is the last pair's, with `pairs` (how many were fired) and `all` (every
 * pair's result, in order) — an invariant that must hold in every pair is asserted over `all`, not the last one.
 */
const RACE_PAIRS = 5;
const raceOnFresh = async (once, reproduced) => {
  const all = [];
  do {
    all.push(await once(all.length + 1));
  } while (!reproduced(all[all.length - 1]) && all.length < RACE_PAIRS);
  return { ...all[all.length - 1], pairs: all.length, all };
};
const sorted = (list) => [...list].sort();
const unique = (list) => [...new Set(list)];
const errorCode = (res) => res.body?.error?.code || null;

/** Every company this run onboards (company and personal workspace): the only ones allowed to change. */
const mine = new Set();
/** The owners this run signed up — the only addresses this run's billing mail can go to. */
const myOwners = new Set();
const company = async (label, code) => {
  const made = await onboard(label, code);
  mine.add(made.orgId);
  if (made.personalOrgId) mine.add(made.personalOrgId);
  myOwners.add(made.email);
  return made;
};

const row = (co) => db.subscription(co.orgId);

/** Everything billing holds about one company, as one string: the row, its cards, its invoices, its enterprise leads. */
const print = async (orgId) => {
  const client = await db.prisma();
  const subscription = await client.subscription.findUnique({
    where: { orgId },
    include: { paymentMethods: { orderBy: { createdAt: 'asc' } }, invoices: { orderBy: { createdAt: 'asc' } } },
  });
  const leads = await client.enterpriseLead.count({ where: { orgId } });
  return JSON.stringify({ subscription, leads });
};

/** The same for every company in the database, with its name, to prove at the end that nothing else moved. */
const census = async () => {
  const client = await db.prisma();
  const subscriptions = await client.subscription.findMany({
    include: {
      paymentMethods: { orderBy: { createdAt: 'asc' } },
      invoices: { orderBy: { createdAt: 'asc' } },
      org: { select: { name: true, kind: true } },
    },
  });
  const leads = new Map((await client.enterpriseLead.groupBy({ by: ['orgId'], _count: true })).map((l) => [l.orgId, l._count]));
  return new Map(subscriptions.map(({ org, ...subscription }) => [subscription.orgId, { name: org?.name || '(no name)', print: JSON.stringify({ subscription, leads: leads.get(subscription.orgId) || 0 }) }]));
};

/** A setup step, not a case: a refusal here means the section cannot run. */
const must = (what, res, ...statuses) => {
  if (!statuses.includes(res.status)) throw new Error(`${what} answered ${res.status} ${errorCode(res) || ''} ${String(res.body?.error?.message || '').slice(0, 160)}`);
  return res;
};
const beginTrial = async (co, paymentMethodId) => {
  must('trial/start', await co.pm.send('POST', '/billing/trial/start', {}), 200);
  must('trial/confirm', await co.pm.send('POST', '/billing/trial/confirm', { paymentMethodId }), 200);
};
const subscribe = (session, plan, billingCycle, extra = {}) => session.send('POST', '/billing/subscribe', { plan, billingCycle, ...extra });
const cancel = (session) => session.send('POST', '/billing/cancel', {});

/** What the provider (the fake) holds for a subscription id, or null. Never called while a failure is staged. */
const providerSubscription = async (id) => {
  if (!id) return null;
  const res = await fetch(`${FAKE}/v1/subscriptions/${id}`);
  return res.status === 200 ? res.json() : null;
};
const providerPrice = (subscription) => String(subscription?.items?.data?.[0]?.price?.id || '').trim() || null;
const isLive = (subscription) => Boolean(subscription && subscription.status === 'active' && !subscription.cancel_at_period_end);

/** The provider calls since `mark` that name any of these strings (a customer, a subscription, a card, a company id). */
const providerCalls = async (mark, ...needles) => (await fake.since(mark)).filter((call) => needles.some((needle) => needle && JSON.stringify(call).includes(needle)));
const creations = (calls) => calls.filter((c) => c.method === 'POST' && c.path === '/v1/subscriptions');

/**
 * Stages one provider failure on a path. 400 reaches the product; 500 is retried by the provider's client library.
 * With `customer`, only a call whose body names that customer consumes it (the fake's failNext.customer) — used for
 * a creation, whose path (/v1/subscriptions) every suite's creations share.
 */
const stage = (path, status = 400, { customer = null } = {}) =>
  fake.set({ failNext: { path, status, type: status >= 500 ? 'api_error' : 'invalid_request_error', code: STAGED, message: `staged by ${SUITE} ${RUN}`, ...(customer ? { customer } : {}) } });
/**
 * The calls since `mark` that consumed a failure THIS run staged (the fake records it on the call as `staged`) and
 * that `isOurs` recognises as this company's call. An answer code is no proof: a 500 can be anybody's failure.
 */
const stagedCalls = async (mark, isOurs) =>
  (await fake.since(mark)).filter((call) => call.staged?.code === STAGED && String(call.staged?.message || '').endsWith(` ${RUN}`) && isOurs(call));
/** Stops the section unless exactly one staged failure since `mark` was answered to this company's own call. */
const mustHaveReached = async (what, mark, isOurs, res) => {
  const consumed = await stagedCalls(mark, isOurs);
  if (consumed.length !== 1) {
    throw new Error(`${what}: the fake's log shows ${consumed.length} call(s) of this company that received the failure staged by this run (the product answered ${res.status} ${errorCode(res) || ''}) — another suite re-armed the fake's one slot, or the fake predates customer matching and must be restarted; run the suite again`);
  }
  return consumed[0];
};

/**
 * Every e-mail the billing API wrote to its log, as [{ to, subject }] — with no mail provider configured outside
 * production the product writes "[email:local] -> <to> | <subject>" (services/email.service.js). Null when the log
 * cannot be read.
 */
const readMailLog = () => {
  let text;
  try {
    text = fs.readFileSync(BILLING_API_LOG, 'utf8');
  } catch {
    return null;
  }
  const mail = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\[email:local\] -> (\S+) \| (.*)$/.exec(line.trim());
    if (m) mail.push({ to: m[1], subject: m[2].trim() });
  }
  return mail;
};

/** CERT_BILLING_SECTIONS=5,6 runs only those sections (for working on one); unset, the whole suite runs. */
const ONLY = String(process.env.CERT_BILLING_SECTIONS || '').split(',').map((s) => s.trim()).filter(Boolean);
const section = async (title, body) => {
  if (ONLY.length && !ONLY.includes(title.split('.')[0])) return;
  console.log(`\n── ${title}`);
  try {
    await body();
  } catch (failure) {
    check(`${title}: the section ran to its end`, 'no error', String(failure?.message || failure).slice(0, 400));
  }
};

// ── 1. A, B, C ─────────────────────────────────────────────────────────────

const isolationBetweenCompanies = async (shared) => {
  // B is a paying company with an American Express card and one paid invoice; C is a bystander in its trial.
  const B = await company('isolation victim B', 931);
  const C = await company('isolation bystander C', 932);
  shared.B = B;
  await beginTrial(B, amex('B'));
  await ownIds(B, OWN_IDS); // B's paid invoice below is resolved by its customer id: it must be B's alone
  must('B subscribes', await subscribe(B.pm, 'business', 'monthly'), 200);
  await ownIds(B, OWN_IDS);
  const b = await row(B);
  const now = Math.floor(Date.now() / 1000);
  const paidB = await webhook.send(webhook.event('invoice.paid', { id: `in_cert_B_${RUN}`, customer: b.stripeCustomerId, amount_paid: 49900, currency: 'usd', lines: { data: [{ description: 'Business (monthly)', period: { start: now, end: now + 30 * 86400 } }] } }));
  if (paidB.status !== 200) throw new Error(`B's paid-invoice event answered ${paidB.status}`);
  await beginTrial(C, visa('C'));

  const A = await company('isolation attacker A', 930);
  const aBorn = await row(A);
  const bBefore = await print(B.orgId);
  const cBefore = await print(C.orgId);
  const bOwner = await B.pm.call('GET', '/auth/me');
  const bCard = b.paymentMethods[0].stripePaymentMethodId;

  // B's identifiers, under every name a billing route could conceivably read. The one card field the billing
  // routes do read — paymentMethodId (trial/confirm, subscribe) — is deliberately not in the bag: sent with B's
  // card it is the foreign-card attack, which section 2 covers with ids the fake refuses to attach as Stripe would
  // (pm_foreign_…). The fake would attach B's ordinary card id to A's customer, so here it would only certify the fake.
  const bag = {
    orgId: B.orgId, organisationId: B.orgId, organizationId: B.orgId, org_id: B.orgId, tenantId: B.orgId, workspaceId: B.orgId, companyId: B.orgId,
    org: { id: B.orgId }, organisation: { id: B.orgId },
    id: b.id, subscriptionId: b.id, subscription: { id: b.id, orgId: B.orgId },
    stripeCustomerId: b.stripeCustomerId, customerId: b.stripeCustomerId, customer: b.stripeCustomerId,
    stripeSubscriptionId: b.stripeSubscriptionId,
    stripePaymentMethodId: bCard, paymentMethod: bCard, payment_method: bCard, defaultPaymentMethod: bCard,
    userId: bOwner.id, ownerId: bOwner.id,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(bag)) {
    if (value && typeof value === 'object') for (const [inner, innerValue] of Object.entries(value)) query.append(`${key}[${inner}]`, innerValue);
    else query.append(key, value);
  }
  const headers = { 'x-org-id': B.orgId, 'x-organisation-id': B.orgId, 'x-organization-id': B.orgId, 'x-tenant-id': B.orgId, 'x-workspace-id': B.orgId, 'x-subscription-id': b.id, 'x-stripe-customer-id': b.stripeCustomerId };
  /** A's project manager calls a billing route with B's identifiers in the query, the headers and (for a write) the body. */
  const asA = (method, route, payload = {}) => A.pm.send(method, `${route}?${query}`, method === 'GET' ? undefined : { ...bag, ...payload }, { headers });

  const attackMark = Date.now();

  const read = await asA('GET', '/billing/subscription');
  check("A reads the subscription with B's identifiers in the query and headers: the answer is A's own subscription", [200, aBorn.id], [read.status, read.body?.data?.id]);
  check("A's read of the subscription with B's identifiers shows no card, although B has one on file", null, read.body?.data?.paymentMethod ?? null);

  const plans = await asA('GET', '/billing/plans');
  const plansB = await B.pm.send('GET', '/billing/plans');
  check("A reads the plans with B's identifiers: no current plan is shown (A has none)", [200, null], [plans.status, plans.body?.data?.currentPlan ?? null]);
  check("B, reading its own plans, sees business as its current plan (the answer depends on the company, not on the identifiers sent)", 'business', plansB.body?.data?.currentPlan);

  const listBefore = await asA('GET', '/billing/transactions');
  check("A reads the transactions with B's identifiers: the list is empty, although B has a paid invoice", [200, 0], [listBefore.status, listBefore.body?.data?.length]);

  const start = await asA('POST', '/billing/trial/start');
  const a1 = await row(A);
  const customersMade = (await fake.since(attackMark)).filter((c) => c.method === 'POST' && c.path === '/v1/customers' && [A.orgId, B.orgId, C.orgId].includes(c.body?.metadata?.orgId));
  check("A starts a trial with B's identifiers in the body: one provider customer is created, and it is A's", [200, [A.orgId]], [start.status, customersMade.map((c) => c.body.metadata.orgId)]);
  check("after that trial/start, A's row holds a provider customer of its own, not B's", [true, false], [Boolean(a1.stripeCustomerId), a1.stripeCustomerId === b.stripeCustomerId]);

  const confirm = await asA('POST', '/billing/trial/confirm', { paymentMethodId: visa('A') });
  const a2 = await row(A);
  check("A confirms its trial with B's identifiers in the body: A is in a trial with its own card", [200, 'trialing', [visa('A')]], [confirm.status, a2.status, a2.paymentMethods.map((p) => p.stripePaymentMethodId)]);

  const first = await asA('POST', '/billing/subscribe', { plan: 'individual', billingCycle: 'monthly' });
  const a3 = await row(A);
  const aCreated = creations(await providerCalls(attackMark, a1.stripeCustomerId, b.stripeCustomerId));
  check("A subscribes with B's identifiers in the body: A becomes active on individual", [200, 'individual', 'active'], [first.status, a3.plan, a3.status]);
  check("A's subscribe with B's identifiers creates the provider subscription on A's customer", [a1.stripeCustomerId], aCreated.map((c) => c.body.customer));
  check("A's subscribe is sent to the provider under a key that carries A's subscription row, not B's", [true, false], [String(aCreated[0]?.idempotencyKey).includes(aBorn.id), String(aCreated[0]?.idempotencyKey).includes(b.id)]);

  const upgrade = await asA('POST', '/billing/subscribe', { plan: 'business', billingCycle: 'monthly' });
  const a4 = await row(A);
  check("A upgrades with B's provider subscription id in the body: A's own provider subscription is the one changed", [200, 'business', a3.stripeSubscriptionId], [upgrade.status, a4.plan, a4.stripeSubscriptionId]);

  // A's paid invoice is resolved by A's customer id: made A's alone first (only re-staged if the fake handed out an
  // id another company already holds), after every case above has judged the ids the product itself recorded.
  await ownIds(A, OWN_IDS);
  const aPaying = await row(A);
  const paidA = await webhook.send(webhook.event('invoice.paid', { id: `in_cert_A_${RUN}`, customer: aPaying.stripeCustomerId, amount_paid: 12345, currency: 'usd', lines: { data: [{ description: 'Proration', period: { start: now, end: now + 30 * 86400 } }] } }));
  const listA = await asA('GET', '/billing/transactions');
  const listB = await B.pm.send('GET', '/billing/transactions');
  check("after a paid invoice for A's customer, A's transactions show that invoice only", [200, [123.45]], [paidA.status, (listA.body?.data || []).map((i) => Number(i.amount))]);
  check("after a paid invoice for A's customer, B's transactions still show B's invoice only", [499], (listB.body?.data || []).map((i) => Number(i.amount)));

  const lead = await asA('POST', '/billing/enterprise-lead', { seatsBand: 'lte_100' });
  const client = await db.prisma();
  check("A raises an enterprise lead with B's identifiers in the body: the lead is A's", [201, 1, 0], [lead.status, await client.enterpriseLead.count({ where: { orgId: A.orgId } }), await client.enterpriseLead.count({ where: { orgId: B.orgId } })]);

  const stop = await asA('POST', '/billing/cancel');
  const a5 = await row(A);
  check("A cancels with B's identifiers in the body: A is the company cancelled", [200, 'canceled', true], [stop.status, a5.status, a5.cancelAtPeriodEnd]);

  const guesses = [
    ['GET', `/billing/subscription/${b.id}`], ['GET', `/billing/subscriptions/${b.id}`], ['GET', `/billing/organisations/${B.orgId}/subscription`],
    ['GET', `/billing/${B.orgId}/subscription`], ['POST', `/billing/cancel/${b.id}`], ['POST', `/billing/subscriptions/${b.id}/cancel`],
    ['DELETE', `/billing/subscription/${b.id}`], ['GET', `/billing/transactions/${B.orgId}`], ['GET', `/billing/payment-methods/${bCard}`],
  ];
  const guessed = [];
  for (const [method, route] of guesses) guessed.push((await A.pm.send(method, route, method === 'GET' ? undefined : {})).status);
  check('no billing route is addressed by a company, subscription or card identifier (every guess is 404)', guesses.map(() => 404), guessed);

  // Read from the fake's log before this suite itself asks the fake about B.
  const namedB = await providerCalls(attackMark, b.stripeCustomerId, b.stripeSubscriptionId, bCard);
  check("nothing A did reached the provider under B's customer, subscription or card", [], namedB.map((c) => `${c.method} ${c.path}`));

  const bAtProvider = await providerSubscription(b.stripeSubscriptionId);
  const aAtProvider = await providerSubscription(a5.stripeSubscriptionId);
  check("at the provider, A's subscription is the one set to end and B's is still running", [true, false], [aAtProvider?.cancel_at_period_end, bAtProvider?.cancel_at_period_end]);
  check("B's subscription, card, invoices and leads are exactly what they were before A's calls", bBefore, await print(B.orgId));
  check("C's subscription, card, invoices and leads are exactly what they were before A's calls", cBefore, await print(C.orgId));
};

// ── 2. A payment method the provider says belongs to another customer ──────

const foreignPaymentMethod = async () => {
  const F = await company('foreign card', 933);
  must('trial/start', await F.pm.send('POST', '/billing/trial/start', {}), 200);

  const refusedTrial = await F.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: foreignCard('trial') });
  const f0 = await row(F);
  check("trial/confirm with a payment method the provider says belongs to another customer starts no trial and stores no card", [false, 'incomplete', 0], [refusedTrial.status < 300, f0.status, f0.paymentMethods.length]);
  // ISO-1 was called NEW-1 in earlier runs.
  finding('ISO-1', "a payment method the provider refuses to attach is answered as the customer's to fix (4xx), not as a server error (5xx)", 4, Math.floor(refusedTrial.status / 100), `answered ${refusedTrial.status} ${errorCode(refusedTrial)}`);

  must('trial/confirm', await F.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: visa('F') }), 200);
  const f1 = await row(F);

  // What Stripe is documented to do: refuse to make a payment method the customer's default when it is not attached to that customer.
  const strictMark = Date.now();
  await stage(`/v1/customers/${f1.stripeCustomerId}`, 400);
  const strict = await subscribe(F.pm, 'individual', 'monthly', { paymentMethodId: foreignCard('strict') });
  const strictCalls = await providerCalls(strictMark, f1.stripeCustomerId);
  if (!strictCalls.some((c) => c.method === 'POST' && c.path === `/v1/customers/${f1.stripeCustomerId}`)) {
    // The product never asked the provider to make it the default, so the staged failure is still armed: use it up.
    await fetch(`${FAKE}/v1/customers/${f1.stripeCustomerId}`, { method: 'POST' });
  }
  const f2 = await row(F);
  check("subscribing with another customer's payment method, when the provider also refuses to make it the default: refused, the company's own card is kept, nothing is charged", [false, [visa('F')], 'trialing', 0], [strict.status < 300, f2.paymentMethods.map((p) => p.stripePaymentMethodId), f2.status, creations(strictCalls).length]);

  // The product's own handling, with a provider that does not happen to refuse the second call.
  const looseMark = Date.now();
  const loose = await subscribe(F.pm, 'individual', 'monthly', { paymentMethodId: foreignCard('loose') });
  const f3 = await row(F);
  const looseCalls = await providerCalls(looseMark, f1.stripeCustomerId);
  const attachCalls = looseCalls.filter((c) => c.path === `/v1/payment_methods/${foreignCard('loose')}/attach`);
  check('the provider was asked to attach that payment method to the company and refused (the fake refuses ids starting pm_foreign)', 1, attachCalls.length);
  finding('D19', "subscribing with a payment method the provider refused to attach to this company is refused", 'refused', loose.status < 300 ? `accepted (${loose.status})` : 'refused');
  finding('D19', "after the provider refused to attach a payment method, the card on file is still the company's own", [visa('F')], f3.paymentMethods.map((p) => p.stripePaymentMethodId));
  finding('D19', 'no provider subscription is created on a payment method the provider refused to attach', [], creations(looseCalls).map((c) => c.body.default_payment_method));
};

// ── 3. One person, two companies ───────────────────────────────────────────

const onePersonTwoCompanies = async (shared) => {
  const X = await company('two companies X', 934);
  const Y = await company('two companies Y', 935);
  await beginTrial(X, visa('X'));
  await beginTrial(Y, amex('Y'));
  const person = X.email; // the owner of X, about to become a project manager of Y as well

  // An existing person is invited, never attached (L38): they join Y by accepting with their own session.
  const joined = await joinByInvitation({ inviter: Y.pm, email: person, role: 'pm', via: 'users', name: 'Member Of Two Companies', homeOrgId: X.orgId });
  check('the administrator of Y invites the owner of X: an existing person is sent an invitation (202) and joins by accepting it (200)', [202, 200], [joined.invited?.status, joined.accepted?.status]);
  const personId = (await api.signIn(person, X.orgId)).user?.id;
  // Made an administrator of Y as well, so that what follows does not depend on who holds billing authority (section 4).
  must('making the person an administrator of Y', await Y.pm.send('PATCH', `/users/${personId}`, { isCompanyAdmin: true }), 200);
  api.forget(person);

  const x0 = await row(X);
  const y0 = await row(Y);
  const inX = api.as(person, X.orgId);
  const inY = api.as(person, Y.orgId);
  const tokenX = await inX.token();

  const readX = await inX.send('GET', '/billing/subscription');
  const readY = await inY.send('GET', '/billing/subscription');
  check("signed in to X, the person reads X's subscription and X's card", [x0.id, 'visa'], [readX.body?.data?.id, readX.body?.data?.paymentMethod?.brand]);
  check("signed in to Y, the same person reads Y's subscription and Y's card", [y0.id, 'amex'], [readY.body?.data?.id, readY.body?.data?.paymentMethod?.brand]);

  const personal = await X.personal.send('GET', '/billing/subscription');
  check("in their personal workspace the person reads a third subscription, neither X's nor Y's", [200, false, false], [personal.status, personal.body?.data?.id === x0.id, personal.body?.data?.id === y0.id]);

  const switched = await api.raw('POST', `/auth/workspaces/${Y.orgId}/session`, { token: tokenX });
  const tokenY = switched.body?.data?.tokens?.accessToken || null;
  const afterSwitch = await api.raw('GET', '/billing/subscription', { token: tokenY });
  check("switching workspace with X's token gives a session whose billing is Y's", [200, y0.id], [switched.status, afterSwitch.body?.data?.id]);
  const stillX = await api.raw('GET', '/billing/subscription', { token: tokenX });
  check("after the switch to Y, X's token goes on reading X", x0.id, stillX.body?.data?.id);

  const yBefore = await print(Y.orgId);
  const mark = Date.now();
  const yIdentifiers = { orgId: Y.orgId, organisationId: Y.orgId, subscriptionId: y0.id, stripeCustomerId: y0.stripeCustomerId, customer: y0.stripeCustomerId };
  const billX = await api.raw('POST', '/billing/subscribe', { token: tokenX, json: { plan: 'business', billingCycle: 'monthly', ...yIdentifiers } });
  const x1 = await row(X);
  check("a subscribe sent with X's token and Y's identifiers in the body bills X", [200, 'business', 'active'], [billX.status, x1.plan, x1.status]);
  check("a subscribe sent with X's token and Y's identifiers leaves Y exactly as it was", yBefore, await print(Y.orgId));
  check("a subscribe sent with X's token creates the provider subscription on X's customer and none on Y's", [x0.stripeCustomerId], creations(await providerCalls(mark, x0.stripeCustomerId, y0.stripeCustomerId)).map((c) => c.body.customer));

  const xBefore = await print(X.orgId);
  const billY = await api.raw('POST', '/billing/subscribe', { token: tokenY, json: { plan: 'individual', billingCycle: 'annual', orgId: X.orgId, subscriptionId: x0.id, stripeSubscriptionId: x1.stripeSubscriptionId } });
  const y1 = await row(Y);
  check("a subscribe sent with Y's token and X's identifiers in the body bills Y", [200, 'individual', 'annual', 'active'], [billY.status, y1.plan, y1.billingCycle, y1.status]);
  check("a subscribe sent with Y's token and X's identifiers leaves X exactly as it was", xBefore, await print(X.orgId));

  const stopX = await api.raw('POST', '/billing/cancel', { token: tokenX, json: { orgId: Y.orgId, stripeSubscriptionId: y1.stripeSubscriptionId } });
  const x2 = await row(X);
  const y2 = await row(Y);
  check("a cancel sent with X's token and Y's provider subscription id cancels X and leaves Y active", [200, 'canceled', 'active'], [stopX.status, x2.status, y2.status]);
  const yAtProvider = await providerSubscription(y1.stripeSubscriptionId);
  check("after the cancel sent with X's token, Y's subscription is still running at the provider", false, yAtProvider?.cancel_at_period_end);

  const stranger = await api.raw('POST', `/auth/workspaces/${shared.B ? shared.B.orgId : crypto.randomUUID()}/session`, { token: tokenX });
  check('the person cannot obtain a session for a company they do not belong to', [404, false], [stranger.status, Boolean(stranger.body?.data?.tokens)]);

  // Y removes the person. The token minted for Y must stop at once; the one for X must not.
  const removed = await Y.pm.send('PATCH', `/users/${personId}/deactivate`, {});
  must('deactivating the person in Y', removed, 200);
  const deadRead = await api.raw('GET', '/billing/subscription', { token: tokenY });
  const deadCancel = await api.raw('POST', '/billing/cancel', { token: tokenY, json: {} });
  const y3 = await row(Y);
  check("once Y removes the person, the token minted for Y no longer reads or cancels Y's billing", [401, 401, 'active'], [deadRead.status, deadCancel.status, y3.status]);
  const again = await api.raw('POST', `/auth/workspaces/${Y.orgId}/session`, { token: tokenX });
  check('once Y removes the person, no new session for Y is issued to them', [403, false], [again.status, Boolean(again.body?.data?.tokens)]);
  const aliveX = await api.raw('GET', '/billing/subscription', { token: tokenX });
  check("once Y removes the person, their token for X still reads X", [200, x0.id], [aliveX.status, aliveX.body?.data?.id]);
};

// ── 4. Roles and API keys ──────────────────────────────────────────────────

const rolesAndKeys = async (shared) => {
  const R = await company('roles and keys', 936);
  await beginTrial(R, visa('R'));
  const stamp = R.email.split('@')[0].split('.')[1];
  const OTHER_ROLES = ['planning_eng', 'qs', 'cost_controller', 'procurement', 'warehouse', 'site_engineer', 'quality_engineer', 'finance'];
  const people = { 'pm (owner)': R.pm };
  const ids = {};
  for (const role of ['pm', ...OTHER_ROLES]) {
    const email = `${role.replace(/_/g, '')}.${stamp}@billing.octapm-cert.test`;
    const made = must(`adding a ${role}`, await R.pm.send('POST', '/users', { name: `Cert ${role} ${stamp}`, email, password: process.env.CERT_PASSWORD, role }), 201);
    ids[role] = made.body.data.id;
    people[role === 'pm' ? 'pm (second, not owner)' : role] = api.as(email, R.orgId);
  }
  const names = Object.keys(people);
  const ask = async (method, route, payload) => {
    const answers = {};
    for (const name of names) answers[name] = await people[name].send(method, route, payload);
    return answers;
  };
  const whoGot = (answers, test) => sorted(names.filter((name) => test(answers[name])));

  // Who holds billing authority — the workspace role pm (what the product does today) or ownership / company
  // administration — is a policy the owner has not decided (D15). The second pm, who is neither owner nor company
  // administrator, is the one member whose answer differs between those two rules: every case about them is an
  // owner decision, reported and not judged. The owner (a pm) and the eight other roles (neither pm, owner nor
  // administrator) get the same answer under either rule, so the cases about them stay cases.
  const SECOND_PM = 'pm (second, not owner)';
  const judged = (list) => list.filter((name) => name !== SECOND_PM);
  /** Reports what the second pm got. `passes` is the same test the neighbouring case applies to everybody else. */
  const secondPmGot = (answers, what, passes = (r) => r.status !== 403) => {
    const res = answers[SECOND_PM];
    ownerDecision('D15', `may a project manager who is neither owner nor company administrator ${what}?`, `${passes(res) ? 'yes' : 'no'} — answered ${res.status}${errorCode(res) ? ` ${errorCode(res)}` : ''}`);
  };
  const AUTHORITY = sorted(['pm (owner)']);

  const reads = await ask('GET', '/billing/subscription');
  check('every member role can read the plan and the status (the screens need them to explain a refusal)', sorted(names), whoGot(reads, (r) => r.status === 200 && Boolean(r.body?.data?.status)));
  finding('D15', 'the card brand, last four and expiry are shown only to the roles that may see the invoices (the owning pm and finance; the second pm is an owner decision)', sorted([...AUTHORITY, 'finance']), judged(whoGot(reads, (r) => Boolean(r.body?.data?.paymentMethod?.last4))), 'P3: every member role reads the card on file');
  ownerDecision('D15', 'may a project manager who is neither owner nor company administrator see the card on file (GET /billing/subscription)?', reads[SECOND_PM].body?.data?.paymentMethod?.last4 ? 'yes — the card is shown' : 'no — no card is shown');

  const lists = await ask('GET', '/billing/transactions');
  check('the transactions list is readable by the owning pm and finance, and by no other role (the second pm is an owner decision)', sorted([...AUTHORITY, 'finance']), judged(whoGot(lists, (r) => r.status === 200)));
  secondPmGot(lists, 'read the invoices (GET /billing/transactions)', (r) => r.status === 200);

  // The role door is asked before the body is validated, so a body that cannot be valid shows who passes the door without changing anything.
  const subscribeDoor = await ask('POST', '/billing/subscribe', { plan: 'not-a-plan', billingCycle: 'monthly' });
  check('of the owner and the roles that are neither pm, owner nor administrator, only the owner passes the door of subscribe', AUTHORITY, judged(whoGot(subscribeDoor, (r) => r.status !== 403)));
  secondPmGot(subscribeDoor, 'pass the door of subscribe');
  const confirmDoor = await ask('POST', '/billing/trial/confirm', {});
  check('of the owner and the roles that are neither pm, owner nor administrator, only the owner passes the door of trial/confirm', AUTHORITY, judged(whoGot(confirmDoor, (r) => r.status !== 403)));
  secondPmGot(confirmDoor, 'pass the door of trial/confirm');
  const leadDoor = await ask('POST', '/billing/enterprise-lead', { seatsBand: 'not-a-band' });
  check('of the owner and the roles that are neither pm, owner nor administrator, only the owner passes the door of enterprise-lead', AUTHORITY, judged(whoGot(leadDoor, (r) => r.status !== 403)));
  secondPmGot(leadDoor, 'pass the door of enterprise-lead');
  const startDoor = await ask('POST', '/billing/trial/start', {}); // the company is already in its trial: a pm gets 409, nothing changes
  check('of the owner and the roles that are neither pm, owner nor administrator, only the owner passes the door of trial/start', AUTHORITY, judged(whoGot(startDoor, (r) => r.status !== 403)));
  secondPmGot(startDoor, 'pass the door of trial/start');

  const others = OTHER_ROLES.map((role) => people[role]);
  const refusedCancels = [];
  for (const session of others) refusedCancels.push((await cancel(session)).status);
  check('no role other than pm can cancel', OTHER_ROLES.map(() => 403), refusedCancels);

  // ── API keys ──
  const key = async (name, scopes, userId = undefined) => must(`creating the key "${name}"`, await R.pm.send('POST', '/integrations/api-clients', { name, scopes, ...(userId ? { userId } : {}) }), 201).body.data.token;
  const withKey = (token) => (method, route, json) => api.raw(method, route, { token, json: method === 'GET' ? undefined : json || {} });
  const narrow = withKey(await key(`inventory read ${stamp}`, ['inventory:read']));
  const readAll = withKey(await key(`read everything ${stamp}`, ['*:read']));
  const financeWrite = withKey(await key(`write everything, owned by finance ${stamp}`, ['*:write'], ids.finance));
  const r0 = await row(R);

  const keyRead = await narrow('GET', '/billing/subscription');
  finding('D15', 'an API key scoped to inventory only cannot read the subscription (plan, status, card)', 403, keyRead.status, `P2: it read ${JSON.stringify(keyRead.body?.data?.paymentMethod || null)}`);
  const keyPlans = await narrow('GET', '/billing/plans');
  finding('D15', 'an API key scoped to inventory only cannot read the plans and the current plan', 403, keyPlans.status);
  const keyList = await narrow('GET', '/billing/transactions');
  check('an API key scoped to inventory only cannot read the transactions', [403, 'API_KEY_SCOPE'], [keyList.status, errorCode(keyList)]);
  const keyWrites = [];
  for (const [route, body] of [['/billing/trial/start', {}], ['/billing/trial/confirm', { paymentMethodId: visa('key') }], ['/billing/subscribe', { plan: 'business', billingCycle: 'monthly' }], ['/billing/cancel', {}], ['/billing/enterprise-lead', { seatsBand: 'lte_100' }]]) {
    const res = await narrow('POST', route, body);
    keyWrites.push(`${res.status} ${errorCode(res)}`);
  }
  check('an API key scoped to inventory only cannot start or confirm a trial, subscribe, cancel or raise a lead', Array(5).fill('403 API_KEY_SCOPE'), keyWrites);
  const readAllCancel = await readAll('POST', '/billing/cancel');
  check('an API key that may read every module cannot cancel', [403, 'API_KEY_SCOPE'], [readAllCancel.status, errorCode(readAllCancel)]);
  const financeCancel = await financeWrite('POST', '/billing/subscribe', { plan: 'business', billingCycle: 'monthly' });
  check("an API key that may write every module never exceeds its owner's role: owned by finance, it cannot subscribe", [403, 'FORBIDDEN'], [financeCancel.status, errorCode(financeCancel)]);
  // Another company's id: B's when section 1 ran, otherwise the owner's personal workspace (as the next case does).
  // With neither there is nothing to send, and the case is skipped rather than compared with itself.
  const elsewhereId = shared.B ? shared.B.orgId : R.personalOrgId;
  if (elsewhereId) {
    const keyElsewhere = await readAll('GET', `/billing/subscription?orgId=${elsewhereId}`);
    check("an API key of this company, sent with another company's id, still answers about this company", [200, r0.id], [keyElsewhere.status, keyElsewhere.body?.data?.id]);
  } else {
    console.log("SKIP  an API key of this company, sent with another company's id — section 1 did not run and the owner has no personal workspace, so there is no other company's id to send");
  }
  const keySession = await readAll('POST', `/auth/workspaces/${shared.B ? shared.B.orgId : R.personalOrgId}/session`);
  check('an API key cannot be exchanged for a session in another workspace', [403, 'API_KEY_FORBIDDEN'], [keySession.status, errorCode(keySession)]);
  check("none of the API key calls changed the company's subscription row", JSON.stringify(r0), JSON.stringify(await row(R)));

  // ── no session, or a session with no company ──
  const anonymous = [(await api.raw('GET', '/billing/subscription')).status, (await api.raw('POST', '/billing/cancel', { json: {} })).status, (await api.raw('GET', '/billing/subscription', { token: 'not-a-token' })).status];
  check('without a token, or with a token that is not one, billing answers 401', [401, 401, 401], anonymous);
  const login = await api.raw('POST', '/auth/login', { json: { email: R.email, password: process.env.CERT_PASSWORD } });
  const identity = await api.raw('GET', '/billing/subscription', { token: login.body?.data?.identityToken });
  check('a sign-in that has not yet chosen a company cannot read any billing', [401, 'WORKSPACE_REQUIRED'], [identity.status, errorCode(identity)]);

  // ── who holds billing authority ── (D15, undecided: reported, not judged — see above)
  const second = people[SECOND_PM];
  const secondSubscribe = await subscribe(second, 'individual', 'monthly');
  ownerDecision('D15', 'may a project manager who is neither the owner nor a company administrator subscribe the company (POST /billing/subscribe)?', `${secondSubscribe.status === 200 ? 'yes' : 'no'} — answered ${secondSubscribe.status}${errorCode(secondSubscribe) ? ` ${errorCode(secondSubscribe)}` : ''}`, 'today billing authority is the workspace role pm, not ownership or company administration');
  if ((await row(R)).status !== 'active') must('the owner subscribes', await subscribe(R.pm, 'individual', 'monthly'), 200);
  const secondCancel = await cancel(second);
  ownerDecision('D15', 'may a project manager who is neither the owner nor a company administrator cancel the company subscription (POST /billing/cancel)?', `${secondCancel.status === 200 ? 'yes' : 'no'} — answered ${secondCancel.status}${errorCode(secondCancel) ? ` ${errorCode(secondCancel)}` : ''}`);

  must('promoting the finance member to company administrator', await R.pm.send('PATCH', `/users/${ids.finance}`, { isCompanyAdmin: true }), 200);
  const adminRead = await people.finance.send('GET', '/auth/me');
  check('the finance member is now a company administrator (set-up of the next question)', true, Boolean(adminRead.body?.data?.isCompanyAdmin));
  const adminSubscribe = await people.finance.send('POST', '/billing/subscribe', { plan: 'not-a-plan', billingCycle: 'monthly' });
  ownerDecision('D15', 'may a company administrator whose role is not pm (here: finance) pass the door of subscribe?', `${adminSubscribe.status !== 403 ? 'yes' : 'no'} — answered ${adminSubscribe.status}${errorCode(adminSubscribe) ? ` ${errorCode(adminSubscribe)}` : ''}`, 'the same question as the second pm, seen from the other side');
};

// ── 5. Trial races ─────────────────────────────────────────────────────────

const trialRaces = async () => {
  // Two trial/start at once.
  const one = await raceOnFresh(async () => {
    const co = await company('race trial start', 937);
    await warm(co.pm);
    const mark = Date.now();
    const answers = await together(() => co.pm.send('POST', '/billing/trial/start', {}), () => co.pm.send('POST', '/billing/trial/start', {}));
    const calls = await fake.since(mark);
    return { co, answers, calls, row: await row(co), customers: calls.filter((c) => c.method === 'POST' && c.path === '/v1/customers' && c.body?.metadata?.orgId === co.orgId) };
  }, (result) => result.customers.length > 1);
  const T1 = one.co;
  check(
    'two trial/start fired together are both answered with a card-setup secret, in every pair fired',
    one.all.map(() => [200, 200, true, true]),
    one.all.map((pair) => [...pair.answers.map((s) => s.status), ...pair.answers.map((s) => Boolean(s.body?.data?.clientSecret))]),
    `${one.pairs} pair(s) fired`
  );
  finding('D21', 'two trial/start fired together create one provider customer for the company', 1, one.customers.length, `P2: the second customer is orphaned at the provider (${one.pairs} pair(s) fired; a race — passes when not reproduced in them)`);
  // Each trial/start opens one card setup at the provider. Both should be on the customer the company's row keeps.
  const keptIntents = one.calls.filter((c) => c.method === 'POST' && c.path === '/v1/setup_intents' && c.body?.customer === one.row.stripeCustomerId);
  finding('D21', 'both card-setup secrets handed out are for the provider customer the company keeps', 2, keptIntents.length, 'a card set up with the other secret belongs to the orphaned customer');
  const confirm1 = await T1.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: visa('T1') });
  check('after the double start, the trial can still be confirmed on the customer the company kept', [200, 'trialing'], [confirm1.status, (await row(T1)).status]);
  const twice = await T1.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: visa('T1') });
  check('a trial that is running cannot be confirmed a second time', [409, 'TRIAL_NOT_AVAILABLE'], [twice.status, errorCode(twice)]);
  const restart = await T1.pm.send('POST', '/billing/trial/start', {});
  check('a trial that is running cannot be started again', [409, 'TRIAL_NOT_AVAILABLE'], [restart.status, errorCode(restart)]);

  // Two trial/confirm at once, the same card (a double click).
  const two = await raceOnFresh(async (pair) => {
    const co = await company('race trial confirm same card', 937);
    must('trial/start', await co.pm.send('POST', '/billing/trial/start', {}), 200);
    await warm(co.pm);
    const card = visa(`T2-${pair}`);
    const answers = await together(() => co.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: card }), () => co.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: card }));
    return { answers, row: await row(co) };
  }, (result) => result.row.paymentMethods.length > 1);
  check(
    'two trial/confirm fired together with the same card leave the company in one running trial, in every pair fired',
    two.all.map(() => 'trialing'),
    two.all.map((pair) => pair.row.status),
    `${two.pairs} pair(s) fired; answers ${two.all.map((pair) => pair.answers.map((s) => s.status).join(' and ')).join(' | ')}`
  );
  // ISO-2 was called NEW-2 in earlier runs.
  finding('ISO-2', 'two trial/confirm fired together with the same card leave one card on file', 1, two.row.paymentMethods.length, `P3: the double click stores the card twice, both marked default (${two.pairs} pair(s) fired; a race — passes when not reproduced in them)`);

  // Two trial/confirm at once, two different cards.
  const three = await raceOnFresh(async (pair) => {
    const co = await company('race trial confirm two cards', 937);
    must('trial/start', await co.pm.send('POST', '/billing/trial/start', {}), 200);
    await warm(co.pm);
    const mark = Date.now();
    const answers = await together(() => co.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: visa(`T3-${pair}`) }), () => co.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: amex(`T3-${pair}`) }));
    const after = await row(co);
    const providerDefaults = (await providerCalls(mark, after.stripeCustomerId)).filter((c) => c.method === 'POST' && c.path === `/v1/customers/${after.stripeCustomerId}`).map((c) => c.body?.invoice_settings?.default_payment_method);
    return { answers, row: after, providerDefault: providerDefaults.pop() };
  }, (result) => result.row.paymentMethods.filter((p) => p.isDefault).length > 1);
  const onFile = three.row.paymentMethods.filter((p) => p.isDefault).map((p) => p.stripePaymentMethodId);
  finding('ISO-2', 'two trial/confirm fired together with two different cards leave one default card on file', 1, onFile.length, `P2: answers ${three.answers.map((s) => s.status).join(' and ')}; which card is shown and charged is then arbitrary (${three.pairs} pair(s) fired; a race — passes when not reproduced in them)`);
  finding('ISO-2', "after two trial/confirm with two different cards, the card on file is the one the provider holds as the customer's default", [three.providerDefault], onFile);
};

// ── 6. Subscribe races ─────────────────────────────────────────────────────

const subscribeRaces = async () => {
  // Two subscribes to the same plan at once, then cancels.
  const S1 = await company('race subscribe same plan', 937);
  await beginTrial(S1, visa('S1'));
  await warm(S1.pm);
  const s1Customer = (await row(S1)).stripeCustomerId;
  const mark1 = Date.now();
  const pair = await together(() => subscribe(S1.pm, 'business', 'monthly'), () => subscribe(S1.pm, 'business', 'monthly'));
  const s1 = await row(S1);
  const made1 = creations(await providerCalls(mark1, s1Customer));
  check('two subscribes to the same plan fired together both succeed', [200, 200], pair.map((p) => p.status));
  check('two subscribes to the same plan fired together create one provider subscription, not two', 1, made1.length);
  check("after two subscribes fired together, the company's row names the subscription the provider holds on business monthly", [true, priceOf('business', 'monthly')], [Boolean(s1.stripeSubscriptionId), providerPrice(await providerSubscription(s1.stripeSubscriptionId))]);

  const cancelMark = Date.now();
  const stops = await together(() => cancel(S1.pm), () => cancel(S1.pm));
  const s1b = await row(S1);
  const s1Provider = await providerSubscription(s1.stripeSubscriptionId);
  const stopAnswers = sorted(stops.map((s) => `${s.status}${errorCode(s) ? ` ${errorCode(s)}` : ''}`));
  check('two cancels fired together leave the company cancelled, here and at the provider', ['canceled', true, true], [s1b.status, s1b.cancelAtPeriodEnd, s1Provider?.cancel_at_period_end], `answers ${stopAnswers.join(' and ')}`);
  // Exactly one of the two is the cancellation. Cancel requires an active subscription (subscription.service.js
  // cancelSubscription: anything else is 400 NO_ACTIVE_SUBSCRIPTION — the third cancel below), so the second of two
  // is refused the same way; and only the one that cancels tells the provider and mails the owner. Cancel does not
  // take the lock subscribe holds (A11): this is a race, fired once, and passes when it is not reproduced.
  const cancellations = (await fake.since(cancelMark)).filter((c) => c.method === 'POST' && c.path === `/v1/subscriptions/${s1.stripeSubscriptionId}` && c.body?.cancel_at_period_end === 'true');
  check(
    'two cancels fired together are one cancellation: one is answered 200, the other 400 NO_ACTIVE_SUBSCRIPTION, and the provider is told to cancel once',
    { answers: ['200', '400 NO_ACTIVE_SUBSCRIPTION'], providerCancellations: 1 },
    { answers: stopAnswers, providerCancellations: cancellations.length },
    'a race, fired once: a pass says only that it did not occur here'
  );
  const mail = readMailLog();
  const CANCELLED = 'Your subscription has been canceled';
  if (!mail) console.log(`NOT CHECKED  two cancels fired together send one cancellation e-mail — the billing API's log (${BILLING_API_LOG}) cannot be read`);
  else if (!mail.some((m) => myOwners.has(m.to))) console.log(`NOT CHECKED  two cancels fired together send one cancellation e-mail — ${BILLING_API_LOG} holds no e-mail to any owner of this run, so it is not this billing API's mail log`);
  else check('two cancels fired together send the owner one cancellation e-mail', 1, mail.filter((m) => m.to === S1.email && m.subject === CANCELLED).length, `counted in ${BILLING_API_LOG} ("[email:local] -> ${S1.email} | ${CANCELLED}")`);
  const third = await cancel(S1.pm);
  check('a further cancel is refused: there is nothing active to cancel', [400, 'NO_ACTIVE_SUBSCRIPTION'], [third.status, errorCode(third)]);

  // Two subscribes to different plans at once.
  const S2 = await company('race subscribe two plans', 937);
  await beginTrial(S2, visa('S2'));
  await warm(S2.pm);
  const s2Customer = (await row(S2)).stripeCustomerId;
  const mark2 = Date.now();
  const mixed = await together(() => subscribe(S2.pm, 'individual', 'monthly'), () => subscribe(S2.pm, 'business', 'monthly'));
  const s2 = await row(S2);
  const made2 = creations(await providerCalls(mark2, s2Customer));
  check('two subscribes to different plans fired together create one provider subscription', 1, made2.length, `answers ${mixed.map((m) => `${m.status}${m.status === 200 ? '' : ` ${errorCode(m)}`}`).join(' and ')}`);
  check('after two subscribes to different plans fired together the company is on the higher plan, and the provider bills the price of the plan the row names', ['business', 'active', priceOf('business', 'monthly')], [s2.plan, s2.status, providerPrice(await providerSubscription(s2.stripeSubscriptionId))]);

  // Two subscribes at once, each bringing a different card.
  const s3 = await raceOnFresh(async (pair) => {
    const co = await company('race subscribe two cards', 937);
    await beginTrial(co, visa(`S3-${pair}-first`));
    await warm(co.pm);
    const customer = (await row(co)).stripeCustomerId;
    const mark = Date.now();
    const answers = await together(() => subscribe(co.pm, 'individual', 'monthly', { paymentMethodId: visa(`S3-${pair}-second`) }), () => subscribe(co.pm, 'individual', 'monthly', { paymentMethodId: amex(`S3-${pair}-third`) }));
    const after = await row(co);
    const calls = await providerCalls(mark, customer);
    return {
      answers,
      created: creations(calls).length,
      onFile: after.paymentMethods.filter((p) => p.isDefault).map((p) => p.stripePaymentMethodId),
      providerDefault: calls.filter((c) => c.method === 'POST' && c.path === `/v1/customers/${customer}`).map((c) => c.body?.invoice_settings?.default_payment_method).pop(),
      charged: (await providerSubscription(after.stripeSubscriptionId))?.default_payment_method,
    };
  }, (result) => unique([...result.onFile, result.providerDefault, result.charged]).length > 1);
  check(
    'two subscribes fired together with two different cards create one provider subscription, in every pair fired',
    s3.all.map(() => 1),
    s3.all.map((pair) => pair.created),
    `${s3.pairs} pair(s) fired; answers ${s3.all.map((pair) => pair.answers.map((c) => c.status).join(' and ')).join(' | ')}`
  );
  finding('ISO-2', 'two subscribes fired together with two different cards leave one default card on file', 1, s3.onFile.length, `P2: the card replacement runs outside the lock that serialises the subscribe (${s3.pairs} pair(s) fired; a race — passes when not reproduced in them)`);
  finding('ISO-2', "after two subscribes with two different cards, the card on file, the customer's default at the provider and the card the subscription charges are one and the same", 1, unique([...s3.onFile, s3.providerDefault, s3.charged]).length, `on file ${s3.onFile.join(' + ')}; provider default ${s3.providerDefault}; charged ${s3.charged}`);

  // Subscribe against cancel: subscribe holds the company's lock, cancel does not.
  const S4 = await company('race subscribe against cancel', 937);
  await beginTrial(S4, visa('S4'));
  must('first subscribe', await subscribe(S4.pm, 'individual', 'monthly'), 200);
  const s4Sub = (await row(S4)).stripeSubscriptionId;
  const outcomes = [];
  const delays = [[0, 0], [0, 2], [0, 5], [0, 9], [0, 14], [2, 0], [5, 0], [9, 0], [0, 3], [0, 7], [0, 11], [3, 0]];
  for (const [subscribeDelay, cancelDelay] of delays) {
    must('back to active', await subscribe(S4.pm, 'business', 'monthly'), 200);
    await together(async () => { await pause(subscribeDelay); return subscribe(S4.pm, 'business', 'monthly'); }, async () => { await pause(cancelDelay); return cancel(S4.pm); });
    const local = await row(S4);
    const remote = await providerSubscription(s4Sub);
    const localEnding = local.status === 'canceled' && local.cancelAtPeriodEnd === true;
    const localRunning = local.status === 'active' && local.cancelAtPeriodEnd === false;
    if (localEnding && remote?.cancel_at_period_end === true) outcomes.push('cancel won on both sides');
    else if (localRunning && remote?.cancel_at_period_end === false) outcomes.push('subscribe won on both sides');
    else outcomes.push(`SPLIT: row ${local.status}/${local.cancelAtPeriodEnd}, provider ending=${remote?.cancel_at_period_end}`);
  }
  finding('A11', `in ${delays.length} rounds of a subscribe and a cancel fired together, the company's row and the provider never disagree about whether the subscription is ending`, 0, outcomes.filter((o) => o.startsWith('SPLIT')).length, `a race — passes when not reproduced in the ${delays.length} rounds; ${outcomes.filter((o) => o.startsWith('cancel')).length} rounds went to cancel, ${outcomes.filter((o) => o.startsWith('subscribe')).length} to subscribe${outcomes.some((o) => o.startsWith('SPLIT')) ? `; ${outcomes.filter((o) => o.startsWith('SPLIT')).join(' | ')}` : ''}`);
};

// ── 7. Declined, then another card ─────────────────────────────────────────

const declinedThenAnotherCard = async () => {
  const D = await company('declined then another card', 938);
  await beginTrial(D, visa('D-first'));
  const d0 = await row(D);
  const mark = Date.now();

  const refused = await subscribe(D.pm, 'individual', 'monthly', { paymentMethodId: declined('D') });
  const d1 = await row(D);
  check('a subscribe whose card the provider declines is answered 402 CARD_DECLINED', [402, 'CARD_DECLINED'], [refused.status, errorCode(refused)]);
  check('a declined subscribe leaves the company in its trial with no provider subscription recorded', ['trial', 'trialing', null], [d1.plan, d1.status, d1.stripeSubscriptionId]);
  finding('D28', 'after the decline, the card on file is still the card that worked, not the declined one', [visa('D-first')], d1.paymentMethods.map((p) => p.stripePaymentMethodId), 'P3: the stored card is replaced before the charge is attempted');

  const retry = await subscribe(D.pm, 'individual', 'monthly', { paymentMethodId: visa('D-second') });
  const d2 = await row(D);
  finding('D13', 'after a declined card, the same subscribe with another card succeeds', [200, 'individual', 'active'], [retry.status, d2.plan, d2.status], `P1: answered ${retry.status} ${errorCode(retry)}`);
  const attempts = creations(await providerCalls(mark, d0.stripeCustomerId));
  // The declined attempt and the retry each asked the provider to create the subscription: fewer than two creations
  // in the log means there is nothing to compare, and the case below would pass on nothing.
  const comparable = check('the provider was asked at least twice to create the subscription (the declined attempt and the retry)', true, attempts.length >= 2, `${attempts.length} creation(s) in the fake's log for this customer`);
  if (comparable) finding('D13', 'each attempt to create the subscription is sent to the provider under a key of its own', attempts.length, unique(attempts.map((c) => c.idempotencyKey)).length, `cards sent: ${attempts.map((c) => c.body.default_payment_method).join(', ')}`);
  else console.log('NOT JUDGED  [D13] each attempt to create the subscription is sent under a key of its own — fewer than two attempts to compare');

  const again = await subscribe(D.pm, 'individual', 'monthly');
  finding('D13', 'after a declined card, the same subscribe repeated with the good card now on file succeeds', 200, again.status, `answered ${again.status} ${errorCode(again)}`);

  const d3 = await row(D);
  if (d3.status !== 'active') {
    const otherCycle = await subscribe(D.pm, 'individual', 'annual');
    const d4 = await row(D);
    check('the company is not locked out altogether: choosing the other billing cycle (a different provider key) subscribes it', [200, 'individual', 'annual', 'active'], [otherCycle.status, d4.plan, d4.billingCycle, d4.status]);
  }
};

// ── 8. Provider failures in the middle ─────────────────────────────────────

const providerFailures = async () => {
  const P = await company('provider failure', 939);
  await beginTrial(P, visa('P'));
  const p0 = await row(P);
  const mark = Date.now();

  // A failure the product gets to see (the provider's client library does not retry a 400). Every suite creates
  // subscriptions on this path, so the failure is armed for this company's own customer only.
  const createMark = Date.now();
  await stage('/v1/subscriptions', 400, { customer: p0.stripeCustomerId });
  const failed = await subscribe(P.pm, 'individual', 'monthly');
  await mustHaveReached('the staged creation failure', createMark, (c) => c.method === 'POST' && c.path === '/v1/subscriptions' && c.body?.customer === p0.stripeCustomerId, failed);
  const p1 = await row(P);
  check('a provider failure while creating the subscription is answered as an error', true, failed.status >= 400);
  check('a provider failure while creating the subscription leaves the company as it was: in its trial, no provider subscription recorded', ['trial', 'trialing', null], [p1.plan, p1.status, p1.stripeSubscriptionId]);
  const recovered = await subscribe(P.pm, 'individual', 'monthly');
  const p2 = await row(P);
  check('after a provider failure while creating the subscription, the retry subscribes the company', [200, 'individual', 'active'], [recovered.status, p2.plan, p2.status]);
  const held = await providerSubscription(p2.stripeSubscriptionId);
  check("after that retry the provider holds the subscription the row names, on the company's customer and price", [p0.stripeCustomerId, priceOf('individual', 'monthly')], [held?.customer, providerPrice(held)]);

  // A transient failure (500) is retried by the provider's client library; the product should not notice.
  const transientMark = Date.now();
  await stage(`/v1/subscriptions/${p2.stripeSubscriptionId}`, 500);
  const upgraded = await subscribe(P.pm, 'business', 'monthly');
  await mustHaveReached('the staged transient failure', transientMark, (c) => c.path === `/v1/subscriptions/${p2.stripeSubscriptionId}`, upgraded);
  const p3 = await row(P);
  check('one transient provider error (500) during an upgrade is absorbed: the company is upgraded', [200, 'business', 'active'], [upgraded.status, p3.plan, p3.status]);
  check('after the absorbed transient error the provider bills the business price on the same subscription', [p2.stripeSubscriptionId, priceOf('business', 'monthly')], [p3.stripeSubscriptionId, providerPrice(await providerSubscription(p3.stripeSubscriptionId))]);

  // A failure while looking up the running subscription (not "no such subscription").
  const lookupMark = Date.now();
  await stage(`/v1/subscriptions/${p3.stripeSubscriptionId}`, 400);
  const lookup = await subscribe(P.pm, 'business', 'annual');
  await mustHaveReached('the staged lookup failure', lookupMark, (c) => c.method === 'GET' && c.path === `/v1/subscriptions/${p3.stripeSubscriptionId}`, lookup);
  // subscription.service.js subscribe: only "no such subscription" means none; any other lookup error is rethrown.
  check('a provider failure while looking up the running subscription is answered as an error', true, lookup.status >= 400, `answered ${lookup.status} ${errorCode(lookup) || ''}`);
  const p4 = await row(P);
  const afterLookup = creations(await providerCalls(mark, p0.stripeCustomerId));
  check('a provider failure while looking up the running subscription changes nothing and creates no second subscription', ['business', 'monthly', p3.stripeSubscriptionId, 2], [p4.plan, p4.billingCycle, p4.stripeSubscriptionId, afterLookup.length], 'two creations: the staged failure and its retry, above');

  // A failure during cancel.
  const cancelMark = Date.now();
  await stage(`/v1/subscriptions/${p3.stripeSubscriptionId}`, 400);
  const stopFailed = await cancel(P.pm);
  await mustHaveReached('the staged cancel failure', cancelMark, (c) => c.method === 'POST' && c.path === `/v1/subscriptions/${p3.stripeSubscriptionId}`, stopFailed);
  check('a provider failure during cancel is answered as an error', true, stopFailed.status >= 400, `answered ${stopFailed.status} ${errorCode(stopFailed) || ''}`);
  const p5 = await row(P);
  const stillRunning = await providerSubscription(p3.stripeSubscriptionId);
  check('a provider failure during cancel leaves the company active here and running at the provider', ['active', false, false], [p5.status, p5.cancelAtPeriodEnd, stillRunning?.cancel_at_period_end]);
  const stopped = await cancel(P.pm);
  const p6 = await row(P);
  const ending = await providerSubscription(p3.stripeSubscriptionId);
  check('after a provider failure during cancel, the retry cancels the subscription on both sides', [200, 'canceled', true, true], [stopped.status, p6.status, p6.cancelAtPeriodEnd, ending?.cancel_at_period_end]);

  // The provider created the subscription but the product's own write was lost (a crash or a timeout between the two).
  const L = await company('lost local write', 939);
  await beginTrial(L, visa('L'));
  must('first subscribe', await subscribe(L.pm, 'individual', 'monthly'), 200);
  const l1 = await row(L);
  const lost = { plan: 'trial', status: 'trialing', billingCycle: null, stripeSubscriptionId: null, currentPeriodEnd: null };
  await db.set(L.orgId, lost);
  const replay = await subscribe(L.pm, 'individual', 'monthly');
  const l2 = await row(L);
  check('staged: the provider holds a subscription the row never recorded; the same subscribe again gets that subscription back, not a second one', [200, l1.stripeSubscriptionId], [replay.status, l2.stripeSubscriptionId]);
  await db.set(L.orgId, lost);
  const otherChoice = await subscribe(L.pm, 'individual', 'annual');
  const l3 = await row(L);
  const live = [];
  for (const id of unique([l1.stripeSubscriptionId, l3.stripeSubscriptionId])) if (isLive(await providerSubscription(id))) live.push(id);
  // ISO-3 was called NEW-3 in earlier runs.
  finding('ISO-3', 'staged: after such a lost write, a retry that picks the other billing cycle leaves the company with one running provider subscription', 1, live.length, `P2: answered ${otherChoice.status}; the row names ${l3.stripeSubscriptionId}, the provider also still bills ${l1.stripeSubscriptionId}`);

  // An in-place upgrade whose payment fails at the provider.
  const Q = await company('upgrade payment fails', 939);
  await beginTrial(Q, visa('Q'));
  must('first subscribe', await subscribe(Q.pm, 'individual', 'monthly'), 200);
  const q1 = await row(Q);
  await fake.set({ subscriptionStatus: { [q1.stripeSubscriptionId]: 'past_due' } });
  const upgrade = await subscribe(Q.pm, 'business', 'monthly');
  const q2 = await row(Q);
  const atProvider = await providerSubscription(q1.stripeSubscriptionId);
  await fake.set({ subscriptionStatus: { [q1.stripeSubscriptionId]: null } });
  finding('D12', "after an in-place upgrade the provider answers 'past_due' (the payment failed): the row's status says the same", { provider: 'past_due', row: 'past_due' }, { provider: atProvider?.status, row: q2.status }, `P2: answered ${upgrade.status}; the row is ${q2.plan}/${q2.status}`);
};

// ── 9. The population ──────────────────────────────────────────────────────

const BILLING_SUITE_COMPANY = /^CERT 9\d\d /;
const BILLING_SUITE_PERSONAL = /^Billing Owner [0-9a-f]{8}'s workspace$/;
const OWN_RANGE = /\(CERT-93\d\)$/;

/**
 * Other billing suites may run beside this one, on their own companies (their own codes). A company is judged here
 * when it belongs to the certification population (no billing-suite name) or was left by an earlier run of this suite.
 */
const isOtherSuite = (name) => (BILLING_SUITE_COMPANY.test(name) && !OWN_RANGE.test(name)) || BILLING_SUITE_PERSONAL.test(name);

const populationUntouched = async ({ before, snapshotBefore, suiteMark }) => {
  const after = await census();
  const snapshotAfter = await db.snapshot();
  const moved = [...after.entries()].filter(([orgId, entry]) => before.get(orgId)?.print !== entry.print).map(([orgId, entry]) => ({ orgId, name: entry.name }));
  const gone = [...before.entries()].filter(([orgId]) => !after.has(orgId)).map(([orgId, entry]) => ({ orgId, name: entry.name }));
  const strangers = [...moved, ...gone].filter((entry) => !mine.has(entry.orgId));
  const population = strangers.filter((entry) => !BILLING_SUITE_COMPANY.test(entry.name) && !BILLING_SUITE_PERSONAL.test(entry.name));
  const ownRange = strangers.filter((entry) => OWN_RANGE.test(entry.name));
  const otherSuites = strangers.filter((entry) => isOtherSuite(entry.name));
  check('this suite changed billing in the companies it onboarded', true, moved.some((entry) => mine.has(entry.orgId)), `${moved.filter((entry) => mine.has(entry.orgId)).length} of its ${mine.size} workspaces have a new or changed subscription`);
  check('no company of the certification population had its subscription, cards, invoices or leads changed while the suite ran', [], population.map((entry) => entry.name), `${before.size} subscriptions before, ${after.size} after`);
  check('no company left by an earlier run of this suite (codes 930–939) changed either', [], ownRange.map((entry) => entry.name));
  const bySnapshot = db.changed(snapshotBefore, snapshotAfter).filter((orgId) => !mine.has(orgId)).map((orgId) => after.get(orgId)?.name || orgId).filter((name) => !isOtherSuite(name));
  check("the library's own snapshot says the same: every subscription that differs is this suite's own", [], bySnapshot);
  if (otherSuites.length) console.log(`        (${otherSuites.length} workspaces of other billing suites, running at the same time on their own codes, changed and are not otherwise judged here)`);

  // Other suites' companies are left out of the comparisons above — they change for their own reasons — but none of
  // them may hold anything this run made: every card id (pm_…_<RUN>) and invoice id (in_cert_…_<RUN>) this run sends
  // ends with its suffix.
  const suffix = `_${RUN}`;
  const carriesThisRun = (entry) => {
    const now = after.get(entry.orgId);
    if (!now) return false;
    const { subscription } = JSON.parse(now.print);
    return (subscription?.paymentMethods || []).some((p) => String(p.stripePaymentMethodId || '').endsWith(suffix))
      || (subscription?.invoices || []).some((i) => String(i.stripeInvoiceId || '').endsWith(suffix));
  };
  check(`no workspace of another billing suite holds a card or an invoice of this run (ids ending ${suffix})`, [], otherSuites.filter(carriesThisRun).map((entry) => entry.name), `${otherSuites.length} workspaces of other suites changed while the suite ran and were read`);

  // Across everything the provider was asked since the suite began, by any suite. Nothing read is nothing judged,
  // so the log must hold at least one such key (this suite alone creates several).
  const customersByKey = new Map();
  for (const call of creations(await fake.since(suiteMark))) {
    if (!String(call.idempotencyKey || '').startsWith('subscribe:')) continue;
    customersByKey.set(call.idempotencyKey, unique([...(customersByKey.get(call.idempotencyKey) || []), call.body?.customer]));
  }
  check(
    'no provider key for creating a subscription was ever used for two different customers (and the fake\'s log holds such keys to judge)',
    { keysRead: 'at least one', usedForTwoCustomers: [] },
    { keysRead: customersByKey.size > 0 ? 'at least one' : 'none', usedForTwoCustomers: [...customersByKey.entries()].filter(([, customers]) => customers.length > 1).map(([key]) => key) },
    `${customersByKey.size} keys read from the fake's log`
  );
};

// ── run ────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log(`${SUITE} — run ${RUN}`);
  // Nothing runs unless the fake is local, answers, and is the one the billing API's Stripe calls reach.
  await preflight(await company('isolation probe', 930));
  const suiteMark = Date.now();
  const before = await census();
  const snapshotBefore = await db.snapshot();
  const shared = {};
  await section('1. A, B, C: every billing route as A with B\'s identifiers', () => isolationBetweenCompanies(shared));
  await section('2. A payment method the provider says belongs to another customer', foreignPaymentMethod);
  await section('3. One person, two companies', () => onePersonTwoCompanies(shared));
  await section('4. Roles and API keys', () => rolesAndKeys(shared));
  await section('5. Trial races', trialRaces);
  await section('6. Subscribe races', subscribeRaces);
  await section('7. Declined, then another card', declinedThenAnotherCard);
  await section('8. Provider failures in the middle', providerFailures);
  await section('9. The population', () => populationUntouched({ before, snapshotBefore, suiteMark }));
  await finish(SUITE);
  reportOwnerDecisions(SUITE);
};

main().catch(async (error) => {
  console.error(error);
  reportOwnerDecisions(`${SUITE} (STOPPED by an error before the end)`);
  process.exitCode = 1;
});
