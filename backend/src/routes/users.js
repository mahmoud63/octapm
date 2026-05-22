const express = require('express');
const { body, param, query } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const userService = require('../services/user.service');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  requireRoles('pm', 'planning_eng', 'qs'),
  [
    query('cursor').optional().isUUID(),
    query('status').optional().isIn(['active', 'inactive']),
    query('role').optional().isString(),
    query('search').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userService.listUsers({
      orgId: req.user.orgId,
      query: req.query,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/',
  requireRoles('pm'),
  [
    body('name').isString().trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('password')
      .isString()
      .isLength({ min: 8 })
      .matches(/[a-z]/)
      .withMessage('Password must contain a lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain a number'),
    body('phone').optional().isString().trim(),
    body('role').optional().isString(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userService.createUser({
      orgId: req.user.orgId,
      payload: req.body,
    });
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  '/:id',
  requireRoles('pm', 'planning_eng', 'qs'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await userService.getUserById({
      orgId: req.user.orgId,
      userId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  '/:id',
  requireRoles('pm'),
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty(),
    body('email').optional().isEmail().normalizeEmail(),
    body('phone').optional().isString().trim(),
    body('role').optional().isString(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userService.updateUser({
      orgId: req.user.orgId,
      userId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  '/:id/reset-password',
  requireRoles('pm'),
  [
    param('id').isUUID(),
    body('newPassword')
      .isString()
      .isLength({ min: 8 })
      .matches(/[a-z]/)
      .withMessage('Password must contain a lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain a number'),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userService.resetPassword({
      orgId: req.user.orgId,
      userId: req.params.id,
      newPassword: req.body.newPassword,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  '/:id/deactivate',
  requireRoles('pm'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await userService.deactivateUser({
      orgId: req.user.orgId,
      userId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  '/:id/activate',
  requireRoles('pm'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await userService.activateUser({
      orgId: req.user.orgId,
      userId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
