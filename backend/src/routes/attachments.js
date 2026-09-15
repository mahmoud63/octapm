const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission } = require("../middleware/rbac");
const { uploadLimiter } = require("../middleware/rate-limit");
const { validate } = require("../middleware/validate");
const fileStorageService = require("../services/file-storage.service");
const attachmentService = require("../services/attachment.service");
const documentTextService = require("../services/document-text.service");
const { isPartyScopedAccess } = require("../services/company-party.service");

// A party-scoped person reaches an attachment through the record's own rule —
// its company, its owner party, its author — not its module alone; a download
// is refused unless the document is visible through a place it is linked from
// (Phase 21D, CX21-551, CX21-552).
const viewerFor = (req) => {
  const partyScoped = isPartyScopedAccess(req.projectAccess || {});
  const parties = req.projectAccess?.partyAccess || [];
  return {
    id: req.user.id,
    userId: req.user.id,
    canRead: (moduleName) => hasPermission(req, moduleName, "read"),
    partyIds: partyScoped ? parties.map((party) => party.projectPartyId).filter(Boolean) : null,
    companyIds: partyScoped ? [...new Set(parties.map((party) => party.companyId).filter(Boolean))] : null,
  };
};

/**
 * One endpoint for attaching files to any record type. Permission follows the
 * record's own module: reading attachments needs `read`, adding or removing
 * them needs `update`, `submit` or `create` on that module.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, fileStorageService.ensureTempUploadDirSync());
      } catch (storageError) {
        cb(storageError);
      }
    },
    filename: (_req, file, cb) => {
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || "").toLowerCase()}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
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
        "UNSUPPORTED_ATTACHMENT",
        "Only images, PDF, Word, Excel, CSV, and text files are allowed",
      ),
    );
  },
});

const WRITE_ACTIONS = ["update", "submit", "create"];

const assertRecordAccess = (req, recordType, actions) => {
  const moduleName = attachmentService.moduleForRecordType(recordType);
  if (!actions.some((action) => hasPermission(req, moduleName, action))) {
    const forbidden = new HttpError(
      403,
      "FORBIDDEN",
      "You do not have permission to manage attachments on this record",
    );
    forbidden.details = { module: moduleName, actions };
    throw forbidden;
  }
  return moduleName;
};

router.get(
  "/",
  [
    query("recordType").isIn(attachmentService.RECORD_TYPES),
    query("recordId").optional().isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    assertRecordAccess(req, req.query.recordType, ["read"]);
    const viewer = viewerFor(req);
    if (req.query.recordId && !(await documentTextService.recordVisibleToViewer({ recordType: req.query.recordType, recordId: req.query.recordId, viewer }))) {
      throw new HttpError(404, "ATTACHMENT_RECORD_NOT_FOUND", "Record not found");
    }
    const result = await attachmentService.listAttachments({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      recordType: req.query.recordType,
      recordId: req.query.recordId,
      viewer,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/",
  uploadLimiter,
  upload.array("files", 20),
  [
    body("recordType").isIn(attachmentService.RECORD_TYPES),
    body("recordId").isString().trim().notEmpty(),
    body("role").optional().isIn(attachmentService.ATTACHMENT_ROLES),
    body("caption").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body("locationId").optional({ nullable: true }).isUUID(),
    body("tags").optional(),
    body("documentIds").optional(),
    body("clientRequestId").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    try {
      assertRecordAccess(req, req.body.recordType, WRITE_ACTIONS);
      const viewer = viewerFor(req);
      if (!(await documentTextService.recordVisibleToViewer({ recordType: req.body.recordType, recordId: req.body.recordId, viewer }))) {
        throw new HttpError(404, "ATTACHMENT_RECORD_NOT_FOUND", "Record not found");
      }
      for (const documentId of attachmentService.parseDocumentIds(req.body.documentIds)) {
        if (!(await documentTextService.documentReadableToViewer({ orgId: req.user.orgId, projectId: req.params.projectId, documentId, viewer }))) {
          throw new HttpError(404, "FILE_NOT_FOUND", "File not found");
        }
      }
      const result = await attachmentService.createAttachments({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        userId: req.user.id,
        userRole: getEffectiveRole(req),
        recordType: req.body.recordType,
        recordId: req.body.recordId,
        role: req.body.role,
        caption: req.body.caption,
        locationId: req.body.locationId || null,
        tags: req.body.tags,
        clientRequestId: req.body.clientRequestId || null,
        files: req.files || [],
        documentIds: req.body.documentIds,
      });
      return sendSuccess(res, result, 201);
    } finally {
      await fileStorageService.cleanupTempFiles(req.files || []);
    }
  }),
);

router.get(
  "/documents/:documentId",
  [param("documentId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    if (!(await documentTextService.documentReadableToViewer({ orgId: req.user.orgId, projectId: req.params.projectId, documentId: req.params.documentId, viewer: viewerFor(req) }))) {
      throw new HttpError(404, "FILE_NOT_FOUND", "File not found");
    }
    const file = await attachmentService.getDocumentFile({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      documentId: req.params.documentId,
    });
    if (file.redirectUrl) return res.redirect(302, file.redirectUrl);
    res.type(file.mimeType);
    return res.sendFile(file.path);
  }),
);

router.delete(
  "/:attachmentId",
  [param("attachmentId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const attachment = await attachmentService.getAttachment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      attachmentId: req.params.attachmentId,
    });
    assertRecordAccess(req, attachment.recordType, WRITE_ACTIONS);
    if (!(await documentTextService.recordVisibleToViewer({ recordType: attachment.recordType, recordId: attachment.recordId, viewer: viewerFor(req) }))) {
      throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
    }
    const result = await attachmentService.deleteAttachment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      attachmentId: req.params.attachmentId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
