const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { sendSuccess } = require('../utils/api-response');
const { moneyBody } = require('../utils/money');
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

    return sendSuccess(res, data);
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/',
  [
    body('title').trim().notEmpty(),
    body('changeType').isIn(['addition', 'deduction']),
    moneyBody('amount', { required: true }),
    body('effectiveDate').optional().isISO8601(),
    body('status').optional().isIn(['draft', 'submitted', 'approved', 'rejected']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createBudgetRevision({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        userId: req.user.id,
        payload: req.body,
      });

      return sendSuccess(res, row, 201);
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
    moneyBody('amount'),
    body('effectiveDate').optional().isISO8601(),
    body('status').optional().isIn(['draft', 'submitted', 'approved', 'rejected']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateBudgetRevision({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        revisionId: req.params.revisionId,
        userId: req.user.id,
        payload: req.body,
      });

      return sendSuccess(res, row);
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

      return sendSuccess(res, data);
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
