const express = require('express');
const { body, param } = require('express-validator');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { sendSuccess } = require('../utils/api-response');
const { moneyBody } = require('../utils/money');
const {
  calculateEot,
  listEotClaims,
  createEotClaim,
  updateEotClaim,
} = require('../services/eot.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listEotClaims({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/calculate',
  requireRoles('pm', 'planning_eng', 'qs'),
  [
    body('eventName').trim().notEmpty(),
    body('eventType').optional({ nullable: true }).isString().trim(),
    body('delayDays').isFloat({ min: 0 }),
    body('eotDaysGranted').optional().isFloat({ min: 0 }),
    moneyBody('ldRatePerDay'),
    body('affectedActivityIds').optional().isArray(),
    body('affectedActivityIds.*').optional().isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('activityLinks.*.delayStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.delayEnd').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.delayDays').optional().isFloat({ min: 0 }),
    body('activityLinks.*.baselineStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.baselineFinish').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactedStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactedFinish').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactBasis').optional({ nullable: true }).isString().trim(),
    body('analysis').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const data = await calculateEot({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        eventName: req.body.eventName,
        eventType: req.body.eventType,
        delayDays: req.body.delayDays,
        eotDaysGranted: req.body.eotDaysGranted,
        ldRatePerDay: req.body.ldRatePerDay,
        affectedActivityIds: req.body.affectedActivityIds,
        activityLinks: req.body.activityLinks,
        analysis: req.body.analysis,
      });

      return sendSuccess(res, data);
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/',
  requireRoles('pm', 'planning_eng', 'qs'),
  [
    body('eventName').trim().notEmpty(),
    body('eventType').optional({ nullable: true }).isString().trim(),
    body('delayDays').isFloat({ min: 0 }),
    body('eotDaysGranted').optional().isFloat({ min: 0 }),
    moneyBody('ldRatePerDay'),
    body('affectedActivityIds').optional().isArray(),
    body('affectedActivityIds.*').optional().isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('activityLinks.*.delayStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.delayEnd').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.delayDays').optional().isFloat({ min: 0 }),
    body('activityLinks.*.baselineStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.baselineFinish').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactedStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactedFinish').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactBasis').optional({ nullable: true }).isString().trim(),
    body('weatherDelayIds').optional().isArray(),
    body('weatherDelayIds.*').optional().isUUID(),
    body('weatherDelayLinks').optional().isArray(),
    body('weatherDelayLinks.*.weatherDelayId').optional().isUUID(),
    body('weatherDelayLinks.*.delayStart')
      .optional({ nullable: true })
      .isISO8601(),
    body('weatherDelayLinks.*.delayEnd')
      .optional({ nullable: true })
      .isISO8601(),
    body('weatherDelayLinks.*.delayDays').optional().isFloat({ min: 0 }),
    body('correspondenceIds').optional().isArray(),
    body('correspondenceIds.*').optional().isUUID(),
    body('correspondenceLinks').optional().isArray(),
    body('correspondenceLinks.*.correspondenceId').optional().isUUID(),
    body('attachmentRefs').optional().isArray(),
    body('attachmentRefs.*.documentId').optional({ nullable: true }).isUUID(),
    body('supportingDocumentIds').optional().isArray(),
    body('supportingDocumentIds.*').optional().isUUID(),
    body('documentIds').optional().isArray(),
    body('documentIds.*').optional().isUUID(),
    body('analysis').optional({ nullable: true }).isString().trim(),
    body('comment').optional({ nullable: true }).isString().trim(),
    body('statusComment').optional({ nullable: true }).isString().trim(),
    body('rejectionReason').optional({ nullable: true }).isString().trim(),
    body('status')
      .optional()
      .isIn(['draft', 'submitted']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createEotClaim({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        userId: req.user.id,
        userRole: req.user.role,
        payload: req.body,
      });

      return sendSuccess(res, row, 201);
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  '/:claimId',
  requireRoles('pm', 'planning_eng', 'qs'),
  [
    param('claimId').isUUID(),
    body('eventName').optional().trim().notEmpty(),
    body('eventType').optional({ nullable: true }).isString().trim(),
    body('delayDays').optional().isFloat({ min: 0 }),
    body('status')
      .optional()
      .isIn(['draft', 'submitted', 'approved', 'rejected']),
    body('eotDaysGranted').optional().isFloat({ min: 0 }),
    moneyBody('ldRatePerDay'),
    body('affectedActivityIds').optional().isArray(),
    body('affectedActivityIds.*').optional().isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('activityLinks.*.delayStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.delayEnd').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.delayDays').optional().isFloat({ min: 0 }),
    body('activityLinks.*.baselineStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.baselineFinish').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactedStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactedFinish').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactBasis').optional({ nullable: true }).isString().trim(),
    body('weatherDelayIds').optional().isArray(),
    body('weatherDelayIds.*').optional().isUUID(),
    body('weatherDelayLinks').optional().isArray(),
    body('weatherDelayLinks.*.weatherDelayId').optional().isUUID(),
    body('weatherDelayLinks.*.delayStart')
      .optional({ nullable: true })
      .isISO8601(),
    body('weatherDelayLinks.*.delayEnd')
      .optional({ nullable: true })
      .isISO8601(),
    body('weatherDelayLinks.*.delayDays').optional().isFloat({ min: 0 }),
    body('correspondenceIds').optional().isArray(),
    body('correspondenceIds.*').optional().isUUID(),
    body('correspondenceLinks').optional().isArray(),
    body('correspondenceLinks.*.correspondenceId').optional().isUUID(),
    body('attachmentRefs').optional().isArray(),
    body('attachmentRefs.*.documentId').optional({ nullable: true }).isUUID(),
    body('supportingDocumentIds').optional().isArray(),
    body('supportingDocumentIds.*').optional().isUUID(),
    body('documentIds').optional().isArray(),
    body('documentIds.*').optional().isUUID(),
    body('analysis').optional({ nullable: true }).isString().trim(),
    body('claimLetter').optional({ nullable: true }).isString().trim(),
    body('comment').optional({ nullable: true }).isString().trim(),
    body('statusComment').optional({ nullable: true }).isString().trim(),
    body('rejectionReason').optional({ nullable: true }).isString().trim(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateEotClaim({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        claimId: req.params.claimId,
        userId: req.user.id,
        userRole: req.user.role,
        payload: req.body,
      });

      return sendSuccess(res, row);
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
