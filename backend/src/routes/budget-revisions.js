const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listBudgetRevisions,
  createBudgetRevision,
  updateBudgetRevision,
  deleteBudgetRevision,
} = require('../services/budget-revision.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listBudgetRevisions({
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
    body('changeType').isIn(['addition', 'deduction']),
    body('amount').isFloat({ min: 0 }),
    body('effectiveDate').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createBudgetRevision({
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
  '/:revisionId',
  [
    param('revisionId').isUUID(),
    body('changeType').optional().isIn(['addition', 'deduction']),
    body('amount').optional().isFloat({ min: 0 }),
    body('effectiveDate').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateBudgetRevision({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        revisionId: req.params.revisionId,
        payload: req.body,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:revisionId',
  [param('revisionId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteBudgetRevision({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        revisionId: req.params.revisionId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
