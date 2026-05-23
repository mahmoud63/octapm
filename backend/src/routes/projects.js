const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { enforceProjectLimit } = require('../middleware/subscription-gate');
const projectService = require('../services/project.service');

const router = express.Router();

router.use(authenticate);

router.get(
  '/',
  [
    query('cursor').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('status').optional().isString(),
    query('search').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await projectService.listProjects({
      orgId: req.user.orgId,
      query: req.query,
    });

    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requireRoles('pm', 'planning_eng'),
  enforceProjectLimit,
  [
    body('name').isString().trim().notEmpty(),
    body('type').optional().isString(),
    body('location').optional().isString(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    body('duration').optional().isInt({ min: 0 }).toInt(),
    body('durationUnit').optional().isIn(['days', 'weeks', 'months']),
    body('contractValue').optional().isFloat({ min: 0 }).toFloat(),
    body('currency')
      .optional()
      .isString()
      .isLength({ min: 3, max: 3 })
      .customSanitizer((value) => value.toUpperCase()),
    body('status')
      .optional()
      .isIn(['active', 'on_hold', 'completed', 'cancelled']),
    body('endDate')
      .optional()
      .custom((endDate, { req }) => {
        if (endDate && req.body.startDate) {
          if (new Date(endDate) <= new Date(req.body.startDate)) {
            throw new Error('endDate must be after startDate');
          }
        }

        return true;
      }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await projectService.createProject({
      orgId: req.user.orgId,
      payload: req.body,
    });

    return sendSuccess(res, result, 201);
  }),
);

router.get(
  '/:id',
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await projectService.getProjectById({
      orgId: req.user.orgId,
      projectId: req.params.id,
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
    body('type').optional().isString(),
    body('location').optional().isString(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    body('duration').optional().isInt({ min: 0 }).toInt(),
    body('durationUnit').optional().isIn(['days', 'weeks', 'months']),
    body('contractValue').optional().isFloat({ min: 0 }).toFloat(),
    body('currency')
      .optional()
      .isString()
      .isLength({ min: 3, max: 3 })
      .customSanitizer((value) => value.toUpperCase()),
    body('status')
      .optional()
      .isIn(['active', 'on_hold', 'completed', 'cancelled']),
    body('endDate')
      .optional()
      .custom((endDate, { req }) => {
        if (endDate && req.body.startDate) {
          if (new Date(endDate) <= new Date(req.body.startDate)) {
            throw new Error('endDate must be after startDate');
          }
        }

        return true;
      }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await projectService.updateProject({
      orgId: req.user.orgId,
      projectId: req.params.id,
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
    const result = await projectService.deleteProject({
      orgId: req.user.orgId,
      projectId: req.params.id,
    });

    return sendSuccess(res, result);
  }),
);

router.use('/:projectId/boq', require('./boq'));
router.use('/:projectId/activities', require('./activities'));
router.use('/:projectId/equipment', require('./equipment'));
router.use('/:projectId/schedule', require('./schedule'));
router.use('/:projectId/import', require('./import'));
router.use('/:projectId/export', require('./export'));
router.use('/:projectId/weekly-reports', require('./weekly-reports'));
router.use('/:projectId/reports', require('./reports'));
router.use('/:projectId/health', require('./health'));
router.use('/:projectId/risks', require('./risks'));
router.use('/:projectId/long-lead', require('./long-lead'));
router.use('/:projectId/cost', require('./cost'));
router.use('/:projectId/change-orders', require('./change-orders'));
router.use('/:projectId/ipc', require('./ipc'));
router.use('/:projectId/sub-valuations', require('./sub-valuations'));
router.use('/:projectId/budget-revisions', require('./budget-revisions'));
router.use('/:projectId/cash-flow', require('./cash-flow'));
router.use('/:projectId/eot', require('./eot'));
router.use('/:projectId/weather-delays', require('./weather-delays'));
router.use('/:projectId/quality', require('./quality'));
router.use('/:projectId/ncr', require('./ncr'));
router.use('/:projectId/itp', require('./itp'));
router.use('/:projectId/defects', require('./defects'));
router.use('/:projectId/safety', require('./safety'));
router.use('/:projectId/material-tests', require('./material-tests'));
router.use('/:projectId/doc-control', require('./doc-control'));
router.use('/:projectId/rfi', require('./rfi'));
router.use('/:projectId/submittals', require('./submittals'));
router.use('/:projectId/drawings', require('./drawings'));
router.use('/:projectId/transmittals', require('./transmittals'));
router.use('/:projectId/correspondence', require('./correspondence'));

module.exports = router;
