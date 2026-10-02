const { prisma } = require('../config/db');
const { divideMoney } = require('../utils/money');
const auditService = require('./audit.service');

/**
 * What a verified Stripe event does to OctaPM's billing records.
 *
 * The route (routes/stripe-webhook.js) checks the signature; this decides
 * which company an event is about and what may change. The rules, from the
 * billing certification (findings D2, D3, D4, D20, NEW-1, NEW-2, NEW-4, D24):
 *
 *  - An event names its company by the provider's identifier and nothing
 *    else: the customer id for invoice events, the subscription id for a
 *    deletion. A missing, empty, null or non-string identifier is never a
 *    lookup — it used to be, and Prisma read "no filter" as "the first row of
 *    the table", so an unrelated company was changed. An identifier held by
 *    no company, or by more than one, changes nothing. An event that names a
 *    customer and a subscription that do not belong together changes nothing.
 *  - The same invoice event delivered twice records one invoice.
 *  - A provider event never brings a company back: a paid invoice re-activates
 *    only a company that is active or past due — not an expired one, not one
 *    whose cancellation is running, not one in its free trial. A failed
 *    payment demotes only an active company, and not when the invoice is
 *    already paid or a later payment has already been recorded.
 *  - Every outcome is logged; every outcome for a known company is audited on
 *    that company. All writes of one event are one transaction, serialised
 *    with the company's other billing writes.
 */

const HANDLED = new Set(['invoice.paid', 'invoice.payment_failed', 'customer.subscription.deleted']);

// Stripe amounts are in the currency's smallest unit.
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);
const minorUnitsPer = (currency) => (ZERO_DECIMAL.has(currency) ? 1 : THREE_DECIMAL.has(currency) ? 1000 : 100);

/** A provider identifier, or null: only a non-empty string is one. */
const idOf = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

const TRANSACTION = { maxWait: 10_000, timeout: 20_000 };

/** The one subscription an event is about, or the reason there is none. */
const resolveSubscription = async (tx, event, obj) => {
  if (event.type === 'customer.subscription.deleted') {
    const subscriptionId = idOf(obj.id);
    if (!subscriptionId) return { reason: 'no_subscription_id' };
    const rows = await tx.subscription.findMany({ where: { stripeSubscriptionId: subscriptionId }, take: 2 });
    if (rows.length === 0) return { reason: 'unknown_subscription' };
    if (rows.length > 1) return { reason: 'ambiguous_subscription' };
    const customer = idOf(obj.customer);
    if (customer && rows[0].stripeCustomerId && customer !== rows[0].stripeCustomerId) return { reason: 'customer_mismatch', row: rows[0], unbound: true };
    return { row: rows[0] };
  }
  const customer = idOf(obj.customer);
  if (!customer) return { reason: 'no_customer' };
  const rows = await tx.subscription.findMany({ where: { stripeCustomerId: customer }, take: 50 });
  if (rows.length === 0) return { reason: 'unknown_customer' };
  const subscriptionId = idOf(obj.subscription);
  if (rows.length > 1) {
    // One customer id on several companies (no route makes this, but the column is not unique):
    // only the subscription id the invoice names can tell them apart, and only if exactly one holds it.
    const named = subscriptionId ? rows.filter((r) => r.stripeSubscriptionId === subscriptionId) : [];
    return named.length === 1 ? { row: named[0] } : { reason: 'ambiguous_customer' };
  }
  if (subscriptionId && rows[0].stripeSubscriptionId && subscriptionId !== rows[0].stripeSubscriptionId) {
    return { reason: 'subscription_mismatch', row: rows[0], unbound: true };
  }
  return { row: rows[0] };
};

const invoiceAmount = (obj, field) => {
  const currency = String(obj.currency ?? 'usd').toLowerCase();
  return { amount: divideMoney(obj[field] ?? 0, minorUnitsPer(currency)), currency: currency.toUpperCase() };
};

const linePeriod = (obj) => obj?.lines?.data?.[0]?.period || null;

/** When the provider created the event (seconds resolution); an invoice row is dated by it, so staleness compares provider time with provider time. */
const providerTime = (event) => (Number.isFinite(Number(event?.created)) && Number(event.created) > 0 ? new Date(Number(event.created) * 1000) : new Date());
const laterOf = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

const onInvoicePaid = async (tx, row, obj, event) => {
  const invoiceId = idOf(obj.id);
  if (!invoiceId) return { outcome: 'ignored', reason: 'no_invoice_id' };
  const already = await tx.invoice.findFirst({ where: { subscriptionId: row.id, stripeInvoiceId: invoiceId, status: 'paid' }, select: { id: true } });
  if (already) return { outcome: 'duplicate', reason: 'invoice_already_recorded_paid' };
  const period = linePeriod(obj);
  await tx.invoice.create({
    data: {
      subscriptionId: row.id,
      description: obj.lines?.data?.[0]?.description || 'Subscription payment',
      ...invoiceAmount(obj, 'amount_paid'),
      status: 'paid',
      periodLabel: period?.start ? new Date(period.start * 1000).toISOString().slice(0, 7) : null,
      stripeInvoiceId: invoiceId,
      createdAt: providerTime(event),
    },
  });
  // Only a paying company is (re)activated by a payment: never one that expired,
  // never one whose cancellation is running, never one in its free trial.
  if (row.status !== 'active' && row.status !== 'past_due') {
    return { outcome: 'recorded', reason: `status_${row.status}_kept`, newStatus: row.status };
  }
  const periodEnd = period?.end ? new Date(period.end * 1000) : null;
  await tx.subscription.update({
    where: { id: row.id },
    data: { status: 'active', currentPeriodEnd: laterOf(row.currentPeriodEnd, periodEnd) },
  });
  return { outcome: 'applied', newStatus: 'active' };
};

const onPaymentFailed = async (tx, row, obj, event) => {
  const invoiceId = idOf(obj.id);
  if (!invoiceId) return { outcome: 'ignored', reason: 'no_invoice_id' };
  const already = await tx.invoice.findFirst({ where: { subscriptionId: row.id, stripeInvoiceId: invoiceId, status: 'failed' }, select: { id: true } });
  if (already) return { outcome: 'duplicate', reason: 'invoice_already_recorded_failed' };
  await tx.invoice.create({
    data: {
      subscriptionId: row.id,
      description: 'Failed subscription payment',
      ...invoiceAmount(obj, 'amount_due'),
      status: 'failed',
      stripeInvoiceId: invoiceId,
      createdAt: providerTime(event),
    },
  });
  if (row.status !== 'active') return { outcome: 'recorded', reason: `status_${row.status}_kept`, newStatus: row.status };
  const paidSameInvoice = await tx.invoice.findFirst({ where: { subscriptionId: row.id, stripeInvoiceId: invoiceId, status: 'paid' }, select: { id: true } });
  if (paidSameInvoice) return { outcome: 'recorded', reason: 'invoice_already_paid', newStatus: row.status };
  // A failure the provider created before a payment it has already reported
  // (both dated by the provider's clock) is stale: it arrived late and says nothing about now.
  const laterPayment = await tx.invoice.findFirst({ where: { subscriptionId: row.id, status: 'paid', createdAt: { gt: providerTime(event) } }, select: { id: true } });
  if (laterPayment) return { outcome: 'recorded', reason: 'stale_event_after_payment', newStatus: row.status };
  await tx.subscription.update({ where: { id: row.id }, data: { status: 'past_due' } });
  return { outcome: 'applied', newStatus: 'past_due' };
};

const onSubscriptionDeleted = async (tx, row) => {
  if (row.status === 'expired') return { outcome: 'duplicate', reason: 'already_expired', newStatus: 'expired' };
  await tx.subscription.update({ where: { id: row.id }, data: { status: 'expired' } });
  return { outcome: 'applied', newStatus: 'expired' };
};

const log = (event, result, orgId) => {
  const line = { at: new Date().toISOString(), event: event.id || null, type: event.type, outcome: result.outcome, reason: result.reason || null, orgId: orgId || null };
  console.log(`[stripe-webhook] ${JSON.stringify(line)}`);
};

/**
 * Applies one verified event. Returns { outcome, reason?, orgId? } where
 * outcome is applied | recorded | duplicate | ignored | unhandled.
 */
const handleEvent = async (event, { client = prisma } = {}) => {
  if (!HANDLED.has(event?.type)) {
    const result = { outcome: 'unhandled' };
    log(event || {}, result, null);
    return result;
  }
  const obj = event.data?.object && typeof event.data.object === 'object' ? event.data.object : {};
  const result = await client.$transaction(async (tx) => {
    const resolved = await resolveSubscription(tx, event, obj);
    if (!resolved.row || resolved.unbound) {
      return { outcome: 'ignored', reason: resolved.reason, row: resolved.row || null };
    }
    // The same lock subscribe and cancel take: one billing change at a time per company.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscription:${resolved.row.orgId}`}))`;
    const row = await tx.subscription.findUnique({ where: { id: resolved.row.id } });
    let applied;
    if (event.type === 'invoice.paid') applied = await onInvoicePaid(tx, row, obj, event);
    else if (event.type === 'invoice.payment_failed') applied = await onPaymentFailed(tx, row, obj, event);
    else applied = await onSubscriptionDeleted(tx, row);
    await auditService.recordEvent({
      tx,
      orgId: row.orgId,
      projectId: null,
      entityType: auditService.ENTITY_TYPES.SUBSCRIPTION,
      entityId: row.id,
      action: `billing.provider_event.${applied.outcome}`,
      oldStatus: row.status,
      newStatus: applied.newStatus || row.status,
      reason: applied.reason || null,
      metadata: { provider: 'stripe', eventId: idOf(event.id), eventType: event.type, invoiceId: event.type === 'customer.subscription.deleted' ? null : idOf(obj.id) },
    });
    return { ...applied, row };
  }, TRANSACTION);

  // An event that named a company but contradicted itself is recorded on that company too.
  if (result.outcome === 'ignored' && result.row) {
    await auditService
      .recordEvent({
        orgId: result.row.orgId,
        projectId: null,
        entityType: auditService.ENTITY_TYPES.SUBSCRIPTION,
        entityId: result.row.id,
        action: 'billing.provider_event.ignored',
        oldStatus: result.row.status,
        newStatus: result.row.status,
        reason: result.reason,
        metadata: { provider: 'stripe', eventId: idOf(event.id), eventType: event.type },
      })
      .catch((error) => console.error('[stripe-webhook] audit of an ignored event failed', error?.message || error));
  }
  const orgId = result.row?.orgId || null;
  log(event, result, orgId);
  return { outcome: result.outcome, reason: result.reason || null, orgId };
};

module.exports = { handleEvent, idOf, minorUnitsPer, resolveSubscription };
