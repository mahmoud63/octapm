const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listTransmittals,
  createTransmittal,
  updateTransmittal,
  deleteTransmittal,
} = require('../services/transmittal.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listTransmittals({
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
    body('subject').trim().notEmpty(),
    body('sender').trim().notEmpty(),
    body('recipient').trim().notEmpty(),
    body('method').optional().isIn(['email', 'courier', 'hand']),
    body('status').optional().isIn(['pending_ack', 'acknowledged']),
    body('owner').optional().isString().trim(),
    body('reviewer').optional().isString().trim(),
    body('approver').optional().isString().trim(),
    body('activityIds').optional().isArray(),
    body('activityIds.*').optional().isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('attachments').optional().isArray(),
    body('attachmentRefs').optional().isArray(),
    body('revisions').optional().isArray(),
    body('comment').optional().isString().trim(),
    body('statusComment').optional().isString().trim(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('transmittedOn').optional({ nullable: true }).isISO8601(),
    body('acknowledgedOn').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createTransmittal({
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
  '/:transmittalId',
  [
    param('transmittalId').isUUID(),
    body('method').optional().isIn(['email', 'courier', 'hand']),
    body('status').optional().isIn(['pending_ack', 'acknowledged']),
    body('owner').optional().isString().trim(),
    body('reviewer').optional().isString().trim(),
    body('approver').optional().isString().trim(),
    body('activityIds').optional().isArray(),
    body('activityIds.*').optional().isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('attachments').optional().isArray(),
    body('attachmentRefs').optional().isArray(),
    body('revisions').optional().isArray(),
    body('comment').optional().isString().trim(),
    body('statusComment').optional().isString().trim(),
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('transmittedOn').optional({ nullable: true }).isISO8601(),
    body('acknowledgedOn').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateTransmittal({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        transmittalId: req.params.transmittalId,
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
  '/:transmittalId',
  [param('transmittalId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteTransmittal({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        transmittalId: req.params.transmittalId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
