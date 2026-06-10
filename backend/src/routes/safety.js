const express = require('express');
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  listSafetyIncidents,
  createSafetyIncident,
  updateSafetyIncident,
  deleteSafetyIncident,
} = require('../services/safety.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  requirePermission('safety', 'read'),
  async (req, res, next) => {
    try {
      const data = await listSafetyIncidents({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/',
  requirePermission('safety', 'create'),
  [
    body('incidentType').isIn(['near_miss', 'first_aid', 'lti', 'fatality']),
    body('title').trim().notEmpty(),
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
    body('comment').optional().isString().trim(),
    body('statusComment').optional().isString().trim(),
    body('date').optional({ nullable: true }).isISO8601(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('closedDate').optional({ nullable: true }).isISO8601(),
    body('lostDays').optional().isInt({ min: 0 }),
    body('status').optional().isIn(['open', 'investigating', 'closed']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createSafetyIncident({
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
  '/:incidentId',
  requirePermission('safety', 'update'),
  [
    param('incidentId').isUUID(),
    body('incidentType')
      .optional()
      .isIn(['near_miss', 'first_aid', 'lti', 'fatality']),
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
    body('comment').optional().isString().trim(),
    body('statusComment').optional().isString().trim(),
    body('date').optional({ nullable: true }).isISO8601(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('closedDate').optional({ nullable: true }).isISO8601(),
    body('lostDays').optional().isInt({ min: 0 }),
    body('status').optional().isIn(['open', 'investigating', 'closed']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateSafetyIncident({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        incidentId: req.params.incidentId,
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
  '/:incidentId',
  requirePermission('safety', 'delete'),
  [param('incidentId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteSafetyIncident({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        incidentId: req.params.incidentId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
