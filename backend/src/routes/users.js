const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { subscriptionGate } = require("../middleware/subscription-gate");
const { validate } = require("../middleware/validate");
const userService = require("../services/user.service");
const { disconnectUser } = require("../realtime/socket");

const router = express.Router();
router.use(authenticate);
router.use(subscriptionGate);

const getRequestContext = (req) => ({
  userAgent: req.get("user-agent") || null,
  ipAddress: req.ip || req.socket?.remoteAddress || null,
});

router.get(
  "/",
  requirePermission("user_management", "read"),
  [
    query("cursor").optional().isUUID(),
    query("status").optional().isIn(["active", "inactive"]),
    query("role").optional().isString(),
    query("search").optional().isString().trim(),
    query("sortBy").optional().isIn(["name", "email", "projects", "created"]),
    query("sortDir").optional().isIn(["asc", "desc"]),
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
  "/",
  requirePermission("user_management", "create"),
  [
    body("name").isString().trim().notEmpty(),
    body("email").isEmail().normalizeEmail(),
    body("password")
      .isString()
      .isLength({ min: 8 })
      .matches(/[a-z]/)
      .withMessage("Password must contain a lowercase letter")
      .matches(/[0-9]/)
      .withMessage("Password must contain a number"),
    body("phone").optional().isString().trim(),
    body("role").optional().isString(),
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

router.post(
  "/invitations",
  requirePermission("user_management", "submit", {
    transition: "user.invite",
  }),
  [
    body("email").isEmail().normalizeEmail(),
    body("role").isString().trim().notEmpty(),
    body("projectId").optional({ values: "falsy" }).isUUID(),
    body("companyId").optional({ values: "falsy" }).isUUID(),
    body("projectPartyId").optional({ values: "falsy" }).isUUID(),
    body("projectPartyId").custom((value, { req }) => {
      if (!value || req.body.projectId) return true;
      throw new Error("projectId is required when projectPartyId is provided");
    }),
    body("note").optional().isString().trim().isLength({ max: 1000 }),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userService.inviteUser({
      orgId: req.user.orgId,
      actor: req.user,
      payload: req.body,
      context: getRequestContext(req),
    });
    return sendSuccess(res, result, 201);
  }),
);

router.get(
  "/:id",
  requirePermission("user_management", "read"),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await userService.getUserById({
      orgId: req.user.orgId,
      userId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  "/:id",
  requirePermission("user_management", "update", {
    transition: "user.assign_role",
  }),
  [
    param("id").isUUID(),
    body("name").optional().isString().trim().notEmpty(),
    body("email").optional().isEmail().normalizeEmail(),
    body("phone").optional().isString().trim(),
    body("role").optional().isString(),
    body("isCompanyAdmin").optional().isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const before = await userService.getUserById({ orgId: req.user.orgId, userId: req.params.id });
    const result = await userService.updateUser({
      orgId: req.user.orgId,
      userId: req.params.id,
      payload: req.body,
    });
    // A changed role or standing reaches their open sockets too (Phase 21D,
    // CX21-491) — a change, not an edit that repeats the same values (the
    // tenth pass's note).
    if (before.role !== result.role || Boolean(before.isCompanyAdmin) !== Boolean(result.isCompanyAdmin)) disconnectUser(req.app.get("io"), req.params.id);
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/reset-password",
  requirePermission("user_management", "update", {
    transition: "user.reset_password",
  }),
  [
    param("id").isUUID(),
    body("newPassword")
      .isString()
      .isLength({ min: 8 })
      .matches(/[a-z]/)
      .withMessage("Password must contain a lowercase letter")
      .matches(/[0-9]/)
      .withMessage("Password must contain a number"),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await userService.resetPassword({
      orgId: req.user.orgId,
      userId: req.params.id,
      newPassword: req.body.newPassword,
      actor: req.user,
      context: getRequestContext(req),
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  "/:id/deactivate",
  requirePermission("user_management", "update", {
    transition: "user.deactivate",
  }),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await userService.deactivateUser({
      orgId: req.user.orgId,
      userId: req.params.id,
    });
    disconnectUser(req.app.get("io"), req.params.id); // their sockets go with the account (CX21-491)
    return sendSuccess(res, result);
  }),
);

router.patch(
  "/:id/activate",
  requirePermission("user_management", "update", {
    transition: "user.activate",
  }),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await userService.activateUser({
      orgId: req.user.orgId,
      userId: req.params.id,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
