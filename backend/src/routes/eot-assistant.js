const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { requirePermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/contract.service");

/**
 * EOT entitlement assessment (OCTA-AI-CONTRACT-032). Mounted inside the EOT
 * router (`/projects/:projectId/eot`), which already authenticates and
 * resolves project access; registered before the `/:claimId` routes.
 */
const router = express.Router({ mergeParams: true });

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId, claimId: req.params.claimId, user: { ...req.user, role: getEffectiveRole(req) } });

router.post(
  "/:claimId/ai/assess",
  requirePermission("assistant", "read"),
  requirePermission("eot", "read"),
  [param("claimId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.assessClaim(scope(req)))),
);

router.post(
  "/:claimId/ai/apply",
  requirePermission("assistant", "read"),
  requirePermission("eot", "update"),
  [param("claimId").isUUID(), body("analysis").optional({ nullable: true }).isString().trim().isLength({ max: 8000 }), body("claimLetter").optional({ nullable: true }).isString().trim().isLength({ max: 12000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.applyAssessment({ ...scope(req), payload: req.body }))),
);

module.exports = router;
