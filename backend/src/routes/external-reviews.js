const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { dateInput } = require("../utils/date-input");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/external-review.service");
const sources = require("../services/external-review-sources");

/**
 * External review / consultant portal (CONSULTANT V1), mounted at
 * /projects/:projectId/external-reviews behind the project's own access
 * check. Every route needs external_review:read; the service then scopes
 * each read to the caller (their party's submissions for a consultant) and
 * each write to its side, its permission and — for a decision — the
 * responsible reviewer.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);
router.use(requirePermission("external_review", "read"));

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId, viewer: service.viewerOf(req) });
const idParam = [param("id").isUUID()];
const reason = (field = "reason") => body(field).isString().trim().isLength({ min: 1, max: 2000 });
const filters = [
  query("status").optional().isIn(["open", "awaiting", "returned", "responded", "closed", "all", ...Object.values(service.STATUS)]),
  query("sourceType").optional().isIn(sources.SOURCE_TYPES),
  query(["partyId", "reviewerId"]).optional().isString().isUUID(),
  query("overdue").optional().isIn(["true", "false"]),
  query("action").optional().isIn(["consultant", "contractor"]),
  query("discipline").optional().isString().isLength({ max: 40 }),
  query(["dueFrom", "dueTo", "submittedFrom", "submittedTo"]).optional().isString().custom(dateInput),
  query("q").optional().isString().isLength({ max: 200 }),
  query("sort").optional().isIn(["priority", "oldest", "newest", "due", "overdue"]),
];

router.get("/", [...filters, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.list({ ...scope(req), query: req.query }))));

router.get("/summary", asyncHandler(async (req, res) => sendSuccess(res, await service.summary(scope(req)))));

router.get(
  "/performance",
  [query(["partyId", "reviewerId"]).optional().isString().isUUID(), query("sourceType").optional().isIn(sources.SOURCE_TYPES), query(["from", "to"]).optional().isString().custom(dateInput), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.performance({ ...scope(req), query: req.query })))
);

router.get("/recipients", asyncHandler(async (req, res) => sendSuccess(res, await service.recipientsDirectory(scope(req)))));

// Consultant open requests as XLSX or CSV.
router.get(
  "/export",
  requirePermission("external_review", "export"),
  [...filters, query("format").optional().isIn(["xlsx", "csv"]), validate],
  asyncHandler(async (req, res) => {
    const exporter = require("../services/bim-5d-export.service");
    const { items } = await service.list({ ...scope(req), query: { status: "all", ...req.query } });
    const hours = (ms) => (ms === null || ms === undefined ? null : Math.round((ms / 3_600_000) * 10) / 10);
    const project = (await require("../config/db").prisma.project.findFirst({ where: { id: req.params.projectId, orgId: req.user.orgId }, select: { name: true } }))?.name || "Project";
    const built = {
      title: "Consultant open requests",
      project,
      notes: ["Durations are calendar hours from the formal submission (submittedAt), not contract working days. Each row is the current review cycle of its submission."],
      sheets: [{
        name: "Requests",
        columns: [["Project", "project", 18], ["Module", "module", 16], ["Reference", "ref", 12], ["Review", "reviewRef", 10], ["Subject", "title", 40], ["Consultant", "consultant", 22], ["Reviewer", "reviewer", 20], ["Revision", "revision", 8], ["Cycle", "cycle", 6], ["Submitted at", "submittedAt", 18], ["Due at", "dueAt", 18], ["Open (hours)", "openHours", 10], ["Overdue (hours)", "overdueHours", 10], ["Current action with", "actionWith", 22], ["Status", "status", 18], ["Responded at", "respondedAt", 18], ["Response time (hours)", "responseHours", 12], ["Decision", "decision", 20]],
        rows: items.map((row) => ({ project, module: row.sourceLabel, ref: row.sourceRef, reviewRef: row.ref, title: row.title, consultant: row.party.name, reviewer: row.responsible.name, revision: row.revision, cycle: row.cycle, submittedAt: row.submittedAt, dueAt: row.dueAt, openHours: hours(row.openMs), overdueHours: hours(row.overdueMs), actionWith: row.actionWith.label, status: row.statusLabel, respondedAt: row.respondedAt, responseHours: hours(row.responseMs), decision: row.decisionLabel })),
      }],
    };
    if (req.query.format === "csv") {
      const { body: csv, filename } = exporter.toCsv(built);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return res.send(csv);
    }
    const { workbook, filename } = exporter.toWorkbook(built);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    await workbook.xlsx.write(res);
    return res.end();
  })
);

router.get(
  "/source/:sourceType/:sourceId",
  [param("sourceType").isIn(sources.SOURCE_TYPES), param("sourceId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.forSource({ ...scope(req), sourceType: req.params.sourceType, sourceId: req.params.sourceId })))
);

router.post(
  "/",
  requirePermission("external_review", "create"),
  [
    body("sourceType").isIn(sources.SOURCE_TYPES),
    body("sourceId").isString().isUUID(),
    body("partyId").isString().isUUID(),
    body("responsibleUserId").isString().isUUID(),
    body("ccUserIds").optional().isArray({ max: 20 }),
    body("ccUserIds.*").isString().isUUID(),
    body("dueAt").isString().custom(dateInput),
    body("coverNote").optional({ nullable: true }).isString().isLength({ max: 8000 }),
    body("documentIds").optional().isArray({ max: 50 }),
    body("documentIds.*").isString().isUUID(),
    validate,
  ],
  asyncHandler(async (req, res) => sendSuccess(res, await service.submit({ ...scope(req), payload: req.body }), 201))
);

router.get("/:id", [...idParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.detail({ ...scope(req), id: req.params.id }))));

router.post(
  "/:id/decision",
  [...idParam, body("decision").isIn(sources.DECISIONS), body("comment").optional({ nullable: true }).isString().isLength({ max: 8000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.decide({ ...scope(req), id: req.params.id, payload: req.body })))
);

router.post("/:id/acknowledge", [...idParam, validate], asyncHandler(async (req, res) => sendSuccess(res, await service.acknowledge({ ...scope(req), id: req.params.id }))));

router.post(
  "/:id/revision",
  [...idParam, body("reason").optional({ nullable: true }).isString().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.createRevision({ ...scope(req), id: req.params.id, reason: req.body.reason })))
);

router.post(
  "/:id/resubmit",
  [...idParam, body("dueAt").isString().custom(dateInput), body("responsibleUserId").optional().isString().isUUID(), body("coverNote").optional({ nullable: true }).isString().isLength({ max: 8000 }), body("documentIds").optional().isArray({ max: 50 }), body("documentIds.*").isString().isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.resubmit({ ...scope(req), id: req.params.id, payload: req.body })))
);

router.post("/:id/withdraw", [...idParam, reason(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.withdraw({ ...scope(req), id: req.params.id, reason: req.body.reason }))));

router.post(
  "/:id/close",
  [...idParam, body("reason").optional({ nullable: true }).isString().isLength({ max: 2000 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.close({ ...scope(req), id: req.params.id, reason: req.body.reason })))
);

router.post(
  "/:id/reassign",
  [...idParam, body("responsibleUserId").isString().isUUID(), reason(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.reassign({ ...scope(req), id: req.params.id, responsibleUserId: req.body.responsibleUserId, reason: req.body.reason })))
);

router.post(
  "/:id/due-date",
  [...idParam, body("dueAt").isString().custom(dateInput), reason(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.changeDueDate({ ...scope(req), id: req.params.id, dueAt: req.body.dueAt, reason: req.body.reason })))
);

router.post(
  "/:id/messages",
  [...idParam, body("body").isString().trim().isLength({ min: 1, max: 8000 }), body("visibility").optional().isIn(["shared", "internal"]), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await service.addMessage({ ...scope(req), id: req.params.id, body: req.body.body, visibility: req.body.visibility || "shared" })))
);

router.get(
  "/:id/files/:documentId",
  [...idParam, param("documentId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const file = await service.fileFor({ ...scope(req), id: req.params.id, documentId: req.params.documentId });
    if (file.redirectUrl) return res.redirect(302, file.redirectUrl);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.fileName)}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.type(file.mimeType || "application/octet-stream");
    return res.sendFile(file.path);
  })
);

module.exports = router;
