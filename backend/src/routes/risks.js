const express = require('express');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const riskService = require('../services/risk.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await riskService.listRisks({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requireRoles('pm', 'planning_eng', 'qs'),
  [
    body('description').isString().trim().notEmpty(),
    body('probability').optional().isIn(['low', 'medium', 'high']),
    body('impact').optional().isIn(['low', 'medium', 'high']),
    body('severity').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    body('mitigation').optional().isString().trim(),
    body('phase').optional().isString().trim(),
    body('owner').optional().isString().trim(),
    body('status').optional().isIn(['open', 'closed', 'monitoring']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await riskService.createRisk({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  '/:id',
  requireRoles('pm', 'planning_eng', 'qs'),
  [
    param('id').isUUID(),
    body('description').optional().isString().trim().notEmpty(),
    body('probability').optional().isIn(['low', 'medium', 'high']),
    body('impact').optional().isIn(['low', 'medium', 'high']),
    body('severity').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    body('mitigation').optional().isString().trim(),
    body('phase').optional().isString().trim(),
    body('owner').optional().isString().trim(),
    body('status').optional().isIn(['open', 'closed', 'monitoring']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await riskService.updateRisk({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      riskId: req.params.id,
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
    await riskService.deleteRisk({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      riskId: req.params.id,
    });
    return sendSuccess(res, { deleted: true });
  }),
);

module.exports = router;
