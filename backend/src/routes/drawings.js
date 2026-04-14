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
    body('issueDate').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createDrawing({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        payload: req.body,
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
    body('issueDate').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateDrawing({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        drawingId: req.params.drawingId,
        payload: req.body,
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
