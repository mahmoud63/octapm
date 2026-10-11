const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const templateService = require("./permission-template.service");
const companyPartyService = require("./company-party.service");
const sources = require("./external-review-sources");

/**
 * Consultants on a project (CONSULTANT V1): an external consultant company is
 * a project party with role `consultant`; its people join through the one
 * invitation flow OctaPM has (InvitationToken → accept → guest membership +
 * party member). The contractor never sets a password, never creates
 * someone's identity and never bypasses acceptance.
 *
 * Access is the permission-template engine: the consultant access templates
 * below are external templates (base party role consultant) with explicit
 * module levels — none unless listed — and review grants per record type.
 * "Customize access" stores the person's explicit selection as overrides on
 * their project permission, applied when they accept. The backend decides
 * every request from it (hasPermission → templateAllows); nothing is
 * client-side only.
 */

const CONSULTANT_TYPES = Object.freeze({
  lead: "Lead Consultant",
  resident_engineer: "Resident Engineer",
  architect: "Architect",
  structural: "Structural Consultant",
  mep: "MEP Consultant",
  qs: "QS / Cost Consultant",
  specialist: "Specialist Consultant",
  other: "Other Consultant",
});

/** The modules a consultant's access is chosen over (everything else stays none). */
const ACCESS_MODULES = Object.freeze([
  { module: "rfi", label: "RFIs", review: "rfi" },
  { module: "submittal", label: "Submittals", review: "submittal" },
  { module: "report", label: "Reports", review: "progress_report" },
  { module: "inspection", label: "Inspections", review: "itp" },
  { module: "ncr", label: "NCRs", review: "ncr" },
  { module: "closeout", label: "Closeout", review: "closeout_deliverable" },
  { module: "document_control", label: "Documents & drawings", review: null },
  { module: "schedule", label: "Schedule", review: null },
  { module: "boq", label: "BOQ", review: null },
  { module: "cost", label: "Cost", review: null },
  { module: "procurement", label: "Procurement", review: null },
]);
// Always there for a consultant: their review queue (read), locations to read records by, Ask OctaPM.
const ALWAYS = Object.freeze({ external_review: "read_only", location: "read_only", assistant: "read_only" });

const reviewKey = (sourceType) => `external_review|transition:external_review.review_${sourceType}`;
const COMMENT_KEYS = Object.freeze(["external_review|action:update"]);
const DECIDE_KEY = "external_review|action:approve";

/**
 * A selection: { modules: { rfi: "read_only" | "none", … }, reviews: [sourceType], comment: bool }.
 * Reviewing a record type needs reading its module.
 */
const ACCESS_TEMPLATES = Object.freeze([
  { key: "lead", name: "Lead Consultant", description: "Reviews every submission type; reads RFIs, submittals, reports, inspections, NCRs, closeout, documents and schedule.", selection: { modules: { rfi: "read_only", submittal: "read_only", report: "read_only", inspection: "read_only", ncr: "read_only", closeout: "read_only", document_control: "read_only", schedule: "read_only" }, reviews: ["rfi", "submittal", "progress_report", "itp", "ncr", "closeout_deliverable"], comment: true } },
  { key: "structural", name: "Structural Consultant Review", description: "Reviews RFIs, submittals, inspections and NCR corrective actions; reads documents and schedule.", selection: { modules: { rfi: "read_only", submittal: "read_only", inspection: "read_only", ncr: "read_only", document_control: "read_only", schedule: "read_only" }, reviews: ["rfi", "submittal", "itp", "ncr"], comment: true } },
  { key: "mep", name: "MEP Consultant Review", description: "Reviews RFIs, submittals, inspections and closeout deliverables; reads documents and schedule.", selection: { modules: { rfi: "read_only", submittal: "read_only", inspection: "read_only", closeout: "read_only", document_control: "read_only", schedule: "read_only" }, reviews: ["rfi", "submittal", "itp", "closeout_deliverable"], comment: true } },
  { key: "qs", name: "QS / Cost Consultant Review", description: "Reviews progress reports, submittals and closeout deliverables; reads the BOQ and documents. No cost or procurement.", selection: { modules: { report: "read_only", submittal: "read_only", closeout: "read_only", document_control: "read_only", boq: "read_only" }, reviews: ["progress_report", "submittal", "closeout_deliverable"], comment: true } },
  { key: "read_only", name: "Read-Only Consultant", description: "Reads RFIs, submittals, reports, inspections, NCRs, closeout and documents; reviews nothing.", selection: { modules: { rfi: "read_only", submittal: "read_only", report: "read_only", inspection: "read_only", ncr: "read_only", closeout: "read_only", document_control: "read_only" }, reviews: [], comment: false } },
]);
const TEMPLATE_PREFIX = "Consultant · ";

/** A selection as template tools (every catalogue module explicit) and grants. */
const toolsAndGrants = (selection) => {
  const modules = selection?.modules || {};
  const tools = {};
  for (const id of templateService.getCatalog().modules.map((item) => item.id)) tools[id] = "none";
  for (const [module, level] of Object.entries(ALWAYS)) tools[module] = level;
  for (const { module } of ACCESS_MODULES) if (["read_only", "none"].includes(modules[module])) tools[module] = modules[module];
  const reviewable = new Set(ACCESS_MODULES.filter((row) => row.review && tools[row.module] === "read_only").map((row) => row.review));
  const reviews = (selection?.reviews || []).filter((type) => sources.SOURCE_TYPES.includes(type) && reviewable.has(type));
  const grants = [...(selection?.comment || reviews.length ? COMMENT_KEYS : []), ...(reviews.length ? [DECIDE_KEY] : []), ...reviews.map(reviewKey)];
  return { tools, grants, reviews };
};

const normalizeSelection = (selection) => {
  const { tools, reviews } = toolsAndGrants(selection);
  return { modules: Object.fromEntries(ACCESS_MODULES.map(({ module }) => [module, tools[module] === "read_only" ? "read_only" : "none"])), reviews, comment: Boolean(selection?.comment) || reviews.length > 0 };
};

/** The consultant templates of this workspace, created on first use. */
const ensureTemplates = async ({ orgId, actorId = null }) => {
  const existing = await prisma.permissionTemplate.findMany({ where: { orgId, name: { in: ACCESS_TEMPLATES.map((row) => TEMPLATE_PREFIX + row.name) } }, select: { id: true, name: true } });
  const byName = new Map(existing.map((row) => [row.name, row.id]));
  for (const template of ACCESS_TEMPLATES) {
    const name = TEMPLATE_PREFIX + template.name;
    if (byName.has(name)) continue;
    const { tools, grants } = toolsAndGrants(template.selection);
    const created = await templateService.createTemplate({
      orgId,
      actorId,
      payload: { name, description: template.description, kind: "external", clientType: "consultant", basePartyRole: "consultant", tools: Object.entries(tools).map(([module, level]) => ({ module, level })), grants },
    }).catch(async (error) => {
      if (error?.code === "PERMISSION_TEMPLATE_NAME_TAKEN" || error?.status === 409) return prisma.permissionTemplate.findFirst({ where: { orgId, name }, select: { id: true } });
      throw error;
    });
    byName.set(name, created.id);
  }
  return ACCESS_TEMPLATES.map((template) => ({ ...template, id: byName.get(TEMPLATE_PREFIX + template.name) }));
};

/** A template key and a (possibly customised) selection → the template id and the overrides to store for the person. */
const accessFor = async ({ orgId, templateKey, selection = null, actorId = null }) => {
  const templates = await ensureTemplates({ orgId, actorId });
  const template = templates.find((row) => row.key === templateKey);
  if (!template) throw new HttpError(400, "CONSULTANT_TEMPLATE_INVALID", "Choose an access template");
  const chosen = normalizeSelection(selection || template.selection);
  const base = normalizeSelection(template.selection);
  const customised = JSON.stringify(chosen) !== JSON.stringify(base);
  const { tools, grants } = toolsAndGrants(chosen);
  return { templateId: template.id, template, selection: chosen, customised, overrides: customised ? { tools, grants } : {} };
};

const text = (value, max = 500) => {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : null;
};
const emailOf = (value) => {
  const email = text(value, 320)?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "VALIDATION_ERROR", "Enter a valid email address");
  return email;
};

/**
 * Invite Consultant: the consultant company becomes (or already is) a
 * consultant party on the project, and the person receives the standard
 * invitation, carrying their job title, project role, primary-reviewer flag
 * and access — applied only when they accept.
 */
const invite = async ({ orgId, projectId, actor, payload, context = {} }) => {
  const companyName = text(payload.companyName, 200);
  if (!companyName) throw new HttpError(400, "VALIDATION_ERROR", "Name the consultant company");
  const discipline = Object.keys(CONSULTANT_TYPES).includes(payload.discipline) ? payload.discipline : "other";
  const email = emailOf(payload.email);
  const contactName = text(payload.contactName, 200);
  const access = await accessFor({ orgId, templateKey: payload.templateKey, selection: payload.access || null, actorId: actor.id });

  const party = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectParty.findFirst({ where: { projectId, role: "consultant", company: { orgId, name: companyName } }, select: { id: true, contactName: true } });
    const saved = await companyPartyService.upsertProjectPartyWithTx({
      tx,
      orgId,
      projectId,
      payload: { ...(existing ? { partyId: existing.id } : {}), companyName, role: "consultant", ...(existing?.contactName ? {} : { contactName, contactEmail: email }), status: "active" },
    });
    const partyId = saved?.id || existing?.id;
    await tx.projectParty.update({ where: { id: partyId }, data: { discipline } });
    await tx.company.updateMany({ where: { id: (await tx.projectParty.findUnique({ where: { id: partyId }, select: { companyId: true } })).companyId, orgId }, data: { type: "external" } });
    return tx.projectParty.findUnique({ where: { id: partyId }, select: { id: true, companyId: true, company: { select: { name: true } } } });
  });

  // The one invitation flow: a guest seat in this workspace and a member of this party, on acceptance only.
  const invitation = await require("./user.service").inviteUser({
    orgId,
    actor,
    payload: { email, role: "warehouse", projectId, projectPartyId: party.id, note: text(payload.notes, 2000) || `You are invited to review submissions on this project as ${CONSULTANT_TYPES[discipline]} for ${party.company.name}.` },
    context,
    via: "consultant.invite",
  });
  const details = {
    consultant: {
      contactName,
      jobTitle: text(payload.jobTitle, 200),
      projectRole: text(payload.projectRole, 200),
      isPrimaryReviewer: Boolean(payload.isPrimaryReviewer),
      templateId: access.templateId,
      templateKey: access.template.key,
      overrides: access.overrides,
      selection: access.selection,
    },
  };
  await prisma.invitationToken.update({ where: { id: invitation.id }, data: { detailsJson: details } });
  await auditService.recordEvent({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CONSULTANT_INVITATION, entityId: invitation.id, action: auditService.ACTIONS.CREATED, actorId: actor.id, summary: { transition: "consultant.invited", company: party.company.name, discipline, email, template: access.template.name, customised: access.customised, primaryReviewer: details.consultant.isPrimaryReviewer } }).catch(() => null);
  return { invitation: { id: invitation.id, email, status: invitation.status || "pending", expiresAt: invitation.expiresAt || null }, party: { id: party.id, name: party.company.name, discipline }, access: { template: access.template.name, customised: access.customised, selection: access.selection } };
};

/**
 * Applied in the acceptance transaction (company-party acceptProjectPartyInvitation):
 * the person's reviewer details on their party membership and the access the
 * contractor chose, as their project permission.
 */
const applyInvitationDetails = async ({ tx, invitation, userId }) => {
  const details = invitation?.detailsJson?.consultant;
  if (!details || !invitation.projectPartyId || !invitation.projectId) return null;
  await tx.projectPartyMember.updateMany({
    where: { projectPartyId: invitation.projectPartyId, userId },
    data: { jobTitle: details.jobTitle || null, projectRole: details.projectRole || null, isPrimaryReviewer: Boolean(details.isPrimaryReviewer) },
  });
  if (details.templateId) {
    await tx.projectUserPermission.upsert({
      where: { projectId_userId: { projectId: invitation.projectId, userId } },
      create: { orgId: invitation.orgId, projectId: invitation.projectId, userId, templateId: details.templateId, overridesJson: details.overrides || {}, assignedBy: invitation.invitedById || null },
      update: { templateId: details.templateId, overridesJson: details.overrides || {}, assignedBy: invitation.invitedById || null },
    });
  }
  return details;
};

/** Selection the stored template + overrides amount to (for the access editor). */
const selectionOf = ({ template, overrides }) => {
  if (!template) return null;
  if (!overrides || (!Object.keys(overrides.tools || {}).length && !(overrides.grants || []).length)) return normalizeSelection(template.selection);
  const tools = overrides.tools || {};
  const grants = new Set(overrides.grants || []);
  return {
    modules: Object.fromEntries(ACCESS_MODULES.map(({ module }) => [module, tools[module] === "read_only" ? "read_only" : "none"])),
    reviews: sources.SOURCE_TYPES.filter((type) => grants.has(reviewKey(type))),
    comment: grants.has(COMMENT_KEYS[0]),
  };
};

/** The project's consultant parties, their people (with access) and pending invitations. */
const overview = async ({ orgId, projectId, actorId = null }) => {
  const templates = await ensureTemplates({ orgId, actorId });
  const templateById = new Map(templates.map((row) => [row.id, row]));
  const parties = await prisma.projectParty.findMany({
    where: { projectId, role: "consultant", project: { orgId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, discipline: true, contactName: true, contactEmail: true, company: { select: { id: true, name: true } }, members: { orderBy: { createdAt: "asc" }, select: { userId: true, status: true, jobTitle: true, projectRole: true, isPrimaryReviewer: true, acceptedAt: true } } },
  });
  const userIds = parties.flatMap((party) => party.members.map((member) => member.userId));
  const [users, permissions, invitations] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    prisma.projectUserPermission.findMany({ where: { projectId, userId: { in: userIds } }, select: { userId: true, templateId: true, overridesJson: true } }),
    prisma.invitationToken.findMany({ where: { orgId, projectId, projectPartyId: { in: parties.map((party) => party.id) }, status: "pending", acceptedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, projectPartyId: true, createdAt: true, expiresAt: true, detailsJson: true } }),
  ]);
  const userById = new Map(users.map((user) => [user.id, user]));
  const permissionByUser = new Map(permissions.map((row) => [row.userId, row]));
  return {
    types: CONSULTANT_TYPES,
    modules: ACCESS_MODULES,
    templates: templates.map((row) => ({ key: row.key, id: row.id, name: row.name, description: row.description, selection: normalizeSelection(row.selection) })),
    parties: parties.map((party) => ({
      id: party.id,
      name: party.company?.name || "Consultant",
      discipline: party.discipline,
      disciplineLabel: CONSULTANT_TYPES[party.discipline] || "Consultant",
      status: party.status,
      contactName: party.contactName,
      contactEmail: party.contactEmail,
      members: party.members.map((member) => {
        const permission = permissionByUser.get(member.userId);
        const template = permission?.templateId ? templateById.get(permission.templateId) : null;
        const overrides = permission?.overridesJson || {};
        return {
          userId: member.userId,
          name: userById.get(member.userId)?.name || null,
          email: userById.get(member.userId)?.email || null,
          status: member.status,
          jobTitle: member.jobTitle,
          projectRole: member.projectRole,
          isPrimaryReviewer: member.isPrimaryReviewer,
          acceptedAt: member.acceptedAt ? member.acceptedAt.toISOString() : null,
          access: { templateKey: template?.key || null, template: template?.name || (permission?.templateId ? "Custom template" : "Party default"), customised: Boolean(Object.keys(overrides.tools || {}).length || (overrides.grants || []).length), selection: selectionOf({ template, overrides }) },
        };
      }),
      pendingInvitations: invitations
        .filter((invitation) => invitation.projectPartyId === party.id)
        .map((invitation) => ({ id: invitation.id, email: invitation.email, invitedAt: invitation.createdAt.toISOString(), expiresAt: invitation.expiresAt ? invitation.expiresAt.toISOString() : null, contactName: invitation.detailsJson?.consultant?.contactName || null, jobTitle: invitation.detailsJson?.consultant?.jobTitle || null, template: templates.find((row) => row.id === invitation.detailsJson?.consultant?.templateId)?.name || null })),
    })),
  };
};

/** Changes one consultant's access on the project (template + customised selection); audited by the template service. */
const setAccess = async ({ orgId, projectId, actor, userId, payload }) => {
  const member = await prisma.projectPartyMember.findFirst({ where: { userId, projectParty: { projectId, role: "consultant", project: { orgId } } }, select: { id: true } });
  if (!member) throw new HttpError(404, "CONSULTANT_NOT_FOUND", "This person is not a consultant on the project");
  const access = await accessFor({ orgId, templateKey: payload.templateKey, selection: payload.access || null, actorId: actor.id });
  const saved = await templateService.setProjectUserPermission({ orgId, projectId, userId, payload: { templateId: access.templateId, overrides: access.overrides }, actorId: actor.id, actorRole: actor.role || null });
  await auditService.recordEvent({ orgId, projectId, entityType: auditService.ENTITY_TYPES.CONSULTANT_INVITATION, entityId: userId, action: auditService.ACTIONS.UPDATED, actorId: actor.id, summary: { transition: "consultant.access_changed", template: access.template.name, customised: access.customised, selection: access.selection } }).catch(() => null);
  if (payload.isPrimaryReviewer !== undefined || payload.jobTitle !== undefined || payload.projectRole !== undefined) {
    await prisma.projectPartyMember.update({ where: { id: member.id }, data: { ...(payload.isPrimaryReviewer !== undefined ? { isPrimaryReviewer: Boolean(payload.isPrimaryReviewer) } : {}), ...(payload.jobTitle !== undefined ? { jobTitle: text(payload.jobTitle, 200) } : {}), ...(payload.projectRole !== undefined ? { projectRole: text(payload.projectRole, 200) } : {}) } });
  }
  return { ...saved, access: { template: access.template.name, customised: access.customised, selection: access.selection } };
};

module.exports = { CONSULTANT_TYPES, ACCESS_MODULES, ACCESS_TEMPLATES, TEMPLATE_PREFIX, ensureTemplates, accessFor, toolsAndGrants, normalizeSelection, selectionOf, invite, applyInvitationDetails, overview, setAccess };
