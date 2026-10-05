const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
// The NUL / lone-surrogate guard again after multer: it parses the multipart body inside the route (CERT-2).
const { rejectNullBytes } = require("../middleware/reject-null-bytes");
const path = require("path");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { uploadLimiter } = require("../middleware/rate-limit");
const { body, param, query } = require("express-validator");
const { dateInput } = require("../utils/date-input");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const fileStorageService = require("../services/file-storage.service");
const {
  approveDocumentRevision,
  assertRevisionFilingAllowed,
  getDocControlDashboard,
  getRevisionDownloadFile,
  getRevisionPreviewFile,
  listDocumentRegister,
  submitDocumentRevisionForReview,
  supersedeDocumentRevision,
  uploadDocumentRevision,
} = require("../services/doc-control.service");

const router = express.Router({ mergeParams: true });
router.use(authenticate);

const DOCUMENT_RECORD_TYPES = ["rfi", "submittal", "drawing", "transmittal"];
const REGISTER_RECORD_TYPES = [...DOCUMENT_RECORD_TYPES, "correspondence"];

// Who reads or files through document control: the caller's own module
// decisions and approve right, and the project access whose parties route
// RFIs and submittals — the service filters and refuses by it
// (certification L23, FILES-X2).
const readerFor = (req) => ({
  userId: req.user.id,
  projectAccess: req.projectAccess || {},
  canRead: (moduleName) => hasPermission(req, moduleName, "read"),
  mayApprove: hasPermission(req, "document_control", "approve", {
    transition: "document.revision.approve",
  }),
});

const safeDownloadName = (value) =>
  String(value || "document")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "document";

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
      cb(
        null,
        `${crypto.randomUUID()}${path.extname(file.originalname || "").toLowerCase()}`,
      );
    },
  }),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (
      fileStorageService.ALLOWED_WORKFLOW_MIME.has(file.mimetype) &&
      fileStorageService.isAllowedOriginalNameForType(
        fileStorageService.DOCUMENT_TYPES.WORKFLOW_ATTACHMENT,
        file.originalname,
      )
    ) {
      return cb(null, true);
    }
    return cb(
      new HttpError(
        400,
        "UNSUPPORTED_WORKFLOW_ATTACHMENT",
        "Only images, PDF, Word, Excel, CSV, and text files are allowed",
      ),
    );
  },
});

const sendRevisionFile = (res, file, disposition) => {
  if (file.redirectUrl) {
    return res.redirect(302, file.redirectUrl);
  }

  res.type(file.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${safeDownloadName(file.fileName)}"`,
  );
  return res.sendFile(file.path);
};

router.get(
  "/dashboard",
  requirePermission("document_control", "read"),
  asyncHandler(async (req, res) => {
    const data = await getDocControlDashboard({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      reader: readerFor(req),
    });

    return sendSuccess(res, data);
  }),
);

router.get(
  "/register",
  requirePermission("document_control", "read"),
  [
    query("recordType").isString().optional().isIn(REGISTER_RECORD_TYPES),
    query("folder").optional().isString().trim().isLength({ max: 80 }),
    query("category").optional().isString().trim().isLength({ max: 120 }),
    query("status").optional().isString().trim().isLength({ max: 80 }),
    query("search").optional().isString().trim().isLength({ max: 120 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const data = await listDocumentRegister({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
      userRole: getEffectiveRole(req),
      reader: readerFor(req),
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/:recordType/:recordId/revisions",
  requirePermission("document_control", "submit", {
    transition: "document.revision.upload",
  }),
  [
    param("recordType").isIn(DOCUMENT_RECORD_TYPES),
    param("recordId").isUUID(),
    body("revision").isString().trim().notEmpty().isLength({ max: 40 }),
    body("projectDocumentId").optional().isString().isUUID(),
    body("documentId").optional().isString().isUUID(),
    body("storageKey").optional().isString().trim().isLength({ max: 120 }),
    body("key").optional().isString().trim().isLength({ max: 120 }),
    body("title")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 255 }),
    body("fileName")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 255 }),
    body("documentNumber")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 120 }),
    body("category")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 120 }),
    body("folderPath")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 255 }),
    body("discipline")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 120 }),
    body("confidentiality")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 80 }),
    body("reviewDueAt").optional({ nullable: true }).custom(dateInput),
    body("status").optional().isIn(["uploaded", "submitted", "approved"]),
    body("issuedBy")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 120 }),
    body("issuedAt").optional({ nullable: true }).custom(dateInput),
    body("notes")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await uploadDocumentRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      recordType: req.params.recordType,
      recordId: req.params.recordId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      reader: readerFor(req),
    });

    return sendSuccess(res, row, 201);
  }),
);

router.post(
  "/:recordType/:recordId/revisions/upload",
  requirePermission("document_control", "submit", {
    transition: "document.revision.upload",
  }),
  [param("recordType").isIn(DOCUMENT_RECORD_TYPES), param("recordId").isUUID(), validate],
  uploadLimiter,
  upload.single("file"),
  rejectNullBytes,
  asyncHandler(async (req, res) => {
    try {
      if (!req.file) {
        throw new HttpError(400, "NO_FILE", "No revision file uploaded");
      }

      // refused before the file is stored: a record not routed to the
      // caller, or a status the caller may not set (certification FILES-X2)
      const reader = readerFor(req);
      await assertRevisionFilingAllowed({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        recordType: req.params.recordType,
        recordId: req.params.recordId,
        payload: req.body,
        reader,
      });

      const uploaded = await fileStorageService.uploadDocumentControlFile({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        userId: req.user.id,
        file: req.file,
      });

      // A filing that still fails once the file is stored (another filing
      // took the revision code in between) leaves no unlinked document for
      // every document-control reader to open: the stored file is rejected,
      // as an import that fails rejects its upload (certification R37).
      const row = await uploadDocumentRevision({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        recordType: req.params.recordType,
        recordId: req.params.recordId,
        payload: {
          ...req.body,
          projectDocumentId: uploaded.documentId,
        },
        userId: req.user.id,
        userRole: getEffectiveRole(req),
        reader,
        storedForFiler: true,
      }).catch(async (error) => {
        await fileStorageService
          .markDocumentRejected({
            documentId: uploaded.documentId,
            code: error?.code || "DOCUMENT_REVISION_REJECTED",
          })
          .catch(() => null);
        throw error;
      });

      return sendSuccess(
        res,
        {
          revision: row,
          document: {
            ...uploaded,
            url: row.downloadUrl,
            fileUrl: row.downloadUrl,
            downloadUrl: row.downloadUrl,
          },
        },
        201,
      );
    } finally {
      await fileStorageService.cleanupTempFiles(req.file ? [req.file] : []);
    }
  }),
);

router.post(
  "/revisions/:revisionId/submit-review",
  requirePermission("document_control", "submit", {
    transition: "document.revision.submit_review",
  }),
  [
    param("revisionId").isUUID(),
    body("comment")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 2000 }),
    body("reviewDueAt").optional({ nullable: true }).custom(dateInput),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await submitDocumentRevisionForReview({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      comment: req.body.comment,
      reviewDueAt: req.body.reviewDueAt,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      reader: readerFor(req),
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/revisions/:revisionId/approve",
  requirePermission("document_control", "approve", {
    transition: "document.revision.approve",
  }),
  [
    param("revisionId").isUUID(),
    body("comment")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await approveDocumentRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      comment: req.body.comment,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      reader: readerFor(req),
    });

    return sendSuccess(res, row);
  }),
);

router.post(
  "/revisions/:revisionId/supersede",
  requirePermission("document_control", "approve", {
    transition: "document.revision.supersede",
  }),
  [
    param("revisionId").isUUID(),
    body("reason").isString().trim().notEmpty().isLength({ max: 2000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await supersedeDocumentRevision({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      reader: readerFor(req),
    });

    return sendSuccess(res, row);
  }),
);

router.get(
  "/revisions/:revisionId/download",
  requirePermission("document_control", "read"),
  [param("revisionId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const file = await getRevisionDownloadFile({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      accessAction: "downloaded",
      reader: readerFor(req),
    });

    return sendRevisionFile(res, file, "attachment");
  }),
);

router.get(
  "/revisions/:revisionId/preview",
  requirePermission("document_control", "read"),
  [param("revisionId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const file = await getRevisionPreviewFile({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      revisionId: req.params.revisionId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      accessAction: "previewed",
      reader: readerFor(req),
    });

    return sendRevisionFile(res, file, "inline");
  }),
);

module.exports = router;
