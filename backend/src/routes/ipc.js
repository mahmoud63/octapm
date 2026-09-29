const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { moneyBody } = require("../utils/money");
const ipcService = require("../services/ipc.service");
const { boqFigureAccess, withheldError, withheldIpcCertificate, withheldIpcItem } = require("../utils/boq-figures");

// A certificate's lines are the BOQ's rows and their allocations: a member
// who may not read the BOQ is given every certificate without them, and the
// answer to editing a line without the line (utils/boq-figures).
const withheldCertificateIn = (result, req) => {
  const access = boqFigureAccess(req);
  if (access.boq || !result || typeof result !== "object" || !result.certificate) return result;
  return { ...result, certificate: withheldIpcCertificate(result.certificate, access) };
};

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  "/",
  requirePermission("ipc", "read"),
  asyncHandler(async (req, res) => {
    const result = await ipcService.listIpcCertificates({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    const access = boqFigureAccess(req);
    return sendSuccess(res, result.map((row) => withheldIpcCertificate(row, access)));
  }),
);

router.post(
  "/",
  requirePermission("ipc", "create", {
    transition: "period.create",
  }),
  [body("period").optional().isString().trim(), validate],
  asyncHandler(async (req, res) => {
    const result = await ipcService.createIpcPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.body.period,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, withheldIpcCertificate(result, boqFigureAccess(req)), 201);
  }),
);

router.get(
  "/:period",
  requirePermission("ipc", "read"),
  [param("period").isString(), validate],
  asyncHandler(async (req, res) => {
    const result = await ipcService.getIpcPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
    });
    return sendSuccess(res, withheldIpcCertificate(result, boqFigureAccess(req)));
  }),
);

router.patch(
  "/:period/items/:id",
  requirePermission("ipc", "update", {
    transition: "item.update",
  }),
  [
    param("period").isString(),
    param("id").isUUID(),
    body("qty").optional().isFloat({ min: 0 }).toFloat(),
    moneyBody("rate"),
    body("retentionRate").optional().isFloat({ min: 0 }).toFloat(),
    body("status").optional().isIn(["draft", "submitted", "certified", "paid"]),
    body("certDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await ipcService.updateIpcItem({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
      itemId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, withheldIpcItem(result, boqFigureAccess(req)));
  }),
);

/**
 * Stored materials and deductions on a certificate.
 *
 * Neither is measured work, so neither belongs on a BOQ line — but both move
 * what the client owes, so they live on the certificate and a deduction has to
 * say what it is for.
 */
router.patch(
  "/:period/adjustments",
  requirePermission("ipc", "update", {
    transition: "item.update",
  }),
  [
    param("period").isString(),
    moneyBody("materialsOnSite"),
    moneyBody("materialsAtCost"),
    moneyBody("deductions"),
    body("deductionsNote")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 500 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await ipcService.updateCertificateAdjustments({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
      payload: req.body,
      userId: req.user.id,
    });
    return sendSuccess(res, withheldIpcCertificate(result, boqFigureAccess(req)));
  }),
);

router.post(
  "/:period/submit",
  requirePermission("ipc", "submit", {
    transition: "period.submit",
  }),
  [param("period").isString(), validate],
  asyncHandler(async (req, res) => {
    const result = await ipcService.submitIpcPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, withheldIpcCertificate(result, boqFigureAccess(req)));
  }),
);

router.post(
  "/:period/certify",
  requirePermission("ipc", "certify", {
    transition: "period.certify",
  }),
  [
    param("period").isString(),
    body("comment").optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    body("overrideReason")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({
        max: 2000,
      }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await ipcService.certifyIpcPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      comment: req.body?.comment || null,
      overrideReason: req.body?.overrideReason || null,
    });
    return sendSuccess(res, withheldIpcCertificate(result, boqFigureAccess(req)));
  }),
);

router.post(
  "/:period/invoice/issue",
  requirePermission("ipc", "approve", {
    transition: "invoice.issue",
  }),
  [
    param("period").isString(),
    body("invoiceNumber").optional().isString().trim().isLength({ max: 100 }),
    body("invoiceDate").optional({ nullable: true }).isISO8601(),
    body("dueDate").optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await ipcService.issueIpcInvoice({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
      payload: req.body || {},
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  "/:period/payments",
  requirePermission("ipc", "approve", {
    transition: "payment.record",
  }),
  [
    param("period").isString(),
    moneyBody("amount", { required: true }),
    body("paymentReference")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 120 }),
    body("paymentDate").optional({ nullable: true }).isISO8601(),
    body("paymentMethod")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({
        max: 80,
      }),
    body("notes").optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await ipcService.recordIpcPayment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
      payload: req.body || {},
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, withheldCertificateIn(result, req), 201);
  }),
);

router.post(
  "/:period/retention-release",
  requirePermission("ipc", "approve", {
    transition: "retention.release",
  }),
  [
    param("period").isString(),
    moneyBody("amount", { required: true }),
    body("releaseReference")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 120 }),
    body("releaseDate").optional({ nullable: true }).isISO8601(),
    body("reason").optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await ipcService.releaseIpcRetention({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
      payload: req.body || {},
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, withheldCertificateIn(result, req), 201);
  }),
);

// ... and so are its refusals. Certifying a period that needs a PM override
// is refused (IPC_PM_OVERRIDE_REASON_REQUIRED, IPC_PM_OVERRIDE_REQUIRED) with
// the certification review as error.details — the allocations' amounts and
// what approved progress earned against them. Every refusal of this router
// goes through withheldError, which leaves the review out for a caller who
// may not read the BOQ; status, code and message stay.
router.use((error, req, res, next) => next(withheldError(error, boqFigureAccess(req))));

module.exports = router;
