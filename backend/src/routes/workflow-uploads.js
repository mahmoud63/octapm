const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
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

router.post(
  '/uploads',
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
