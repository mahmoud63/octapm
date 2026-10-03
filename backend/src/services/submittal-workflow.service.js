const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { normalizeRoleId } = require("../config/permissions");
const { applyPartyWorkflowVisibility, assertPartyWorkflowAccess, isPartyScopedAccess } = require("./company-party.service");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const { RECORD_TYPES, attachWorkflowDetailsToRecords } = require("./workflow-support.service");
const { recordWorkspacePath } = require("../utils/record-links");
const { nextNumber: nextCounterNumber } = require("../utils/reference-number");

/**
 * Submittal upgrade (OCTA-PM-SUB-017): packages, multi-step review routes
 * from workflow templates (sequential or parallel steps assigned to users,
 * party roles or project roles, with days per step), response codes, and
 * submit-by dates computed from the activity's required-on-site date. The
 * base record workflow stays in submittal.service; this module owns the
 * steps and is called back from it on status changes.
 */

const RESPONSE_CODES = Object.freeze({
  approved: "Approved",
  approved_as_noted: "Approved as noted",
  revise_resubmit: "Revise and resubmit",
  rejected: "Rejected",
  custom: "Custom",
});
const APPROVING_CODES = Object.freeze(["approved", "approved_as_noted"]);
const REJECTING_CODES = Object.freeze(["revise_resubmit", "rejected"]);
const STEP_MODES = Object.freeze(["sequential", "parallel"]);
const ASSIGNEE_TYPES = Object.freeze(["user", "party_role", "role"]);
const PARTY_ROLES = Object.freeze(["owner", "consultant", "contractor", "subcontractor"]);
const PROJECT_ROLES = Object.freeze(["pm", "planning_eng", "qs", "cost_controller", "procurement", "warehouse", "site_engineer", "finance"]);
const STEP_STATUS = Object.freeze({ PENDING: "pending", ACTIVE: "active", APPROVED: "approved", REJECTED: "rejected", SKIPPED: "skipped" });
const PACKAGE_STATUS = Object.freeze({ OPEN: "open", SUBMITTED: "submitted", CLOSED: "closed" });
const DAY_MS = 86_400_000;
const MAX_STEPS = 12;
const MAX_ASSIGNEES = 20;
const SUBMITTABLE_STATUSES = Object.freeze(["pending", "resubmit", "rejected"]);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const uniqueIds = (values) => [...new Set((values || []).filter(Boolean))];
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const person = (user) => (user ? { id: user.id, name: user.name, email: user.email || null } : null);
const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY_MS);

const submittalPath = ({ projectId, submittalId }) => recordWorkspacePath({ projectId, recordType: "submittal", recordId: submittalId });

// ─── Templates ────────────────────────────────────────────────────────────

const normalizeAssignee = (entry, stepName) => {
  const type = ASSIGNEE_TYPES.includes(entry?.type) ? entry.type : null;
  if (!type) throw new HttpError(400, "SUBMITTAL_TEMPLATE_ASSIGNEE_INVALID", `Step "${stepName}": assignee type must be user, party_role or role`);
  if (type === "user") {
    // Existence in the org is checked when the step is resolved.
    const userId = trimOrNull(entry.userId);
    if (!userId) throw new HttpError(400, "SUBMITTAL_TEMPLATE_ASSIGNEE_INVALID", `Step "${stepName}": user assignee needs a userId`);
    return { type, userId };
  }
  const role = String(entry.role || "").trim().toLowerCase();
  const allowed = type === "party_role" ? PARTY_ROLES : PROJECT_ROLES;
  if (!allowed.includes(role)) throw new HttpError(400, "SUBMITTAL_TEMPLATE_ASSIGNEE_INVALID", `Step "${stepName}": ${type === "party_role" ? "party" : "project"} role must be one of ${allowed.join(", ")}`);
  return { type, role };
};

const normalizeSteps = (steps) => {
  if (!Array.isArray(steps) || !steps.length) throw new HttpError(400, "SUBMITTAL_TEMPLATE_STEPS_REQUIRED", "Add at least one review step");
  if (steps.length > MAX_STEPS) throw new HttpError(400, "SUBMITTAL_TEMPLATE_TOO_MANY_STEPS", `At most ${MAX_STEPS} steps`);
  return steps.map((step, index) => {
    const name = trimOrNull(step?.name);
    if (!name) throw new HttpError(400, "SUBMITTAL_TEMPLATE_STEP_NAME_REQUIRED", `Step ${index + 1} needs a name`);
    const mode = STEP_MODES.includes(step.mode) ? step.mode : "sequential";
    const days = Number.parseInt(step.days ?? 7, 10);
    if (!Number.isInteger(days) || days < 0 || days > 365) throw new HttpError(400, "SUBMITTAL_TEMPLATE_DAYS_INVALID", `Step "${name}": days must be 0–365`);
    const assignees = (Array.isArray(step.assignees) ? step.assignees : []).map((entry) => normalizeAssignee(entry, name));
    if (!assignees.length) throw new HttpError(400, "SUBMITTAL_TEMPLATE_ASSIGNEE_REQUIRED", `Step "${name}" needs at least one reviewer`);
    if (assignees.length > MAX_ASSIGNEES) throw new HttpError(400, "SUBMITTAL_TEMPLATE_TOO_MANY_ASSIGNEES", `Step "${name}": at most ${MAX_ASSIGNEES} reviewers`);
    return { sortOrder: index, name: name.slice(0, 120), mode, days, assignees };
  });
};

const reviewDaysFor = (steps) => (Array.isArray(steps) ? steps.reduce((sum, step) => sum + (Number(step.days) || 0), 0) : 0);

const serializeTemplate = (template, { projectId = null } = {}) => ({
  id: template.id,
  orgId: template.orgId,
  projectId: template.projectId,
  scope: template.projectId ? "project" : "company",
  name: template.name,
  description: template.description,
  isDefault: template.isDefault,
  status: template.status,
  steps: Array.isArray(template.stepsJson) ? template.stepsJson : [],
  reviewDays: reviewDaysFor(template.stepsJson),
  editable: Boolean(projectId ? template.projectId === projectId : !template.projectId),
  createdAt: toIso(template.createdAt),
  updatedAt: toIso(template.updatedAt),
});

const listTemplates = async ({ orgId, projectId = null, query = {} }) => {
  const scope = query.scope || (projectId ? "all" : "company");
  const rows = await prisma.submittalWorkflowTemplate.findMany({
    where: {
      orgId,
      ...(scope === "company" ? { projectId: null } : scope === "project" ? { projectId } : { OR: [{ projectId }, { projectId: null }] }),
      ...(query.includeArchived ? {} : { status: "active" }),
    },
    orderBy: [{ projectId: "desc" }, { isDefault: "desc" }, { name: "asc" }],
    take: 200,
  });
  return { items: rows.map((row) => serializeTemplate(row, { projectId })) };
};

/**
 * A project's review routes decide who reviews its submittals, so changing them
 * is the project's own administration (certification finding X-PARTY-2: a
 * subcontractor guest holding only submittal:update made itself the only
 * reviewer of the default route). Allowed to whoever manages workflows
 * (workflow.manage, as the generic engine's templates require), and to the
 * company's own submittal reviewers (submittal.review); never to an external
 * party's guest on that reviewer permission. `access` comes from the project
 * routes; the company workspace (its own admin guard) and seeding give none.
 */
const assertCanManageRoutes = (access = null) => {
  if (!access) return;
  const { projectAccess = null, canManageWorkflows = false, canReviewSubmittals = false } = access;
  if (canManageWorkflows) return;
  if (canReviewSubmittals && !isPartyScopedAccess(projectAccess)) return;
  throw new HttpError(403, "FORBIDDEN", "Submittal review routes are managed by the project team", { module: "workflow", action: "update", transition: "workflow.manage" });
};

const loadTemplate = async ({ orgId, templateId, projectId = undefined }, tx = prisma) => {
  const template = await tx.submittalWorkflowTemplate.findFirst({
    where: { id: templateId, orgId, ...(projectId === undefined ? {} : projectId === null ? { projectId: null } : { OR: [{ projectId }, { projectId: null }] }) },
  });
  if (!template) throw new HttpError(404, "SUBMITTAL_TEMPLATE_NOT_FOUND", "Workflow template not found");
  return template;
};

const createTemplate = async ({ orgId, projectId = null, payload = {}, actor = null, access = null }) => {
  assertCanManageRoutes(access);
  const name = trimOrNull(payload.name);
  if (!name) throw new HttpError(400, "SUBMITTAL_TEMPLATE_NAME_REQUIRED", "Give the workflow a name");
  const steps = normalizeSteps(payload.steps);
  const created = await prisma.$transaction(async (tx) => {
    if (payload.isDefault) await tx.submittalWorkflowTemplate.updateMany({ where: { orgId, projectId, isDefault: true }, data: { isDefault: false } });
    const row = await tx.submittalWorkflowTemplate.create({
      data: { orgId, projectId, name: name.slice(0, 120), description: trimOrNull(payload.description)?.slice(0, 1000) || null, isDefault: Boolean(payload.isDefault), stepsJson: steps, createdBy: actor?.id || null, updatedBy: actor?.id || null },
    });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId: projectId || null,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL_WORKFLOW_TEMPLATE,
      entityId: row.id,
      action: auditService.ACTIONS.CREATED,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      summary: { name: row.name, steps: steps.length, scope: projectId ? "project" : "company" },
    });
    return row;
  });
  return serializeTemplate(created, { projectId });
};

const updateTemplate = async ({ orgId, projectId = null, templateId, payload = {}, actor = null, access = null }) => {
  assertCanManageRoutes(access);
  const existing = await loadTemplate({ orgId, templateId, projectId: projectId === null ? null : projectId });
  if (projectId && existing.projectId !== projectId) throw new HttpError(403, "SUBMITTAL_TEMPLATE_COMPANY_SCOPED", "Company workflows are edited from the company workspace");
  const data = { updatedBy: actor?.id || null };
  if (payload.name !== undefined) {
    const name = trimOrNull(payload.name);
    if (!name) throw new HttpError(400, "SUBMITTAL_TEMPLATE_NAME_REQUIRED", "Give the workflow a name");
    data.name = name.slice(0, 120);
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description)?.slice(0, 1000) || null;
  if (payload.steps !== undefined) data.stepsJson = normalizeSteps(payload.steps);
  if (payload.status !== undefined) {
    if (!["active", "archived"].includes(payload.status)) throw new HttpError(400, "SUBMITTAL_TEMPLATE_STATUS_INVALID", "Status must be active or archived");
    data.status = payload.status;
  }
  if (payload.isDefault !== undefined) data.isDefault = Boolean(payload.isDefault);
  const updated = await prisma.$transaction(async (tx) => {
    if (data.isDefault) await tx.submittalWorkflowTemplate.updateMany({ where: { orgId, projectId: existing.projectId, isDefault: true, id: { not: templateId } }, data: { isDefault: false } });
    const row = await tx.submittalWorkflowTemplate.update({ where: { id: templateId }, data });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId: existing.projectId || null,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL_WORKFLOW_TEMPLATE,
      entityId: templateId,
      action: auditService.ACTIONS.UPDATED,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      summary: { name: row.name, steps: Array.isArray(row.stepsJson) ? row.stepsJson.length : 0, status: row.status },
    });
    return row;
  });
  return serializeTemplate(updated, { projectId });
};

const archiveTemplate = async ({ orgId, projectId = null, templateId, actor = null, access = null }) =>
  updateTemplate({ orgId, projectId, templateId, payload: { status: "archived", isDefault: false }, actor, access });

const STARTER_TEMPLATES = [
  {
    name: "Contractor check, then consultant review",
    description: "The project manager checks completeness, then the design consultant reviews.",
    isDefault: true,
    steps: [
      { name: "Contractor check", mode: "sequential", days: 3, assignees: [{ type: "role", role: "pm" }] },
      { name: "Consultant review", mode: "sequential", days: 14, assignees: [{ type: "party_role", role: "consultant" }] },
    ],
  },
  {
    name: "Parallel consultant and planning review",
    description: "Design consultant and planning engineer review at the same time; both must approve.",
    steps: [
      { name: "Contractor check", mode: "sequential", days: 3, assignees: [{ type: "role", role: "pm" }] },
      { name: "Design and programme review", mode: "parallel", days: 10, assignees: [{ type: "party_role", role: "consultant" }, { type: "role", role: "planning_eng" }] },
    ],
  },
];

const seedStarterTemplates = async ({ orgId, actor = null }) => {
  const existing = await prisma.submittalWorkflowTemplate.findMany({ where: { orgId, projectId: null }, select: { name: true } });
  const names = new Set(existing.map((row) => row.name));
  const items = [];
  for (const starter of STARTER_TEMPLATES) {
    if (names.has(starter.name)) continue;
    items.push(await createTemplate({ orgId, projectId: null, actor, payload: { ...starter, isDefault: starter.isDefault && existing.length === 0 } }));
  }
  return { created: items.length, items };
};

// ─── Dates and impacts ────────────────────────────────────────────────────

/** submitBy = requiredOnSite (or the activity start) − lead time − review days. */
const computeSubmitBy = ({ requiredOnSite, activityStart, leadTimeWeeks, reviewDays }) => {
  const anchor = requiredOnSite || activityStart;
  if (!anchor) return null;
  const date = new Date(anchor);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - (Number(leadTimeWeeks) || 0) * 7 - (Number(reviewDays) || 0));
  return date;
};

/** Days the material lands after the activity needs it, given approval on `approvedAt`. */
const computeScheduleImpactDays = ({ activityStart, requiredOnSite, leadTimeWeeks, approvedAt }) => {
  const needBy = requiredOnSite || activityStart;
  if (!needBy) return 0;
  const projected = addDays(approvedAt || new Date(), (Number(leadTimeWeeks) || 0) * 7);
  const days = Math.ceil((projected.getTime() - new Date(needBy).getTime()) / DAY_MS);
  return Math.max(0, days);
};

// ─── Assignee resolution ──────────────────────────────────────────────────

const resolveAssignees = async ({ tx = prisma, orgId, projectId, assignees = [] }) => {
  const resolved = [];
  const userIds = assignees.filter((entry) => entry.type === "user").map((entry) => entry.userId);
  if (userIds.length && tx.user?.findMany) {
    const rows = await tx.user.findMany({ where: { id: { in: uniqueIds(userIds) }, orgId }, select: { id: true } });
    for (const row of rows) resolved.push({ userId: row.id, role: "user" });
  }
  const partyRoles = uniqueIds(assignees.filter((entry) => entry.type === "party_role").map((entry) => entry.role));
  if (partyRoles.length && tx.projectPartyMember?.findMany) {
    const members = await tx.projectPartyMember.findMany({
      where: { status: "active", projectParty: { projectId, status: "active", role: { in: partyRoles } } },
      select: { userId: true, projectParty: { select: { role: true } } },
    });
    for (const member of members) resolved.push({ userId: member.userId, role: member.projectParty?.role || "party" });
  }
  const projectRoles = uniqueIds(assignees.filter((entry) => entry.type === "role").map((entry) => entry.role));
  if (projectRoles.length && tx.projectAssignment?.findMany) {
    const rows = await tx.projectAssignment.findMany({ where: { projectId }, select: { userId: true, role: true } });
    for (const row of rows) {
      const role = normalizeRoleId(row.role);
      if (projectRoles.includes(role)) resolved.push({ userId: row.userId, role });
    }
  }
  const seen = new Set();
  return resolved.filter((entry) => {
    if (seen.has(entry.userId)) return false;
    seen.add(entry.userId);
    return true;
  });
};

// ─── Steps ────────────────────────────────────────────────────────────────

const stepInclude = {
  assignments: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } },
};

const serializeAssignment = (row) => ({
  id: row.id,
  userId: row.userId,
  user: person(row.user),
  role: row.role,
  status: row.status,
  responseCode: row.responseCode,
  responseCodeLabel: row.responseCode ? RESPONSE_CODES[row.responseCode] || row.responseCode : null,
  comment: row.comment,
  decidedAt: toIso(row.decidedAt),
});

const serializeStep = (row, now = new Date()) => ({
  id: row.id,
  revisionNumber: row.revisionNumber,
  sortOrder: row.sortOrder,
  name: row.name,
  mode: row.mode,
  days: row.days,
  status: row.status,
  startedAt: toIso(row.startedAt),
  dueAt: toIso(row.dueAt),
  completedAt: toIso(row.completedAt),
  isLate: row.status === STEP_STATUS.ACTIVE && Boolean(row.dueAt) && new Date(row.dueAt) < now,
  assignments: (row.assignments || []).map(serializeAssignment),
});

const notify = async ({ orgId, projectId, submittal, recipientUserIds, category, event, title, message, actorId = null, priority = "normal" }) => {
  const recipients = uniqueIds(recipientUserIds).filter((id) => id !== actorId);
  if (!recipients.length) return null;
  return notificationService.createNotifications({
    orgId,
    projectId,
    actorId,
    recipientUserIds: recipients,
    type: "submittal",
    category,
    event,
    title,
    message,
    priority,
    actionUrl: submittalPath({ projectId, submittalId: submittal.id }),
    entityType: "submittal",
    entityId: submittal.id,
    dedupeKeyBase: `submittal:${submittal.id}:${event}:${Date.now()}`,
    metadata: { ref: submittal.ref, status: submittal.status, revision: submittal.revisionNumber || 0 },
  });
};

const activateStep = async (tx, { submittal, step, now = new Date() }) => {
  const dueAt = addDays(now, step.days || 0);
  const updated = await tx.submittalStep.update({ where: { id: step.id }, data: { status: STEP_STATUS.ACTIVE, startedAt: now, dueAt }, include: stepInclude });
  const ballInCourtUserId = updated.assignments.find((row) => row.status === STEP_STATUS.PENDING)?.userId || null;
  await tx.submittal.update({ where: { id: submittal.id }, data: { currentStepId: updated.id, dueDate: dueAt, ballInCourtUserId } });
  return { step: updated, ballInCourtUserId, dueAt };
};

/** Creates the steps of a revision from the template and starts the first one. */
const startWorkflow = async ({ tx = prisma, orgId, projectId, submittal, template, revisionNumber, actorId = null }) => {
  const steps = normalizeSteps(template.stepsJson);
  const created = [];
  for (const step of steps) {
    const assignees = await resolveAssignees({ tx, orgId, projectId, assignees: step.assignees });
    if (!assignees.length) throw new HttpError(409, "SUBMITTAL_STEP_UNASSIGNED", `Nobody on this project can review step "${step.name}" — add the people or party first`);
    const row = await tx.submittalStep.create({
      data: {
        submittalId: submittal.id,
        revisionNumber,
        sortOrder: step.sortOrder,
        name: step.name,
        mode: step.mode,
        days: step.days,
        status: STEP_STATUS.PENDING,
        assignments: { create: assignees.map((entry) => ({ userId: entry.userId, role: entry.role })) },
      },
      include: stepInclude,
    });
    created.push(row);
  }
  const first = await activateStep(tx, { submittal, step: created[0] });
  await auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.SUBMITTAL,
    entityId: submittal.id,
    action: auditService.ACTIONS.UPDATED,
    actorId,
    summary: { ref: submittal.ref, title: submittal.title, status: submittal.status, workflow: template.name, revision: revisionNumber, steps: created.length, firstStep: created[0].name },
    metadata: { source: "document_control.submittal", templateId: template.id },
  });
  return { steps: created, first };
};

const notifyStepAssignees = async ({ orgId, projectId, submittal, step, actorId }) =>
  notify({
    orgId,
    projectId,
    submittal,
    actorId,
    recipientUserIds: step.assignments.filter((row) => row.status === STEP_STATUS.PENDING).map((row) => row.userId),
    category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL,
    event: "submittal.step_assigned",
    title: `${submittal.ref} awaits your review: ${submittal.title}`,
    message: [`Step ${step.sortOrder + 1}: ${step.name}`, step.dueAt ? `due ${new Date(step.dueAt).toISOString().slice(0, 10)}` : null, step.mode === "parallel" ? "everyone on this step must approve" : null].filter(Boolean).join(" · "),
  });

const distributionIds = (submittal) => (Array.isArray(submittal.distributionJson) ? submittal.distributionJson.filter((id) => typeof id === "string") : []);

const applyScheduleImpact = async ({ tx = prisma, projectId, submittal, activity, approvedAt }) => {
  const days = computeScheduleImpactDays({ activityStart: activity?.startDate, requiredOnSite: submittal.requiredOnSite, leadTimeWeeks: submittal.leadTimeWeeks, approvedAt });
  if (tx.submittal?.update) await tx.submittal.update({ where: { id: submittal.id }, data: { scheduleImpactDays: days } });
  if (days > 0 && submittal.activityId && tx.workflowActivityLink?.upsert) {
    await tx.workflowActivityLink.upsert({
      where: { recordType_recordId_activityId_relationType: { recordType: RECORD_TYPES.SUBMITTAL, recordId: submittal.id, activityId: submittal.activityId, relationType: "submittal_lead_time" } },
      create: { projectId, recordType: RECORD_TYPES.SUBMITTAL, recordId: submittal.id, activityId: submittal.activityId, relationType: "submittal_lead_time", scheduleImpactDays: days, notes: `${submittal.ref} approved ${days} day(s) too late for the activity` },
      update: { scheduleImpactDays: days },
    });
  }
  return days;
};

/**
 * Called by submittal.service inside its update transaction whenever the
 * status changes. Starts the review route on submission, tidies steps and
 * distributes the outcome on close. Returns fields to merge into the row.
 */
const onStatusChange = async ({ tx = prisma, orgId, projectId, existing = {}, updated, actorId = null }) => {
  const patch = {};
  if (!updated || !tx.submittalStep?.findMany) return patch;
  const revision = updated.revisionNumber || 0;
  const entersReview = updated.status === "under_review" && existing.status !== "under_review";
  if (entersReview && updated.workflowTemplateId) {
    const template = await tx.submittalWorkflowTemplate.findFirst({ where: { id: updated.workflowTemplateId, orgId } });
    if (template) {
      const currentSteps = await tx.submittalStep.findMany({ where: { submittalId: updated.id, revisionNumber: revision } });
      let nextRevision = revision;
      if (currentSteps.length && currentSteps.some((step) => [STEP_STATUS.REJECTED, STEP_STATUS.APPROVED, STEP_STATUS.SKIPPED].includes(step.status))) {
        nextRevision = revision + 1;
        await tx.submittal.update({ where: { id: updated.id }, data: { revisionNumber: nextRevision, responseCode: null, responseCodeLabel: null } });
        patch.revisionNumber = nextRevision;
        patch.responseCode = null;
        patch.responseCodeLabel = null;
      }
      const started = await startWorkflow({ tx, orgId, projectId, submittal: { ...updated, revisionNumber: nextRevision }, template, revisionNumber: nextRevision, actorId });
      patch.currentStepId = started.first.step.id;
      patch.dueDate = started.first.dueAt;
      patch.ballInCourtUserId = started.first.ballInCourtUserId;
      patch.pendingStepNotification = { step: started.first.step };
    }
  }
  // A new review cycle starts with no outcome: the last cycle's code does not
  // carry into it, with or without a review route (found reproducing review
  // finding R3 — a submittal returned "Rejected", resubmitted and approved
  // kept the "Rejected" code, and its approval went out under that label).
  // A code set together with the new cycle stays.
  if (entersReview && existing.status && patch.responseCode === undefined && updated.responseCode && updated.responseCode === existing.responseCode) {
    await tx.submittal.update({ where: { id: updated.id }, data: { responseCode: null, responseCodeLabel: null } });
    patch.responseCode = null;
    patch.responseCodeLabel = null;
  }
  if (["approved", "resubmit", "rejected"].includes(updated.status) && existing.status !== updated.status) {
    await tx.submittalStep.updateMany({ where: { submittalId: updated.id, revisionNumber: revision, status: { in: [STEP_STATUS.PENDING, STEP_STATUS.ACTIVE] } }, data: { status: STEP_STATUS.SKIPPED, completedAt: new Date() } });
    const responseCode = updated.responseCode || (updated.status === "approved" ? "approved" : updated.status === "resubmit" ? "revise_resubmit" : "rejected");
    const data = { currentStepId: null, responseCode, responseCodeLabel: updated.responseCodeLabel || RESPONSE_CODES[responseCode] || responseCode };
    if (updated.status === "approved") {
      const activity = updated.activityId && tx.activity?.findFirst ? await tx.activity.findFirst({ where: { id: updated.activityId }, select: { startDate: true } }) : null;
      data.scheduleImpactDays = await applyScheduleImpact({ tx, projectId, submittal: updated, activity, approvedAt: updated.reviewedOn || new Date() });
      data.distributedAt = new Date();
    }
    await tx.submittal.update({ where: { id: updated.id }, data });
    Object.assign(patch, data);
    patch.pendingOutcomeNotification = true;
  }
  return patch;
};

/** Notifications that must run after the transaction that produced `patch`. */
const afterStatusChange = async ({ orgId, projectId, submittal, patch = {}, actorId = null }) => {
  if (patch.pendingStepNotification?.step) {
    await notifyStepAssignees({ orgId, projectId, submittal, step: patch.pendingStepNotification.step, actorId });
  }
  if (patch.pendingOutcomeNotification) {
    const label = patch.responseCodeLabel || submittal.responseCodeLabel || submittal.status;
    await notify({
      orgId,
      projectId,
      submittal,
      actorId,
      recipientUserIds: [submittal.managerUserId, submittal.createdBy, submittal.ownerUserId, submittal.assigneeUserId, ...distributionIds(submittal)],
      category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL,
      event: `submittal.${submittal.status}`,
      title: `${submittal.ref} ${label}: ${submittal.title}`,
      message: patch.scheduleImpactDays ? `Approved, but the material lands ${patch.scheduleImpactDays} day(s) after the activity needs it` : `Revision ${submittal.revision}${submittal.revisionNumber ? ` (cycle ${submittal.revisionNumber})` : ""}`,
      priority: submittal.status === "approved" && !patch.scheduleImpactDays ? "normal" : "high",
    });
  }
};

// ─── Decisions ────────────────────────────────────────────────────────────

/**
 * The reviewers the submittal's own review route named — a step assignment in
 * any of its review cycles — reach it whatever their company's routing (review
 * finding R4: a consultant assigned through a party-role step, no reviewing
 * party on the record, was asked to review a submittal it could then neither
 * open nor decide in its package). Review routes are the project team's to set
 * (finding X-PARTY-2), so an assignment is the team's own grant.
 */
const isStepReviewer = (record, viewerId) =>
  Boolean(viewerId) && (record?.steps || []).some((step) => (step.assignments || []).some((row) => row.userId === viewerId));

/**
 * With the caller's `projectAccess` the party routing the list applies is
 * applied to the record too: a party member opens only a submittal routed to
 * their company, or one its review route names them on (certification
 * findings L42 / FILES-X1, review finding R4). Internal callers — a review
 * step already decided by its assignee — pass none.
 */
const loadSubmittal = async ({ orgId, projectId, submittalId, projectAccess = null, viewerId = null }, tx = prisma) => {
  const project = await tx.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  const submittal = await tx.submittal.findFirst({
    where: { id: submittalId, projectId },
    include: {
      steps: { include: stepInclude, orderBy: [{ revisionNumber: "asc" }, { sortOrder: "asc" }] },
      package: { select: { id: true, ref: true, name: true, status: true } },
      workflowTemplate: { select: { id: true, name: true, stepsJson: true } },
      managerUser: { select: { id: true, name: true, email: true } },
      activity: { select: { id: true, name: true, startDate: true } },
    },
  });
  if (!submittal) throw new HttpError(404, "SUBMITTAL_NOT_FOUND", "Submittal not found");
  if (!isStepReviewer(submittal, viewerId)) assertPartyWorkflowAccess({ projectAccess, record: submittal });
  return { project, submittal };
};

const activeStepOf = (submittal) =>
  submittal.steps.find((step) => step.id === submittal.currentStepId && step.status === STEP_STATUS.ACTIVE) ||
  submittal.steps.find((step) => step.revisionNumber === (submittal.revisionNumber || 0) && step.status === STEP_STATUS.ACTIVE) ||
  null;

const normalizeDecision = (payload = {}) => {
  const decision = payload.decision === "reject" ? "reject" : payload.decision === "approve" ? "approve" : null;
  if (!decision) throw new HttpError(400, "SUBMITTAL_DECISION_INVALID", "Decision must be approve or reject");
  const allowed = decision === "approve" ? [...APPROVING_CODES, "custom"] : [...REJECTING_CODES, "custom"];
  const responseCode = payload.responseCode || (decision === "approve" ? "approved" : "revise_resubmit");
  if (!allowed.includes(responseCode)) throw new HttpError(400, "SUBMITTAL_RESPONSE_CODE_INVALID", `Response code must be one of ${allowed.join(", ")}`);
  const label = responseCode === "custom" ? trimOrNull(payload.responseCodeLabel) : RESPONSE_CODES[responseCode];
  if (!label) throw new HttpError(400, "SUBMITTAL_RESPONSE_CODE_LABEL_REQUIRED", "Give the custom response code a label");
  const comment = trimOrNull(payload.comment);
  if (decision === "reject" && !comment) throw new HttpError(400, "SUBMITTAL_DECISION_COMMENT_REQUIRED", "Say what needs to change");
  return { decision, responseCode, label: label.slice(0, 120), comment: comment?.slice(0, 4000) || null };
};

/**
 * A reviewer decides on the active step. Parallel steps need everyone;
 * the first rejection stops the step and sends the submittal back. The
 * caller's routing is checked before anything about the submittal is told:
 * a party member neither routed nor named on its review route gets the
 * refusal the detail gives, whatever its status (review finding R11).
 */
const decideStep = async ({ orgId, projectId, submittalId, payload = {}, userId = null, userRole = null, projectAccess = null }) => {
  const { decision, responseCode, label, comment } = normalizeDecision(payload);
  const { submittal } = await loadSubmittal({ orgId, projectId, submittalId, projectAccess, viewerId: userId });
  if (submittal.status !== "under_review") throw new HttpError(409, "SUBMITTAL_NOT_UNDER_REVIEW", "Only submittals under review can be decided");
  const step = activeStepOf(submittal);
  if (!step) throw new HttpError(409, "SUBMITTAL_NO_ACTIVE_STEP", "This submittal has no active review step; use the approve / reject actions");
  let assignment = step.assignments.find((row) => row.userId === userId);
  if (!assignment) {
    if (normalizeRoleId(userRole) !== "pm") throw new HttpError(403, "SUBMITTAL_NOT_ASSIGNED", "You are not a reviewer on this step");
    assignment = await prisma.submittalStepAssignment.create({ data: { stepId: step.id, userId, role: "pm" } });
  }
  if (assignment.status !== STEP_STATUS.PENDING) throw new HttpError(409, "SUBMITTAL_ALREADY_DECIDED", "You have already decided on this step");
  const now = new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.submittalStepAssignment.update({ where: { id: assignment.id }, data: { status: decision === "approve" ? STEP_STATUS.APPROVED : STEP_STATUS.REJECTED, responseCode, comment, decidedAt: now } });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL,
      entityId: submittal.id,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      reason: comment,
      summary: { ref: submittal.ref, title: submittal.title, status: submittal.status, step: step.name, decision, responseCode: label },
      metadata: { source: "document_control.submittal", stepId: step.id },
    });
    if (decision === "reject") {
      await tx.submittalStep.update({ where: { id: step.id }, data: { status: STEP_STATUS.REJECTED, completedAt: now } });
      await tx.submittalStepAssignment.updateMany({ where: { stepId: step.id, status: STEP_STATUS.PENDING }, data: { status: STEP_STATUS.SKIPPED } });
      return { kind: "rejected" };
    }
    const remaining = step.assignments.filter((row) => row.id !== assignment.id && row.status === STEP_STATUS.PENDING);
    if (step.mode === "parallel" && remaining.length) {
      await tx.submittal.update({ where: { id: submittal.id }, data: { ballInCourtUserId: remaining[0].userId } });
      return { kind: "waiting", remaining: remaining.length };
    }
    await tx.submittalStep.update({ where: { id: step.id }, data: { status: STEP_STATUS.APPROVED, completedAt: now } });
    if (step.mode === "sequential") {
      await tx.submittalStepAssignment.updateMany({ where: { stepId: step.id, status: STEP_STATUS.PENDING }, data: { status: STEP_STATUS.SKIPPED } });
    }
    const next = submittal.steps.find((row) => row.revisionNumber === step.revisionNumber && row.sortOrder === step.sortOrder + 1 && row.status === STEP_STATUS.PENDING);
    if (next) {
      const activated = await activateStep(tx, { submittal, step: next, now });
      return { kind: "advanced", next: activated.step };
    }
    return { kind: "completed" };
  });

  const submittalService = require("./submittal.service");
  if (outcome.kind === "rejected") {
    await submittalService.updateSubmittal({
      orgId,
      projectId,
      submittalId,
      payload: { status: responseCode === "rejected" ? "rejected" : "resubmit", responseCode, responseCodeLabel: label, reviewedOn: now.toISOString(), reason: comment, comment, statusComment: comment, remarks: comment },
      userId,
      userRole,
    });
  } else if (outcome.kind === "completed") {
    await submittalService.updateSubmittal({
      orgId,
      projectId,
      submittalId,
      payload: { status: "approved", responseCode, responseCodeLabel: label, reviewedOn: now.toISOString(), comment: comment || `${label} at step "${step.name}"`, statusComment: comment || label },
      userId,
      userRole,
    });
  } else if (outcome.kind === "advanced") {
    await notifyStepAssignees({ orgId, projectId, submittal, step: outcome.next, actorId: userId });
  }
  return getSubmittal({ orgId, projectId, submittalId });
};

// ─── Detail ───────────────────────────────────────────────────────────────

const getSubmittal = async ({ orgId, projectId, submittalId, projectAccess = null, viewerId = null }) => {
  const { submittal } = await loadSubmittal({ orgId, projectId, submittalId, projectAccess, viewerId });
  const [enriched] = await attachWorkflowDetailsToRecords({ projectId, recordType: RECORD_TYPES.SUBMITTAL, records: [submittal] });
  const now = new Date();
  const distribution = distributionIds(submittal);
  const people = distribution.length && prisma.user?.findMany ? await prisma.user.findMany({ where: { id: { in: distribution } }, select: { id: true, name: true, email: true } }) : [];
  const steps = submittal.steps.map((step) => serializeStep(step, now));
  const activeStep = steps.find((step) => step.status === STEP_STATUS.ACTIVE) || null;
  return {
    ...enriched,
    steps: undefined,
    package: submittal.package || null,
    workflowTemplate: submittal.workflowTemplate ? { id: submittal.workflowTemplate.id, name: submittal.workflowTemplate.name, reviewDays: reviewDaysFor(submittal.workflowTemplate.stepsJson) } : null,
    manager: person(submittal.managerUser),
    activity: submittal.activity ? { id: submittal.activity.id, name: submittal.activity.name, startDate: toIso(submittal.activity.startDate) } : null,
    distribution: people.map(person),
    distributionUserIds: distribution,
    revisions: enriched.revisions,
    reviewSteps: steps,
    currentRevisionSteps: steps.filter((step) => step.revisionNumber === (submittal.revisionNumber || 0)),
    activeStep,
    lateSteps: steps.filter((step) => step.isLate).length,
    responseCodeLabel: submittal.responseCodeLabel || (submittal.responseCode ? RESPONSE_CODES[submittal.responseCode] : null),
    submitBy: toIso(submittal.submitBy),
    requiredOnSite: toIso(submittal.requiredOnSite),
    isLate: SUBMITTABLE_STATUSES.includes(submittal.status) && Boolean(submittal.submitBy) && new Date(submittal.submitBy) < now,
    path: submittalPath({ projectId, submittalId }),
  };
};

// ─── Packages ─────────────────────────────────────────────────────────────

const packageInclude = {
  submittals: { select: { id: true, ref: true, title: true, status: true, revision: true, revisionNumber: true, responseCode: true, responseCodeLabel: true, currentStepId: true, ballInCourtUserId: true, dueDate: true, ownerPartyId: true, reviewerPartyId: true, approverPartyId: true, steps: { select: { assignments: { select: { userId: true } } } } }, orderBy: { ref: "asc" } },
  managerUser: { select: { id: true, name: true, email: true } },
  activity: { select: { id: true, name: true, startDate: true } },
};

// ─── Party routing of packages ────────────────────────────────────────────
//
// A package groups submittals; a party member sees, lists and changes a
// package only through the submittals routed to their company — the rule the
// submittal list applies (certification findings L42 / FILES-X1: another
// company's package was listed with every item, opened and edited). A package
// the member made and has not filled yet stays theirs. A submittal whose
// review route names the member counts as theirs too (review finding R4).

const routedToCaller = (projectAccess, record, viewerId = null) => {
  if (isStepReviewer(record, viewerId)) return true;
  try {
    assertPartyWorkflowAccess({ projectAccess, record });
    return true;
  } catch (error) {
    if (error?.code === "PROJECT_PARTY_RECORD_ACCESS_DENIED") return false;
    throw error;
  }
};

/** The package as the caller may see it, or null when nothing in it is theirs. */
const packageForCaller = (row, { projectAccess = null, viewerId = null } = {}) => {
  if (!row || !isPartyScopedAccess(projectAccess)) return row;
  const submittals = (row.submittals || []).filter((item) => routedToCaller(projectAccess, item, viewerId));
  if (!submittals.length && !(viewerId && row.createdBy === viewerId)) return null;
  return { ...row, submittals };
};

/** The list filter matching packageForCaller, so a party member's page is not cut short by others' packages. */
const packageVisibilityWhere = ({ projectAccess = null, viewerId = null } = {}) => {
  if (!isPartyScopedAccess(projectAccess)) return {};
  const routed = { submittals: { some: applyPartyWorkflowVisibility({}, projectAccess) } };
  if (!viewerId) return { OR: [routed] };
  const reviewing = { submittals: { some: { steps: { some: { assignments: { some: { userId: viewerId } } } } } } };
  return { OR: [routed, { createdBy: viewerId }, reviewing] };
};

const packageStatusFor = (submittals) => {
  if (!submittals.length) return PACKAGE_STATUS.OPEN;
  if (submittals.every((row) => row.status === "approved")) return PACKAGE_STATUS.CLOSED;
  if (submittals.some((row) => row.status === "under_review")) return PACKAGE_STATUS.SUBMITTED;
  return PACKAGE_STATUS.OPEN;
};

const serializePackage = (row) => ({
  id: row.id,
  projectId: row.projectId,
  number: row.number,
  ref: row.ref,
  name: row.name,
  description: row.description,
  status: row.status,
  activityId: row.activityId,
  activity: row.activity ? { id: row.activity.id, name: row.activity.name, startDate: toIso(row.activity.startDate) } : null,
  requiredOnSite: toIso(row.requiredOnSite),
  managerUserId: row.managerUserId,
  manager: person(row.managerUser),
  // The routing fields and review steps serve packageForCaller; the answer keeps its shape.
  items: (row.submittals || []).map(({ ownerPartyId, reviewerPartyId, approverPartyId, steps, ...item }) => ({ ...item, dueDate: toIso(item.dueDate), responseCodeLabel: item.responseCodeLabel || (item.responseCode ? RESPONSE_CODES[item.responseCode] : null) })),
  summary: {
    total: (row.submittals || []).length,
    underReview: (row.submittals || []).filter((item) => item.status === "under_review").length,
    approved: (row.submittals || []).filter((item) => item.status === "approved").length,
    returned: (row.submittals || []).filter((item) => ["resubmit", "rejected"].includes(item.status)).length,
  },
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const ensureProjectRow = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const loadPackage = async ({ orgId, projectId, packageId, projectAccess = null, viewerId = null }, tx = prisma) => {
  await ensureProjectRow({ orgId, projectId }, tx);
  const row = await tx.submittalPackage.findFirst({ where: { id: packageId, projectId }, include: packageInclude });
  if (!row) throw new HttpError(404, "SUBMITTAL_PACKAGE_NOT_FOUND", "Package not found");
  const visible = packageForCaller(row, { projectAccess, viewerId });
  if (!visible) throw new HttpError(403, "PROJECT_PARTY_RECORD_ACCESS_DENIED", "This package holds no submittal routed to your company");
  return visible;
};

const refreshPackageStatus = async (tx, packageId) => {
  // A package counts its own project's submittals only (defence in depth for finding L8).
  const pkg = await tx.submittalPackage.findUnique({ where: { id: packageId }, select: { projectId: true } });
  const rows = await tx.submittal.findMany({ where: { packageId, ...(pkg?.projectId ? { projectId: pkg.projectId } : {}) }, select: { status: true } });
  const status = packageStatusFor(rows);
  await tx.submittalPackage.update({ where: { id: packageId }, data: { status } });
  return status;
};

const listPackages = async ({ orgId, projectId, query = {}, projectAccess = null, viewerId = null }) => {
  await ensureProjectRow({ orgId, projectId });
  const rows = await prisma.submittalPackage.findMany({
    where: { projectId, ...(query.status && Object.values(PACKAGE_STATUS).includes(query.status) ? { status: query.status } : {}), ...packageVisibilityWhere({ projectAccess, viewerId }) },
    include: packageInclude,
    orderBy: { number: "desc" },
    take: 200,
  });
  return { items: rows.map((row) => packageForCaller(row, { projectAccess, viewerId })).filter(Boolean).map(serializePackage) };
};

const attachSubmittals = async (tx, { projectId, packageId, submittalIds, projectAccess = null }) => {
  const ids = uniqueIds(submittalIds);
  if (!ids.length) return 0;
  const rows = await tx.submittal.findMany({ where: { id: { in: ids }, projectId }, select: { id: true, packageId: true, ownerPartyId: true, reviewerPartyId: true, approverPartyId: true } });
  if (rows.length !== ids.length) throw new HttpError(404, "SUBMITTAL_NOT_FOUND", "One or more submittals were not found");
  // A party member packages only the submittals routed to their company.
  for (const row of rows) assertPartyWorkflowAccess({ projectAccess, record: row });
  const taken = rows.filter((row) => row.packageId && row.packageId !== packageId);
  if (taken.length) throw new HttpError(409, "SUBMITTAL_IN_ANOTHER_PACKAGE", "A submittal can only be in one package");
  const result = await tx.submittal.updateMany({ where: { id: { in: ids } }, data: { packageId } });
  return result.count;
};

/** A package's activity is on its project and its manager is a member of the company (certification finding L7). */
const assertPackageReferences = async ({ orgId, projectId, activityId, managerUserId }) => {
  const refs = require("./tenant-references.service");
  if (activityId) await refs.assertProjectRows({ model: "activity", projectId, ids: [activityId], code: "ACTIVITY_NOT_FOUND", message: "Activity not found" });
  if (managerUserId) await refs.assertMembers({ orgId, userIds: [managerUserId] });
};

/** The package after the caller's own change, as they may see it (their last routed item may just have left it). */
const reloadForCaller = async ({ orgId, projectId, packageId, projectAccess = null, viewerId = null }) => {
  const row = await loadPackage({ orgId, projectId, packageId });
  return serializePackage(packageForCaller(row, { projectAccess, viewerId }) || { ...row, submittals: [] });
};

const createPackage = async ({ orgId, projectId, payload = {}, actor = null, projectAccess = null }) => {
  await ensureProjectRow({ orgId, projectId });
  await assertPackageReferences({ orgId, projectId, activityId: payload.activityId || null, managerUserId: payload.managerUserId || null });
  const name = trimOrNull(payload.name);
  if (!name) throw new HttpError(400, "SUBMITTAL_PACKAGE_NAME_REQUIRED", "Give the package a name");
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextCounterNumber(tx, { table: "SubmittalPackage", scope: { projectId } });
    const row = await tx.submittalPackage.create({
      data: {
        orgId,
        projectId,
        number,
        ref: `PKG-${String(number).padStart(3, "0")}`,
        name: name.slice(0, 160),
        description: trimOrNull(payload.description)?.slice(0, 2000) || null,
        activityId: payload.activityId || null,
        requiredOnSite: payload.requiredOnSite ? new Date(payload.requiredOnSite) : null,
        managerUserId: payload.managerUserId || null,
        createdBy: actor?.id || null,
      },
    });
    await attachSubmittals(tx, { projectId, packageId: row.id, submittalIds: payload.submittalIds, projectAccess });
    await refreshPackageStatus(tx, row.id);
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL_PACKAGE,
      entityId: row.id,
      action: auditService.ACTIONS.CREATED,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      summary: { ref: row.ref, name: row.name, items: uniqueIds(payload.submittalIds).length },
    });
    return row;
  });
  return reloadForCaller({ orgId, projectId, packageId: created.id, projectAccess, viewerId: actor?.id || null });
};

const updatePackage = async ({ orgId, projectId, packageId, payload = {}, actor = null, projectAccess = null }) => {
  const existing = await loadPackage({ orgId, projectId, packageId, projectAccess, viewerId: actor?.id || null });
  const data = {};
  if (payload.name !== undefined) {
    const name = trimOrNull(payload.name);
    if (!name) throw new HttpError(400, "SUBMITTAL_PACKAGE_NAME_REQUIRED", "Give the package a name");
    data.name = name.slice(0, 160);
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description)?.slice(0, 2000) || null;
  if (payload.activityId !== undefined) data.activityId = payload.activityId || null;
  if (payload.requiredOnSite !== undefined) data.requiredOnSite = payload.requiredOnSite ? new Date(payload.requiredOnSite) : null;
  if (payload.managerUserId !== undefined) data.managerUserId = payload.managerUserId || null;
  await assertPackageReferences({ orgId, projectId, activityId: data.activityId, managerUserId: data.managerUserId });
  await prisma.$transaction(async (tx) => {
    await tx.submittalPackage.update({ where: { id: packageId }, data });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL_PACKAGE,
      entityId: packageId,
      action: auditService.ACTIONS.UPDATED,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      summary: { ref: existing.ref, name: data.name || existing.name, changed: Object.keys(data) },
    });
  });
  return reloadForCaller({ orgId, projectId, packageId, projectAccess, viewerId: actor?.id || null });
};

const addPackageItems = async ({ orgId, projectId, packageId, submittalIds = [], actor = null, projectAccess = null }) => {
  const existing = await loadPackage({ orgId, projectId, packageId, projectAccess, viewerId: actor?.id || null });
  await prisma.$transaction(async (tx) => {
    const count = await attachSubmittals(tx, { projectId, packageId, submittalIds, projectAccess });
    await refreshPackageStatus(tx, packageId);
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL_PACKAGE,
      entityId: packageId,
      action: auditService.ACTIONS.UPDATED,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      summary: { ref: existing.ref, added: count },
    });
  });
  return reloadForCaller({ orgId, projectId, packageId, projectAccess, viewerId: actor?.id || null });
};

const removePackageItem = async ({ orgId, projectId, packageId, submittalId, actor = null, projectAccess = null }) => {
  const existing = await loadPackage({ orgId, projectId, packageId, projectAccess, viewerId: actor?.id || null });
  // A party member takes out only a submittal routed to their company.
  if (isPartyScopedAccess(projectAccess)) {
    const item = await prisma.submittal.findFirst({ where: { id: submittalId, projectId }, select: { id: true, ownerPartyId: true, reviewerPartyId: true, approverPartyId: true } });
    if (item) assertPartyWorkflowAccess({ projectAccess, record: item });
  }
  await prisma.$transaction(async (tx) => {
    await tx.submittal.updateMany({ where: { id: submittalId, packageId }, data: { packageId: null } });
    await refreshPackageStatus(tx, packageId);
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL_PACKAGE,
      entityId: packageId,
      action: auditService.ACTIONS.UPDATED,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      summary: { ref: existing.ref, removed: submittalId },
    });
  });
  return reloadForCaller({ orgId, projectId, packageId, projectAccess, viewerId: actor?.id || null });
};

/** Sends every submittable member for review as one action. */
const submitPackage = async ({ orgId, projectId, packageId, payload = {}, userId = null, userRole = null, projectAccess = null }) => {
  // A party member's package holds only the submittals routed to them: those are the ones sent.
  const existing = await loadPackage({ orgId, projectId, packageId, projectAccess, viewerId: userId });
  const submittalService = require("./submittal.service");
  const results = [];
  for (const item of existing.submittals) {
    if (!SUBMITTABLE_STATUSES.includes(item.status)) {
      results.push({ submittalId: item.id, ref: item.ref, skipped: true, reason: item.status });
      continue;
    }
    try {
      await submittalService.submitSubmittal({ orgId, projectId, submittalId: item.id, payload: { comment: payload.comment || `Submitted with ${existing.ref}` }, userId, userRole, projectAccess });
      results.push({ submittalId: item.id, ref: item.ref, submitted: true });
    } catch (error) {
      results.push({ submittalId: item.id, ref: item.ref, submitted: false, error: error?.code || error?.message || "failed" });
    }
  }
  await prisma.$transaction(async (tx) => {
    await refreshPackageStatus(tx, packageId);
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL_PACKAGE,
      entityId: packageId,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      actorRole: userRole,
      summary: { ref: existing.ref, submitted: results.filter((row) => row.submitted).length, failed: results.filter((row) => row.submitted === false).length },
    });
  });
  return { package: await reloadForCaller({ orgId, projectId, packageId, projectAccess, viewerId: userId }), results };
};

/** Applies one decision to every member whose active step is waiting on the caller. */
const decidePackage = async ({ orgId, projectId, packageId, payload = {}, userId = null, userRole = null, projectAccess = null }) => {
  normalizeDecision(payload);
  const existing = await loadPackage({ orgId, projectId, packageId, projectAccess, viewerId: userId });
  const results = [];
  for (const item of existing.submittals) {
    if (item.status !== "under_review") {
      results.push({ submittalId: item.id, ref: item.ref, skipped: true, reason: item.status });
      continue;
    }
    try {
      await decideStep({ orgId, projectId, submittalId: item.id, payload, userId, userRole, projectAccess });
      results.push({ submittalId: item.id, ref: item.ref, decided: true });
    } catch (error) {
      results.push({ submittalId: item.id, ref: item.ref, decided: false, error: error?.code || error?.message || "failed" });
    }
  }
  await prisma.$transaction(async (tx) => {
    await refreshPackageStatus(tx, packageId);
  });
  return { package: await reloadForCaller({ orgId, projectId, packageId, projectAccess, viewerId: userId }), results };
};

const getPackage = async ({ orgId, projectId, packageId, projectAccess = null, viewerId = null }) => serializePackage(await loadPackage({ orgId, projectId, packageId, projectAccess, viewerId }));

module.exports = {
  RESPONSE_CODES,
  APPROVING_CODES,
  REJECTING_CODES,
  STEP_MODES,
  ASSIGNEE_TYPES,
  PARTY_ROLES,
  PROJECT_ROLES,
  STEP_STATUS,
  PACKAGE_STATUS,
  STARTER_TEMPLATES,
  normalizeSteps,
  assertCanManageRoutes,
  packageForCaller,
  reviewDaysFor,
  computeSubmitBy,
  computeScheduleImpactDays,
  resolveAssignees,
  listTemplates,
  createTemplate,
  updateTemplate,
  archiveTemplate,
  seedStarterTemplates,
  startWorkflow,
  onStatusChange,
  afterStatusChange,
  applyScheduleImpact,
  decideStep,
  getSubmittal,
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  addPackageItems,
  removePackageItem,
  submitPackage,
  decidePackage,
  packageStatusFor,
  normalizeDecision,
};
