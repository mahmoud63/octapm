const express = require('express');
const { body } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { HttpError } = require('../utils/http-error');
const { authenticate } = require('../middleware/auth');
const { billingLimiter } = require('../middleware/rate-limit');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const subscriptionService = require('../services/subscription.service');

const router = express.Router();
router.use(authenticate);
router.use(billingLimiter);

const handleStripeError = (err) => {
  if (err?.type === 'StripeCardError') {
    const declineMsg = 'Your card was declined. Please contact your card issuer.';
    return new HttpError(402, 'CARD_DECLINED', declineMsg);
  }
  return err;
};

router.get(
  '/subscription',
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.getCurrentSubscription(req.user.orgId);
    return sendSuccess(res, data);
  }),
);

router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.getPlansForOrg(req.user.orgId);
    return sendSuccess(res, data);
  }),
);

router.get(
  '/transactions',
  // Invoices are the company's money: the same door as subscribing, which
  // also checks an API key's scopes (Phase 21D, CX21-476).
  requireRoles('pm', 'finance'),
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.listInvoices(req.user.orgId);
    return sendSuccess(res, data);
  }),
);

router.post(
  '/trial/start',
  requireRoles('pm'),
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.startTrialSetup(req.user.orgId);
    return sendSuccess(res, data);
  }),
);

router.post(
  '/trial/confirm',
  requireRoles('pm'),
  [body('paymentMethodId').isString().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    try {
      const data = await subscriptionService.confirmTrial(
        req.user.orgId, req.body.paymentMethodId,
      );
      return sendSuccess(res, data);
    } catch (err) {
      throw handleStripeError(err);
    }
  }),
);

router.post(
  '/subscribe',
  requireRoles('pm'),
  [
    body('plan').isIn(['individual', 'business']),
    body('billingCycle').isIn(['monthly', 'annual']),
    body('paymentMethodId').optional().isString(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    try {
      const data = await subscriptionService.subscribe(
        req.user.orgId, req.body.plan, req.body.billingCycle, req.body.paymentMethodId,
      );
      return sendSuccess(res, data);
    } catch (err) {
      throw handleStripeError(err);
    }
  }),
);

router.post(
  '/cancel',
  requireRoles('pm'),
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.cancelSubscription(req.user.orgId);
    return sendSuccess(res, data);
  }),
);

router.post(
  '/enterprise-lead',
  requireRoles('pm'),
  [body('seatsBand').isIn(['lte_100', 'gt_100']), validate],
  asyncHandler(async (req, res) => {
    const data = await subscriptionService.createEnterpriseLead(
      req.user.orgId, req.body.seatsBand,
    );
    return sendSuccess(res, data, 201);
  }),
);

module.exports = router;
