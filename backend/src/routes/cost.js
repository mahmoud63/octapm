const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const costService = require('../services/cost.service');
const costReconciliation = require('../services/cost-reconciliation.service');
const costMigration = require('../services/cost-migration.service');
const {
  boqFigureAccess,
  withheldCostRecord,
  withheldCostRecords,
  withheldCostSummary,
} = require('../utils/boq-figures');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  requirePermission('cost', 'read'),
  [
    query('cursor').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('activityId').optional().isUUID(),
    query('category').optional().isString().trim().isLength({ max: 120 }),
    query('search').optional().isString().trim().isLength({ max: 120 }),
    query('sortBy')
      .optional()
      .isIn([
        'activity',
        'phase',
        'updated',
        'labour',
        'material',
        'equipment',
        'subcontract',
        'committed',
        'actual',
        'forecast',
      ]),
    query('sortDir').optional().isIn(['asc', 'desc']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await costService.getCostRecords({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
    });
    // A record's budget is its activity's approved BOQ allocation: withheld
    // from a caller who may not read the BOQ (owner decision E1).
    return sendSuccess(res, withheldCostRecords(result, boqFigureAccess(req)));
  }),
);

router.get(
  '/summary',
  requirePermission('cost', 'read'),
  asyncHandler(async (req, res) => {
    const result = await costService.getCostSummary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, withheldCostSummary(result, boqFigureAccess(req)));
  }),
);

router.get(
  '/burn-rate',
  requirePermission('cost', 'read'),
  asyncHandler(async (req, res) => {
    const result = await costService.getBurnRate({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/burn-rate',
  requirePermission('cost', 'create', {
    transition: 'burn_rate.create',
  }),
  [
    body('date').optional().isISO8601(),
    moneyBody('amount', { required: true }),
    body('category').optional().isString().trim(),
    body('note').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await costService.addBurnRateEntry({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/activity/:activityId',
  requirePermission('cost', 'create', {
    transition: 'activity_cost.upsert',
  }),
  [
    param('activityId').isUUID(),
    moneyBody('labour'),
    moneyBody('material'),
    moneyBody('equipment'),
    moneyBody('subcontract'),
    moneyBody('indirect'),
    moneyBody('overhead'),
    moneyBody('contingency'),
    moneyBody('budget'),
    moneyBody('committed'),
    moneyBody('actual'),
    body('actualThroughDate').optional({ nullable: true }).isISO8601(),
    moneyBody('forecast'),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await costService.upsertCostRecord({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.activityId,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });
    // The record's budget, written from its activity's approved allocation
    // when the record is made, goes the way of GET /cost (owner decision E1).
    return sendSuccess(res, withheldCostRecord(result, boqFigureAccess(req)), 201);
  }),
);

router.patch(
  '/:id',
  requirePermission('cost', 'update', {
    transition: 'activity_cost.update',
  }),
  [
    param('id').isUUID(),
    moneyBody('labour'),
    moneyBody('material'),
    moneyBody('equipment'),
    moneyBody('subcontract'),
    moneyBody('indirect'),
    moneyBody('overhead'),
    moneyBody('contingency'),
    moneyBody('budget'),
    moneyBody('committed'),
    moneyBody('actual'),
    body('actualThroughDate').optional({ nullable: true }).isISO8601(),
    moneyBody('forecast'),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await costService.updateCostRecord({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      costRecordId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: req.user.role,
    });
    return sendSuccess(res, withheldCostRecord(result, boqFigureAccess(req)));
  }),
);

// ─── actual-cost reconciliation (OCTA-FIN-LEDGER-059) ──────────────────────

/**
 * Compares the stored actual cost against the cost ledger and reports the
 * difference. Read-only — it never corrects anything.
 */
router.get(
  '/reconciliation',
  requirePermission('cost', 'read'),
  [param('projectId').isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await costReconciliation.reconcile({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
      }),
    ),
  ),
);

/** Where one actual-cost figure came from — the entries behind it. */
router.get(
  '/reconciliation/explain',
  requirePermission('cost', 'read'),
  [
    param('projectId').isUUID(),
    query('budgetLineId').optional().isUUID(),
    query('activityId').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await costReconciliation.explain({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        budgetLineId: req.query.budgetLineId ?? null,
        activityId: req.query.activityId ?? null,
        limit: req.query.limit ?? 200,
      }),
    ),
  ),
);

/**
 * What actual cost predates the ledger, classified — read-only.
 */
router.get(
  '/reconciliation/migration',
  requirePermission('cost', 'read'),
  [param('projectId').isUUID(), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await costMigration.analyse({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
      }),
    ),
  ),
);

/**
 * Opens the balances that no source transaction explains, as
 * `legacy_opening_balance` entries. Idempotent: the key names the row it
 * opens, not the run, so a second pass writes nothing.
 */
router.post(
  '/reconciliation/migrate',
  requirePermission('cost', 'approve'),
  [
    param('projectId').isUUID(),
    body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    body('dryRun').optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await costMigration.migrate({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        actor: req.user,
        reason: req.body?.reason ?? null,
        dryRun: req.body?.dryRun ?? false,
      }),
    ),
  ),
);

/**
 * Rebuilds the projections from the ledger. A deliberate act, not a schedule:
 * a silent nightly rewrite of financial figures hides drift instead of
 * surfacing it. Refused with 409 ACTUAL_COST_LEDGER_MIGRATION_REQUIRED while
 * unexplained actual cost exists, because "repairing" it would erase it.
 */
router.post(
  '/reconciliation/recompute',
  requirePermission('cost', 'approve'),
  [
    param('projectId').isUUID(),
    body('dryRun').optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await costReconciliation.recomputeActualCost({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        actor: req.user,
        dryRun: req.body?.dryRun ?? false,
      }),
    ),
  ),
);

module.exports = router;
