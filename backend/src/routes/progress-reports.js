const express = require("express");
const { body, param } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { isPartyScopedAccess } = require("../services/company-party.service");
const service = require("../services/progress-report.service");

/**
 * Progress reports (CONSULTANT V1), /projects/:projectId/progress-reports,
 * under the report module. A party reads issued reports only; writing them
 * is the contractor's.
 */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const viewerOf = (req) => ({ partyScoped: isPartyScopedAccess(req.projectAccess || {}) });
const contractorOnly = (req, _res, next) => (isPartyScopedAccess(req.projectAccess || {}) ? next(new HttpError(403, "FORBIDDEN", "Progress reports are written by the contractor")) : next());
const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actor = (req) => ({ id: req.user.id });
const fields = (partial) => [
  partial ? body("period").optional().isString().matches(/^\d{4}-(0[1-9]|1[0-2])$/) : body("period").isString().matches(/^\d{4}-(0[1-9]|1[0-2])$/),
  body("kind").optional().isIn(service.KINDS),
  body("title").optional({ nullable: true }).isString().isLength({ max: 200 }),
  body("summary").optional({ nullable: true }).isString().isLength({ max: 20000 }),
];

router.get("/", requirePermission("report", "read"), asyncHandler(async (req, res) => sendSuccess(res, await service.list({ ...scope(req), viewer: viewerOf(req) }))));
router.post("/", contractorOnly, requirePermission("report", "create"), [...fields(false), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.create({ ...scope(req), actor: actor(req), payload: req.body }), 201)));
router.get("/:id", requirePermission("report", "read"), [param("id").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.get({ ...scope(req), viewer: viewerOf(req), id: req.params.id }))));
router.patch("/:id", contractorOnly, requirePermission("report", "update"), [param("id").isUUID(), ...fields(true), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.update({ ...scope(req), actor: actor(req), id: req.params.id, payload: req.body }))));
router.delete("/:id", contractorOnly, requirePermission("report", "delete"), [param("id").isUUID(), validate], asyncHandler(async (req, res) => sendSuccess(res, await service.remove({ ...scope(req), actor: actor(req), id: req.params.id }))));

module.exports = router;
