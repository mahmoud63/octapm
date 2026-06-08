const express = require('express');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { getExtraServices } = require('../services/boq-calculation.service');

const router = express.Router();

// GET /api/v1/config/extra-services
router.get(
  '/extra-services',
  authenticate,
  asyncHandler(async (_req, res) => {
    const data = await getExtraServices();
    return sendSuccess(res, data);
  }),
);

module.exports = router;
