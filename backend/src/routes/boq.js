const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const boqService = require('../services/boq.service');
const fileStorageService = require('../services/file-storage.service');
const { assertMoneyInput } = require('../utils/money');

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
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    if (
      ['.xlsx', '.xls'].includes(ext) &&
      fileStorageService.isAllowedOriginalNameForType(
        fileStorageService.DOCUMENT_TYPES.BOQ_UPLOAD,
        file.originalname,
      )
    ) cb(null, true);
    else cb(new HttpError(400, 'UNSUPPORTED_FORMAT', 'Only .xlsx and .xls files are allowed'));
  },
});

const CAN_MODIFY = requireRoles('pm', 'planning_eng', 'qs');

function assertPositiveNumber(value, field) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a positive number`,
    );
  }
}

function assertPositiveMoney(value, field) {
  assertMoneyInput(field, value, { min: 0.01 });
}

function assertValidDependencyType(value) {
  if (value === undefined || value === null || value === '') return;
  if (!['FS', 'SS'].includes(value)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'dependencyType must be FS, SS, or null',
    );
  }
}

// GET /projects/:projectId/boq/template
router.get(
  '/template',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const workbook = await boqService.generateBoqTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="boq-template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  }),
);

// POST /projects/:projectId/boq/upload
router.post(
  '/upload',
  authenticate,
  CAN_MODIFY,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');
    const { projectId } = req.params;
    const label = req.body?.label || null;

    try {
      const document = await fileStorageService.uploadBoqFile({
        orgId: req.user.orgId,
        projectId,
        userId: req.user.id,
        file: req.file,
      });
      const result = await boqService.processBoqUpload(
        projectId,
        { path: req.file.path },
        label,
        {
          orgId: req.user.orgId,
          userId: req.user.id,
          userRole: req.user.role,
          documentId: document.documentId,
        },
      );
      return sendSuccess(res, { ...result, document });
    } finally {
      await fileStorageService.cleanupTempFiles(req.file);
    }
  }),
);

// GET /projects/:projectId/boq/uploads/:documentId
router.get(
  '/uploads/:documentId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const file = await fileStorageService.getBoqUploadFile({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      key: req.params.documentId,
    });
    if (file.redirectUrl) {
      return res.redirect(302, file.redirectUrl);
    }
    res.type(file.mimeType);
    return res.sendFile(file.path);
  }),
);

// GET /projects/:projectId/boq/job/:jobId
router.get(
  '/job/:jobId',
  authenticate,
  asyncHandler(async (req, res) => {
    const job = boqService.getBoqJob(req.params.jobId);
    if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'Job not found or expired');
    if (job.projectId !== req.params.projectId) {
      throw new HttpError(403, 'JOB_ACCESS_DENIED', 'Job does not belong to this project');
    }
    return sendSuccess(res, job);
  }),
);

// GET /projects/:projectId/boq
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await boqService.getProjectBoq(req.params.projectId, {
      orgId: req.user.orgId,
    });
    return sendSuccess(res, data);
  }),
);

// PATCH /projects/:projectId/boq/items/:itemId
router.patch(
  '/items/:itemId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const result = await boqService.updateBoqItem(
      req.params.projectId,
      req.params.itemId,
      req.body,
      { orgId: req.user.orgId, userId: req.user.id, userRole: req.user.role },
    );
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/boq/items
router.post(
  '/items',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const { code, description, quantity, unit, rate, activityName } = req.body;
    if (!code || !description || !quantity || !unit || !rate || !activityName) {
      throw new HttpError(400, 'MISSING_FIELDS', 'code, description, quantity, unit, rate and activityName are required');
    }
    assertPositiveNumber(quantity, 'quantity');
    assertPositiveMoney(rate, 'rate');
    const result = await boqService.createManualBoqItem(
      req.params.projectId,
      req.body,
      { orgId: req.user.orgId, userId: req.user.id, userRole: req.user.role },
    );
    return sendSuccess(res, result, 201);
  }),
);

// DELETE /projects/:projectId/boq/items/:itemId
router.delete(
  '/items/:itemId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const result = await boqService.deleteBoqItem(
      req.params.projectId,
      req.params.itemId,
      { orgId: req.user.orgId, userId: req.user.id, userRole: req.user.role },
    );
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/boq/items/:itemId/activities
router.post(
  '/items/:itemId/activities',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const { activityName, unit, quantity, rate } = req.body;
    if (!activityName || !unit || quantity === undefined || rate === undefined) {
      throw new HttpError(400, 'MISSING_FIELDS', 'activityName, unit, quantity, and rate are required');
    }
    assertPositiveNumber(quantity, 'quantity');
    assertPositiveMoney(rate, 'rate');
    assertValidDependencyType(req.body.dependencyType);
    const result = await boqService.createActivity(
      req.params.projectId,
      req.params.itemId,
      req.body,
      { orgId: req.user.orgId, userId: req.user.id, userRole: req.user.role },
    );
    return sendSuccess(res, result, 201);
  }),
);

// PATCH /projects/:projectId/boq/activities/:activityId
router.patch(
  '/activities/:activityId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    if (req.body.quantity !== undefined) {
      assertPositiveNumber(req.body.quantity, 'quantity');
    }
    if (req.body.rate !== undefined) {
      assertPositiveMoney(req.body.rate, 'rate');
    }
    assertValidDependencyType(req.body.dependencyType);
    const result = await boqService.updateActivity(
      req.params.projectId,
      req.params.activityId,
      req.body,
      { orgId: req.user.orgId, userId: req.user.id, userRole: req.user.role },
    );
    return sendSuccess(res, result);
  }),
);

// DELETE /projects/:projectId/boq/activities/:activityId
router.delete(
  '/activities/:activityId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    await boqService.deleteActivity(
      req.params.projectId,
      req.params.activityId,
      {
        orgId: req.user.orgId,
        userId: req.user.id,
        userRole: req.user.role,
        allocationId: req.body?.allocationId || req.query?.allocationId || null,
      },
    );
    return sendSuccess(res, null);
  }),
);

module.exports = router;
