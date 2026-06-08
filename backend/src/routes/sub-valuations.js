const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listSubValuations,
  createSubValuation,
  updateSubValuation,
  deleteSubValuation,
} = require('../services/sub-valuation.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listSubValuations({
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
    body('subcontractor').trim().notEmpty(),
    body('period').trim().notEmpty(),
    body('workDone').optional().isFloat({ min: 0 }),
    body('materialsOnSite').optional().isFloat({ min: 0 }),
    body('retentionRate').optional().isFloat({ min: 0, max: 100 }),
    body('backCharges').optional().isFloat({ min: 0 }),
    body('status').optional().isIn(['draft', 'submitted', 'certified', 'paid']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createSubValuation({
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
  '/:valuationId',
  [
    param('valuationId').isUUID(),
    body('workDone').optional().isFloat({ min: 0 }),
    body('materialsOnSite').optional().isFloat({ min: 0 }),
    body('retentionRate').optional().isFloat({ min: 0, max: 100 }),
    body('backCharges').optional().isFloat({ min: 0 }),
    body('status').optional().isIn(['draft', 'submitted', 'certified', 'paid']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateSubValuation({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        valuationId: req.params.valuationId,
        payload: req.body,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:valuationId',
  [param('valuationId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteSubValuation({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        valuationId: req.params.valuationId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
