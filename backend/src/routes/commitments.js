const express = require("express");
const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { requirePermission, getEffectiveRole, hasPermission } = require("../middleware/rbac");
const { uploadLimiter } = require("../middleware/rate-limit");
const { validate } = require("../middleware/validate");
const fileStorageService = require("../services/file-storage.service");
const commitmentService = require("../services/commitment.service");

/** Commitments (OCTA-FIN-COMMIT-020): `/projects/:projectId/commitments`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req), projectAccess: req.projectAccess });
const viewer = (req) => ({ id: req.user.id, role: getEffectiveRole(req), projectAccess: req.projectAccess });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, fileStorageService.ensureTempUploadDirSync());
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || "").toLowerCase()}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (fileStorageService.ALLOWED_WORKFLOW_MIME.has(file.mimetype) && fileStorageService.isAllowedOriginalNameForType(fileStorageService.DOCUMENT_TYPES.WORKFLOW_ATTACHMENT, file.originalname)) return cb(null, true);
    return cb(new HttpError(400, "UNSUPPORTED_ATTACHMENT", "Only PDF, Word, Excel, images and text files are allowed"));
  },
});

const lineValidators = (prefix) => [
  body(`${prefix}.*.description`).isString().trim().notEmpty(),
  body(`${prefix}.*.costCodeId`).optional({ nullable: true }).isUUID(),
  body(`${prefix}.*.budgetLineId`).optional({ nullable: true }).isUUID(),
  body(`${prefix}.*.boqItemId`).optional({ nullable: true }).isUUID(),
  body(`${prefix}.*.activityId`).optional({ nullable: true }).isUUID(),
  body(`${prefix}.*.qty`).optional({ nullable: true }).isFloat({ min: 0 }),
  body(`${prefix}.*.rate`).optional({ nullable: true }).isFloat(),
  body(`${prefix}.*.amount`).optional({ nullable: true }).isFloat(),
];

const commitmentValidators = ({ requireTitle = false } = {}) => [
  requireTitle ? body("title").isString().trim().notEmpty().isLength({ max: 200 }) : body("title").optional().isString().trim().notEmpty().isLength({ max: 200 }),
  body("type").optional().isIn(commitmentService.TYPES),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
  body("vendorCompanyId").optional({ nullable: true }).isUUID(),
  body("supplierId").optional({ nullable: true }).isUUID(),
  body("retentionRate").optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
  body("paymentTerms").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body("currency").optional({ nullable: true }).isString().trim().isLength({ min: 3, max: 3 }),
  body("startDate").optional({ nullable: true }).isISO8601(),
  body("endDate").optional({ nullable: true }).isISO8601(),
  body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
  body("insurance").optional().isArray({ max: 20 }),
  body("lines").optional().isArray({ max: 500 }),
  ...lineValidators("lines"),
];

const coValidators = ({ requireTitle = false } = {}) => [
  requireTitle ? body("title").isString().trim().notEmpty().isLength({ max: 200 }) : body("title").optional().isString().trim().notEmpty().isLength({ max: 200 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
  body("value").optional({ nullable: true }).isFloat(),
  body("primeChangeOrderId").optional({ nullable: true }).isUUID(),
  body("lines").optional().isArray({ max: 500 }),
  body("lines.*.amount").isFloat(),
  // The schedule-of-values line this change moves. Without it the change
  // raises the commitment's revised value but not the line's billing ceiling.
  body("lines.*.sovLineId").optional({ nullable: true }).isUUID(),
  body("lines.*.description").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body("lines.*.costCodeId").optional({ nullable: true }).isUUID(),
  body("lines.*.budgetLineId").optional({ nullable: true }).isUUID(),
  body("lines.*.activityId").optional({ nullable: true }).isUUID(),
];

router.get(
  "/",
  requirePermission("commitment", "read"),
  [
    query("type").optional().isIn(commitmentService.TYPES),
    query("status").optional().isIn(commitmentService.STATUSES),
    query("vendorCompanyId").optional({ values: "falsy" }).isUUID(),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("includeVoid").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.listCommitments({ ...scope(req), query: req.query, viewer: viewer(req) }))),
);

router.post(
  "/",
  requirePermission("commitment", "create"),
  [...commitmentValidators({ requireTitle: true }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.createCommitment({ ...scope(req), payload: req.body, actor: actor(req) }), 201)),
);

router.post(
  "/change-orders/from-prime",
  requirePermission("commitment", "create"),
  [body("primeChangeOrderId").isUUID(), body("items").isArray({ min: 1, max: 100 }), body("items.*.commitmentId").isUUID(), body("items.*.value").optional({ nullable: true }).isFloat(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.spawnFromPrimeChangeOrder({ ...scope(req), payload: req.body, actor: actor(req) }), 201)),
);

router.patch(
  "/change-orders/:changeOrderId",
  requirePermission("commitment", "update"),
  [param("changeOrderId").isUUID(), ...coValidators(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.updateChangeOrder({ ...scope(req), changeOrderId: req.params.changeOrderId, payload: req.body, actor: actor(req) }))),
);

const coTransition = (to, permission, transition) =>
  router.post(
    `/change-orders/:changeOrderId/${to === "pending" ? "submit" : to === "approved" ? "approve" : to === "rejected" ? "reject" : "void"}`,
    requirePermission("commitment", permission, transition ? { transition } : undefined),
    [param("changeOrderId").isUUID(), body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }), validate],
    asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.transitionChangeOrder({ ...scope(req), changeOrderId: req.params.changeOrderId, to, actor: actor(req), reason: req.body.reason }))),
  );
coTransition("pending", "submit", "commitment_co.submit");
coTransition("approved", "approve", "commitment_co.approve");
coTransition("rejected", "approve", "commitment_co.approve");
coTransition("void", "update", null);

router.get(
  "/:commitmentId",
  requirePermission("commitment", "read"),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.getCommitment({ ...scope(req), commitmentId: req.params.commitmentId, viewer: viewer(req) }))),
);

router.patch(
  "/:commitmentId",
  requirePermission("commitment", "update"),
  [param("commitmentId").isUUID(), ...commitmentValidators(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.updateCommitment({ ...scope(req), commitmentId: req.params.commitmentId, payload: req.body, actor: actor(req) }))),
);

router.put(
  "/:commitmentId/lines",
  requirePermission("commitment", "update"),
  [param("commitmentId").isUUID(), body("lines").isArray({ max: 500 }), ...lineValidators("lines"), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.replaceLines({ ...scope(req), commitmentId: req.params.commitmentId, payload: req.body, actor: actor(req) }))),
);

router.put(
  "/:commitmentId/insurance",
  requirePermission("commitment", "update"),
  [param("commitmentId").isUUID(), body("insurance").isArray({ max: 20 }), body("insurance.*.type").optional().isIn(commitmentService.INSURANCE_TYPES), body("insurance.*.documentId").optional({ nullable: true }).isUUID(), body("insurance.*.expiresAt").optional({ nullable: true }).isISO8601(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.setInsurance({ ...scope(req), commitmentId: req.params.commitmentId, payload: req.body, actor: actor(req) }))),
);

router.post(
  "/:commitmentId/submit",
  requirePermission("commitment", "submit", { transition: "commitment.submit" }),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.submitCommitment({ ...scope(req), commitmentId: req.params.commitmentId, actor: actor(req) }))),
);

router.post(
  "/:commitmentId/approve",
  requirePermission("commitment", "approve", { transition: "commitment.approve" }),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.approveCommitment({ ...scope(req), commitmentId: req.params.commitmentId, actor: actor(req) }))),
);

router.post(
  "/:commitmentId/return",
  requirePermission("commitment", "approve", { transition: "commitment.approve" }),
  [param("commitmentId").isUUID(), body("reason").isString().trim().notEmpty().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.returnCommitment({ ...scope(req), commitmentId: req.params.commitmentId, actor: actor(req), reason: req.body.reason }))),
);

router.post(
  "/:commitmentId/execute",
  requirePermission("commitment", "approve", { transition: "commitment.execute" }),
  uploadLimiter,
  upload.single("file"),
  [param("commitmentId").isUUID(), body("documentId").optional({ nullable: true }).isUUID(), body("override").optional().isBoolean().toBoolean(), body("overrideReason").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await commitmentService.executeCommitment({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        actor: actor(req),
        file: req.file || null,
        documentId: req.body.documentId || null,
        override: Boolean(req.body.override),
        overrideReason: req.body.overrideReason || null,
        canOverride: hasPermission(req, "commitment", "approve", { transition: "commitment.void" }),
      }),
    ),
  ),
);

router.post(
  "/:commitmentId/close",
  requirePermission("commitment", "approve", { transition: "commitment.close" }),
  [
    param("commitmentId").isUUID(),
    // Closing over an outstanding checklist is allowed with a reason: the
    // alternative is somebody ticking the checklist to get past it, which
    // loses the record of what was actually outstanding.
    body("closeoutOverrideReason").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.closeCommitment({ ...scope(req), commitmentId: req.params.commitmentId, actor: actor(req), closeoutOverrideReason: req.body?.closeoutOverrideReason ?? null }))),
);

router.delete(
  "/:commitmentId",
  requirePermission("commitment", "delete", { transition: "commitment.void" }),
  [param("commitmentId").isUUID(), body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.voidCommitment({ ...scope(req), commitmentId: req.params.commitmentId, actor: actor(req), reason: req.body?.reason || req.query?.reason || null }))),
);

router.get(
  "/:commitmentId/change-orders",
  requirePermission("commitment", "read"),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const commitment = await commitmentService.getCommitment({ ...scope(req), commitmentId: req.params.commitmentId, viewer: viewer(req) });
    return sendSuccess(res, { items: commitment.changeOrders });
  }),
);

router.post(
  "/:commitmentId/change-orders",
  requirePermission("commitment", "create"),
  [param("commitmentId").isUUID(), ...coValidators({ requireTitle: true }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await commitmentService.createChangeOrder({ ...scope(req), commitmentId: req.params.commitmentId, payload: req.body, actor: actor(req) }), 201)),
);

// ─── scope and responsibility (OCTA-SUB-SCOPE-054) ─────────────────────────

const scopeService = require("../services/scope-matrix.service");

/** Created on first read, seeded with the rows that cause arguments. */
router.get(
  "/:commitmentId/scope",
  requirePermission("commitment", "read"),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await scopeService.getForCommitment({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        userId: req.user.id,
      }),
    ),
  ),
);

/** The whole list is sent, so a row removed on screen is removed here. */
router.put(
  "/:commitmentId/scope",
  requirePermission("commitment", "update", { transition: "scope.manage" }),
  [
    param("commitmentId").isUUID(),
    body("title").optional().isString().trim().isLength({ min: 1, max: 200 }),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
    body("items").isArray({ max: 500 }),
    body("items.*.kind").optional().isIn(scopeService.KINDS),
    body("items.*.section").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("items.*.description").isString().trim().notEmpty().isLength({ max: 500 }),
    body("items.*.responsibility").optional({ nullable: true }).isIn(scopeService.PARTIES),
    body("items.*.notes").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await scopeService.replaceItems({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        userId: req.user.id,
        payload: req.body,
      }),
    ),
  ),
);

/** Refused while any row of work has nobody against it. */
router.post(
  "/:commitmentId/scope/agree",
  requirePermission("commitment", "approve", { transition: "scope.agree" }),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await scopeService.agree({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        userId: req.user.id,
      }),
    ),
  ),
);

router.post(
  "/:commitmentId/scope/reopen",
  requirePermission("commitment", "approve", { transition: "scope.agree" }),
  [
    param("commitmentId").isUUID(),
    body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await scopeService.reopen({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        userId: req.user.id,
        reason: req.body?.reason ?? null,
      }),
    ),
  ),
);

// ─── closeout (OCTA-SUB-CLOSE-056) ─────────────────────────────────────────

const closeoutService = require("../services/closeout.service");

/** The checklist: four derived checks, then the handover documents. */
router.get(
  "/:commitmentId/closeout",
  requirePermission("commitment", "read"),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await closeoutService.buildCloseout({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        userId: req.user.id,
      }),
    ),
  ),
);

/**
 * Marks one requirement. A derived check cannot be ticked — close the punch
 * items, file the certificate, pay the application — only waived, with a
 * reason.
 */
router.patch(
  "/:commitmentId/closeout/items/:key",
  requirePermission("commitment", "update", { transition: "closeout.manage" }),
  [
    param("commitmentId").isUUID(),
    param("key").isString().trim().isLength({ min: 1, max: 60 }),
    body("status").optional().isIn(closeoutService.STATUSES),
    body("documentId").optional({ nullable: true }).isUUID(),
    body("note").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    body("waivedReason").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await closeoutService.updateItem({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        key: req.params.key,
        payload: req.body,
        userId: req.user.id,
      }),
    ),
  ),
);

/** Stamps the closeout complete; refused while anything required is open. */
router.post(
  "/:commitmentId/closeout/complete",
  requirePermission("commitment", "approve", { transition: "closeout.approve" }),
  [
    param("commitmentId").isUUID(),
    body("overrideReason").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await closeoutService.complete({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        userId: req.user.id,
        override: req.body?.overrideReason ?? null,
      }),
    ),
  ),
);

router.post(
  "/:commitmentId/closeout/reopen",
  requirePermission("commitment", "approve", { transition: "closeout.approve" }),
  [
    param("commitmentId").isUUID(),
    body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await closeoutService.reopen({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        userId: req.user.id,
        reason: req.body?.reason ?? null,
      }),
    ),
  ),
);

// ─── performance evaluation (OCTA-SUB-PERF-058) ────────────────────────────

const evaluationService = require("../services/subcontractor-evaluation.service");

/**
 * The evaluation: six lines read from the records, two rated by a person.
 * Created on first read with all eight listed.
 */
router.get(
  "/:commitmentId/evaluation",
  requirePermission("commitment", "read"),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await evaluationService.buildEvaluation({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        userId: req.user.id,
      }),
    ),
  ),
);

/** Rates a line, or overrides a derived one — which needs a reason. */
router.patch(
  "/:commitmentId/evaluation/criteria/:key",
  requirePermission("commitment", "update", { transition: "evaluation.manage" }),
  [
    param("commitmentId").isUUID(),
    param("key").isString().trim().isLength({ min: 1, max: 60 }),
    body("score").optional({ nullable: true }).isInt({ min: 0, max: 5 }).toInt(),
    body("overrideReason").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    body("note").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await evaluationService.scoreCriterion({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        key: req.params.key,
        payload: req.body,
        userId: req.user.id,
      }),
    ),
  ),
);

/** Whether you would use them again, and why — the part that is not a score. */
router.patch(
  "/:commitmentId/evaluation",
  requirePermission("commitment", "update", { transition: "evaluation.manage" }),
  [
    param("commitmentId").isUUID(),
    body("wouldReuse").optional({ nullable: true }).isBoolean().toBoolean(),
    body("summary").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await evaluationService.setVerdict({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        payload: req.body,
        userId: req.user.id,
      }),
    ),
  ),
);

/** Finalising is what makes it count towards the company's history. */
router.post(
  "/:commitmentId/evaluation/final",
  requirePermission("commitment", "approve", { transition: "evaluation.approve" }),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await evaluationService.finalise({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        userId: req.user.id,
      }),
    ),
  ),
);

router.post(
  "/:commitmentId/evaluation/reopen",
  requirePermission("commitment", "approve", { transition: "evaluation.approve" }),
  [
    param("commitmentId").isUUID(),
    body("reason").isString().trim().notEmpty().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await evaluationService.reopen({
        ...scope(req),
        commitmentId: req.params.commitmentId,
        userId: req.user.id,
        reason: req.body.reason,
      }),
    ),
  ),
);

// ─── the subcontract agreement (OCTA-SUB-DOC-055) ──────────────────────────

const agreementService = require("../services/subcontract-agreement.service");

/**
 * Everything the agreement will say, as data — plus what is still missing.
 *
 * The gaps are named rather than counted, so the screen can list them instead
 * of just refusing.
 */
router.get(
  "/:commitmentId/agreement",
  requirePermission("commitment", "read"),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await agreementService.buildAgreement({
        ...scope(req),
        commitmentId: req.params.commitmentId,
      }),
    ),
  ),
);

/** The agreement itself, assembled from records rather than typed. */
router.get(
  "/:commitmentId/agreement.pdf",
  requirePermission("commitment", "export"),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const { fileName, buffer } = await agreementService.exportAgreementPdf({
      ...scope(req),
      commitmentId: req.params.commitmentId,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  }),
);

router.get(
  "/:commitmentId/export.pdf",
  requirePermission("commitment", "export"),
  [param("commitmentId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const { fileName, buffer } = await commitmentService.exportStatementPdf({ ...scope(req), commitmentId: req.params.commitmentId, viewer: viewer(req) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  }),
);

module.exports = router;
