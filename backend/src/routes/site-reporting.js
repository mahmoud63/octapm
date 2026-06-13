const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rate-limit');
const { requirePermission } = require('../middleware/rbac');
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
    fileSize: 8 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (
      fileStorageService.ALLOWED_IMAGE_MIME.has(file.mimetype) &&
      fileStorageService.isAllowedOriginalNameForType(
        fileStorageService.DOCUMENT_TYPES.SITE_PHOTO,
        file.originalname,
      )
    ) {
      return cb(null, true);
    }
    return cb(
      new HttpError(
        400,
        'UNSUPPORTED_SITE_PHOTO',
        'Only JPEG, PNG, WebP, HEIC, and HEIF photos are allowed',
      ),
    );
  },
});

router.use(authenticate);

router.post(
  '/uploads',
  requirePermission('progress', 'submit', {
    transition: 'site_reporting.upload',
  }),
  uploadLimiter,
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    try {
      const result = await fileStorageService.uploadSiteReportingFiles({
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
  requirePermission('progress', 'read'),
  asyncHandler(async (req, res) => {
    const file = await fileStorageService.getSiteReportingFile({
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
