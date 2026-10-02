'use strict';

/**
 * Billing certification — provider events (POST /api/v1/webhooks/stripe).
 *
 *   node scripts/cert/billing/suite-webhooks.js
 *
 * The question: when the payment provider tells the product something, is it
 * believed only when it is genuine, applied once, applied in the right order,
 * and applied to the right company — and to no other?
 *
 * Sections
 *   1  signature            who is believed: nine ways of not being the provider
 *   2  duplicates           the same event delivered twice
 *   3  order                late and stale events, and what access the company ends with
 *   4  which company        events that name no company, a wrong one, or somebody else's
 *   5  one customer id on two companies
 *   6  life cycle           unknown types, failure, recovery, deletion, currencies
 *   7  replay               a once-valid delivery sent again after its 300 seconds
 *
 * Every company the suite acts on is created here, through the product's own
 * sign-up (codes 920–928). Section 4 is the exception, knowingly: an event
 * that names no company is applied by the product to whichever subscription
 * its lookup returns first, which is a company this suite did not create.
 * Each such company is put back exactly as it was (its row, and the invoice
 * the event left on it removed) and named at the end of the run.
 *
 * "No other company moved" is read from db.snapshot() before and after each
 * delivery. Other billing suites run against the same database at the same
 * time and change their own companies; those (CERT-9xx outside 920–929, and
 * the personal workspaces their owners sign up with) are left out of that
 * comparison unless the event of this suite can be shown to have reached
 * them — by the invoice it left there, or because the product's own lookup
 * returns them.
 *
 * A case written with finding(id, …) states the CORRECT behaviour: it fails
 * while the defect exists and passes once it is fixed.
 */

const crypto = require('crypto');
const { check, db, fake, finding, finish, onboard, webhook } = require('./lib');

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => crypto.randomBytes(5).toString('hex');
const section = (title) => console.log(`\n── ${title} ──`);

const REFUSED_NO_SUBSCRIPTION = [402, 'SUBSCRIPTION_REQUIRED'];

// ── companies ──────────────────────────────────────────────────────────────

/** Every workspace this run created (company and personal). */
const mine = new Set();
const names = new Map();
const nameOf = async (orgId) => {
  if (!names.has(orgId)) {
    const org = await (await db.prisma()).organisation.findUnique({ where: { id: orgId }, select: { name: true } });
    names.set(orgId, org ? org.name : `(no organisation ${orgId})`);
  }
  return names.get(orgId);
};

/** A company another billing suite owns: it changes for that suite's reasons while this one runs. */
const anotherSuites = (orgId, name) => {
  if (mine.has(orgId)) return false;
  const code = /\(CERT-(\d{3})\)$/.exec(name || '');
  if (code) return Number(code[1]) >= 900 && !(Number(code[1]) >= 920 && Number(code[1]) <= 929);
  return /^Billing Owner /.test(name || '');
};

const must = (what, res, status = 200) => {
  if (res.status !== status) throw new Error(`setup: ${what} answered ${res.status} ${String(res.text).slice(0, 200)}`);
};

/**
 * The provider ids the webhook resolves a company by must belong to this
 * company alone. They do unless somebody reset the Stripe fake (its counter
 * starts again and hands out ids the database already holds); then they are
 * staged afresh.
 */
const ownIds = async (company) => {
  const prisma = await db.prisma();
  const row = await db.subscription(company.orgId);
  const data = {};
  for (const [field, prefix] of [['stripeCustomerId', 'cus'], ['stripeSubscriptionId', 'sub']]) {
    if (row[field] && (await prisma.subscription.count({ where: { [field]: row[field] } })) > 1) data[field] = `${prefix}_cert92x_${stamp()}`;
  }
  if (Object.keys(data).length === 0) return;
  console.log(`        (setup: ${company.name} was handed provider ids another company already holds — the Stripe fake was reset; staged fresh ones)`);
  await db.set(company.orgId, data);
  if (data.stripeSubscriptionId) await fake.set({ subscriptionStatus: { [data.stripeSubscriptionId]: 'active' } });
};

/**
 * The machine is shared with other suites, and under load two things fail for
 * reasons that have nothing to do with billing: a sign-up can run past its
 * five-second transaction (500), and the first database connection can time
 * out. Both are tried again; neither is a case.
 */
const patiently = async (what, attempt, tries = 4) => {
  for (let n = 1; ; n += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (n === tries) throw error;
      console.log(`        (setup: ${what} failed under load — ${String(error.message).replace(/\s+/g, ' ').slice(0, 110)} — trying again)`);
      await sleep(3000 * n);
    }
  }
};
/** lib.js keeps its first connection attempt, failed or not: make sure the database answers before it is asked. */
const databaseReady = async () => {
  // eslint-disable-next-line global-require
  const guard = require('../lib/cert-env');
  await patiently('the database connection', async () => (await guard.connectCertPrisma()).$disconnect());
  await db.prisma();
};

/** A new company in a running card trial. */
const trialing = async (label, code) => {
  const company = await patiently(`the sign-up of "${label}"`, () => onboard(label, code));
  mine.add(company.orgId);
  if (company.personalOrgId) mine.add(company.personalOrgId);
  names.set(company.orgId, company.name);
  must('trial/start', await company.pm.send('POST', '/billing/trial/start', {}));
  must('trial/confirm', await company.pm.send('POST', '/billing/trial/confirm', { paymentMethodId: `pm_card_visa_${stamp()}` }));
  await ownIds(company);
  const row = await db.subscription(company.orgId);
  if (row.status !== 'trialing' || !row.stripeCustomerId) throw new Error(`setup: ${label} is ${row.plan}/${row.status}, not a running trial`);
  return { ...company, customer: row.stripeCustomerId, subscription: null };
};

/** A new company paying for the business plan: active, with a provider customer and subscription of its own. */
const paying = async (label, code) => {
  const company = await trialing(label, code);
  must('subscribe', await company.pm.send('POST', '/billing/subscribe', { plan: 'business', billingCycle: 'monthly' }));
  await ownIds(company);
  const row = await db.subscription(company.orgId);
  if (row.status !== 'active' || !row.stripeSubscriptionId) throw new Error(`setup: ${label} is ${row.plan}/${row.status}, not an active subscription`);
  return { ...company, customer: row.stripeCustomerId, subscription: row.stripeSubscriptionId };
};

const lazily = (make) => {
  let promise = null;
  return () => (promise = promise || make());
};

const row = (company) => db.subscription(company.orgId);
const statusOf = async (company) => (await row(company)).status;

/** Can the company write? It tries to create a project: [201, null] or [status, error code]. */
const canWrite = async (company) => {
  const res = await company.pm.send('POST', '/projects', { name: `Webhook access probe ${stamp()}` });
  return [res.status, res.status === 201 ? null : res.body?.error?.code ?? null];
};
const ALLOWED = [201, null];

// ── events ─────────────────────────────────────────────────────────────────

const period = () => ({ start: now(), end: now() + 30 * DAY });
const paidInvoice = (customer, overrides = {}) => ({
  id: `in_cert_${stamp()}`,
  object: 'invoice',
  customer,
  amount_paid: 49900,
  currency: 'usd',
  lines: { data: [{ description: 'Business (monthly)', period: period() }] },
  ...overrides,
});
const failedInvoice = (customer, overrides = {}) => ({ id: `in_cert_${stamp()}`, object: 'invoice', customer, amount_due: 49900, currency: 'usd', ...overrides });
const without = (object, field) => {
  const copy = { ...object };
  delete copy[field];
  return copy;
};

/**
 * The webhook door takes 120 deliveries a minute from one address, and every
 * suite shares the address. A 429 is that limit, not an answer about the
 * event: wait the window out and send again.
 */
const deliverRaw = async (payload, signature, headers) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await webhook.sendRaw(payload, typeof signature === 'function' ? signature() : signature, headers);
    if (res.status !== 429 || attempt === 3) return res;
    let seconds = 20;
    try {
      seconds = JSON.parse(res.text).error.details.retryAfterSeconds || seconds;
    } catch {
      /* keep the default */
    }
    console.log(`        (the limit of webhook deliveries per minute was reached; waiting ${seconds + 1} s)`);
    await sleep((seconds + 1) * 1000);
  }
};
/** Posts an event, correctly signed at the moment it is sent. */
const deliver = (event, options = {}) => {
  const payload = JSON.stringify(event);
  return deliverRaw(payload, () => webhook.sign(payload, options));
};

const invoicesOf = async (stripeInvoiceId) =>
  (await db.prisma()).invoice.findMany({ where: { stripeInvoiceId }, include: { subscription: { select: { orgId: true } } } });
const invoiceCount = async (stripeInvoiceId) => (await invoicesOf(stripeInvoiceId)).length;

// ── who moved ──────────────────────────────────────────────────────────────

/**
 * Runs `act` and names every company, other than the intended ones, whose
 * subscription row differs afterwards.
 */
const during = async (intended, act) => {
  const before = await db.snapshot();
  const result = await act();
  const after = await db.snapshot();
  const others = [];
  for (const orgId of db.changed(before, after)) {
    if (intended.includes(orgId)) continue;
    const name = await nameOf(orgId);
    if (!anotherSuites(orgId, name)) others.push(name);
  }
  return { result, others: others.sort() };
};
const nobodyElse = (name, others) => check(`${name}: no other company's subscription moved`, [], others);

/** What section 4 did to companies this suite did not intend to touch. */
const hits = [];
let everyHitRestored = true;

const RESTORABLE = ['plan', 'billingCycle', 'status', 'seats', 'trialStartsAt', 'trialEndsAt', 'currentPeriodEnd', 'cancelAtPeriodEnd', 'canceledAt', 'aiGenerationsUsed', 'periodResetAt', 'reminderDay5SentAt', 'reminderDay7SentAt', 'stripeCustomerId', 'stripeSubscriptionId', 'updatedAt'];

/**
 * Delivers an event that names no company this suite intends, and finds out
 * whom the product applied it to:
 *   - every company now holding an invoice with this event's invoice id;
 *   - the company the handler's own lookup returns for the identifier the event carries
 *     (the same query, asked just before the delivery), if its row moved;
 *   - any other company whose row moved (another suite's companies excepted).
 * Then every one of them is put back exactly as it was.
 * Returns the names of the companies touched.
 */
const stray = async (what, event) => {
  const prisma = await db.prisma();
  const object = event.data.object;
  const isInvoice = event.type.startsWith('invoice.');
  const fullRows = async () => new Map((await prisma.subscription.findMany()).map((r) => [r.orgId, r]));

  let predicted = null;
  try {
    predicted = await prisma.subscription.findFirst({ where: isInvoice ? { stripeCustomerId: object.customer } : { stripeSubscriptionId: object.id } });
  } catch {
    predicted = null; // an identifier the database cannot even be asked about
  }
  const rowsBefore = await fullRows();
  const before = await db.snapshot();
  const res = await deliver(event);
  const after = await db.snapshot();
  const rowsAfter = await fullRows();
  const left = isInvoice && object.id ? await invoicesOf(object.id) : [];

  const touched = new Set(left.map((invoice) => invoice.subscription.orgId));
  for (const orgId of db.changed(before, after)) {
    const name = await nameOf(orgId);
    const lookedUp = predicted && predicted.orgId === orgId && (isInvoice || rowsAfter.get(orgId)?.status === 'expired');
    if (lookedUp || !anotherSuites(orgId, name)) touched.add(orgId);
  }

  const touchedNames = [];
  for (const orgId of touched) {
    const name = await nameOf(orgId);
    touchedNames.push(name);
    const was = rowsBefore.get(orgId);
    const became = rowsAfter.get(orgId);
    const strayInvoices = left.filter((invoice) => invoice.subscription.orgId === orgId);
    // Put it back: the invoice this event left there, then the row itself.
    if (strayInvoices.length) await prisma.invoice.deleteMany({ where: { id: { in: strayInvoices.map((invoice) => invoice.id) } } });
    if (was) await db.set(orgId, Object.fromEntries(RESTORABLE.map((field) => [field, was[field]])));
    const restored = await prisma.subscription.findUnique({ where: { orgId } });
    const exact = Boolean(was) && JSON.stringify(restored) === JSON.stringify(was) && (!object.id || !isInvoice || (await invoiceCount(object.id)) === 0);
    if (!exact) everyHitRestored = false;
    hits.push({ event: what, company: name, created: mine.has(orgId) ? 'by this run' : 'NOT by this suite', was: `${was?.plan}/${was?.status}`, became: `${became?.plan}/${became?.status}`, invoices: strayInvoices.map((invoice) => `${invoice.status} ${Number(invoice.amount)} ${invoice.currency}`), restored: exact });
  }
  return { status: res.status, text: res.text, touched: touchedNames.sort() };
};

// ── 1. signature ───────────────────────────────────────────────────────────

const S = lazily(() => paying('signature and duplicates', 920));
/** The delivery section 7 replays: its bytes, its signature and when it was signed. */
let earlier = null;

const signatures = async () => {
  section('1. Signature — who is believed');
  const s = await S();
  const refusedInvoiceIds = [];
  /** An event that would mark the company past due if it were believed. */
  const wouldMatter = () => {
    const event = webhook.event('invoice.payment_failed', failedInvoice(s.customer));
    refusedInvoiceIds.push(event.data.object.id);
    return JSON.stringify(event);
  };
  const refusal = async (name, send, expected = 400) => {
    const { result, others } = await during([], send);
    check(`${name} is refused`, expected, result.status, result.status === expected ? '' : result.text.slice(0, 160));
    check(`${name}: no company's subscription moved`, [], others);
  };

  // The control: a genuine delivery is believed. It is signed 280 seconds in the past —
  // still inside the provider's 300-second window — so that section 7 can replay it once it is outside.
  {
    const event = webhook.event('invoice.paid', paidInvoice(s.customer));
    const payload = JSON.stringify(event);
    let header = null;
    let signedAt = null;
    const { result, others } = await during([s.orgId], () =>
      deliverRaw(payload, () => {
        signedAt = now() - 280;
        header = webhook.sign(payload, { timestamp: signedAt });
        return header;
      })
    );
    earlier = { payload, header, signedAt, invoiceId: event.data.object.id };
    check('a correctly signed delivery, signed 280 seconds ago, is accepted', 200, result.status, result.text.slice(0, 120));
    check('…and records its one paid invoice', 1, await invoiceCount(earlier.invoiceId));
    nobodyElse('the accepted delivery', others);
  }

  {
    const payload = wouldMatter();
    await refusal('a delivery with no signature header', () => deliverRaw(payload, null));
  }
  {
    const payload = wouldMatter();
    await refusal('a delivery with a signature that matches nothing', () => deliverRaw(payload, () => `t=${now()},v1=${'0'.repeat(64)}`));
  }
  {
    const payload = wouldMatter();
    const otherSecret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
    await refusal('a delivery signed with another secret', () => deliverRaw(payload, () => webhook.sign(payload, { secret: otherSecret })));
  }
  {
    const payload = wouldMatter();
    const altered = payload.replace('"amount_due":49900', '"amount_due":100');
    if (altered === payload) throw new Error('the alteration changed nothing');
    await refusal('a correctly signed delivery whose body was altered afterwards', () => deliverRaw(altered, () => webhook.sign(payload)));
  }
  {
    const payload = wouldMatter();
    await refusal('a delivery whose signature timestamp is 305 seconds old', () => deliverRaw(payload, () => webhook.sign(payload, { timestamp: now() - 305 })));
  }
  {
    const payload = wouldMatter();
    await refusal('a delivery carrying the right digest under the wrong scheme (v0 instead of v1)', () => deliverRaw(payload, () => webhook.sign(payload).replace(',v1=', ',v0=')));
  }
  {
    const payload = 'this is not json';
    await refusal('a correctly signed body that is not JSON', () => deliverRaw(payload, () => webhook.sign(payload)));
  }
  {
    await refusal('a correctly signed empty body', () => deliverRaw('', () => webhook.sign('')));
  }
  {
    const payload = wouldMatter();
    await refusal('a correctly signed delivery sent as text/plain instead of application/json', () => deliverRaw(payload, () => webhook.sign(payload), { 'content-type': 'text/plain' }));
  }
  check('none of the refused deliveries recorded an invoice', 0, (await Promise.all(refusedInvoiceIds.map(invoiceCount))).reduce((a, b) => a + b, 0));
  check('after all the refusals the company is still active', 'active', await statusOf(s));

  // A genuine event can be large. The product stops reading at 100 kb.
  {
    const event = webhook.event('invoice.paid', paidInvoice(s.customer, { cert_padding: 'x'.repeat(110 * 1024) }));
    const { result, others } = await during([s.orgId], () => deliver(event));
    finding('D23', 'a correctly signed event larger than 100 kb is accepted', 200, result.status, `answer: ${result.text.slice(0, 120)}`);
    nobodyElse('the large delivery', others);
  }
};

// ── 2. duplicates ──────────────────────────────────────────────────────────

const duplicates = async () => {
  section('2. The same event delivered twice');
  const s = await S();

  // (a) the provider's retry: the same id, the same bytes, the same signature
  const label = `Business (monthly) duplicate ${stamp()}`;
  const event = webhook.event('invoice.paid', paidInvoice(s.customer, { lines: { data: [{ description: label, period: period() }] } }));
  const payload = JSON.stringify(event);
  const header = webhook.sign(payload);
  const first = await during([s.orgId], () => deliverRaw(payload, header));
  check('an invoice.paid delivery is accepted', 200, first.result.status, first.result.text.slice(0, 120));
  check('…and records one paid invoice', 1, await invoiceCount(event.data.object.id));
  nobodyElse('the first delivery', first.others);
  const second = await during([s.orgId], () => deliverRaw(payload, header));
  check('the same delivery sent again (same event id, same bytes, same signature) is acknowledged', 200, second.result.status);
  finding('D4', 'a second delivery of the same invoice.paid event does not record a second invoice', 1, await invoiceCount(event.data.object.id));
  nobodyElse('the second delivery', second.others);
  const list = await s.pm.send('GET', '/billing/transactions');
  must('GET /billing/transactions', list);
  finding('D4', "the company's own transaction list shows that payment once", 1, (list.body?.data || []).filter((entry) => entry.description === label).length);

  // (b) the same event, signed again later (a retry the provider signs afresh)
  const again = webhook.event('invoice.paid', paidInvoice(s.customer));
  must('first delivery of the re-signed event', await deliver(again));
  await sleep(1100);
  const resigned = await during([s.orgId], () => deliver(again));
  check('the same event signed again a second later is acknowledged', 200, resigned.result.status);
  finding('D4', 'the same invoice.paid event signed again and re-delivered does not record another invoice', 1, await invoiceCount(again.data.object.id));
  nobodyElse('the re-signed delivery', resigned.others);

  // (c) the same for a failed payment
  const failed = webhook.event('invoice.payment_failed', failedInvoice(s.customer));
  must('first delivery of the failed payment', await deliver(failed));
  const failedAgain = await during([s.orgId], () => deliver(failed));
  check('a repeated invoice.payment_failed delivery is acknowledged', 200, failedAgain.result.status);
  finding('D4', 'a second delivery of the same invoice.payment_failed event does not record a second failed invoice', 1, await invoiceCount(failed.data.object.id));
  nobodyElse('the repeated failed payment', failedAgain.others);
};

// ── 3. order ───────────────────────────────────────────────────────────────

const order = async () => {
  section('3. Late and stale events — the state the company ends in, and whether it can write');
  const hourAgo = () => now() - 3600;

  // (a) the provider deleted the subscription; then a failed-payment event from before the deletion arrives
  {
    const company = await paying('deleted then failed', 921);
    const deleted = await during([company.orgId], () => deliver(webhook.event('customer.subscription.deleted', { id: company.subscription, object: 'subscription', customer: company.customer })));
    check('(a) a subscription the provider deleted is expired', 'expired', await statusOf(company), `delivery answered ${deleted.result.status}`);
    nobodyElse('(a) the deletion', deleted.others);
    check('(a) and the expired company cannot write', REFUSED_NO_SUBSCRIPTION, await canWrite(company));
    const late = await during([company.orgId], () => deliver(webhook.event('invoice.payment_failed', failedInvoice(company.customer), { created: hourAgo() })));
    finding('D3', '(a) a failed-payment event from before the deletion, arriving after it, leaves the company expired', 'expired', await statusOf(company), `delivery answered ${late.result.status}`);
    nobodyElse('(a) the late failed payment', late.others);
    finding('D3', '(a) and the company whose subscription was deleted still cannot write', REFUSED_NO_SUBSCRIPTION, await canWrite(company));
  }

  // (b) expired; then a paid event from before the deletion arrives
  {
    const company = await paying('expired then paid', 922);
    must('deletion', await deliver(webhook.event('customer.subscription.deleted', { id: company.subscription, object: 'subscription', customer: company.customer })));
    if ((await statusOf(company)) !== 'expired') throw new Error('setup: the deletion did not expire the company');
    const late = await during([company.orgId], () => deliver(webhook.event('invoice.paid', paidInvoice(company.customer), { created: hourAgo() })));
    finding('D3', '(b) a paid event from before the deletion, arriving after it, leaves the company expired', 'expired', await statusOf(company), `delivery answered ${late.result.status}`);
    nobodyElse('(b) the late paid event', late.others);
    finding('D3', '(b) and the company whose subscription was deleted still cannot write', REFUSED_NO_SUBSCRIPTION, await canWrite(company));
  }

  // (c) the invoice was paid; then the OLDER failed attempt for the same invoice arrives
  {
    const company = await paying('paid then older failed', 923);
    const invoiceId = `in_cert_${stamp()}`;
    must('paid', await deliver(webhook.event('invoice.paid', paidInvoice(company.customer, { id: invoiceId }))));
    check('(c) a paid invoice leaves the company active', 'active', await statusOf(company));
    const late = await during([company.orgId], () => deliver(webhook.event('invoice.payment_failed', failedInvoice(company.customer, { id: invoiceId }), { created: hourAgo() })));
    finding('D3', '(c) the older failed attempt for that same invoice, arriving after the payment, leaves the company active', 'active', await statusOf(company), `delivery answered ${late.result.status}`);
    nobodyElse('(c) the older failed attempt', late.others);
    check('(c) whichever it is called, that company can still write', ALLOWED, await canWrite(company));
  }

  // (d) the company asked to cancel; then a paid event arrives
  {
    const company = await paying('cancel then paid', 924);
    must('cancel', await company.pm.send('POST', '/billing/cancel', {}));
    const cancelled = await row(company);
    check('(d) a company that asks to cancel is cancelled at the end of its period', ['canceled', true], [cancelled.status, cancelled.cancelAtPeriodEnd]);
    // The control: what cancelling means once the paid period is over (time staged, then put back).
    await db.set(company.orgId, { currentPeriodEnd: new Date(Date.now() - DAY * 1000) });
    check('(d) control: once its paid period is over, a cancelled company cannot write', REFUSED_NO_SUBSCRIPTION, await canWrite(company));
    await db.set(company.orgId, { currentPeriodEnd: cancelled.currentPeriodEnd });

    const late = await during([company.orgId], () => deliver(webhook.event('invoice.paid', paidInvoice(company.customer))));
    const after = await row(company);
    finding('D20', '(d) a paid event arriving after the cancel request leaves the cancellation standing', ['canceled', true], [after.status, after.cancelAtPeriodEnd], `delivery answered ${late.result.status}`);
    nobodyElse('(d) the paid event after the cancel request', late.others);
    await db.set(company.orgId, { currentPeriodEnd: new Date(Date.now() - DAY * 1000) });
    finding('D20', '(d) and once the paid period is over, the company that cancelled cannot write', REFUSED_NO_SUBSCRIPTION, await canWrite(company));
  }

  // (e) a company in its free trial — no paid subscription exists — receives a paid event
  {
    const company = await trialing('trial then paid', 925);
    const started = await row(company);
    await db.set(company.orgId, { trialEndsAt: new Date(Date.now() - DAY * 1000) });
    check('(e) control: once its trial days are over, a trial company cannot write', REFUSED_NO_SUBSCRIPTION, await canWrite(company));
    await db.set(company.orgId, { trialEndsAt: started.trialEndsAt });

    const paid = await during([company.orgId], () => deliver(webhook.event('invoice.paid', paidInvoice(company.customer))));
    const after = await row(company);
    finding('NEW-1', '(e) a paid event for a company in its free trial, which has no paid subscription, leaves it a trial', ['trial', 'trialing'], [after.plan, after.status], `delivery answered ${paid.result.status}`);
    nobodyElse('(e) the paid event during a trial', paid.others);
    await db.set(company.orgId, { trialEndsAt: new Date(Date.now() - DAY * 1000) });
    finding('NEW-1', '(e) and once the trial days are over that company cannot write', REFUSED_NO_SUBSCRIPTION, await canWrite(company));
  }
};

// ── 4. which company ───────────────────────────────────────────────────────

const R1 = lazily(() => paying('resolution named', 926));
const R2 = lazily(() => paying('resolution bystander', 927));

const whichCompany = async () => {
  section('4. Which company an event is applied to');
  const named = await R1();
  const bystander = await R2();

  // Events that name no company at all. The correct answer is that nobody is touched.
  const nobody = async (id, name, event) => {
    const { status, touched } = await stray(name, event);
    (id ? finding.bind(null, id) : check)(`${name} touches no company`, [], touched, `delivery answered ${status}`);
    return status;
  };
  await nobody('D2', 'invoice.payment_failed with no customer field', webhook.event('invoice.payment_failed', without(failedInvoice('unused'), 'customer')));
  await nobody('D2', 'invoice.paid with no customer field', webhook.event('invoice.paid', without(paidInvoice('unused'), 'customer')));
  await nobody('D2', 'invoice.payment_failed with customer: null', webhook.event('invoice.payment_failed', failedInvoice(null)));
  await nobody('D2', 'invoice.paid with customer: null', webhook.event('invoice.paid', paidInvoice(null)));
  await nobody(null, 'invoice.payment_failed with customer: ""', webhook.event('invoice.payment_failed', failedInvoice('')));
  await nobody(null, 'invoice.paid with customer: ""', webhook.event('invoice.paid', paidInvoice('')));
  await nobody(null, 'invoice.payment_failed naming a customer id no company holds', webhook.event('invoice.payment_failed', failedInvoice(`cus_nobody_${stamp()}`)));
  await nobody(null, 'invoice.paid naming a customer id no company holds', webhook.event('invoice.paid', paidInvoice(`cus_nobody_${stamp()}`)));
  await nobody('D2', 'customer.subscription.deleted with no id', webhook.event('customer.subscription.deleted', { object: 'subscription', customer: `cus_nobody_${stamp()}` }));
  await nobody('D2', 'customer.subscription.deleted with id: null', webhook.event('customer.subscription.deleted', { id: null, object: 'subscription', customer: `cus_nobody_${stamp()}` }));
  await nobody(null, 'customer.subscription.deleted with id: ""', webhook.event('customer.subscription.deleted', { id: '', object: 'subscription' }));
  await nobody(null, 'customer.subscription.deleted naming a subscription id no company holds', webhook.event('customer.subscription.deleted', { id: `sub_nobody_${stamp()}`, object: 'subscription' }));
  // The customer as an object (the provider's "expanded" form) instead of an id.
  const answered = await nobody(null, 'invoice.payment_failed whose customer is an object, not an id', webhook.event('invoice.payment_failed', failedInvoice({ id: named.customer, object: 'customer' })));
  finding('NEW-4', '…and that event is answered without a server error (the provider re-sends a 5xx for days)', true, answered < 500, `delivery answered ${answered}`);
  check('every company those events touched was put back exactly as it was', true, everyHitRestored, `${hits.length} restored`);

  // Events that name one company's customer and, everywhere else, another company.
  {
    // "About" the named company in every field the handler does not read; the customer id is the bystander's.
    const event = webhook.event('invoice.payment_failed', failedInvoice(bystander.customer, { subscription: named.subscription, metadata: { orgId: named.orgId }, customer_name: named.name }));
    const { result, others } = await during([bystander.orgId], () => deliver(event));
    // Decision (certification, D2 fix): an event whose customer id belongs to one company and whose
    // subscription id belongs to another contradicts itself — the provider never sends one — so it
    // changes neither company; it is logged and audited on the customer's company. Metadata and
    // names are never read. (Before the fix it was applied to the customer's company.)
    check('an invoice event naming one company\'s customer and another\'s subscription changes neither: not the customer\'s company', 'active', await statusOf(bystander), `delivery answered ${result.status}`);
    check('…and not the company named in its subscription and metadata fields', 'active', await statusOf(named));
    nobodyElse('the event naming two companies', others);
    await db.set(bystander.orgId, { status: 'active' });
  }
  {
    const event = webhook.event('customer.subscription.deleted', { id: bystander.subscription, object: 'subscription', customer: named.customer, metadata: { orgId: named.orgId } });
    const { result, others } = await during([bystander.orgId], () => deliver(event));
    // The same decision for a deletion: a subscription id of one company with another company's customer id changes neither.
    check('a deletion naming one company\'s subscription and another\'s customer changes neither: not the subscription\'s company', 'active', await statusOf(bystander), `delivery answered ${result.status}`);
    check('…and not the company whose customer id it carries', 'active', await statusOf(named));
    nobodyElse('the deletion naming two companies', others);
    await db.set(bystander.orgId, { status: 'active' });
  }
};

// ── 5. one customer id on two companies ────────────────────────────────────

const sharedCustomer = async () => {
  section('5. Two companies holding the same provider customer id');
  const prisma = await db.prisma();
  const first = await R1();
  const second = await R2();
  await db.set(first.orgId, { status: 'active' });
  await db.set(second.orgId, { status: 'active' });

  let staged = 'accepted';
  try {
    await db.set(second.orgId, { stripeCustomerId: first.customer });
  } catch (error) {
    staged = 'refused';
    console.log(`        (the database refused: ${String(error.message).split('\n').pop().slice(0, 140)})`);
  }
  finding('NEW-2', 'the database refuses to give a second company a provider customer id another company already holds', 'refused', staged);
  if (staged === 'refused') return;

  try {
    // The invoice says whose it is: it carries its subscription id. Name the company the bare customer lookup does NOT return.
    const looked = await prisma.subscription.findFirst({ where: { stripeCustomerId: first.customer } });
    const [returned, owner] = looked.orgId === first.orgId ? [first, second] : [second, first];
    const event = webhook.event('invoice.payment_failed', failedInvoice(first.customer, { subscription: owner.subscription }));
    const { result, others } = await during([first.orgId, second.orgId], () => deliver(event));
    const marked = [];
    for (const company of [first, second]) if ((await statusOf(company)) === 'past_due') marked.push(company.name);
    finding('NEW-2', "with one customer id on two companies, a failed payment marks the company whose subscription the invoice names", [owner.name], marked, `delivery answered ${result.status}; the customer lookup returns ${returned.name}`);
    nobodyElse('the event for the shared customer id', others);
  } finally {
    await db.set(second.orgId, { stripeCustomerId: second.customer, status: 'active' });
    await db.set(first.orgId, { status: 'active' });
  }
};

// ── 6. life cycle ──────────────────────────────────────────────────────────

const lifeCycle = async () => {
  section('6. Unknown types, currencies, failure, recovery, deletion');
  const company = await paying('life cycle', 928);

  // Types the product has no handler for.
  const unhandled = [
    ['invoice.created', paidInvoice(company.customer)],
    ['charge.refunded', { id: `ch_cert_${stamp()}`, object: 'charge', customer: company.customer, amount_refunded: 49900 }],
    ['customer.updated', { id: company.customer, object: 'customer', delinquent: true }],
  ];
  const quiet = await during([], async () => {
    for (const [type, object] of unhandled) {
      const res = await deliver(webhook.event(type, object));
      check(`an event of a type the product does not handle (${type}) is acknowledged`, 200, res.status, res.text.slice(0, 120));
    }
  });
  check("those events moved no company's subscription", [], quiet.others);

  // The provider's own word that a subscription is no longer in good standing.
  {
    const event = webhook.event('customer.subscription.updated', { id: company.subscription, object: 'subscription', customer: company.customer, status: 'unpaid', cancel_at_period_end: false });
    const { result, others } = await during([company.orgId], () => deliver(event));
    finding('NEW-3', 'when the provider reports the subscription unpaid (customer.subscription.updated), the company no longer reads as active', false, (await statusOf(company)) === 'active', `delivery answered ${result.status}`);
    nobodyElse('the subscription update', others);
    await db.set(company.orgId, { status: 'active' });
  }

  // Amounts: the provider sends the smallest unit of each currency.
  const amountOf = async (invoiceId) => {
    const [invoice] = await invoicesOf(invoiceId);
    return invoice ? [Number(invoice.amount), invoice.currency] : null;
  };
  const money = await during([company.orgId], async () => {
    const usd = webhook.event('invoice.paid', paidInvoice(company.customer, { amount_paid: 49900, currency: 'usd' }));
    must('usd', await deliver(usd));
    check('49900 in usd (two decimals) is recorded as 499 USD', [499, 'USD'], await amountOf(usd.data.object.id));
    const jpy = webhook.event('invoice.paid', paidInvoice(company.customer, { amount_paid: 5000, currency: 'jpy' }));
    must('jpy', await deliver(jpy));
    finding('D24', '5000 in jpy (no decimals) is recorded as 5000 JPY', [5000, 'JPY'], await amountOf(jpy.data.object.id));
    // Stripe requires three-decimal currency amounts to be multiples of 10 (the last digit is 0), and
    // Invoice.amount holds two decimals: 12340 is the amount Stripe can send (the case used 12345 before).
    const kwd = webhook.event('invoice.paid', paidInvoice(company.customer, { amount_paid: 12340, currency: 'kwd' }));
    must('kwd', await deliver(kwd));
    finding('D24', '12340 in kwd (three decimals) is recorded as 12.34 KWD', [12.34, 'KWD'], await amountOf(kwd.data.object.id));
  });
  nobodyElse('the three paid invoices', money.others);

  // Failure, recovery, deletion.
  {
    const event = webhook.event('invoice.payment_failed', failedInvoice(company.customer, { amount_due: 49900 }));
    const { result, others } = await during([company.orgId], () => deliver(event));
    check('a failed payment marks the company past due', 'past_due', await statusOf(company), `delivery answered ${result.status}`);
    const [invoice] = await invoicesOf(event.data.object.id);
    check('…and records the failed invoice with its amount', ['failed', 499, 'USD'], invoice ? [invoice.status, Number(invoice.amount), invoice.currency] : null);
    nobodyElse('the failed payment', others);
    check('a company that is past due can still write (the provider is retrying)', ALLOWED, await canWrite(company));
  }
  {
    const { result, others } = await during([company.orgId], () => deliver(webhook.event('invoice.paid', paidInvoice(company.customer))));
    check('the payment that follows makes the company active again', 'active', await statusOf(company), `delivery answered ${result.status}`);
    nobodyElse('the recovery', others);
  }
  {
    const { result, others } = await during([company.orgId], () => deliver(webhook.event('customer.subscription.deleted', { id: company.subscription, object: 'subscription', customer: company.customer })));
    check('the deletion of its subscription expires the company', 'expired', await statusOf(company), `delivery answered ${result.status}`);
    nobodyElse('the deletion', others);
    check('…and an expired company cannot write', REFUSED_NO_SUBSCRIPTION, await canWrite(company));
  }
};

// ── 7. replay ──────────────────────────────────────────────────────────────

const replay = async () => {
  section('7. A once-valid delivery replayed after its 300 seconds');
  if (!earlier) throw new Error('section 1 did not leave a delivery to replay');
  const wait = earlier.signedAt + 302 - now();
  if (wait > 0) {
    console.log(`        (waiting ${wait} s for the signature to pass 300 seconds)`);
    await sleep(wait * 1000);
  }
  const { result, others } = await during([], () => deliverRaw(earlier.payload, earlier.header));
  check('the delivery accepted in section 1, replayed byte for byte once its signature is over 300 seconds old, is refused', 400, result.status, result.text.slice(0, 120));
  check('…and the replay recorded no second invoice', 1, await invoiceCount(earlier.invoiceId));
  check("the replay: no company's subscription moved", [], others);
};

// ── run ────────────────────────────────────────────────────────────────────

const main = async () => {
  await databaseReady();
  const sections = [
    ['signature', signatures],
    ['duplicates', duplicates],
    ['order', order],
    ['which company', whichCompany],
    ['one customer id on two companies', sharedCustomer],
    ['life cycle', lifeCycle],
    ['replay', replay],
  ];
  for (const [name, run] of sections) {
    try {
      await run();
    } catch (error) {
      console.error(error);
      check(`section "${name}" ran to its end`, 'completed', `stopped: ${error.message}`);
    }
  }

  console.log(`\nCompanies this run created: ${[...mine].length} workspaces (company + personal), codes 920–928.`);
  if (hits.length === 0) console.log('No company was touched by an event that named nobody.');
  else {
    console.log('Companies touched by events that named nobody (section 4), each put back:');
    for (const hit of hits) console.log(`  ${hit.event}  →  ${hit.company} [created ${hit.created}]  ${hit.was} → ${hit.became}${hit.invoices.length ? `, invoice left: ${hit.invoices.join(', ')}` : ''}  restored exactly: ${hit.restored}`);
  }
  await finish('billing webhooks');
};

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
