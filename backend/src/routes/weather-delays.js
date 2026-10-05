const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param } = require("express-validator");
const { scalarFigure, INT4_MAX } = require("../utils/figure-input");
const { dateInput } = require("../utils/date-input");
const { validate } = require("../middleware/validate");
const { requirePermission } = require("../middleware/rbac");
const {
  listWeatherDelays,
  createWeatherDelay,
  updateWeatherDelay,
  deleteWeatherDelay,
} = require("../services/weather.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
  requirePermission("eot", "read"),
  asyncHandler(async (req, res) => {
    const data = await listWeatherDelays({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
    });

    return sendSuccess(res, data);
  }),
);

router.post(
  "/",
  requirePermission("eot", "create"),
  [
    body("description").isString().trim().notEmpty(),
    body("date").optional().isString().custom(dateInput),
    body("delayDays").custom(scalarFigure).bail().isFloat({ min: 0, max: INT4_MAX }),
    body("contractual").optional().isBoolean(),
    body("affectedActivityIds").optional().isArray(),
    body("affectedActivityIds.*").optional().isString().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isString().isUUID(),
    body("activityLinks.*.delayStart").optional({ nullable: true }).isString().custom(dateInput),
    body("activityLinks.*.delayEnd").optional({ nullable: true }).isString().custom(dateInput),
    body("activityLinks.*.delayDays").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: INT4_MAX }),
    body("correspondenceIds").optional().isArray(),
    body("correspondenceIds.*").optional().isString().isUUID(),
    body("correspondenceLinks").optional().isArray(),
    body("correspondenceLinks.*.correspondenceId").optional().isString().isUUID(),
    body("attachmentRefs").optional().isArray(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await createWeatherDelay({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      payload: req.body,
    });

    return sendSuccess(res, row, 201);
  }),
);

router.patch(
  "/:weatherId",
  requirePermission("eot", "update"),
  [
    param("weatherId").isUUID(),
    body("date").optional().isString().custom(dateInput),
    body("delayDays").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: INT4_MAX }),
    body("contractual").optional().isBoolean(),
    body("affectedActivityIds").optional().isArray(),
    body("affectedActivityIds.*").optional().isString().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isString().isUUID(),
    body("activityLinks.*.delayStart").optional({ nullable: true }).isString().custom(dateInput),
    body("activityLinks.*.delayEnd").optional({ nullable: true }).isString().custom(dateInput),
    body("activityLinks.*.delayDays").optional().custom(scalarFigure).bail().isFloat({ min: 0, max: INT4_MAX }),
    body("correspondenceIds").optional().isArray(),
    body("correspondenceIds.*").optional().isString().isUUID(),
    body("correspondenceLinks").optional().isArray(),
    body("correspondenceLinks.*.correspondenceId").optional().isString().isUUID(),
    body("attachmentRefs").optional().isArray(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const row = await updateWeatherDelay({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      weatherId: req.params.weatherId,
      userId: req.user.id,
      payload: req.body,
    });

    return sendSuccess(res, row);
  }),
);

router.delete(
  "/:weatherId",
  requirePermission("eot", "update"),
  [param("weatherId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const data = await deleteWeatherDelay({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      weatherId: req.params.weatherId,
      userId: req.user.id,
    });

    return sendSuccess(res, data);
  }),
);

module.exports = router;
