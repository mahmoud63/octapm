const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const commentService = require("../services/comment.service");
const documentTextService = require("../services/document-text.service");
const { isPartyScopedAccess } = require("../services/company-party.service");
const { scopeAllows } = require("../services/api-client.service");

/**
 * Comments on any record (OCTA-COMM-COMMENT-009). Anyone who can read the
 * record's module can read and add comments; editing is author-only and
 * removal is author / project manager / company admin.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const viewerFor = (req) => {
  const role = getEffectiveRole(req);
  const partyScoped = isPartyScopedAccess(req.projectAccess || {});
  const parties = req.projectAccess?.partyAccess || [];
  return {
    id: req.user.id,
    userId: req.user.id,
    name: req.user.name || null,
    role,
    canModerate: Boolean(req.user.isCompanyAdmin) || role === "pm",
    canRead: (moduleName) => hasPermission(req, moduleName, "read"),
    partyIds: partyScoped ? parties.map((party) => party.projectPartyId).filter(Boolean) : null,
    companyIds: partyScoped ? [...new Set(parties.map((party) => party.companyId).filter(Boolean))] : null,
  };
};

// A party-scoped person reads and writes comments only on a record their own
// rule admits — the module alone let a subcontractor read another's RFI
// discussion (Phase 21D, CX21-555).
const assertRecordVisible = async (req, recordType, recordId) => {
  if (!(await documentTextService.recordVisibleToViewer({ recordType, recordId, viewer: viewerFor(req) }))) {
    throw new HttpError(404, "COMMENT_RECORD_NOT_FOUND", "Record not found");
  }
};

// A read-only key could post a comment because the write route asked only for
// read; a key posting, editing or removing a comment needs a write scope on
// the record's module (Phase 21D, CX21-555).
const assertKeyMayWrite = (req, recordType) => {
  if (!req.apiClient) return;
  const moduleName = commentService.moduleForRecordType(recordType);
  if (!scopeAllows(req.apiClient, moduleName, "update") && !scopeAllows(req.apiClient, moduleName, "create")) {
    const forbidden = new HttpError(403, "FORBIDDEN", "This API key cannot post comments on this record");
    forbidden.details = { module: moduleName, action: "write" };
    throw forbidden;
  }
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
  body("mentionUserIds.*").isString().isUUID(),
];

router.get(
  "/",
  [
    query("recordType").isString().isIn(commentService.RECORD_TYPES),
    query("recordId").isString().trim().notEmpty(),
    query("cursor").optional().isString().trim().isLength({ max: 120 }),
    query("limit").isString().optional().isInt({ min: 1, max: 200 }).toInt(),
    query("order").isString().optional().isIn(["asc", "desc"]),
    validate,
  ],
  asyncHandler(async (req, res) => {
    assertRecordRead(req, req.query.recordType);
    await assertRecordVisible(req, req.query.recordType, req.query.recordId);
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
    body("parentId").optional({ nullable: true }).isString().isUUID(),
    ...mentionValidators(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    assertRecordRead(req, req.body.recordType);
    assertKeyMayWrite(req, req.body.recordType);
    await assertRecordVisible(req, req.body.recordType, req.body.recordId);
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
    assertKeyMayWrite(req, existing.recordType);
    await assertRecordVisible(req, existing.recordType, existing.recordId);
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
    assertKeyMayWrite(req, existing.recordType);
    await assertRecordVisible(req, existing.recordType, existing.recordId);
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
