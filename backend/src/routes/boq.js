const express = require('express');
const multer = require('multer');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess, sendError } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const boqService = require('../services/boq.service');

const router = express.Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new HttpError(400, 'UNSUPPORTED_FORMAT', 'Only .xlsx and .xls files are allowed'));
  },
});

const CAN_MODIFY = requireRoles('pm', 'planning_eng', 'qs');

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

    const result = await boqService.processBoqUpload(projectId, req.file.buffer, label);
    return sendSuccess(res, result);
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
    const data = await boqService.getProjectBoq(req.params.projectId);
    return sendSuccess(res, data);
  }),
);

// PATCH /projects/:projectId/boq/items/:itemId
router.patch(
  '/items/:itemId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const result = await boqService.updateBoqItem(req.params.projectId, req.params.itemId, req.body);
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/boq/items
router.post(
  '/items',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const { code, description, quantity, unit, rate, activityName, activityCode } = req.body;
    if (!code || !description || !quantity || !unit || !rate || !activityName || !activityCode) {
      throw new HttpError(400, 'MISSING_FIELDS', 'All fields are required');
    }
    const result = await boqService.createManualBoqItem(req.params.projectId, req.body);
    return sendSuccess(res, result, 201);
  }),
);

// DELETE /projects/:projectId/boq/items/:itemId
router.delete(
  '/items/:itemId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const result = await boqService.deleteBoqItem(req.params.projectId, req.params.itemId);
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
    const result = await boqService.createActivity(req.params.projectId, req.params.itemId, req.body);
    return sendSuccess(res, result, 201);
  }),
);

// PATCH /projects/:projectId/boq/activities/:activityId
router.patch(
  '/activities/:activityId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    const result = await boqService.updateActivity(req.params.projectId, req.params.activityId, req.body);
    return sendSuccess(res, result);
  }),
);

// DELETE /projects/:projectId/boq/activities/:activityId
router.delete(
  '/activities/:activityId',
  authenticate,
  CAN_MODIFY,
  asyncHandler(async (req, res) => {
    await boqService.deleteActivity(req.params.projectId, req.params.activityId);
    return sendSuccess(res, null);
  }),
);

module.exports = router;
