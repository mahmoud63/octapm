const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { isPartyScopedAccess } = require("../services/company-party.service");
const service = require("../services/consultant.service");

/**
 * Consultants on a project (CONSULTANT V1), /projects/:projectId/consultants:
 * the consultant parties, their people and access, and Invite Consultant.
 * The contractor's own people only — never a party — and inviting or changing
 * access needs external_review.invite (PM by default).
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const contractorOnly = (req, _res, next) => (isPartyScopedAccess(req.projectAccess || {}) ? next(new HttpError(403, "FORBIDDEN", "Consultant management belongs to the contractor")) : next());
const canInvite = requirePermission("external_review", "update", { transition: "external_review.invite" });
const actorFor = (req) => ({ id: req.user.id, role: getEffectiveRole(req), name: req.user.name || null });
const accessFields = [
  body("templateKey").isIn(service.ACCESS_TEMPLATES.map((row) => row.key)),
  body("access").optional({ nullable: true }).isObject(),
  body("access.modules").optional().isObject(),
  body("access.reviews").optional().isArray({ max: 10 }),
  body("access.comment").optional().isBoolean(),
];

router.get("/", contractorOnly, requirePermission("external_review", "read"), asyncHandler(async (req, res) => sendSuccess(res, await service.overview({ orgId: req.user.orgId, projectId: req.params.projectId, actorId: req.user.id }))));

router.post(
  "/invitations",
  contractorOnly,
  canInvite,
  [
    body("companyName").isString().trim().isLength({ min: 1, max: 200 }),
    body("discipline").isIn(Object.keys(service.CONSULTANT_TYPES)),
    body("contactName").optional({ nullable: true }).isString().isLength({ max: 200 }),
    body("email").isEmail(),
    body("jobTitle").optional({ nullable: true }).isString().isLength({ max: 200 }),
    body("projectRole").optional({ nullable: true }).isString().isLength({ max: 200 }),
    body("isPrimaryReviewer").optional().isBoolean(),
    body("notes").optional({ nullable: true }).isString().isLength({ max: 2000 }),
    ...accessFields,
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await service.invite({ orgId: req.user.orgId, projectId: req.params.projectId, actor: actorFor(req), payload: req.body, context: { ipAddress: req.ip, userAgent: req.get("user-agent") || null } }), 201)
  )
);

router.put(
  "/members/:userId/access",
  contractorOnly,
  canInvite,
  [param("userId").isUUID(), ...accessFields, body("isPrimaryReviewer").optional().isBoolean(), body(["jobTitle", "projectRole"]).optional({ nullable: true }).isString().isLength({ max: 200 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.setAccess({ orgId: req.user.orgId, projectId: req.params.projectId, actor: actorFor(req), userId: req.params.userId, payload: req.body })))
);

module.exports = router;
