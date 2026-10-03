const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { normalizeRoleId } = require("../config/permissions");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const tools = require("./workflow-tools");
const customFields = require("./custom-field.service");

/**
 * Configurable workflow engine (OCTA-PLAT-WF-024).
 *
 * A template is an ordered set of steps: `response` steps ask people (by
 * user, project role, party role or permission template) to pick one of the
 * step's responses within N days, each response naming the next step or an
 * end (success / fail); `condition` steps branch on the record's context
 * (amount, type…); `action` steps notify and move on. Templates carry rules
 * for when they apply, so a change order above a threshold can take a longer
 * route without a code change. While an instance runs, the record's own
 * approve / reject endpoints are locked; the outcome is applied through the
 * record's service. Every step response lands in ApprovalWorkflowEvent, and a
 * scan escalates steps past their SLA.
 */

const STEP_TYPES = Object.freeze(["response", "condition", "action"]);
const ENDS = Object.freeze(["end_success", "end_fail"]);
const ASSIGNEE_TYPES = Object.freeze(["user", "role", "party_role", "permission_template"]);
const PROJECT_ROLES = Object.freeze(["pm", "planning_eng", "qs", "cost_controller", "procurement", "warehouse", "site_engineer", "finance"]);
const PARTY_ROLES = Object.freeze(["owner", "consultant", "contractor", "subcontractor"]);
const TONES = Object.freeze(["positive", "negative", "neutral"]);
const CONDITION_OPS = Object.freeze(["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "contains", "is_true", "is_false", "empty", "not_empty"]);
const INSTANCE_STATUS = Object.freeze({ RUNNING: "running", SUCCEEDED: "succeeded", FAILED: "failed", CANCELLED: "cancelled" });
const ASSIGNMENT_STATUS = Object.freeze({ PENDING: "pending", RESPONDED: "responded", SKIPPED: "skipped" });
const MAX_STEPS = 20;
const MAX_HOPS = 60;
const DAY_MS = 86_400_000;
const EVENT_WORKFLOW_TYPE = "workflow_engine";

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const uniqueIds = (values) => [...new Set((values || []).filter(Boolean))];
const slug = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ─── template normalisation ────────────────────────────────────────────────

const normalizeAssignee = (entry, stepName) => {
  const type = ASSIGNEE_TYPES.includes(entry?.type) ? entry.type : null;
  const bad = (message) => new HttpError(400, "WORKFLOW_TEMPLATE_ASSIGNEE", `Step "${stepName}": ${message}`);
  if (!type) throw bad("assignee type must be user, role, party_role or permission_template");
  if (type === "user") {
    const userId = trimOrNull(entry.userId);
    if (!userId) throw bad("user assignee needs a userId");
    return { type, userId };
  }
  if (type === "role") {
    const role = normalizeRoleId(trimOrNull(entry.role));
    if (!PROJECT_ROLES.includes(role)) throw bad(`unknown project role ${entry.role}`);
    return { type, role };
  }
  if (type === "party_role") {
    const role = trimOrNull(entry.role);
    if (!PARTY_ROLES.includes(role)) throw bad(`unknown party role ${entry.role}`);
    return { type, role };
  }
  const templateId = trimOrNull(entry.templateId);
  if (!templateId) throw bad("permission_template assignee needs a templateId");
  return { type, templateId };
};

const normalizeCondition = (condition, stepName) => {
  const field = trimOrNull(condition?.field);
  const op = trimOrNull(condition?.op);
  if (!field) throw new HttpError(400, "WORKFLOW_TEMPLATE_CONDITION", `Step "${stepName}": condition needs a field`);
  if (!CONDITION_OPS.includes(op)) throw new HttpError(400, "WORKFLOW_TEMPLATE_CONDITION", `Step "${stepName}": unknown operator ${op}`);
  return { field, op, value: condition.value === undefined ? null : condition.value };
};

const normalizeSteps = (steps) => {
  if (!Array.isArray(steps) || !steps.length) throw new HttpError(400, "WORKFLOW_TEMPLATE_STEPS_REQUIRED", "Add at least one step");
  if (steps.length > MAX_STEPS) throw new HttpError(400, "WORKFLOW_TEMPLATE_TOO_MANY_STEPS", `At most ${MAX_STEPS} steps`);
  const keys = new Set();
  const normalized = steps.map((step, index) => {
    const name = trimOrNull(step?.name) || `Step ${index + 1}`;
    const key = trimOrNull(step?.key) || slug(name) || `step_${index + 1}`;
    if (keys.has(key)) throw new HttpError(400, "WORKFLOW_TEMPLATE_STEP_KEY", `Step key "${key}" is used twice`);
    keys.add(key);
    const type = STEP_TYPES.includes(step?.type) ? step.type : "response";
    const base = { key, name, type, description: trimOrNull(step?.description) };
    if (type === "response") {
      const assignees = (Array.isArray(step.assignees) ? step.assignees : []).map((entry) => normalizeAssignee(entry, name));
      if (!assignees.length) throw new HttpError(400, "WORKFLOW_TEMPLATE_ASSIGNEE", `Step "${name}": add at least one assignee`);
      const responses = (Array.isArray(step.responses) ? step.responses : []).map((response, i) => {
        const label = trimOrNull(response?.label) || `Response ${i + 1}`;
        const responseKey = trimOrNull(response?.key) || slug(label) || `response_${i + 1}`;
        const next = trimOrNull(response?.next);
        if (!next) throw new HttpError(400, "WORKFLOW_TEMPLATE_RESPONSE", `Step "${name}": response "${label}" needs a next step or end`);
        const tone = TONES.includes(response?.tone) ? response.tone : next === "end_fail" ? "negative" : next === "end_success" ? "positive" : "neutral";
        return { key: responseKey, label, next, tone, requireComment: Boolean(response?.requireComment) };
      });
      if (!responses.length) throw new HttpError(400, "WORKFLOW_TEMPLATE_RESPONSE", `Step "${name}": add at least one response`);
      const days = step.days === null || step.days === undefined || step.days === "" ? null : Math.max(0, Math.round(Number(step.days)));
      if (days !== null && !Number.isFinite(days)) throw new HttpError(400, "WORKFLOW_TEMPLATE_DAYS", `Step "${name}": days must be a number`);
      const escalateRoles = uniqueIds((Array.isArray(step.escalateRoles) ? step.escalateRoles : ["pm"]).map((role) => normalizeRoleId(role))).filter((role) => PROJECT_ROLES.includes(role));
      return { ...base, assignees, responses, requireAll: Boolean(step.requireAll), days, escalateRoles };
    }
    if (type === "condition") {
      const whenTrue = trimOrNull(step.whenTrue);
      const whenFalse = trimOrNull(step.whenFalse);
      if (!whenTrue || !whenFalse) throw new HttpError(400, "WORKFLOW_TEMPLATE_CONDITION", `Step "${name}": set where to go when true and when false`);
      return { ...base, condition: normalizeCondition(step.condition, name), whenTrue, whenFalse };
    }
    const next = trimOrNull(step.next);
    if (!next) throw new HttpError(400, "WORKFLOW_TEMPLATE_ACTION", `Step "${name}": action needs a next step or end`);
    const action = step.action && typeof step.action === "object" ? step.action : {};
    return {
      ...base,
      action: {
        type: "notify",
        roles: uniqueIds((Array.isArray(action.roles) ? action.roles : []).map(normalizeRoleId)).filter((role) => PROJECT_ROLES.includes(role)),
        userIds: uniqueIds(Array.isArray(action.userIds) ? action.userIds : []),
        message: trimOrNull(action.message),
      },
      next,
    };
  });
  // Every target must exist.
  const targets = (step) => (step.type === "response" ? step.responses.map((response) => response.next) : step.type === "condition" ? [step.whenTrue, step.whenFalse] : [step.next]);
  for (const step of normalized) {
    for (const target of targets(step)) {
      if (!ENDS.includes(target) && !keys.has(target)) throw new HttpError(400, "WORKFLOW_TEMPLATE_TARGET", `Step "${step.name}" points at unknown step "${target}"`);
    }
  }
  return normalized;
};

const normalizeRules = (rules) => (Array.isArray(rules) ? rules : []).map((rule, index) => normalizeCondition(rule, `rule ${index + 1}`));

const normalizeTemplate = (payload = {}, existing = null) => {
  const tool = tools.getTool(payload.tool ?? existing?.tool);
  if (!tool) throw new HttpError(400, "WORKFLOW_TOOL_UNKNOWN", `Unknown tool: ${payload.tool ?? existing?.tool}`);
  const name = payload.name !== undefined ? trimOrNull(payload.name) : existing?.name;
  if (!name) throw new HttpError(400, "WORKFLOW_TEMPLATE_NAME_REQUIRED", "Give the workflow a name");
  const steps = normalizeSteps(payload.steps ?? existing?.stepsJson);
  const startStep = trimOrNull(payload.startStep ?? existing?.startStep) || steps[0].key;
  if (!steps.some((step) => step.key === startStep)) throw new HttpError(400, "WORKFLOW_TEMPLATE_START", `Start step "${startStep}" does not exist`);
  return {
    tool: tool.key,
    name,
    description: payload.description !== undefined ? trimOrNull(payload.description) : existing?.description ?? null,
    isDefault: payload.isDefault !== undefined ? Boolean(payload.isDefault) : Boolean(existing?.isDefault),
    priority: payload.priority !== undefined ? Math.round(Number(payload.priority) || 0) : existing?.priority ?? 0,
    rulesJson: normalizeRules(payload.rules ?? existing?.rulesJson),
    stepsJson: steps,
    startStep,
  };
};

// ─── conditions ────────────────────────────────────────────────────────────

const evaluateCondition = (context, { field, op, value }) => {
  const actual = context?.[field];
  const lower = (item) => String(item ?? "").toLowerCase();
  switch (op) {
    case "eq":
      return typeof actual === "number" ? actual === Number(value) : lower(actual) === lower(value);
    case "neq":
      return !evaluateCondition(context, { field, op: "eq", value });
    case "gt":
      return Number(actual) > Number(value);
    case "gte":
      return Number(actual) >= Number(value);
    case "lt":
      return Number(actual) < Number(value);
    case "lte":
      return Number(actual) <= Number(value);
    case "in":
      return (Array.isArray(value) ? value : String(value ?? "").split(",")).map(lower).includes(lower(actual));
    case "nin":
      return !evaluateCondition(context, { field, op: "in", value });
    case "contains":
      return lower(actual).includes(lower(value));
    case "is_true":
      return actual === true;
    case "is_false":
      return actual === false || actual === null || actual === undefined;
    case "empty":
      return actual === null || actual === undefined || actual === "";
    case "not_empty":
      return !(actual === null || actual === undefined || actual === "");
    default:
      return false;
  }
};

const rulesMatch = (rules, context) => (rules || []).every((rule) => evaluateCondition(context, rule));

/** The tool's context plus the record's custom fields as `custom.<key>` (OCTA-PLAT-FIELDS-025). */
const contextWithCustomFields = async ({ orgId, tool, record }) => ({
  ...tool.context(record),
  ...(await customFields.contextFor({ orgId, recordType: tool.key, recordId: record.id }).catch(() => ({}))),
});

/** Tool catalogue with the organisation's custom fields appended to each tool's context fields. */
const describeTools = async ({ orgId }) =>
  Promise.all(
    tools.TOOL_KEYS.map(async (key) => {
      const tool = tools.getTool(key);
      const described = tools.describeTool(tool);
      const extra = await customFields.customContextFields({ orgId, recordType: key }).catch(() => []);
      return { ...described, contextFields: [...described.contextFields, ...extra] };
    }),
  );

// ─── templates ─────────────────────────────────────────────────────────────

const serializeTemplate = (row) => ({
  id: row.id,
  projectId: row.projectId || null,
  scope: row.projectId ? "project" : "company",
  tool: row.tool,
  toolLabel: tools.getTool(row.tool)?.label || row.tool,
  name: row.name,
  description: row.description || null,
  isDefault: row.isDefault,
  priority: row.priority,
  status: row.status,
  rules: Array.isArray(row.rulesJson) ? row.rulesJson : [],
  steps: Array.isArray(row.stepsJson) ? row.stepsJson : [],
  startStep: row.startStep || null,
  isSystem: Boolean(row.isSystem),
  instanceCount: row._count?.instances ?? null,
  createdBy: row.createdBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const listTools = () => tools.TOOL_KEYS.map((key) => tools.describeTool(tools.getTool(key)));

/**
 * A route's rules (an amount threshold) and steps (who decides) are its
 * tool's business: with a `viewer` (see visibleRunIds below) only the
 * templates of tools whose module the viewer reads are listed (L41).
 */
const listTemplates = async ({ orgId, projectId = null, tool = null, includeArchived = false, scope = "all", viewer = null }) => {
  const where = { orgId, ...(tool ? { tool } : {}), ...(includeArchived ? {} : { status: "active" }) };
  if (scope === "company") where.projectId = null;
  else if (projectId) where.OR = [{ projectId }, { projectId: null }];
  else where.projectId = null;
  const rows = await prisma.workflowTemplate.findMany({ where, include: { _count: { select: { instances: true } } }, orderBy: [{ tool: "asc" }, { projectId: "desc" }, { priority: "desc" }, { name: "asc" }] });
  const shown = viewer ? rows.filter((row) => tools.getTool(row.tool) && viewer.canRead(tools.getTool(row.tool).module)) : rows;
  return shown.map(serializeTemplate);
};

const getTemplateRow = async ({ orgId, templateId, projectId = null }) => {
  const row = await prisma.workflowTemplate.findFirst({ where: { id: templateId, orgId, ...(projectId !== undefined && projectId !== null ? { OR: [{ projectId }, { projectId: null }] } : {}) }, include: { _count: { select: { instances: true } } } });
  if (!row) throw new HttpError(404, "WORKFLOW_TEMPLATE_NOT_FOUND", "Workflow template not found");
  return row;
};

/**
 * What a template's steps name must be the company's own, checked before the
 * template is written: its people (response-step assignees and action-step
 * recipients) members of the company (404 USER_NOT_FOUND), its permission
 * templates the company's (404 PERMISSION_TEMPLATE_NOT_FOUND) — answered as
 * for an id that exists nowhere. A template used to be stored naming another
 * company's person or permission template; running it then skipped them, but
 * the reference stayed (CERT-2 injection sweep).
 */
const assertTemplateReferences = async ({ orgId, steps }) => {
  const refs = require("./tenant-references.service");
  await refs.assertMembers({ orgId, userIds: steps.flatMap((step) => [...(step.assignees || []).filter((entry) => entry.type === "user").map((entry) => entry.userId), ...(step.action?.userIds || [])]) });
  const templateIds = refs.idsOf(steps.flatMap((step) => (step.assignees || []).filter((entry) => entry.type === "permission_template").map((entry) => entry.templateId)));
  if (!templateIds.length) return;
  const found = await prisma.permissionTemplate.findMany({ where: { id: { in: templateIds }, orgId }, select: { id: true } });
  if (found.length !== templateIds.length) throw new HttpError(404, "PERMISSION_TEMPLATE_NOT_FOUND", "Permission template not found");
};

const clearOtherDefaults = async ({ tx, orgId, projectId, tool, exceptId }) =>
  tx.workflowTemplate.updateMany({ where: { orgId, projectId: projectId ?? null, tool, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, data: { isDefault: false } });

const createTemplate = async ({ orgId, projectId = null, payload = {}, actor = null }) => {
  const data = normalizeTemplate(payload);
  await assertTemplateReferences({ orgId, steps: data.stepsJson });
  const row = await prisma.$transaction(async (tx) => {
    if (data.isDefault) await clearOtherDefaults({ tx, orgId, projectId, tool: data.tool });
    return tx.workflowTemplate.create({ data: { orgId, projectId, ...data, createdBy: actor?.id || null } });
  });
  await auditService.recordEvent({ orgId, projectId: projectId || null, entityType: auditService.ENTITY_TYPES.WORKFLOW_TEMPLATE || "workflow_template", entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { name: row.name, tool: row.tool, steps: data.stepsJson.length, isDefault: row.isDefault } }).catch(() => null);
  return serializeTemplate(row);
};

const updateTemplate = async ({ orgId, projectId = null, templateId, payload = {}, actor = null }) => {
  const existing = await getTemplateRow({ orgId, templateId });
  if ((existing.projectId || null) !== (projectId || null)) throw new HttpError(403, "WORKFLOW_TEMPLATE_SCOPE", existing.projectId ? "This template belongs to a project" : "Company templates are edited under Company › Workflows");
  const data = normalizeTemplate(payload, existing);
  if (payload.steps !== undefined) await assertTemplateReferences({ orgId, steps: data.stepsJson });
  const status = payload.status !== undefined ? (payload.status === "archived" ? "archived" : "active") : existing.status;
  const row = await prisma.$transaction(async (tx) => {
    if (data.isDefault) await clearOtherDefaults({ tx, orgId, projectId: existing.projectId, tool: data.tool, exceptId: existing.id });
    return tx.workflowTemplate.update({ where: { id: existing.id }, data: { ...data, status, archivedAt: status === "archived" ? existing.archivedAt || new Date() : null, updatedBy: actor?.id || null }, include: { _count: { select: { instances: true } } } });
  });
  await auditService.recordEvent({ orgId, projectId: existing.projectId || null, entityType: auditService.ENTITY_TYPES.WORKFLOW_TEMPLATE || "workflow_template", entityId: row.id, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { name: row.name, tool: row.tool, status, fields: Object.keys(payload) } }).catch(() => null);
  return serializeTemplate(row);
};

const archiveTemplate = async ({ orgId, projectId = null, templateId, actor = null }) => updateTemplate({ orgId, projectId, templateId, payload: { status: "archived", isDefault: false }, actor });

// ─── default templates ─────────────────────────────────────────────────────

const approveReject = ({ approveLabel = "Approve", rejectLabel = "Reject" } = {}) => [
  { key: "approve", label: approveLabel, next: "end_success", tone: "positive" },
  { key: "reject", label: rejectLabel, next: "end_fail", tone: "negative", requireComment: true },
];

const DEFAULT_TEMPLATES = Object.freeze({
  change_order: { name: "Change order — PM approval", steps: [{ key: "pm_approval", name: "PM approval", type: "response", assignees: [{ type: "role", role: "pm" }], days: 5, responses: approveReject() }] },
  commitment: { name: "Commitment — PM approval", steps: [{ key: "pm_approval", name: "PM approval", type: "response", assignees: [{ type: "role", role: "pm" }], days: 5, responses: approveReject({ rejectLabel: "Return for changes" }) }] },
  sub_pay_app: {
    name: "Pay application — QS review then PM approval",
    steps: [
      { key: "qs_review", name: "QS review", type: "response", assignees: [{ type: "role", role: "qs" }], days: 3, responses: [{ key: "forward", label: "Forward to PM", next: "pm_approval", tone: "positive" }, { key: "reject", label: "Reject", next: "end_fail", tone: "negative", requireComment: true }] },
      { key: "pm_approval", name: "PM approval", type: "response", assignees: [{ type: "role", role: "pm" }], days: 5, responses: approveReject() },
    ],
  },
  ipc_certificate: { name: "IPC — certification", steps: [{ key: "certify", name: "Certification", type: "response", assignees: [{ type: "role", role: "pm" }, { type: "role", role: "finance" }], days: 5, responses: [{ key: "certify", label: "Certify", next: "end_success", tone: "positive" }, { key: "hold", label: "Hold", next: "end_fail", tone: "negative", requireComment: true }] }] },
  budget_revision: { name: "Budget revision — PM approval", steps: [{ key: "pm_approval", name: "PM approval", type: "response", assignees: [{ type: "role", role: "pm" }], days: 5, responses: approveReject() }] },
  submittal: { name: "Submittal — reviewer approval", steps: [{ key: "review", name: "Review", type: "response", assignees: [{ type: "role", role: "pm" }], days: 10, responses: approveReject({ rejectLabel: "Revise and resubmit" }) }] },
  correspondence: { name: "Correspondence — close-out", steps: [{ key: "closeout", name: "Close-out approval", type: "response", assignees: [{ type: "role", role: "pm" }], days: 7, responses: [{ key: "close", label: "Close", next: "end_success", tone: "positive" }, { key: "keep_open", label: "Keep open", next: "end_fail", tone: "negative", requireComment: true }] }] },
  document_revision: { name: "Document revision — approval", steps: [{ key: "approve", name: "Document approval", type: "response", assignees: [{ type: "role", role: "pm" }], days: 5, responses: approveReject({ rejectLabel: "Return" }) }] },
});

/** A worked example with a rule and a condition: large change orders take a second (finance) step. */
const EXAMPLE_TEMPLATE = Object.freeze({
  tool: "change_order",
  name: "Change order — finance step above 50,000",
  description: "Applies to change orders valued at 50,000 or more: PM approval, then finance sign-off.",
  priority: 10,
  rules: [{ field: "amount", op: "gte", value: 50000 }],
  steps: [
    { key: "pm_approval", name: "PM approval", type: "response", assignees: [{ type: "role", role: "pm" }], days: 5, responses: [{ key: "approve", label: "Approve", next: "check_amount", tone: "positive" }, { key: "reject", label: "Reject", next: "end_fail", tone: "negative", requireComment: true }] },
    { key: "check_amount", name: "Over 250,000?", type: "condition", condition: { field: "amount", op: "gte", value: 250000 }, whenTrue: "finance_signoff", whenFalse: "end_success" },
    { key: "finance_signoff", name: "Finance sign-off", type: "response", assignees: [{ type: "role", role: "finance" }], days: 5, responses: approveReject() },
  ],
});

/** Seeds one default template per tool (and the worked example) where none exists yet. */
const seedDefaultTemplates = async ({ orgId, actor = null }) => {
  const created = [];
  for (const [tool, definition] of Object.entries(DEFAULT_TEMPLATES)) {
    const existing = await prisma.workflowTemplate.findFirst({ where: { orgId, projectId: null, tool, isDefault: true, status: "active" }, select: { id: true } });
    if (existing) continue;
    created.push(await createTemplate({ orgId, projectId: null, payload: { tool, name: definition.name, isDefault: true, steps: definition.steps, description: "Default route — mirrors the built-in approval." }, actor }));
  }
  const example = await prisma.workflowTemplate.findFirst({ where: { orgId, projectId: null, tool: EXAMPLE_TEMPLATE.tool, name: EXAMPLE_TEMPLATE.name }, select: { id: true } });
  if (!example) created.push(await createTemplate({ orgId, projectId: null, payload: { ...EXAMPLE_TEMPLATE, isDefault: false }, actor }));
  return { created: created.length, templates: created };
};

// ─── assignees & notifications ─────────────────────────────────────────────

const resolveAssignees = async ({ tx = prisma, orgId, projectId, assignees = [] }) => {
  const resolved = [];
  const userIds = uniqueIds(assignees.filter((entry) => entry.type === "user").map((entry) => entry.userId));
  if (userIds.length && tx.user?.findMany) {
    const rows = await tx.user.findMany({ where: { id: { in: userIds }, orgId, status: "active" }, select: { id: true } });
    for (const row of rows) resolved.push(row.id);
  }
  const roles = uniqueIds(assignees.filter((entry) => entry.type === "role").map((entry) => entry.role));
  if (roles.length && tx.projectAssignment?.findMany) {
    const rows = await tx.projectAssignment.findMany({ where: { projectId }, select: { userId: true, role: true } });
    for (const row of rows) if (roles.includes(normalizeRoleId(row.role))) resolved.push(row.userId);
    // Org-wide roles (PM, finance…) that are not assigned per project still count.
    if (tx.user?.findMany) {
      const orgRows = await tx.user.findMany({ where: { orgId, status: "active", role: { in: roles } }, select: { id: true } });
      for (const row of orgRows) resolved.push(row.id);
    }
  }
  const partyRoles = uniqueIds(assignees.filter((entry) => entry.type === "party_role").map((entry) => entry.role));
  if (partyRoles.length && tx.projectPartyMember?.findMany) {
    const members = await tx.projectPartyMember.findMany({ where: { status: "active", projectParty: { projectId, status: "active", role: { in: partyRoles } } }, select: { userId: true } });
    for (const member of members) resolved.push(member.userId);
  }
  const templateIds = uniqueIds(assignees.filter((entry) => entry.type === "permission_template").map((entry) => entry.templateId));
  if (templateIds.length && tx.projectUserPermission?.findMany) {
    const rows = await tx.projectUserPermission.findMany({ where: { projectId, templateId: { in: templateIds } }, select: { userId: true } });
    for (const row of rows) resolved.push(row.userId);
  }
  return uniqueIds(resolved);
};

const notify = (params) =>
  notificationService.createNotifications(params).catch((error) => {
    console.error("[workflow-engine] notification", error?.message || error);
    return null;
  });

const recordEvent = async ({ tx, instance, action, decision = null, actor = null, comment = null, reason = null, metadata = {} }) => {
  if (!tx.approvalWorkflowEvent?.create) return null;
  return tx.approvalWorkflowEvent.create({
    data: {
      orgId: instance.orgId,
      projectId: instance.projectId,
      recordType: instance.tool,
      recordId: instance.recordId,
      workflowType: EVENT_WORKFLOW_TYPE,
      action,
      fromStatus: null,
      toStatus: null,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      decision,
      reason: trimOrNull(reason),
      comment: trimOrNull(comment),
      metadataJson: { instanceId: instance.id, templateId: instance.templateId, stepKey: instance.currentStepKey || null, ...metadata },
    },
  });
};

// ─── instances ─────────────────────────────────────────────────────────────

const instanceInclude = { template: { select: { id: true, name: true, tool: true } }, assignments: { orderBy: { createdAt: "asc" } } };

const stepState = (step) => step.state || { status: "pending" };

const serializeInstance = (row, { viewerId = null, users = new Map(), now = new Date() } = {}) => {
  const steps = (Array.isArray(row.stepsJson) ? row.stepsJson : []).map((step) => {
    const state = stepState(step);
    const assignments = (row.assignments || []).filter((assignment) => assignment.stepKey === step.key).map((assignment) => ({
      id: assignment.id,
      userId: assignment.userId,
      user: users.get(assignment.userId) || null,
      status: assignment.status,
      response: assignment.response || null,
      responseLabel: step.responses?.find((response) => response.key === assignment.response)?.label || assignment.response || null,
      comment: assignment.comment || null,
      isOverride: assignment.isOverride,
      dueAt: toIso(assignment.dueAt),
      respondedAt: toIso(assignment.respondedAt),
      escalatedAt: toIso(assignment.escalatedAt),
      overdue: assignment.status === ASSIGNMENT_STATUS.PENDING && Boolean(assignment.dueAt) && new Date(assignment.dueAt) < now,
    }));
    return {
      key: step.key,
      name: step.name,
      type: step.type,
      description: step.description || null,
      days: step.days ?? null,
      requireAll: Boolean(step.requireAll),
      responses: step.responses || [],
      condition: step.condition || null,
      whenTrue: step.whenTrue || null,
      whenFalse: step.whenFalse || null,
      next: step.next || null,
      status: state.status,
      result: state.result ?? null,
      startedAt: toIso(state.startedAt),
      dueAt: toIso(state.dueAt),
      completedAt: toIso(state.completedAt),
      assignments,
    };
  });
  const current = steps.find((step) => step.key === row.currentStepKey) || null;
  const mine = viewerId ? (row.assignments || []).find((assignment) => assignment.userId === viewerId && assignment.status === ASSIGNMENT_STATUS.PENDING && assignment.stepKey === row.currentStepKey) : null;
  const tool = tools.getTool(row.tool);
  return {
    id: row.id,
    projectId: row.projectId,
    project: row.project ? { id: row.project.id, name: row.project.name } : null,
    tool: row.tool,
    toolLabel: tool?.label || row.tool,
    recordId: row.recordId,
    recordRef: row.recordRef || null,
    recordTitle: row.recordTitle || null,
    path: tool ? tool.path({ projectId: row.projectId, recordId: row.recordId }) : null,
    template: row.template ? { id: row.template.id, name: row.template.name } : { id: row.templateId, name: null },
    status: row.status,
    outcome: row.outcome || null,
    currentStepKey: row.currentStepKey || null,
    currentStep: current,
    steps,
    context: row.contextJson || {},
    applyStatus: row.applyStatus || null,
    applyError: row.applyError || null,
    escalationLevel: row.escalationLevel || 0,
    startedAt: toIso(row.startedAt),
    startedBy: row.startedBy || null,
    completedAt: toIso(row.completedAt),
    cancelledAt: toIso(row.cancelledAt),
    cancelReason: row.cancelReason || null,
    myAssignment: mine ? { id: mine.id, dueAt: toIso(mine.dueAt), responses: current?.responses || [] } : null,
    updatedAt: toIso(row.updatedAt),
  };
};

const usersFor = async ({ tx = prisma, rows }) => {
  const ids = uniqueIds(rows.flatMap((row) => (row.assignments || []).map((assignment) => assignment.userId)));
  if (!ids.length || !tx.user?.findMany) return new Map();
  const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, { id: user.id, name: user.name, email: user.email }]));
};

const findRunning = async ({ tx = prisma, projectId, tool, recordId }) =>
  tx.workflowInstance?.findFirst ? tx.workflowInstance.findFirst({ where: { projectId, tool, recordId, status: INSTANCE_STATUS.RUNNING }, include: instanceInclude }) : null;

/**
 * Record services call this before an approve / reject that a running
 * instance owns. Silent when the engine tables are not in play (unit tests
 * with partial Prisma mocks) or when nothing is running.
 */
const assertNotLocked = async ({ tool, projectId, recordId }) => {
  const running = await findRunning({ projectId, tool, recordId });
  if (!running) return null;
  const error = new HttpError(409, "WORKFLOW_RUNNING", `A workflow (${running.template?.name || "route"}) is deciding this record; respond to it or cancel it first`);
  error.details = { instanceId: running.id, templateId: running.templateId, currentStepKey: running.currentStepKey };
  throw error;
};

const pickTemplate = async ({ tx = prisma, orgId, projectId, tool, context }) => {
  if (!tx.workflowTemplate?.findMany) return null;
  const candidates = await tx.workflowTemplate.findMany({ where: { orgId, tool, status: "active", OR: [{ projectId }, { projectId: null }] }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] });
  const ordered = [...candidates.filter((row) => row.projectId), ...candidates.filter((row) => !row.projectId)];
  const ruled = ordered.find((row) => Array.isArray(row.rulesJson) && row.rulesJson.length && rulesMatch(row.rulesJson, context));
  if (ruled) return ruled;
  return ordered.find((row) => row.isDefault) || null;
};

const stepByKey = (steps, key) => steps.find((step) => step.key === key) || null;

const setStepState = (steps, key, patch) => steps.map((step) => (step.key === key ? { ...step, state: { ...(step.state || {}), ...patch } } : step));

/** Walks from `stepKey` until a response step needs people or an end is reached. Runs inside a transaction. */
const advance = async ({ tx, instance, stepKey, actor, now = new Date(), pending }) => {
  let steps = Array.isArray(instance.stepsJson) ? instance.stepsJson : [];
  let key = stepKey;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    if (ENDS.includes(key)) {
      const outcome = key === "end_success" ? "success" : "fail";
      const updated = await tx.workflowInstance.update({
        where: { id: instance.id },
        data: { status: outcome === "success" ? INSTANCE_STATUS.SUCCEEDED : INSTANCE_STATUS.FAILED, outcome, currentStepKey: null, completedAt: now, stepsJson: steps },
        include: instanceInclude,
      });
      await tx.workflowStepAssignment.updateMany({ where: { instanceId: instance.id, status: ASSIGNMENT_STATUS.PENDING }, data: { status: ASSIGNMENT_STATUS.SKIPPED } });
      await recordEvent({ tx, instance: updated, action: "workflow.completed", decision: outcome, actor, metadata: { outcome } });
      return { instance: updated, done: true, outcome };
    }
    const step = stepByKey(steps, key);
    if (!step) throw new HttpError(409, "WORKFLOW_STEP_MISSING", `Step "${key}" is missing from the template`);
    if (step.type === "condition") {
      const result = evaluateCondition(instance.contextJson || {}, step.condition);
      steps = setStepState(steps, step.key, { status: "done", result, startedAt: now, completedAt: now });
      key = result ? step.whenTrue : step.whenFalse;
      continue;
    }
    if (step.type === "action") {
      steps = setStepState(steps, step.key, { status: "done", startedAt: now, completedAt: now });
      const recipients = await resolveAssignees({ tx, orgId: instance.orgId, projectId: instance.projectId, assignees: [...step.action.roles.map((role) => ({ type: "role", role })), ...step.action.userIds.map((userId) => ({ type: "user", userId }))] });
      if (recipients.length) {
        pending.push({
          recipientUserIds: recipients,
          category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
          event: "workflow.action",
          title: `${tools.getTool(instance.tool)?.label || instance.tool} ${instance.recordRef || ""}: ${step.name}`,
          message: step.action.message || `${instance.recordTitle || instance.recordRef || "Record"} reached "${step.name}".`,
        });
      }
      key = step.next;
      continue;
    }
    // response step
    const userIds = await resolveAssignees({ tx, orgId: instance.orgId, projectId: instance.projectId, assignees: step.assignees });
    if (!userIds.length) throw new HttpError(409, "WORKFLOW_STEP_UNASSIGNED", `Nobody on this project can respond to "${step.name}"; add the people or roles to the project first`);
    const dueAt = step.days === null || step.days === undefined ? null : new Date(now.getTime() + step.days * DAY_MS);
    await tx.workflowStepAssignment.createMany({ data: userIds.map((userId) => ({ orgId: instance.orgId, projectId: instance.projectId, instanceId: instance.id, stepKey: step.key, stepName: step.name, userId, dueAt })) });
    steps = setStepState(steps, step.key, { status: "active", startedAt: now, dueAt, completedAt: null });
    const updated = await tx.workflowInstance.update({ where: { id: instance.id }, data: { currentStepKey: step.key, stepsJson: steps }, include: instanceInclude });
    await recordEvent({ tx, instance: updated, action: "workflow.step_started", actor, metadata: { stepKey: step.key, stepName: step.name, assignees: userIds.length, dueAt: toIso(dueAt) } });
    pending.push({
      recipientUserIds: userIds,
      category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL,
      event: "workflow.step_assigned",
      title: `${tools.getTool(instance.tool)?.label || instance.tool} ${instance.recordRef || ""}: ${step.name}`,
      message: `${instance.recordTitle || "A record"} needs your response${dueAt ? ` by ${dueAt.toISOString().slice(0, 10)}` : ""}.`,
      priority: "high",
    });
    return { instance: updated, done: false };
  }
  throw new HttpError(409, "WORKFLOW_LOOP", "The template loops without reaching a response step or an end");
};

const flush = async ({ instance, pending, actor }) => {
  const tool = tools.getTool(instance.tool);
  for (const item of pending) {
    await notify({
      orgId: instance.orgId,
      projectId: instance.projectId,
      actorId: actor?.id || null,
      recipientUserIds: item.recipientUserIds,
      type: "workflow",
      category: item.category,
      event: item.event,
      title: item.title,
      message: item.message,
      priority: item.priority || "normal",
      actionUrl: tool ? tool.path({ projectId: instance.projectId, recordId: instance.recordId }) : null,
      entityType: instance.tool,
      entityId: instance.recordId,
      dedupeKeyBase: `${item.event}:${instance.id}:${instance.currentStepKey || "end"}:${Date.now()}`,
      metadata: { instanceId: instance.id },
    });
  }
};

/** Applies the outcome through the record's own service after the instance is closed. */
const applyOutcome = async ({ instance, outcome, actor, comment }) => {
  const tool = tools.getTool(instance.tool);
  if (!tool) return null;
  try {
    const record = await tool.load({ tx: prisma, projectId: instance.projectId, recordId: instance.recordId });
    if (!record) throw new HttpError(404, "WORKFLOW_RECORD_MISSING", "The record no longer exists");
    await tool.apply({ orgId: instance.orgId, projectId: instance.projectId, recordId: instance.recordId, record, outcome, actor, comment });
    await prisma.workflowInstance.update({ where: { id: instance.id }, data: { applyStatus: "applied", applyError: null } });
    return { applied: true };
  } catch (error) {
    const message = error?.message || "Could not apply the outcome";
    await prisma.workflowInstance.update({ where: { id: instance.id }, data: { applyStatus: "failed", applyError: `${error?.code ? `${error.code}: ` : ""}${message}` } }).catch(() => null);
    await notify({
      orgId: instance.orgId,
      projectId: instance.projectId,
      actorId: null,
      recipientRoles: ["pm"],
      type: "workflow",
      category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
      event: "workflow.apply_failed",
      title: `Workflow finished but the record did not move: ${instance.recordRef || instance.tool}`,
      message: `${message}. Apply the decision on the record by hand.`,
      priority: "high",
      actionUrl: tool.path({ projectId: instance.projectId, recordId: instance.recordId }),
      entityType: instance.tool,
      entityId: instance.recordId,
      dedupeKeyBase: `workflow.apply_failed:${instance.id}`,
    });
    return { applied: false, error: message };
  }
};

const finishAfterCommit = async ({ result, actor, comment, pending }) => {
  await flush({ instance: result.instance, pending, actor });
  if (result.done) await applyOutcome({ instance: result.instance, outcome: result.outcome, actor, comment });
};

const startInstance = async ({ orgId, projectId, tool: toolKey, recordId, templateId = null, actor = null, trigger = "manual", viewer = null }) => {
  const tool = tools.getTool(toolKey);
  if (!tool) throw new HttpError(400, "WORKFLOW_TOOL_UNKNOWN", `Unknown tool: ${toolKey}`);
  await assertRecordVisible({ tool, recordId, viewer });
  const pending = [];
  const result = await prisma.$transaction(async (tx) => {
    const record = await tool.load({ tx, projectId, recordId });
    if (!record) throw new HttpError(404, "WORKFLOW_RECORD_NOT_FOUND", "Record not found");
    const context = await contextWithCustomFields({ orgId, tool, record });
    const running = await findRunning({ tx, projectId, tool: tool.key, recordId });
    if (running) throw new HttpError(409, "WORKFLOW_ALREADY_RUNNING", "A workflow is already running on this record", { instanceId: running.id });
    const template = templateId ? await tx.workflowTemplate.findFirst({ where: { id: templateId, orgId, tool: tool.key, status: "active", OR: [{ projectId }, { projectId: null }] } }) : await pickTemplate({ tx, orgId, projectId, tool: tool.key, context });
    if (!template) throw new HttpError(404, "WORKFLOW_NO_TEMPLATE", "No active workflow template applies to this record");
    const created = await tx.workflowInstance.create({
      data: { orgId, projectId, templateId: template.id, tool: tool.key, recordId, recordRef: trimOrNull(context.ref), recordTitle: trimOrNull(context.title)?.slice(0, 200) || null, status: INSTANCE_STATUS.RUNNING, contextJson: context, stepsJson: template.stepsJson, startedBy: actor?.id || null },
      include: instanceInclude,
    });
    await recordEvent({ tx, instance: created, action: "workflow.started", actor, metadata: { templateName: template.name, trigger } });
    return advance({ tx, instance: created, stepKey: template.startStep || template.stepsJson[0]?.key, actor, pending });
  });
  await finishAfterCommit({ result, actor, comment: null, pending });
  return getInstance({ orgId, projectId, instanceId: result.instance.id, viewerId: actor?.id || null });
};

/** Called by record services after a submit: starts the applicable template, silently when none. */
const maybeStart = async ({ orgId, projectId, tool: toolKey, recordId, actor = null }) => {
  if (!prisma.workflowTemplate?.findMany || !prisma.workflowInstance?.findFirst) return null;
  const tool = tools.getTool(toolKey);
  if (!tool) return null;
  try {
    const running = await findRunning({ projectId, tool: tool.key, recordId });
    if (running) return null;
    const record = await tool.load({ tx: prisma, projectId, recordId });
    if (!record) return null;
    const template = await pickTemplate({ orgId, projectId, tool: tool.key, context: await contextWithCustomFields({ orgId, tool, record }) });
    if (!template) return null;
    return await startInstance({ orgId, projectId, tool: tool.key, recordId, templateId: template.id, actor, trigger: "auto" });
  } catch (error) {
    console.error(`[workflow-engine] auto-start ${toolKey}/${recordId}`, error?.message || error);
    return null;
  }
};

// ─── who may see a run (certification L41) ───────────────────────────────────

/**
 * A run carries its record's figures — the context holds a change order's
 * value, a certificate's net payable, another vendor's commitment sum and
 * retention — and its approvers. It is shown as the record is: to someone
 * assigned to one of its steps (the record was routed to them), or to someone
 * who may read the record itself — its tool's module (change_order, ipc,
 * cost, commitment, sub_pay_app, submittal, document_control) and, for a
 * viewer a record's own rule binds (a party member), that rule: a commitment
 * or payment application of their own company, a submittal routed to their
 * party (document-text.service RECORD_RULES, the rule comments and
 * attachments are read under); a document revision, as document control
 * shows it — under the rule of the record it is filed on (admittedRevisionIds
 * below). workflow:read alone listed every run of the project, with those
 * figures, to every party guest.
 *
 * `viewer` is { userId, canRead(module), partyIds, companyIds } as the
 * workflow routes build it; without one (internal callers) nothing is
 * withheld.
 */
const assignedTo = (row, viewer) => Boolean(viewer.userId) && (row.assignments || []).some((assignment) => assignment.userId === viewer.userId);

const readableTools = (viewer) => tools.TOOL_KEYS.filter((key) => viewer.canRead(tools.getTool(key).module));

// Lazy: the document services' record rules, without an import cycle.
const recordRules = () => require("./document-text.service");

/** The record rule (document-text.service RECORD_RULES) that binds this viewer on a tool's records, or null. */
const bindingRule = (recordType, viewer) => {
  const rule = recordRules().RECORD_RULES[recordType];
  return rule && (Array.isArray(viewer.partyIds) || !rule.party) ? rule : null;
};

/**
 * A document revision is filed on a record — an RFI, a submittal, a drawing,
 * a transmittal, correspondence — and document control shows it only to a
 * reader of that record (doc-control.service assertRevisionRecordVisible,
 * certification L23): the record's module (rfi, submittal, else document
 * control); for an RFI or a submittal, to a party member, its routing to one
 * of their parties (RECORD_RULES); and an RFI still in draft to its creator
 * or manager only (rfi-workflow withDraftVisibility). A run on a revision
 * carries the revision's title, number and record type and is shown on the
 * same terms: document_control read alone showed every revision run, and
 * let a party guest start one, on RFIs routed to others (certification R25,
 * R33). Returns the admitted revision ids among `revisionIds`, or among all
 * the project's revisions when `revisionIds` is null.
 */
const REVISION_RECORD_MODELS = Object.freeze({ rfi: "rfi", submittal: "submittal" });

const admittedRevisionIds = async ({ viewer, revisionIds = null, projectId = null }) => {
  if (Array.isArray(revisionIds) && !revisionIds.length) return new Set();
  const { RECORD_TYPE_MODULES } = require("./attachment.service");
  const revisions = await prisma.documentRevision.findMany({
    where: Array.isArray(revisionIds) ? { id: { in: revisionIds } } : { projectId },
    select: { id: true, projectId: true, recordType: true, recordId: true },
  });
  const readable = revisions.filter((revision) => viewer.canRead(RECORD_TYPE_MODULES[revision.recordType] || "document_control"));
  const shownRecords = new Map();
  for (const [recordType, model] of Object.entries(REVISION_RECORD_MODELS)) {
    const ids = [...new Set(readable.filter((revision) => revision.recordType === recordType).map((revision) => revision.recordId))];
    if (!ids.length) continue;
    let where = { id: { in: ids } };
    const rule = bindingRule(recordType, viewer);
    if (rule) {
      const clauses = rule.clauses(viewer).filter(Boolean);
      if (!clauses.length) {
        shownRecords.set(recordType, new Set());
        continue;
      }
      where = { AND: [where, { OR: clauses }] };
    }
    if (recordType === "rfi") where = require("./rfi-workflow.service").withDraftVisibility(where, viewer.userId || null);
    const rows = await prisma[model].findMany({ where, select: { id: true, projectId: true } });
    shownRecords.set(recordType, new Set(rows.map((row) => `${row.projectId}:${row.id}`)));
  }
  const admitted = readable.filter((revision) =>
    // a drawing's, a transmittal's or correspondence's revision: its module is the whole rule
    !REVISION_RECORD_MODELS[revision.recordType] ||
    Boolean(shownRecords.get(revision.recordType)?.has(`${revision.projectId}:${revision.recordId}`)),
  );
  return new Set(admitted.map((revision) => revision.id));
};

/** The ids of a ruled tool's records in a project that this viewer's rule admits (RECORD_RULES). */
const admittedRecordIds = async ({ rule, projectId, viewer }) => {
  const clauses = rule.clauses(viewer).filter(Boolean);
  if (!clauses.length || !prisma[rule.model]?.findMany) return [];
  const rows = await prisma[rule.model].findMany({ where: { projectId, OR: clauses }, select: { id: true } });
  return rows.map((row) => row.id);
};

/**
 * What a run list asks the database for: the runs the viewer is assigned
 * to, and the runs of each tool whose module they read — of a tool whose
 * records have a rule binding the viewer (a party member's commitments,
 * payment applications and submittals; anyone's document revisions), only
 * the runs on the records that rule admits. The rule is decided before the
 * page is cut: filtered after it, a party member's page of the newest runs
 * could hold only other companies' and come back short or empty while their
 * own older runs existed (certification R26).
 */
const visibleRunsWhere = async ({ viewer, projectId }) => {
  const clauses = [];
  for (const key of readableTools(viewer)) {
    if (key === "document_revision") {
      clauses.push({ tool: key, recordId: { in: [...(await admittedRevisionIds({ viewer, projectId }))] } });
      continue;
    }
    const rule = bindingRule(key, viewer);
    clauses.push(rule ? { tool: key, recordId: { in: await admittedRecordIds({ rule, projectId, viewer }) } } : { tool: key });
  }
  if (viewer.userId) clauses.push({ assignments: { some: { userId: viewer.userId } } });
  return { OR: clauses };
};

/** The ids of the runs among `rows` this viewer may see (each row: id, tool, recordId, assignments). */
const visibleRunIds = async ({ rows, viewer }) => {
  if (!viewer) return new Set(rows.map((row) => row.id));
  const visible = new Set();
  const readable = [];
  for (const row of rows) {
    if (assignedTo(row, viewer)) visible.add(row.id);
    else if (tools.getTool(row.tool) && viewer.canRead(tools.getTool(row.tool).module)) readable.push(row);
  }
  const { recordRuleVisibleIds } = recordRules();
  const revisions = readable.filter((row) => row.tool === "document_revision");
  const ruled = readable.filter((row) => row.tool !== "document_revision" && bindingRule(row.tool, viewer));
  const admitted = ruled.length
    ? await recordRuleVisibleIds({ documents: [{ attachments: ruled.map((row) => ({ recordType: row.tool, recordId: row.recordId })) }], viewer })
    : new Set();
  const admittedRevisions = revisions.length ? await admittedRevisionIds({ viewer, revisionIds: [...new Set(revisions.map((row) => row.recordId))] }) : new Set();
  for (const row of readable) {
    if (row.tool === "document_revision") {
      if (admittedRevisions.has(row.recordId)) visible.add(row.id);
    } else if (!bindingRule(row.tool, viewer) || admitted.has(`${row.tool}:${row.recordId}`)) {
      visible.add(row.id);
    }
  }
  return visible;
};

/** A run this viewer may not see answers as a run that does not exist. */
const assertRunVisible = async ({ row, viewer }) => {
  if (!viewer) return row;
  if (!(await visibleRunIds({ rows: [row], viewer })).has(row.id)) throw new HttpError(404, "WORKFLOW_INSTANCE_NOT_FOUND", "Workflow not found");
  return row;
};

/** Starting a run on a record needs the record: a viewer who may not read it is answered as if it did not exist. */
const assertRecordVisible = async ({ tool, recordId, viewer }) => {
  if (!viewer) return;
  if (!(await visibleRunIds({ rows: [{ id: recordId, tool: tool.key, recordId, assignments: [] }], viewer })).has(recordId)) {
    throw new HttpError(404, "WORKFLOW_RECORD_NOT_FOUND", "Record not found");
  }
};

const getInstanceRow = async ({ orgId, projectId, instanceId }) => {
  const row = await prisma.workflowInstance.findFirst({ where: { id: instanceId, orgId, projectId }, include: { ...instanceInclude, project: { select: { id: true, name: true } } } });
  if (!row) throw new HttpError(404, "WORKFLOW_INSTANCE_NOT_FOUND", "Workflow not found");
  return row;
};

const getInstance = async ({ orgId, projectId, instanceId, viewerId = null, viewer = null }) => {
  const row = await assertRunVisible({ row: await getInstanceRow({ orgId, projectId, instanceId }), viewer });
  return serializeInstance(row, { viewerId, users: await usersFor({ rows: [row] }) });
};

const listInstances = async ({ orgId, projectId, tool = null, recordId = null, status = null, limit = 50, viewerId = null, viewer = null }) => {
  const rows = await prisma.workflowInstance.findMany({
    where: { orgId, projectId, ...(tool ? { tool } : {}), ...(recordId ? { recordId } : {}), ...(status ? { status } : {}), ...(viewer ? { AND: [await visibleRunsWhere({ viewer, projectId })] } : {}) },
    include: { ...instanceInclude, project: { select: { id: true, name: true } } },
    orderBy: [{ startedAt: "desc" }],
    take: Math.min(200, Math.max(1, Number(limit) || 50)),
  });
  const visible = await visibleRunIds({ rows, viewer });
  const shown = rows.filter((row) => visible.has(row.id));
  const users = await usersFor({ rows: shown });
  return shown.map((row) => serializeInstance(row, { viewerId, users }));
};

const respond = async ({ orgId, projectId, instanceId, actor, response, comment = null, canOverride = false, viewer = null }) => {
  if (viewer) await assertRunVisible({ row: await getInstanceRow({ orgId, projectId, instanceId }), viewer });
  const responseKey = trimOrNull(response);
  const note = trimOrNull(comment);
  const pending = [];
  const result = await prisma.$transaction(async (tx) => {
    const instance = await tx.workflowInstance.findFirst({ where: { id: instanceId, orgId, projectId }, include: instanceInclude });
    if (!instance) throw new HttpError(404, "WORKFLOW_INSTANCE_NOT_FOUND", "Workflow not found");
    if (instance.status !== INSTANCE_STATUS.RUNNING) throw new HttpError(409, "WORKFLOW_NOT_RUNNING", "This workflow has finished");
    const steps = Array.isArray(instance.stepsJson) ? instance.stepsJson : [];
    const step = stepByKey(steps, instance.currentStepKey);
    if (!step || step.type !== "response") throw new HttpError(409, "WORKFLOW_NO_ACTIVE_STEP", "No response is expected right now");
    const responseDef = (step.responses || []).find((item) => item.key === responseKey);
    if (!responseDef) throw new HttpError(400, "WORKFLOW_RESPONSE_UNKNOWN", `Pick one of: ${(step.responses || []).map((item) => item.key).join(", ")}`);
    if (responseDef.requireComment && !note) throw new HttpError(400, "WORKFLOW_COMMENT_REQUIRED", `"${responseDef.label}" needs a comment`);
    let assignment = instance.assignments.find((row) => row.stepKey === step.key && row.userId === actor?.id && row.status === ASSIGNMENT_STATUS.PENDING);
    if (!assignment) {
      if (!canOverride) throw new HttpError(403, "WORKFLOW_NOT_ASSIGNED", "This step is not assigned to you");
      assignment = await tx.workflowStepAssignment.create({ data: { orgId, projectId, instanceId: instance.id, stepKey: step.key, stepName: step.name, userId: actor.id, status: ASSIGNMENT_STATUS.PENDING, isOverride: true } });
    }
    const now = new Date();
    await tx.workflowStepAssignment.update({ where: { id: assignment.id }, data: { status: ASSIGNMENT_STATUS.RESPONDED, response: responseDef.key, comment: note, respondedAt: now } });
    await recordEvent({ tx, instance, action: "workflow.responded", decision: responseDef.key, actor, comment: note, reason: responseDef.tone === "negative" ? note : null, metadata: { stepKey: step.key, stepName: step.name, responseLabel: responseDef.label, override: assignment.isOverride } });

    const othersPending = instance.assignments.filter((row) => row.stepKey === step.key && row.id !== assignment.id && row.status === ASSIGNMENT_STATUS.PENDING);
    // An override decides the step outright; otherwise requireAll waits for every positive response.
    if (!assignment.isOverride && responseDef.tone !== "negative" && step.requireAll && othersPending.length) {
      const waiting = await tx.workflowInstance.findFirst({ where: { id: instance.id }, include: instanceInclude });
      return { instance: waiting, done: false, waiting: true };
    }
    if (othersPending.length) await tx.workflowStepAssignment.updateMany({ where: { id: { in: othersPending.map((row) => row.id) } }, data: { status: ASSIGNMENT_STATUS.SKIPPED } });
    const closedSteps = setStepState(steps, step.key, { status: "done", result: responseDef.key, completedAt: now });
    const withState = await tx.workflowInstance.update({ where: { id: instance.id }, data: { stepsJson: closedSteps }, include: instanceInclude });
    return advance({ tx, instance: withState, stepKey: responseDef.next, actor, now, pending });
  });
  await finishAfterCommit({ result, actor, comment: note, pending });
  return getInstance({ orgId, projectId, instanceId, viewerId: actor?.id || null });
};

const cancelInstance = async ({ orgId, projectId, instanceId, actor, reason = null, viewer = null }) => {
  if (viewer) await assertRunVisible({ row: await getInstanceRow({ orgId, projectId, instanceId }), viewer });
  const note = trimOrNull(reason);
  await prisma.$transaction(async (tx) => {
    const instance = await tx.workflowInstance.findFirst({ where: { id: instanceId, orgId, projectId }, include: instanceInclude });
    if (!instance) throw new HttpError(404, "WORKFLOW_INSTANCE_NOT_FOUND", "Workflow not found");
    if (instance.status !== INSTANCE_STATUS.RUNNING) throw new HttpError(409, "WORKFLOW_NOT_RUNNING", "This workflow has finished");
    await tx.workflowStepAssignment.updateMany({ where: { instanceId: instance.id, status: ASSIGNMENT_STATUS.PENDING }, data: { status: ASSIGNMENT_STATUS.SKIPPED } });
    const updated = await tx.workflowInstance.update({ where: { id: instance.id }, data: { status: INSTANCE_STATUS.CANCELLED, currentStepKey: null, cancelledAt: new Date(), cancelReason: note, applyStatus: "skipped" }, include: instanceInclude });
    await recordEvent({ tx, instance: updated, action: "workflow.cancelled", actor, reason: note });
  });
  return getInstance({ orgId, projectId, instanceId, viewerId: actor?.id || null });
};

/** Steps waiting on one person, across the projects they can see. */
const myAssignments = async ({ orgId, userId, projectId = null, projectIds = null, limit = 100 }) => {
  const rows = await prisma.workflowStepAssignment.findMany({
    where: { orgId, userId, status: ASSIGNMENT_STATUS.PENDING, ...(projectId ? { projectId } : projectIds?.length ? { projectId: { in: projectIds } } : {}), instance: { status: INSTANCE_STATUS.RUNNING } },
    include: { instance: { include: { template: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } } } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(500, Math.max(1, Number(limit) || 100)),
  });
  const now = new Date();
  return rows
    .filter((row) => row.instance?.currentStepKey === row.stepKey)
    .map((row) => {
      const tool = tools.getTool(row.instance.tool);
      const step = stepByKey(Array.isArray(row.instance.stepsJson) ? row.instance.stepsJson : [], row.stepKey);
      return {
        assignmentId: row.id,
        instanceId: row.instanceId,
        projectId: row.projectId,
        project: row.instance.project ? { id: row.instance.project.id, name: row.instance.project.name } : null,
        tool: row.instance.tool,
        toolLabel: tool?.label || row.instance.tool,
        recordId: row.instance.recordId,
        recordRef: row.instance.recordRef || null,
        recordTitle: row.instance.recordTitle || null,
        path: tool ? tool.path({ projectId: row.projectId, recordId: row.instance.recordId }) : null,
        template: row.instance.template ? { id: row.instance.template.id, name: row.instance.template.name } : null,
        stepKey: row.stepKey,
        stepName: row.stepName,
        responses: step?.responses || [],
        dueAt: toIso(row.dueAt),
        overdue: Boolean(row.dueAt) && new Date(row.dueAt) < now,
        escalatedAt: toIso(row.escalatedAt),
        createdAt: toIso(row.createdAt),
      };
    });
};

/**
 * Marks every overdue, unescalated assignment of one step as escalated in a
 * single statement and returns the rows this call changed. Concurrent callers
 * lock the same rows in the same order; the second re-checks "escalatedAt" IS
 * NULL once the first commits, and so gets none of them.
 */
const claimOverdueStep = ({ instanceId, stepKey, now }) =>
  prisma.$queryRaw`
    UPDATE "WorkflowStepAssignment"
       SET "escalatedAt" = ${now}
     WHERE "instanceId" = ${instanceId}
       AND "stepKey" = ${stepKey}
       AND "status" = ${ASSIGNMENT_STATUS.PENDING}
       AND "escalatedAt" IS NULL
       AND "dueAt" < ${now}
    RETURNING "id", "userId", "stepName", "dueAt"`;

/** SLA scan: overdue pending steps notify the assignee again and the step's escalation roles. */
const runEscalationScan = async ({ now = new Date(), limit = 500 } = {}) => {
  if (!prisma.workflowStepAssignment?.findMany || !prisma.$queryRaw) return { scanned: 0, escalated: 0 };
  const rows = await prisma.workflowStepAssignment.findMany({
    where: { status: ASSIGNMENT_STATUS.PENDING, escalatedAt: null, dueAt: { lt: now }, instance: { status: INSTANCE_STATUS.RUNNING } },
    include: { instance: { include: instanceInclude } },
    take: limit,
  });
  let escalated = 0;
  const seenSteps = new Set();
  // Reminders go out in the order the scan read the rows.
  const order = new Map(rows.map((item, index) => [item.id, index]));
  for (const row of rows) {
    const instance = row.instance;
    if (!instance || instance.currentStepKey !== row.stepKey) continue;
    // One step is escalated as a whole: its overdue assignees are several rows,
    // and a scan that claimed them one at a time left the rest for a second
    // scan (another scheduler during a deploy) that started a moment later and
    // read only those, and it raised the level and warned the escalation roles
    // again. The first scan to reach the step now claims every overdue row of
    // it in one statement; any other scan, whatever it read and whenever it
    // started, gets nothing back and leaves the step alone.
    const stepId = JSON.stringify([instance.id, row.stepKey]);
    if (seenSteps.has(stepId)) continue;
    seenSteps.add(stepId);
    const claimed = await claimOverdueStep({ instanceId: instance.id, stepKey: row.stepKey, now });
    if (!claimed.length) continue;
    claimed.sort((left, right) => (order.get(left.id) ?? rows.length) - (order.get(right.id) ?? rows.length) || String(left.id).localeCompare(String(right.id)));
    const step = stepByKey(Array.isArray(instance.stepsJson) ? instance.stepsJson : [], row.stepKey);
    const tool = tools.getTool(instance.tool);
    await prisma.workflowInstance.update({ where: { id: instance.id }, data: { escalationLevel: { increment: 1 } } });
    await recordEvent({ tx: prisma, instance, action: "workflow.escalated", metadata: { stepKey: row.stepKey, stepName: row.stepName, dueAt: toIso(row.dueAt) } });
    const escalateTo = await resolveAssignees({ orgId: instance.orgId, projectId: instance.projectId, assignees: (step?.escalateRoles?.length ? step.escalateRoles : ["pm"]).map((role) => ({ type: "role", role })) });
    const overdueUserIds = claimed.map((item) => item.userId);
    if (escalateTo.filter((id) => !overdueUserIds.includes(id)).length) {
      await notify({
        orgId: instance.orgId,
        projectId: instance.projectId,
        recipientUserIds: escalateTo.filter((id) => !overdueUserIds.includes(id)),
        type: "workflow",
        category: notificationService.NOTIFICATION_CATEGORIES.OVERDUE,
        event: "workflow.escalated",
        title: `Overdue step: ${row.stepName} on ${tool?.label || instance.tool} ${instance.recordRef || ""}`.trim(),
        message: `${instance.recordTitle || "The record"} has waited past its ${step?.days ?? ""} day SLA at "${row.stepName}".`,
        priority: "high",
        actionUrl: tool ? tool.path({ projectId: instance.projectId, recordId: instance.recordId }) : null,
        entityType: instance.tool,
        entityId: instance.recordId,
        dedupeKeyBase: `workflow.escalated:${instance.id}:${row.stepKey}`,
      });
    }
    for (const assignment of claimed) {
      await notify({
        orgId: instance.orgId,
        projectId: instance.projectId,
        recipientUserIds: [assignment.userId],
        type: "workflow",
        category: notificationService.NOTIFICATION_CATEGORIES.OVERDUE,
        event: "workflow.step_overdue",
        title: `Your response is overdue: ${assignment.stepName}`,
        message: `${tool?.label || instance.tool} ${instance.recordRef || ""} — ${instance.recordTitle || ""}`.trim(),
        priority: "high",
        actionUrl: tool ? tool.path({ projectId: instance.projectId, recordId: instance.recordId }) : null,
        entityType: instance.tool,
        entityId: instance.recordId,
        dedupeKeyBase: `workflow.step_overdue:${assignment.id}`,
      });
      escalated += 1;
    }
  }
  return { scanned: rows.length, escalated };
};

module.exports = {
  describeTools,
  contextWithCustomFields,
  ASSIGNEE_TYPES,
  CONDITION_OPS,
  DEFAULT_TEMPLATES,
  ENDS,
  EXAMPLE_TEMPLATE,
  INSTANCE_STATUS,
  PARTY_ROLES,
  PROJECT_ROLES,
  STEP_TYPES,
  archiveTemplate,
  assertNotLocked,
  cancelInstance,
  createTemplate,
  evaluateCondition,
  getInstance,
  listInstances,
  listTemplates,
  listTools,
  maybeStart,
  myAssignments,
  normalizeTemplate,
  pickTemplate,
  resolveAssignees,
  respond,
  rulesMatch,
  runEscalationScan,
  seedDefaultTemplates,
  serializeInstance,
  serializeTemplate,
  startInstance,
  updateTemplate,
  visibleRunIds,
};
