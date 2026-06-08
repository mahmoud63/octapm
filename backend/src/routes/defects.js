const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listDefects,
  createDefect,
  updateDefect,
  deleteDefect,
} = require('../services/defect.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listDefects({
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
    body('title').trim().notEmpty(),
    body('severity').optional().isIn(['minor', 'major', 'critical']),
    body('status').optional().isIn(['open', 'in_progress', 'closed']),
    body('targetCloseBy').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createDefect({
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
  '/:defectId',
  [
    param('defectId').isUUID(),
    body('severity').optional().isIn(['minor', 'major', 'critical']),
    body('status').optional().isIn(['open', 'in_progress', 'closed']),
    body('targetCloseBy').optional().isISO8601(),
    body('closedDate').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateDefect({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        defectId: req.params.defectId,
        payload: req.body,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:defectId',
  [param('defectId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteDefect({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        defectId: req.params.defectId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
