const express = require('express');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { moneyBody } = require('../utils/money');
const changeOrderService = require('../services/change-order.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.listChangeOrders({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requireRoles('pm', 'qs'),
  [
    body('description').isString().trim().notEmpty(),
    body('activityId').optional({ nullable: true }).isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('activityLinks.*.relationType').optional().isString().trim(),
    body('activityLinks.*.scheduleImpactDays').optional().isInt().toInt(),
    body('activityLinks.*.approvedScheduleImpactDays').optional().isInt().toInt(),
    moneyBody('activityLinks.*.costImpact'),
    moneyBody('activityLinks.*.approvedCostImpact'),
    body('activityLinks.*.baselineStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.baselineFinish').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactedStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactedFinish').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactBasis').optional({ nullable: true }).isString().trim(),
    body('activityLinks.*.notes').optional({ nullable: true }).isString().trim(),
    body('affectedActivityIds').optional().isArray(),
    body('affectedActivityIds.*').optional().isUUID(),
    body('allocationLinks').optional().isArray(),
    body('allocationLinks.*.allocationId').optional({ nullable: true }).isUUID(),
    body('allocationLinks.*.boqItemId').optional({ nullable: true }).isUUID(),
    body('allocationLinks.*.quantity').optional().isFloat({ min: 0 }).toFloat(),
    moneyBody('allocationLinks.*.amount'),
    body('allocationLinks.*.notes').optional({ nullable: true }).isString().trim(),
    body('correspondenceIds').optional().isArray(),
    body('correspondenceIds.*').optional().isUUID(),
    body('correspondenceLinks').optional().isArray(),
    body('correspondenceLinks.*.correspondenceId').optional().isUUID(),
    body('correspondenceLinks.*.relationType').optional().isString().trim(),
    body('attachmentRefs').optional().isArray(),
    body('attachmentRefs.*.documentId').optional({ nullable: true }).isUUID(),
    body('supportingDocumentIds').optional().isArray(),
    body('supportingDocumentIds.*').optional().isUUID(),
    body('documentIds').optional().isArray(),
    body('documentIds.*').optional().isUUID(),
    body('category').optional().isString().trim(),
    moneyBody('value'),
    body('status').optional().isIn(['pending', 'approved', 'rejected']),
    body('scheduleImpact').optional().isInt().toInt(),
    body('submittedDate').optional().isISO8601(),
    body('raisedBy').optional().isString().trim(),
    body('rejectedReason').optional().isString().trim(),
    body('approvalComment').optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.createChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      userRole: req.user.role,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.patch(
  '/:id',
  requireRoles('pm', 'qs'),
  [
    param('id').isUUID(),
    body('description').optional().isString().trim().notEmpty(),
    body('activityId').optional({ nullable: true }).isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('activityLinks.*.relationType').optional().isString().trim(),
    body('activityLinks.*.scheduleImpactDays').optional().isInt().toInt(),
    body('activityLinks.*.approvedScheduleImpactDays').optional().isInt().toInt(),
    moneyBody('activityLinks.*.costImpact'),
    moneyBody('activityLinks.*.approvedCostImpact'),
    body('activityLinks.*.baselineStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.baselineFinish').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactedStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactedFinish').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.impactBasis').optional({ nullable: true }).isString().trim(),
    body('activityLinks.*.notes').optional({ nullable: true }).isString().trim(),
    body('affectedActivityIds').optional().isArray(),
    body('affectedActivityIds.*').optional().isUUID(),
    body('allocationLinks').optional().isArray(),
    body('allocationLinks.*.allocationId').optional({ nullable: true }).isUUID(),
    body('allocationLinks.*.boqItemId').optional({ nullable: true }).isUUID(),
    body('allocationLinks.*.quantity').optional().isFloat({ min: 0 }).toFloat(),
    moneyBody('allocationLinks.*.amount'),
    body('allocationLinks.*.notes').optional({ nullable: true }).isString().trim(),
    body('correspondenceIds').optional().isArray(),
    body('correspondenceIds.*').optional().isUUID(),
    body('correspondenceLinks').optional().isArray(),
    body('correspondenceLinks.*.correspondenceId').optional().isUUID(),
    body('correspondenceLinks.*.relationType').optional().isString().trim(),
    body('attachmentRefs').optional().isArray(),
    body('attachmentRefs.*.documentId').optional({ nullable: true }).isUUID(),
    body('supportingDocumentIds').optional().isArray(),
    body('supportingDocumentIds.*').optional().isUUID(),
    body('documentIds').optional().isArray(),
    body('documentIds.*').optional().isUUID(),
    body('category').optional().isString().trim(),
    moneyBody('value'),
    body('status').optional().isIn(['pending', 'approved', 'rejected']),
    body('scheduleImpact').optional().isInt().toInt(),
    body('submittedDate').optional().isISO8601(),
    body('raisedBy').optional().isString().trim(),
    body('rejectedReason').optional().isString().trim(),
    body('approvalComment').optional({ nullable: true }).isString().trim().isLength({
      max: 2000,
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await changeOrderService.updateChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      coId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.delete(
  '/:id',
  requireRoles('pm'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    await changeOrderService.deleteChangeOrder({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      coId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
    });
    return sendSuccess(res, { deleted: true });
  }),
);

module.exports = router;
