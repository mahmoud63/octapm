const { EventEmitter } = require("events");
const crypto = require("crypto");

/**
 * In-process domain event bus.
 *
 * Services publish events after they persist a change (audit, approval,
 * notification). Subscribers (realtime socket fan-out today, webhooks later)
 * receive a normalized, compact event object.
 *
 * Delivery is deferred by a short delay because most publishers call this from
 * inside a Prisma interactive transaction: emitting synchronously would let a
 * connected client refetch before the transaction commits and read stale data.
 * The delay is configurable through REALTIME_EMIT_DELAY_MS and can be forced to
 * zero per call for tests. A delay alone does not know whether the
 * transaction committed: publishRecorded waits until the event's
 * OutboundEvent row is visible outside the transaction, so an event from a
 * transaction that rolls back is never announced.
 */

const EVENT_TYPES = Object.freeze({
  RECORD_CHANGED: "record.changed",
  APPROVAL_DECIDED: "approval.decided",
  NOTIFICATION_CREATED: "notification.created",
  JOB_PROGRESS: "job.progress",
});

const DOMAIN_EVENT_CHANNEL = "domain-event";
const MAX_PAYLOAD_KEYS = 40;
const MAX_STRING_LENGTH = 500;

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const defaultDelayMs = () => {
  const raw = Number.parseInt(process.env.REALTIME_EMIT_DELAY_MS || "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 150;
};

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toIso = (value) => {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
};

const compactPayload = (value, depth = 0) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return String(value);
  if (depth >= 3) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => compactPayload(item, depth + 1));
  }
  return Object.entries(value)
    .slice(0, MAX_PAYLOAD_KEYS)
    .reduce((acc, [key, raw]) => {
      acc[key] = compactPayload(raw, depth + 1);
      return acc;
    }, {});
};

const uniqueIds = (values) =>
  [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];

const normalizeEvent = (event = {}) => {
  const type = trimOrNull(event.type);
  const orgId = trimOrNull(event.orgId);
  if (!type || !orgId) return null;

  return {
    id: trimOrNull(event.id) || crypto.randomUUID(),
    type,
    orgId,
    projectId: trimOrNull(event.projectId),
    entityType: trimOrNull(event.entityType),
    entityId: trimOrNull(event.entityId),
    action: trimOrNull(event.action),
    actorId: trimOrNull(event.actorId),
    occurredAt: toIso(event.occurredAt),
    payload: compactPayload(event.payload) || {},
    recipientUserIds: uniqueIds(event.recipientUserIds),
  };
};

const deliver = (event) => {
  try {
    emitter.emit(DOMAIN_EVENT_CHANNEL, event);
  } catch (error) {
    // A misbehaving subscriber must never break the publishing request.
    console.error("[domain-event] subscriber failure", error);
  }
};

// How long an event waits for its transaction to commit (publish's confirm):
// asked again at twice the last wait, at most every MAX_CONFIRM_WAIT_MS, and
// dropped once CONFIRM_WINDOW_MS has passed without it.
const MAX_CONFIRM_WAIT_MS = 5000;
const CONFIRM_WINDOW_MS = 30000;

const deliverWhenConfirmed = (event, confirm, wait, waited = 0) => {
  const timer = setTimeout(async () => {
    let confirmed = false;
    try {
      confirmed = Boolean(await confirm());
    } catch (error) {
      confirmed = false;
    }
    if (confirmed) {
      deliver(event);
      return;
    }
    const next = Math.min(Math.max(wait * 2, 50), MAX_CONFIRM_WAIT_MS);
    // Never committed (rolled back), or not within the window: not announced.
    if (waited + wait + next > CONFIRM_WINDOW_MS) return;
    deliverWhenConfirmed(event, confirm, next, waited + wait);
  }, wait);
  timer.unref?.();
};

/**
 * Announce an event to the subscribers, after the delay. With `confirm` (an
 * async () => boolean) it is announced only once confirm answers true —
 * asked after the delay and again, backing off, for up to
 * CONFIRM_WINDOW_MS — and never if it does not (publishRecorded uses it so
 * an event written inside a transaction that rolls back is never announced).
 */
const publish = (event, { delayMs, confirm } = {}) => {
  const normalized = normalizeEvent(event);
  if (!normalized) return null;

  const delay = delayMs === undefined ? defaultDelayMs() : Math.max(0, delayMs);
  if (typeof confirm === "function") {
    deliverWhenConfirmed(normalized, confirm, delay);
  } else if (delay === 0) {
    deliver(normalized);
  } else {
    const timer = setTimeout(() => deliver(normalized), delay);
    timer.unref?.();
  }

  return normalized;
};

const subscribe = (listener) => {
  if (typeof listener !== "function") {
    throw new TypeError("Domain event subscribers must be functions");
  }
  emitter.on(DOMAIN_EVENT_CHANNEL, listener);
  return () => emitter.off(DOMAIN_EVENT_CHANNEL, listener);
};

const listenerCount = () => emitter.listenerCount(DOMAIN_EVENT_CHANNEL);

// A Prisma interactive-transaction client (the `tx` of prisma.$transaction(
// async (tx) => ...)): it runs raw SQL like the base client, but cannot open
// a transaction of its own.
const isTransactionClient = (tx) =>
  Boolean(tx) && typeof tx.$executeRawUnsafe === "function" && typeof tx.$transaction !== "function";

// The caller's transaction can no longer commit what it wrote (a savepoint
// could not be set or rolled back to): whoever treats the outbound log as
// best-effort must not swallow this, or COMMIT would quietly roll back.
const transactionAborted = (error) => {
  const failure = error instanceof Error ? error : new Error(String(error));
  failure.transactionAborted = true;
  return failure;
};

/**
 * Persists an event to the durable OutboundEvent log when the model exists on
 * the supplied Prisma client/transaction. Tests and partial mocks without the
 * model simply skip persistence.
 *
 * Inside a caller's transaction the insert runs under its own SAVEPOINT: a
 * refused insert is rolled back to it and rethrown, and the caller's
 * transaction carries on exactly as before the insert (a failed statement
 * would otherwise abort the whole Postgres transaction, and its COMMIT would
 * silently roll back everything the caller wrote). A failure to set or roll
 * back to the savepoint is rethrown with transactionAborted: true.
 */
const recordOutboundEvent = async ({ tx, event }) => {
  const normalized = normalizeEvent(event);
  if (!normalized || !tx?.outboundEvent?.create) return null;

  const data = {
    id: normalized.id,
    orgId: normalized.orgId,
    projectId: normalized.projectId,
    type: normalized.type,
    entityType: normalized.entityType,
    entityId: normalized.entityId,
    action: normalized.action,
    actorId: normalized.actorId,
    occurredAt: new Date(normalized.occurredAt),
    payloadJson: normalized.payload,
    recipientUserIds: normalized.recipientUserIds,
  };
  if (!isTransactionClient(tx)) return tx.outboundEvent.create({ data });

  // Hex only: the name is never built from input.
  const savepoint = `outbound_event_${crypto.randomBytes(8).toString("hex")}`;
  try {
    await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
  } catch (error) {
    throw transactionAborted(error);
  }
  let row;
  try {
    row = await tx.outboundEvent.create({ data });
  } catch (error) {
    try {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (rollbackError) {
      throw transactionAborted(rollbackError);
    }
    throw error;
  }
  try {
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    throw transactionAborted(error);
  }
  return row;
};

/**
 * Publish an event persisted with recordOutboundEvent (`event.id` is its
 * OutboundEvent row's id). Written inside a caller's transaction, it is
 * announced only once that row can be read outside the transaction with
 * `client` (the base Prisma client) — that is, after COMMIT; an event from a
 * transaction that rolls back is never announced. Anywhere else (no
 * transaction, no id, no client) it is published as publish() does.
 */
const publishRecorded = (event, { tx, client, delayMs } = {}) => {
  const id = trimOrNull(event?.id);
  if (!id || !isTransactionClient(tx) || typeof client?.outboundEvent?.findUnique !== "function") {
    return publish(event, { delayMs });
  }
  return publish(event, {
    delayMs,
    confirm: async () => Boolean(await client.outboundEvent.findUnique({ where: { id }, select: { id: true } })),
  });
};

/**
 * Convenience builder for the common "a project record changed" event.
 */
const buildRecordEvent = ({
  orgId,
  projectId,
  entityType,
  entityId,
  action,
  actorId = null,
  occurredAt = new Date(),
  oldStatus = null,
  newStatus = null,
  summary = {},
}) => ({
  type: EVENT_TYPES.RECORD_CHANGED,
  orgId,
  projectId,
  entityType,
  entityId,
  action,
  actorId,
  occurredAt,
  payload: {
    oldStatus: trimOrNull(oldStatus),
    newStatus: trimOrNull(newStatus),
    summary: compactPayload(summary) || {},
  },
});

module.exports = {
  DOMAIN_EVENT_CHANNEL,
  EVENT_TYPES,
  buildRecordEvent,
  isTransactionClient,
  listenerCount,
  normalizeEvent,
  publish,
  publishRecorded,
  recordOutboundEvent,
  subscribe,
};
