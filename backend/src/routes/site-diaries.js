const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const siteDiaryService = require('../services/site-diary.service');
const { dateInput } = require('../utils/date-input');
const { scalarFigure, INT4_MAX } = require('../utils/figure-input');
const { QUANTITY_MAX } = require('../utils/stock-figures');
const { equipmentLineValidators } = require('../utils/site-record-equipment');

const CREATE_STATUSES = ['draft', 'submitted'];
// A figure is one value (utils/figure-input; CERT-2 evidence-6): isFloat and
// isInt check a list element by element and an empty list not at all, so
// workers [5] and [] were stored (201). The diary's workers are an INT4
// column: '99999999999999999999' passed isInt and answered 500 at the write.
// A manpower line's hours are a worker's day (0-24); an equipment line's
// hours, rate and rateType are a daily report's (utils/site-record-equipment:
// up to 744 hours, a rate 0 to MONEY_FIGURE_MAX, 'hourly' or 'daily'), and
// every other figure is bounded as a daily report's is.
const WORKERS_MAX = INT4_MAX;
const HOURS_IN_A_DAY = 24;
const TEMPERATURE_C = { min: -100, max: 100 };
const RAINFALL_MM_MAX = 10_000;
const SHIFT_VALUES = ['day', 'night', 'swing'];

const router = express.Router({ mergeParams: true });
router.use(authenticate);

// A photo is an object or a link, as a daily report's is (CERT-2); a list in
// its place was dropped unseen.
const isPhotoEntry = (photo) =>
  typeof photo === 'string' || (photo !== null && typeof photo === 'object' && !Array.isArray(photo));

// The diary's weather, under either of its names: weatherJson is read as
// weatherDetails when that is absent (site-diary.service buildDiaryData), and
// took only isObject(), so its temperatureC and rainfallMm bypassed the figure
// checks ([5] stored as 5, [] as 0, 1e300 as 1e300; CERT-2 trivial-7). Each
// name gets the same checks.
const weatherValidators = (field, optional) => [
  body(field).optional(optional).isObject(),
  body(`${field}.summary`).optional().isString().trim(),
  body(`${field}.temperatureC`).optional().custom(scalarFigure).bail().isFloat(TEMPERATURE_C).toFloat(),
  body(`${field}.condition`).optional().isString().trim(),
  body(`${field}.wind`).optional().isString().trim(),
  body(`${field}.rainfallMm`).optional().custom(scalarFigure).bail().isFloat({ min: 0, max: RAINFALL_MM_MAX }).toFloat(),
  body(`${field}.delayImpact`).optional().isBoolean().toBoolean(),
];

const diaryPayloadValidators = ({ partial = false } = {}) => {
  const optional = { nullable: true };
  // A date is one text a Date reads, as a daily report's is (utils/date-input;
  // CERT-2 evidence-lines-5): isISO8601 alone passed a list, a number, and
  // the compact, week and ordinal forms new Date() cannot read.
  return [
    body('engineerId').optional().isString().isUUID(),
    partial
      ? body('date').optional().isString().custom(dateInput)
      : body('date').isString().custom(dateInput),
    body('shift').optional().isIn(SHIFT_VALUES),
    body('weather').optional(optional).isString().trim(),
    ...weatherValidators('weatherDetails', optional),
    ...weatherValidators('weatherJson', optional),
    body('workers').optional(optional).custom(scalarFigure).bail().isInt({ min: 0, max: WORKERS_MAX }).toInt(),
    body('visitors').optional(optional).isString().trim(),
    body('workDone').optional(optional).isString().trim(),
    body('issues').optional(optional).isString().trim(),
    body('issueItems').optional(optional).isArray(),
    body('issueItems.*.description').optional().isString().trim(),
    body('issueItems.*.title').optional().isString().trim(),
    body('issueItems.*.severity').optional().isString().trim(),
    body('issueItems.*.owner').optional().isString().trim(),
    body('issueItems.*.status').optional().isString().trim(),
    body('instructions').optional(optional).isString().trim(),
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
    body('equipment.*.id').optional().isString(),
    body('equipment.*.name').optional().isString().trim(),
    ...equipmentLineValidators(),
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
    // The uploader is read from the photo's document (site-diary.service).
    body('photos.*.uploadedBy').optional({ nullable: true }).isString(),
    // The upload answer's downloadUrl and the UAT runner's fileName, fileUrl,
    // sizeBytes and description are read as the photo's link, name, size and
    // description (site-diary.service normalizePhotos; CERT-2).
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
    validate,
  ];
};

router.get(
  '/',
  requirePermission('progress', 'read'),
  [
    query('status').isString().optional().isIn(siteDiaryService.DIARY_STATUSES),
    query('date').isString().optional().custom(dateInput),
    query('from').isString().optional().custom(dateInput),
    query('to').isString().optional().custom(dateInput),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.listSiteDiaries({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      status: req.query.status || null,
      date: req.query.date || null,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requirePermission('progress', 'submit', {
    transition: 'site_diary.submit',
  }),
  diaryPayloadValidators(),
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.createSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  '/:diaryId',
  requirePermission('progress', 'read'),
  [param('diaryId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.getSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      diaryId: req.params.diaryId,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  '/:diaryId',
  requirePermission('progress', 'update', {
    transition: 'site_diary.update',
  }),
  [param('diaryId').isUUID(), ...diaryPayloadValidators({ partial: true })],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.updateSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      diaryId: req.params.diaryId,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:diaryId/submit',
  requirePermission('progress', 'submit', {
    transition: 'site_diary.submit',
  }),
  [param('diaryId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.submitSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      diaryId: req.params.diaryId,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:diaryId/approve',
  requirePermission('progress', 'approve', {
    transition: 'site_diary.approve',
  }),
  [param('diaryId').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.approveSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      diaryId: req.params.diaryId,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:diaryId/reject',
  requirePermission('progress', 'approve', {
    transition: 'site_diary.reject',
  }),
  [
    param('diaryId').isUUID(),
    body('reason').isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await siteDiaryService.rejectSiteDiary({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      diaryId: req.params.diaryId,
      userId: req.user.id,
      reason: req.body.reason,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
