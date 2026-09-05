const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");

/**
 * Project templates (OCTA-ADM-COMPANY-007): field defaults, parties (with
 * permission templates), document folders, a location tree and default team
 * assignments applied when a project is created from the template.
 */

const SETTINGS_FIELDS = Object.freeze([
  "type",
  "location",
  "contractType",
  "currency",
  "durationUnit",
  "projectCalendar",
  "reportingCutoffDay",
  "defaultRetentionRate",
  "ldRatePerDay",
  "weatherAllowanceDays",
]);
const PARTY_ROLES = Object.freeze(["owner", "consultant", "contractor", "subcontractor"]);
const ACCESS_LEVELS = Object.freeze(["read_only", "collaborator", "reviewer", "admin"]);
const LOCATION_KINDS = Object.freeze(["site", "building", "level", "zone", "room", "area", "external"]);
const STATUSES = Object.freeze(["active", "archived"]);
const MAX_LOCATIONS = 500;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => value?.toISOString?.() || value || null;
const toArray = (value) => (Array.isArray(value) ? value : []);

const recordOrgAudit = async ({ tx = prisma, orgId, actorId = null, actorRole = null, entityId, action, metadata = {} }) => {
  if (!tx.authAuditEvent?.create) return null;
  return tx.authAuditEvent.create({
    data: { orgId, actorId, actorRole, entityType: "project_template", entityId, action, metadataJson: metadata },
  });
};

// ─── Normalization ──────────────────────────────────────────────────────────

const normalizeSettings = (settings) => {
  if (settings === undefined) return undefined;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new HttpError(400, "TEMPLATE_SETTINGS_INVALID", "settings must be an object");
  }
  const out = {};
  for (const field of SETTINGS_FIELDS) {
    if (settings[field] === undefined) continue;
    out[field] = settings[field] === "" ? null : settings[field];
  }
  return out;
};

const normalizeParties = (parties) => {
  if (parties === undefined) return undefined;
  return toArray(parties).map((party, index) => {
    const role = String(party?.role || "").toLowerCase();
    if (!PARTY_ROLES.includes(role)) {
      throw new HttpError(400, "TEMPLATE_PARTY_ROLE_INVALID", `parties[${index}].role must be one of ${PARTY_ROLES.join(", ")}`);
    }
    const accessLevel = party?.accessLevel ? String(party.accessLevel) : "collaborator";
    if (!ACCESS_LEVELS.includes(accessLevel)) {
      throw new HttpError(400, "TEMPLATE_PARTY_ACCESS_INVALID", `parties[${index}].accessLevel is invalid`);
    }
    const companyId = trimOrNull(party?.companyId);
    const companyName = trimOrNull(party?.companyName);
    if (!companyId && !companyName) {
      throw new HttpError(400, "TEMPLATE_PARTY_COMPANY_REQUIRED", `parties[${index}] needs a companyId or companyName`);
    }
    return {
      role,
      companyId,
      companyName,
      accessLevel,
      permissionTemplateId: trimOrNull(party?.permissionTemplateId),
      contactName: trimOrNull(party?.contactName),
      contactEmail: trimOrNull(party?.contactEmail),
    };
  });
};

const normalizeFolders = (folders) => {
  if (folders === undefined) return undefined;
  const list = toArray(folders)
    .map((folder) => (typeof folder === "string" ? folder : folder?.path))
    .map((path) => String(path || "").trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return [...new Set(list)].slice(0, 200);
};

const normalizeLocations = (locations, counter = { count: 0 }) => {
  if (locations === undefined) return undefined;
  return toArray(locations).map((node, index) => {
    counter.count += 1;
    if (counter.count > MAX_LOCATIONS) {
      throw new HttpError(400, "TEMPLATE_LOCATIONS_TOO_MANY", `Templates hold at most ${MAX_LOCATIONS} locations`);
    }
    const name = trimOrNull(node?.name);
    if (!name) throw new HttpError(400, "TEMPLATE_LOCATION_NAME_REQUIRED", `locations[${index}].name is required`);
    const kind = String(node?.kind || "area").toLowerCase();
    if (!LOCATION_KINDS.includes(kind)) {
      throw new HttpError(400, "TEMPLATE_LOCATION_KIND_INVALID", `locations[${index}].kind is invalid`);
    }
    return {
      name,
      kind,
      code: trimOrNull(node?.code),
      children: normalizeLocations(node?.children || [], counter) || [],
    };
  });
};

const normalizeAssignments = (assignments) => {
  if (assignments === undefined) return undefined;
  return toArray(assignments).map((entry, index) => {
    const userId = trimOrNull(entry?.userId);
    if (!userId) throw new HttpError(400, "TEMPLATE_ASSIGNMENT_USER_REQUIRED", `assignments[${index}].userId is required`);
    return {
      userId,
      role: trimOrNull(entry?.role) || "project_member",
      permissionTemplateId: trimOrNull(entry?.permissionTemplateId),
    };
  });
};

const countLocations = (nodes) =>
  toArray(nodes).reduce((sum, node) => sum + 1 + countLocations(node.children), 0);

const serializeTemplate = (row) => ({
  id: row.id,
  orgId: row.orgId,
  name: row.name,
  description: row.description ?? null,
  settings: row.settingsJson || {},
  parties: row.partiesJson || [],
  folders: row.foldersJson || [],
  locations: row.locationsJson || [],
  assignments: row.assignmentsJson || [],
  isDefault: Boolean(row.isDefault),
  status: row.status,
  usage: { projects: row._count?.projects ?? 0 },
  summary: {
    parties: toArray(row.partiesJson).length,
    folders: toArray(row.foldersJson).length,
    locations: countLocations(row.locationsJson),
    assignments: toArray(row.assignmentsJson).length,
  },
  createdBy: row.createdBy ?? null,
  updatedBy: row.updatedBy ?? null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const templateInclude = { _count: { select: { projects: true } } };

// ─── CRUD ───────────────────────────────────────────────────────────────────

const listTemplates = async ({ orgId, query = {} }) => {
  const where = { orgId };
  if (!query.includeArchived) where.status = "active";
  const rows = await prisma.projectTemplate.findMany({
    where,
    include: templateInclude,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return { items: rows.map(serializeTemplate) };
};

const requireTemplate = async ({ tx = prisma, orgId, templateId }) => {
  const row = await tx.projectTemplate.findFirst({ where: { id: templateId, orgId }, include: templateInclude });
  if (!row) throw new HttpError(404, "PROJECT_TEMPLATE_NOT_FOUND", "Project template not found");
  return row;
};

const getTemplate = async ({ orgId, templateId }) => serializeTemplate(await requireTemplate({ orgId, templateId }));

const validateReferences = async ({ tx, orgId, parties = [], assignments = [] }) => {
  const companyIds = [...new Set(parties.map((party) => party.companyId).filter(Boolean))];
  if (companyIds.length && tx.company?.findMany) {
    const found = await tx.company.findMany({ where: { id: { in: companyIds }, orgId }, select: { id: true } });
    if (found.length !== companyIds.length) throw new HttpError(404, "TEMPLATE_COMPANY_NOT_FOUND", "A party company was not found");
  }
  const templateIds = [
    ...new Set([...parties, ...assignments].map((entry) => entry.permissionTemplateId).filter(Boolean)),
  ];
  if (templateIds.length && tx.permissionTemplate?.findMany) {
    const found = await tx.permissionTemplate.findMany({ where: { id: { in: templateIds }, orgId }, select: { id: true } });
    if (found.length !== templateIds.length) throw new HttpError(404, "TEMPLATE_PERMISSION_TEMPLATE_NOT_FOUND", "A permission template was not found");
  }
  const userIds = [...new Set(assignments.map((entry) => entry.userId))];
  if (userIds.length && tx.user?.findMany) {
    const found = await tx.user.findMany({ where: { id: { in: userIds }, orgId }, select: { id: true } });
    if (found.length !== userIds.length) throw new HttpError(404, "TEMPLATE_USER_NOT_FOUND", "An assigned user was not found");
  }
};

const buildData = (payload = {}) => {
  const data = {};
  if (payload.name !== undefined) {
    const name = trimOrNull(payload.name);
    if (!name) throw new HttpError(400, "PROJECT_TEMPLATE_NAME_REQUIRED", "Template name is required");
    data.name = name;
  }
  if (payload.description !== undefined) data.description = trimOrNull(payload.description);
  const settings = normalizeSettings(payload.settings);
  if (settings !== undefined) data.settingsJson = settings;
  const parties = normalizeParties(payload.parties);
  if (parties !== undefined) data.partiesJson = parties;
  const folders = normalizeFolders(payload.folders);
  if (folders !== undefined) data.foldersJson = folders;
  const locations = normalizeLocations(payload.locations);
  if (locations !== undefined) data.locationsJson = locations;
  const assignments = normalizeAssignments(payload.assignments);
  if (assignments !== undefined) data.assignmentsJson = assignments;
  if (payload.isDefault !== undefined) data.isDefault = Boolean(payload.isDefault);
  if (payload.status !== undefined) {
    if (!STATUSES.includes(payload.status)) throw new HttpError(400, "PROJECT_TEMPLATE_STATUS_INVALID", "status must be active or archived");
    data.status = payload.status;
  }
  return data;
};

const createTemplate = async ({ orgId, payload = {}, actorId = null, actorRole = null }) => {
  const data = buildData(payload);
  if (!data.name) throw new HttpError(400, "PROJECT_TEMPLATE_NAME_REQUIRED", "Template name is required");
  const row = await prisma.$transaction(async (tx) => {
    const clash = await tx.projectTemplate.findFirst({ where: { orgId, name: { equals: data.name, mode: "insensitive" } }, select: { id: true } });
    if (clash) throw new HttpError(409, "PROJECT_TEMPLATE_DUPLICATE_NAME", "A template with this name already exists");
    await validateReferences({ tx, orgId, parties: data.partiesJson || [], assignments: data.assignmentsJson || [] });
    if (data.isDefault) await tx.projectTemplate.updateMany({ where: { orgId, isDefault: true }, data: { isDefault: false } });
    const created = await tx.projectTemplate.create({
      data: { orgId, ...data, createdBy: actorId, updatedBy: actorId },
      include: templateInclude,
    });
    await recordOrgAudit({ tx, orgId, actorId, actorRole, entityId: created.id, action: "created", metadata: { name: created.name } });
    return created;
  });
  return serializeTemplate(row);
};

const updateTemplate = async ({ orgId, templateId, payload = {}, actorId = null, actorRole = null }) => {
  const existing = await requireTemplate({ orgId, templateId });
  const data = buildData(payload);
  const row = await prisma.$transaction(async (tx) => {
    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      const clash = await tx.projectTemplate.findFirst({ where: { orgId, id: { not: templateId }, name: { equals: data.name, mode: "insensitive" } }, select: { id: true } });
      if (clash) throw new HttpError(409, "PROJECT_TEMPLATE_DUPLICATE_NAME", "A template with this name already exists");
    }
    await validateReferences({
      tx,
      orgId,
      parties: data.partiesJson ?? existing.partiesJson ?? [],
      assignments: data.assignmentsJson ?? existing.assignmentsJson ?? [],
    });
    if (data.isDefault) await tx.projectTemplate.updateMany({ where: { orgId, isDefault: true, id: { not: templateId } }, data: { isDefault: false } });
    const updated = await tx.projectTemplate.update({ where: { id: templateId }, data: { ...data, updatedBy: actorId }, include: templateInclude });
    await recordOrgAudit({ tx, orgId, actorId, actorRole, entityId: templateId, action: "updated", metadata: { fields: Object.keys(data) } });
    return updated;
  });
  return serializeTemplate(row);
};

const archiveTemplate = async ({ orgId, templateId, actorId = null, actorRole = null }) => {
  await requireTemplate({ orgId, templateId });
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.projectTemplate.update({
      where: { id: templateId },
      data: { status: "archived", isDefault: false, updatedBy: actorId },
      include: templateInclude,
    });
    await recordOrgAudit({ tx, orgId, actorId, actorRole, entityId: templateId, action: "archived" });
    return updated;
  });
  return serializeTemplate(row);
};

// ─── Create project from template ───────────────────────────────────────────

// Locations are created through the location service (own transactions, audit
// and path maintenance) after the project transaction has committed.
const createLocationTree = async ({ orgId, projectId, nodes, parentId = null, userId, userRole, created }) => {
  const locationService = require("./location.service");
  for (const node of toArray(nodes)) {
    const location = await locationService.createLocation({
      orgId,
      projectId,
      payload: { name: node.name, kind: node.kind, code: node.code, parentId },
      userId,
      userRole,
    });
    created.push(location.id);
    await createLocationTree({ orgId, projectId, nodes: node.children, parentId: location.id, userId, userRole, created });
  }
};

/**
 * Creates a project with the template's defaults (request fields win), then
 * applies parties, folders, locations and team assignments.
 */
const createProjectFromTemplate = async ({
  orgId,
  userId = null,
  role = null,
  isCompanyAdmin = false,
  templateId,
  payload = {},
}) => {
  const template = await requireTemplate({ orgId, templateId });
  if (template.status !== "active") {
    throw new HttpError(400, "PROJECT_TEMPLATE_ARCHIVED", "Archived templates cannot create projects");
  }
  const projectService = require("./project.service");
  const companyPartyService = require("./company-party.service");

  const settings = template.settingsJson || {};
  const projectPayload = { ...settings };
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== "") projectPayload[key] = value;
  }
  // Template parties are applied below with their permission templates.
  delete projectPayload.parties;

  const project = await projectService.createProject({ orgId, userId, role, payload: projectPayload });
  const applied = { parties: 0, folders: 0, locations: 0, assignments: 0 };

  await prisma.$transaction(async (tx) => {
    for (const party of toArray(template.partiesJson)) {
      await companyPartyService.upsertProjectPartyWithTx({
        tx,
        orgId,
        projectId: project.id,
        payload: {
          role: party.role,
          companyId: party.companyId || undefined,
          companyName: party.companyName || undefined,
          accessLevel: party.accessLevel,
          permissionTemplateId: party.permissionTemplateId || null,
          contactName: party.contactName,
          contactEmail: party.contactEmail,
        },
      });
      applied.parties += 1;
    }

    const folders = toArray(template.foldersJson);
    await tx.project.update({
      where: { id: project.id },
      data: { templateId: template.id, documentFoldersJson: folders },
    });
    applied.folders = folders.length;

    for (const assignment of toArray(template.assignmentsJson)) {
      await tx.projectAssignment.upsert({
        where: { projectId_userId: { projectId: project.id, userId: assignment.userId } },
        create: { projectId: project.id, userId: assignment.userId, role: assignment.role || "project_member" },
        update: { role: assignment.role || "project_member" },
      });
      if (assignment.permissionTemplateId && tx.projectUserPermission?.upsert) {
        await tx.projectUserPermission.upsert({
          where: { projectId_userId: { projectId: project.id, userId: assignment.userId } },
          create: { orgId, projectId: project.id, userId: assignment.userId, templateId: assignment.permissionTemplateId, assignedBy: userId },
          update: { templateId: assignment.permissionTemplateId, assignedBy: userId },
        });
      }
      applied.assignments += 1;
    }

  });

  const createdLocations = [];
  await createLocationTree({ orgId, projectId: project.id, nodes: template.locationsJson, userId, userRole: role, created: createdLocations });
  applied.locations = createdLocations.length;

  await recordOrgAudit({
    orgId,
    actorId: userId,
    actorRole: role,
    entityId: template.id,
    action: "project_created",
    metadata: { projectId: project.id, applied },
  });

  const fresh = await projectService.getProjectById({ orgId, projectId: project.id, userId, role, isCompanyAdmin });
  return { project: fresh, template: { id: template.id, name: template.name }, applied };
};

module.exports = {
  SETTINGS_FIELDS,
  archiveTemplate,
  createProjectFromTemplate,
  createTemplate,
  getTemplate,
  listTemplates,
  normalizeFolders,
  normalizeLocations,
  normalizeParties,
  normalizeSettings,
  serializeTemplate,
  updateTemplate,
};
