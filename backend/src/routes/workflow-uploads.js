const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { uploadLimiter } = require('../middleware/rate-limit');
const { hasPermission } = require('../middleware/rbac');
const fileStorageService = require('../services/file-storage.service');

const router = express.Router({ mergeParams: true });

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
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '').toLowerCase()}`);
    },
  }),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 10,
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
        'UNSUPPORTED_WORKFLOW_ATTACHMENT',
        'Only images, PDF, Word, Excel, CSV, and text files are allowed',
      ),
    );
  },
});

/**
 * Workflow evidence is written by the people who submit or decide the records
 * that carry it (closeouts, change orders, approvals). Project membership on
 * its own is not enough: a party-scoped person with no rights on any of these
 * modules has nothing to attach and must not be able to fill the project's
 * workflow storage (certification MOB-P2, 2026-09-18).
 */
// The modules whose records carry workflow evidence. `workflow` itself is not
// on the list: every org role holds workflow.submit, so it would let anyone in.
const EVIDENCE_MODULES = ['ncr', 'safety', 'punch', 'inspection', 'change_order', 'change_event', 'commitment', 'sub_pay_app', 'progress'];
const EVIDENCE_ACTIONS = ['create', 'update', 'submit', 'approve'];

const requireEvidenceRights = (req, _res, next) => {
  const allowed = EVIDENCE_MODULES.some((moduleName) => EVIDENCE_ACTIONS.some((action) => hasPermission(req, moduleName, action)));
  if (!allowed) {
    return next(new HttpError(403, 'WORKFLOW_UPLOAD_FORBIDDEN', 'Your role does not allow you to attach evidence on this project'));
  }
  return next();
};

router.post(
  '/uploads',
  uploadLimiter,
  requireEvidenceRights,
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    try {
      const result = await fileStorageService.uploadWorkflowFiles({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        userId: req.user.id,
        files: req.files || [],
      });
      return sendSuccess(res, result, 201);
    } finally {
      await fileStorageService.cleanupTempFiles(req.files || []);
    }
  }),
);

router.get(
  '/uploads/:key',
  asyncHandler(async (req, res) => {
    const file = await fileStorageService.getWorkflowFile({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      key: req.params.key,
    });
    if (file.redirectUrl) {
      return res.redirect(302, file.redirectUrl);
    }
    res.type(file.mimeType);
    return res.sendFile(file.path);
  }),
);

module.exports = router;
