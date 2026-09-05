const express = require("express");
const { body } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/contract.service");

/** Contract intelligence (OCTA-AI-CONTRACT-032): `/projects/:projectId/contract`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const user = (req) => ({ ...req.user, role: getEffectiveRole(req) });
const viewer = (req) => ({ id: req.user.id, role: getEffectiveRole(req), isCompanyAdmin: Boolean(req.user.isCompanyAdmin), projectAccess: req.projectAccess || null });
const optionalInt = (field, max = 3650) => body(field).optional({ nullable: true }).isInt({ min: 0, max });

router.get(
  "/",
  requirePermission("eot", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, await service.getProfile(scope(req)))),
);

router.put(
  "/",
  requirePermission("eot", "update"),
  [
    body("form").optional().isIn(Object.keys(service.FORMS)),
    optionalInt("delayNoticeDays"),
    optionalInt("claimParticularsDays"),
    optionalInt("variationNoticeDays"),
    optionalInt("responseDays"),
    optionalInt("paymentDays"),
    optionalInt("defectsLiabilityDays"),
    body("ldCapPct").optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body("documentIds").optional().isArray({ max: 20 }),
    body("documentIds.*").isUUID(),
    body("clauses").optional().isArray({ max: 200 }),
    body("clauses.*.category").optional({ nullable: true }).isIn(service.CLAUSE_CATEGORIES),
    body("clauses.*.status").optional({ nullable: true }).isIn(["draft", "confirmed", "rejected"]),
    body("confirm").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.updateProfile({ ...scope(req), payload: req.body, actor: user(req) }))),
);

router.post(
  "/extract",
  requirePermission("assistant", "read"),
  requirePermission("eot", "update"),
  [body("documentIds").optional().isArray({ max: 10 }), body("documentIds.*").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.extractClauses({ ...scope(req), user: user(req), payload: req.body, viewer: viewer(req) }))),
);

router.get(
  "/notices",
  requirePermission("eot", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, await service.noticeMonitor(scope(req)))),
);

router.post(
  "/notices/draft",
  requirePermission("assistant", "read"),
  requirePermission("document_control", "create"),
  [body("recordType").isIn(Object.values(service.RECORD_TYPES)), body("recordId").isUUID(), body("instructions").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.draftNotice({ ...scope(req), user: user(req), payload: req.body }))),
);

router.post(
  "/notices",
  requirePermission("document_control", "create"),
  [
    body("recordType").isIn(Object.values(service.RECORD_TYPES)),
    body("recordId").isUUID(),
    body("subject").isString().trim().isLength({ min: 1, max: 200 }),
    body("body").isString().trim().isLength({ min: 1, max: 12000 }),
    body("activityId").optional({ nullable: true }).isUUID(),
    body("date").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.createNotice({ ...scope(req), user: user(req), payload: req.body }), 201)),
);

module.exports = router;
