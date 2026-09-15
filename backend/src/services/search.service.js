const { HttpError } = require("../utils/http-error");
const { prisma } = require("../config/db");
const { can, canParty, normalizeRoleId, permissionPolicy } = require("../config/permissions");
const { containsInsensitive, trimToNull } = require("../utils/list-query");
const {
  canAccessAllProjects,
  getProjectAccessWhere,
  projectPartyAccessSelect,
  serializePartyAccess,
} = require("./project-authorization.service");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const CURRENT_ONLY_DOCUMENT_ROLES = new Set(["site_engineer", "warehouse"]);
const PROJECT_WIDE_TASK_ROLES = new Set(["pm", "planning_eng", "super_admin"]);

const SEARCH_TYPE_ALIASES = {
  activities: "activity",
  activity: "activity",
  boq: "boq",
  boq_item: "boq",
  boq_items: "boq",
  change_order: "change_order",
  change_orders: "change_order",
  co: "change_order",
  document: "document",
  documents: "document",
  doc: "document",
  drawing: "drawing",
  drawings: "drawing",
  ipc: "ipc",
  payment: "ipc",
  payments: "ipc",
  long_lead: "long_lead",
  long_leads: "long_lead",
  longlead: "long_lead",
  meeting: "meeting",
  meetings: "meeting",
  procurement: "procurement",
  procurement_package: "procurement",
  procurement_packages: "procurement",
  project: "project",
  projects: "project",
  rfi: "rfi",
  rfis: "rfi",
  risk: "risk",
  risks: "risk",
  submittal: "submittal",
  submittals: "submittal",
  task: "task",
  tasks: "task",
};

const urlWithParams = (path, params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
};

const projectUrl = (projectId, params = {}) =>
  urlWithParams(`/projects/${projectId}`, params);

const toIso = (value) => value?.toISOString?.() || value || null;

const normalizeLimit = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
};

const normalizeType = (value) => {
  const key = trimToNull(value)?.toLowerCase().replace(/[-\s]+/g, "_");
  return key ? SEARCH_TYPE_ALIASES[key] || null : null;
};

const normalizeList = (value) =>
  (Array.isArray(value) ? value : String(value || "").split(","))
    .map((entry) => trimToNull(entry)?.toLowerCase().replace(/[-\s]+/g, "_"))
    .filter(Boolean);

const normalizeTypes = (query) => {
  const requested = normalizeList(query.types || query.type)
    .map(normalizeType)
    .filter(Boolean);
  return requested.length ? [...new Set(requested)] : null;
};

const normalizeStatuses = (query) =>
  normalizeList(query.status || query.statuses);

const parseDateRange = (query) => {
  const dateFrom = trimToNull(query.dateFrom || query.from || query.updatedAfter);
  const dateTo = trimToNull(query.dateTo || query.to || query.updatedBefore);
  const range = {};

  if (dateFrom) range.gte = new Date(dateFrom);
  if (dateTo) range.lte = new Date(dateTo);

  return Object.keys(range).length ? range : null;
};

const textMatches = (value, query) =>
  Boolean(value && query && String(value).toLowerCase().includes(query));

const scoreResult = (result, query) => {
  if (!query) return 10;

  const haystack = [
    result.identifier,
    result.title,
    result.subtitle,
    result.projectName,
    result.status,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  let score = 0;
  if (haystack.some((value) => value === query)) score += 100;
  if (haystack.some((value) => value.startsWith(query))) score += 60;
  if (haystack.some((value) => value.includes(query))) score += 30;

  for (const term of query.split(/\s+/).filter(Boolean)) {
    if (haystack.some((value) => value.includes(term))) score += 5;
  }

  return score;
};

const activityStatusClauses = (statuses) => {
  const now = new Date();
  const clauses = [];
  if (statuses.includes("todo")) {
    clauses.push({ OR: [{ physComplete: null }, { physComplete: { lte: 0 } }] });
  }
  if (statuses.includes("in_progress") || statuses.includes("progress")) {
    clauses.push({ physComplete: { gt: 0, lt: 100 } });
  }
  if (statuses.includes("complete") || statuses.includes("completed")) {
    clauses.push({ physComplete: { gte: 100 } });
  }
  if (statuses.includes("delayed")) {
    clauses.push({
      endDate: { lt: now },
      OR: [{ physComplete: null }, { physComplete: { lt: 100 } }],
    });
  }
  return clauses;
};

const makeResult = ({
  row,
  project,
  type,
  typeLabel,
  module,
  title,
  subtitle = null,
  identifier = null,
  status = null,
  date = null,
  url,
  metadata = {},
}) => ({
  id: row.id,
  type,
  typeLabel,
  module,
  projectId: row.projectId || row.id,
  projectName: project?.name || title,
  title,
  subtitle,
  identifier,
  status,
  date: toIso(date || row.updatedAt || row.createdAt),
  url,
  metadata,
});

const SEARCH_DEFINITIONS = [
  {
    type: "activity",
    typeLabel: "Activity",
    module: "schedule",
    model: "activity",
    searchFields: ["name", "activityCode", "p6ActivityId", "wbsCode", "category"],
    dateField: "updatedAt",
    derivedStatusClauses: activityStatusClauses,
    select: {
      id: true,
      projectId: true,
      name: true,
      activityCode: true,
      p6ActivityId: true,
      wbsCode: true,
      category: true,
      physComplete: true,
      startDate: true,
      endDate: true,
      isCritical: true,
      isActive: true,
      updatedAt: true,
      createdAt: true,
    },
    baseWhere: { isActive: true },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "activity",
        typeLabel: "Activity",
        module: "schedule",
        title: row.name,
        subtitle: [row.activityCode || row.p6ActivityId, row.wbsCode]
          .filter(Boolean)
          .join(" / "),
        identifier: row.activityCode || row.p6ActivityId || null,
        status:
          Number(row.physComplete || 0) >= 100
            ? "complete"
            : Number(row.physComplete || 0) > 0
              ? "in_progress"
              : "todo",
        date: row.updatedAt,
        url: projectUrl(row.projectId, {
          module: "schedule",
          child: "activities",
          recordId: row.id,
          source: "activity",
        }),
        metadata: { activityId: row.id, isCritical: row.isCritical },
      }),
  },
  {
    type: "boq",
    typeLabel: "BOQ",
    module: "boq",
    model: "boqItem",
    searchFields: ["code", "ref", "description", "section", "unit"],
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      code: true,
      ref: true,
      description: true,
      section: true,
      unit: true,
      isActive: true,
      updatedAt: true,
      createdAt: true,
    },
    baseWhere: { isActive: true },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "boq",
        typeLabel: "BOQ",
        module: "boq",
        title: row.description,
        subtitle: [row.section, row.unit].filter(Boolean).join(" / "),
        identifier: row.code || row.ref || null,
        status: row.isActive ? "active" : "inactive",
        url: projectUrl(row.projectId, {
          module: "boq",
          recordId: row.id,
          source: "boq",
        }),
      }),
  },
  {
    type: "rfi",
    typeLabel: "RFI",
    module: "rfi",
    model: "rfi",
    workflowPartyScoped: true,
    searchFields: ["ref", "subject", "question", "response", "discipline"],
    statusField: "status",
    statuses: ["open", "answered", "closed", "archived"],
    archivedField: "archivedAt",
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      ref: true,
      subject: true,
      status: true,
      priority: true,
      dueDate: true,
      updatedAt: true,
      createdAt: true,
    },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "rfi",
        typeLabel: "RFI",
        module: "docControl",
        title: row.subject,
        subtitle: row.priority ? `Priority ${row.priority}` : null,
        identifier: row.ref,
        status: row.status,
        date: row.dueDate || row.updatedAt,
        url: projectUrl(row.projectId, {
          module: "docControl",
          child: "rfi",
          recordId: row.id,
          status: row.status,
          source: "rfi",
        }),
      }),
  },
  {
    type: "submittal",
    typeLabel: "Submittal",
    module: "submittal",
    model: "submittal",
    workflowPartyScoped: true,
    searchFields: ["ref", "title", "discipline", "revision", "specRef", "remarks"],
    statusField: "status",
    statuses: ["pending", "under_review", "approved", "resubmit", "rejected", "archived"],
    archivedField: "archivedAt",
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      ref: true,
      title: true,
      revision: true,
      status: true,
      dueDate: true,
      updatedAt: true,
      createdAt: true,
    },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "submittal",
        typeLabel: "Submittal",
        module: "docControl",
        title: row.title,
        subtitle: row.revision ? `Revision ${row.revision}` : null,
        identifier: row.ref,
        status: row.status,
        date: row.dueDate || row.updatedAt,
        url: projectUrl(row.projectId, {
          module: "docControl",
          child: "submittals",
          recordId: row.id,
          status: row.status,
          source: "submittal",
        }),
      }),
  },
  {
    type: "drawing",
    typeLabel: "Drawing",
    module: "document_control",
    model: "drawingRecord",
    searchFields: ["ref", "drawingNumber", "title", "discipline", "revision", "purpose"],
    statusField: "status",
    statuses: ["active", "superseded", "cancelled"],
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      ref: true,
      drawingNumber: true,
      title: true,
      revision: true,
      status: true,
      updatedAt: true,
      createdAt: true,
    },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "drawing",
        typeLabel: "Drawing",
        module: "docControl",
        title: row.title,
        subtitle: row.revision ? `Revision ${row.revision}` : null,
        identifier: row.drawingNumber || row.ref,
        status: row.status,
        url: projectUrl(row.projectId, {
          module: "docControl",
          child: "drawings",
          recordId: row.id,
          status: row.status,
          source: "drawing",
        }),
      }),
  },
  {
    type: "document",
    typeLabel: "Document",
    module: "document_control",
    model: "documentRevision",
    nonPartyScopedOnly: true,
    searchFields: ["title", "documentNumber", "category", "folderPath", "discipline", "fileName", "revision"],
    statusField: "status",
    statuses: ["uploaded", "submitted", "approved", "superseded", "rejected"],
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      recordType: true,
      recordId: true,
      revision: true,
      title: true,
      documentNumber: true,
      category: true,
      folderPath: true,
      status: true,
      isLatest: true,
      updatedAt: true,
      createdAt: true,
    },
    currentOnlyWhere: { isLatest: true, status: "approved" },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "document",
        typeLabel: "Document",
        module: "docControl",
        title: row.title || row.documentNumber || row.fileName || "Document revision",
        subtitle: [row.category, row.folderPath, `Rev ${row.revision}`]
          .filter(Boolean)
          .join(" / "),
        identifier: row.documentNumber || null,
        status: row.status,
        url: projectUrl(row.projectId, {
          module: "docControl",
          child: "register",
          recordId: row.recordId,
          source: row.recordType,
        }),
        metadata: { revisionId: row.id, recordType: row.recordType },
      }),
  },
  {
    type: "change_order",
    typeLabel: "Change Order",
    module: "change_order",
    model: "changeOrder",
    searchFields: ["ref", "description", "category", "scheduleImpactSummary", "costImpactSummary"],
    statusField: "status",
    statuses: ["draft", "pending", "approved", "rejected", "archived"],
    archivedField: "archivedAt",
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      ref: true,
      description: true,
      category: true,
      status: true,
      value: true,
      scheduleImpact: true,
      updatedAt: true,
      createdAt: true,
    },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "change_order",
        typeLabel: "Change Order",
        module: "commercial",
        title: row.description,
        subtitle: row.category || null,
        identifier: row.ref,
        status: row.status,
        url: projectUrl(row.projectId, {
          module: "commercial",
          child: "change-orders",
          recordId: row.id,
          status: row.status,
          source: "change_order",
        }),
      }),
  },
  {
    type: "ipc",
    typeLabel: "IPC",
    module: "ipc",
    model: "ipcCertificate",
    searchFields: ["period", "status", "invoiceStatus", "paymentStatus"],
    statusField: "status",
    statuses: ["draft", "submitted", "certified", "paid"],
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      period: true,
      status: true,
      invoiceStatus: true,
      paymentStatus: true,
      dueDate: true,
      updatedAt: true,
      createdAt: true,
    },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "ipc",
        typeLabel: "IPC",
        module: "commercial",
        title: row.period,
        subtitle: `Invoice ${row.invoiceStatus}; payment ${row.paymentStatus}`,
        identifier: row.period,
        status: row.status,
        date: row.dueDate || row.updatedAt,
        url: projectUrl(row.projectId, {
          module: "commercial",
          child: "ipc",
          recordId: row.id,
          status: row.status,
          source: "ipc",
        }),
      }),
  },
  {
    type: "risk",
    typeLabel: "Risk",
    module: "risk",
    model: "risk",
    searchFields: ["ref", "description", "mitigation", "responsePlan", "phase", "owner"],
    statusField: "status",
    statuses: ["open", "monitoring", "submitted", "closed", "archived"],
    archivedField: "archivedAt",
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      ref: true,
      description: true,
      severity: true,
      status: true,
      dueDate: true,
      updatedAt: true,
      createdAt: true,
    },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "risk",
        typeLabel: "Risk",
        module: "schedule",
        title: row.description,
        subtitle: row.severity ? `Severity ${row.severity}` : null,
        identifier: row.ref,
        status: row.status,
        date: row.dueDate || row.updatedAt,
        url: projectUrl(row.projectId, {
          module: "schedule",
          child: "risks",
          recordId: row.id,
          status: row.status,
          source: "risk",
        }),
      }),
  },
  {
    type: "procurement",
    typeLabel: "Procurement",
    module: "procurement",
    model: "procurementPackage",
    searchFields: ["packageNumber", "title", "description", "buyer", "notes"],
    statusField: "status",
    statuses: ["planning", "tendering", "awarded", "in_delivery", "closed", "cancelled"],
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      packageNumber: true,
      title: true,
      status: true,
      requiredOnSiteDate: true,
      latestOrderDate: true,
      updatedAt: true,
      createdAt: true,
    },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "procurement",
        typeLabel: "Procurement",
        module: "schedule",
        title: row.title,
        subtitle: row.requiredOnSiteDate
          ? `Required ${toIso(row.requiredOnSiteDate).slice(0, 10)}`
          : null,
        identifier: row.packageNumber,
        status: row.status,
        date: row.latestOrderDate || row.requiredOnSiteDate || row.updatedAt,
        url: projectUrl(row.projectId, {
          module: "schedule",
          child: "longLead",
          recordId: row.id,
          status: row.status,
          source: "procurement",
        }),
      }),
  },
  {
    type: "long_lead",
    typeLabel: "Long Lead",
    module: "procurement",
    model: "longLeadItem",
    searchFields: ["item", "criticality", "risk", "supplier", "status", "warehouseStatus"],
    statusField: "status",
    statuses: ["not_ordered", "ordered", "delivered"],
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      item: true,
      criticality: true,
      risk: true,
      supplier: true,
      status: true,
      warehouseStatus: true,
      expectedDeliveryDate: true,
      updatedAt: true,
      createdAt: true,
    },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "long_lead",
        typeLabel: "Long Lead",
        module: "schedule",
        title: row.item,
        subtitle: [row.supplier, row.warehouseStatus].filter(Boolean).join(" / "),
        identifier: row.criticality || null,
        status: row.status,
        date: row.expectedDeliveryDate || row.updatedAt,
        url: projectUrl(row.projectId, {
          module: "schedule",
          child: "longLead",
          recordId: row.id,
          status: row.status,
          source: "long_lead",
        }),
      }),
  },
  {
    type: "meeting",
    typeLabel: "Meeting",
    module: "meeting",
    model: "meeting",
    orgScoped: true,
    searchFields: ["meetingNumber", "title", "meetingType", "objective", "minutesText", "location"],
    statusField: "status",
    statuses: ["draft", "finalized", "distributed", "archived"],
    archivedField: "archivedAt",
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      meetingNumber: true,
      title: true,
      meetingType: true,
      status: true,
      scheduledAt: true,
      updatedAt: true,
      createdAt: true,
    },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "meeting",
        typeLabel: "Meeting",
        module: "meetings",
        title: row.title,
        subtitle: row.meetingType || null,
        identifier: row.meetingNumber,
        status: row.status,
        date: row.scheduledAt || row.updatedAt,
        url: projectUrl(row.projectId, {
          module: "meetings",
          recordId: row.id,
          status: row.status,
          source: "meeting",
        }),
      }),
  },
  {
    type: "task",
    typeLabel: "Task",
    module: "task",
    model: "task",
    orgScoped: true,
    taskScoped: true,
    searchFields: ["taskNumber", "title", "description", "label", "priority"],
    statusField: "status",
    statuses: ["todo", "in_progress", "blocked", "done", "canceled"],
    archivedField: "archivedAt",
    dateField: "updatedAt",
    select: {
      id: true,
      projectId: true,
      taskNumber: true,
      title: true,
      label: true,
      priority: true,
      status: true,
      dueDate: true,
      updatedAt: true,
      createdAt: true,
    },
    serialize: (row, project) =>
      makeResult({
        row,
        project,
        type: "task",
        typeLabel: "Task",
        module: "task",
        title: row.title,
        subtitle: [row.label, row.priority].filter(Boolean).join(" / "),
        identifier: row.taskNumber,
        status: row.status,
        date: row.dueDate || row.updatedAt,
        url: urlWithParams("/tasks", { filter: row.taskNumber || row.title }),
      }),
  },
];

const SEARCHABLE_TYPES = [
  { type: "project", label: "Project" },
  ...SEARCH_DEFINITIONS.map((definition) => ({
    type: definition.type,
    label: definition.typeLabel,
  })),
];

const getProjectAssignmentRole = (project) =>
  normalizeRoleId(project.assignments?.[0]?.role) || null;

const buildProjectAccess = ({ project, role }) => {
  const orgRole = normalizeRoleId(role);
  const assignmentRole = getProjectAssignmentRole(project);
  const partyAccess = serializePartyAccess(project.parties);
  return {
    id: project.id,
    orgId: project.orgId,
    role: assignmentRole || (partyAccess.length ? "external_party" : orgRole),
    assignmentRole,
    partyAccess,
    scope: assignmentRole ? "assignment" : partyAccess.length ? "party" : "org",
  };
};

const listAccessibleProjects = async ({
  orgId,
  userId,
  role,
  projectId = null,
  includeArchived = false,
}) => {
  const normalizedRole = normalizeRoleId(role);
  const select = {
    id: true,
    orgId: true,
    name: true,
    type: true,
    location: true,
    clientName: true,
    contractNumber: true,
    status: true,
    archivedAt: true,
    createdAt: true,
    updatedAt: true,
  };

  if (!canAccessAllProjects(normalizedRole)) {
    select.assignments = {
      where: { userId },
      select: { role: true },
      take: 1,
    };
    select.parties = projectPartyAccessSelect(userId);
  }

  const projects = await prisma.project.findMany({
    where: {
      orgId,
      ...(projectId ? { id: projectId } : {}),
      ...(includeArchived ? {} : { archivedAt: null }),
      ...getProjectAccessWhere({ userId, role: normalizedRole }),
    },
    select,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });

  const accesses = projects.map((project) => ({
    project,
    access: buildProjectAccess({ project, role: normalizedRole }),
  }));
  // A project's permission template decides the modules a person may search
  // there, as it decides on the project's own routes: search asked the role's
  // policy only, and a template that refused a module elsewhere let its
  // records and document contents through here (Phase 21D, CX21-514).
  const { templatesForProjects } = require("./permission-template.service");
  const templates = await templatesForProjects({
    userId,
    projects: accesses.map(({ project, access }) => ({ id: project.id, partyIds: partyIdsFor(access) })),
  });
  for (const entry of accesses) entry.access.template = templates.get(entry.project.id) || null;
  return accesses;
};

const canReadModule = (projectAccess, moduleName) => {
  if (!moduleName) return true;
  if (projectAccess.template && permissionPolicy.modules[moduleName]) {
    const { templateAllows } = require("./permission-template.service");
    return templateAllows(projectAccess.template, { module: moduleName, action: "read" });
  }
  if (can({ role: projectAccess.role, module: moduleName, action: "read" })) {
    return true;
  }

  return (projectAccess.partyAccess || []).some((partyAccess) =>
    canParty({
      partyRole: partyAccess.role,
      module: moduleName,
      action: "read",
    }),
  );
};

const partyIdsFor = (projectAccess) =>
  (projectAccess.partyAccess || [])
    .map((partyAccess) => partyAccess.projectPartyId)
    .filter(Boolean);

const isPartyScopedAccess = (projectAccess) =>
  projectAccess.scope === "party" ||
  (!projectAccess.assignmentRole && partyIdsFor(projectAccess).length > 0);

const hasProjectWideTaskVisibility = (projectAccess) =>
  PROJECT_WIDE_TASK_ROLES.has(normalizeRoleId(projectAccess.role));

const projectVisibilityClauses = ({
  definition,
  projectAccesses,
  userId,
}) =>
  projectAccesses
    .filter(({ access }) => canReadModule(access, definition.module))
    .filter(({ access }) => {
      if (!definition.nonPartyScopedOnly) return true;
      return !isPartyScopedAccess(access);
    })
    .map(({ access }) => {
      const clauses = [{ projectId: access.id }];

      if (definition.workflowPartyScoped && isPartyScopedAccess(access)) {
        const partyIds = partyIdsFor(access);
        clauses.push(
          partyIds.length
            ? {
                OR: [
                  { ownerPartyId: { in: partyIds } },
                  { reviewerPartyId: { in: partyIds } },
                  { approverPartyId: { in: partyIds } },
                ],
              }
            : { id: "__no_party_access__" },
        );
      }

      if (definition.taskScoped && !hasProjectWideTaskVisibility(access)) {
        clauses.push({
          OR: [{ assigneeId: userId }, { createdById: userId }],
        });
      }

      return clauses.length === 1 ? clauses[0] : { AND: clauses };
    });

const applySearchFilters = ({
  where,
  definition,
  query,
  statuses,
  dateRange,
  includeArchived,
  userRole,
}) => {
  const currentOnlyApplies =
    definition.currentOnlyWhere &&
    CURRENT_ONLY_DOCUMENT_ROLES.has(normalizeRoleId(userRole));

  if (
    currentOnlyApplies &&
    statuses.length &&
    definition.statusField &&
    definition.currentOnlyWhere[definition.statusField] &&
    !statuses.includes(definition.currentOnlyWhere[definition.statusField])
  ) {
    return false;
  }

  if (query && definition.searchFields?.length) {
    where.AND.push({
      OR: definition.searchFields.map((field) => ({
        [field]: containsInsensitive(query),
      })),
    });
  }

  if (statuses.length) {
    if (definition.statusField) {
      const filteredStatuses = definition.statuses
        ? statuses.filter((status) => definition.statuses.includes(status))
        : statuses;
      if (!filteredStatuses.length) return false;
      where[definition.statusField] = { in: filteredStatuses };
    } else if (definition.derivedStatusClauses) {
      const clauses = definition.derivedStatusClauses(statuses);
      if (!clauses.length) return false;
      where.AND.push({ OR: clauses });
    } else {
      return false;
    }
  }

  if (dateRange && definition.dateField) {
    where[definition.dateField] = dateRange;
  }

  if (definition.archivedField && !includeArchived) {
    where[definition.archivedField] = null;
  }

  if (currentOnlyApplies) {
    Object.assign(where, definition.currentOnlyWhere);
  }

  if (definition.baseWhere) {
    Object.assign(where, definition.baseWhere);
  }

  return true;
};

const queryDefinition = async ({
  definition,
  projectAccesses,
  projectMap,
  orgId,
  userId,
  userRole,
  query,
  statuses,
  dateRange,
  includeArchived,
  take,
}) => {
  const visibilityClauses = projectVisibilityClauses({
    definition,
    projectAccesses,
    userId,
  });

  if (!visibilityClauses.length) return [];

  const where = {
    ...(definition.orgScoped ? { orgId } : {}),
    AND: [{ OR: visibilityClauses }],
  };

  const shouldSearch = applySearchFilters({
    where,
    definition,
    query,
    statuses,
    dateRange,
    includeArchived,
    userRole,
  });
  if (!shouldSearch) return [];

  const rows = await prisma[definition.model].findMany({
    where,
    select: definition.select,
    take,
    orderBy: [{ [definition.dateField || "updatedAt"]: "desc" }, { id: "desc" }],
  });

  return rows.map((row) =>
    definition.serialize(row, projectMap.get(row.projectId)),
  );
};

const queryProjectResults = ({
  projects,
  query,
  statuses,
  dateRange,
  limit,
}) => {
  return projects
    .map(({ project }) => project)
    .filter((project) => {
      if (statuses.length && !statuses.includes(project.status)) return false;
      if (dateRange) {
        const time = new Date(project.updatedAt).getTime();
        if (dateRange.gte && time < dateRange.gte.getTime()) return false;
        if (dateRange.lte && time > dateRange.lte.getTime()) return false;
      }
      if (!query) return true;
      return [
        project.name,
        project.type,
        project.location,
        project.clientName,
        project.contractNumber,
        project.status,
      ].some((value) => textMatches(value, query));
    })
    .slice(0, limit)
    .map((project) =>
      makeResult({
        row: project,
        project,
        type: "project",
        typeLabel: "Project",
        module: "project",
        title: project.name,
        subtitle: [project.type, project.location].filter(Boolean).join(" / "),
        identifier: project.contractNumber || null,
        status: project.status,
        url: projectUrl(project.id, { module: "overview", source: "project" }),
      }),
    );
};

const groupResults = (items) =>
  [...items.reduce((map, item) => {
    const group = map.get(item.type) || {
      type: item.type,
      label: item.typeLabel,
      count: 0,
    };
    group.count += 1;
    map.set(item.type, group);
    return map;
  }, new Map()).values()];

const globalSearch = async ({
  orgId,
  userId,
  role,
  query: rawQuery = {},
  apiClient = null,
}) => {
  // An API key never sees past its own scopes or projects, whatever its owner
  // may: search used to answer with the owner's whole view (Phase 21D, CX21-431).
  const keyProjects = apiClient?.projectIds?.length ? apiClient.projectIds : null;
  const keyAllowsType = (type) => {
    if (!apiClient) return true;
    const { scopeAllows } = require("./api-client.service");
    if (type === "project") return scopeAllows(apiClient, "project", "read");
    const definition = SEARCH_DEFINITIONS.find((entry) => entry.type === type);
    return definition ? scopeAllows(apiClient, definition.module, "read") : false;
  };
  const limit = normalizeLimit(rawQuery.limit);
  const query = trimToNull(rawQuery.q || rawQuery.search);
  const normalizedQuery = query?.toLowerCase() || null;
  const selectedTypes = normalizeTypes(rawQuery);
  const statuses = normalizeStatuses(rawQuery);
  const dateRange = parseDateRange(rawQuery);
  const projectId = trimToNull(rawQuery.projectId);
  if (keyProjects && projectId && !keyProjects.includes(projectId)) {
    throw new HttpError(403, "FORBIDDEN_PROJECT", "This API key is not allowed on that project");
  }
  const includeArchived =
    rawQuery.includeArchived === true || rawQuery.includeArchived === "true";
  const hasAnyFilter = Boolean(
    normalizedQuery ||
      selectedTypes ||
      statuses.length ||
      dateRange ||
      projectId,
  );

  if (!hasAnyFilter) {
    return {
      query: null,
      items: [],
      groups: [],
      filters: {
        types: selectedTypes || [],
        projectId,
        statuses,
        dateFrom: rawQuery.dateFrom || null,
        dateTo: rawQuery.dateTo || null,
      },
      meta: {
        limit,
        total: 0,
        authorizedProjectCount: 0,
        searchableTypes: SEARCHABLE_TYPES,
      },
    };
  }

  const accessible = await listAccessibleProjects({
    orgId,
    userId,
    role,
    projectId,
    includeArchived,
  });
  const projects = keyProjects ? accessible.filter(({ project }) => keyProjects.includes(project.id)) : accessible;
  const projectAccesses = projects.map(({ access }) => ({ access }));
  const projectMap = new Map(
    projects.map(({ project }) => [project.id, project]),
  );
  const activeTypes = (
    selectedTypes || SEARCHABLE_TYPES.map((entry) => entry.type)
  ).filter(keyAllowsType);
  const perTypeLimit = Math.min(
    Math.max(Math.ceil(limit / Math.max(activeTypes.length, 1)) + 3, 5),
    12,
  );

  const results = [];
  if (activeTypes.includes("project")) {
    results.push(
      ...queryProjectResults({
        projects,
        query: normalizedQuery,
        statuses,
        dateRange,
        limit: perTypeLimit,
      }),
    );
  }

  const definitions = SEARCH_DEFINITIONS.filter((definition) =>
    activeTypes.includes(definition.type),
  );

  const moduleResults = await Promise.all(
    definitions.map((definition) =>
      queryDefinition({
        definition,
        projectAccesses,
        projectMap,
        orgId,
        userId,
        userRole: role,
        query,
        statuses,
        dateRange,
        includeArchived,
        take: perTypeLimit,
      }),
    ),
  );
  results.push(...moduleResults.flat());

  // Full-text hits inside document contents (OCTA-DOC-TEXT-010). Only
  // projects where the caller can read document control are searched.
  if (query && activeTypes.includes("document")) {
    const contentProjectIds = projects
      .filter(({ access }) => canReadModule(access, "document_control"))
      .map(({ project }) => project.id);
    // Each hit is then judged as the document itself would be: by the modules
    // it is linked from, for this person on that project, and for a key by
    // its scopes (Phase 21D, CX21-522).
    const accessByProject = new Map(projects.map(({ project, access }) => [project.id, access]));
    const viewerFor = (id) => {
      const access = accessByProject.get(id);
      return {
        canRead: (moduleName) => Boolean(access) && canReadModule(access, moduleName) && (!apiClient || require("./api-client.service").scopeAllows(apiClient, moduleName, "read")),
        partyIds: access && isPartyScopedAccess(access) ? partyIdsFor(access) : null, // routed records through the party only (CX21-530)
        companyIds: access && isPartyScopedAccess(access) ? [...new Set((access.partyAccess || []).map((party) => party.companyId).filter(Boolean))] : null, // a company's own records (CX21-540)
        userId, // a person's own records, a conversation's members (CX21-540)
      };
    };
    if (contentProjectIds.length) {
      try {
        const contentHits = await require("./document-text.service").searchDocumentContent({
          orgId,
          projectIds: contentProjectIds,
          q: query,
          limit: perTypeLimit,
          viewerFor,
        });
        for (const hit of contentHits) {
          const project = projectMap.get(hit.projectId);
          results.push(
            makeResult({
              row: {
                id: `content:${hit.documentId}`,
                projectId: hit.projectId,
                updatedAt: hit.uploadedAt,
              },
              project,
              type: "document",
              typeLabel: "Document",
              module: "docControl",
              title: hit.title,
              subtitle: hit.snippetText || hit.fileName,
              identifier: hit.documentNumber || hit.fileName,
              status: null,
              date: hit.uploadedAt,
              url: hit.path || hit.fileUrl,
              metadata: {
                documentId: hit.documentId,
                snippet: hit.snippet,
                source: "content",
                fileUrl: hit.fileUrl,
              },
            }),
          );
        }
      } catch (error) {
        console.error("[search] document content search failed", error?.message || error);
      }
    }
  }

  const items = results
    .map((result) => ({
      ...result,
      score: scoreResult(result, normalizedQuery),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
    })
    .slice(0, limit);

  return {
    query,
    items,
    groups: groupResults(items),
    filters: {
      types: activeTypes,
      projectId,
      statuses,
      dateFrom: rawQuery.dateFrom || rawQuery.from || null,
      dateTo: rawQuery.dateTo || rawQuery.to || null,
    },
    meta: {
      limit,
      total: items.length,
      authorizedProjectCount: projects.length,
      searchableTypes: SEARCHABLE_TYPES,
    },
  };
};

module.exports = {
  SEARCHABLE_TYPES,
  globalSearch,
};
