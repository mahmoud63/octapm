const express = require('express');
const { query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const auditService = require('../services/audit.service');
const primeContractService = require('../services/prime-contract.service');
const { boqFigureAccess, withheldAuditHistory } = require('../utils/boq-figures');

const router = express.Router({ mergeParams: true });

router.use(authenticate);

// The history is the project's, and every audit reader's — except the
// bill's figures in it (§12, utils/boq-figures): the history of the BOQ's
// records and a cost record's budget (its activity's approved allocation,
// owner decision E1) for those who may read the BOQ, a schedule revision's
// total budget for those who may read the BOQ or the cost module, and a
// payment certificate's certification review (worked from the BOQ's rows
// and their allocations, recorded when it is certified) for those who may
// read the BOQ — and the client contract's original value in its
// contract.manage events while that value is an unconfirmed BOQ total or of a
// source not established (owner decisions 1-3, 2026-09-29).
router.get(
  '/',
  requirePermission('audit', 'read'),
  [
    query('entityType').optional().isString().trim().isLength({ max: 80 }),
    query('entityId').optional().isString().trim().isLength({ max: 120 }),
    query('action').optional().isString().trim().isLength({ max: 80 }),
    query('source')
      .optional()
      .isIn(['all', 'audit', 'approval', 'status', 'comment'])
      .withMessage('source must be all, audit, approval, status, or comment'),
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
      source: req.query.source || 'all',
      cursor: req.query.cursor || null,
      limit: req.query.limit || 50,
      order: req.query.order || 'asc',
    });
    const access = boqFigureAccess(req);
    const contractValueSource = access.boq
      ? null
      : await primeContractService.contractValueSource({
          orgId: req.user.orgId,
          projectId: req.params.projectId,
        });
    return sendSuccess(res, withheldAuditHistory(result, access, { contractValueSource }));
  }),
);

module.exports = router;
