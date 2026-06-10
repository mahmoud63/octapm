const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  listSubmittals,
  createSubmittal,
  updateSubmittal,
  deleteSubmittal,
} = require('../services/submittal.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  requirePermission('submittal', 'read'),
  [
    query('cursor').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('status')
      .optional()
      .isIn(['pending', 'under_review', 'approved', 'resubmit', 'rejected']),
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
        'submittedOn',
        'reviewedOn',
        'status',
        'ref',
        'title',
      ]),
    query('sortDir').optional().isIn(['asc', 'desc']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const data = await listSubmittals({
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
  requirePermission('submittal', 'create'),
  [
    body('title').trim().notEmpty(),
    body('status')
      .optional()
      .isIn(['pending', 'under_review', 'approved', 'resubmit', 'rejected']),
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
    body('submittedOn').optional({ nullable: true }).isISO8601(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('reviewedOn').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createSubmittal({
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
  '/:submittalId',
  requirePermission('submittal', 'update'),
  [
    param('submittalId').isUUID(),
    body('status')
      .optional()
      .isIn(['pending', 'under_review', 'approved', 'resubmit', 'rejected']),
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
    body('submittedOn').optional({ nullable: true }).isISO8601(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('reviewedOn').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateSubmittal({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        submittalId: req.params.submittalId,
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
  '/:submittalId',
  requirePermission('submittal', 'delete'),
  [param('submittalId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteSubmittal({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        submittalId: req.params.submittalId,
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
