const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission, noApiKey } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/conversation.service");

/** Conversations (OCTA-COMM-CONV-042): `/conversations` — organisation-wide, optionally scoped to a project. */
const router = express.Router();
router.use(authenticate);
// Conversations are between people; a key acting as a member would read and
// write them far outside its own projects (Phase 21D, CX21-452).
router.use(noApiKey);

const viewerFor = (req) => {
  const role = getEffectiveRole(req);
  return { id: req.user.id, name: req.user.name || null, role, isCompanyAdmin: Boolean(req.user.isCompanyAdmin), canModerate: Boolean(req.user.isCompanyAdmin) || role === "pm" };
};
const idParam = [param("conversationId").isUUID()];
const optionalText = (field, max) => body(field).optional({ nullable: true }).isString().isLength({ max });
const linkedRecordValidators = [
  body("linkedRecord").optional({ nullable: true }).isObject(),
  body("linkedRecord.recordType").optional().isString().isLength({ max: 60 }),
  body("linkedRecord.recordId").optional().isString().isLength({ max: 120 }),
  body("linkedRecord.projectId").optional({ nullable: true }).isString().isUUID(),
  body("linkedRecord.title").optional({ nullable: true }).isString().isLength({ max: 300 }),
];

router.get("/", requirePermission("conversation", "read"), [query("projectId").isString().optional().isUUID(), query("filter").isString().optional().isIn(["all", "unread", "starred", "archived"]), query("q").optional().isString().isLength({ max: 120 }), query("limit").isString().optional().isInt({ min: 1, max: 200 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listConversations({ orgId: req.user.orgId, viewer: viewerFor(req), query: req.query }))));
router.get("/unread", requirePermission("conversation", "read"), asyncHandler(async (req, res) => sendSuccess(res, await service.unreadSummary({ orgId: req.user.orgId, viewer: viewerFor(req) }))));
router.get("/people", requirePermission("conversation", "read"), [query("projectId").isString().optional().isUUID(), query("q").optional().isString().isLength({ max: 120 }), query("limit").isString().optional().isInt({ min: 1, max: 200 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listPeople({ orgId: req.user.orgId, projectId: req.query.projectId || null, q: req.query.q || null, limit: req.query.limit, viewer: viewerFor(req) }))));
router.post("/", requirePermission("conversation", "create"), [body("kind").optional().isIn(service.KINDS), body("projectId").optional({ nullable: true }).isString().isUUID(), optionalText("title", 200), body("memberUserIds").optional().isArray({ max: service.MAX_MEMBERS }), body("memberUserIds.*").isString().isUUID(), body("recordType").optional({ nullable: true }).isString().isLength({ max: 60 }), body("recordId").optional({ nullable: true }).isString().isLength({ max: 120 }), optionalText("message", service.MAX_BODY_LENGTH), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.createConversation({ orgId: req.user.orgId, viewer: viewerFor(req), payload: req.body }), 201)));
router.get("/:conversationId", requirePermission("conversation", "read"), [...idParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.getConversation({ orgId: req.user.orgId, viewer: viewerFor(req), conversationId: req.params.conversationId }))));
router.patch("/:conversationId", requirePermission("conversation", "update"), [...idParam, optionalText("title", 200), body("archived").optional().isBoolean(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateConversation({ orgId: req.user.orgId, viewer: viewerFor(req), conversationId: req.params.conversationId, payload: req.body }))));
router.post("/:conversationId/members", requirePermission("conversation", "update"), [...idParam, body("userIds").isArray({ min: 1, max: service.MAX_MEMBERS }), body("userIds.*").isString().isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.addMembers({ orgId: req.user.orgId, viewer: viewerFor(req), conversationId: req.params.conversationId, userIds: req.body.userIds }))));
router.delete("/:conversationId/members/:userId", requirePermission("conversation", "update"), [...idParam, param("userId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.removeMember({ orgId: req.user.orgId, viewer: viewerFor(req), conversationId: req.params.conversationId, userId: req.params.userId }))));
router.patch("/:conversationId/me", requirePermission("conversation", "read"), [...idParam, body("starred").optional().isBoolean(), body("muted").optional().isBoolean(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.setMemberFlags({ orgId: req.user.orgId, viewer: viewerFor(req), conversationId: req.params.conversationId, payload: req.body }))));
router.post("/:conversationId/read", requirePermission("conversation", "read"), [...idParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.markRead({ orgId: req.user.orgId, viewer: viewerFor(req), conversationId: req.params.conversationId }))));
router.get("/:conversationId/messages", requirePermission("conversation", "read"), [...idParam, query("cursor").isString().optional().isUUID(), query("limit").isString().optional().isInt({ min: 1, max: 200 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listMessages({ orgId: req.user.orgId, viewer: viewerFor(req), conversationId: req.params.conversationId, cursor: req.query.cursor || null, limit: req.query.limit }))));
router.post("/:conversationId/messages", requirePermission("conversation", "update"), [...idParam, optionalText("body", service.MAX_BODY_LENGTH), body("mentionUserIds").optional().isArray({ max: service.MAX_MENTIONS }), body("mentionUserIds.*").isString().isUUID(), ...linkedRecordValidators, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.sendMessage({ orgId: req.user.orgId, viewer: viewerFor(req), conversationId: req.params.conversationId, payload: req.body }), 201)));
router.patch("/:conversationId/messages/:messageId", requirePermission("conversation", "update"), [...idParam, param("messageId").isUUID(), body("body").isString().isLength({ min: 1, max: service.MAX_BODY_LENGTH }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.editMessage({ orgId: req.user.orgId, viewer: viewerFor(req), conversationId: req.params.conversationId, messageId: req.params.messageId, body: req.body.body }))));
router.delete("/:conversationId/messages/:messageId", requirePermission("conversation", "update"), [...idParam, param("messageId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteMessage({ orgId: req.user.orgId, viewer: viewerFor(req), conversationId: req.params.conversationId, messageId: req.params.messageId }))));

module.exports = router;
