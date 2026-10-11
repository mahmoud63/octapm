const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { scalarFigure } = require("../utils/figure-input");
const { dateInput } = require("../utils/date-input");
const { authenticate } = require("../middleware/auth");
const { hasPermission, requirePermission } = require("../middleware/rbac");
const { lockIfIssued } = require("../middleware/external-review-lock");
const { validate } = require("../middleware/validate");
const service = require("../services/project-closeout.service");

/**
 * Project closeout / turnover (CLOSEOUT V1), mounted at
 * /projects/:projectId/closeout behind the project's own access check.
 * Reads need closeout:read (each readiness check also needs its own module);
 * deliverables are created, updated, submitted and approved through the
 * closeout actions; milestones, waivers and overrides are PM transitions.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId, viewer: service.viewerOf(req) });
const idParam = [param("deliverableId").isUUID()];

const deliverableFields = (partial) => [
  partial ? body("title").optional().isString().trim().isLength({ min: 1, max: 200 }) : body("title").isString().trim().isLength({ min: 1, max: 200 }),
  partial ? body("category").optional().isIn(service.CATEGORY_KEYS) : body("category").isIn(service.CATEGORY_KEYS),
  body("description").optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body("required").optional().isBoolean(),
  body("responsibleCompanyId").optional({ nullable: true }).isString().isUUID(),
  body("responsibleUserId").optional({ nullable: true }).isString().isUUID(),
  body("activityId").optional({ nullable: true }).isString().isUUID(),
  body("locationId").optional({ nullable: true }).isString().isUUID(),
  body("dueDate").optional({ nullable: true }).custom(dateInput),
  body("warrantyStart").optional({ nullable: true }).custom(dateInput),
  body("warrantyEnd").optional({ nullable: true }).custom(dateInput),
  body("warrantyMonths").optional({ nullable: true }).custom(scalarFigure).bail().isInt({ min: 0, max: 600 }),
];

router.get("/", requirePermission("closeout", "read"), asyncHandler(async (req, res) => sendSuccess(res, await service.overview(scope(req)))));

router.get("/deliverables", requirePermission("closeout", "read"), [query("status").optional().isIn(service.STATUSES), query("category").optional().isIn(service.CATEGORY_KEYS), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.listDeliverables({ ...scope(req), query: req.query }))));

router.get("/warranties", requirePermission("closeout", "read"), asyncHandler(async (req, res) => sendSuccess(res, await service.warranties(scope(req)))));

router.post("/deliverables", requirePermission("closeout", "create"), [...deliverableFields(false), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.createDeliverable({ ...scope(req), payload: req.body }), 201)));

router.post("/deliverables/standard", requirePermission("closeout", "create"), asyncHandler(async (req, res) => sendSuccess(res, await service.addStandardList(scope(req)), 201)));

router.get("/deliverables/:deliverableId", requirePermission("closeout", "read"), [...idParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.getDeliverable({ ...scope(req), id: req.params.deliverableId }))));

router.patch("/deliverables/:deliverableId", requirePermission("closeout", "update"), lockIfIssued("closeout_deliverable", "deliverableId"), [...idParam, ...deliverableFields(true), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.updateDeliverable({ ...scope(req), id: req.params.deliverableId, payload: req.body }))));

router.delete("/deliverables/:deliverableId", requirePermission("closeout", "delete"), [...idParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.deleteDeliverable({ ...scope(req), id: req.params.deliverableId }))));

router.post(
  "/deliverables/:deliverableId/submit",
  requirePermission("closeout", "submit"),
  [...idParam, body("documentIds").optional().isArray({ max: 50 }), body("documentIds.*").isString().isUUID(), body("note").optional({ nullable: true }).isString().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.submitDeliverable({ ...scope(req), id: req.params.deliverableId, documentIds: req.body.documentIds, note: req.body.note })))
);

router.post(
  "/deliverables/:deliverableId/review",
  requirePermission("closeout", "approve"),
  [...idParam, body("decision").isIn(["accept", "reject"]), body("comment").optional({ nullable: true }).isString().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.reviewDeliverable({ ...scope(req), id: req.params.deliverableId, decision: req.body.decision, comment: req.body.comment })))
);

router.post(
  "/deliverables/:deliverableId/waive",
  requirePermission("closeout", "update", { transition: "closeout.waive" }),
  [...idParam, body("status").isIn(["waived", "not_applicable"]), body("reason").isString().trim().isLength({ min: 1, max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.waiveDeliverable({ ...scope(req), id: req.params.deliverableId, status: req.body.status, reason: req.body.reason })))
);

router.post(
  "/deliverables/:deliverableId/reopen",
  requirePermission("closeout", "approve"),
  [...idParam, body("reason").isString().trim().isLength({ min: 1, max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.reopenDeliverable({ ...scope(req), id: req.params.deliverableId, reason: req.body.reason })))
);

router.post(
  "/checks/:key/waiver",
  requirePermission("closeout", "update", { transition: "closeout.waive" }),
  [param("key").isIn(service.CHECK_KEYS), body("reason").isString().trim().isLength({ min: 1, max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.setCheckWaiver({ ...scope(req), key: req.params.key, reason: req.body.reason })))
);

router.delete(
  "/checks/:key/waiver",
  requirePermission("closeout", "update", { transition: "closeout.waive" }),
  [param("key").isIn(service.CHECK_KEYS), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.setCheckWaiver({ ...scope(req), key: req.params.key, clear: true })))
);

router.post(
  "/milestones/reopen",
  requirePermission("closeout", "update", { transition: "closeout.milestone" }),
  [body("reason").isString().trim().isLength({ min: 1, max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.reopenMilestone({ ...scope(req), reason: req.body.reason })))
);

router.post(
  "/milestones/:milestone",
  requirePermission("closeout", "update", { transition: "closeout.milestone" }),
  [param("milestone").isIn(service.MILESTONES), body("date").optional({ nullable: true }).custom(dateInput), body("note").optional({ nullable: true }).isString().isLength({ max: 2000 }), body("override").optional({ nullable: true }).isString().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) =>
    sendSuccess(
      res,
      await service.recordMilestone({
        ...scope(req),
        milestone: req.params.milestone,
        date: req.body.date,
        note: req.body.note,
        override: req.body.override,
        canOverride: hasPermission(req, "closeout", "update", { transition: "closeout.override" }),
      })
    )
  )
);

module.exports = router;
