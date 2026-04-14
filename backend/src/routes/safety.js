const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listSafetyIncidents,
  createSafetyIncident,
  updateSafetyIncident,
  deleteSafetyIncident,
} = require('../services/safety.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listSafetyIncidents({
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
    body('incidentType').isIn(['near_miss', 'first_aid', 'lti', 'fatality']),
    body('title').trim().notEmpty(),
    body('date').optional().isISO8601(),
    body('lostDays').optional().isInt({ min: 0 }),
    body('status').optional().isIn(['open', 'investigating', 'closed']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createSafetyIncident({
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
  '/:incidentId',
  [
    param('incidentId').isUUID(),
    body('incidentType')
      .optional()
      .isIn(['near_miss', 'first_aid', 'lti', 'fatality']),
    body('date').optional().isISO8601(),
    body('lostDays').optional().isInt({ min: 0 }),
    body('status').optional().isIn(['open', 'investigating', 'closed']),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateSafetyIncident({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        incidentId: req.params.incidentId,
        payload: req.body,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:incidentId',
  [param('incidentId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteSafetyIncident({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        incidentId: req.params.incidentId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
