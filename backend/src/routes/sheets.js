const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { hasPermission, requirePermission } = require("../middleware/rbac");
const { uploadLimiter } = require("../middleware/rate-limit");
const { validate } = require("../middleware/validate");
const fileStorageService = require("../services/file-storage.service");
const drawingSetService = require("../services/drawing-set.service");

/**
 * Sheets (OCTA-DWG-CORE-011): the current drawing set as the site sees it.
 * Superseded revisions are only returned to users who can update document
 * control (PM / planning), so site roles never open an old sheet by mistake.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const canSeeSuperseded = (req) => hasPermission(req, "document_control", "update");

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
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/pdf/i.test(file.mimetype || "") || /\.pdf$/i.test(file.originalname || "")) {
      return cb(null, true);
    }
    return cb(new HttpError(400, "UNSUPPORTED_DRAWING_FILE", "Sheets must be PDF files"));
  },
});

router.get(
  "/",
  requirePermission("document_control", "read"),
  [
    query("discipline").optional().isString().trim().isLength({ max: 80 }),
    query("locationId").optional({ values: "falsy" }).isUUID(),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    query("status").optional().isIn(["current", "obsolete", "all"]),
    query("setId").optional({ values: "falsy" }).isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await drawingSetService.listSheets({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      filters: {
        discipline: req.query.discipline || null,
        locationId: req.query.locationId || null,
        search: req.query.search || null,
        status: req.query.status || "current",
        setId: req.query.setId || null,
      },
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  "/offline-manifest",
  requirePermission("document_control", "read"),
  asyncHandler(async (req, res) => {
    const result = await drawingSetService.offlineManifest({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/revisions/:revisionId/publish",
  requirePermission("document_control", "update", { transition: "drawing.publish" }),
  [param("revisionId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await drawingSetService.publishSheetRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  "/:sheetId",
  requirePermission("document_control", "read"),
  [param("sheetId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const sheet = await drawingSetService.getSheet({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      sheetId: req.params.sheetId,
      includeSuperseded: canSeeSuperseded(req),
    });
    return sendSuccess(res, sheet);
  }),
);

router.patch(
  "/:sheetId",
  requirePermission("document_control", "update"),
  [
    param("sheetId").isUUID(),
    body("title").optional().isString().trim().isLength({ min: 1, max: 200 }),
    body("discipline").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
    body("locationId").optional({ nullable: true }).isUUID(),
    body("status").optional().isIn(["current", "obsolete"]),
    body("obsoleteReason").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const sheet = await drawingSetService.updateSheet({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      sheetId: req.params.sheetId,
      payload: req.body,
      userId: req.user.id,
    });
    return sendSuccess(res, sheet);
  }),
);

router.get(
  "/:sheetId/revisions",
  requirePermission("document_control", "read"),
  [param("sheetId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await drawingSetService.listSheetRevisions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      sheetId: req.params.sheetId,
      includeSuperseded: canSeeSuperseded(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:sheetId/revisions",
  requirePermission("document_control", "submit", { transition: "document.revision.upload" }),
  [param("sheetId").isUUID(), validate],
  uploadLimiter,
  upload.single("file"),
  [
    body("revision").isString().trim().isLength({ min: 1, max: 20 }),
    body("title").optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body("pageNumber").optional().isInt({ min: 1, max: 1500 }).toInt(),
    body("publish").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    try {
      if (req.body.publish && !hasPermission(req, "document_control", "update", { transition: "drawing.publish" })) {
        throw new HttpError(403, "FORBIDDEN", "You can upload this revision but not publish it");
      }
      const result = await drawingSetService.addSheetRevision({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        sheetId: req.params.sheetId,
        file: req.file,
        payload: req.body,
        userId: req.user.id,
      });
      return sendSuccess(res, result, 201);
    } finally {
      await fileStorageService.cleanupTempFiles(req.file ? [req.file] : []);
    }
  }),
);

module.exports = router;
