const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listCashFlow,
  createManualCashFlowEntry,
  rebuildCashFlow,
  deleteCashFlowEntry,
} = require('../services/cash-flow.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listCashFlow({
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
    body('period').matches(/^\d{4}-\d{2}$/),
    body('inflow').optional().isFloat({ min: 0 }),
    body('outflow').optional().isFloat({ min: 0 }),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createManualCashFlowEntry({
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

router.post('/rebuild', async (req, res, next) => {
  try {
    const data = await rebuildCashFlow({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.delete(
  '/:entryId',
  [param('entryId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteCashFlowEntry({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        entryId: req.params.entryId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
