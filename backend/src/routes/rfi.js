const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listRfis,
  createRfi,
  updateRfi,
  deleteRfi,
} = require('../services/rfi.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listRfis({
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
    body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
    body('status').optional().isIn(['open', 'answered', 'closed']),
    body('raisedDate').optional().isISO8601(),
    body('dueDate').optional().isISO8601(),
    body('responseRequiredBy').optional().isISO8601(),
    body('answeredDate').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createRfi({
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
  '/:rfiId',
  [
    param('rfiId').isUUID(),
    body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
    body('status').optional().isIn(['open', 'answered', 'closed']),
    body('raisedDate').optional().isISO8601(),
    body('dueDate').optional().isISO8601(),
    body('responseRequiredBy').optional().isISO8601(),
    body('answeredDate').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateRfi({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        rfiId: req.params.rfiId,
        payload: req.body,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:rfiId',
  [param('rfiId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteRfi({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        rfiId: req.params.rfiId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
