const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { getEffectiveRole, hasPermission, requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { boqFigureAccess, withheldQuantityEntries, withheldQuantityEntryResult, withheldQuantityEntry } = require("../utils/boq-figures");
const quantityProgressService = require("../services/quantity-progress.service");

/**
 * Quantity progress entries (PC-6): /projects/:projectId/quantity-progress.
 *
 * Recording, listing, editing, removing and submitting entries — the
 * pending layer of installed quantity. Nothing here approves anything:
 * approval is the progress submission's (POST /activities/:id/progress and
 * its approve/reject), through the one writer of ActivityProgress. The
 * gates are the progress module's own: reading needs progress:read,
 * recording and submitting the submission.submit transition (plus the
 * site-engineer assignment rule the service applies), and editing or
 * removing an entry someone else recorded the submission.approve
 * authority. Every answer goes through utils/boq-figures: a per-item
 * quantity is BOQ-derived, so a member who may not read the BOQ is given
 * the entry's existence, status and provenance and nothing of its figure.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}(T.*)?$/;
const ROUTE_SOURCES = ["manual", "import"];
const ROUTE_STATUSES = ["draft", "submitted"];

const optionalText = (field, max = 2000) => body(field).optional({ nullable: true }).isString().trim().isLength({ max });
const optionalUuid = (field) => body(field).optional({ nullable: true }).isUUID();
const dateField = (chain) => chain.isString().trim().matches(DATE_ONLY).withMessage("must be a calendar date (YYYY-MM-DD)");

const router = express.Router({ mergeParams: true });
router.use(authenticate);

const canApprove = (req) => hasPermission(req, "progress", "approve", { transition: "submission.approve" });

// The fields of one entry, nested under entries[] or — when the body IS the
// entry — at the top level; the top-level rules apply only when no
// entries[] was sent, so the two shapes never validate each other.
const entryValidators = (prefix) => {
  const field = (name) => (prefix ? body(`${prefix}${name}`) : body(name).if(body("entries").not().exists()));
  return [
    field("activityId").isUUID(),
    field("boqItemId").isUUID(),
    field("quantity").exists({ checkNull: true }).custom((value) => {
      const number = Number(value);
      if (typeof value === "boolean" || value === "" || !Number.isFinite(number)) throw new Error("must be a number");
      if (number < 0) throw new Error("must be zero or more");
      return true;
    }),
    dateField(field("date")),
    field("unitCode").optional({ nullable: true }).isString().trim().isLength({ max: 32 }),
    field("unit").optional({ nullable: true }).isString().trim().isLength({ max: 32 }),
    field("allocationId").optional({ nullable: true }).isUUID(),
    field("locationId").optional({ nullable: true }).isUUID(),
    field("note").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    field("clientRequestId").optional({ nullable: true }).isString().trim().isLength({ max: 128 }),
    field("status").optional().isIn(ROUTE_STATUSES),
    field("source").optional().isIn(ROUTE_SOURCES),
  ];
};

// GET /projects/:projectId/quantity-progress
router.get(
  "/",
  requirePermission("progress", "read"),
  [
    query("activityId").optional().isUUID(),
    query("boqItemId").optional().isUUID(),
    query("locationId").optional().isUUID(),
    query("submissionId").optional().isUUID(),
    query("dailyLogId").optional().isUUID(),
    query("status").optional().isIn(quantityProgressService.ENTRY_STATUSES),
    query("source").optional().isIn(quantityProgressService.ENTRY_SOURCES),
    dateField(query("from").optional()),
    dateField(query("to").optional()),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await quantityProgressService.listEntries({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      filters: {
        activityId: req.query.activityId || null,
        boqItemId: req.query.boqItemId || null,
        locationId: req.query.locationId || null,
        submissionId: req.query.submissionId || null,
        dailyLogId: req.query.dailyLogId || null,
        status: req.query.status || null,
        source: req.query.source || null,
        from: req.query.from || null,
        to: req.query.to || null,
      },
    });
    return sendSuccess(res, withheldQuantityEntries(result, boqFigureAccess(req)));
  }),
);

// POST /projects/:projectId/quantity-progress — one entry, or { entries: [...] }.
// 201 when anything was recorded; 200 when every entry was a replay of a
// clientRequestId seen before (the existing entries are answered, unchanged).
router.post(
  "/",
  requirePermission("progress", "submit", { transition: "submission.submit" }),
  [
    body("entries").optional().isArray({ min: 1, max: 200 }),
    body("status").optional().isIn(ROUTE_STATUSES),
    body("source").optional().isIn(ROUTE_SOURCES),
    optionalText("clientRequestId", 128),
    ...entryValidators("entries.*."),
    ...entryValidators(""),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const single = !Array.isArray(req.body.entries);
    const entries = single ? [req.body] : req.body.entries;
    const result = await quantityProgressService.createEntries({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      entries,
      source: req.body.source || "manual",
      status: req.body.status || "draft",
      clientRequestId: req.body.clientRequestId || null,
    });
    const status = result.created > 0 ? 201 : 200;
    return sendSuccess(res, withheldQuantityEntryResult(single ? { ...result, entry: result.entries[0] } : result, boqFigureAccess(req)), status);
  }),
);

// GET /projects/:projectId/quantity-progress/:entryId
router.get(
  "/:entryId",
  requirePermission("progress", "read"),
  [param("entryId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const entry = await quantityProgressService.getEntry({ orgId: req.user.orgId, projectId: req.params.projectId, entryId: req.params.entryId });
    return sendSuccess(res, withheldQuantityEntry(entry, boqFigureAccess(req)));
  }),
);

// PATCH /projects/:projectId/quantity-progress/:entryId — a pending entry's
// quantity, unit, date, location, allocation or note; by its creator or an approver.
router.patch(
  "/:entryId",
  requirePermission("progress", "submit", { transition: "submission.submit" }),
  [
    param("entryId").isUUID(),
    body("quantity").optional().custom((value) => {
      const number = Number(value);
      if (typeof value === "boolean" || value === "" || value === null || !Number.isFinite(number)) throw new Error("must be a number");
      if (number < 0) throw new Error("must be zero or more");
      return true;
    }),
    dateField(body("date").optional()),
    optionalText("unitCode", 32),
    optionalText("unit", 32),
    optionalUuid("allocationId"),
    optionalUuid("locationId"),
    optionalText("note"),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await quantityProgressService.updateEntry({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      entryId: req.params.entryId,
      userId: req.user.id,
      canApprove: canApprove(req),
      payload: req.body,
    });
    return sendSuccess(res, withheldQuantityEntryResult(result, boqFigureAccess(req)));
  }),
);

// DELETE /projects/:projectId/quantity-progress/:entryId — a pending entry; by its creator or an approver.
router.delete(
  "/:entryId",
  requirePermission("progress", "submit", { transition: "submission.submit" }),
  [param("entryId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await quantityProgressService.deleteEntry({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      entryId: req.params.entryId,
      userId: req.user.id,
      canApprove: canApprove(req),
    });
    return sendSuccess(res, result);
  }),
);

// POST /projects/:projectId/quantity-progress/:entryId/submit — draft → submitted.
router.post(
  "/:entryId/submit",
  requirePermission("progress", "submit", { transition: "submission.submit" }),
  [param("entryId").isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await quantityProgressService.submitEntry({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      entryId: req.params.entryId,
      userId: req.user.id,
      userRole: getEffectiveRole(req),
      canApprove: canApprove(req),
    });
    return sendSuccess(res, withheldQuantityEntryResult(result, boqFigureAccess(req)));
  }),
);

module.exports = router;
