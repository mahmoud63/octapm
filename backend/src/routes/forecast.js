const express = require("express");
const { body } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { requirePermission, hasPermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const service = require("../services/forecast.service");
const { boqFigureAccess, withheldForecast } = require("../utils/boq-figures");

/** Schedule delay and cost overrun prediction (OCTA-AI-PREDICT-031): `/projects/:projectId/forecast`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const actor = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId, user: { ...req.user, role: getEffectiveRole(req) } });

// Every schedule reader may read the forecast; its cost view is built from
// the activity budgets (the approved BOQ allocations) and the cost ledger,
// so a reader of neither the BOQ nor the cost module receives its levels
// and counts without the money (§12, utils/boq-figures). A BOQ or cost
// reader receives the service's answer untouched.
router.get(
  "/",
  requirePermission("schedule", "read"),
  asyncHandler(async (req, res) =>
    sendSuccess(res, withheldForecast(await service.buildForecast({ orgId: req.user.orgId, projectId: req.params.projectId }), boqFigureAccess(req))),
  ),
);

// The explanation is written from the forecast this caller may receive:
// the narrative, the prompt and the forecast it returns carry no figure the
// forecast itself withholds.
router.post(
  "/explain",
  requirePermission("assistant", "read"),
  requirePermission("schedule", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, await service.explain({ ...actor(req), access: boqFigureAccess(req) }))),
);

router.post(
  "/actions",
  requirePermission("assistant", "read"),
  requirePermission("schedule", "read"),
  [body("action").isObject(), body("action.type").isIn(service.ACTION_TYPES), validate],
  asyncHandler(async (req, res) => {
    const moduleName = req.body.action.type === "create_risk" ? "risk" : "task";
    if (req.body.action.type === "open") throw new HttpError(400, "FORECAST_ACTION_UNKNOWN", "Open actions run in the browser");
    if (!hasPermission(req, moduleName, "create")) throw new HttpError(403, "FORBIDDEN", `You cannot create ${moduleName === "risk" ? "risks" : "tasks"} on this project`);
    return sendSuccess(res, await service.executeAction({ ...actor(req), action: req.body.action, projectAccess: req.projectAccess || null }), 201);
  }),
);

module.exports = router;
