const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const {
  ALL_ACTIONS,
  ALL_PARTY_ROLES,
  ALL_ROLES,
  can,
  canParty,
  normalizePartyRoleId,
  normalizeRoleId,
  permissionPolicy,
} = require("../config/permissions");

/**
 * Permission templates.
 *
 * `shared/permissions.json` remains the base vocabulary: modules, actions,
 * transitions, and what each internal role / party role may do. A template
 * layers on top of it:
 *
 *   level per module  none      → nothing, module hidden
 *                     read_only → read + export only
 *                     standard  → whatever the template's base role (or base
 *                                 party role) may do today
 *                     admin     → every action and transition of the module
 *   grants            extra "<module>|action:<a>" / "<module>|transition:<t>"
 *                     keys allowed regardless of level
 *
 * A template with no tool rows is exactly its base role, which is how the
 * seeded defaults reproduce the existing eight roles and four party profiles.
 *
 * Resolution order for a user on a project:
 *   company admin → ProjectUserPermission template → party template →
 *   ProjectAssignment role → org role / party profile (existing behaviour).
 */

const LEVELS = Object.freeze({
  NONE: "none",
  READ_ONLY: "read_only",
  STANDARD: "standard",
  ADMIN: "admin",
});
const LEVEL_VALUES = Object.values(LEVELS);
const READ_ONLY_ACTIONS = new Set(["read", "export"]);
const TEMPLATE_KINDS = Object.freeze(["internal", "external"]);
const CLIENT_TYPES = Object.freeze(["gc", "owner", "consultant", "subcontractor"]);
const TEMPLATE_STATUSES = Object.freeze({ ACTIVE: "active", ARCHIVED: "archived" });
const COMPANY_ADMIN_MODULES = new Set(["user_management", "project_parties"]);
const CACHE_TTL_MS = 15_000;

const MODULE_IDS = Object.keys(permissionPolicy.modules);

const DEFAULT_TEMPLATES = Object.freeze([
  { name: "Project Manager - Internal", description: "Full project administration for the company's own project managers.", kind: "internal", clientType: "gc", baseRole: "pm" },
  { name: "Planning Engineer - Internal", description: "Schedule ownership, progress review, imports, and risk register.", kind: "internal", clientType: "gc", baseRole: "planning_eng" },
  { name: "Quantity Surveyor - Internal", description: "BOQ, allocations, valuations, IPC preparation, and change orders.", kind: "internal", clientType: "gc", baseRole: "qs" },
  { name: "Cost Controller - Internal", description: "Cost records, earned value, and exports.", kind: "internal", clientType: "gc", baseRole: "cost_controller" },
  { name: "Procurement - Internal", description: "Suppliers, packages, purchase orders, and lead-time alerts.", kind: "internal", clientType: "gc", baseRole: "procurement" },
  { name: "Warehouse - Internal", description: "Delivery receipts, material issue, and usage.", kind: "internal", clientType: "gc", baseRole: "warehouse" },
  { name: "Site Engineer - Internal", description: "Daily reports, progress submissions, RFIs, submittals, NCRs, and safety.", kind: "internal", clientType: "gc", baseRole: "site_engineer" },
  { name: "Finance - Internal", description: "IPC certification, invoices, payments, retention, and cost approvals.", kind: "internal", clientType: "gc", baseRole: "finance" },
  { name: "Owner / Client - External", description: "Read access to progress, commercial, and documents; answers routed RFIs.", kind: "external", clientType: "owner", basePartyRole: "owner" },
  { name: "Consultant - External", description: "Reviews submittals, answers RFIs, uploads document revisions, chairs meetings.", kind: "external", clientType: "consultant", basePartyRole: "consultant" },
  { name: "Contractor - External", description: "Submits progress, daily reports, RFIs, submittals, and documents.", kind: "external", clientType: "gc", basePartyRole: "contractor" },
  { name: "Subcontractor - External", description: "Submits progress, daily reports, RFIs, submittals, and documents for its own scope.", kind: "external", clientType: "subcontractor", basePartyRole: "subcontractor" },
]);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toIso = (value) => value?.toISOString?.() || value || null;

const grantKey = ({ module, action = null, transition = null }) =>
  transition
    ? `${module}|transition:${transition}`
    : `${module}|action:${action}`;

const parseGrantKey = (key) => {
  const match = /^([a-z_]+)\|(action|transition):(.+)$/.exec(String(key || ""));
  if (!match) return null;
  return {
    module: match[1],
    action: match[2] === "action" ? match[3] : null,
    transition: match[2] === "transition" ? match[3] : null,
  };
};

// ─── Catalog ────────────────────────────────────────────────────────────────

const getCatalog = () => ({
  levels: LEVEL_VALUES.map((level) => ({
    id: level,
    label:
      level === LEVELS.NONE
        ? "None"
        : level === LEVELS.READ_ONLY
          ? "Read only"
          : level === LEVELS.STANDARD
            ? "Standard"
            : "Admin",
    description:
      level === LEVELS.NONE
        ? "No access; the module is hidden."
        : level === LEVELS.READ_ONLY
          ? "View and export only."
          : level === LEVELS.STANDARD
            ? "What the template's base role can do today."
            : "Every action and transition in the module.",
  })),
  actions: ALL_ACTIONS,
  roles: permissionPolicy.roles,
  partyRoles: permissionPolicy.partyRoles || [],
  kinds: TEMPLATE_KINDS,
  clientTypes: CLIENT_TYPES,
  modules: MODULE_IDS.map((id) => ({
    id,
    label: permissionPolicy.modules[id].label || id,
    actions: ALL_ACTIONS,
    transitions: Object.keys(permissionPolicy.modules[id].transitions || {}),
  })),
});

// ─── Validation ─────────────────────────────────────────────────────────────

const assertModule = (module) => {
  if (!permissionPolicy.modules[module]) {
    throw new HttpError(400, "PERMISSION_MODULE_INVALID", `Unknown module: ${module}`);
  }
};

const normalizeLevel = (level) => {
  const value = trimOrNull(level)?.toLowerCase();
  if (!LEVEL_VALUES.includes(value)) {
    throw new HttpError(
      400,
      "PERMISSION_LEVEL_INVALID",
      `Level must be one of ${LEVEL_VALUES.join(", ")}`,
    );
  }
  return value;
};

const normalizeTools = (tools) => {
  if (tools === undefined) return undefined;
  if (!Array.isArray(tools)) {
    throw new HttpError(400, "PERMISSION_TOOLS_INVALID", "tools must be an array");
  }
  const byModule = new Map();
  for (const tool of tools) {
    const module = trimOrNull(tool?.module);
    assertModule(module);
    byModule.set(module, normalizeLevel(tool.level));
  }
  return [...byModule.entries()].map(([module, level]) => ({ module, level }));
};

const normalizeGrants = (grants) => {
  if (grants === undefined) return undefined;
  if (!Array.isArray(grants)) {
    throw new HttpError(400, "PERMISSION_GRANTS_INVALID", "grants must be an array");
  }
  const byKey = new Map();
  for (const raw of grants) {
    const grant = typeof raw === "string" ? parseGrantKey(raw) : raw;
    const module = trimOrNull(grant?.module);
    assertModule(module);
    const action = trimOrNull(grant?.action);
    const transition = trimOrNull(grant?.transition);
    if (!action && !transition) {
      throw new HttpError(
        400,
        "PERMISSION_GRANT_INVALID",
        "Each grant needs an action or a transition",
      );
    }
    if (action && !ALL_ACTIONS.includes(action)) {
      throw new HttpError(400, "PERMISSION_GRANT_INVALID", `Unknown action: ${action}`);
    }
    if (
      transition &&
      !Object.keys(permissionPolicy.modules[module].transitions || {}).includes(
        transition,
      )
    ) {
      throw new HttpError(
        400,
        "PERMISSION_GRANT_INVALID",
        `Unknown transition ${transition} for module ${module}`,
      );
    }
    const normalized = { module, action: action || null, transition: transition || null };
    byKey.set(grantKey(normalized), normalized);
  }
  return [...byKey.entries()].map(([key, grant]) => ({ ...grant, key }));
};

const normalizeBase = ({ baseRole, basePartyRole, kind }) => {
  const role = baseRole !== undefined ? normalizeRoleId(trimOrNull(baseRole)) : undefined;
  const partyRole =
    basePartyRole !== undefined
      ? normalizePartyRoleId(trimOrNull(basePartyRole))
      : undefined;
  if (role && !ALL_ROLES.includes(role)) {
    throw new HttpError(400, "PERMISSION_BASE_ROLE_INVALID", `Unknown base role: ${baseRole}`);
  }
  if (partyRole && !ALL_PARTY_ROLES.includes(partyRole)) {
    throw new HttpError(
      400,
      "PERMISSION_BASE_PARTY_ROLE_INVALID",
      `Unknown base party role: ${basePartyRole}`,
    );
  }
  if (kind === "external" && role) {
    throw new HttpError(
      400,
      "PERMISSION_TEMPLATE_KIND_MISMATCH",
      "External templates use basePartyRole, not baseRole",
    );
  }
  return { baseRole: role ?? undefined, basePartyRole: partyRole ?? undefined };
};

// ─── Compilation & evaluation ───────────────────────────────────────────────

const compileTemplate = (template, overrides = {}) => {
  if (!template) return null;
  const tools = {};
  for (const tool of template.tools || []) tools[tool.module] = tool.level;
  for (const [module, level] of Object.entries(overrides?.tools || {})) {
    if (permissionPolicy.modules[module] && LEVEL_VALUES.includes(level)) {
      tools[module] = level;
    }
  }
  const grants = new Set((template.grants || []).map((grant) => grant.key));
  for (const key of overrides?.grants || []) {
    if (parseGrantKey(key)) grants.add(key);
  }
  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    baseRole: normalizeRoleId(template.baseRole) || null,
    basePartyRole: normalizePartyRoleId(template.basePartyRole) || null,
    tools,
    grants,
  };
};

const baseAllows = (compiled, { module, action, transition }) => {
  if (compiled.baseRole) {
    return can({ role: compiled.baseRole, module, action, transition });
  }
  if (compiled.basePartyRole) {
    return canParty({ partyRole: compiled.basePartyRole, module, action, transition });
  }
  return false;
};

const effectiveLevel = (compiled, module) => {
  if (compiled.tools[module]) return compiled.tools[module];
  return baseAllows(compiled, { module, action: "read" })
    ? LEVELS.STANDARD
    : LEVELS.NONE;
};

const templateAllows = (compiled, { module, action, transition = null }) => {
  if (!compiled || !permissionPolicy.modules[module]) return false;
  if (
    compiled.grants.has(
      grantKey({ module, action: transition ? null : action, transition }),
    )
  ) {
    return true;
  }

  switch (effectiveLevel(compiled, module)) {
    case LEVELS.ADMIN:
      return true;
    case LEVELS.STANDARD:
      return baseAllows(compiled, { module, action, transition });
    case LEVELS.READ_ONLY:
      return !transition && READ_ONLY_ACTIONS.has(action);
    default:
      return false;
  }
};

const fallbackAllows = ({ role, partyAccess = [] }, { module, action, transition }) =>
  can({ role, module, action, transition }) ||
  partyAccess.some((party) =>
    canParty({ partyRole: party.role, module, action, transition }),
  );

/**
 * Builds the module × action matrix the frontend uses to hide modules and gate
 * buttons. `decide` is a function (module, action, transition) → boolean.
 */
const buildMatrix = (decide, levelFor) => {
  const modules = {};
  for (const module of MODULE_IDS) {
    const actions = ALL_ACTIONS.filter((action) => decide(module, action, null));
    const transitions = Object.keys(
      permissionPolicy.modules[module].transitions || {},
    ).filter((transition) => decide(module, null, transition));
    modules[module] = {
      label: permissionPolicy.modules[module].label || module,
      level: levelFor ? levelFor(module, actions) : deriveLevel(actions, transitions, module),
      visible: actions.length > 0 || transitions.length > 0,
      actions,
      transitions,
    };
  }
  return modules;
};

const deriveLevel = (actions, transitions, module) => {
  if (!actions.length && !transitions.length) return LEVELS.NONE;
  const allTransitions = Object.keys(permissionPolicy.modules[module].transitions || {});
  if (
    ALL_ACTIONS.every((action) => actions.includes(action)) &&
    allTransitions.every((transition) => transitions.includes(transition))
  ) {
    return LEVELS.ADMIN;
  }
  if (actions.every((action) => READ_ONLY_ACTIONS.has(action)) && !transitions.length) {
    return LEVELS.READ_ONLY;
  }
  return LEVELS.STANDARD;
};

// ─── Loading (with a short cache so template edits apply without restarts) ──

const templateInclude = {
  tools: { orderBy: { module: "asc" } },
  grants: { orderBy: { key: "asc" } },
};

const compiledCache = new Map();

const invalidateTemplateCache = (templateId = null) => {
  if (templateId) compiledCache.delete(templateId);
  else compiledCache.clear();
};

const loadCompiledTemplate = async ({ tx = prisma, templateId, overrides = {} }) => {
  if (!templateId || !tx.permissionTemplate?.findFirst) return null;
  const hasOverrides =
    overrides && (Object.keys(overrides.tools || {}).length || (overrides.grants || []).length);

  const cached = compiledCache.get(templateId);
  if (cached && cached.expiresAt > Date.now() && !hasOverrides) return cached.compiled;

  const template = await tx.permissionTemplate.findFirst({
    where: { id: templateId, status: TEMPLATE_STATUSES.ACTIVE },
    include: templateInclude,
  });
  if (!template) return null;

  const compiled = compileTemplate(template, overrides);
  if (!hasOverrides) {
    compiledCache.set(templateId, { compiled, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return compiled;
};

/**
 * Finds the template that governs a user on a project: an explicit
 * ProjectUserPermission first, then the template of any active party the user
 * belongs to. Returns null when the legacy role/party policy should apply.
 */
const resolveTemplateContext = async ({
  tx = prisma,
  projectId,
  userId,
  partyAccess = [],
}) => {
  if (!projectId || !userId) return null;

  if (tx.projectUserPermission?.findFirst) {
    const assignment = await tx.projectUserPermission.findFirst({
      where: { projectId, userId },
      select: { id: true, templateId: true, overridesJson: true },
    });
    if (assignment?.templateId) {
      const compiled = await loadCompiledTemplate({
        tx,
        templateId: assignment.templateId,
        overrides: assignment.overridesJson || {},
      });
      if (compiled) return { source: "template", compiled, assignmentId: assignment.id };
    }
  }

  const partyIds = partyAccess.map((party) => party.projectPartyId).filter(Boolean);
  if (partyIds.length && tx.projectParty?.findFirst) {
    const party = await tx.projectParty.findFirst({
      where: { id: { in: partyIds }, permissionTemplateId: { not: null } },
      select: { id: true, permissionTemplateId: true },
    });
    if (party?.permissionTemplateId) {
      const compiled = await loadCompiledTemplate({
        tx,
        templateId: party.permissionTemplateId,
      });
      if (compiled) return { source: "party_template", compiled, projectPartyId: party.id };
    }
  }

  return null;
};

/**
 * The projects on which a template assigned to this person — as a member, or
 * through a party they belong to when no member template is set — refuses the
 * module/action. A list mounted outside any project (/tasks) has no project in
 * its path to attach a template for; it leaves these projects out instead,
 * as each project's own mount would have refused (Phase 21D, CX21-492).
 */
const projectsWhereTemplateDenies = async ({
  tx = prisma,
  orgId,
  userId,
  module,
  action,
  transition = null,
}) => {
  if (!userId || !tx.projectUserPermission?.findMany) return [];
  const denied = new Set();
  const decided = new Set();
  const assignments = await tx.projectUserPermission.findMany({
    where: { orgId, userId, templateId: { not: null } },
    select: { projectId: true, templateId: true, overridesJson: true },
  });
  for (const assignment of assignments) {
    const compiled = await loadCompiledTemplate({ tx, templateId: assignment.templateId, overrides: assignment.overridesJson || {} });
    if (!compiled) continue;
    decided.add(assignment.projectId);
    if (!templateAllows(compiled, { module, action, transition })) denied.add(assignment.projectId);
  }
  if (tx.projectPartyMember?.findMany) {
    const memberships = await tx.projectPartyMember.findMany({
      where: { userId, status: "active", projectParty: { permissionTemplateId: { not: null } } },
      select: { projectParty: { select: { projectId: true, permissionTemplateId: true } } },
    });
    for (const membership of memberships) {
      const party = membership.projectParty;
      if (!party?.permissionTemplateId || decided.has(party.projectId)) continue;
      const compiled = await loadCompiledTemplate({ tx, templateId: party.permissionTemplateId });
      if (compiled && !templateAllows(compiled, { module, action, transition })) denied.add(party.projectId);
    }
  }
  return [...denied];
};

/**
 * Attaches the compiled template (if any) to req.projectAccess so
 * requirePermission can evaluate it. Never throws: a lookup failure leaves the
 * legacy policy in place.
 */
const attachTemplateContext = async ({ req }) => {
  if (!req?.user || !req.projectAccess?.id) return null;
  try {
    const context = await resolveTemplateContext({
      projectId: req.projectAccess.id,
      userId: req.user.id,
      partyAccess: req.projectAccess.partyAccess || [],
    });
    if (context) {
      req.projectAccess.template = context.compiled;
      req.projectAccess.templateSource = context.source;
    }
    return context;
  } catch (error) {
    console.error("[permissions] template resolution failed", error);
    return null;
  }
};

const resolveProjectPermissions = async ({
  orgId,
  projectId,
  user,
  projectAccess,
}) => {
  const isCompanyAdmin = Boolean(user?.isCompanyAdmin);
  const effectiveRole = normalizeRoleId(projectAccess?.role || user?.role);
  const partyAccess = projectAccess?.partyAccess || [];
  const context = await resolveTemplateContext({
    projectId,
    userId: user?.id,
    partyAccess,
  });

  const decide = context
    ? (module, action, transition) =>
        templateAllows(context.compiled, { module, action, transition })
    : (module, action, transition) =>
        fallbackAllows({ role: effectiveRole, partyAccess }, { module, action, transition });

  const decideWithAdmin = (module, action, transition) =>
    (isCompanyAdmin && COMPANY_ADMIN_MODULES.has(module)) ||
    decide(module, action, transition);

  return {
    orgId,
    projectId,
    userId: user?.id || null,
    isCompanyAdmin,
    source: context ? context.source : projectAccess?.scope || "org",
    role: effectiveRole,
    partyRoles: partyAccess.map((party) => party.role),
    template: context
      ? { id: context.compiled.id, name: context.compiled.name }
      : null,
    modules: buildMatrix(decideWithAdmin),
  };
};

const resolveOrgPermissions = ({ user }) => {
  const role = normalizeRoleId(user?.role);
  const isCompanyAdmin = Boolean(user?.isCompanyAdmin);
  const decide = (module, action, transition) =>
    (isCompanyAdmin && COMPANY_ADMIN_MODULES.has(module)) ||
    can({ role, module, action, transition });
  return {
    orgId: user?.orgId || null,
    projectId: null,
    userId: user?.id || null,
    isCompanyAdmin,
    source: "org",
    role,
    partyRoles: [],
    template: null,
    modules: buildMatrix(decide),
  };
};

// ─── Template CRUD ──────────────────────────────────────────────────────────

const serializeTemplate = (template, usage = null) => ({
  id: template.id,
  orgId: template.orgId,
  name: template.name,
  description: template.description || null,
  kind: template.kind,
  clientType: template.clientType || null,
  baseRole: template.baseRole || null,
  basePartyRole: template.basePartyRole || null,
  isDefault: Boolean(template.isDefault),
  isSystem: Boolean(template.isSystem),
  status: template.status,
  tools: (template.tools || []).map((tool) => ({ module: tool.module, level: tool.level })),
  grants: (template.grants || []).map((grant) => ({
    module: grant.module,
    action: grant.action || null,
    transition: grant.transition || null,
    key: grant.key,
  })),
  usage: usage || {
    projectUsers: template._count?.userPermissions ?? 0,
    parties: template._count?.projectParties ?? 0,
  },
  createdBy: template.createdBy || null,
  updatedBy: template.updatedBy || null,
  createdAt: toIso(template.createdAt),
  updatedAt: toIso(template.updatedAt),
});

const templateListInclude = {
  ...templateInclude,
  _count: { select: { userPermissions: true, projectParties: true } },
};

const recordOrgAudit = async ({
  tx = prisma,
  orgId,
  actorId = null,
  actorRole = null,
  entityType,
  entityId,
  action,
  metadata = {},
}) => {
  if (!tx.authAuditEvent?.create) return null;
  return tx.authAuditEvent.create({
    data: {
      orgId,
      actorId,
      actorRole,
      entityType,
      entityId,
      action,
      metadataJson: metadata,
    },
  });
};

const listTemplates = async ({ orgId, query = {} }) => {
  const where = { orgId };
  if (query.status && Object.values(TEMPLATE_STATUSES).includes(query.status)) {
    where.status = query.status;
  } else if (!query.includeArchived) {
    where.status = TEMPLATE_STATUSES.ACTIVE;
  }
  if (query.kind && TEMPLATE_KINDS.includes(query.kind)) where.kind = query.kind;

  const rows = await prisma.permissionTemplate.findMany({
    where,
    include: templateListInclude,
    orderBy: [{ isSystem: "desc" }, { kind: "asc" }, { name: "asc" }],
  });
  return { items: rows.map((row) => serializeTemplate(row)) };
};

const requireTemplate = async ({ tx = prisma, orgId, templateId }) => {
  const template = await tx.permissionTemplate.findFirst({
    where: { id: templateId, orgId },
    include: templateListInclude,
  });
  if (!template) {
    throw new HttpError(404, "PERMISSION_TEMPLATE_NOT_FOUND", "Permission template not found");
  }
  return template;
};

const getTemplate = async ({ orgId, templateId }) =>
  serializeTemplate(await requireTemplate({ orgId, templateId }));

const assertUniqueName = async ({ tx, orgId, name, excludeId = null }) => {
  const clash = await tx.permissionTemplate.findFirst({
    where: {
      orgId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw new HttpError(
      409,
      "PERMISSION_TEMPLATE_DUPLICATE_NAME",
      "A permission template with this name already exists",
    );
  }
};

const createTemplate = async ({ orgId, payload = {}, actorId = null, actorRole = null }) => {
  const name = trimOrNull(payload.name);
  if (!name) {
    throw new HttpError(400, "PERMISSION_TEMPLATE_NAME_REQUIRED", "Template name is required");
  }
  const kind = TEMPLATE_KINDS.includes(payload.kind) ? payload.kind : "internal";
  const clientType = CLIENT_TYPES.includes(payload.clientType) ? payload.clientType : null;
  const base = normalizeBase({
    baseRole: payload.baseRole,
    basePartyRole: payload.basePartyRole,
    kind,
  });
  const tools = normalizeTools(payload.tools) || [];
  const grants = normalizeGrants(payload.grants) || [];

  const template = await prisma.$transaction(async (tx) => {
    await assertUniqueName({ tx, orgId, name });
    const created = await tx.permissionTemplate.create({
      data: {
        orgId,
        name,
        description: trimOrNull(payload.description),
        kind,
        clientType,
        baseRole: base.baseRole || null,
        basePartyRole: base.basePartyRole || null,
        isDefault: false,
        isSystem: false,
        createdBy: actorId,
        updatedBy: actorId,
        tools: { create: tools },
        grants: { create: grants },
      },
      include: templateListInclude,
    });
    await recordOrgAudit({
      tx,
      orgId,
      actorId,
      actorRole,
      entityType: "permission_template",
      entityId: created.id,
      action: "created",
      metadata: { name, kind, tools: tools.length, grants: grants.length },
    });
    return created;
  });

  return serializeTemplate(template);
};

const updateTemplate = async ({
  orgId,
  templateId,
  payload = {},
  actorId = null,
  actorRole = null,
}) => {
  const existing = await requireTemplate({ orgId, templateId });
  const data = { updatedBy: actorId };

  if (payload.name !== undefined) {
    const name = trimOrNull(payload.name);
    if (!name) {
      throw new HttpError(400, "PERMISSION_TEMPLATE_NAME_REQUIRED", "Template name is required");
    }
    if (existing.isSystem && name !== existing.name) {
      throw new HttpError(
        400,
        "PERMISSION_TEMPLATE_SYSTEM_LOCKED",
        "System templates keep their name; duplicate the template to customise it",
      );
    }
    data.name = name;
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description);
  if (payload.kind !== undefined) {
    if (!TEMPLATE_KINDS.includes(payload.kind)) {
      throw new HttpError(400, "PERMISSION_TEMPLATE_KIND_INVALID", "kind must be internal or external");
    }
    data.kind = payload.kind;
  }
  if (payload.clientType !== undefined) {
    data.clientType = CLIENT_TYPES.includes(payload.clientType) ? payload.clientType : null;
  }
  const base = normalizeBase({
    baseRole: payload.baseRole,
    basePartyRole: payload.basePartyRole,
    kind: data.kind || existing.kind,
  });
  if (base.baseRole !== undefined) data.baseRole = base.baseRole || null;
  if (base.basePartyRole !== undefined) data.basePartyRole = base.basePartyRole || null;
  if (payload.status !== undefined) {
    if (!Object.values(TEMPLATE_STATUSES).includes(payload.status)) {
      throw new HttpError(400, "PERMISSION_TEMPLATE_STATUS_INVALID", "status must be active or archived");
    }
    data.status = payload.status;
  }

  const tools = normalizeTools(payload.tools);
  const grants = normalizeGrants(payload.grants);

  const template = await prisma.$transaction(async (tx) => {
    if (data.name) await assertUniqueName({ tx, orgId, name: data.name, excludeId: templateId });
    if (tools !== undefined) {
      await tx.permissionTemplateTool.deleteMany({ where: { templateId } });
      if (tools.length) {
        await tx.permissionTemplateTool.createMany({
          data: tools.map((tool) => ({ templateId, ...tool })),
        });
      }
    }
    if (grants !== undefined) {
      await tx.permissionTemplateGrant.deleteMany({ where: { templateId } });
      if (grants.length) {
        await tx.permissionTemplateGrant.createMany({
          data: grants.map((grant) => ({ templateId, ...grant })),
        });
      }
    }
    const updated = await tx.permissionTemplate.update({
      where: { id: templateId },
      data,
      include: templateListInclude,
    });
    await recordOrgAudit({
      tx,
      orgId,
      actorId,
      actorRole,
      entityType: "permission_template",
      entityId: templateId,
      action: "updated",
      metadata: {
        fields: Object.keys(data).filter((key) => key !== "updatedBy"),
        tools: tools?.length ?? null,
        grants: grants?.length ?? null,
      },
    });
    return updated;
  });

  invalidateTemplateCache(templateId);
  return serializeTemplate(template);
};

const archiveTemplate = async ({ orgId, templateId, actorId = null, actorRole = null }) => {
  const existing = await requireTemplate({ orgId, templateId });
  if (existing.isSystem) {
    throw new HttpError(
      400,
      "PERMISSION_TEMPLATE_SYSTEM_LOCKED",
      "System default templates cannot be archived",
    );
  }
  const inUse =
    (existing._count?.userPermissions ?? 0) + (existing._count?.projectParties ?? 0);
  if (inUse > 0) {
    throw new HttpError(
      409,
      "PERMISSION_TEMPLATE_IN_USE",
      `Template is assigned to ${inUse} project user(s)/parties; reassign them first`,
    );
  }

  const template = await prisma.$transaction(async (tx) => {
    const updated = await tx.permissionTemplate.update({
      where: { id: templateId },
      data: { status: TEMPLATE_STATUSES.ARCHIVED, updatedBy: actorId },
      include: templateListInclude,
    });
    await recordOrgAudit({
      tx,
      orgId,
      actorId,
      actorRole,
      entityType: "permission_template",
      entityId: templateId,
      action: "archived",
    });
    return updated;
  });

  invalidateTemplateCache(templateId);
  return serializeTemplate(template);
};

const duplicateTemplate = async ({
  orgId,
  templateId,
  payload = {},
  actorId = null,
  actorRole = null,
}) => {
  const source = await requireTemplate({ orgId, templateId });
  return createTemplate({
    orgId,
    actorId,
    actorRole,
    payload: {
      name: trimOrNull(payload.name) || `${source.name} (copy)`,
      description: payload.description ?? source.description,
      kind: source.kind,
      clientType: source.clientType,
      baseRole: source.baseRole,
      basePartyRole: source.basePartyRole,
      tools: source.tools.map((tool) => ({ module: tool.module, level: tool.level })),
      grants: source.grants.map((grant) => ({
        module: grant.module,
        action: grant.action,
        transition: grant.transition,
      })),
    },
  });
};

/** Idempotently creates the system default templates for an organisation. */
const seedDefaultTemplates = async ({ tx = prisma, orgId }) => {
  if (!orgId || !tx.permissionTemplate?.findMany) return { created: 0 };
  const existing = await tx.permissionTemplate.findMany({
    where: { orgId, name: { in: DEFAULT_TEMPLATES.map((template) => template.name) } },
    select: { name: true },
  });
  const present = new Set(existing.map((row) => row.name));
  const missing = DEFAULT_TEMPLATES.filter((template) => !present.has(template.name));
  if (!missing.length) return { created: 0 };

  await tx.permissionTemplate.createMany({
    data: missing.map((template) => ({
      orgId,
      name: template.name,
      description: template.description,
      kind: template.kind,
      clientType: template.clientType,
      baseRole: template.baseRole || null,
      basePartyRole: template.basePartyRole || null,
      isDefault: true,
      isSystem: true,
      status: TEMPLATE_STATUSES.ACTIVE,
    })),
    skipDuplicates: true,
  });
  return { created: missing.length };
};

// ─── Project team & assignments ─────────────────────────────────────────────

const listProjectTeam = async ({ orgId, projectId }) => {
  const [assignments, parties, permissions] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, status: true, isCompanyAdmin: true } },
      },
    }),
    prisma.projectParty.findMany({
      where: { projectId, status: "active" },
      include: {
        company: { select: { id: true, name: true } },
        permissionTemplate: { select: { id: true, name: true } },
        members: {
          where: { status: "active" },
          include: {
            user: { select: { id: true, name: true, email: true, role: true, status: true } },
          },
        },
      },
    }),
    prisma.projectUserPermission.findMany({
      where: { projectId },
      include: { template: { select: { id: true, name: true, status: true } } },
    }),
  ]);

  const permissionByUser = new Map(permissions.map((row) => [row.userId, row]));
  const members = new Map();

  for (const assignment of assignments) {
    if (!assignment.user) continue;
    members.set(assignment.userId, {
      userId: assignment.userId,
      name: assignment.user.name,
      email: assignment.user.email,
      orgRole: normalizeRoleId(assignment.user.role),
      isCompanyAdmin: Boolean(assignment.user.isCompanyAdmin),
      status: assignment.user.status,
      assignmentRole: normalizeRoleId(assignment.role),
      party: null,
    });
  }
  for (const party of parties) {
    for (const member of party.members) {
      if (!member.user) continue;
      const existing = members.get(member.userId);
      const partyInfo = {
        id: party.id,
        role: normalizePartyRoleId(party.role),
        companyId: party.companyId,
        companyName: party.company?.name || null,
        template: party.permissionTemplate
          ? { id: party.permissionTemplate.id, name: party.permissionTemplate.name }
          : null,
      };
      if (existing) {
        existing.party = existing.party || partyInfo;
      } else {
        members.set(member.userId, {
          userId: member.userId,
          name: member.user.name,
          email: member.user.email,
          orgRole: normalizeRoleId(member.user.role),
          isCompanyAdmin: false,
          status: member.user.status,
          assignmentRole: null,
          party: partyInfo,
        });
      }
    }
  }

  const items = [...members.values()].map((member) => {
    const permission = permissionByUser.get(member.userId);
    const template = permission?.template
      ? { id: permission.template.id, name: permission.template.name, status: permission.template.status }
      : null;
    return {
      ...member,
      template,
      overrides: permission?.overridesJson || {},
      source: template
        ? "template"
        : member.party?.template
          ? "party_template"
          : member.assignmentRole
            ? "assignment"
            : member.party
              ? "party"
              : "org",
    };
  });

  items.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return {
    items,
    parties: parties.map((party) => ({
      id: party.id,
      role: normalizePartyRoleId(party.role),
      companyId: party.companyId || null,
      companyName: party.company?.name || null,
      memberCount: party.members.length,
      template: party.permissionTemplate
        ? { id: party.permissionTemplate.id, name: party.permissionTemplate.name }
        : null,
    })),
  };
};

/**
 * Put an existing colleague on a project.
 *
 * OctaPM could already tell somebody "assign the user to the project before
 * setting a permission template" and then offer no way to do it: the only
 * route onto a project was an email invitation the person had to accept, which
 * is the wrong shape entirely for a colleague who already has an account. So a
 * newly created project had a team of one, and every other persona was refused
 * with PROJECT_ACCESS_DENIED (OCTA-UX-TEAM-093).
 *
 * This is deliberately not a new access model. It writes the same
 * ProjectAssignment row that accepting an invitation writes, which is what
 * `assertProjectAccess` already reads and what `listProjectTeam` already
 * shows. Permission templates layer over it exactly as before.
 *
 * The project role is what this person does *here*. It defaults to the role
 * they carry in the company, because that is right nearly all of the time, but
 * a planner brought onto a job to run cost control can be assigned as one
 * without changing who they are elsewhere.
 */
const addProjectMember = async ({
  orgId,
  projectId,
  userId,
  role = null,
  actorId = null,
  actorRole = null,
}) => {
  const [project, user] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } }),
    prisma.user.findFirst({
      where: { id: userId, orgId },
      select: { id: true, name: true, email: true, role: true, status: true, isCompanyAdmin: true },
    }),
  ]);

  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }
  // Scoped to the organisation on purpose: this adds a colleague, never
  // somebody from another company. An external party joins through
  // ProjectParty, which has its own invitation and its own visibility rules.
  if (!user) {
    throw new HttpError(404, "USER_NOT_IN_ORGANISATION", "That user is not in this organisation");
  }
  if (user.status !== "active") {
    throw new HttpError(
      409,
      "USER_NOT_ACTIVE",
      `${user.name || user.email} is ${user.status}, so they cannot be added to a project`,
    );
  }

  const projectRole = normalizeRoleId(trimOrNull(role)) || normalizeRoleId(user.role);

  const existing = await prisma.projectAssignment.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true, role: true },
  });

  const assignment = await prisma.$transaction(async (tx) => {
    const row = await tx.projectAssignment.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, role: projectRole },
      update: { role: projectRole },
    });

    await recordOrgAudit({
      tx,
      orgId,
      actorId,
      actorRole,
      entityType: "project_assignment",
      entityId: row.id,
      // Re-adding somebody who is already on the project is a role change, and
      // reads as one in the log rather than as a second joining.
      action: existing ? "role_changed" : "assigned",
      metadata: {
        projectId,
        userId,
        email: user.email,
        role: projectRole,
        previousRole: existing ? normalizeRoleId(existing.role) : null,
      },
    });

    return row;
  });

  return {
    userId,
    name: user.name,
    email: user.email,
    orgRole: normalizeRoleId(user.role),
    isCompanyAdmin: Boolean(user.isCompanyAdmin),
    status: user.status,
    assignmentRole: normalizeRoleId(assignment.role),
    alreadyOnProject: Boolean(existing),
  };
};

/**
 * Take somebody off one project.
 *
 * Only the join row goes. Their account, their other projects and everything
 * they ever authored here are untouched — a removed person's change orders,
 * receipts and approvals still name them, because a project record that
 * quietly loses its author is worse than one belonging to somebody who has
 * moved on.
 */
const removeProjectMember = async ({
  orgId,
  projectId,
  userId,
  actorId = null,
  actorRole = null,
}) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true },
  });
  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  const assignment = await prisma.projectAssignment.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true, role: true, user: { select: { email: true } } },
  });
  if (!assignment) {
    throw new HttpError(404, "PROJECT_MEMBER_NOT_FOUND", "That user is not on this project");
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectAssignment.delete({ where: { id: assignment.id } });
    // The permission template was granted for this project, so it goes with
    // the assignment; leaving it behind would silently re-grant on re-add.
    await tx.projectUserPermission.deleteMany({ where: { orgId, projectId, userId } });

    await recordOrgAudit({
      tx,
      orgId,
      actorId,
      actorRole,
      entityType: "project_assignment",
      entityId: assignment.id,
      action: "removed",
      metadata: {
        projectId,
        userId,
        email: assignment.user?.email || null,
        role: normalizeRoleId(assignment.role),
      },
    });
  });

  return { userId, projectId, removed: true };
};

/**
 * Colleagues who could be added, with the ones already here marked.
 *
 * Returning everybody and flagging membership beats filtering the list: the
 * common question at this screen is "is Priya already on this job?", and a
 * name that is simply absent does not answer it.
 */
const listAssignableUsers = async ({ orgId, projectId, search = null }) => {
  const [users, assignments] = await Promise.all([
    prisma.user.findMany({
      where: {
        orgId,
        status: "active",
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, email: true, role: true, isCompanyAdmin: true },
      orderBy: [{ name: "asc" }],
      take: 200,
    }),
    prisma.projectAssignment.findMany({ where: { projectId }, select: { userId: true } }),
  ]);

  const onProject = new Set(assignments.map((row) => row.userId));
  return {
    items: users.map((user) => ({
      userId: user.id,
      name: user.name,
      email: user.email,
      orgRole: normalizeRoleId(user.role),
      isCompanyAdmin: Boolean(user.isCompanyAdmin),
      onProject: onProject.has(user.id),
    })),
  };
};

const assertUserOnProject = async ({ tx, projectId, userId }) => {
  const [assignment, membership] = await Promise.all([
    tx.projectAssignment.findFirst({ where: { projectId, userId }, select: { id: true } }),
    tx.projectPartyMember.findFirst({
      where: { userId, status: "active", projectParty: { projectId, status: "active" } },
      select: { id: true },
    }),
  ]);
  if (!assignment && !membership) {
    throw new HttpError(
      400,
      "PROJECT_USER_NOT_MEMBER",
      "Assign the user to the project (or a project party) before setting a permission template",
    );
  }
};

const normalizeOverrides = (overrides) => {
  if (!overrides || typeof overrides !== "object") return {};
  const tools = {};
  for (const [module, level] of Object.entries(overrides.tools || {})) {
    assertModule(module);
    tools[module] = normalizeLevel(level);
  }
  const grants = (normalizeGrants(overrides.grants) || []).map((grant) => grant.key);
  return { ...(Object.keys(tools).length ? { tools } : {}), ...(grants.length ? { grants } : {}) };
};

const setProjectUserPermission = async ({
  orgId,
  projectId,
  userId,
  payload = {},
  actorId = null,
  actorRole = null,
}) => {
  const templateId = trimOrNull(payload.templateId);
  const overrides = normalizeOverrides(payload.overrides);

  const row = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, orgId }, select: { id: true } });
    if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
    await assertUserOnProject({ tx, projectId, userId });
    if (templateId) await requireTemplate({ tx, orgId, templateId });

    const saved = await tx.projectUserPermission.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { orgId, projectId, userId, templateId, overridesJson: overrides, assignedBy: actorId },
      update: { templateId, overridesJson: overrides, assignedBy: actorId },
      include: { template: { select: { id: true, name: true, status: true } } },
    });
    await recordOrgAudit({
      tx,
      orgId,
      actorId,
      actorRole,
      entityType: "project_user_permission",
      entityId: saved.id,
      action: "assigned",
      metadata: { projectId, userId, templateId, overrides },
    });
    return saved;
  });

  return {
    id: row.id,
    projectId,
    userId,
    template: row.template ? { id: row.template.id, name: row.template.name } : null,
    overrides: row.overridesJson || {},
    assignedBy: row.assignedBy || null,
    updatedAt: toIso(row.updatedAt),
  };
};

const removeProjectUserPermission = async ({
  orgId,
  projectId,
  userId,
  actorId = null,
  actorRole = null,
}) => {
  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.projectUserPermission.deleteMany({
      where: { orgId, projectId, userId },
    });
    if (deleted.count) {
      await recordOrgAudit({
        tx,
        orgId,
        actorId,
        actorRole,
        entityType: "project_user_permission",
        entityId: `${projectId}:${userId}`,
        action: "removed",
        metadata: { projectId, userId },
      });
    }
    return deleted;
  });
  return { removed: result.count > 0, projectId, userId };
};

const setPartyTemplate = async ({
  orgId,
  projectId,
  partyId,
  payload = {},
  actorId = null,
  actorRole = null,
}) => {
  const templateId = trimOrNull(payload.templateId);
  const party = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectParty.findFirst({
      where: { id: partyId, projectId, project: { orgId } },
      select: { id: true },
    });
    if (!existing) throw new HttpError(404, "PROJECT_PARTY_NOT_FOUND", "Project party not found");
    if (templateId) {
      const template = await requireTemplate({ tx, orgId, templateId });
      if (template.kind !== "external") {
        throw new HttpError(
          400,
          "PERMISSION_TEMPLATE_KIND_MISMATCH",
          "Project parties take external templates",
        );
      }
    }
    const updated = await tx.projectParty.update({
      where: { id: partyId },
      data: { permissionTemplateId: templateId },
      include: { permissionTemplate: { select: { id: true, name: true } } },
    });
    await recordOrgAudit({
      tx,
      orgId,
      actorId,
      actorRole,
      entityType: "project_party_permission",
      entityId: partyId,
      action: "assigned",
      metadata: { projectId, templateId },
    });
    return updated;
  });

  return {
    id: party.id,
    projectId,
    template: party.permissionTemplate
      ? { id: party.permissionTemplate.id, name: party.permissionTemplate.name }
      : null,
  };
};

module.exports = {
  CLIENT_TYPES,
  COMPANY_ADMIN_MODULES,
  DEFAULT_TEMPLATES,
  LEVELS,
  LEVEL_VALUES,
  TEMPLATE_KINDS,
  TEMPLATE_STATUSES,
  archiveTemplate,
  attachTemplateContext,
  buildMatrix,
  compileTemplate,
  createTemplate,
  duplicateTemplate,
  effectiveLevel,
  getCatalog,
  getTemplate,
  grantKey,
  invalidateTemplateCache,
  addProjectMember,
  listAssignableUsers,
  listProjectTeam,
  removeProjectMember,
  listTemplates,
  parseGrantKey,
  projectsWhereTemplateDenies,
  removeProjectUserPermission,
  resolveOrgPermissions,
  resolveProjectPermissions,
  resolveTemplateContext,
  seedDefaultTemplates,
  serializeTemplate,
  setPartyTemplate,
  setProjectUserPermission,
  templateAllows,
  updateTemplate,
};
