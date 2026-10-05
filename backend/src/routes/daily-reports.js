const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { getEffectiveRole, requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const { dateInput } = require('../utils/date-input');
const { scalarFigure, INT4_MAX } = require('../utils/figure-input');
const { QUANTITY_MAX } = require('../utils/stock-figures');
const { equipmentLineValidators } = require('../utils/site-record-equipment');
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
  query('date').optional().isString().custom(dateInput),
  query('from').optional().isString().custom(dateInput),
  query('to').optional().isString().custom(dateInput),
  validate,
];

// A photo is an object or a link; a list in its place was dropped unseen.
const isPhotoEntry = (photo) =>
  typeof photo === 'string' || (photo !== null && typeof photo === 'object' && !Array.isArray(photo));

// A date is one text a Date reads (utils/date-input; CERT-2
// evidence-lines-5). isISO8601 alone checked a list element by element and a
// number by its digits, so ["2026-10-01"] and 20261001 were stored (201), and
// it passes the compact, week and ordinal forms ('20261001', '2026-W40',
// '2026-275') new Date() cannot read: a photo's takenAt and uploadedAt were
// stored in such a form, the other dates refused only by the service. Each is
// now a 400 VALIDATION_ERROR naming the field, before the service runs.
//
// A figure is one value (utils/figure-input; CERT-2 evidence-6): isFloat and
// isInt check a list element by element and an empty list not at all, so
// pctProgress [50], [1,1] and [] were stored (201). A manpower line's hours
// are a worker's day (0-24, as a timesheet's are). An equipment line's hours,
// rate and rateType are utils/site-record-equipment's: an equipment line of
// 1e300 hours was accepted and its approval refused for ever (its cost
// overflows the ledger), and one line carries the web progress tab's whole
// day of equipment hours, so a line is bounded at 744 hours (24 x 31), not a
// day (trivial-7); a quantity fits the quantity an approval records (QUANTITY_MAX);
// a count fits an INT4; the weather is the weather on a site (-100..100 °C,
// up to 10,000 mm of rain) — every figure is finite, as on every other route.
const HOURS_IN_A_DAY = 24;
const TEMPERATURE_C = { min: -100, max: 100 };
const RAINFALL_MM_MAX = 10_000;

const reportPayloadValidators = ({ partial = false } = {}) => {
  const optional = { nullable: true };
  return [
    partial ? body('activityId').optional().isString().isUUID() : body('activityId').isString().isUUID(),
    // .isString() first: isUUID() alone checks an array element by element,
    // so ["<id>"] passed and reached the database as a 500 (CERT-2 shapes).
    body('engineerId').optional().isString().isUUID(),
    partial
      ? body('date').optional().isString().custom(dateInput)
      : body('date').isString().custom(dateInput),
    body('shift').optional().isIn(SHIFT_VALUES),
    body('pctProgress').optional(optional).custom(scalarFigure).bail().isFloat({ min: 0, max: 100 }).toFloat(),
    body('weather').optional(optional).isObject(),
    body('weather.summary').optional().isString().trim(),
    body('weather.temperatureC').optional().custom(scalarFigure).bail().isFloat(TEMPERATURE_C).toFloat(),
    body('weather.condition').optional().isString().trim(),
    body('weather.wind').optional().isString().trim(),
    body('weather.rainfallMm').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: RAINFALL_MM_MAX }).toFloat(),
    body('weather.delayImpact').optional().isBoolean().toBoolean(),
    body('manpower').optional(optional).isArray(),
    body('manpower.*.trade').optional().isString().trim(),
    body('manpower.*.workers').optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
    body('manpower.*.hours').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: HOURS_IN_A_DAY }).toFloat(),
    body('materials').optional(optional).isArray(),
    body('materials.*.materialId').optional().isString().trim(),
    body('materials.*.name').optional().isString().trim(),
    body('materials.*.qty').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    body('materials.*.unit').optional().isString().trim(),
    body('equipment').optional(optional).isArray(),
    body('equipment.*.equipmentId').optional().isString().trim(),
    // The approval reads a line's equipment from .id too: one text, checked
    // against the project's equipment as equipmentId is (CERT-2).
    body('equipment.*.id').optional().isString(),
    body('equipment.*.name').optional().isString().trim(),
    ...equipmentLineValidators(),
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
    body('photos.*.size').optional().custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
    body('photos.*.storage').optional().isString().trim(),
    body('photos.*.caption').optional().isString().trim(),
    body('photos.*.takenAt').optional().isString().custom(dateInput),
    body('photos.*.uploadedAt').optional().isString().custom(dateInput),
    body('photos.*.uploadedBy').optional({ nullable: true }).isString(),
    // The upload answer's downloadUrl and the UAT runner's fileName, fileUrl,
    // sizeBytes and description are read as the photo's link, name, size and
    // description (daily-report.service normalizePhotos; CERT-2).
    body('photos.*.fileUrl').optional({ nullable: true }).isString().trim(),
    body('photos.*.downloadUrl').optional({ nullable: true }).isString().trim(),
    body('photos.*.fileName').optional({ nullable: true }).isString().trim(),
    body('photos.*.sizeBytes').optional({ nullable: true }).custom(scalarFigure).bail().isInt({ min: 0, max: INT4_MAX }).toInt(),
    body('photos.*.description').optional({ nullable: true }).isString(),
    body('notes').optional(optional).isString().trim(),
    body('clientRequestId').optional(optional).isString().trim().isLength({ max: 100 }),
    body('clientCreatedAt').optional(optional).isString().custom(dateInput),
    body('deviceId').optional(optional).isString().trim().isLength({ max: 100 }),
    body('status').optional().isIn(CREATE_STATUSES),
    body('progress').optional().isObject(),
    body('progress.method').optional().isIn(PROGRESS_METHODS),
    body('progress.progressMethod').optional().isIn(PROGRESS_METHODS),
    body('progress.pctComplete')
      .optional()
      .custom(scalarFigure)
      .bail()
      .isFloat({ min: 0, max: 100 })
      .toFloat(),
    body('progress.quantityComplete')
      .optional()
      .custom(scalarFigure)
      .bail()
      .isFloat({ min: 0, max: QUANTITY_MAX })
      .toFloat(),
    body('progress.quantityPlanned').optional().custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX }).toFloat(),
    body('progress.quantityUnit').optional().isString().trim(),
    body('progress.milestones').optional().isArray(),
    body('progress.inspectionStatus').optional().isString().trim(),
    body('progress.evidence').optional().isObject(),
    moneyBody('progress.actualCost'),
    body('progress.actualStart').optional().isString().custom(dateInput),
    body('progress.actualFinish').optional().isString().custom(dateInput),
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
