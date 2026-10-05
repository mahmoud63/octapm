const express = require("express");
const { param, query } = require("express-validator");
const { dateInput } = require("../utils/date-input");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { requirePermission, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const accounting = require("../services/accounting.service");

/** Accounting on one project (OCTA-INT-API-026): `/projects/:projectId/accounting`. */
const router = express.Router({ mergeParams: true });
router.use(authenticate);

const scope = (req) => ({ orgId: req.user.orgId, projectId: req.params.projectId });
const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });
const accountingApprover = requirePermission("sub_pay_app", "update", { transition: "sub_pay_app.accounting_sync" });

router.get(
  "/connections",
  requirePermission("sub_pay_app", "read"),
  asyncHandler(async (req, res) => sendSuccess(res, { items: (await accounting.listConnections({ orgId: req.user.orgId })).map((item) => ({ provider: item.provider, label: item.label, status: item.status, externalOrgName: item.externalOrgName, autoSyncPayApps: item.autoSyncPayApps })) })),
);

router.get(
  "/syncs",
  requirePermission("sub_pay_app", "read"),
  [query("recordId").isString().optional().isUUID(), query("status").isString().optional().isIn(["pending", "synced", "paid", "failed"]), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await accounting.listSyncs({ ...scope(req), recordId: req.query.recordId || null, status: req.query.status || null }) })),
);

router.post(
  "/pay-apps/:payAppId/sync",
  accountingApprover,
  [param("payAppId").isUUID(), query("provider").isString().optional().isIn(accounting.PROVIDER_KEYS), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await accounting.queuePayAppSync({ ...scope(req), payAppId: req.params.payAppId, provider: req.query.provider || null, actor: actor(req) }) }, 202)),
);

router.post(
  "/syncs/:syncId/retry",
  accountingApprover,
  [param("syncId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await accounting.retrySync({ ...scope(req), syncId: req.params.syncId, actor: actor(req) }))),
);

router.get(
  "/export",
  requirePermission("sub_pay_app", "export"),
  [query("format").isString().optional().isIn(["xlsx", "csv"]), query("provider").isString().optional().isIn(accounting.PROVIDER_KEYS), query("from").isString().optional().custom(dateInput), query("to").isString().optional().custom(dateInput), validate],
  asyncHandler(async (req, res) => {
    const file = await accounting.renderExport({ ...scope(req), from: req.query.from || null, to: req.query.to || null, provider: req.query.provider || null, format: req.query.format || "xlsx" });
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    return res.send(file.buffer);
  }),
);

module.exports = router;
