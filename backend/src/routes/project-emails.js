const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/inbound-email.service");

/** Project emails (OCTA-COMM-CONV-042): `/projects/:projectId/emails` — the inbox behind p-<token>@<domain>. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actorFor = (req) => {
  const role = getEffectiveRole(req);
  return { id: req.user.id, name: req.user.name || null, role, isCompanyAdmin: Boolean(req.user.isCompanyAdmin), canModerate: Boolean(req.user.isCompanyAdmin) || role === "pm", projectAccess: req.projectAccess || null };
};
const idParam = [param("emailId").isUUID()];

router.get("/", requirePermission("email", "read"), [query("status").optional().isIn(Object.values(service.STATUS)), query("target").optional().isIn(["project", "record", "conversation"]), query("q").optional().isString().isLength({ max: 200 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listInbox({ ...scope(req), query: req.query }))));
router.get("/settings", requirePermission("email", "read"), asyncHandler(async (req, res) => sendSuccess(res, await service.projectSettings(scope(req)))));
router.patch("/settings", requirePermission("email", "update", { transition: "email.settings" }), [body("autoLog").optional().isBoolean(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateProjectSettings({ ...scope(req), payload: req.body, actor: actorFor(req) }))));
router.post("/settings/rotate", requirePermission("email", "update", { transition: "email.settings" }), asyncHandler(async (req, res) => sendSuccess(res, await service.rotateProjectAddress({ ...scope(req), actor: actorFor(req) }))));
router.get("/:emailId", requirePermission("email", "read"), [...idParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.getEmail({ ...scope(req), emailId: req.params.emailId }))));
router.post("/:emailId/log", requirePermission("email", "update"), [...idParam, body("type").optional().isIn(["email", "letter", "memo", "notice"]), body("contractualNotice").optional().isBoolean(), body("responseRequiredBy").optional({ nullable: true }).isISO8601(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.logAsCorrespondence({ ...scope(req), emailId: req.params.emailId, payload: req.body, actor: actorFor(req) }))));
router.post("/:emailId/post", requirePermission("email", "update"), [...idParam, body("recordType").isString().isLength({ min: 1, max: 60 }), body("recordId").isString().isLength({ min: 1, max: 120 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.postToRecord({ ...scope(req), emailId: req.params.emailId, payload: req.body, actor: actorFor(req) }))));
router.post("/:emailId/conversation", requirePermission("email", "update"), [...idParam, body("memberUserIds").optional().isArray({ max: 200 }), body("memberUserIds.*").isUUID(), body("title").optional({ nullable: true }).isString().isLength({ max: 200 }), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.startConversation({ ...scope(req), emailId: req.params.emailId, payload: req.body, actor: actorFor(req) }), 201)));
router.post("/:emailId/ignore", requirePermission("email", "update"), [...idParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.ignoreEmail({ ...scope(req), emailId: req.params.emailId, actor: actorFor(req) }))));
router.delete("/:emailId", requirePermission("email", "delete"), [...idParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteEmail({ ...scope(req), emailId: req.params.emailId, actor: actorFor(req) }))));

module.exports = router;
