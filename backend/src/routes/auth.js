const express = require('express');
const { body } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const authService = require('../services/auth.service');

const router = express.Router();

router.post(
  '/register',
  [
    body('orgName').optional().isString().trim().notEmpty(),
    body('name').isString().trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('password').isString().isLength({ min: 8 }),
    body('phone').optional().isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isString().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    return sendSuccess(res, result);
  }),
);

router.post(
  '/refresh',
  [body('refreshToken').isString().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    const result = await authService.refresh(req.body);
    return sendSuccess(res, result);
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await authService.getProfile({
      userId: req.user.id,
      orgId: req.user.orgId,
    });

    return sendSuccess(res, result);
  }),
);

module.exports = router;
