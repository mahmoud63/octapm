const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  listRfis,
  createRfi,
  updateRfi,
  deleteRfi,
} = require('../services/rfi.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  requirePermission('rfi', 'read'),
  [
    query('cursor').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('status').optional().isIn(['open', 'answered', 'closed']),
    query('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
    query('activityId').optional().isUUID(),
    query('owner').optional().isString().trim().isLength({ max: 120 }),
    query('search').optional().isString().trim().isLength({ max: 120 }),
    query('dueAfter').optional().isISO8601(),
    query('dueBefore').optional().isISO8601(),
    query('sortBy')
      .optional()
      .isIn([
        'created',
        'updated',
        'dueDate',
        'raisedDate',
        'responseRequiredBy',
        'answeredDate',
        'priority',
        'status',
        'ref',
      ]),
    query('sortDir').optional().isIn(['asc', 'desc']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const data = await listRfis({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        query: req.query,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/',
  requirePermission('rfi', 'create'),
  [
    body('subject').trim().notEmpty(),
    body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
    body('status').optional().isIn(['open', 'answered', 'closed']),
    body('owner').optional().isString().trim(),
    body('reviewer').optional().isString().trim(),
    body('approver').optional().isString().trim(),
    body('activityId').optional({ nullable: true }).isUUID(),
    body('activityIds').optional().isArray(),
    body('activityIds.*').optional().isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('attachments').optional().isArray(),
    body('attachmentRefs').optional().isArray(),
    body('revisions').optional().isArray(),
    body('comment').optional().isString().trim(),
    body('statusComment').optional().isString().trim(),
    body('raisedDate').optional({ nullable: true }).isISO8601(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('responseRequiredBy').optional({ nullable: true }).isISO8601(),
    body('answeredDate').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createRfi({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        payload: req.body,
        userId: req.user.id,
        userRole: req.user.role,
      });

      return res.status(201).json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  '/:rfiId',
  requirePermission('rfi', 'update'),
  [
    param('rfiId').isUUID(),
    body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
    body('status').optional().isIn(['open', 'answered', 'closed']),
    body('owner').optional().isString().trim(),
    body('reviewer').optional().isString().trim(),
    body('approver').optional().isString().trim(),
    body('activityId').optional({ nullable: true }).isUUID(),
    body('activityIds').optional().isArray(),
    body('activityIds.*').optional().isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('attachments').optional().isArray(),
    body('attachmentRefs').optional().isArray(),
    body('revisions').optional().isArray(),
    body('comment').optional().isString().trim(),
    body('statusComment').optional().isString().trim(),
    body('raisedDate').optional({ nullable: true }).isISO8601(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('responseRequiredBy').optional({ nullable: true }).isISO8601(),
    body('answeredDate').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateRfi({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        rfiId: req.params.rfiId,
        payload: req.body,
        userId: req.user.id,
        userRole: req.user.role,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:rfiId',
  requirePermission('rfi', 'delete'),
  [param('rfiId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteRfi({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        rfiId: req.params.rfiId,
        userId: req.user.id,
        userRole: req.user.role,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
