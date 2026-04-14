const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  listTransmittals,
  createTransmittal,
  updateTransmittal,
  deleteTransmittal,
} = require('../services/transmittal.service');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const data = await listTransmittals({
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
    body('subject').trim().notEmpty(),
    body('sender').trim().notEmpty(),
    body('recipient').trim().notEmpty(),
    body('method').optional().isIn(['email', 'courier', 'hand']),
    body('status').optional().isIn(['pending_ack', 'acknowledged']),
    body('transmittedOn').optional().isISO8601(),
    body('acknowledgedOn').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await createTransmittal({
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
  '/:transmittalId',
  [
    param('transmittalId').isUUID(),
    body('method').optional().isIn(['email', 'courier', 'hand']),
    body('status').optional().isIn(['pending_ack', 'acknowledged']),
    body('transmittedOn').optional().isISO8601(),
    body('acknowledgedOn').optional().isISO8601(),
    validate,
  ],
  async (req, res, next) => {
    try {
      const row = await updateTransmittal({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        transmittalId: req.params.transmittalId,
        payload: req.body,
      });

      return res.json({ success: true, data: row });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/:transmittalId',
  [param('transmittalId').isUUID(), validate],
  async (req, res, next) => {
    try {
      const data = await deleteTransmittal({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
        transmittalId: req.params.transmittalId,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
