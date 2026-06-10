const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listCorrespondence,
  createCorrespondence,
  updateCorrespondence,
  deleteCorrespondence,
} = require('../services/correspondence.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listCorrespondence({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/',
  [
    body('direction').isIn(['incoming', 'outgoing']),
    body('type').isIn(['letter', 'email', 'memo', 'notice']),
    body('subject').trim().notEmpty(),
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
    body('date').optional({ nullable: true }).isISO8601(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('responseRequiredBy').optional({ nullable: true }).isISO8601(),
    body('responseDate').optional({ nullable: true }).isISO8601(),
    body('status').optional().isIn(['open', 'closed']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createCorrespondence({
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
  '/:correspondenceId',
  [
    param('correspondenceId').isUUID(),
    body('direction').optional().isIn(['incoming', 'outgoing']),
    body('type').optional().isIn(['letter', 'email', 'memo', 'notice']),
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
    body('date').optional({ nullable: true }).isISO8601(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('responseRequiredBy').optional({ nullable: true }).isISO8601(),
    body('responseDate').optional({ nullable: true }).isISO8601(),
    body('status').optional().isIn(['open', 'closed']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateCorrespondence({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        correspondenceId: req.params.correspondenceId,
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
  '/:correspondenceId',
  [param('correspondenceId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteCorrespondence({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        correspondenceId: req.params.correspondenceId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
