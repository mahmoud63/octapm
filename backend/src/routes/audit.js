const express = require('express');
const { query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const auditService = require('../services/audit.service');

const router = express.Router({ mergeParams: true });

router.use(authenticate);

router.get(
  '/',
  requirePermission('audit', 'read'),
  [
    query('entityType').optional().isString().trim().isLength({ max: 80 }),
    query('entityId').optional().isString().trim().isLength({ max: 120 }),
    query('action').optional().isString().trim().isLength({ max: 80 }),
    query('cursor').optional().isString().trim().isLength({ max: 120 }),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('order').optional().isIn(['asc', 'desc']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await auditService.listEvents({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      entityType: req.query.entityType || null,
      entityId: req.query.entityId || null,
      action: req.query.action || null,
      cursor: req.query.cursor || null,
      limit: req.query.limit || 50,
      order: req.query.order || 'asc',
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
