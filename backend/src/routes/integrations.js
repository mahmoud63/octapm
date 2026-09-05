const express = require("express");
const { body, param, query } = require("express-validator");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { authenticate } = require("../middleware/auth");
const { requireCompanyAdmin, getEffectiveRole } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const apiClients = require("../services/api-client.service");
const webhooks = require("../services/webhook.service");
const accounting = require("../services/accounting.service");

/**
 * Integrations (OCTA-INT-API-026): API keys, webhooks and accounting
 * connectors. Everything here is company administration except the OAuth
 * callback, which the accounting system redirects the browser to.
 */
const router = express.Router();

const actor = (req) => ({ id: req.user.id, name: req.user.name, role: getEffectiveRole(req) });

// OAuth callback — arrives without a bearer token; the signed state carries the organisation.
router.get(
  "/accounting/:provider/callback",
  [param("provider").isIn(accounting.PROVIDER_KEYS), query("state").isString().notEmpty(), validate],
  asyncHandler(async (req, res) => {
    if (req.query.error) throw new HttpError(400, "ACCOUNTING_DENIED", `Authorisation was refused: ${req.query.error_description || req.query.error}`);
    const result = await accounting.completeConnect({ provider: req.params.provider, code: String(req.query.code || ""), state: String(req.query.state), realmId: req.query.realmId ? String(req.query.realmId) : null });
    return res.redirect(302, result.redirectTo);
  }),
);

router.use(authenticate);
router.use(requireCompanyAdmin);

// ─── API keys ──────────────────────────────────────────────────────────────
router.get(
  "/scopes",
  asyncHandler(async (req, res) => sendSuccess(res, { scopes: apiClients.describeScopes(), prefix: apiClients.API_KEY_PREFIX })),
);

router.get(
  "/api-clients",
  [query("includeRevoked").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await apiClients.listApiClients({ orgId: req.user.orgId, includeRevoked: Boolean(req.query.includeRevoked) }) })),
);

const apiClientValidators = ({ requireName = false } = {}) => [
  requireName ? body("name").isString().trim().notEmpty().isLength({ max: 120 }) : body("name").optional().isString().trim().isLength({ min: 1, max: 120 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("scopes").optional().isArray({ max: 200 }),
  body("projectIds").optional().isArray({ max: 500 }),
  body("userId").optional({ nullable: true }).isUUID(),
  body("expiresAt").optional({ nullable: true }).isISO8601(),
  body("status").optional().isIn(["revoked"]),
  validate,
];

router.post(
  "/api-clients",
  [body("scopes").isArray({ min: 1 }), ...apiClientValidators({ requireName: true })],
  asyncHandler(async (req, res) => sendSuccess(res, await apiClients.createApiClient({ orgId: req.user.orgId, actor: actor(req), payload: req.body }), 201)),
);

router.patch(
  "/api-clients/:id",
  [param("id").isUUID(), ...apiClientValidators()],
  asyncHandler(async (req, res) => sendSuccess(res, await apiClients.updateApiClient({ orgId: req.user.orgId, actor: actor(req), apiClientId: req.params.id, payload: req.body }))),
);

router.delete(
  "/api-clients/:id",
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await apiClients.revokeApiClient({ orgId: req.user.orgId, actor: actor(req), apiClientId: req.params.id }))),
);

// ─── Webhooks ──────────────────────────────────────────────────────────────
router.get(
  "/webhooks/event-types",
  asyncHandler(async (req, res) => sendSuccess(res, { eventTypes: webhooks.EVENT_TYPES, signatureHeader: webhooks.SIGNATURE_HEADER, maxAttempts: webhooks.MAX_ATTEMPTS })),
);

router.get(
  "/webhooks",
  asyncHandler(async (req, res) => sendSuccess(res, { items: await webhooks.listSubscriptions({ orgId: req.user.orgId }) })),
);

const webhookValidators = ({ requireAll = false } = {}) => [
  requireAll ? body("name").isString().trim().notEmpty().isLength({ max: 120 }) : body("name").optional().isString().trim().isLength({ min: 1, max: 120 }),
  requireAll ? body("url").isString().trim().notEmpty().isLength({ max: 2000 }) : body("url").optional().isString().trim().isLength({ min: 1, max: 2000 }),
  requireAll ? body("eventTypes").isArray({ min: 1, max: 50 }) : body("eventTypes").optional().isArray({ min: 1, max: 50 }),
  body("description").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("projectId").optional({ nullable: true }).isUUID(),
  body("secret").optional({ nullable: true }).isString().trim().isLength({ min: 16, max: 200 }),
  body("status").optional().isIn(["active", "paused"]),
  validate,
];

router.post(
  "/webhooks",
  webhookValidators({ requireAll: true }),
  asyncHandler(async (req, res) => sendSuccess(res, await webhooks.createSubscription({ orgId: req.user.orgId, actor: actor(req), payload: req.body }), 201)),
);

router.get(
  "/webhooks/:id",
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await webhooks.getSubscription({ orgId: req.user.orgId, subscriptionId: req.params.id }))),
);

router.patch(
  "/webhooks/:id",
  [param("id").isUUID(), ...webhookValidators()],
  asyncHandler(async (req, res) => sendSuccess(res, await webhooks.updateSubscription({ orgId: req.user.orgId, actor: actor(req), subscriptionId: req.params.id, payload: req.body }))),
);

router.delete(
  "/webhooks/:id",
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await webhooks.deleteSubscription({ orgId: req.user.orgId, actor: actor(req), subscriptionId: req.params.id }))),
);

router.post(
  "/webhooks/:id/rotate-secret",
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await webhooks.rotateSecret({ orgId: req.user.orgId, actor: actor(req), subscriptionId: req.params.id }))),
);

router.post(
  "/webhooks/:id/test",
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await webhooks.sendTest({ orgId: req.user.orgId, actor: actor(req), subscriptionId: req.params.id }))),
);

router.get(
  "/webhooks/:id/deliveries",
  [param("id").isUUID(), query("status").optional().isIn(["pending", "delivered", "failed", "dead"]), query("limit").optional().isInt({ min: 1, max: 200 }).toInt(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await webhooks.listDeliveries({ orgId: req.user.orgId, subscriptionId: req.params.id, status: req.query.status || null, limit: req.query.limit || 50 }) })),
);

router.post(
  "/webhooks/deliveries/:deliveryId/redeliver",
  [param("deliveryId").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await webhooks.redeliver({ orgId: req.user.orgId, actor: actor(req), deliveryId: req.params.deliveryId }), 201)),
);

// ─── Accounting ────────────────────────────────────────────────────────────
router.get(
  "/accounting/connections",
  asyncHandler(async (req, res) => sendSuccess(res, { items: await accounting.listConnections({ orgId: req.user.orgId }) })),
);

router.post(
  "/accounting/:provider/connect",
  [param("provider").isIn(accounting.PROVIDER_KEYS), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await accounting.startConnect({ orgId: req.user.orgId, provider: req.params.provider, actor: actor(req) }))),
);

router.patch(
  "/accounting/:provider",
  [param("provider").isIn(accounting.PROVIDER_KEYS), body("autoSyncPayApps").optional().isBoolean().toBoolean(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await accounting.updateConnection({ orgId: req.user.orgId, provider: req.params.provider, actor: actor(req), payload: req.body }))),
);

router.delete(
  "/accounting/:provider",
  [param("provider").isIn(accounting.PROVIDER_KEYS), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await accounting.disconnect({ orgId: req.user.orgId, provider: req.params.provider, actor: actor(req) }))),
);

router.get(
  "/accounting/:provider/accounts",
  [param("provider").isIn(accounting.PROVIDER_KEYS), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await accounting.listExternalAccounts({ orgId: req.user.orgId, provider: req.params.provider }) })),
);

router.get(
  "/accounting/mappings",
  [query("provider").optional().isIn(accounting.PROVIDER_KEYS), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await accounting.listMappings({ orgId: req.user.orgId, provider: req.query.provider || null }) })),
);

router.put(
  "/accounting/mappings",
  [body("provider").isIn(accounting.PROVIDER_KEYS), body("costCode").isString().trim().notEmpty().isLength({ max: 80 }), body("costCodeId").optional({ nullable: true }).isUUID(), body("externalAccountId").isString().trim().notEmpty().isLength({ max: 120 }), body("externalAccountName").optional({ nullable: true }).isString().trim().isLength({ max: 200 }), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await accounting.upsertMapping({ orgId: req.user.orgId, actor: actor(req), payload: req.body }))),
);

router.delete(
  "/accounting/mappings/:id",
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await accounting.deleteMapping({ orgId: req.user.orgId, mappingId: req.params.id }))),
);

router.get(
  "/accounting/syncs",
  [query("status").optional().isIn(["pending", "synced", "paid", "failed"]), query("projectId").optional().isUUID(), query("limit").optional().isInt({ min: 1, max: 500 }).toInt(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, { items: await accounting.listSyncs({ orgId: req.user.orgId, projectId: req.query.projectId || null, status: req.query.status || null, limit: req.query.limit || 100 }) })),
);

router.post(
  "/accounting/syncs/:id/retry",
  [param("id").isUUID(), validate],
  asyncHandler(async (req, res) => sendSuccess(res, await accounting.retrySync({ orgId: req.user.orgId, syncId: req.params.id, actor: actor(req) }))),
);

router.post(
  "/accounting/poll",
  asyncHandler(async (req, res) => sendSuccess(res, await accounting.pollPayments({ orgId: req.user.orgId }))),
);

router.get(
  "/accounting/export",
  [query("format").optional().isIn(["xlsx", "csv"]), query("provider").optional().isIn(accounting.PROVIDER_KEYS), query("projectId").optional().isUUID(), query("from").optional().isISO8601(), query("to").optional().isISO8601(), validate],
  asyncHandler(async (req, res) => {
    const file = await accounting.renderExport({ orgId: req.user.orgId, projectId: req.query.projectId || null, from: req.query.from || null, to: req.query.to || null, provider: req.query.provider || null, format: req.query.format || "xlsx" });
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    return res.send(file.buffer);
  }),
);

module.exports = router;
