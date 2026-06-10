const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { moneyBody } = require("../utils/money");
const ipcService = require("../services/ipc.service");

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
    return sendSuccess(res, result);
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
      userRole: req.user.role,
    });
    return sendSuccess(res, result, 201);
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
    return sendSuccess(res, result);
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
    return sendSuccess(res, result);
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
      userRole: req.user.role,
    });
    return sendSuccess(res, result);
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
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await ipcService.certifyIpcPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
      userId: req.user.id,
      userRole: req.user.role,
      comment: req.body?.comment || null,
    });
    return sendSuccess(res, result);
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
      userRole: req.user.role,
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
      userRole: req.user.role,
    });
    return sendSuccess(res, result, 201);
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
      userRole: req.user.role,
    });
    return sendSuccess(res, result, 201);
  }),
);

module.exports = router;
