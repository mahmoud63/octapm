const express = require('express');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const activityService = require('../services/activity.service');

const VALID_CATEGORIES = [
  'civil',
  'structural',
  'mechanical',
  'electrical',
  'plumbing',
  'finishing',
  'landscaping',
  'demolition',
  'inspection',
  'other',
];

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await activityService.listActivities({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requireRoles('pm', 'planning_eng'),
  [
    body('name').isString().trim().notEmpty(),
    body('category').optional().isIn(VALID_CATEGORIES),
    body('wbsCode').optional().isString().trim(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    body('earlyStart').optional().isInt({ min: 0 }).toInt(),
    body('earlyFinish').optional().isInt({ min: 0 }).toInt(),
    body('lateStart').optional().isInt({ min: 0 }).toInt(),
    body('lateFinish').optional().isInt({ min: 0 }).toInt(),
    body('totalFloat').optional().isInt({ min: 0 }).toInt(),
    body('duration').optional().isInt({ min: 0 }).toInt(),
    body('predecessors').optional().isString().trim(),
    body('isCritical').optional().isBoolean().toBoolean(),
    body('budget').optional().isFloat({ min: 0 }).toFloat(),
    body('isMilestone').optional().isBoolean().toBoolean(),
    body('sortOrder').optional().isInt({ min: 0 }).toInt(),
    body('engineerIds')
      .isArray({ min: 1 })
      .withMessage('At least one engineer required'),
    body('engineerIds.*').isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.createActivity({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/bulk-progress',
  requireRoles('pm', 'planning_eng', 'site_engineer'),
  [
    body('updates').isArray({ min: 1 }),
    body('updates.*.activityId').isUUID(),
    body('updates.*.pctComplete').isFloat({ min: 0, max: 100 }).toFloat(),
    body('updates.*.actualCost').optional().isFloat({ min: 0 }).toFloat(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.bulkUpdateProgress({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      updates: req.body.updates,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/:id',
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await activityService.getActivityById({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  '/:id',
  requireRoles('pm', 'planning_eng'),
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty(),
    body('category').optional().isIn(VALID_CATEGORIES),
    body('wbsCode').optional().isString().trim(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    body('earlyStart').optional().isInt({ min: 0 }).toInt(),
    body('earlyFinish').optional().isInt({ min: 0 }).toInt(),
    body('lateStart').optional().isInt({ min: 0 }).toInt(),
    body('lateFinish').optional().isInt({ min: 0 }).toInt(),
    body('totalFloat').optional().isInt({ min: 0 }).toInt(),
    body('duration').optional().isInt({ min: 0 }).toInt(),
    body('predecessors').optional().isString().trim(),
    body('isCritical').optional().isBoolean().toBoolean(),
    body('budget').optional().isFloat({ min: 0 }).toFloat(),
    body('isMilestone').optional().isBoolean().toBoolean(),
    body('sortOrder').optional().isInt({ min: 0 }).toInt(),
    body('engineerIds').optional().isArray({ min: 1 }),
    body('engineerIds.*').optional().isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.updateActivity({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:id/progress',
  requireRoles('pm', 'planning_eng', 'site_engineer'),
  [
    param('id').isUUID(),
    body('pctComplete').isFloat({ min: 0, max: 100 }).toFloat(),
    body('actualCost').optional().isFloat({ min: 0 }).toFloat(),
    body('actualStart').optional().isISO8601(),
    body('actualFinish').optional().isISO8601(),
    body('notes').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.updateProgress({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.delete(
  '/:id',
  requireRoles('pm', 'planning_eng'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await activityService.deleteActivity({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

router.use('/:activityId/materials', require('./materials'));

module.exports = router;
