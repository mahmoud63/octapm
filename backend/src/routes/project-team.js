const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requireCompanyAdmin } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const permissionTemplateService = require("../services/permission-template.service");

/**
 * Project team: who has access to the project and which permission template
 * governs them. Any project member may read the team; only company admins and
 * project managers may change template assignments.
 */

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.listProjectTeam({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.put(
  "/:userId/permissions",
  requireCompanyAdmin,
  [
    param("userId").isUUID(),
    body("templateId").optional({ nullable: true }).isUUID(),
    body("overrides").optional({ nullable: true }).isObject(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.setProjectUserPermission({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.params.userId,
      payload: req.body,
      actorId: req.user.id,
      actorRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.delete(
  "/:userId/permissions",
  requireCompanyAdmin,
  [param("userId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.removeProjectUserPermission({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.params.userId,
      actorId: req.user.id,
      actorRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.put(
  "/parties/:partyId/permissions",
  requireCompanyAdmin,
  [
    param("partyId").isUUID(),
    body("templateId").optional({ nullable: true }).isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.setPartyTemplate({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      partyId: req.params.partyId,
      payload: req.body,
      actorId: req.user.id,
      actorRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
