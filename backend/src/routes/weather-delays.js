const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listWeatherDelays,
  createWeatherDelay,
  updateWeatherDelay,
  deleteWeatherDelay,
} = require('../services/weather.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listWeatherDelays({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/',
  [
    body('description').trim().notEmpty(),
    body('date').optional().isISO8601(),
    body('delayDays').isFloat({ min: 0 }),
    body('contractual').optional().isBoolean(),
    body('affectedActivityIds').optional().isArray(),
    body('affectedActivityIds.*').optional().isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('activityLinks.*.delayStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.delayEnd').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.delayDays').optional().isFloat({ min: 0 }),
    body('correspondenceIds').optional().isArray(),
    body('correspondenceIds.*').optional().isUUID(),
    body('correspondenceLinks').optional().isArray(),
    body('correspondenceLinks.*.correspondenceId').optional().isUUID(),
    body('attachmentRefs').optional().isArray(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createWeatherDelay({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        userId: req.user.id,
        payload: req.body,
      });

      return res.status(201).json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  '/:weatherId',
  [
    param('weatherId').isUUID(),
    body('date').optional().isISO8601(),
    body('delayDays').optional().isFloat({ min: 0 }),
    body('contractual').optional().isBoolean(),
    body('affectedActivityIds').optional().isArray(),
    body('affectedActivityIds.*').optional().isUUID(),
    body('activityLinks').optional().isArray(),
    body('activityLinks.*.activityId').optional().isUUID(),
    body('activityLinks.*.delayStart').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.delayEnd').optional({ nullable: true }).isISO8601(),
    body('activityLinks.*.delayDays').optional().isFloat({ min: 0 }),
    body('correspondenceIds').optional().isArray(),
    body('correspondenceIds.*').optional().isUUID(),
    body('correspondenceLinks').optional().isArray(),
    body('correspondenceLinks.*.correspondenceId').optional().isUUID(),
    body('attachmentRefs').optional().isArray(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateWeatherDelay({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        weatherId: req.params.weatherId,
        userId: req.user.id,
        payload: req.body,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:weatherId',
  [param('weatherId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteWeatherDelay({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        weatherId: req.params.weatherId,
        userId: req.user.id,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
