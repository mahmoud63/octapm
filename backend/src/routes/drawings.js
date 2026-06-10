const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listDrawings,
  createDrawing,
  updateDrawing,
  deleteDrawing,
} = require('../services/drawing.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listDrawings({
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
    body('drawingNumber').trim().notEmpty(),
    body('title').trim().notEmpty(),
    body('status').optional().isIn(['active', 'superseded', 'cancelled']),
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
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('reviewedOn').optional({ nullable: true }).isISO8601(),
    body('issueDate').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createDrawing({
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
  '/:drawingId',
  [
    param('drawingId').isUUID(),
    body('status').optional().isIn(['active', 'superseded', 'cancelled']),
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
    body('dueDate').optional({ nullable: true }).isISO8601(),
    body('reviewedOn').optional({ nullable: true }).isISO8601(),
    body('issueDate').optional({ nullable: true }).isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateDrawing({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        drawingId: req.params.drawingId,
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
  '/:drawingId',
  [param('drawingId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteDrawing({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        drawingId: req.params.drawingId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
