const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");

/**
 * Web Push (OCTA-MOB-PWA-018). Devices register a PushSubscription; every
 * notification a user has push enabled for gets a delivery attempt on the
 * `push` channel, flushed right after creation and by the scheduler for
 * retries. Endpoints the push service reports gone (404 / 410) are removed.
 *
 * Configuration: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 * (`mailto:` or https URL). Without keys, Web Push is reported as unavailable
 * and browser attempts are skipped — nothing else changes.
 *
 * Native devices (the field app, MOBILE-M9) register an Expo push token on
 * the same table: the token is the `endpoint`, the key columns stay empty and
 * `platform` is `expo-ios` or `expo-android`. Those rows are sent through
 * Expo's push API in one batch per user; a token Expo reports as no longer
 * registered is removed. Expo needs no server key; EXPO_PUSH_ACCESS_TOKEN is
 * sent as a bearer when set, and EXPO_PUSH_ENABLED=false switches it off.
 */

const MAX_PUSH_ATTEMPTS = 3;
const MAX_FAILURES_BEFORE_DROP = 5;
const PUSH_TTL_SECONDS = 6 * 60 * 60;
const FLUSH_DELAY_MS = 750;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;
const EXPO_PLATFORMS = new Set(["ios", "android"]);
// Mirrors membership.service's MEMBERSHIP_STATUSES.ACTIVE; read as a literal
// so this module does not load the membership service and its dependencies.
const ACTIVE_MEMBERSHIP = "active";

let webPush = null;
let configured = null;

const loadWebPush = () => {
  if (webPush !== null) return webPush;
  try {
    // eslint-disable-next-line global-require
    webPush = require("web-push");
  } catch {
    webPush = false;
  }
  return webPush;
};

const vapid = () => ({
  publicKey: (process.env.VAPID_PUBLIC_KEY || "").trim(),
  privateKey: (process.env.VAPID_PRIVATE_KEY || "").trim(),
  subject: (process.env.VAPID_SUBJECT || (process.env.WEB_APP_URL ? process.env.WEB_APP_URL : "mailto:support@octapm.app")).trim(),
});

/** Web Push is configured: the library loads and both VAPID keys are set. */
const isConfigured = () => {
  if (configured !== null) return configured;
  const keys = vapid();
  const lib = loadWebPush();
  configured = Boolean(lib && keys.publicKey && keys.privateKey);
  if (configured) {
    try {
      lib.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
    } catch (error) {
      console.warn("[push] VAPID keys rejected:", error.message);
      configured = false;
    }
  }
  return configured;
};

/** Test hook: forget the cached configuration. */
const resetConfiguration = () => {
  configured = null;
};

const getPublicKey = () => (isConfigured() ? vapid().publicKey : null);

const expoEnabled = () => String(process.env.EXPO_PUSH_ENABLED || "true").trim().toLowerCase() !== "false";
const isExpoRow = (row) => EXPO_TOKEN_PATTERN.test(String(row?.endpoint || ""));

const serializeSubscription = (row) => ({
  id: row.id,
  provider: isExpoRow(row) ? "expo" : "web",
  endpoint: row.endpoint,
  userAgent: row.userAgent || null,
  platform: row.platform || null,
  failureCount: row.failureCount || 0,
  lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
  createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
});

const normalizeSubscription = (input = {}) => {
  const token = typeof input.token === "string" ? input.token.trim() : "";
  const endpoint = typeof input.endpoint === "string" ? input.endpoint.trim() : "";
  if (input.provider === "expo" || EXPO_TOKEN_PATTERN.test(token || endpoint)) {
    const value = token || endpoint;
    if (!EXPO_TOKEN_PATTERN.test(value)) throw new HttpError(400, "PUSH_TOKEN_INVALID", "The Expo push token must look like ExponentPushToken[...]");
    const platform = typeof input.platform === "string" ? input.platform.trim().toLowerCase() : "";
    if (!EXPO_PLATFORMS.has(platform)) throw new HttpError(400, "PUSH_PLATFORM_INVALID", "platform must be ios or android");
    return { endpoint: value, p256dh: "", auth: "", provider: "expo", platform: `expo-${platform}` };
  }
  const keys = input.keys || {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 2048) throw new HttpError(400, "PUSH_ENDPOINT_INVALID", "The push endpoint must be an https URL");
  if (!p256dh || !auth) throw new HttpError(400, "PUSH_KEYS_REQUIRED", "The subscription needs its p256dh and auth keys");
  return { endpoint, p256dh, auth, provider: "web", platform: null };
};

const platformFrom = (userAgent = "") => {
  const ua = String(userAgent);
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return null;
};

const subscribe = async ({ orgId, userId, subscription, userAgent = null }) => {
  const data = normalizeSubscription(subscription);
  const agent = userAgent ? String(userAgent).slice(0, 300) : null;
  const platform = data.provider === "expo" ? data.platform : platformFrom(userAgent);
  const row = await prisma.pushSubscription.upsert({
    where: { endpoint: data.endpoint },
    create: { orgId, userId, endpoint: data.endpoint, p256dh: data.p256dh, auth: data.auth, userAgent: agent, platform, failureCount: 0 },
    update: { orgId, userId, p256dh: data.p256dh, auth: data.auth, userAgent: agent, platform, failureCount: 0 },
  });
  return serializeSubscription(row);
};

const unsubscribe = async ({ userId, endpoint }) => {
  const target = typeof endpoint === "string" ? endpoint.trim() : "";
  if (!target) throw new HttpError(400, "PUSH_ENDPOINT_INVALID", "endpoint is required");
  const result = await prisma.pushSubscription.deleteMany({ where: { userId, endpoint: target } });
  return { removed: result.count };
};

const listSubscriptions = async ({ userId }) => {
  const rows = await prisma.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return { configured: isConfigured(), expoEnabled: expoEnabled(), publicKey: getPublicKey(), items: rows.map(serializeSubscription) };
};

/**
 * The payload one device receives. `workspace` names the recipient's place
 * in the notification's workspace — its slug and their membership id — so
 * the field app, whose session is bound to one workspace at a time, can tell
 * whether a tapped notification belongs to the active workspace, offer the
 * switch when it does not, and never route it silently into the wrong one
 * (workspace switching doc §5). The orgId comes from the row itself.
 */
const payloadFor = (notification, workspace = null) => ({
  title: notification.title,
  body: notification.message,
  url: notification.actionUrl || "/",
  tag: notification.entityType && notification.entityId ? `${notification.entityType}:${notification.entityId}` : `notification:${notification.id}`,
  category: notification.category,
  priority: notification.priority,
  notificationId: notification.id,
  // The field app routes on these without parsing the web URL.
  entityType: notification.entityType || null,
  entityId: notification.entityId || null,
  projectId: notification.projectId || null,
  orgId: notification.orgId || null,
  orgSlug: workspace?.slug || null,
  membershipId: workspace?.membershipId || null,
});

// The slug is read once a minute per workspace, not once per device: a
// burst of pushes for one workspace is the common case.
const WORKSPACE_SLUG_TTL_MS = 60_000;
const workspaceSlugCache = new Map();

const workspaceSlugFor = async (orgId) => {
  if (!orgId) return null;
  const cached = workspaceSlugCache.get(orgId);
  if (cached && cached.until > Date.now()) return cached.slug;
  let slug = null;
  if (typeof prisma?.organisation?.findUnique === "function") {
    try {
      const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { slug: true } });
      slug = org?.slug || null;
    } catch {
      slug = null;
    }
  }
  workspaceSlugCache.set(orgId, { slug, until: Date.now() + WORKSPACE_SLUG_TTL_MS });
  return slug;
};

/**
 * The recipient's place in the notification's workspace. A person seeded
 * before memberships, or a client that does not know the model, gives a
 * payload with the orgId alone; the app then falls back to the slug-less
 * comparison it makes for any link.
 *
 * `revoked` is true when the person has a membership row in the workspace
 * that is not active (suspended, invited, left): the workspace has removed
 * them, so nothing of it may reach their devices (§11) — a push queued
 * before the removal included. Only an active membership lends its id.
 */
const workspaceFor = async ({ orgId, userId }) => {
  const slug = await workspaceSlugFor(orgId);
  let membershipId = null;
  let revoked = false;
  if (orgId && userId && typeof prisma?.organizationMembership?.findFirst === "function") {
    try {
      const row = await prisma.organizationMembership.findFirst({ where: { orgId, userId }, select: { id: true, status: true } });
      if (row && row.status === ACTIVE_MEMBERSHIP) membershipId = row.id;
      else if (row) revoked = true;
    } catch {
      membershipId = null;
    }
  }
  return { orgId: orgId || null, slug, membershipId, revoked };
};

/**
 * The payload for one recipient of a notification: the row plus their
 * workspace — or null when the recipient's membership in that workspace is
 * no longer active, so the caller sends nothing.
 */
const buildPushPayload = async ({ notification, userId }) => {
  const workspace = await workspaceFor({ orgId: notification.orgId, userId });
  if (workspace.revoked) return null;
  // The push says what the in-app row says: a row stored before the
  // no-identifier rule is re-rendered (notification.service), never sent
  // with a raw id in its title or body.
  const { readableNotification } = require("./notification.service");
  return payloadFor(await readableNotification(notification), workspace);
};

/** Test hook: forget the remembered slugs. */
const resetWorkspaceCache = () => workspaceSlugCache.clear();

const GONE_STATUSES = new Set([404, 410]);

const dropOrCount = async (row, result) => {
  if (GONE_STATUSES.has(row.__status) || (row.failureCount || 0) + 1 >= MAX_FAILURES_BEFORE_DROP) {
    await prisma.pushSubscription.delete({ where: { id: row.id } }).catch(() => {});
    result.removed += 1;
  } else {
    await prisma.pushSubscription.update({ where: { id: row.id }, data: { failureCount: { increment: 1 } } }).catch(() => {});
  }
};

const markUsed = (row) => prisma.pushSubscription.update({ where: { id: row.id }, data: { lastUsedAt: new Date(), failureCount: 0 } });

/** One request to Expo for every native device of the user; one ticket per device comes back in order. */
const sendThroughExpo = async (rows, payload, urgency, result) => {
  const messages = rows.map((row) => ({
    to: row.endpoint,
    title: payload.title,
    body: payload.body,
    data: {
      url: payload.url,
      tag: payload.tag,
      category: payload.category || null,
      notificationId: payload.notificationId || null,
      entityType: payload.entityType || null,
      entityId: payload.entityId || null,
      projectId: payload.projectId || null,
      // The workspace the notification belongs to (workspace switching doc §5).
      orgId: payload.orgId || null,
      orgSlug: payload.orgSlug || null,
      membershipId: payload.membershipId || null,
    },
    sound: "default",
    priority: urgency === "high" ? "high" : "default",
    channelId: "default",
  }));
  const headers = { "content-type": "application/json", accept: "application/json" };
  const accessToken = (process.env.EXPO_PUSH_ACCESS_TOKEN || "").trim();
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  let tickets;
  try {
    const response = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(messages) });
    if (!response.ok) throw Object.assign(new Error(`Expo push service answered ${response.status}`), { statusCode: response.status });
    const body = await response.json();
    tickets = Array.isArray(body?.data) ? body.data : [];
  } catch (error) {
    // The service, not the devices, failed: count the attempt and keep every token.
    result.failed += rows.length;
    result.errors.push({ provider: "expo", status: Number(error?.statusCode || 0), message: error?.message || "Expo push failed" });
    return;
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const ticket = tickets[index] || { status: "error", message: "No ticket returned" };
    if (ticket.status === "ok") {
      result.sent += 1;
      result.providers.add("expo");
      await markUsed(row);
      continue;
    }
    result.failed += 1;
    result.errors.push({ subscriptionId: row.id, provider: "expo", status: 0, message: ticket.message || "Expo push failed" });
    if (ticket.details?.error === "DeviceNotRegistered") {
      await prisma.pushSubscription.delete({ where: { id: row.id } }).catch(() => {});
      result.removed += 1;
    } else {
      await dropOrCount(row, result);
    }
  }
};

const sendThroughWebPush = async (rows, payload, urgency, result) => {
  const lib = loadWebPush();
  for (const row of rows) {
    try {
      await lib.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload), { TTL: PUSH_TTL_SECONDS, urgency });
      result.sent += 1;
      result.providers.add("web-push");
      await markUsed(row);
    } catch (error) {
      const status = Number(error?.statusCode || 0);
      result.failed += 1;
      result.errors.push({ subscriptionId: row.id, provider: "web-push", status, message: error?.body || error?.message || "push failed" });
      await dropOrCount({ ...row, __status: status }, result);
    }
  }
};

/** Sends one payload to every device of a user; drops endpoints that are gone. */
const sendToUser = async ({ userId, payload, urgency = "normal" }) => {
  const webOk = isConfigured();
  const expoOk = expoEnabled();
  if (!webOk && !expoOk) return { sent: 0, failed: 0, removed: 0, skipped: true };
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  const expoRows = subscriptions.filter(isExpoRow);
  const webRows = subscriptions.filter((row) => !isExpoRow(row));
  if (!webOk && expoRows.length === 0) return { sent: 0, failed: 0, removed: 0, skipped: true };
  const result = { sent: 0, failed: 0, removed: 0, skipped: false, errors: [], providers: new Set() };
  if (webOk && webRows.length) await sendThroughWebPush(webRows, payload, urgency, result);
  if (expoOk && expoRows.length) await sendThroughExpo(expoRows, payload, urgency, result);
  const providers = [...result.providers];
  return { ...result, providers, provider: providers.length ? providers.join(",") : expoRows.length && !webRows.length ? "expo" : "web-push" };
};

const nextRetryAt = (attemptNumber, now) => new Date(now.getTime() + Math.min(2 ** attemptNumber, 60) * 60 * 1000);

// How long a claimed push stays out of other processes' reach; far longer than
// one send. A process that dies mid-send leaves the row to be retried after it.
const DELIVERY_LEASE_MS = 5 * 60 * 1000;

/**
 * Claims a pending attempt for this process: still pending and unchanged since
 * it was read (updatedAt moves on every write), so of two racing processes
 * exactly one gets count 1. The row keeps its `pending` status; only
 * nextAttemptAt moves past the lease. The outcome update below restores it.
 * The lease starts from the clock at the claim, not the batch's `now`, which
 * may be minutes old by the time a long email batch hands over to push.
 */
const claimDeliveryAttempt = async (attempt, now = new Date()) => {
  const claimed = await prisma.notificationDeliveryAttempt.updateMany({
    where: { id: attempt.id, status: "pending", updatedAt: attempt.updatedAt },
    data: { nextAttemptAt: new Date(Math.max(now.getTime(), Date.now()) + DELIVERY_LEASE_MS) },
  });
  return claimed.count === 1;
};

/** Mirrors the email loop: pending `push` attempts are sent, retried or skipped. */
const processPendingPushDeliveries = async ({ limit = 50, now = new Date(), userId = null, notificationId = null } = {}) => {
  if (!prisma.notificationDeliveryAttempt?.findMany) return { sent: 0, failed: 0, skipped: 0, processed: 0 };
  const where = {
    channel: "push",
    status: "pending",
    attemptNumber: { lte: MAX_PUSH_ATTEMPTS },
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
  };
  if (userId) where.userId = userId;
  if (notificationId) where.notificationId = notificationId;
  const attempts = await prisma.notificationDeliveryAttempt.findMany({
    where,
    take: Math.min(Math.max(Number(limit) || 50, 1), 200),
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    include: { notification: true },
  });
  const result = { sent: 0, failed: 0, skipped: 0, processed: 0 };
  for (const attempt of attempts) {
    // The debounced flush and the scheduler on every task read the same
    // pending rows; only the process whose claim lands sends the push.
    if (!(await claimDeliveryAttempt(attempt, now))) continue;
    result.processed += 1;
    const notification = attempt.notification;
    // A BOQ record's notice stored before the reader rule, for someone who
    // may not read that BOQ, is not pushed (notification.service).
    const { mayReceive } = require("./notification.service");
    if (
      notification &&
      !(await mayReceive({
        orgId: notification.orgId,
        userId: attempt.userId,
        projectId: notification.projectId,
        entityType: notification.entityType,
      }))
    ) {
      await prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: { nextAttemptAt: attempt.nextAttemptAt ?? null, status: "skipped", errorCode: "RECIPIENT_MAY_NOT_READ_RECORD", errorMessage: "The recipient may not read the record this notification is about" },
      });
      result.skipped += 1;
      continue;
    }
    // Every device of the person gets the same payload: the device belongs to
    // the identity, the payload names the workspace (fan-out per identity).
    const payload = notification ? await buildPushPayload({ notification, userId: attempt.userId }) : null;
    if (notification && !payload) {
      // Queued before the workspace removed the person: their other
      // workspaces keep the devices, this one no longer reaches them.
      await prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: { nextAttemptAt: attempt.nextAttemptAt ?? null, status: "skipped", errorCode: "PUSH_RECIPIENT_NOT_MEMBER", errorMessage: "The recipient is no longer an active member of the notification's workspace" },
      });
      result.skipped += 1;
      continue;
    }
    const outcome = notification
      ? await sendToUser({ userId: attempt.userId, payload, urgency: notification.priority === "high" ? "high" : "normal" })
      : null;
    if (!notification || outcome.skipped) {
      await prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          nextAttemptAt: attempt.nextAttemptAt ?? null,
          status: "skipped",
          errorCode: notification ? "PUSH_NOT_CONFIGURED" : "PUSH_NOTIFICATION_MISSING",
          errorMessage: notification ? "Web Push has no VAPID keys and the person has no native device" : "Notification no longer exists",
        },
      });
      result.skipped += 1;
      continue;
    }
    if (outcome.sent > 0 || (outcome.failed === 0 && outcome.removed === 0)) {
      await prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: { nextAttemptAt: attempt.nextAttemptAt ?? null, status: outcome.sent > 0 ? "sent" : "skipped", provider: outcome.provider, sentAt: outcome.sent > 0 ? now : null, errorCode: outcome.sent > 0 ? null : "PUSH_NO_DEVICES", errorMessage: outcome.sent > 0 ? null : "No registered device" },
      });
      if (outcome.sent > 0) result.sent += 1;
      else result.skipped += 1;
      continue;
    }
    const nextAttemptNumber = attempt.attemptNumber + 1;
    const canRetry = nextAttemptNumber <= MAX_PUSH_ATTEMPTS && outcome.removed < outcome.failed;
    await prisma.notificationDeliveryAttempt.update({
      where: { id: attempt.id },
      data: { nextAttemptAt: attempt.nextAttemptAt ?? null, status: "failed", provider: outcome.provider, errorCode: "PUSH_DELIVERY_FAILED", errorMessage: outcome.errors?.[0]?.message ? String(outcome.errors[0].message).slice(0, 500) : "Push delivery failed" },
    });
    if (canRetry) {
      await prisma.notificationDeliveryAttempt.create({
        data: { notificationId: notification.id, orgId: notification.orgId, userId: attempt.userId, channel: "push", status: "pending", attemptNumber: nextAttemptNumber, nextAttemptAt: nextRetryAt(nextAttemptNumber, now) },
      });
    }
    result.failed += 1;
  }
  return result;
};

let flushTimer = null;

/** Flushes pending push attempts shortly after the calling transaction commits. */
const scheduleFlush = () => {
  if ((!isConfigured() && !expoEnabled()) || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    processPendingPushDeliveries({ limit: 100 }).catch((error) => console.error("[push] flush failed", error));
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
};

const sendTest = async ({ userId }) => {
  if (!isConfigured()) {
    const rows = expoEnabled() ? await prisma.pushSubscription.findMany({ where: { userId } }) : [];
    if (!rows.some(isExpoRow)) throw new HttpError(503, "PUSH_NOT_CONFIGURED", "Push notifications are not configured on this server");
  }
  return sendToUser({ userId, payload: { title: "OctaPM push is working", body: "You will get assignments and mentions here.", url: "/settings/notifications", tag: "push-test" } });
};

module.exports = {
  MAX_PUSH_ATTEMPTS,
  EXPO_PUSH_URL,
  EXPO_TOKEN_PATTERN,
  isConfigured,
  expoEnabled,
  isExpoRow,
  resetConfiguration,
  getPublicKey,
  subscribe,
  unsubscribe,
  listSubscriptions,
  sendToUser,
  sendTest,
  payloadFor,
  buildPushPayload,
  workspaceFor,
  resetWorkspaceCache,
  processPendingPushDeliveries,
  scheduleFlush,
  normalizeSubscription,
  platformFrom,
};
