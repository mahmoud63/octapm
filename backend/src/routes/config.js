const express = require('express');
const { body } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireCompanyAdmin } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { getExtraServices, setExtraServices } = require('../services/boq-calculation.service');
const { getPublicConfig } = require('../config/registration');

const router = express.Router();

// GET /api/v1/config/public
// No authentication: the sign-in and sign-up screens read it before anyone
// has a session. It says only whether self-service registration is open.
router.get('/public', (_req, res) => sendSuccess(res, getPublicConfig()));

// GET /api/v1/config/extra-services
// The caller's organisation's rows, or the platform defaults when it has none
// (wave ENT-3: the table is owned per organisation).
router.get(
  '/extra-services',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await getExtraServices({ orgId: req.user.orgId });
    return sendSuccess(res, data);
  }),
);

// PUT /api/v1/config/extra-services
// Replaces the organisation's list. Company administration only: the
// percentages change every bill's totals in the workspace.
router.put(
  '/extra-services',
  authenticate,
  requireCompanyAdmin,
  [
    body('services').isArray({ max: 20 }).withMessage('services must be a list of at most 20 entries'),
    body('services.*.label').isString().trim().isLength({ min: 1, max: 80 }),
    body('services.*.percentage').isFloat({ min: 0, max: 1000 }).toFloat(),
    body('services').custom((services) => {
      const labels = services.map((service) => String(service?.label ?? '').trim().toLowerCase());
      if (new Set(labels).size !== labels.length) throw new Error('labels must be unique');
      return true;
    }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const data = await setExtraServices({ orgId: req.user.orgId, services: req.body.services });
    return sendSuccess(res, data);
  }),
);

module.exports = router;
