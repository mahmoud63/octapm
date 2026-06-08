const express = require('express');
const multer = require('multer');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const importService = require('../services/import.service');

const router = express.Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = `.${String(file.originalname || '')
      .split('.')
      .pop()
      ?.toLowerCase()}`;
    if (!['.xer', '.xml'].includes(ext)) {
      return cb(
        new HttpError(400, 'UNSUPPORTED_FORMAT', 'Allowed formats: .xer, .xml'),
      );
    }
    return cb(null, true);
  },
});

router.use(authenticate);

router.post(
  '/xer',
  requireRoles('pm', 'planning_eng'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');

    const replaceExisting =
      String(req.body?.replaceExisting || 'false') === 'true';
    const result = await importService.importXer({
      projectId: req.params.projectId,
      orgId: req.user.orgId,
      xerContent: req.file.buffer.toString('utf-8'),
      replaceExisting,
    });

    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/p6xml',
  requireRoles('pm', 'planning_eng'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');

    const replaceExisting =
      String(req.body?.replaceExisting || 'false') === 'true';
    const result = await importService.importP6Xml({
      projectId: req.params.projectId,
      orgId: req.user.orgId,
      xmlContent: req.file.buffer.toString('utf-8'),
      replaceExisting,
    });

    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/msp',
  requireRoles('pm', 'planning_eng'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');

    const replaceExisting =
      String(req.body?.replaceExisting || 'false') === 'true';
    const result = await importService.importMsp({
      projectId: req.params.projectId,
      orgId: req.user.orgId,
      xmlContent: req.file.buffer.toString('utf-8'),
      replaceExisting,
    });

    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/progress',
  requireRoles('pm', 'planning_eng', 'site_engineer'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');

    const format = String(req.body?.format || '');
    const result = await importService.importProgress({
      projectId: req.params.projectId,
      orgId: req.user.orgId,
      format,
      content: req.file.buffer.toString('utf-8'),
    });

    return sendSuccess(res, result);
  }),
);

router.post(
  '/recalculate-cpm',
  requireRoles('pm', 'planning_eng'),
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
  requireRoles('pm', 'planning_eng'),
  asyncHandler(async (req, res) => {
    const result = await importService.seedLinkedModules({
      projectId: req.params.projectId,
      orgId: req.user.orgId,
    });

    return sendSuccess(res, result);
  }),
);

module.exports = router;
