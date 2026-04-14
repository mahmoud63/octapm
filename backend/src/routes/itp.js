const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listItps,
  createItp,
  updateItp,
  deleteItp,
} = require('../services/itp.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listItps({
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
    body('pointType').optional().isIn(['hold', 'witness', 'review']),
    body('status').optional().isIn(['pending', 'passed', 'failed', 'waived']),
    body('inspectionDate').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createItp({
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
  '/:itpId',
  [
    param('itpId').isUUID(),
    body('pointType').optional().isIn(['hold', 'witness', 'review']),
    body('status').optional().isIn(['pending', 'passed', 'failed', 'waived']),
    body('inspectionDate').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateItp({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        itpId: req.params.itpId,
        payload: req.body,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:itpId',
  [param('itpId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteItp({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        itpId: req.params.itpId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
