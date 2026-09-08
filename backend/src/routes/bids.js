const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/bid.service");

/** Bid management on a project (OCTA-PRE-BID-027): `/projects/:projectId/bids`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({
  orgId: req.user.orgId,
  projectId: req.params.projectId,
  // Carried so ball-in-court can say "your action" instead of naming a role
  // the reader already holds.
  viewer: { id: req.user.id, role: getEffectiveRole(req) },
});
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
const read = requirePermission("bid", "read");
const write = requirePermission("bid", "update");
const publish = requirePermission("bid", "submit", { transition: "bid.publish" });
const answer = requirePermission("bid", "update", { transition: "bid.answer" });
const award = requirePermission("bid", "approve", { transition: "bid.award" });
const packageParam = param("packageId").isUUID();

const packageValidators = ({ requireTitle = false } = {}) => [
  requireTitle ? body("title").isString().trim().notEmpty().isLength({ max: 200 }) : body("title").optional().isString().trim().isLength({ min: 1, max: 200 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 4000 }),
  body("instructions").optional({ nullable: true }).isString().trim().isLength({ max: 8000 }),
  body("dueAt").optional({ nullable: true }).isISO8601(),
  body("questionsDueAt").optional({ nullable: true }).isISO8601(),
  body("currency").optional().isString().trim().isLength({ min: 3, max: 3 }),
  body("commitmentType").optional().isIn(service.COMMITMENT_TYPES),
  body("boqSections").optional().isArray({ max: 100 }),
  validate,
];

const lineValidators = ({ requireDescription = false } = {}) => [
  requireDescription ? body("description").isString().trim().notEmpty().isLength({ max: 500 }) : body("description").optional().isString().trim().isLength({ min: 1, max: 500 }),
  body("section").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body("code").optional({ nullable: true }).isString().trim().isLength({ max: 60 }),
  body("unit").optional({ nullable: true }).isString().trim().isLength({ max: 30 }),
  body("qty").optional().isFloat({ min: 0 }),
  body("estimateRate").optional({ nullable: true }).isFloat({ min: 0 }),
  body("budgetLineId").optional({ nullable: true }).isUUID(),
  body("costCodeId").optional({ nullable: true }).isUUID(),
  body("activityId").optional({ nullable: true }).isUUID(),
  body("boqItemId").optional({ nullable: true }).isUUID(),
  validate,
];

router.get("/boq-sections", read, asyncHandler(async (req, res) => sendSuccess(res, { items: await service.listBoqSections(scope(req)) })));

router.get(
  "/",
  read,
  [query("status").optional().isIn(Object.values(service.STATUS)), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await service.listPackages({ ...scope(req), status: req.query.status || null }) })),
);

router.post("/", requirePermission("bid", "create"), packageValidators({ requireTitle: true }), asyncHandler(async (req, res) => sendSuccess(res, await service.createPackage({ ...scope(req), payload: req.body, actor: actor(req) }), 201)));

router.get("/:packageId", read, [packageParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.getPackage({ ...scope(req), packageId: req.params.packageId }))));

router.patch("/:packageId", write, [packageParam, ...packageValidators()], asyncHandler(async (req, res) => sendSuccess(res, await service.updatePackage({ ...scope(req), packageId: req.params.packageId, payload: req.body, actor: actor(req) }))));

router.delete(
  "/:packageId",
  requirePermission("bid", "delete"),
  [packageParam, body("reason").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.cancelPackage({ ...scope(req), packageId: req.params.packageId, actor: actor(req), reason: req.body?.reason || null }))),
);

router.post(
  "/:packageId/lines/from-boq",
  write,
  [packageParam, body("sections").optional().isArray({ max: 100 }), body("boqItemIds").optional().isArray({ max: 500 }), body("boqItemIds.*").optional().isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.addLinesFromBoq({ ...scope(req), packageId: req.params.packageId, sections: req.body.sections || null, boqItemIds: req.body.boqItemIds || null, actor: actor(req) }))),
);

router.post("/:packageId/lines", write, [packageParam, ...lineValidators({ requireDescription: true })], asyncHandler(async (req, res) => sendSuccess(res, await service.addLine({ ...scope(req), packageId: req.params.packageId, payload: req.body, actor: actor(req) }), 201)));

router.patch("/:packageId/lines/:lineId", write, [packageParam, param("lineId").isUUID(), ...lineValidators()], asyncHandler(async (req, res) => sendSuccess(res, await service.updateLine({ ...scope(req), packageId: req.params.packageId, lineId: req.params.lineId, payload: req.body, actor: actor(req) }))));

router.delete("/:packageId/lines/:lineId", write, [packageParam, param("lineId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteLine({ ...scope(req), packageId: req.params.packageId, lineId: req.params.lineId, actor: actor(req) }))));

router.post(
  "/:packageId/invitations",
  write,
  [packageParam, body("invitations").isArray({ min: 1, max: 50 }), body("invitations.*.vendorCompanyId").optional({ nullable: true }).isUUID(), body("invitations.*.companyName").optional({ nullable: true }).isString().trim().isLength({ max: 200 }), body("invitations.*.contactName").optional({ nullable: true }).isString().trim().isLength({ max: 120 }), body("invitations.*.contactEmail").optional({ nullable: true }).isEmail(), body("prequalOverrideReason").optional({ nullable: true }).isString().trim().isLength({ max: 500 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await service.inviteBidders({ ...scope(req), packageId: req.params.packageId, invitations: req.body.invitations, prequalOverrideReason: req.body.prequalOverrideReason, actor: actor(req) }) }, 201)),
);

router.post("/:packageId/invitations/:invitationId/resend", write, [packageParam, param("invitationId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.resendInvitation({ ...scope(req), packageId: req.params.packageId, invitationId: req.params.invitationId, actor: actor(req) }))));

router.delete("/:packageId/invitations/:invitationId", write, [packageParam, param("invitationId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.removeInvitation({ ...scope(req), packageId: req.params.packageId, invitationId: req.params.invitationId, actor: actor(req) }))));

router.post("/:packageId/publish", publish, [packageParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.publishPackage({ ...scope(req), packageId: req.params.packageId, actor: actor(req) }))));

router.post("/:packageId/close", publish, [packageParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.closePackage({ ...scope(req), packageId: req.params.packageId, actor: actor(req) }))));

router.post("/:packageId/reopen", publish, [packageParam, body("dueAt").isISO8601(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.reopenPackage({ ...scope(req), packageId: req.params.packageId, dueAt: req.body.dueAt, actor: actor(req) }))));

router.post(
  "/:packageId/addenda",
  write,
  [packageParam, body("title").isString().trim().notEmpty().isLength({ max: 200 }), body("body").optional({ nullable: true }).isString().trim().isLength({ max: 8000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.issueAddendum({ ...scope(req), packageId: req.params.packageId, payload: req.body, actor: actor(req) }), 201)),
);

router.post(
  "/:packageId/questions/:questionId/answer",
  answer,
  [packageParam, param("questionId").isUUID(), body("answer").isString().trim().notEmpty().isLength({ max: 8000 }), body("shared").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.answerQuestion({ ...scope(req), packageId: req.params.packageId, questionId: req.params.questionId, payload: req.body, actor: actor(req) }))),
);

router.get("/:packageId/bids", read, [packageParam, validate], asyncHandler(async (req, res) => sendSuccess(res, { items: await service.listBids({ ...scope(req), packageId: req.params.packageId }) })));

router.get("/:packageId/leveling", read, [packageParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.leveling({ ...scope(req), packageId: req.params.packageId }))));

router.get(
  "/:packageId/leveling.xlsx",
  requirePermission("bid", "export"),
  [packageParam, validate],
  asyncHandler(async (req, res) => {
    const file = await service.levelingXlsx({ ...scope(req), packageId: req.params.packageId });
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    return res.send(file.buffer);
  }),
);

router.post("/:packageId/award", award, [packageParam, body("bidId").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.softAward({ ...scope(req), packageId: req.params.packageId, bidId: req.body.bidId, actor: actor(req) }))));

router.post("/:packageId/award/revoke", award, [packageParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.revokeSoftAward({ ...scope(req), packageId: req.params.packageId, actor: actor(req) }))));

router.post(
  "/:packageId/award/confirm",
  award,
  [packageParam, body("bidId").optional({ nullable: true }).isUUID(), body("title").optional({ nullable: true }).isString().trim().isLength({ max: 200 }), body("retentionRate").optional({ nullable: true }).isFloat({ min: 0, max: 100 }), body("startDate").optional({ nullable: true }).isISO8601(), body("endDate").optional({ nullable: true }).isISO8601(), body("prequalOverrideReason").optional({ nullable: true }).isString().trim().isLength({ max: 500 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.confirmAward({ ...scope(req), packageId: req.params.packageId, payload: req.body, actor: actor(req) }), 201)),
);

module.exports = router;
