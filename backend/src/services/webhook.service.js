const crypto = require("crypto");
const http = require("http");
const https = require("https");
const net = require("net");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { AddressRefusedError, bareAddress, publicLookup, refusedRange, resolvePublicAddresses } = require("../utils/public-address");
const domainEvents = require("../events/bus");
const auditService = require("./audit.service");

/**
 * Webhooks (OCTA-INT-API-026). Every domain event that reaches the bus is
 * matched against the organisation's subscriptions; each match becomes a
 * WebhookDelivery row and a `webhook.deliver` job. Deliveries are signed
 * (HMAC-SHA256 over `<timestamp>.<body>`) and retried by the job queue up to
 * MAX_ATTEMPTS times before they are marked dead.
 *
 * A webhook may only reach a public address. The organisation picks the URL
 * but the server makes the request, from inside the VPC, next to the task's
 * credentials endpoint and every internal host. So the target is resolved and
 * checked when the subscription is saved, and again on every delivery — there
 * against the very address the socket connects to (publicLookup), and on every
 * redirect hop.
 */

const MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 10_000;
const RESPONSE_BODY_LIMIT = 1000;
const RESPONSE_READ_LIMIT = RESPONSE_BODY_LIMIT * 4;
const DISABLE_AFTER_DEAD = 10;
const MAX_REDIRECTS = 3;
// The two redirects that keep the method and the body; anything else would
// turn the signed POST into a bodyless GET, so it is answered as it stands.
const FOLLOWED_REDIRECTS = new Set([307, 308]);
const SIGNATURE_HEADER = "x-octapm-signature";
const SIGNATURE_TOLERANCE_S = 300;

/**
 * WEBHOOK_ALLOW_HTTP=true is for a developer's own receiver: plain http, and
 * loopback addresses. Never honoured under NODE_ENV=production, and even with
 * it every other refused range (private, link-local, metadata, CGNAT) stays
 * refused.
 */
const localReceiversAllowed = () => process.env.NODE_ENV !== "production" && process.env.WEBHOOK_ALLOW_HTTP === "true";
const httpAllowed = () => localReceiversAllowed() || process.env.NODE_ENV === "test";

const EVENT_TYPES = Object.freeze([
  { key: "*", label: "Everything" },
  { key: "record.changed", label: "Any record change" },
  { key: "approval.decided", label: "Approval decisions" },
  { key: "notification.created", label: "Notifications" },
  { key: "job.progress", label: "Background job progress" },
  { key: "<entity>.<action>", label: "One record type and action, e.g. rfi.status_changed, change_order.*" },
]);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const tablesReady = () => Boolean(prisma.webhookSubscription?.findMany && prisma.webhookDelivery?.create);

const patternMatches = (pattern, candidate) => {
  if (!pattern || !candidate) return false;
  if (pattern === "*") return true;
  if (pattern === candidate) return true;
  if (pattern.endsWith(".*")) return candidate.startsWith(pattern.slice(0, -1));
  return false;
};

/** An event is described by its bus type and by `<entityType>.<action>`. */
const eventNames = (event) => [event.type, event.entityType && event.action ? `${event.entityType}.${event.action}` : null].filter(Boolean);

const subscriptionMatches = (subscription, event) => {
  if (subscription.projectId && subscription.projectId !== event.projectId) return false;
  const names = eventNames(event);
  return (subscription.eventTypes || []).some((pattern) => names.some((name) => patternMatches(pattern, name)));
};

const normalizeEventTypes = (eventTypes) => {
  const list = [...new Set((Array.isArray(eventTypes) ? eventTypes : []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
  if (!list.length) throw new HttpError(400, "WEBHOOK_EVENTS_REQUIRED", "Pick at least one event type");
  const bad = list.filter((item) => !/^(\*|[a-z_]+\.(\*|[a-z_]+))$/.test(item));
  if (bad.length) throw new HttpError(400, "WEBHOOK_EVENT_PATTERN", `Event patterns look like *, record.changed or rfi.*: ${bad.join(", ")}`);
  return list;
};

const normalizeUrl = (value) => {
  const text = trimOrNull(value);
  if (!text) throw new HttpError(400, "WEBHOOK_URL_REQUIRED", "Give the webhook an https URL");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, "WEBHOOK_URL_INVALID", "The URL is not valid");
  }
  if (url.protocol !== "https:" && !(httpAllowed() && url.protocol === "http:")) throw new HttpError(400, "WEBHOOK_URL_INVALID", "Webhooks must use https");
  return url.toString();
};

/** normalizeUrl, then the address check every delivery repeats. */
const checkedUrl = async (value) => {
  const url = normalizeUrl(value);
  const { hostname } = new URL(url);
  try {
    await resolvePublicAddresses(hostname, { allowLoopback: localReceiversAllowed() });
  } catch (error) {
    if (error instanceof AddressRefusedError) throw new HttpError(400, "WEBHOOK_TARGET_REFUSED", `${error.message}. Webhooks can only be delivered to public internet addresses.`);
    throw new HttpError(400, "WEBHOOK_URL_UNRESOLVED", `${bareAddress(hostname)} could not be resolved (${error.code || error.message})`);
  }
  return url;
};

const newSecret = () => `whsec_${crypto.randomBytes(24).toString("base64url")}`;

const serializeSubscription = (row, { revealSecret = false } = {}) => ({
  id: row.id,
  projectId: row.projectId || null,
  project: row.project ? { id: row.project.id, name: row.project.name } : null,
  name: row.name,
  description: row.description || null,
  url: row.url,
  secret: revealSecret ? row.secret : null,
  secretHint: row.secret ? `${row.secret.slice(0, 10)}…` : null,
  eventTypes: row.eventTypes || [],
  status: row.status,
  failureCount: row.failureCount || 0,
  lastDeliveryAt: toIso(row.lastDeliveryAt),
  lastStatus: row.lastStatus || null,
  lastError: row.lastError || null,
  deliveryCount: row._count?.deliveries ?? null,
  createdBy: row.createdBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const serializeDelivery = (row) => ({
  id: row.id,
  subscriptionId: row.subscriptionId,
  eventId: row.eventId,
  eventType: row.eventType,
  attempt: row.attempt,
  maxAttempts: MAX_ATTEMPTS,
  status: row.status,
  responseStatus: row.responseStatus ?? null,
  responseBody: row.responseBody || null,
  error: row.error || null,
  durationMs: row.durationMs ?? null,
  nextAttemptAt: toIso(row.nextAttemptAt),
  deliveredAt: toIso(row.deliveredAt),
  payload: row.payloadJson || {},
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const include = { project: { select: { id: true, name: true } }, _count: { select: { deliveries: true } } };

const listSubscriptions = async ({ orgId, projectId = null }) => {
  if (!tablesReady()) return [];
  const rows = await prisma.webhookSubscription.findMany({ where: { orgId, ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}) }, include, orderBy: { createdAt: "desc" } });
  return rows.map((row) => serializeSubscription(row));
};

const getSubscription = async ({ orgId, subscriptionId, revealSecret = false }) => {
  const row = await prisma.webhookSubscription.findFirst({ where: { id: subscriptionId, orgId }, include });
  if (!row) throw new HttpError(404, "WEBHOOK_NOT_FOUND", "Webhook not found");
  return serializeSubscription(row, { revealSecret });
};

const createSubscription = async ({ orgId, actor, payload = {} }) => {
  const name = trimOrNull(payload.name);
  if (!name) throw new HttpError(400, "WEBHOOK_NAME_REQUIRED", "Give the webhook a name");
  const url = await checkedUrl(payload.url);
  const eventTypes = normalizeEventTypes(payload.eventTypes);
  const projectId = trimOrNull(payload.projectId);
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
    if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }
  const row = await prisma.webhookSubscription.create({ data: { orgId, projectId, name, description: trimOrNull(payload.description), url, secret: trimOrNull(payload.secret) || newSecret(), eventTypes, createdBy: actor?.id || null }, include });
  await auditService.recordEvent({ orgId, projectId, entityType: auditService.ENTITY_TYPES.WEBHOOK || "webhook", entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { name, url, eventTypes } }).catch(() => null);
  return serializeSubscription(row, { revealSecret: true });
};

const updateSubscription = async ({ orgId, actor, subscriptionId, payload = {} }) => {
  const existing = await prisma.webhookSubscription.findFirst({ where: { id: subscriptionId, orgId } });
  if (!existing) throw new HttpError(404, "WEBHOOK_NOT_FOUND", "Webhook not found");
  const data = {};
  if (payload.name !== undefined) {
    data.name = trimOrNull(payload.name);
    if (!data.name) throw new HttpError(400, "WEBHOOK_NAME_REQUIRED", "Give the webhook a name");
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description);
  if (payload.url !== undefined) data.url = await checkedUrl(payload.url);
  if (payload.eventTypes !== undefined) data.eventTypes = normalizeEventTypes(payload.eventTypes);
  if (payload.status !== undefined) {
    if (!["active", "paused"].includes(payload.status)) throw new HttpError(400, "WEBHOOK_STATUS", "Status must be active or paused");
    data.status = payload.status;
    if (payload.status === "active") data.failureCount = 0;
    // Re-enabling puts a URL saved earlier back into service: check it again.
    if (payload.status === "active" && data.url === undefined) await checkedUrl(existing.url);
  }
  const row = await prisma.webhookSubscription.update({ where: { id: existing.id }, data, include });
  await auditService.recordEvent({ orgId, projectId: row.projectId, entityType: auditService.ENTITY_TYPES.WEBHOOK || "webhook", entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { name: row.name, fields: Object.keys(payload) } }).catch(() => null);
  return serializeSubscription(row);
};

const rotateSecret = async ({ orgId, actor, subscriptionId }) => {
  const existing = await prisma.webhookSubscription.findFirst({ where: { id: subscriptionId, orgId } });
  if (!existing) throw new HttpError(404, "WEBHOOK_NOT_FOUND", "Webhook not found");
  const row = await prisma.webhookSubscription.update({ where: { id: existing.id }, data: { secret: newSecret() }, include });
  await auditService.recordEvent({ orgId, projectId: row.projectId, entityType: auditService.ENTITY_TYPES.WEBHOOK || "webhook", entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { name: row.name, secretRotated: true } }).catch(() => null);
  return serializeSubscription(row, { revealSecret: true });
};

const deleteSubscription = async ({ orgId, actor, subscriptionId }) => {
  const existing = await prisma.webhookSubscription.findFirst({ where: { id: subscriptionId, orgId } });
  if (!existing) throw new HttpError(404, "WEBHOOK_NOT_FOUND", "Webhook not found");
  await prisma.webhookSubscription.delete({ where: { id: existing.id } });
  await auditService.recordEvent({ orgId, projectId: existing.projectId, entityType: auditService.ENTITY_TYPES.WEBHOOK || "webhook", entityId: existing.id, action: auditService.ACTIONS.DELETED || "deleted", actorId: actor?.id || null, summary: { name: existing.name } }).catch(() => null);
  return { deleted: true };
};

const listDeliveries = async ({ orgId, subscriptionId, status = null, limit = 50 }) => {
  const subscription = await prisma.webhookSubscription.findFirst({ where: { id: subscriptionId, orgId }, select: { id: true } });
  if (!subscription) throw new HttpError(404, "WEBHOOK_NOT_FOUND", "Webhook not found");
  const rows = await prisma.webhookDelivery.findMany({ where: { subscriptionId, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: Math.min(200, Math.max(1, Number(limit) || 50)) });
  return rows.map(serializeDelivery);
};

// ─── signing ───────────────────────────────────────────────────────────────

const sign = ({ secret, timestamp, body }) => crypto.createHmac("sha256", String(secret)).update(`${timestamp}.${body}`).digest("hex");

const signatureHeader = ({ secret, timestamp, body }) => `t=${timestamp},v1=${sign({ secret, timestamp, body })}`;

/** For receivers: verifies `X-OctaPM-Signature` against the raw body. */
const verifySignature = ({ secret, header, body, now = Math.floor(Date.now() / 1000), tolerance = SIGNATURE_TOLERANCE_S }) => {
  const parts = Object.fromEntries(String(header || "").split(",").map((part) => part.split("=").map((item) => item.trim())));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v1) return false;
  if (Math.abs(now - timestamp) > tolerance) return false;
  const expected = sign({ secret, timestamp, body });
  const given = Buffer.from(parts.v1, "hex");
  const wanted = Buffer.from(expected, "hex");
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
};

// ─── fan-out and delivery ──────────────────────────────────────────────────

const buildPayload = ({ event, subscription, delivery = null }) => ({
  id: event.id,
  type: event.type,
  event: eventNames(event)[1] || event.type,
  occurredAt: toIso(event.occurredAt) || new Date().toISOString(),
  orgId: event.orgId,
  projectId: event.projectId || null,
  entity: event.entityType ? { type: event.entityType, id: event.entityId || null } : null,
  action: event.action || null,
  actorId: event.actorId || null,
  payload: event.payload || {},
  webhook: { subscriptionId: subscription.id, deliveryId: delivery?.id || null },
});

const enqueueDelivery = async ({ orgId, delivery }) => {
  const jobService = require("../jobs/job.service");
  try {
    const job = await jobService.enqueueJob({ orgId, projectId: null, type: jobService.JOB_TYPES.WEBHOOK_DELIVER, payload: { deliveryId: delivery.id }, maxAttempts: MAX_ATTEMPTS });
    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { jobId: job.id } }).catch(() => null);
    return job;
  } catch (error) {
    console.error("[webhooks] enqueue failed", error?.message || error);
    return null;
  }
};

/** Creates deliveries for every subscription the event matches. */
const fanOut = async (event) => {
  if (!tablesReady() || !event?.orgId) return [];
  const subscriptions = await prisma.webhookSubscription.findMany({ where: { orgId: event.orgId, status: "active", OR: [{ projectId: null }, ...(event.projectId ? [{ projectId: event.projectId }] : [])] } });
  const matched = subscriptions.filter((subscription) => subscriptionMatches(subscription, event));
  const deliveries = [];
  for (const subscription of matched) {
    const delivery = await prisma.webhookDelivery.create({ data: { orgId: event.orgId, subscriptionId: subscription.id, eventId: event.id, eventType: eventNames(event)[1] || event.type, payloadJson: buildPayload({ event, subscription }) } });
    await enqueueDelivery({ orgId: event.orgId, delivery });
    deliveries.push(delivery);
  }
  return deliveries;
};

const truncate = (text) => (text ? String(text).slice(0, RESPONSE_BODY_LIMIT) : null);

const refused = (detail) => Object.assign(new Error(`Refused: ${detail}; webhooks are delivered to public internet addresses only`), { code: "WEBHOOK_TARGET_REFUSED" });

/** One POST whose socket connects only to an address that passed the check. */
const postOnce = (url, { headers, body, signal }) =>
  new Promise((resolve, reject) => {
    const allowLoopback = localReceiversAllowed();
    const host = bareAddress(url.hostname);
    // Node does not call `lookup` for an IP literal, so a literal is judged here.
    const refusal = net.isIP(host) ? refusedRange(host, { allowLoopback }) : null;
    if (refusal) return reject(new AddressRefusedError({ address: host, refusal }));
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      { method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body) }, agent: false, lookup: publicLookup({ allowLoopback }), signal },
      (response) => {
        const chunks = [];
        let size = 0;
        const finish = () => resolve({ status: response.statusCode, headers: response.headers, text: async () => Buffer.concat(chunks).toString("utf8") });
        response.on("data", (chunk) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= RESPONSE_READ_LIMIT) response.destroy();
        });
        response.on("end", finish);
        response.on("close", finish);
      },
    );
    request.on("error", reject);
    request.end(body);
  });

/**
 * runDeliveryJob's transport. POSTs the signed body and follows up to
 * MAX_REDIRECTS 307/308 redirects, each hop held to the same scheme and
 * address rules as the first; a hop that breaks them fails the attempt.
 */
const deliverRequest = async (target, { headers, body, signal }) => {
  let url = new URL(target);
  for (let hop = 0; ; hop += 1) {
    const via = hop ? `redirect to ${url.href}: ` : "";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && httpAllowed())) throw refused(`${via}webhooks must use https, not ${url.protocol.replace(/:$/, "")}`);
    let response;
    try {
      response = await postOnce(url, { headers, body, signal });
    } catch (error) {
      if (error instanceof AddressRefusedError) throw refused(`${via}${error.message}`);
      throw error;
    }
    const location = response.headers.location;
    if (!FOLLOWED_REDIRECTS.has(response.status) || !location) return response;
    if (hop === MAX_REDIRECTS) throw new Error(`Gave up after ${MAX_REDIRECTS} redirects`);
    url = new URL(location, url);
  }
};

/**
 * Job handler: one HTTP attempt for one delivery. Throws retryable errors until MAX_ATTEMPTS.
 *
 * The delivery is loaded inside the job's organisation (`orgId` on the job
 * row, or the caller's when the test send runs it inline), never by the
 * payload's id alone: a delivery of another organisation answers "missing"
 * exactly as a deleted one does (architecture doc §3, Jobs).
 */
const runDeliveryJob = async ({ job, orgId = job?.orgId || null, payload = {}, fetchImpl = deliverRequest, now = () => new Date() } = {}) => {
  if (!orgId) return { skipped: "missing" };
  const delivery = await prisma.webhookDelivery.findFirst({ where: { id: payload.deliveryId, orgId }, include: { subscription: true } });
  if (!delivery) return { skipped: "missing" };
  if (delivery.status === "delivered") return { skipped: "delivered" };
  const subscription = delivery.subscription;
  if (!subscription || subscription.status !== "active") {
    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "dead", error: "Subscription is not active" } });
    return { skipped: "inactive" };
  }
  const attempt = (delivery.attempt || 0) + 1;
  const body = JSON.stringify({ ...(delivery.payloadJson || {}), webhook: { subscriptionId: subscription.id, deliveryId: delivery.id, attempt } });
  const timestamp = Math.floor(now().getTime() / 1000);
  const headers = {
    "content-type": "application/json",
    "user-agent": "OctaPM-Webhooks/1",
    "x-octapm-event": delivery.eventType,
    "x-octapm-delivery": delivery.id,
    "x-octapm-attempt": String(attempt),
    [SIGNATURE_HEADER]: signatureHeader({ secret: subscription.secret, timestamp, body }),
  };
  const started = Date.now();
  let responseStatus = null;
  let responseBody = null;
  let error = null;
  try {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
    try {
      const response = await fetchImpl(subscription.url, { method: "POST", headers, body, signal: controller?.signal });
      responseStatus = response.status;
      responseBody = truncate(await response.text().catch(() => ""));
      if (response.status < 200 || response.status >= 300) error = `Endpoint answered ${response.status}`;
      if (response.status >= 300 && response.status < 400 && !FOLLOWED_REDIRECTS.has(response.status)) error += " (only 307 and 308 redirects are followed)";
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (caught) {
    error = caught?.name === "AbortError" ? `Timed out after ${TIMEOUT_MS / 1000}s` : caught?.message || String(caught);
  }
  const durationMs = Date.now() - started;
  const finishedAt = now();
  if (!error) {
    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { attempt, status: "delivered", responseStatus, responseBody, error: null, durationMs, deliveredAt: finishedAt, nextAttemptAt: null } });
    await prisma.webhookSubscription.update({ where: { id: subscription.id }, data: { lastDeliveryAt: finishedAt, lastStatus: "delivered", lastError: null, failureCount: 0 } }).catch(() => null);
    return { delivered: true, attempt, responseStatus, durationMs };
  }
  const dead = attempt >= MAX_ATTEMPTS;
  await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { attempt, status: dead ? "dead" : "failed", responseStatus, responseBody, error, durationMs, nextAttemptAt: dead ? null : new Date(finishedAt.getTime() + Math.min(8 * 3_600_000, 60_000 * 2 ** (attempt - 1))) } });
  if (dead) {
    const failureCount = (subscription.failureCount || 0) + 1;
    const disable = failureCount >= DISABLE_AFTER_DEAD;
    await prisma.webhookSubscription.update({ where: { id: subscription.id }, data: { lastDeliveryAt: finishedAt, lastStatus: "dead", lastError: error, failureCount, ...(disable ? { status: "disabled" } : {}) } }).catch(() => null);
    if (disable) {
      const notifications = require("./notification.service");
      await notifications.createNotifications({ orgId: subscription.orgId, projectId: subscription.projectId || null, actorId: null, recipientRoles: ["pm"], category: notifications.NOTIFICATION_CATEGORIES?.SYSTEM || "system", event: "webhook.disabled", title: `Webhook "${subscription.name}" disabled`, message: `${DISABLE_AFTER_DEAD} deliveries in a row could not be made (${error}). Fix the endpoint and re-enable it under Company › Integrations.`, priority: "high", actionUrl: "/company/integrations", entityType: "webhook", entityId: subscription.id, dedupeKeyBase: `webhook.disabled:${subscription.id}` }).catch(() => null);
    }
  } else {
    await prisma.webhookSubscription.update({ where: { id: subscription.id }, data: { lastDeliveryAt: finishedAt, lastStatus: "failed", lastError: error } }).catch(() => null);
  }
  const failure = new Error(`Webhook delivery ${delivery.id} attempt ${attempt}: ${error}`);
  failure.retryable = !dead;
  failure.code = dead ? "WEBHOOK_DEAD" : "WEBHOOK_RETRY";
  throw failure;
};

/** Queues a fresh attempt series for a dead or failed delivery. */
const redeliver = async ({ orgId, actor, deliveryId }) => {
  const existing = await prisma.webhookDelivery.findFirst({ where: { id: deliveryId, orgId }, include: { subscription: true } });
  if (!existing) throw new HttpError(404, "WEBHOOK_DELIVERY_NOT_FOUND", "Delivery not found");
  if (existing.subscription?.status !== "active") throw new HttpError(409, "WEBHOOK_INACTIVE", "Enable the webhook before redelivering");
  const delivery = await prisma.webhookDelivery.create({ data: { orgId, subscriptionId: existing.subscriptionId, eventId: existing.eventId, eventType: existing.eventType, payloadJson: existing.payloadJson } });
  await enqueueDelivery({ orgId, delivery });
  await auditService.recordEvent({ orgId, projectId: existing.subscription.projectId, entityType: auditService.ENTITY_TYPES.WEBHOOK || "webhook", entityId: existing.subscriptionId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { redelivered: existing.id, eventType: existing.eventType } }).catch(() => null);
  return serializeDelivery(delivery);
};

/** Sends a synthetic `webhook.test` event to one subscription right away. */
const sendTest = async ({ orgId, actor, subscriptionId, fetchImpl = deliverRequest }) => {
  const subscription = await prisma.webhookSubscription.findFirst({ where: { id: subscriptionId, orgId } });
  if (!subscription) throw new HttpError(404, "WEBHOOK_NOT_FOUND", "Webhook not found");
  const event = { id: crypto.randomUUID(), type: "webhook.test", orgId, projectId: subscription.projectId || null, entityType: "webhook", entityId: subscription.id, action: "test", actorId: actor?.id || null, occurredAt: new Date(), payload: { message: "Test delivery from OctaPM" } };
  const delivery = await prisma.webhookDelivery.create({ data: { orgId, subscriptionId: subscription.id, eventId: event.id, eventType: "webhook.test", payloadJson: buildPayload({ event, subscription }) } });
  try {
    const result = await runDeliveryJob({ orgId, payload: { deliveryId: delivery.id }, fetchImpl });
    return { ok: true, ...result, delivery: serializeDelivery(await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })) };
  } catch (error) {
    return { ok: false, error: error.message, delivery: serializeDelivery(await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })) };
  }
};

let unsubscribe = null;
/** Starts forwarding bus events to subscriptions (called once at boot). */
const registerWebhookSubscriber = () => {
  if (unsubscribe) return unsubscribe;
  unsubscribe = domainEvents.subscribe((event) => {
    fanOut(event).catch((error) => console.error("[webhooks] fan-out failed", error?.message || error));
  });
  return unsubscribe;
};
const unregisterWebhookSubscriber = () => {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
};

module.exports = {
  MAX_ATTEMPTS,
  EVENT_TYPES,
  SIGNATURE_HEADER,
  patternMatches,
  subscriptionMatches,
  eventNames,
  normalizeEventTypes,
  listSubscriptions,
  getSubscription,
  createSubscription,
  updateSubscription,
  rotateSecret,
  deleteSubscription,
  listDeliveries,
  sign,
  signatureHeader,
  verifySignature,
  buildPayload,
  fanOut,
  runDeliveryJob,
  redeliver,
  sendTest,
  registerWebhookSubscriber,
  unregisterWebhookSubscriber,
};
