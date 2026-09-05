const express = require("express");
const { body, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { hasPermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const commentService = require("../services/comment.service");

/**
 * Record subscriptions ("follow this record", OCTA-COMM-COMMENT-009).
 * Followers receive comment notifications; reading the record's module is
 * enough to follow it.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const assertRecordRead = (req, recordType) => {
  const moduleName = commentService.moduleForRecordType(recordType);
  if (!hasPermission(req, moduleName, "read")) {
    const forbidden = new HttpError(
      403,
      "FORBIDDEN",
      "You do not have permission to view this record",
    );
    forbidden.details = { module: moduleName, action: "read" };
    throw forbidden;
  }
  return moduleName;
};

router.get(
  "/mine",
  [query("limit").optional().isInt({ min: 1, max: 500 }).toInt(), validate],
  asyncHandler(async (req, res) => {
    const result = await commentService.listMySubscriptions({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      limit: req.query.limit || 100,
    });
    return sendSuccess(res, result);
  }),
);

router.get(
  "/",
  [
    query("recordType").isIn(commentService.RECORD_TYPES),
    query("recordId").isString().trim().notEmpty(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    assertRecordRead(req, req.query.recordType);
    const result = await commentService.getSubscriptionState({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      recordType: req.query.recordType,
      recordId: req.query.recordId,
      userId: req.user.id,
    });
    return sendSuccess(res, result);
  }),
);

router.put(
  "/",
  [
    body("recordType").isIn(commentService.RECORD_TYPES),
    body("recordId").isString().trim().notEmpty(),
    body("follow").isBoolean().toBoolean(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    assertRecordRead(req, req.body.recordType);
    const result = await commentService.setSubscription({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      recordType: req.body.recordType,
      recordId: req.body.recordId,
      userId: req.user.id,
      follow: req.body.follow,
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
