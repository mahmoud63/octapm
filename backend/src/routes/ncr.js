const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listNcrs,
  createNcr,
  updateNcr,
  deleteNcr,
} = require('../services/ncr.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listNcrs({
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
    body('severity').optional().isIn(['major', 'minor']),
    body('status').optional().isIn(['open', 'closed']),
    body('dueDate').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createNcr({
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
  '/:ncrId',
  [
    param('ncrId').isUUID(),
    body('severity').optional().isIn(['major', 'minor']),
    body('status').optional().isIn(['open', 'closed']),
    body('dueDate').optional().isISO8601(),
    body('closedDate').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateNcr({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        ncrId: req.params.ncrId,
        payload: req.body,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:ncrId',
  [param('ncrId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteNcr({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        ncrId: req.params.ncrId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
