const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const siteDiaryService = require('../services/site-diary.service');

const CREATE_STATUSES = ['draft', 'submitted'];
const SHIFT_VALUES = ['day', 'night', 'swing'];

const router = express.Router({ mergeParams: true });
router.use(authenticate);

const diaryPayloadValidators = ({ partial = false } = {}) => {
  const optional = { nullable: true };
  return [
    body('engineerId').optional().isUUID(),
    partial
      ? body('date').optional().isISO8601()
      : body('date').isISO8601(),
    body('shift').optional().isIn(SHIFT_VALUES),
    body('weather').optional(optional).isString().trim(),
    body('weatherDetails').optional(optional).isObject(),
    body('weatherDetails.summary').optional().isString().trim(),
    body('weatherDetails.temperatureC').optional().isFloat().toFloat(),
    body('weatherDetails.condition').optional().isString().trim(),
    body('weatherDetails.wind').optional().isString().trim(),
    body('weatherDetails.rainfallMm').optional().isFloat({ min: 0 }).toFloat(),
    body('weatherDetails.delayImpact').optional().isBoolean().toBoolean(),
    body('weatherJson').optional(optional).isObject(),
    body('workers').optional(optional).isInt({ min: 0 }).toInt(),
    body('visitors').optional(optional).isString().trim(),
    body('workDone').optional(optional).isString().trim(),
    body('issues').optional(optional).isString().trim(),
    body('issueItems').optional(optional).isArray(),
    body('issueItems.*.description').optional().isString().trim(),
    body('issueItems.*.title').optional().isString().trim(),
    body('issueItems.*.severity').optional().isString().trim(),
    body('issueItems.*.owner').optional().isString().trim(),
    body('issueItems.*.status').optional().isString().trim(),
    body('instructions').optional(optional).isString().trim(),
    body('manpower').optional(optional).isArray(),
    body('manpower.*.trade').optional().isString().trim(),
    body('manpower.*.workers').optional().isInt({ min: 0 }).toInt(),
    body('manpower.*.hours').optional().isFloat({ min: 0 }).toFloat(),
    body('materials').optional(optional).isArray(),
    body('materials.*.materialId').optional().isString().trim(),
    body('materials.*.name').optional().isString().trim(),
    body('materials.*.qty').optional().isFloat({ min: 0 }).toFloat(),
    body('materials.*.unit').optional().isString().trim(),
    body('equipment').optional(optional).isArray(),
    body('equipment.*.equipmentId').optional().isString().trim(),
    body('equipment.*.name').optional().isString().trim(),
    body('equipment.*.hours').optional().isFloat({ min: 0 }).toFloat(),
    body('photos').optional(optional).isArray(),
    body('photos.*.url').optional().isString().trim(),
    body('photos.*.key').optional().isString().trim(),
    body('photos.*.filename').optional().isString().trim(),
    body('photos.*.originalName').optional().isString().trim(),
    body('photos.*.mimeType').optional().isString().trim(),
    body('photos.*.size').optional().isInt({ min: 0 }).toInt(),
    body('photos.*.storage').optional().isString().trim(),
    body('photos.*.caption').optional().isString().trim(),
    body('photos.*.takenAt').optional().isISO8601(),
    body('photos.*.uploadedAt').optional().isISO8601(),
    body('notes').optional(optional).isString().trim(),
    body('clientRequestId').optional(optional).isString().trim().isLength({ max: 100 }),
    body('clientCreatedAt').optional(optional).isISO8601(),
    body('deviceId').optional(optional).isString().trim().isLength({ max: 100 }),
    body('status').optional().isIn(CREATE_STATUSES),
    validate,
  ];
};

router.get(
  '/',
  requirePermission('progress', 'read'),
  [
    query('status').optional().isIn(siteDiaryService.DIARY_STATUSES),
    query('date').optional().isISO8601(),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.listSiteDiaries({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      status: req.query.status || null,
      date: req.query.date || null,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requirePermission('progress', 'submit', {
    transition: 'site_diary.submit',
  }),
  diaryPayloadValidators(),
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.createSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  '/:diaryId',
  requirePermission('progress', 'read'),
  [param('diaryId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.getSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      diaryId: req.params.diaryId,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  '/:diaryId',
  requirePermission('progress', 'update', {
    transition: 'site_diary.update',
  }),
  [param('diaryId').isUUID(), ...diaryPayloadValidators({ partial: true })],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.updateSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      diaryId: req.params.diaryId,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:diaryId/submit',
  requirePermission('progress', 'submit', {
    transition: 'site_diary.submit',
  }),
  [param('diaryId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.submitSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      diaryId: req.params.diaryId,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:diaryId/approve',
  requirePermission('progress', 'approve', {
    transition: 'site_diary.approve',
  }),
  [param('diaryId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.approveSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      diaryId: req.params.diaryId,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:diaryId/reject',
  requirePermission('progress', 'approve', {
    transition: 'site_diary.reject',
  }),
  [
    param('diaryId').isUUID(),
    body('reason').isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.rejectSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      diaryId: req.params.diaryId,
      userId: req.user.id,
      reason: req.body.reason,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
