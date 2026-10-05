const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const multer = require('multer');
// The NUL / lone-surrogate guard again after multer: it parses the multipart body inside the route (CERT-2).
const { rejectNullBytes } = require('../middleware/reject-null-bytes');
const path = require('path');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { query } = require('express-validator');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rate-limit');
const { getEffectiveRole, hasPermission, requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const importService = require('../services/import.service');
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
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = `.${String(file.originalname || '')
      .split('.')
      .pop()
      ?.toLowerCase()}`;
    if (!['.xer', '.xml', '.xlsx'].includes(ext)) {
      return cb(
        new HttpError(400, 'UNSUPPORTED_FORMAT', 'Allowed formats: .xer, .xml, .xlsx'),
      );
    }
    return cb(null, true);
  },
});

const sendDownload = (res, file) => {
  if (file.redirectUrl) {
    return res.redirect(302, file.redirectUrl);
  }
  res.type(file.mimeType);
  return res.sendFile(file.path);
};

const readUploadText = (file) => fs.readFile(file.path, 'utf-8');

router.use(authenticate);

router.post(
  '/xer',
  requirePermission('schedule', 'create'),
  uploadLimiter,
  upload.single('file'),
  rejectNullBytes,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');

    const replaceExisting =
      String(req.body?.replaceExisting || 'false') === 'true';
    let document = null;
    try {
      document = await fileStorageService.uploadScheduleImportFile({
        projectId: req.params.projectId,
        orgId: req.user.orgId,
        userId: req.user.id,
        file: req.file,
      });
      const result = await importService.importXer({
        projectId: req.params.projectId,
        orgId: req.user.orgId,
        xerContent: await readUploadText(req.file),
        replaceExisting,
        userId: req.user.id,
      });
      await fileStorageService.markDocumentLinked({
        documentId: document.documentId,
        entityType: 'schedule_revision',
        entityId: result.revisionId,
      });

      return sendSuccess(res, { ...result, document }, 201);
    } catch (error) {
      if (document?.documentId) {
        await fileStorageService.markDocumentRejected({
          documentId: document.documentId,
          code: error.code || 'SCHEDULE_IMPORT_FAILED',
          message: error.message,
        }).catch(() => {});
      }
      throw error;
    } finally {
      await fileStorageService.cleanupTempFiles(req.file);
    }
  }),
);

router.post(
  '/p6xml',
  requirePermission('schedule', 'create'),
  uploadLimiter,
  upload.single('file'),
  rejectNullBytes,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');

    const replaceExisting =
      String(req.body?.replaceExisting || 'false') === 'true';
    let document = null;
    try {
      document = await fileStorageService.uploadScheduleImportFile({
        projectId: req.params.projectId,
        orgId: req.user.orgId,
        userId: req.user.id,
        file: req.file,
      });
      const result = await importService.importP6Xml({
        projectId: req.params.projectId,
        orgId: req.user.orgId,
        xmlContent: await readUploadText(req.file),
        replaceExisting,
        userId: req.user.id,
      });
      await fileStorageService.markDocumentLinked({
        documentId: document.documentId,
        entityType: 'schedule_revision',
        entityId: result.revisionId,
      });

      return sendSuccess(res, { ...result, document }, 201);
    } catch (error) {
      if (document?.documentId) {
        await fileStorageService.markDocumentRejected({
          documentId: document.documentId,
          code: error.code || 'SCHEDULE_IMPORT_FAILED',
          message: error.message,
        }).catch(() => {});
      }
      throw error;
    } finally {
      await fileStorageService.cleanupTempFiles(req.file);
    }
  }),
);

router.post(
  '/msp',
  requirePermission('schedule', 'create'),
  uploadLimiter,
  upload.single('file'),
  rejectNullBytes,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');

    const replaceExisting =
      String(req.body?.replaceExisting || 'false') === 'true';
    let document = null;
    try {
      document = await fileStorageService.uploadScheduleImportFile({
        projectId: req.params.projectId,
        orgId: req.user.orgId,
        userId: req.user.id,
        file: req.file,
      });
      const result = await importService.importMsp({
        projectId: req.params.projectId,
        orgId: req.user.orgId,
        xmlContent: await readUploadText(req.file),
        replaceExisting,
        userId: req.user.id,
      });
      await fileStorageService.markDocumentLinked({
        documentId: document.documentId,
        entityType: 'schedule_revision',
        entityId: result.revisionId,
      });

      return sendSuccess(res, { ...result, document }, 201);
    } catch (error) {
      if (document?.documentId) {
        await fileStorageService.markDocumentRejected({
          documentId: document.documentId,
          code: error.code || 'SCHEDULE_IMPORT_FAILED',
          message: error.message,
        }).catch(() => {});
      }
      throw error;
    } finally {
      await fileStorageService.cleanupTempFiles(req.file);
    }
  }),
);

// POST /projects/:projectId/import/xlsx — a programme from a workbook, staged
// like the other formats. With ?dryRun=true the workbook is parsed and the
// staged snapshot reported, and nothing is stored: no document, no revision.
router.post(
  '/xlsx',
  requirePermission('schedule', 'create'),
  uploadLimiter,
  [query('dryRun').isString().optional().isBoolean().toBoolean(), validate],
  upload.single('file'),
  rejectNullBytes,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');

    let document = null;
    try {
      if (req.query.dryRun === true) {
        const report = await importService.importScheduleXlsx({
          projectId: req.params.projectId,
          orgId: req.user.orgId,
          input: { path: req.file.path },
          dryRun: true,
          userId: req.user.id,
        });
        return sendSuccess(res, report);
      }

      document = await fileStorageService.uploadScheduleImportFile({
        projectId: req.params.projectId,
        orgId: req.user.orgId,
        userId: req.user.id,
        file: req.file,
      });
      const result = await importService.importScheduleXlsx({
        projectId: req.params.projectId,
        orgId: req.user.orgId,
        input: { path: req.file.path },
        userId: req.user.id,
      });
      await fileStorageService.markDocumentLinked({
        documentId: document.documentId,
        entityType: 'schedule_revision',
        entityId: result.revisionId,
      });

      return sendSuccess(res, { ...result, document }, 201);
    } catch (error) {
      if (document?.documentId) {
        await fileStorageService.markDocumentRejected({
          documentId: document.documentId,
          code: error.code || 'SCHEDULE_IMPORT_FAILED',
          message: error.message,
        }).catch(() => {});
      }
      throw error;
    } finally {
      await fileStorageService.cleanupTempFiles(req.file);
    }
  }),
);

// POST /projects/:projectId/import/progress — the file's percentages become
// progress submissions in the importer's own authority (PC-6): submitting
// them takes progress `submission.submit`; approving them takes progress
// `submission.approve` on this project, decided by the same permission engine
// the approve route asks (template, project role, party profile, API-key
// scope), never by a role list of this route's own. With ?dryRun=true the
// file is parsed and the per-row outcome for this person reported, and
// nothing is stored: no document, no submission.
router.post(
  '/progress',
  requirePermission('progress', 'submit', {
    transition: 'submission.submit',
  }),
  uploadLimiter,
  [query('dryRun').isString().optional().isBoolean().toBoolean(), validate],
  upload.single('file'),
  rejectNullBytes,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');

    const format = String(req.body?.format || '');
    const identity = {
      projectId: req.params.projectId,
      orgId: req.user.orgId,
      format,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      canApprove: hasPermission(req, 'progress', 'approve', {
        transition: 'submission.approve',
      }),
    };
    let document = null;
    try {
      if (req.query.dryRun === true) {
        const report = await importService.importProgress({
          ...identity,
          content: await readUploadText(req.file),
          dryRun: true,
        });
        return sendSuccess(res, report);
      }

      document = await fileStorageService.uploadProgressImportFile({
        projectId: req.params.projectId,
        orgId: req.user.orgId,
        userId: req.user.id,
        file: req.file,
      });
      const result = await importService.importProgress({
        ...identity,
        content: await readUploadText(req.file),
      });
      await fileStorageService.markDocumentLinked({
        documentId: document.documentId,
        entityType: 'progress_import',
        entityId: req.params.projectId,
      });

      return sendSuccess(res, { ...result, document });
    } catch (error) {
      if (document?.documentId) {
        await fileStorageService.markDocumentRejected({
          documentId: document.documentId,
          code: error.code || 'PROGRESS_IMPORT_FAILED',
          message: error.message,
        }).catch(() => {});
      }
      throw error;
    } finally {
      await fileStorageService.cleanupTempFiles(req.file);
    }
  }),
);

router.get(
  '/uploads/:documentId',
  requirePermission('schedule', 'read'),
  asyncHandler(async (req, res) => {
    const file = await fileStorageService.getImportUploadFile({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      key: req.params.documentId,
    });
    return sendDownload(res, file);
  }),
);

router.post(
  '/recalculate-cpm',
  requirePermission('schedule', 'update'),
  asyncHandler(async (req, res) => {
    const result = await importService.recalculateProjectCpm({
      projectId: req.params.projectId,
      orgId: req.user.orgId,
    });

    return sendSuccess(res, result);
  }),
);

router.post(
  '/seed-linked-modules',
  requirePermission('schedule', 'update'),
  asyncHandler(async (req, res) => {
    const result = await importService.seedLinkedModules({
      projectId: req.params.projectId,
      orgId: req.user.orgId,
    });

    return sendSuccess(res, result);
  }),
);

module.exports = router;
