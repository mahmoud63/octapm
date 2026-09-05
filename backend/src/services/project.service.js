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
    contractValue: project.contractValue,
    defaultRetentionRate:
      project.defaultRetentionRate ?? DEFAULT_RETENTION_RATE,
    ldRatePerDay: project.ldRatePerDay,
    weatherAllowanceDays: project.weatherAllowanceDays,
    projectCalendar: project.projectCalendar ?? null,
    reportingCutoffDay:
      project.reportingCutoffDay ?? DEFAULT_REPORTING_CUTOFF_DAY,
    currency: project.currency,
    status: project.status,
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

const createProject = async ({ orgId, userId, role, payload }) => {
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
  return sanitizeProject(project, { role });
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
    const nextProject = projects.pop();
    nextCursor = nextProject.id;
  }

  return {
    items: projects.map((project) =>
      sanitizeProject(project, { role, isCompanyAdmin }),
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
}) => {
  const project = await findAccessibleProject({
    orgId,
    projectId,
    userId,
    role,
    isCompanyAdmin,
  });

  return sanitizeProject(project, { role, isCompanyAdmin });
};

const updateProject = async ({ orgId, projectId, userId, role, payload }) => {
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
  if (Object.keys(data).length === 0 && !partySyncPayload) {
    throw new HttpError(
      400,
      "NO_UPDATES",
      "No valid fields provided for update",
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

  return sanitizeProject(updatedProject, { role });
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
  DEFAULT_RETENTION_RATE,
  DEFAULT_REPORTING_CUTOFF_DAY,
};
