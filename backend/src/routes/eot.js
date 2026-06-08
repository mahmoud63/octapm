const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
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

    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/calculate',
  [
    body('eventName').trim().notEmpty(),
    body('delayDays').isFloat({ min: 0 }),
    body('eotDaysGranted').optional().isFloat({ min: 0 }),
    body('ldRatePerDay').optional().isFloat({ min: 0 }),
    body('affectedActivityIds').optional().isArray(),
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
        analysis: req.body.analysis,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/',
  [
    body('eventName').trim().notEmpty(),
    body('delayDays').isFloat({ min: 0 }),
    body('eotDaysGranted').optional().isFloat({ min: 0 }),
    body('ldRatePerDay').optional().isFloat({ min: 0 }),
    body('affectedActivityIds').optional().isArray(),
    body('status')
      .optional()
      .isIn(['draft', 'submitted', 'approved', 'rejected']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createEotClaim({
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
  '/:claimId',
  [
    param('claimId').isUUID(),
    body('status')
      .optional()
      .isIn(['draft', 'submitted', 'approved', 'rejected']),
    body('eotDaysGranted').optional().isFloat({ min: 0 }),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateEotClaim({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        claimId: req.params.claimId,
        payload: req.body,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
