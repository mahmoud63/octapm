const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { getEffectiveRole, requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const dailyReportService = require('../services/daily-report.service');
const {
  boqFigureAccess,
  withheldDailyReport,
  withheldDailyReports,
} = require('../utils/boq-figures');

const CREATE_STATUSES = ['draft', 'submitted'];
const SHIFT_VALUES = ['day', 'night', 'swing'];
const PROGRESS_METHODS = [
  'percent',
  'quantity',
  'weighted_milestone',
  'inspection',
  'manual',
];

const router = express.Router({ mergeParams: true });
router.use(authenticate);

// Each filter is one value: a repeated one (?status=a&status=b) passed the
// element-by-element checks and reached Prisma as a list — a 500 (CERT-2).
const collectionFilters = [
  query('activityId').optional().isString().isUUID(),
  query('status').optional().isString().isIn(dailyReportService.REPORT_STATUSES),
  query('date').optional().isString().isISO8601(),
  query('from').optional().isString().isISO8601(),
  query('to').optional().isString().isISO8601(),
  validate,
];

// A photo is an object or a link; a list in its place was dropped unseen.
const isPhotoEntry = (photo) =>
  typeof photo === 'string' || (photo !== null && typeof photo === 'object' && !Array.isArray(photo));

const reportPayloadValidators = ({ partial = false } = {}) => {
  const optional = { nullable: true };
  return [
    partial ? body('activityId').optional().isString().isUUID() : body('activityId').isString().isUUID(),
    // .isString() first: isUUID() alone checks an array element by element,
    // so ["<id>"] passed and reached the database as a 500 (CERT-2 shapes).
    body('engineerId').optional().isString().isUUID(),
    partial
      ? body('date').optional().isISO8601()
      : body('date').isISO8601(),
    body('shift').optional().isIn(SHIFT_VALUES),
    body('pctProgress').optional(optional).isFloat({ min: 0, max: 100 }).toFloat(),
    body('weather').optional(optional).isObject(),
    body('weather.summary').optional().isString().trim(),
    body('weather.temperatureC').optional().isFloat().toFloat(),
    body('weather.condition').optional().isString().trim(),
    body('weather.wind').optional().isString().trim(),
    body('weather.rainfallMm').optional().isFloat({ min: 0 }).toFloat(),
    body('weather.delayImpact').optional().isBoolean().toBoolean(),
    body('manpower').optional(optional).isArray(),
    body('manpower.*.trade').optional().isString().trim(),
    body('manpower.*.workers').optional().isInt({ min: 0 }).toInt(),
    body('manpower.*.hours').optional().isFloat({ min: 0 }).toFloat(),
    body('materials').optional(optional).isArray(),
    body('materials.*.materialId').optional().isString().trim(),
    body('materials.*.name').optional().isString().trim(),
    body('materials.*.qty').optional().isFloat({ min: 0 }).toFloat(),
    body('materials.*.unit').optional().isString().trim(),
    body('equipment').optional(optional).isArray(),
    body('equipment.*.equipmentId').optional().isString().trim(),
    // The approval reads a line's equipment from .id too: one text, checked
    // against the project's equipment as equipmentId is (CERT-2).
    body('equipment.*.id').optional().isString(),
    body('equipment.*.name').optional().isString().trim(),
    body('equipment.*.hours').optional().isFloat({ min: 0 }).toFloat(),
    body('issues').optional(optional).isArray(),
    body('issues.*.description').optional().isString().trim(),
    body('issues.*.title').optional().isString().trim(),
    body('issues.*.severity').optional().isString().trim(),
    body('issues.*.owner').optional().isString().trim(),
    body('issues.*.status').optional().isString().trim(),
    body('photos').optional(optional).isArray(),
    body('photos.*').custom(isPhotoEntry),
    body('photos.*.url').optional().isString().trim(),
    body('photos.*.key').optional().isString().trim(),
    body('photos.*.filename').optional().isString().trim(),
    body('photos.*.originalName').optional().isString().trim(),
    body('photos.*.mimeType').optional().isString().trim(),
    body('photos.*.size').optional().isInt({ min: 0 }).toInt(),
    body('photos.*.storage').optional().isString().trim(),
    body('photos.*.caption').optional().isString().trim(),
    body('photos.*.takenAt').optional().isISO8601(),
    body('photos.*.uploadedAt').optional().isISO8601(),
    body('photos.*.uploadedBy').optional({ nullable: true }).isString(),
    body('notes').optional(optional).isString().trim(),
    body('clientRequestId').optional(optional).isString().trim().isLength({ max: 100 }),
    body('clientCreatedAt').optional(optional).isISO8601(),
    body('deviceId').optional(optional).isString().trim().isLength({ max: 100 }),
    body('status').optional().isIn(CREATE_STATUSES),
    body('progress').optional().isObject(),
    body('progress.method').optional().isIn(PROGRESS_METHODS),
    body('progress.progressMethod').optional().isIn(PROGRESS_METHODS),
    body('progress.pctComplete')
      .optional()
      .isFloat({ min: 0, max: 100 })
      .toFloat(),
    body('progress.quantityComplete')
      .optional()
      .isFloat({ min: 0 })
      .toFloat(),
    body('progress.quantityPlanned').optional().isFloat({ min: 0 }).toFloat(),
    body('progress.quantityUnit').optional().isString().trim(),
    body('progress.milestones').optional().isArray(),
    body('progress.inspectionStatus').optional().isString().trim(),
    body('progress.evidence').optional().isObject(),
    moneyBody('progress.actualCost'),
    body('progress.actualStart').optional().isISO8601(),
    body('progress.actualFinish').optional().isISO8601(),
    body('progress.notes').optional().isString().trim(),
    validate,
  ];
};

router.get(
  '/',
  requirePermission('progress', 'read'),
  collectionFilters,
  asyncHandler(async (req, res) => {
    const result = await dailyReportService.listDailyReports({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.query.activityId || null,
      status: req.query.status || null,
      date: req.query.date || null,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    return sendSuccess(res, withheldDailyReports(result, boqFigureAccess(req)));
  }),
);

router.post(
  '/',
  requirePermission('progress', 'submit', {
    transition: 'daily_report.submit',
  }),
  reportPayloadValidators(),
  asyncHandler(async (req, res) => {
    const result = await dailyReportService.createDailyReport({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      payload: req.body,
    });
    return sendSuccess(res, withheldDailyReport(result, boqFigureAccess(req)), 201);
  }),
);

router.get(
  '/:reportId',
  requirePermission('progress', 'read'),
  [param('reportId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await dailyReportService.getDailyReport({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      reportId: req.params.reportId,
    });
    return sendSuccess(res, withheldDailyReport(result, boqFigureAccess(req)));
  }),
);

router.patch(
  '/:reportId',
  requirePermission('progress', 'update', {
    transition: 'daily_report.update',
  }),
  [param('reportId').isUUID(), ...reportPayloadValidators({ partial: true })],
  asyncHandler(async (req, res) => {
    const result = await dailyReportService.updateDailyReport({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      reportId: req.params.reportId,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, withheldDailyReport(result, boqFigureAccess(req)));
  }),
);

router.post(
  '/:reportId/submit',
  requirePermission('progress', 'submit', {
    transition: 'daily_report.submit',
  }),
  [param('reportId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await dailyReportService.submitDailyReport({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      reportId: req.params.reportId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, withheldDailyReport(result, boqFigureAccess(req)));
  }),
);

router.post(
  '/:reportId/approve',
  requirePermission('progress', 'approve', {
    transition: 'daily_report.approve',
  }),
  [param('reportId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await dailyReportService.approveDailyReport({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      reportId: req.params.reportId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, withheldDailyReport(result, boqFigureAccess(req)));
  }),
);

router.post(
  '/:reportId/reject',
  requirePermission('progress', 'approve', {
    transition: 'daily_report.reject',
  }),
  [
    param('reportId').isUUID(),
    body('reason').isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await dailyReportService.rejectDailyReport({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      reportId: req.params.reportId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      reason: req.body.reason,
    });
    return sendSuccess(res, withheldDailyReport(result, boqFigureAccess(req)));
  }),
);

router.post(
  '/:reportId/review',
  requirePermission('progress', 'approve', {
    transition: 'daily_report.review',
  }),
  [param('reportId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await dailyReportService.approveDailyReport({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      reportId: req.params.reportId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, withheldDailyReport(result, boqFigureAccess(req)));
  }),
);

module.exports = router;
