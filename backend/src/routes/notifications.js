const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requireRoles, personal } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const notificationService = require("../services/notification.service");
const pushService = require("../services/push.service");

const router = express.Router();

router.use(authenticate);
// The inbox, its summary, its devices and its preferences are the person's
// own. A key acts as its owner for the work it is scoped to, never for this:
// a key limited to one project with an inventory scope read its owner's
// notifications from every project (Phase 21D, CX21-494).
router.use(personal("A person's notifications"));

const categories = notificationService.CATEGORY_ORDER;

// ─── Web Push devices (OCTA-MOB-PWA-018) ───────────────────────────────────

router.get(
  "/push/public-key",
  asyncHandler(async (_req, res) =>
    sendSuccess(res, { configured: pushService.isConfigured(), publicKey: pushService.getPublicKey() }),
  ),
);

router.get(
  "/push/subscriptions",
  asyncHandler(async (req, res) => sendSuccess(res, await pushService.listSubscriptions({ userId: req.user.id }))),
);

router.post(
  "/push/subscriptions",
  [
    body("endpoint").isString().trim().isLength({ min: 10, max: 2048 }),
    body("keys.p256dh").isString().trim().notEmpty(),
    body("keys.auth").isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await pushService.subscribe({
        orgId: req.user.orgId,
        userId: req.user.id,
        subscription: { endpoint: req.body.endpoint, keys: req.body.keys },
        userAgent: req.headers["user-agent"] || null,
      }),
      201,
    ),
  ),
);

router.delete(
  "/push/subscriptions",
  [body("endpoint").isString().trim().notEmpty(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await pushService.unsubscribe({ userId: req.user.id, endpoint: req.body.endpoint }))),
);

router.post(
  "/push/test",
  asyncHandler(async (req, res) => sendSuccess(res, await pushService.sendTest({ userId: req.user.id }))),
);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const data = await notificationService.getNotificationSummary({
      orgId: req.user.orgId,
      userId: req.user.id,
    });
    return sendSuccess(res, data);
  }),
);

router.get(
  "/preferences",
  asyncHandler(async (req, res) => {
    const data = await notificationService.getUserPreferences({
      orgId: req.user.orgId,
      userId: req.user.id,
    });
    return sendSuccess(res, data);
  }),
);

router.put(
  "/preferences",
  [
    body("preferences").isArray({ min: 1 }),
    body("preferences.*.category").isIn(categories),
    body("preferences.*.inAppEnabled").optional().isBoolean().toBoolean(),
    body("preferences.*.emailEnabled").optional().isBoolean().toBoolean(),
    body("preferences.*.pushEnabled").optional().isBoolean().toBoolean(),
    body("preferences.*.digestEnabled").optional().isBoolean().toBoolean(),
    body("preferences.*.dueSoonDays")
      .optional()
      .isInt({ min: 1, max: 30 })
      .toInt(),
    body("preferences.*.quietHoursStart")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 5 }),
    body("preferences.*.quietHoursEnd")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 5 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const data = await notificationService.updateUserPreferences({
      orgId: req.user.orgId,
      userId: req.user.id,
      preferences: req.body.preferences,
    });
    return sendSuccess(res, data);
  }),
);

router.get(
  "/",
  [
    query("cursor").optional().isUUID(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("status")
      .optional()
      .isIn(["active", "all", "unread", "read", "archived"]),
    query("category").optional().isIn(categories),
    query("projectId").optional().isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const data = await notificationService.listNotifications({
      orgId: req.user.orgId,
      userId: req.user.id,
      query: req.query,
    });
    return sendSuccess(res, data);
  }),
);

router.post(
  "/mark-read",
  asyncHandler(async (req, res) => {
    const data = await notificationService.markAllRead({
      orgId: req.user.orgId,
      userId: req.user.id,
    });
    return sendSuccess(res, data);
  }),
);

router.post(
  "/deliveries/retry",
  [body("limit").optional().isInt({ min: 1, max: 100 }).toInt(), validate],
  asyncHandler(async (req, res) => {
    const data = await notificationService.processPendingEmailDeliveries({
      userId: req.user.id,
      limit: req.body.limit || 25,
    });
    return sendSuccess(res, data);
  }),
);

router.post(
  "/scan-due",
  requireRoles("pm", "planning_eng"),
  [
    body("projectId").optional({ nullable: true }).isUUID(),
    body("horizonDays").optional().isInt({ min: 1, max: 30 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const data = await notificationService.runDueNotificationScan({
      orgId: req.user.orgId,
      projectId: req.body.projectId || null,
      horizonDays: req.body.horizonDays || 3,
    });
    return sendSuccess(res, data, 201);
  }),
);

router.get(
  "/:notificationId",
  [param("notificationId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await notificationService.getNotificationForUser({
      orgId: req.user.orgId,
      userId: req.user.id,
      notificationId: req.params.notificationId,
    });
    return sendSuccess(res, data);
  }),
);

router.patch(
  "/:notificationId/read",
  [
    param("notificationId").isUUID(),
    body("read").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const data = await notificationService.markNotificationRead({
      orgId: req.user.orgId,
      userId: req.user.id,
      notificationId: req.params.notificationId,
      read: req.body.read !== false,
    });
    return sendSuccess(res, data);
  }),
);

router.patch(
  "/:notificationId/archive",
  [param("notificationId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await notificationService.archiveNotification({
      orgId: req.user.orgId,
      userId: req.user.id,
      notificationId: req.params.notificationId,
    });
    return sendSuccess(res, data);
  }),
);

router.post(
  "/:notificationId/retry-email",
  [param("notificationId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await notificationService.retryNotificationEmail({
      orgId: req.user.orgId,
      userId: req.user.id,
      notificationId: req.params.notificationId,
    });
    return sendSuccess(res, data, 202);
  }),
);

module.exports = router;
