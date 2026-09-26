const crypto = require("crypto");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const policy = require("../../../shared/permissions.json");

/**
 * Public API keys (OCTA-INT-API-026). A key acts as the person who owns it,
 * limited to its scopes (`<module>:read` / `<module>:write`, or `*:read` /
 * `*:write`) and, optionally, to a list of projects. The raw key is shown
 * once; only its SHA-256 is stored.
 */

const API_KEY_PREFIX = "octapm_";
const READ_ACTIONS = new Set(["read", "export"]);
const LAST_USED_THROTTLE_MS = 60_000;

const MODULES = Object.freeze(Object.keys(policy.modules || {}));
const SCOPES = Object.freeze(["*:read", "*:write", ...MODULES.flatMap((module) => [`${module}:read`, `${module}:write`])]);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const hashKey = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

const describeScopes = () =>
  SCOPES.map((scope) => {
    const [module, access] = scope.split(":");
    const label = module === "*" ? "Every module" : policy.modules[module]?.label || module;
    return { scope, module, access, label: `${label} — ${access === "read" ? "read" : "read & write"}` };
  });

const normalizeScopes = (scopes) => {
  const list = [...new Set((Array.isArray(scopes) ? scopes : []).map((scope) => String(scope || "").trim().toLowerCase()).filter(Boolean))];
  const unknown = list.filter((scope) => !SCOPES.includes(scope));
  if (unknown.length) throw new HttpError(400, "API_SCOPE_UNKNOWN", `Unknown scope${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`, { unknown });
  if (!list.length) throw new HttpError(400, "API_SCOPE_REQUIRED", "Pick at least one scope");
  return list;
};

/** Does the key allow `action` on `module`? Writes imply reads. */
const scopeAllows = (apiClient, moduleName, action) => {
  const scopes = new Set(apiClient?.scopes || []);
  const wantsRead = READ_ACTIONS.has(String(action || "read"));
  if (scopes.has("*:write")) return true;
  if (scopes.has(`${moduleName}:write`)) return true;
  if (!wantsRead) return false;
  return scopes.has("*:read") || scopes.has(`${moduleName}:read`);
};

const serialize = (row, { token = null } = {}) => ({
  id: row.id,
  name: row.name,
  description: row.description || null,
  keyPrefix: row.keyPrefix,
  scopes: row.scopes || [],
  projectIds: row.projectIds || [],
  status: row.status,
  owner: row.user ? { id: row.user.id, name: row.user.name, email: row.user.email, role: row.user.role } : { id: row.userId },
  lastUsedAt: toIso(row.lastUsedAt),
  expiresAt: toIso(row.expiresAt),
  revokedAt: toIso(row.revokedAt),
  createdBy: row.createdBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
  ...(token ? { token } : {}),
});

const userSelect = { select: { id: true, name: true, email: true, role: true, status: true, isCompanyAdmin: true, orgId: true } };

const listApiClients = async ({ orgId, includeRevoked = false }) => {
  const rows = await prisma.apiClient.findMany({ where: { orgId, ...(includeRevoked ? {} : { status: "active" }) }, include: { user: userSelect }, orderBy: { createdAt: "desc" } });
  return rows.map((row) => serialize(row));
};

const resolveProjectIds = async ({ orgId, projectIds }) => {
  const ids = [...new Set((Array.isArray(projectIds) ? projectIds : []).map((id) => trimOrNull(id)).filter(Boolean))];
  if (!ids.length) return [];
  const known = await prisma.project.findMany({ where: { id: { in: ids }, orgId }, select: { id: true } });
  const knownIds = new Set(known.map((row) => row.id));
  const missing = ids.filter((id) => !knownIds.has(id));
  if (missing.length) throw new HttpError(400, "API_PROJECT_UNKNOWN", "One or more projects do not belong to this organisation");
  return ids;
};

const createApiClient = async ({ orgId, actor, payload = {} }) => {
  const name = trimOrNull(payload.name);
  if (!name) throw new HttpError(400, "API_CLIENT_NAME_REQUIRED", "Give the key a name");
  const scopes = normalizeScopes(payload.scopes);
  const projectIds = await resolveProjectIds({ orgId, projectIds: payload.projectIds });
  const ownerId = trimOrNull(payload.userId) || actor?.id;
  // The owner must belong to this workspace — by membership, or by the User
  // column for a person seeded before memberships — and the key remembers
  // which membership it acts as.
  const { findUserInOrg, findMembership } = require("./membership.service");
  const owner = await findUserInOrg({ tx: prisma, orgId, userId: ownerId, select: { ...userSelect.select } });
  const ownerMembership = owner ? await findMembership({ tx: prisma, orgId, userId: owner.id }) : null;
  if (!owner || owner.status !== "active" || (ownerMembership && ownerMembership.status !== "active")) throw new HttpError(400, "API_OWNER_UNKNOWN", "The key must act as an active person in this organisation");
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new HttpError(400, "API_EXPIRY_INVALID", "Expiry must be a date");
  const token = `${API_KEY_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
  const row = await prisma.apiClient.create({
    data: { orgId, userId: owner.id, name, description: trimOrNull(payload.description), keyPrefix: token.slice(0, API_KEY_PREFIX.length + 8), keyHash: hashKey(token), scopes, projectIds, expiresAt, createdBy: actor?.id || null, ...(ownerMembership ? { membershipId: ownerMembership.id } : {}) },
    include: { user: userSelect },
  });
  await auditService.recordEvent({ orgId, projectId: null, entityType: auditService.ENTITY_TYPES.API_CLIENT || "api_client", entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { name, scopes, projectIds: projectIds.length, owner: owner.email } }).catch(() => null);
  return serialize(row, { token });
};

const updateApiClient = async ({ orgId, actor, apiClientId, payload = {} }) => {
  const existing = await prisma.apiClient.findFirst({ where: { id: apiClientId, orgId } });
  if (!existing) throw new HttpError(404, "API_CLIENT_NOT_FOUND", "API key not found");
  const data = { updatedAt: new Date() };
  if (payload.name !== undefined) {
    data.name = trimOrNull(payload.name);
    if (!data.name) throw new HttpError(400, "API_CLIENT_NAME_REQUIRED", "Give the key a name");
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description);
  if (payload.scopes !== undefined) data.scopes = normalizeScopes(payload.scopes);
  if (payload.projectIds !== undefined) data.projectIds = await resolveProjectIds({ orgId, projectIds: payload.projectIds });
  if (payload.expiresAt !== undefined) {
    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new HttpError(400, "API_EXPIRY_INVALID", "Expiry must be a date");
    data.expiresAt = expiresAt;
  }
  if (payload.status === "revoked" && existing.status !== "revoked") {
    data.status = "revoked";
    data.revokedAt = new Date();
  }
  const row = await prisma.apiClient.update({ where: { id: existing.id }, data, include: { user: userSelect } });
  await auditService.recordEvent({ orgId, projectId: null, entityType: auditService.ENTITY_TYPES.API_CLIENT || "api_client", entityId: row.id, action: data.status === "revoked" ? auditService.ACTIONS.DELETED || "deleted" : auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { name: row.name, fields: Object.keys(payload) } }).catch(() => null);
  return serialize(row);
};

const revokeApiClient = ({ orgId, actor, apiClientId }) => updateApiClient({ orgId, actor, apiClientId, payload: { status: "revoked" } });

/**
 * Turns a raw key into the principal it acts as; throws 401 when it cannot.
 * A key acts as one person in one workspace: the owner's membership in the
 * key's organisation (`membershipId`, backfilled) decides their role and
 * standing, as it does for a bearer token (architecture doc §2.1); the User
 * columns decide only when the owner has no membership row there.
 */
const authenticateApiKey = async (token) => {
  const row = await prisma.apiClient.findUnique({ where: { keyHash: hashKey(token) }, include: { user: userSelect } });
  if (!row || row.status !== "active") throw new HttpError(401, "API_KEY_INVALID", "API key is invalid or revoked");
  if (row.expiresAt && row.expiresAt < new Date()) throw new HttpError(401, "API_KEY_EXPIRED", "API key has expired");
  const ownerInactive = () => new HttpError(401, "API_KEY_OWNER_INACTIVE", "The person this key acts as is no longer active");
  const { resolveMembershipPrincipal, principalFromUser } = require("./membership.service");
  const standing = await resolveMembershipPrincipal({ tx: prisma, userId: row.userId, orgId: row.orgId, membershipId: row.membershipId || null });
  if (standing.inactive) throw ownerInactive();
  let user = standing.principal;
  if (!user) {
    if (!row.user || row.user.status !== "active" || row.user.orgId !== row.orgId) throw ownerInactive();
    user = principalFromUser(row.user);
  }
  if (!row.lastUsedAt || Date.now() - new Date(row.lastUsedAt).getTime() > LAST_USED_THROTTLE_MS) {
    prisma.apiClient.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
  }
  return {
    user: { ...user, email: user.email || row.user?.email || null, name: user.name || row.user?.name || null },
    apiClient: { id: row.id, name: row.name, scopes: row.scopes || [], projectIds: row.projectIds || [] },
  };
};

module.exports = { API_KEY_PREFIX, SCOPES, describeScopes, normalizeScopes, scopeAllows, hashKey, listApiClients, createApiClient, updateApiClient, revokeApiClient, authenticateApiKey };
