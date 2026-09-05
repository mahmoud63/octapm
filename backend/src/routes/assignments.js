const express = require("express");
const { body, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requireCompanyAdmin } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const recordAssignmentService = require("../services/record-assignment.service");

/**
 * Accountability references for a project: the unresolved backfill report,
 * manual mapping, and the caller's open items.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  "/mine",
  [query("limit").optional().isInt({ min: 1, max: 500 }).toInt(), validate],
  asyncHandler(async (req, res) => {
    const result = await recordAssignmentService.listMyOpenItems({
      orgId: req.user.orgId,
      userId: req.user.id,
      projectIds: [req.params.projectId],
      limit: req.query.limit || 200,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  "/unresolved",
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const result = await recordAssignmentService.listUnresolvedAssignments({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/resolve",
  requireCompanyAdmin,
  [
    body("recordType").isIn(recordAssignmentService.RECORD_TYPE_IDS),
    body("recordId").isUUID(),
    body("field").isIn(recordAssignmentService.ASSIGNABLE_FIELDS),
    body("userId").optional({ nullable: true }).isUUID(),
    body("companyId").optional({ nullable: true }).isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await recordAssignmentService.resolveAssignment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      actorId: req.user.id,
      actorRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
