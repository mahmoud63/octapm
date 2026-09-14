const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const { requirePermission, hasPermission } = require("../middleware/rbac");
const { sendSuccess } = require("../utils/api-response");
const { moneyBody } = require("../utils/money");
const {
  listSubValuations,
  createSubValuation,
  updateSubValuation,
  deleteSubValuation,
  attributionReport,
} = require("../services/sub-valuation.service");

/**
 * Legacy subcontractor valuations, retained read-only (OCTA-FIN-SUBVAL-064).
 * Payment applications against a subcontract commitment replaced them; see
 * `sub-valuation.service` for what stays possible and why.
 */
const router = express.Router({ mergeParams: true });

router.get(
  "/",
  requirePermission("sub_pay_app", "read"),
  asyncHandler(async (req, res) => {
    const data = await listSubValuations({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      projectAccess: req.projectAccess || null,
    });

    return sendSuccess(res, data);
  }),
);

/** Which company each free-text name most likely meant. Proposes only. */
router.get(
  "/attribution",
  requirePermission("sub_pay_app", "read"),
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await attributionReport({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
      }),
    ),
  ),
);

// Retired. Answers with the replacement rather than a bare refusal.
router.post(
  "/",
  requirePermission("sub_pay_app", "create"),
  asyncHandler(async (req, res) => {
    const row = await createSubValuation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      payload: req.body,
    });

    return sendSuccess(res, row, 201);
  }),
);

// Marking a valuation certified or paid is the certifying or paying
// authority's act, not any editor's (Phase 21D, CX21-513); the service
// applies it on a change of status only, so an edit that repeats the
// status it has passes (CX21-527).
const statusAuthority = (req) => ({
  pay: hasPermission(req, "sub_pay_app", "approve", { transition: "sub_pay_app.pay" }),
  certify: hasPermission(req, "sub_pay_app", "certify"),
});

router.patch(
  "/:valuationId",
  requirePermission("sub_pay_app", "update"),
  [
    param("valuationId").isUUID(),
    // Attribution to a real company. The free-text name is immutable — see
    // SUB_VALUATION_NAME_IMMUTABLE.
    body("companyId").optional({ nullable: true }).isUUID(),
    moneyBody("workDone"),
    moneyBody("materialsOnSite"),
    body("retentionRate").optional().isFloat({ min: 0, max: 100 }),
    moneyBody("backCharges"),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("activityLinks.*.relationType").optional().isString().trim(),
    body("activityLinks.*.quantity").optional().isFloat({ min: 0 }),
    moneyBody("activityLinks.*.amount"),
    body("allocationLinks").optional().isArray(),
    body("allocationLinks.*.allocationId")
      .optional({ nullable: true })
      .isUUID(),
    body("allocationLinks.*.boqItemId").optional({ nullable: true }).isUUID(),
    body("allocationLinks.*.quantity").optional().isFloat({ min: 0 }),
    moneyBody("allocationLinks.*.workDoneAmount"),
    moneyBody("allocationLinks.*.materialsOnSiteAmount"),
    body("correspondenceIds").optional().isArray(),
    body("correspondenceIds.*").optional().isUUID(),
    body("correspondenceLinks").optional().isArray(),
    body("correspondenceLinks.*.correspondenceId").optional().isUUID(),
    body("attachmentRefs").optional().isArray(),
    body("status").optional().isIn(["draft", "submitted", "certified", "paid"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateSubValuation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      valuationId: req.params.valuationId,
      userId: req.user.id,
      payload: req.body,
      authority: statusAuthority(req),
      projectAccess: req.projectAccess || null,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:valuationId",
  requirePermission("sub_pay_app", "delete"),
  [param("valuationId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteSubValuation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      valuationId: req.params.valuationId,
      userId: req.user.id,
          projectAccess: req.projectAccess || null,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
