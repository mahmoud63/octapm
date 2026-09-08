const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/sub-pay-app.service");

/** Subcontractor payment applications (OCTA-FIN-SUBPAY-021): `/projects/:projectId/pay-apps`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
const viewer = (req) => ({ id: req.user.id, projectAccess: req.projectAccess });

const lineValidators = [
  body("lines").optional().isArray({ max: 500 }),
  body("lines.*.sovLineId").isUUID(),
  body("lines.*.thisPeriodAmount").optional({ nullable: true }).isFloat({ min: 0 }),
  body("lines.*.thisPeriodPct").optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
  body("lines.*.materialsOnSite").optional({ nullable: true }).isFloat({ min: 0 }),
  body("lines.*.notes").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
];

router.get(
  "/",
  requirePermission("sub_pay_app", "read"),
  [query("commitmentId").optional({ values: "falsy" }).isUUID(), query("status").optional().isIn(service.STATUSES), query("includeVoid").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.listPayApps({ ...scope(req), query: req.query, viewer: viewer(req) }))),
);

router.post(
  "/",
  requirePermission("sub_pay_app", "create"),
  [
    body("commitmentId").isUUID(),
    body("periodLabel").isString().trim().notEmpty().isLength({ max: 60 }),
    body("periodStart").optional({ nullable: true }).isISO8601(),
    body("periodEnd").optional({ nullable: true }).isISO8601(),
    body("retentionRate").optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body("waiverRequired").optional().isBoolean().toBoolean(),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.createPayApp({ ...scope(req), payload: req.body, actor: actor(req), viewer: viewer(req) }), 201)),
);

router.get(
  "/:payAppId",
  requirePermission("sub_pay_app", "read"),
  [param("payAppId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.getPayApp({ ...scope(req), payAppId: req.params.payAppId, viewer: viewer(req) }))),
);

router.patch(
  "/:payAppId",
  requirePermission("sub_pay_app", "update"),
  [
    param("payAppId").isUUID(),
    body("periodLabel").optional().isString().trim().notEmpty().isLength({ max: 60 }),
    body("periodStart").optional({ nullable: true }).isISO8601(),
    body("periodEnd").optional({ nullable: true }).isISO8601(),
    body("retentionRate").optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body("backCharges").optional({ nullable: true }).isFloat({ min: 0 }),
    body("backChargesNote").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    body("otherDeductions").optional({ nullable: true }).isFloat({ min: 0 }),
    body("otherDeductionsNote").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    body("taxRate").optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body("waiverRequired").optional().isBoolean().toBoolean(),
    body("waiverDocumentId").optional({ nullable: true }).isUUID(),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
    ...lineValidators,
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.updatePayApp({ ...scope(req), payAppId: req.params.payAppId, payload: req.body, actor: actor(req), viewer: viewer(req) }))),
);

router.delete(
  "/:payAppId",
  requirePermission("sub_pay_app", "delete", { transition: "sub_pay_app.void" }),
  [param("payAppId").isUUID(), body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.voidPayApp({ ...scope(req), payAppId: req.params.payAppId, actor: actor(req), reason: req.body?.reason || req.query?.reason || null }))),
);

router.post(
  "/:payAppId/submit",
  requirePermission("sub_pay_app", "submit", { transition: "sub_pay_app.submit" }),
  [param("payAppId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.submitPayApp({ ...scope(req), payAppId: req.params.payAppId, actor: actor(req), viewer: viewer(req) }))),
);

router.post(
  "/:payAppId/review",
  requirePermission("sub_pay_app", "submit", { transition: "sub_pay_app.review" }),
  [param("payAppId").isUUID(), body("note").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.reviewPayApp({ ...scope(req), payAppId: req.params.payAppId, actor: actor(req), note: req.body.note }))),
);

router.post(
  "/:payAppId/approve",
  requirePermission("sub_pay_app", "approve", { transition: "sub_pay_app.approve" }),
  [param("payAppId").isUUID(), body("complianceOverrideReason").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }), body("overClaimOverrideReason").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(res, await service.approvePayApp({ ...scope(req), payAppId: req.params.payAppId, actor: actor(req), complianceOverrideReason: req.body.complianceOverrideReason || null, overClaimOverrideReason: req.body.overClaimOverrideReason || null })),
  ),
);

router.post(
  "/:payAppId/reject",
  requirePermission("sub_pay_app", "submit", { transition: "sub_pay_app.reject" }),
  [param("payAppId").isUUID(), body("code").optional().isIn(service.REJECTION_CODES), body("reason").isString().trim().notEmpty().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.rejectPayApp({ ...scope(req), payAppId: req.params.payAppId, actor: actor(req), code: req.body.code, reason: req.body.reason }))),
);

/**
 * Back to draft. From rejected that is an ordinary resubmission; from approved
 * it revokes the certificate and reverses the cost it posted, so it needs the
 * approval permission and a stated reason.
 */
router.post(
  "/:payAppId/reopen",
  requirePermission("sub_pay_app", "update"),
  [param("payAppId").isUUID(), body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.reopenPayApp({ ...scope(req), payAppId: req.params.payAppId, actor: actor(req), viewer: viewer(req), reason: req.body?.reason ?? null }))),
);

router.post(
  "/:payAppId/payments",
  requirePermission("sub_pay_app", "certify", { transition: "sub_pay_app.pay" }),
  [
    param("payAppId").isUUID(),
    body("amount").isFloat({ gt: 0 }),
    body("paidAt").optional({ nullable: true }).isISO8601(),
    body("method").optional({ nullable: true }).isString().trim().isLength({ max: 60 }),
    body("reference").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body("note").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.recordPayment({ ...scope(req), payAppId: req.params.payAppId, payload: req.body, actor: actor(req) }), 201)),
);

router.get(
  "/:payAppId/export.pdf",
  requirePermission("sub_pay_app", "export"),
  [param("payAppId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const { fileName, buffer } = await service.exportStatementPdf({ ...scope(req), payAppId: req.params.payAppId, viewer: viewer(req) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  }),
);

module.exports = router;
