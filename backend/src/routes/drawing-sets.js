const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
// The NUL / lone-surrogate guard again after multer: it parses the multipart body inside the route (CERT-2).
const { rejectNullBytes } = require("../middleware/reject-null-bytes");
const path = require("path");
const { body, param, query } = require("express-validator");
const { dateInput } = require("../utils/date-input");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { uploadLimiter } = require("../middleware/rate-limit");
const { validate } = require("../middleware/validate");
const fileStorageService = require("../services/file-storage.service");
const drawingSetService = require("../services/drawing-set.service");

/**
 * Drawing sets (OCTA-DWG-CORE-011): upload a multi-page PDF, review the
 * detected sheet numbers / titles / revisions, publish. Reading needs
 * document_control.read; uploading and reviewing need the upload
 * transition; publishing needs the `drawing.publish` transition.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const MAX_SET_BYTES = 250 * 1024 * 1024;

const isPdfUpload = (file) =>
  /pdf/i.test(file.mimetype || "") || /\.pdf$/i.test(file.originalname || "");

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, fileStorageService.ensureTempUploadDirSync());
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => {
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || "").toLowerCase()}`);
    },
  }),
  limits: { fileSize: MAX_SET_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isPdfUpload(file)) return cb(null, true);
    return cb(new HttpError(400, "UNSUPPORTED_DRAWING_FILE", "Drawing sets must be PDF files"));
  },
});

const setFieldValidators = () => [
  body("name").optional({ nullable: true }).isString().trim().isLength({ max: 160 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
  body("discipline").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("purpose").optional({ nullable: true }).isString().trim().isLength({ max: 20 }),
  body("receivedAt").optional({ nullable: true }).custom(dateInput),
  body("issuedAt").optional({ nullable: true }).custom(dateInput),
];

router.get(
  "/",
  requirePermission("document_control", "read"),
  [query("status").optional().isString().trim().isLength({ max: 20 }), validate],
  asyncHandler(async (req, res) => {
    const result = await drawingSetService.listSets({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      status: req.query.status || null,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/",
  requirePermission("document_control", "submit", { transition: "document.revision.upload" }),
  uploadLimiter,
  upload.single("file"),
  rejectNullBytes,
  [...setFieldValidators(), validate],
  asyncHandler(async (req, res) => {
    try {
      const set = await drawingSetService.createSet({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        userId: req.user.id,
        file: req.file,
        payload: req.body,
      });
      return sendSuccess(res, set, 202);
    } finally {
      await fileStorageService.cleanupTempFiles(req.file ? [req.file] : []);
    }
  }),
);

router.get(
  "/:setId",
  requirePermission("document_control", "read"),
  [param("setId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const set = await drawingSetService.getSet({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      setId: req.params.setId,
    });
    return sendSuccess(res, set);
  }),
);

router.patch(
  "/:setId",
  requirePermission("document_control", "update"),
  [
    param("setId").isUUID(),
    ...setFieldValidators(),
    body("status").optional().isIn(["archived", "review", "published"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const set = await drawingSetService.updateSet({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      setId: req.params.setId,
      payload: req.body,
      userId: req.user.id,
    });
    return sendSuccess(res, set);
  }),
);

router.delete(
  "/:setId",
  requirePermission("document_control", "update"),
  [param("setId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await drawingSetService.deleteSet({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      setId: req.params.setId,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:setId/reprocess",
  requirePermission("document_control", "update"),
  [param("setId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await drawingSetService.reprocessSet({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      setId: req.params.setId,
      userId: req.user.id,
    });
    return sendSuccess(res, result, 202);
  }),
);

router.get(
  "/:setId/revisions",
  requirePermission("document_control", "read"),
  [param("setId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const set = await drawingSetService.getSet({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      setId: req.params.setId,
    });
    return sendSuccess(res, { items: set.revisions || [], counts: set.counts });
  }),
);

router.patch(
  "/:setId/revisions",
  requirePermission("document_control", "submit", { transition: "document.revision.upload" }),
  [
    param("setId").isUUID(),
    body("updates").isArray({ min: 1, max: 500 }),
    body("updates.*.id").isString().isUUID(),
    body("updates.*.number").optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
    body("updates.*.title").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("updates.*.revision").optional({ nullable: true }).isString().trim().isLength({ max: 20 }),
    body("updates.*.discipline").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("updates.*.status").optional().isIn(["pending_review", "rejected"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await drawingSetService.reviewRevisions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      setId: req.params.setId,
      updates: req.body.updates,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:setId/publish",
  requirePermission("document_control", "update", { transition: "drawing.publish" }),
  [
    param("setId").isUUID(),
    body("revisionIds").optional().isArray({ max: 1500 }),
    body("revisionIds.*").isString().isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await drawingSetService.publishSet({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      setId: req.params.setId,
      revisionIds: req.body.revisionIds || null,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
