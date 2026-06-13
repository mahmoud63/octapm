const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { body, param } = require("express-validator");
const { validate } = require("../middleware/validate");
const {
  listWeatherDelays,
  createWeatherDelay,
  updateWeatherDelay,
  deleteWeatherDelay,
} = require("../services/weather.service");

const router = express.Router({ mergeParams: true });

router.get(
  "/",
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
  [
    body("description").trim().notEmpty(),
    body("date").optional().isISO8601(),
    body("delayDays").isFloat({ min: 0 }),
    body("contractual").optional().isBoolean(),
    body("affectedActivityIds").optional().isArray(),
    body("affectedActivityIds.*").optional().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("activityLinks.*.delayStart").optional({ nullable: true }).isISO8601(),
    body("activityLinks.*.delayEnd").optional({ nullable: true }).isISO8601(),
    body("activityLinks.*.delayDays").optional().isFloat({ min: 0 }),
    body("correspondenceIds").optional().isArray(),
    body("correspondenceIds.*").optional().isUUID(),
    body("correspondenceLinks").optional().isArray(),
    body("correspondenceLinks.*.correspondenceId").optional().isUUID(),
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
  [
    param("weatherId").isUUID(),
    body("date").optional().isISO8601(),
    body("delayDays").optional().isFloat({ min: 0 }),
    body("contractual").optional().isBoolean(),
    body("affectedActivityIds").optional().isArray(),
    body("affectedActivityIds.*").optional().isUUID(),
    body("activityLinks").optional().isArray(),
    body("activityLinks.*.activityId").optional().isUUID(),
    body("activityLinks.*.delayStart").optional({ nullable: true }).isISO8601(),
    body("activityLinks.*.delayEnd").optional({ nullable: true }).isISO8601(),
    body("activityLinks.*.delayDays").optional().isFloat({ min: 0 }),
    body("correspondenceIds").optional().isArray(),
    body("correspondenceIds.*").optional().isUUID(),
    body("correspondenceLinks").optional().isArray(),
    body("correspondenceLinks.*.correspondenceId").optional().isUUID(),
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
