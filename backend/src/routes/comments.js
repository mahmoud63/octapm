const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const commentService = require("../services/comment.service");

/**
 * Comments on any record (OCTA-COMM-COMMENT-009). Anyone who can read the
 * record's module can read and add comments; editing is author-only and
 * removal is author / project manager / company admin.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const viewerFor = (req) => {
  const role = getEffectiveRole(req);
  return {
    id: req.user.id,
    name: req.user.name || null,
    role,
    canModerate: Boolean(req.user.isCompanyAdmin) || role === "pm",
  };
};

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

const mentionValidators = () => [
  body("mentionUserIds").optional().isArray({ max: commentService.MAX_MENTIONS }),
  body("mentionUserIds.*").isUUID(),
];

router.get(
  "/",
  [
    query("recordType").isIn(commentService.RECORD_TYPES),
    query("recordId").isString().trim().notEmpty(),
    query("cursor").optional().isString().trim().isLength({ max: 120 }),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
    query("order").optional().isIn(["asc", "desc"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    assertRecordRead(req, req.query.recordType);
    const result = await commentService.listComments({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      recordType: req.query.recordType,
      recordId: req.query.recordId,
      viewer: viewerFor(req),
      cursor: req.query.cursor || null,
      limit: req.query.limit || 50,
      order: req.query.order || "asc",
    });
    return sendSuccess(res, result);
  }),
);

router.post(
  "/",
  [
    body("recordType").isIn(commentService.RECORD_TYPES),
    body("recordId").isString().trim().notEmpty(),
    body("body").isString().trim().isLength({ min: 1, max: commentService.MAX_BODY_LENGTH }),
    body("parentId").optional({ nullable: true }).isUUID(),
    ...mentionValidators(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    assertRecordRead(req, req.body.recordType);
    const comment = await commentService.createComment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      recordType: req.body.recordType,
      recordId: req.body.recordId,
      body: req.body.body,
      mentionUserIds: req.body.mentionUserIds || [],
      parentId: req.body.parentId || null,
      actor: viewerFor(req),
    });
    return sendSuccess(res, comment, 201);
  }),
);

router.patch(
  "/:commentId",
  [
    param("commentId").isUUID(),
    body("body").optional().isString().trim().isLength({ min: 1, max: commentService.MAX_BODY_LENGTH }),
    ...mentionValidators(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const existing = await commentService.getComment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      commentId: req.params.commentId,
    });
    assertRecordRead(req, existing.recordType);
    const comment = await commentService.updateComment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      commentId: req.params.commentId,
      body: req.body.body,
      mentionUserIds: req.body.mentionUserIds,
      actor: viewerFor(req),
    });
    return sendSuccess(res, comment);
  }),
);

router.delete(
  "/:commentId",
  [param("commentId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const existing = await commentService.getComment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      commentId: req.params.commentId,
    });
    assertRecordRead(req, existing.recordType);
    const result = await commentService.deleteComment({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      commentId: req.params.commentId,
      actor: viewerFor(req),
    });
    return sendSuccess(res, result);
  }),
);

module.exports = router;
