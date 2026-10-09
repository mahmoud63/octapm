const { prisma } = require("../config/db");
const { normalizeRoleId } = require("../config/permissions");
const { HttpError } = require("../utils/http-error");
const { toMoneyNumber } = require("../utils/money");
const {
  canAccessAllProjects,
  getProjectAccessWhere,
  projectPartyAccessSelect,
  serializePartyAccess,
  throwProjectNotFoundOrAccessDenied,
} = require("./project-authorization.service");
const companyPartyService = require("./company-party.service");
const auditService = require("./audit.service");
const {
  ARCHIVED_STATUS,
  applyArchiveVisibility,
  assertNotArchived,
  archiveResult,
} = require("./archive-policy.service");

const DEFAULT_RETENTION_RATE = 5;
const DEFAULT_REPORTING_CUTOFF_DAY = 25;

const cleanOptionalString = (value) => {
  if (value === null) return null;
  const trimmed = String(value || "").trim();
  return trimmed || null;
};

const parseOptionalDate = (value) => {
  if (value === null || value === "") return null;
  return value !== undefined ? new Date(value) : undefined;
};

const parseOptionalNumber = (value) => {
  if (value === null || value === "") return null;
  return value !== undefined ? Number(value) : undefined;
};

const parseOptionalMoney = (value) => {
  if (value === null || value === "") return null;
  return value !== undefined ? toMoneyNumber(value) : undefined;
};

const getProjectAssignmentRole = (project) =>
  normalizeRoleId(project.assignments?.[0]?.role) || null;

const getProjectPartyAccess = (project) => serializePartyAccess(project.parties);

const buildProjectAccess = ({ project, role, isCompanyAdmin = false }) => {
  const orgRole = normalizeRoleId(role) || null;
  const assignmentRole = getProjectAssignmentRole(project);
  const partyAccess = getProjectPartyAccess(project);
  const orgWide = canAccessAllProjects(orgRole, { isCompanyAdmin });
  const effectiveRole = orgWide
    ? assignmentRole || orgRole
    : assignmentRole || (partyAccess.length ? "external_party" : orgRole);

  return {
    role: effectiveRole,
    effectiveRole,
    assignmentRole,
    orgRole,
    isCompanyAdmin: Boolean(isCompanyAdmin),
    scope: assignmentRole
      ? "assignment"
      : partyAccess.length
        ? "party"
        : orgWide
          ? "org"
          : "assignment",
    partyRole: partyAccess[0]?.role || null,
    partyAccess,
  };
};

/**
 * The project's commercial terms: the main contract sum, the liquidated
 * damages rate and the default retention. They are the client contract's
 * figures, and GET /projects/:id/prime-contract states them only to a member
 * who may read payment certificates there (ipc:read — template, role or
 * party). The project record states them on the same terms (certification
 * L25): every caller of this service says, per project, whether the person
 * asking may read them (`commercialAccessFor(projectId)`); without that answer
 * they are withheld. A caller they are withheld from gets the record with the
 * three set to null and `commercialTermsWithheld: true`, and cannot change them
 * through the project edit either: the edit form they were withheld from would
 * otherwise write its blanks and defaults over the real figures.
 */
const COMMERCIAL_TERMS = Object.freeze([
  "contractValue",
  "defaultRetentionRate",
  "ldRatePerDay",
]);

const mayReadCommercialTerms = async (commercialAccessFor, projectId) =>
  typeof commercialAccessFor === "function" &&
  (await commercialAccessFor(projectId)) === true;

/**
 * The request as each of several projects' own routes see it — what
 * middleware/project-access requestForProject builds for one project: the
 * project access assertProjectAccess returns (assignment role, parties, the
 * effective role) with the permission template attachTemplateContext adds —
 * built for a whole page of projects in three queries instead of three or
 * four per project (certification R28: GET /projects?limit=100 ran several
 * hundred statements). A project the person cannot open, or one outside an
 * API key's projects, gets a view with no person, and hasPermission then
 * allows nothing there, as requestForProject leaves it.
 */
const requestsForProjects = async ({ req, projectIds = [] }) => {
  const ids = [...new Set((projectIds || []).filter(Boolean))];
  const user = req?.user || null;
  const apiClient = req?.apiClient;
  const views = new Map(
    ids.map((projectId) => [
      projectId,
      { user: null, apiClient, params: { projectId } },
    ]),
  );
  const keyProjects = apiClient?.projectIds?.length ? apiClient.projectIds : null;
  const reachable = ids.filter(
    (projectId) => !keyProjects || keyProjects.includes(projectId),
  );
  if (!user || !reachable.length) return views;

  const isCompanyAdmin = Boolean(user.isCompanyAdmin);
  // As assertProjectAccess: an org-wide reader's assignment and parties are
  // read only when they are a company admin (templates and party rules apply
  // to them); anyone else's always.
  const orgWide = canAccessAllProjects(user.role, { isCompanyAdmin });
  const withMembership = Boolean(user.id) && (!orgWide || isCompanyAdmin);
  const projects = await prisma.project.findMany({
    where: {
      id: { in: reachable },
      orgId: user.orgId,
      ...getProjectAccessWhere({
        userId: user.id,
        role: user.role,
        isCompanyAdmin,
        orgId: user.orgId,
      }),
    },
    select: {
      id: true,
      orgId: true,
      ...(withMembership
        ? {
            assignments: {
              where: { userId: user.id },
              select: { role: true },
              take: 1,
            },
            parties: projectPartyAccessSelect(user.id),
          }
        : {}),
    },
  });

  const accesses = projects.map((project) => {
    const assignmentRole =
      normalizeRoleId(project.assignments?.[0]?.role) || null;
    const partyAccess = serializePartyAccess(project.parties || []);
    return {
      id: project.id,
      orgId: project.orgId,
      role:
        assignmentRole ||
        (partyAccess.length ? "external_party" : normalizeRoleId(user.role)),
      assignmentRole,
      partyAccess,
      isCompanyAdmin,
      scope: assignmentRole
        ? "assignment"
        : partyAccess.length
          ? "party"
          : "org",
    };
  });

  // Permission templates, as attachTemplateContext attaches them: a lookup
  // that fails leaves the role and party policy in place, never an error.
  let templates = new Map();
  try {
    const { templatesForProjects } = require("./permission-template.service");
    templates = await templatesForProjects({
      userId: user.id,
      projects: accesses.map((access) => ({
        id: access.id,
        partyIds: access.partyAccess
          .map((party) => party.projectPartyId)
          .filter(Boolean),
      })),
    });
  } catch (error) {
    console.error("[permissions] template resolution failed", error);
  }

  for (const access of accesses) {
    const template = templates.get(access.id);
    if (template) access.template = template;
    views.set(access.id, {
      user,
      apiClient,
      params: { projectId: access.id },
      projectAccess: access,
    });
  }
  return views;
};

/**
 * The ids among these projects whose commercial terms (COMMERCIAL_TERMS) the
 * person may read: ipc:read there, decided on each project's own view
 * (requestsForProjects) — the rule GET /projects/:id applies to one project.
 */
const commercialTermsReadableIds = async ({ req, projectIds = [] }) => {
  // Lazy: the permission decision lives with the middleware.
  const { hasPermission } = require("../middleware/rbac");
  const views = await requestsForProjects({ req, projectIds });
  return new Set(
    [...views.entries()]
      .filter(([, view]) => hasPermission(view, "ipc", "read"))
      .map(([projectId]) => projectId),
  );
};

/**
 * Values the project form sends for terms it was not shown: blanks, and the
 * defaults it puts in their place (retention 5, LD rate 0). An edit that
 * carries only these did not try to set a withheld term.
 */
const isBlankOrFormDefault = (key, value) => {
  if (value === null || value === undefined || value === "") return true;
  if (key === "defaultRetentionRate") {
    return Number(value) === DEFAULT_RETENTION_RATE;
  }
  if (key === "ldRatePerDay") return Number(value) === 0;
  return false;
};

const projectAuditSummary = (project) => ({
  name: project.name,
  type: project.type || null,
  clientName: project.clientName || null,
  contractNumber: project.contractNumber || null,
  status: project.status,
  archivedAt: project.archivedAt || null,
  archivedBy: project.archivedBy || null,
});

const sanitizeProject = (project, options = {}) => {
  const projectAccess = buildProjectAccess({
    project,
    role: options.role,
    isCompanyAdmin: options.isCompanyAdmin,
  });
  const commercial = options.commercial === true;

  return {
    id: project.id,
    orgId: project.orgId,
    name: project.name,
    type: project.type,
    location: project.location,
    clientName: project.clientName ?? null,
    consultantName: project.consultantName ?? null,
    contractorName: project.contractorName ?? null,
    contractType: project.contractType ?? null,
    contractNumber: project.contractNumber ?? null,
    startDate: project.startDate,
    endDate: project.endDate,
    completionDate: project.completionDate ?? null,
    baselineDate: project.baselineDate ?? null,
    dataDate: project.dataDate ?? null,
    revisedCompletionDate: project.revisedCompletionDate ?? null,
    duration: project.duration,
    durationUnit: project.durationUnit,
    contractValue: commercial ? project.contractValue : null,
    defaultRetentionRate: commercial
      ? project.defaultRetentionRate ?? DEFAULT_RETENTION_RATE
      : null,
    ldRatePerDay: commercial ? project.ldRatePerDay : null,
    commercialTermsWithheld: !commercial,
    weatherAllowanceDays: project.weatherAllowanceDays,
    projectCalendar: project.projectCalendar ?? null,
    reportingCutoffDay:
      project.reportingCutoffDay ?? DEFAULT_REPORTING_CUTOFF_DAY,
    currency: project.currency,
    status: project.status,
    templateId: project.templateId ?? null,
    documentFolders: Array.isArray(project.documentFoldersJson)
      ? project.documentFoldersJson
      : [],
    archivedAt: project.archivedAt ?? null,
    archivedBy: project.archivedBy ?? null,
    parties: (project.parties || [])
      .filter((party) => party.createdAt && party.company)
      .map((party) => companyPartyService.sanitizeProjectParty(party)),
    projectAccess,
    effectiveRole: projectAccess.effectiveRole,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
};

const buildProjectData = (payload) => {
  const data = {};

  if (payload.name !== undefined) data.name = payload.name;
  if (payload.type !== undefined) data.type = cleanOptionalString(payload.type);
  if (payload.location !== undefined)
    data.location = cleanOptionalString(payload.location);
  if (payload.clientName !== undefined)
    data.clientName = cleanOptionalString(payload.clientName);
  if (payload.consultantName !== undefined)
    data.consultantName = cleanOptionalString(payload.consultantName);
  if (payload.contractorName !== undefined)
    data.contractorName = cleanOptionalString(payload.contractorName);
  if (payload.contractType !== undefined)
    data.contractType = cleanOptionalString(payload.contractType);
  if (payload.contractNumber !== undefined)
    data.contractNumber = cleanOptionalString(payload.contractNumber);
  if (payload.startDate !== undefined)
    data.startDate = parseOptionalDate(payload.startDate);
  if (payload.endDate !== undefined)
    data.endDate = parseOptionalDate(payload.endDate);
  if (payload.completionDate !== undefined)
    data.completionDate = parseOptionalDate(payload.completionDate);
  if (payload.baselineDate !== undefined)
    data.baselineDate = parseOptionalDate(payload.baselineDate);
  if (payload.dataDate !== undefined)
    data.dataDate = parseOptionalDate(payload.dataDate);
  if (payload.revisedCompletionDate !== undefined)
    data.revisedCompletionDate = parseOptionalDate(
      payload.revisedCompletionDate,
    );
  if (payload.duration !== undefined) data.duration = payload.duration;
  if (payload.durationUnit !== undefined)
    data.durationUnit = payload.durationUnit;
  if (payload.contractValue !== undefined)
    data.contractValue = parseOptionalMoney(payload.contractValue);
  if (payload.defaultRetentionRate !== undefined) {
    data.defaultRetentionRate = parseOptionalNumber(
      payload.defaultRetentionRate,
    );
  }
  if (payload.ldRatePerDay !== undefined)
    data.ldRatePerDay = toMoneyNumber(payload.ldRatePerDay);
  if (payload.weatherAllowanceDays !== undefined)
    data.weatherAllowanceDays = Number(payload.weatherAllowanceDays) || 0;
  if (payload.projectCalendar !== undefined)
    data.projectCalendar = cleanOptionalString(payload.projectCalendar);
  if (payload.reportingCutoffDay !== undefined)
    data.reportingCutoffDay = parseOptionalNumber(payload.reportingCutoffDay);
  if (payload.currency !== undefined) data.currency = payload.currency;
  if (payload.status !== undefined) data.status = payload.status;

  return data;
};

const extractPartySyncPayload = (payload = {}) => {
  if (payload.parties !== undefined) return payload.parties;

  const entries = [];
  if (payload.clientName !== undefined) {
    entries.push({ role: "owner", companyName: payload.clientName });
  }
  if (payload.consultantName !== undefined) {
    entries.push({ role: "consultant", companyName: payload.consultantName });
  }
  if (payload.contractorName !== undefined) {
    entries.push({ role: "contractor", companyName: payload.contractorName });
  }

  return entries.length ? entries : null;
};

const includeUserProjectAccess = (userId) =>
  userId
    ? {
        include: {
          assignments: {
            where: { userId },
            select: { role: true },
            take: 1,
          },
          parties: projectPartyAccessSelect(userId),
        },
      }
    : {};

const validateProjectDates = ({
  startDate,
  endDate,
  completionDate,
  revisedCompletionDate,
}) => {
  if (startDate && endDate && endDate <= startDate) {
    throw new HttpError(
      400,
      "INVALID_DATES",
      "endDate must be after startDate",
    );
  }

  if (startDate && completionDate && completionDate < startDate) {
    throw new HttpError(
      400,
      "INVALID_DATES",
      "completionDate must be on or after startDate",
    );
  }

  if (startDate && revisedCompletionDate && revisedCompletionDate < startDate) {
    throw new HttpError(
      400,
      "INVALID_DATES",
      "revisedCompletionDate must be on or after startDate",
    );
  }
};

const createProject = async ({
  orgId,
  userId,
  role,
  payload,
  commercialAccessFor = null,
}) => {
  const data = buildProjectData(payload);
  const partySyncPayload = extractPartySyncPayload(payload);
  if (data.status === ARCHIVED_STATUS) {
    throw new HttpError(
      400,
      "PROJECT_ARCHIVE_ACTION_REQUIRED",
      "Projects cannot be created as archived",
    );
  }
  data.orgId = orgId;
  // A new project starts from its workspace's defaults (ENT-6, acceptance
  // §16) for what its creator did not name: the currency, and the time zone
  // when the workspace chose one. Only at creation — an existing project is
  // never rewritten when the workspace's defaults change.
  // (A test double without the organisation model keeps the column defaults.)
  if (
    (data.currency === undefined || data.timezone === undefined) &&
    prisma.organisation?.findUnique
  ) {
    const workspace = await prisma.organisation.findUnique({
      where: { id: orgId },
      select: { defaultCurrency: true, defaultTimezone: true },
    });
    if (data.currency === undefined && workspace?.defaultCurrency) {
      data.currency = workspace.defaultCurrency;
    }
    if (data.timezone === undefined && workspace?.defaultTimezone) {
      data.timezone = workspace.defaultTimezone;
    }
  }

  if (userId) {
    data.assignments = {
      create: {
        userId,
        role: role || "project_member",
      },
    };
  }

  validateProjectDates({
    startDate: data.startDate,
    endDate: data.endDate,
    completionDate: data.completionDate,
    revisedCompletionDate: data.revisedCompletionDate,
  });

  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({ data });
    if (partySyncPayload) {
      await companyPartyService.syncProjectParties({
        tx,
        orgId,
        projectId: project.id,
        parties: partySyncPayload,
      });
    }
    return project;
  });

  const project = await prisma.project.findFirst({
    where: { id: created.id, orgId },
    ...includeUserProjectAccess(userId),
  });
  return sanitizeProject(project, {
    role,
    commercial: await mayReadCommercialTerms(commercialAccessFor, project.id),
  });
};

const findAccessibleProject = async ({
  orgId,
  projectId,
  userId,
  role,
  isCompanyAdmin = false,
}) => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      orgId,
      ...getProjectAccessWhere({ userId, role, isCompanyAdmin }),
    },
    ...includeUserProjectAccess(userId),
  });

  if (!project) {
    await throwProjectNotFoundOrAccessDenied({ orgId, projectId });
  }

  return project;
};

const listProjects = async ({
  orgId,
  userId,
  role,
  isCompanyAdmin = false,
  query,
  commercialAccessFor = null,
  commercialAccessForProjects = null,
}) => {
  const take = Math.min(Math.max(query.limit || 20, 1), 100);

  const where = {
    orgId,
    ...getProjectAccessWhere({ userId, role, isCompanyAdmin }),
  };

  if (query.status) {
    where.status = query.status;
  }
  applyArchiveVisibility(where, query);

  if (query.search) {
    where.name = {
      contains: query.search,
      mode: "insensitive",
    };
  }

  const projects = await prisma.project.findMany({
    where,
    take: take + 1,
    orderBy: {
      id: "asc",
    },
    ...includeUserProjectAccess(userId),
    ...(query.cursor
      ? {
          cursor: { id: query.cursor },
          skip: 1,
        }
      : {}),
  });

  let nextCursor = null;
  if (projects.length > take) {
    projects.pop();
  // The cursor is the last row we actually returned, not the look-ahead row.
  // Prisma's `cursor` is inclusive and `skip: 1` steps over it, so handing
  // back the look-ahead id meant the next page began *after* it and that row
  // was returned by no page at all — one record lost per page boundary,
  // silently (OCTA-API-PAGING-110).
    nextCursor = projects[projects.length - 1].id;
  }

  // Decided per project, as each project's own routes decide it — for the
  // whole page at once when the caller can (`commercialAccessForProjects`,
  // ids → the readable ids; certification R28), else one project at a time.
  let commercial;
  if (typeof commercialAccessForProjects === "function") {
    const readable = await commercialAccessForProjects(
      projects.map((project) => project.id),
    );
    commercial = projects.map(
      (project) => readable instanceof Set && readable.has(project.id),
    );
  } else {
    commercial = await Promise.all(
      projects.map((project) =>
        mayReadCommercialTerms(commercialAccessFor, project.id),
      ),
    );
  }

  return {
    items: projects.map((project, index) =>
      sanitizeProject(project, {
        role,
        isCompanyAdmin,
        commercial: commercial[index],
      }),
    ),
    pagination: {
      limit: take,
      nextCursor,
    },
  };
};

const getProjectById = async ({
  orgId,
  projectId,
  userId,
  role,
  isCompanyAdmin = false,
  commercialAccessFor = null,
}) => {
  const project = await findAccessibleProject({
    orgId,
    projectId,
    userId,
    role,
    isCompanyAdmin,
  });

  return sanitizeProject(project, {
    role,
    isCompanyAdmin,
    commercial: await mayReadCommercialTerms(commercialAccessFor, project.id),
  });
};

/**
 * The workspace dashboard states the same contract value: each project's
 * health row carries it and the summary adds them up over every project the
 * caller can open. A row of a project whose terms are withheld from the caller
 * (COMMERCIAL_TERMS) loses it (`contractValue: null, contractValueWithheld:
 * true`), and the total counts only the projects whose terms the caller may
 * read — null when there is none, `totalContractValueWithheld: true` when any
 * was left out. The projects are the dashboard's own: the ones the caller can
 * open, not archived (workspace-dashboard.service). Nothing changes for a
 * caller who may read every project's terms.
 */
const withheldDashboardContractValues = async ({
  dashboard,
  orgId,
  userId,
  role,
  isCompanyAdmin = false,
  commercialAccessFor = null,
}) => {
  if (!dashboard || typeof dashboard !== "object") return dashboard;
  const projects = await prisma.project.findMany({
    where: {
      orgId,
      archivedAt: null,
      ...getProjectAccessWhere({ userId, role, isCompanyAdmin }),
    },
    select: { id: true, contractValue: true },
  });
  const readable = new Set();
  await Promise.all(
    projects.map(async (project) => {
      if (await mayReadCommercialTerms(commercialAccessFor, project.id)) {
        readable.add(project.id);
      }
    }),
  );
  const rows = Array.isArray(dashboard.projectHealth)
    ? dashboard.projectHealth
    : [];
  const withheldRows = rows.some((row) => !readable.has(row.id));
  const withheldTotal = projects.some((project) => !readable.has(project.id));
  if (!withheldRows && !withheldTotal) return dashboard;

  const result = { ...dashboard };
  if (withheldRows) {
    result.projectHealth = rows.map((row) =>
      readable.has(row.id)
        ? row
        : { ...row, contractValue: null, contractValueWithheld: true },
    );
  }
  if (withheldTotal && dashboard.summary) {
    const shown = projects.filter((project) => readable.has(project.id));
    result.summary = {
      ...dashboard.summary,
      totalContractValue: shown.length
        ? shown.reduce(
            (sum, project) => sum + (Number(project.contractValue) || 0),
            0,
          )
        : null,
      totalContractValueWithheld: true,
    };
  }
  return result;
};

const updateProject = async ({
  orgId,
  projectId,
  userId,
  role,
  payload,
  commercialAccessFor = null,
}) => {
  const existingProject = await findAccessibleProject({
    orgId,
    projectId,
    userId,
    role,
  });
  assertNotArchived(existingProject, {
    code: "PROJECT_ARCHIVED",
    message:
      "Archived projects cannot be updated through normal project edit actions",
  });

  const data = buildProjectData(payload);
  const partySyncPayload = extractPartySyncPayload(payload);
  if (data.status === ARCHIVED_STATUS) {
    throw new HttpError(
      400,
      "PROJECT_ARCHIVE_ACTION_REQUIRED",
      "Use the archive/delete endpoint to archive a project",
    );
  }
  // Terms withheld from this caller stay as they stand (COMMERCIAL_TERMS).
  // A value the caller typed for one of them is not stored, and the answer
  // says so (`ignoredFields`, certification R24) — the form's own blanks
  // and defaults for terms it was not shown are not named.
  const commercial = await mayReadCommercialTerms(
    commercialAccessFor,
    projectId,
  );
  const ignoredFields = [];
  if (!commercial) {
    for (const key of COMMERCIAL_TERMS) {
      if (data[key] !== undefined && !isBlankOrFormDefault(key, payload[key])) {
        ignoredFields.push(key);
      }
      delete data[key];
    }
  }
  if (Object.keys(data).length === 0 && !partySyncPayload) {
    throw new HttpError(
      400,
      "NO_UPDATES",
      "No valid fields provided for update",
      ignoredFields.length ? { ignoredFields } : undefined,
    );
  }

  const nextStartDate =
    data.startDate !== undefined ? data.startDate : existingProject.startDate;
  const nextEndDate =
    data.endDate !== undefined ? data.endDate : existingProject.endDate;
  const nextCompletionDate =
    data.completionDate !== undefined
      ? data.completionDate
      : existingProject.completionDate;
  const nextRevisedCompletionDate =
    data.revisedCompletionDate !== undefined
      ? data.revisedCompletionDate
      : existingProject.revisedCompletionDate;
  validateProjectDates({
    startDate: nextStartDate,
    endDate: nextEndDate,
    completionDate: nextCompletionDate,
    revisedCompletionDate: nextRevisedCompletionDate,
  });

  await prisma.$transaction(async (tx) => {
    // A save that re-syncs the parties takes the party rows first, in id
    // order, and the project row after — the order a party edit takes them
    // (the party, then the project's legacy names), so the two never wait on
    // each other in a cycle.
    if (partySyncPayload && typeof tx.$queryRaw === "function") {
      await tx.$queryRaw`SELECT "id" FROM "ProjectParty" WHERE "projectId" = ${projectId} ORDER BY "id" FOR UPDATE`;
    }
    if (Object.keys(data).length > 0) {
      await tx.project.update({
        where: { id: projectId },
        data,
      });
    }

    if (partySyncPayload) {
      await companyPartyService.syncProjectParties({
        tx,
        orgId,
        projectId,
        parties: partySyncPayload,
      });
    }
  });

  const updatedProject = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    ...includeUserProjectAccess(userId),
  });

  const result = sanitizeProject(updatedProject, { role, commercial });
  return ignoredFields.length ? { ...result, ignoredFields } : result;
};

const deleteProject = async ({ orgId, projectId, userId, role }) => {
  const existingProject = await findAccessibleProject({
    orgId,
    projectId,
    userId,
    role,
  });

  if (
    existingProject.status === ARCHIVED_STATUS ||
    existingProject.archivedAt
  ) {
    return archiveResult({
      id: projectId,
      status: ARCHIVED_STATUS,
      archivedAt: existingProject.archivedAt,
    });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const archived = await tx.project.update({
      where: { id: projectId },
      data: {
        status: ARCHIVED_STATUS,
        archivedAt: now,
        archivedBy: userId || null,
      },
    });

    // The project's reference counters stay: an archive is a soft state, and
    // a counter dropped here would reseed from the register's highest row when
    // the project came back — reissuing any reference whose row was deleted
    // before the archive. Counters are purged only by the paths that hard
    // delete a project or an organisation (utils/reference-number.js).

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.PROJECT,
      entityId: projectId,
      action: auditService.ACTIONS.ARCHIVED,
      actorId: userId,
      actorRole: role,
      oldStatus: existingProject.status,
      newStatus: archived.status,
      oldSummary: projectAuditSummary(existingProject),
      newSummary: projectAuditSummary(archived),
      summary: {
        transition: "project.archive",
        name: archived.name,
        status: archived.status,
      },
      metadata: { source: "project.archive" },
    });
  });

  return archiveResult({ id: projectId, archivedAt: now });
};

module.exports = {
  createProject,
  listProjects,
  getProjectById,
  updateProject,
  deleteProject,
  withheldDashboardContractValues,
  requestsForProjects,
  commercialTermsReadableIds,
  COMMERCIAL_TERMS,
  DEFAULT_RETENTION_RATE,
  DEFAULT_REPORTING_CUTOFF_DAY,
};
