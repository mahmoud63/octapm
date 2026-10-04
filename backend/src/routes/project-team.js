const express = require("express");
const { body, param, query } = require("express-validator");
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

/**
 * Colleagues who could be put on this project, with the ones already here
 * marked. This is the "existing company user" half of the team screen; the
 * other half — somebody who has no account yet — goes through the email
 * invitation at POST /users/invitations, and the two are deliberately separate
 * journeys (OCTA-UX-TEAM-093).
 */
router.get(
  "/assignable",
  requireCompanyAdmin,
  [query("search").optional().isString().trim(), validate],
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.listAssignableUsers({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      search: req.query.search || null,
    });
    return sendSuccess(res, result);
  }),
);

/** Put an existing colleague on this project. */
router.post(
  "/",
  requireCompanyAdmin,
  [
    body("userId").isString().isUUID(),
    // Optional: what they do *here*. Defaults to their company role, because
    // that is right nearly always, but a planner brought on to run cost
    // control can be assigned as one without changing who they are elsewhere.
    body("role").optional({ values: "falsy" }).isIn(["pm","planning_eng","qs","cost_controller","procurement","warehouse","site_engineer","finance"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.addProjectMember({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.body.userId,
      role: req.body.role || null,
      actorId: req.user.id,
      actorRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result, result.alreadyOnProject ? 200 : 201);
  }),
);

/**
 * Take somebody off this project. Their account, their other projects and
 * everything they authored here are untouched.
 */
router.delete(
  "/:userId",
  requireCompanyAdmin,
  [param("userId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await permissionTemplateService.removeProjectMember({
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
  "/:userId/permissions",
  requireCompanyAdmin,
  [
    param("userId").isUUID(),
    body("templateId").optional({ nullable: true }).isString().isUUID(),
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
    body("templateId").optional({ nullable: true }).isString().isUUID(),
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
