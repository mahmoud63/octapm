const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");

/**
 * Web Push (OCTA-MOB-PWA-018). Devices register a PushSubscription; every
 * notification a user has push enabled for gets a delivery attempt on the
 * `push` channel, flushed right after creation and by the scheduler for
 * retries. Endpoints the push service reports gone (404 / 410) are removed.
 *
 * Configuration: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 * (`mailto:` or https URL). Without keys, push is reported as unavailable and
 * every attempt is skipped — nothing else changes.
 */

const MAX_PUSH_ATTEMPTS = 3;
const MAX_FAILURES_BEFORE_DROP = 5;
const PUSH_TTL_SECONDS = 6 * 60 * 60;
const FLUSH_DELAY_MS = 750;

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

const serializeSubscription = (row) => ({
  id: row.id,
  endpoint: row.endpoint,
  userAgent: row.userAgent || null,
  platform: row.platform || null,
  failureCount: row.failureCount || 0,
  lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
  createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
});

const normalizeSubscription = (input = {}) => {
  const endpoint = typeof input.endpoint === "string" ? input.endpoint.trim() : "";
  const keys = input.keys || {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 2048) throw new HttpError(400, "PUSH_ENDPOINT_INVALID", "The push endpoint must be an https URL");
  if (!p256dh || !auth) throw new HttpError(400, "PUSH_KEYS_REQUIRED", "The subscription needs its p256dh and auth keys");
  return { endpoint, p256dh, auth };
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
  const row = await prisma.pushSubscription.upsert({
    where: { endpoint: data.endpoint },
    create: { orgId, userId, ...data, userAgent: userAgent ? String(userAgent).slice(0, 300) : null, platform: platformFrom(userAgent), failureCount: 0 },
    update: { orgId, userId, p256dh: data.p256dh, auth: data.auth, userAgent: userAgent ? String(userAgent).slice(0, 300) : null, platform: platformFrom(userAgent), failureCount: 0 },
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
  return { configured: isConfigured(), publicKey: getPublicKey(), items: rows.map(serializeSubscription) };
};

const payloadFor = (notification) => ({
  title: notification.title,
  body: notification.message,
  url: notification.actionUrl || "/",
  tag: notification.entityType && notification.entityId ? `${notification.entityType}:${notification.entityId}` : `notification:${notification.id}`,
  category: notification.category,
  priority: notification.priority,
  notificationId: notification.id,
});

const GONE_STATUSES = new Set([404, 410]);

/** Sends one payload to every device of a user; drops endpoints that are gone. */
const sendToUser = async ({ userId, payload, urgency = "normal" }) => {
  if (!isConfigured()) return { sent: 0, failed: 0, removed: 0, skipped: true };
  const lib = loadWebPush();
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  const result = { sent: 0, failed: 0, removed: 0, skipped: false, errors: [] };
  for (const row of subscriptions) {
    try {
      await lib.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
        { TTL: PUSH_TTL_SECONDS, urgency },
      );
      result.sent += 1;
      await prisma.pushSubscription.update({ where: { id: row.id }, data: { lastUsedAt: new Date(), failureCount: 0 } });
    } catch (error) {
      const status = Number(error?.statusCode || 0);
      result.failed += 1;
      result.errors.push({ subscriptionId: row.id, status, message: error?.body || error?.message || "push failed" });
      if (GONE_STATUSES.has(status) || (row.failureCount || 0) + 1 >= MAX_FAILURES_BEFORE_DROP) {
        await prisma.pushSubscription.delete({ where: { id: row.id } }).catch(() => {});
        result.removed += 1;
      } else {
        await prisma.pushSubscription.update({ where: { id: row.id }, data: { failureCount: { increment: 1 } } }).catch(() => {});
      }
    }
  }
  return result;
};

const nextRetryAt = (attemptNumber, now) => new Date(now.getTime() + Math.min(2 ** attemptNumber, 60) * 60 * 1000);

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
  const configuredNow = isConfigured();
  for (const attempt of attempts) {
    result.processed += 1;
    const notification = attempt.notification;
    if (!notification || !configuredNow) {
      await prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: { status: "skipped", errorCode: configuredNow ? "PUSH_NOTIFICATION_MISSING" : "PUSH_NOT_CONFIGURED", errorMessage: configuredNow ? "Notification no longer exists" : "VAPID keys are not configured", metadataJson: { skippedAt: now.toISOString() } },
      });
      result.skipped += 1;
      continue;
    }
    const outcome = await sendToUser({ userId: attempt.userId, payload: payloadFor(notification), urgency: notification.priority === "high" ? "high" : "normal" });
    if (outcome.sent > 0 || (outcome.failed === 0 && outcome.removed === 0)) {
      await prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: { status: outcome.sent > 0 ? "sent" : "skipped", provider: "web-push", sentAt: outcome.sent > 0 ? now : null, errorCode: outcome.sent > 0 ? null : "PUSH_NO_DEVICES", errorMessage: outcome.sent > 0 ? null : "No registered devices", metadataJson: { sent: outcome.sent, removed: outcome.removed } },
      });
      if (outcome.sent > 0) result.sent += 1;
      else result.skipped += 1;
      continue;
    }
    const nextAttemptNumber = attempt.attemptNumber + 1;
    const canRetry = nextAttemptNumber <= MAX_PUSH_ATTEMPTS && outcome.removed < outcome.failed;
    await prisma.notificationDeliveryAttempt.update({
      where: { id: attempt.id },
      data: { status: "failed", provider: "web-push", errorCode: "PUSH_DELIVERY_FAILED", errorMessage: outcome.errors?.[0]?.message ? String(outcome.errors[0].message).slice(0, 500) : "Push delivery failed", nextAttemptAt: canRetry ? nextRetryAt(attempt.attemptNumber, now) : null, metadataJson: { failedAt: now.toISOString(), retryQueued: canRetry, errors: outcome.errors } },
    });
    if (canRetry) {
      await prisma.notificationDeliveryAttempt.create({
        data: { notificationId: notification.id, orgId: notification.orgId, userId: attempt.userId, channel: "push", status: "pending", attemptNumber: nextAttemptNumber, nextAttemptAt: nextRetryAt(attempt.attemptNumber, now) },
      });
    }
    result.failed += 1;
  }
  return result;
};

let flushTimer = null;
/** Flushes pending push attempts shortly after the calling transaction commits. */
const scheduleFlush = () => {
  if (!isConfigured() || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    processPendingPushDeliveries({ limit: 100 }).catch((error) => console.error("[push] flush failed", error));
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
};

const sendTest = async ({ userId }) => {
  if (!isConfigured()) throw new HttpError(503, "PUSH_NOT_CONFIGURED", "Push notifications are not configured on this server");
  return sendToUser({ userId, payload: { title: "OctaPM push is working", body: "You will get assignments and mentions here.", url: "/settings/notifications", tag: "push-test" } });
};

module.exports = {
  MAX_PUSH_ATTEMPTS,
  isConfigured,
  resetConfiguration,
  getPublicKey,
  subscribe,
  unsubscribe,
  listSubscriptions,
  sendToUser,
  sendTest,
  payloadFor,
  processPendingPushDeliveries,
  scheduleFlush,
  normalizeSubscription,
  platformFrom,
};
