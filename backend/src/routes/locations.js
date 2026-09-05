const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const locationService = require("../services/location.service");

const router = express.Router({ mergeParams: true });
router.use(authenticate);

const locationPayloadValidators = ({ requireName = false } = {}) => [
  requireName
    ? body("name").isString().trim().isLength({ min: 1, max: 120 })
    : body("name").optional().isString().trim().isLength({ min: 1, max: 120 }),
  body("code").optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
  body("kind").optional().isIn(locationService.LOCATION_KINDS),
  body("description")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 1000 }),
  body("parentId").optional({ nullable: true }).isUUID(),
  body("sortOrder").optional({ nullable: true }).isInt({ min: 0 }).toInt(),
  validate,
];

const reasonValidators = [
  param("id").isUUID(),
  body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  validate,
];

router.get(
  "/",
  requirePermission("location", "read"),
  [query("includeArchived").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => {
    const result = await locationService.listLocations({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      query: req.query,
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/",
  requirePermission("location", "create"),
  locationPayloadValidators({ requireName: true }),
  asyncHandler(async (req, res) => {
    const result = await locationService.createLocation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result, 201);
  }),
);

router.post(
  "/reorder",
  requirePermission("location", "update"),
  [
    body("parentId").optional({ nullable: true }).isUUID(),
    body("orderedIds").isArray({ min: 1 }),
    body("orderedIds.*").isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await locationService.reorderLocations({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.patch(
  "/:id",
  requirePermission("location", "update"),
  [param("id").isUUID(), ...locationPayloadValidators()],
  asyncHandler(async (req, res) => {
    const result = await locationService.updateLocation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      locationId: req.params.id,
      payload: req.body,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/archive",
  requirePermission("location", "delete", { transition: "location.archive" }),
  reasonValidators,
  asyncHandler(async (req, res) => {
    const result = await locationService.archiveLocation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      locationId: req.params.id,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/:id/restore",
  requirePermission("location", "delete", { transition: "location.restore" }),
  reasonValidators,
  asyncHandler(async (req, res) => {
    const result = await locationService.restoreLocation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      locationId: req.params.id,
      reason: req.body.reason,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

router.delete(
  "/:id",
  requirePermission("location", "delete", { transition: "location.archive" }),
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await locationService.archiveLocation({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      locationId: req.params.id,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
