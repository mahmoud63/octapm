/**
 * What a verified Stripe event may change (billing certification D2, D3, D4,
 * D20, D24, NEW-1, NEW-2, NEW-4).
 *
 * The store below is an in-memory stand-in for the two tables involved, with
 * Prisma's own filter semantics where they matter: a filter value of
 * `undefined` is no filter at all (every row matches), and `null` matches the
 * rows whose column is NULL. That is exactly how the old handler picked an
 * unrelated company — so a regression to a lookup without an identifier is
 * caught here, not just in the live proof
 * (backend/scripts/cert/billing/webhook-proof.js, against the certification
 * database).
 */

jest.mock('../../config/db', () => ({ prisma: {} }));
jest.mock('../audit.service', () => ({ ENTITY_TYPES: { SUBSCRIPTION: 'subscription' }, recordEvent: jest.fn(() => Promise.resolve({})) }));

const auditService = require('../audit.service');
const { handleEvent, minorUnitsPer } = require('../stripe-webhook.service');

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true; // Prisma: undefined is no filter
    if (value === null) return row[key] === null || row[key] === undefined;
    if (value && typeof value === 'object' && 'gt' in value) return row[key] > value.gt;
    return row[key] === value;
  });

const makeStore = (subscriptions) => {
  const state = { subscriptions: subscriptions.map((s) => ({ ...s })), invoices: [], locks: [], queries: [] };
  let clock = 1_000;
  const tx = {
    subscription: {
      findMany: async ({ where, take }) => {
        state.queries.push({ op: 'subscription.findMany', where });
        return state.subscriptions.filter((r) => matches(r, where)).slice(0, take ?? Infinity).map((r) => ({ ...r }));
      },
      findFirst: async ({ where }) => {
        state.queries.push({ op: 'subscription.findFirst', where });
        const row = state.subscriptions.find((r) => matches(r, where));
        return row ? { ...row } : null;
      },
      findUnique: async ({ where }) => ({ ...state.subscriptions.find((r) => r.id === where.id) }),
      update: async ({ where, data }) => {
        const row = state.subscriptions.find((r) => r.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
    },
    invoice: {
      findFirst: async ({ where }) => state.invoices.find((r) => matches(r, where)) || null,
      create: async ({ data }) => {
        // The local time a row is written, in seconds since the epoch: one second per insert.
        clock += 1;
        const row = { id: `inv-${state.invoices.length + 1}`, createdAt: new Date(clock * 1000), ...data }; // the service dates rows by the provider's event time
        state.invoices.push(row);
        return row;
      },
    },
    $executeRaw: async (strings, ...values) => {
      state.locks.push(values.join(''));
      return 1;
    },
  };
  const client = { $transaction: async (fn) => fn(tx) };
  return { state, client, setClock: (seconds) => { clock = seconds; } };
};

const sub = (id, orgId, status, customer, subscription, extra = {}) => ({ id, orgId, status, plan: 'business', stripeCustomerId: customer, stripeSubscriptionId: subscription, currentPeriodEnd: null, ...extra });
const event = (type, object, created = 1_700_000_000) => ({ id: `evt_${type}_${Math.random().toString(36).slice(2)}`, type, created, data: { object } });
const paid = (customer, invoice, extra = {}) => event('invoice.paid', { id: invoice, customer, amount_paid: 49900, currency: 'usd', ...extra });
const failed = (customer, invoice, created, extra = {}) => event('invoice.payment_failed', { id: invoice, customer, amount_due: 49900, currency: 'usd', ...extra }, created);
const deleted = (subscription, extra = {}) => event('customer.subscription.deleted', { id: subscription, ...extra });

/** A population where the first row is a bystander and some rows have no provider ids at all. */
const population = () =>
  makeStore([
    sub('s-bystander', 'org-bystander', 'active', 'cus_bystander', 'sub_bystander'),
    sub('s-trial', 'org-trial', 'incomplete', null, null),
    sub('s-a', 'org-a', 'active', 'cus_a', 'sub_a'),
    sub('s-b', 'org-b', 'active', 'cus_b', 'sub_b'),
  ]);
const snapshot = (state) => JSON.stringify(state.subscriptions);

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  auditService.recordEvent.mockClear();
});
afterEach(() => console.log.mockRestore());

describe('an event that names no company changes nothing (D2, NEW-4)', () => {
  it.each([
    ['invoice.paid without a customer field', paid(undefined, 'in_1')],
    ['invoice.paid with customer: null', paid(null, 'in_1')],
    ['invoice.paid with customer: ""', paid('', 'in_1')],
    ['invoice.paid with customer: "   "', paid('   ', 'in_1')],
    ['invoice.paid with the customer as an object', paid({ id: 'cus_a' }, 'in_1')],
    ['invoice.payment_failed without a customer field', failed(undefined, 'in_1')],
    ['invoice.payment_failed with customer: null', failed(null, 'in_1')],
    ['customer.subscription.deleted without an id', deleted(undefined)],
    ['customer.subscription.deleted with id: null', deleted(null)],
    ['customer.subscription.deleted with id: ""', deleted('')],
    ['an event with no data object at all', { id: 'evt_x', type: 'invoice.paid', created: 1, data: null }],
  ])('%s', async (_label, e) => {
    const { state, client } = population();
    const before = snapshot(state);
    const result = await handleEvent(e, { client });
    expect(result.outcome).toBe('ignored');
    expect(snapshot(state)).toBe(before);
    expect(state.invoices).toHaveLength(0);
    // And it never asked the database for "any row": no lookup ran with a missing or null identifier.
    for (const q of state.queries) for (const value of Object.values(q.where)) expect([q.op, value]).toEqual([q.op, expect.any(String)]);
  });

  it.each([
    ['an unknown customer', paid('cus_nobody', 'in_1'), 'unknown_customer'],
    ['an unknown subscription', deleted('sub_nobody'), 'unknown_subscription'],
  ])('%s changes nothing', async (_label, e, reason) => {
    const { state, client } = population();
    const before = snapshot(state);
    expect(await handleEvent(e, { client })).toMatchObject({ outcome: 'ignored', reason });
    expect(snapshot(state)).toBe(before);
  });

  it('two companies holding the same customer id: neither is changed unless the subscription id names exactly one (NEW-2)', async () => {
    const { state, client } = makeStore([sub('s-c', 'org-c', 'active', 'cus_shared', 'sub_c'), sub('s-d', 'org-d', 'active', 'cus_shared', 'sub_d')]);
    const before = snapshot(state);
    expect(await handleEvent(failed('cus_shared', 'in_1'), { client })).toMatchObject({ outcome: 'ignored', reason: 'ambiguous_customer' });
    expect(await handleEvent(failed('cus_shared', 'in_2', 1_700_000_000, { subscription: 'sub_nobody' }), { client })).toMatchObject({ outcome: 'ignored', reason: 'ambiguous_customer' });
    expect(snapshot(state)).toBe(before);
    expect(await handleEvent(failed('cus_shared', 'in_3', 1_700_000_000, { subscription: 'sub_d' }), { client })).toMatchObject({ outcome: 'applied', orgId: 'org-d' });
    expect(state.subscriptions.map((s) => [s.orgId, s.status])).toEqual([['org-c', 'active'], ['org-d', 'past_due']]);
  });

  it('an event naming company A\'s customer and company B\'s subscription changes nothing, and is audited on A', async () => {
    const { state, client } = population();
    const before = snapshot(state);
    expect(await handleEvent(failed('cus_a', 'in_1', 1_700_000_000, { subscription: 'sub_b' }), { client })).toMatchObject({ outcome: 'ignored', reason: 'subscription_mismatch', orgId: 'org-a' });
    expect(await handleEvent(deleted('sub_a', { customer: 'cus_b' }), { client })).toMatchObject({ outcome: 'ignored', reason: 'customer_mismatch', orgId: 'org-a' });
    expect(snapshot(state)).toBe(before);
    expect(auditService.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-a', action: 'billing.provider_event.ignored' }));
  });
});

describe('an event that names a company changes that company only', () => {
  it('a payment, a failure and a deletion each change exactly the company they name', async () => {
    const { state, client } = population();
    expect(await handleEvent(failed('cus_a', 'in_a1', 1_700_000_100), { client })).toMatchObject({ outcome: 'applied', orgId: 'org-a' });
    expect(await handleEvent(deleted('sub_b'), { client })).toMatchObject({ outcome: 'applied', orgId: 'org-b' });
    const by = Object.fromEntries(state.subscriptions.map((s) => [s.orgId, s.status]));
    expect(by).toEqual({ 'org-bystander': 'active', 'org-trial': 'incomplete', 'org-a': 'past_due', 'org-b': 'expired' });
    expect(state.invoices.map((i) => [i.subscriptionId, i.status])).toEqual([['s-a', 'failed']]);
    expect(state.locks).toEqual(['subscription:org-a', 'subscription:org-b']);
  });
});

describe('the same event twice records it once (D4)', () => {
  it.each([
    ['invoice.paid', () => paid('cus_a', 'in_dup')],
    ['invoice.payment_failed', () => failed('cus_a', 'in_dup', 1_700_000_100)],
  ])('%s', async (_label, make) => {
    const { state, client } = population();
    const e = make();
    expect((await handleEvent(e, { client })).outcome).toBe('applied');
    expect(await handleEvent(e, { client })).toMatchObject({ outcome: 'duplicate' });
    expect(await handleEvent({ ...e, id: 'evt_redelivered' }, { client })).toMatchObject({ outcome: 'duplicate' });
    expect(state.invoices).toHaveLength(1);
  });

  it('a second deletion is a duplicate', async () => {
    const { client } = population();
    await handleEvent(deleted('sub_a'), { client });
    expect(await handleEvent(deleted('sub_a'), { client })).toMatchObject({ outcome: 'duplicate', reason: 'already_expired' });
  });
});

describe('a late or stale event never brings a company back (D3, D20, NEW-1)', () => {
  it('after the subscription is deleted, an older failure and an older payment leave the company expired', async () => {
    const { state, client } = population();
    await handleEvent(deleted('sub_a'), { client });
    expect(await handleEvent(failed('cus_a', 'in_old1', 1_600_000_000), { client })).toMatchObject({ outcome: 'recorded', reason: 'status_expired_kept' });
    expect(await handleEvent(paid('cus_a', 'in_old2'), { client })).toMatchObject({ outcome: 'recorded', reason: 'status_expired_kept' });
    expect(state.subscriptions.find((s) => s.orgId === 'org-a').status).toBe('expired');
  });

  it('a payment for a company whose cancellation is running does not undo the cancellation', async () => {
    const { state, client } = makeStore([sub('s-a', 'org-a', 'canceled', 'cus_a', 'sub_a', { cancelAtPeriodEnd: true })]);
    expect(await handleEvent(paid('cus_a', 'in_1'), { client })).toMatchObject({ outcome: 'recorded', reason: 'status_canceled_kept' });
    expect(state.subscriptions[0]).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: true });
  });

  it('a payment for a company in its free trial does not make it a paying company', async () => {
    const { state, client } = makeStore([sub('s-t', 'org-t', 'trialing', 'cus_t', null, { plan: 'trial' })]);
    expect(await handleEvent(paid('cus_t', 'in_1'), { client })).toMatchObject({ outcome: 'recorded', reason: 'status_trialing_kept' });
    expect(state.subscriptions[0].status).toBe('trialing');
  });

  it('a failure for an invoice already paid, or created before a recorded payment, does not demote', async () => {
    const { state, client } = population();
    await handleEvent({ ...paid('cus_a', 'in_x'), created: 1_700_000_000 }, { client });
    expect(await handleEvent(failed('cus_a', 'in_x', 1_699_999_000), { client })).toMatchObject({ outcome: 'recorded', reason: 'invoice_already_paid' });
    expect(await handleEvent(failed('cus_a', 'in_y', 1_699_999_500), { client })).toMatchObject({ outcome: 'recorded', reason: 'stale_event_after_payment' });
    expect(state.subscriptions.find((s) => s.orgId === 'org-a').status).toBe('active');
    // A failure created after the recorded payment is real.
    expect(await handleEvent(failed('cus_a', 'in_z', 1_700_100_000), { client })).toMatchObject({ outcome: 'applied' });
    expect(state.subscriptions.find((s) => s.orgId === 'org-a').status).toBe('past_due');
    // And the payment that follows restores it.
    expect(await handleEvent({ ...paid('cus_a', 'in_z'), created: 1_700_100_500 }, { client })).toMatchObject({ outcome: 'applied' });
    expect(state.subscriptions.find((s) => s.orgId === 'org-a').status).toBe('active');
  });

  it('a failure created in the same second as a recorded payment of another invoice is not stale', async () => {
    const { state, client } = population();
    await handleEvent({ ...paid('cus_a', 'in_p'), created: 1_700_000_000 }, { client });
    expect(await handleEvent(failed('cus_a', 'in_q', 1_700_000_000), { client })).toMatchObject({ outcome: 'applied' });
    expect(state.subscriptions.find((s) => s.orgId === 'org-a').status).toBe('past_due');
    expect(state.invoices.map((i) => i.createdAt.getTime())).toEqual([1_700_000_000_000, 1_700_000_000_000]);
  });

  it('an older payment does not move the paid-through date backwards', async () => {
    const later = new Date('2027-06-01T00:00:00Z');
    const { state, client } = makeStore([sub('s-a', 'org-a', 'active', 'cus_a', 'sub_a', { currentPeriodEnd: later })]);
    await handleEvent(paid('cus_a', 'in_old', { lines: { data: [{ period: { start: 1_700_000_000, end: 1_702_592_000 } }] } }), { client });
    expect(state.subscriptions[0].currentPeriodEnd).toEqual(later);
  });
});

describe('amounts in the currency\'s own unit (D24)', () => {
  it.each([['usd', 100], ['eur', 100], ['jpy', 1], ['krw', 1], ['kwd', 1000], ['bhd', 1000]])('%s has %d minor units', (currency, units) => {
    expect(minorUnitsPer(currency)).toBe(units);
  });

  it('records 5000 JPY as 5000 and 49900 USD as 499', async () => {
    const { state, client } = population();
    await handleEvent(paid('cus_a', 'in_jpy', { amount_paid: 5000, currency: 'jpy' }), { client });
    await handleEvent(paid('cus_b', 'in_usd'), { client });
    expect(state.invoices.map((i) => [i.currency, i.amount])).toEqual([['JPY', 5000], ['USD', 499]]);
  });
});

it('an event type the product does not handle touches nothing', async () => {
  const { state, client } = population();
  const before = snapshot(state);
  expect(await handleEvent(event('charge.refunded', { customer: 'cus_a' }), { client })).toEqual({ outcome: 'unhandled' });
  expect(snapshot(state)).toBe(before);
});
