/**
 * /api/v1/platform-admin — the OctaPM platform operations console API.
 *
 * Every route: requirePlatformAdmin (fail closed, independent of any
 * organisation membership) → auditPlatformAction (trail written before the
 * handler; no trail, nothing served) → input validation → a read-only service.
 * V1 has no mutating route here: no impersonation, no customer-data editing,
 * no billing changes. Access itself is granted only by
 * scripts/platform/platform-access.js.
 */
const express = require("express");
const { param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { dateInput } = require("../utils/date-input");
const { validate } = require("../middleware/validate");
const { auditPlatformAction, requirePlatformAdmin } = require("../middleware/platform-admin");
const platformAdmin = require("../services/platform/platform-admin.service");
const analytics = require("../services/platform/platform-analytics.service");
const health = require("../services/platform/platform-health.service");
const platformAudit = require("../services/platform/platform-audit.service");
const platformAi = require("../services/platform/platform-ai.service");
const platformFeatures = require("../services/platform/platform-features.service");
const { daysAgo, paging, pageInfo } = require("../services/platform/platform-read-models");

const router = express.Router();
router.use(requirePlatformAdmin);

const PAGE = [
  query("page").optional().isInt({ min: 1, max: 100000 }).toInt(),
  query("pageSize").optional().isInt({ min: 1, max: 100 }).toInt(),
];
const SEARCH = query("q").optional().isString().trim().isLength({ max: 120 });
const sortOf = (sorts) => query("sort").optional().isIn(Object.keys(sorts));
const ORG_ID = query("orgId").optional().isString().isUUID();

router.get(
  "/session",
  auditPlatformAction("platform.session"),
  asyncHandler(async (req, res) => sendSuccess(res, { operator: req.platformAdmin })),
);

router.get(
  "/overview",
  auditPlatformAction("platform.overview.view"),
  asyncHandler(async (_req, res) => sendSuccess(res, await platformAdmin.getOverview())),
);

router.get(
  "/companies",
  auditPlatformAction("platform.companies.list"),
  [
    ...PAGE,
    SEARCH,
    sortOf(platformAdmin.COMPANY_SORTS),
    query("plan").optional().isIn(["trial", "individual", "business", "enterprise", "standard"]),
    query("subscriptionStatus").optional().isIn(["incomplete", "trialing", "active", "past_due", "canceled", "expired"]),
    query("status").optional().isString().isLength({ max: 32 }).matches(/^[a-z_]+$/),
    query("kind").optional().isIn(["company", "personal"]),
    query("activity").optional().isIn(["active", "inactive"]),
    query("size").optional().isIn(["solo", "small", "medium", "large"]),
    query("createdFrom").optional().isString().custom(dateInput).toDate(),
    query("createdTo").optional().isString().custom(dateInput).toDate(),
  ],
  validate,
  asyncHandler(async (req, res) => sendSuccess(res, await platformAdmin.listCompanies(req.query))),
);

router.get(
  "/companies/:orgId",
  auditPlatformAction("platform.company.view", (req) => ({ type: "organisation", id: req.params.orgId, orgId: req.params.orgId })),
  [param("orgId").isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const company = await platformAdmin.getCompany(req.params.orgId);
    // The company's AI consumption (gateway ledger, 30 days) and which capabilities its projects use: counts only.
    const [ai, features] = await Promise.all([
      platformAi.getAiUsage({ days: 30, orgId: req.params.orgId }),
      platformFeatures.getFeatureAdoption({ orgId: req.params.orgId }),
    ]);
    return sendSuccess(res, { ...company, ai: { windowDays: 30, configuration: ai.configuration, today: ai.today, window: ai.window, byFeature: ai.byFeature, byModel: ai.byModel, byUser: ai.byUser, failures: ai.failures, todayShareOfLimit: ai.byOrganisation[0]?.todayShareOfLimit ?? null }, features: { capabilities: features.byCompany[0]?.capabilities || {}, projects: features.byCompany[0]?.projects || 0, inventoryItems: features.byCompany[0]?.inventoryItems || 0, detail: features.detail } });
  }),
);

router.get(
  "/ai-usage",
  auditPlatformAction("platform.ai_usage.view", (req) => (req.query.orgId ? { type: "organisation", id: req.query.orgId, orgId: req.query.orgId } : {})),
  [query("days").optional().isIn(["1", "7", "30", "90"]), ORG_ID],
  validate,
  asyncHandler(async (req, res) => sendSuccess(res, await platformAi.getAiUsage({ days: req.query.days, orgId: req.query.orgId || null }))),
);

router.get(
  "/features",
  auditPlatformAction("platform.features.view", (req) => (req.query.orgId ? { type: "organisation", id: req.query.orgId, orgId: req.query.orgId } : {})),
  [ORG_ID],
  validate,
  asyncHandler(async (req, res) => sendSuccess(res, await platformFeatures.getFeatureAdoption({ orgId: req.query.orgId || null }))),
);

router.get(
  "/search",
  auditPlatformAction("platform.search"),
  [query("q").isString().trim().isLength({ min: 2, max: 120 })],
  validate,
  asyncHandler(async (req, res) => sendSuccess(res, await platformAdmin.search(req.query.q))),
);

router.get(
  "/users",
  auditPlatformAction("platform.users.list", (req) => ({ orgId: req.query.orgId })),
  [
    ...PAGE,
    SEARCH,
    sortOf(platformAdmin.USER_SORTS),
    ORG_ID,
    query("status").optional().isString().isLength({ max: 32 }).matches(/^[a-z_]+$/),
    query("multiCompany").optional().isIn(["true", "false"]),
    query("lastLogin").optional().isIn(["never", "30d", "stale"]),
  ],
  validate,
  asyncHandler(async (req, res) => sendSuccess(res, await platformAdmin.listUsers(req.query))),
);

router.get(
  "/projects",
  auditPlatformAction("platform.projects.list", (req) => ({ orgId: req.query.orgId })),
  [
    ...PAGE,
    SEARCH,
    sortOf(platformAdmin.PROJECT_SORTS),
    ORG_ID,
    query("status").optional().isString().isLength({ max: 32 }).matches(/^[a-z_]+$/),
  ],
  validate,
  asyncHandler(async (req, res) => sendSuccess(res, await platformAdmin.listProjects(req.query))),
);

router.get(
  "/subscriptions",
  auditPlatformAction("platform.subscriptions.list"),
  [
    ...PAGE,
    SEARCH,
    sortOf(platformAdmin.SUBSCRIPTION_SORTS),
    query("plan").optional().isString().isLength({ max: 32 }).matches(/^[a-z_]+$/),
    query("status").optional().isIn(["incomplete", "trialing", "active", "past_due", "canceled", "expired"]),
    query("paymentIssue").optional().isIn(["true", "false"]),
    query("trialEndingDays").optional().isInt({ min: 1, max: 90 }),
  ],
  validate,
  asyncHandler(async (req, res) => sendSuccess(res, await platformAdmin.listSubscriptions(req.query))),
);

router.get(
  "/analytics",
  auditPlatformAction("platform.analytics.view"),
  [query("windowDays").optional().isIn(["7", "30", "90"])],
  validate,
  asyncHandler(async (req, res) =>
    sendSuccess(res, await analytics.getProductAnalytics({ windowDays: req.query.windowDays })),
  ),
);

router.get(
  "/health",
  auditPlatformAction("platform.health.view"),
  asyncHandler(async (_req, res) => sendSuccess(res, await health.getSystemHealth())),
);

router.get(
  "/errors",
  auditPlatformAction("platform.errors.view"),
  asyncHandler(async (_req, res) => sendSuccess(res, await health.getErrorAnalytics())),
);

router.get(
  "/audit",
  auditPlatformAction("platform.audit.view"),
  [
    ...PAGE,
    query("actorUserId").optional().isString().isUUID(),
    query("targetOrgId").optional().isString().isUUID(),
    query("action").optional().isString().isLength({ max: 80 }).matches(/^[a-z_.]+$/),
    query("days").optional().isInt({ min: 1, max: 365 }).toInt(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const paged = paging(req.query);
    const now = new Date();
    const { total, rows } = await platformAudit.listAuditEvents({
      ...paged,
      actorUserId: req.query.actorUserId,
      targetOrgId: req.query.targetOrgId,
      action: req.query.action,
      from: daysAgo(req.query.days || 30, now),
      to: now,
    });
    return sendSuccess(res, { items: rows, page: pageInfo(paged, total) });
  }),
);

module.exports = router;
