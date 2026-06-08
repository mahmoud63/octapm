const express = require('express');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const ipcService = require('../services/ipc.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await ipcService.listIpcCertificates({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requireRoles('pm', 'qs', 'finance'),
  [body('period').optional().isString().trim(), validate],
  asyncHandler(async (req, res) => {
    const result = await ipcService.createIpcPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.body.period,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  '/:period',
  [param('period').isString(), validate],
  asyncHandler(async (req, res) => {
    const result = await ipcService.getIpcPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  '/:period/items/:id',
  requireRoles('pm', 'qs', 'finance'),
  [
    param('period').isString(),
    param('id').isUUID(),
    body('qty').optional().isFloat({ min: 0 }).toFloat(),
    body('rate').optional().isFloat({ min: 0 }).toFloat(),
    body('retentionRate').optional().isFloat({ min: 0 }).toFloat(),
    body('status').optional().isIn(['draft', 'submitted', 'certified', 'paid']),
    body('certDate').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await ipcService.updateIpcItem({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
      itemId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:period/submit',
  requireRoles('pm', 'qs', 'finance'),
  [param('period').isString(), validate],
  asyncHandler(async (req, res) => {
    const result = await ipcService.submitIpcPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:period/certify',
  requireRoles('pm', 'finance'),
  [param('period').isString(), validate],
  asyncHandler(async (req, res) => {
    const result = await ipcService.certifyIpcPeriod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      period: req.params.period,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
