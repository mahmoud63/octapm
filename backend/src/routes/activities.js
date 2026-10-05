const express = require('express');
const { body, param, query } = require('express-validator');
const { scalarFigure, INT4_MAX } = require('../utils/figure-input');
const { SCHEDULE_DAYS_MAX } = require('../utils/schedule-days');
const { QUANTITY_MAX } = require('../utils/stock-figures');
const { dateInput } = require('../utils/date-input');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { getEffectiveRole, requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const activityService = require('../services/activity.service');
const { parsePredecessors } = require('../services/activity-dependency.service');
// An activity's approved BOQ allocation (quantity, value, weight) is for
// those who may read the BOQ, its budget for those who may read the BOQ or
// the cost module (§12); every answer that carries an activity goes through
// utils/boq-figures, and a BOQ reader's is the service's own.
const {
  boqFigureAccess,
  withheldActivity,
  withheldActivityDetail,
  withheldActivityQuantities,
  withheldProgressSubmission,
  withheldProgressSubmissions,
  withheldAllocatedItems,
} = require('../utils/boq-figures');
const controlsDetailService = require('../services/controls-detail.service');
const quantityViewsService = require('../services/quantity-views.service');
const progressService = require('../services/progress.service');
const quantityProgressService = require('../services/quantity-progress.service');

const VALID_CATEGORIES = [
  'civil',
  'structural',
  'mechanical',
  'electrical',
  'plumbing',
  'finishing',
  'landscaping',
  'demolition',
  'inspection',
  'other',
];
const VALID_RELATIONSHIPS = ['FS', 'SS', 'FF', 'SF'];
const VALID_PROGRESS_METHODS = [
  'percent',
  'quantity',
  'weighted_milestone',
  'inspection',
  'manual',
  'percent_complete',
  'physical_percent',
  'duration',
  'milestone',
];
const VALID_PROGRESS_SOURCES = ['manual', 'import', 'mobile', 'daily_report'];
const VALID_PROGRESS_STATUSES = ['draft', 'submitted'];

// An activity's duration, day offsets and float, and a dependency's lag, are
// at most SCHEDULE_DAYS_MAX days (a hundred years; utils/schedule-days). They
// were taken up to INT4_MAX, and the dates worked out from them on every read
// and in every PATCH walked one day at a time: a duration of 1,000,000 held
// the PATCH's transaction past its five seconds (500), and past about 71
// million days the walk never ended (CERT-2, trivial-7).
const scheduleDays = (field, { min = 0 } = {}) =>
  body(field).optional().custom(scalarFigure).bail().isInt({ min, max: SCHEDULE_DAYS_MAX }).toInt();
// The lags the predecessors text names ("A1 FS+2, A2 SS-1"), bounded as
// dependencies[].lagDays are: "A1 FS+999999999" was taken as given.
const predecessorLagsFit = (text) => {
  const tooLong = parsePredecessors(text).find((link) => Math.abs(link.lagDays) > SCHEDULE_DAYS_MAX);
  if (tooLong) throw new Error(`a lag is at most ${SCHEDULE_DAYS_MAX} days either way (${tooLong.raw})`);
  return true;
};

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  requirePermission('schedule', 'read'),
  asyncHandler(async (req, res) => {
    const result = await activityService.listActivities({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    const access = boqFigureAccess(req);
    return sendSuccess(res, result.map((activity) => withheldActivity(activity, access)));
  }),
);

router.post(
  '/',
  requirePermission('schedule', 'create'),
  [
    body('name').isString().trim().notEmpty(),
    body('category').optional().isIn(VALID_CATEGORIES),
    body('activityCode')
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 64 }),
    body('wbsCode').optional().isString().trim(),
    body('startDate').optional().isString().custom(dateInput),
    body('endDate').optional().isString().custom(dateInput),
    scheduleDays('earlyStart'),
    scheduleDays('earlyFinish'),
    scheduleDays('lateStart'),
    scheduleDays('lateFinish'),
    scheduleDays('totalFloat'),
    scheduleDays('duration'),
    body('predecessors').optional().isString().bail().trim().custom(predecessorLagsFit),
    body('dependencies').optional().isArray(),
    // One string each (CERT-2 shapes): isUUID() alone took ["<id>"] element
    // by element, and the service then read it as the activity it wraps.
    body('dependencies.*.predecessorId').optional().isString().isUUID(),
    body('dependencies.*.predecessorActivityId').optional().isString().isUUID(),
    body('dependencies.*.predecessorRef').optional().isString().trim(),
    body('dependencies.*.relationshipType').optional().isIn(VALID_RELATIONSHIPS),
    scheduleDays('dependencies.*.lagDays', { min: -SCHEDULE_DAYS_MAX }),
    body('isCritical').optional().isBoolean().toBoolean(),
    moneyBody('budget'),
    body('isMilestone').optional().isBoolean().toBoolean(),
    body('sortOrder').optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
    body('engineerIds')
      .isArray({ min: 1 })
      .withMessage('At least one engineer required'),
    // .isString() first: isUUID() alone checks an array element by element,
    // so [["<id>"]] passed and reached Prisma as a 500 (CERT-2 shapes).
    body('engineerIds.*').isString().isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.createActivity({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
    });
    return sendSuccess(res, withheldActivity(result, boqFigureAccess(req)), 201);
  }),
);

router.post(
  '/bulk-progress',
  requirePermission('progress', 'submit', {
    transition: 'submission.submit',
  }),
  [
    body('updates').isArray({ min: 1 }),
    body('updates.*.activityId').isString().isUUID(),
    body('updates.*.pctComplete')
      .optional()
      .custom(scalarFigure).bail().isFloat({ min: 0, max: 100 })
      .toFloat(),
    moneyBody('updates.*.actualCost'),
    body('updates.*.progressMethod').optional().isIn(VALID_PROGRESS_METHODS),
    body('updates.*.method').optional().isIn(VALID_PROGRESS_METHODS),
    body('updates.*.status').optional().isIn(VALID_PROGRESS_STATUSES),
    body('updates.*.source').optional().isIn(VALID_PROGRESS_SOURCES),
    body('updates.*.quantityComplete').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    body('updates.*.quantityPlanned').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    body('updates.*.quantityUnit').optional().isString().trim(),
    body('updates.*.inspectionStatus').optional().isString().trim(),
    body('updates.*.notes').optional().isString().trim(),
    body('updates.*.evidence').optional().isObject(),
    body('updates.*.milestones').optional().isArray(),
    body('updates.*.entryIds').optional().isArray({ max: 500 }),
    // Each quantity entry one string: [["<id>"]] passed isUUID() element by
    // element (CERT-2 shapes).
    body('updates.*.entryIds.*').optional().isString().isUUID(),
    body('updates.*.bundleSubmittedThrough').optional().isString().custom(dateInput),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.bulkUpdateProgress({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      updates: req.body.updates,
    });
    return sendSuccess(res, { ...result, submissions: withheldProgressSubmissions(result.submissions, boqFigureAccess(req)) });
  }),
);

router.get(
  '/progress-submissions',
  requirePermission('progress', 'read'),
  [
    query('status').isString()
      .optional()
      .isIn(['draft', 'submitted', 'approved', 'rejected']),
    query('from').isString().optional().custom(dateInput),
    query('to').isString().optional().custom(dateInput),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await progressService.listProgressSubmissions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      status: req.query.status || null,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    return sendSuccess(res, withheldProgressSubmissions(result, boqFigureAccess(req)));
  }),
);

router.get(
  '/:id',
  requirePermission('schedule', 'read'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await activityService.getActivityById({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
    });
    return sendSuccess(res, withheldActivity(result, boqFigureAccess(req)));
  }),
);

// GET /projects/:projectId/activities/:id/detail — the activity's whole
// story (PC-5): structure, BOQ allocations, progress, cost, certification,
// changes, procurement, quality, constraints, documents and history, each
// section gated by the module that owns it (controls-detail.service); what
// it says of the bill goes to BOQ readers only (utils/boq-figures). Another
// organisation's activity, or a missing one, is 404 ACTIVITY_NOT_FOUND.
router.get(
  '/:id/detail',
  requirePermission('schedule', 'read'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const detail = await controlsDetailService.getActivityDetail({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      ...controlsDetailService.detailReader(req),
    });
    return sendSuccess(res, withheldActivityDetail(detail, boqFigureAccess(req)));
  }),
);

// GET /projects/:projectId/activities/:id/quantities — the activity's five
// quantities (PC-6) per BOQ item of its approved allocations and folded into
// one unit where they share one: installed (Σ approved quantity entries;
// "—" on an activity not measured by quantity), certified, paid, received,
// issued, committed, each from its owner with truth, basis, unit and
// unit-match flag (quantity-views.service), plus the raw certified >
// installed comparison. Admitted on schedule:read; the approved % complete
// and the planned quantity follow progress:read; every figure goes to BOQ
// readers only (utils/boq-figures), anyone else gets a dash and the reason.
router.get(
  '/:id/quantities',
  requirePermission('schedule', 'read'),
  [param('id').isUUID(), query('cutoffDate').isString().optional().custom(dateInput), validate],
  asyncHandler(async (req, res) => {
    const { can, partyScoped } = controlsDetailService.detailReader(req);
    const view = await quantityViewsService.getActivityQuantities({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      cutoffDate: req.query.cutoffDate || null,
      can,
      partyScoped,
    });
    return sendSuccess(res, withheldActivityQuantities(view, boqFigureAccess(req)));
  }),
);

router.patch(
  '/:id',
  requirePermission('schedule', 'update'),
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty(),
    body('category').optional().isIn(VALID_CATEGORIES),
    body('activityCode')
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 64 }),
    body('wbsCode').optional().isString().trim(),
    body('startDate').optional().isString().custom(dateInput),
    body('endDate').optional().isString().custom(dateInput),
    scheduleDays('earlyStart'),
    scheduleDays('earlyFinish'),
    scheduleDays('lateStart'),
    scheduleDays('lateFinish'),
    scheduleDays('totalFloat'),
    scheduleDays('duration'),
    body('predecessors').optional().isString().bail().trim().custom(predecessorLagsFit),
    body('dependencies').optional().isArray(),
    // One string each (CERT-2 shapes): isUUID() alone took ["<id>"] element
    // by element, and the service then read it as the activity it wraps.
    body('dependencies.*.predecessorId').optional().isString().isUUID(),
    body('dependencies.*.predecessorActivityId').optional().isString().isUUID(),
    body('dependencies.*.predecessorRef').optional().isString().trim(),
    body('dependencies.*.relationshipType').optional().isIn(VALID_RELATIONSHIPS),
    scheduleDays('dependencies.*.lagDays', { min: -SCHEDULE_DAYS_MAX }),
    body('isCritical').optional().isBoolean().toBoolean(),
    moneyBody('budget'),
    body('isMilestone').optional().isBoolean().toBoolean(),
    body('sortOrder').optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
    body('engineerIds').optional().isArray({ min: 1 }),
    body('engineerIds.*').optional().isString().isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.updateActivity({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, withheldActivity(result, boqFigureAccess(req)));
  }),
);

// PC-6 (core): the BOQ items the activity has an approved allocation of —
// what a person on site records installed quantity against (the daily log's
// quantities section, a quantity entry). Progress readers get the list; the
// code, the allocation and the allocated quantity are the bill's and go to
// BOQ readers only (withheldAllocatedItems).
router.get(
  '/:id/allocated-items',
  requirePermission('progress', 'read'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await quantityProgressService.allocatedItemsFor({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
    });
    return sendSuccess(res, withheldAllocatedItems(result, boqFigureAccess(req)));
  }),
);

router.get(
  '/:id/progress-method',
  requirePermission('progress', 'read'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await progressService.getProgressMethod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

router.put(
  '/:id/progress-method',
  requirePermission('progress', 'update', {
    transition: 'method.configure',
  }),
  [
    param('id').isUUID(),
    body('method').isIn(VALID_PROGRESS_METHODS),
    body('plannedQuantity').optional({ nullable: true }).custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    body('quantityUnit').optional({ nullable: true }).isString().trim(),
    body('milestoneWeights').optional({ nullable: true }).isArray(),
    body('milestoneWeights.*.id').optional().isString().trim(),
    body('milestoneWeights.*.name').optional().isString().trim(),
    body('milestoneWeights.*.weight').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    body('inspectionRequired').optional().isBoolean().toBoolean(),
    body('evidenceRequired').optional().isBoolean().toBoolean(),
    body('notes').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await progressService.upsertProgressMethod({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  '/:id/progress-submissions',
  requirePermission('progress', 'read'),
  [
    param('id').isUUID(),
    query('status').isString()
      .optional()
      .isIn(['draft', 'submitted', 'approved', 'rejected']),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await progressService.listProgressSubmissions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      status: req.query.status || null,
    });
    return sendSuccess(res, withheldProgressSubmissions(result, boqFigureAccess(req)));
  }),
);

router.post(
  '/:id/progress',
  requirePermission('progress', 'submit', {
    transition: 'submission.submit',
  }),
  [
    param('id').isUUID(),
    body('pctComplete').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: 100 }).toFloat(),
    moneyBody('actualCost'),
    body('actualStart').optional().isString().custom(dateInput),
    body('actualFinish').optional().isString().custom(dateInput),
    body('progressMethod').optional().isIn(VALID_PROGRESS_METHODS),
    body('method').optional().isIn(VALID_PROGRESS_METHODS),
    body('status').optional().isIn(VALID_PROGRESS_STATUSES),
    body('source').optional().isIn(VALID_PROGRESS_SOURCES),
    body('quantityComplete').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    body('quantityPlanned').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    body('quantityUnit').optional().isString().trim(),
    body('milestones').optional().isArray(),
    body('milestones.*.id').optional().isString().trim(),
    body('milestones.*.name').optional().isString().trim(),
    body('milestones.*.weight').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    body('milestones.*.pctComplete')
      .optional()
      .custom(scalarFigure).bail().isFloat({ min: 0, max: 100 })
      .toFloat(),
    body('milestones.*.complete').optional().isBoolean().toBoolean(),
    body('inspectionStatus').optional().isString().trim(),
    body('evidence').optional().isObject(),
    body('notes').optional().isString().trim(),
    // PC-6: a quantity-method submission bundles quantity entries — the ones
    // named, and/or every submitted entry of the activity dated on or before
    // a day. Its figures are then derived (see progress.service).
    body('entryIds').optional().isArray({ max: 500 }),
    // Each one string: [["<id>"]] passed isUUID() element by element (CERT-2 shapes).
    body('entryIds.*').optional().isString().isUUID(),
    body('bundleSubmittedThrough').optional().isString().custom(dateInput),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.updateProgress({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      userId: req.user.id,
      // Without this the caller arrives at the assignment check with no role,
      // so the PM/planning override the refusal names can never apply — and
      // the same person doing the same thing through bulk-progress, which does
      // pass it, is allowed.
      userRole: getEffectiveRole(req),
      payload: req.body,
    });
    return sendSuccess(res, {
      ...result,
      activity: withheldActivity(result.activity, boqFigureAccess(req)),
      submission: withheldProgressSubmission(result.submission, boqFigureAccess(req)),
    });
  }),
);

router.post(
  '/:id/progress-submissions/:submissionId/approve',
  requirePermission('progress', 'approve', {
    transition: 'submission.approve',
  }),
  [param('id').isUUID(), param('submissionId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await progressService.approveProgressSubmission({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      submissionId: req.params.submissionId,
      userId: req.user.id,
    });
    return sendSuccess(res, withheldProgressSubmission(result, boqFigureAccess(req)));
  }),
);

router.post(
  '/:id/progress-submissions/:submissionId/reject',
  requirePermission('progress', 'approve', {
    transition: 'submission.reject',
  }),
  [
    param('id').isUUID(),
    param('submissionId').isUUID(),
    body('reason').isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await progressService.rejectProgressSubmission({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      submissionId: req.params.submissionId,
      userId: req.user.id,
      reason: req.body.reason,
    });
    return sendSuccess(res, withheldProgressSubmission(result, boqFigureAccess(req)));
  }),
);

router.delete(
  '/:id',
  requirePermission('schedule', 'delete'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await activityService.deleteActivity({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

router.use('/:activityId/materials', require('./materials'));

module.exports = router;
