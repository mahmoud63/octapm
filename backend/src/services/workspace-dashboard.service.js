const { prisma } = require("../config/db");
const evService = require("./earned-value.service");
const {
  SEVERITY_RANK,
  computeProcurementRisk,
  serializeDate,
} = require("./procurement-risk.service");
const {
  ACTIVITY_SELECT,
  buildLineRiskRow,
  buildMaterialRiskRow,
  buildPackageRiskRow,
  isOnSettledOrder,
} = require("./procurement.service");
const { getProjectAccessWhere } = require("./project-authorization.service");
const { withheldCertificateTotals } = require("../utils/boq-figures");

const ACTION_LIMIT = 5;
const HEALTH_DIMENSIONS = [
  { key: "schedule", label: "Schedule" },
  { key: "cost", label: "Cost" },
  { key: "commercial", label: "Commercial" },
  { key: "supplyChain", label: "Supply Chain" },
  { key: "quality", label: "Quality" },
  { key: "safety", label: "Safety" },
  { key: "docControl", label: "Doc Control" },
];

const CLOSED_STATUSES = new Set(["closed", "complete", "completed", "paid"]);
const RFI_CLOSED_STATUSES = new Set(["answered", "closed"]);
const EXCLUDED_OFFICIAL_STATUSES = new Set([
  "draft",
  "rejected",
  "cancelled",
  "canceled",
  "void",
]);
const OFFICIAL_SOURCE_STATUS = "approved-or-official";

const KPI_SOURCE_RULES = Object.freeze({
  portfolioHealth: {
    source: "Workspace project health dimensions",
    formula:
      "Average of project health scores. Schedule and cost dimensions use official EV from approved allocations, approved progress, approved cost loading, and CostRecord.actualThroughDate through cutoff.",
    officialOnly: true,
  },
  activeProjects: {
    source: "Project.status",
    formula:
      "Count projects in the authenticated workspace scope with status=active over all visible projects.",
    officialOnly: true,
  },
  criticalActivities: {
    source: "Activity.isCritical",
    formula:
      "Count active non-milestone activities flagged critical in the current accepted schedule. Delayed count uses latest approved ActivityProgress only.",
    officialOnly: true,
  },
  costActuals: {
    source: "CostRecord.actualThroughDate",
    formula:
      "Count official actual-cost rows included by the EV engine where actualThroughDate is on or before the reporting cutoff.",
    officialOnly: true,
  },
  procurementAtRisk: {
    source:
      "Procurement orders, packages, PO lines, activity materials, and long-lead items",
    formula:
      "Count official procurement records whose need/order/delivery dates are at risk. Draft, rejected, cancelled, and void records are excluded.",
    officialOnly: true,
  },
  overdueDocQuality: {
    source: "NCR, RFI, and Submittal records",
    formula:
      "Count open overdue NCRs, safety actions, RFIs, and active submittal reviews. Rejected records are excluded from official KPI counts.",
    officialOnly: true,
  },
  openTasks: {
    source: "Persisted Task records",
    formula:
      "Count non-archived project tasks from the authenticated workspace scope. Overdue tasks are open tasks with dueDate before the dashboard date.",
    officialOnly: true,
  },
  pendingReview: {
    source: "Submitted or pending workflow records",
    formula:
      "Separate queue of schedule revisions, progress submissions, IPC submissions, payment/retention actions, change orders, QA/safety closeouts, and submittal reviews waiting for action. These values do not feed official KPI cards.",
    officialOnly: false,
  },
});

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreByIndex(index) {
  if (index >= 1) return 100;
  if (index >= 0.9) return 80;
  if (index >= 0.75) return 60;
  return 40;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function latestIso(values) {
  const latest = values.reduce((current, value) => {
    if (!value) return current;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return current;
    if (!current || date > current) return date;
    return current;
  }, null);

  return toIso(latest);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + Number(days || 0));
  return result;
}

function lower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isOpenStatus(value, closedStatuses = CLOSED_STATUSES) {
  return !closedStatuses.has(lower(value));
}

function isOfficialStatus(value) {
  return !EXCLUDED_OFFICIAL_STATUSES.has(lower(value));
}

function average(values, fallback = 0) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return fallback;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function groupByProject(rows) {
  return rows.reduce((map, row) => {
    const existing = map.get(row.projectId) || [];
    existing.push(row);
    map.set(row.projectId, existing);
    return map;
  }, new Map());
}

function countByProject(rows, predicate = () => true) {
  return rows.reduce((map, row) => {
    if (!predicate(row)) return map;
    map.set(row.projectId, (map.get(row.projectId) || 0) + 1);
    return map;
  }, new Map());
}

function getPlannedFinish(project, activity) {
  if (
    project?.startDate &&
    activity.earlyFinish !== null &&
    activity.earlyFinish !== undefined
  ) {
    return addDays(project.startDate, activity.earlyFinish);
  }

  return activity.endDate || null;
}

function isDelayedActivity({ project, activity, today }) {
  const finish = getPlannedFinish(project, activity);
  if (!finish) return false;

  const pct = toNumber(activity.progress?.[0]?.pctComplete);
  return new Date(finish) < today && pct < 100;
}

function buildEmptyDashboard() {
  const generatedAt = new Date().toISOString();

  return {
    generatedAt,
    dataFreshness: {
      generatedAt,
      cutoffDate: null,
      sourceUpdatedAt: null,
      note: "No source records available yet.",
    },
    kpiSourceRules: KPI_SOURCE_RULES,
    myOpenItems: {
      items: [],
      summary: { total: 0, overdue: 0, ballInCourt: 0, byType: {} },
    },
    summary: {
      totalProjects: 0,
      activeProjects: 0,
      totalContractValue: 0,
      portfolioHealthScore: null,
      delayedActivities: 0,
      criticalActivities: 0,
      approvalQueueCount: 0,
      procurementAtRisk: 0,
      overdueNcrRfi: 0,
      openTasks: 0,
      overdueTasks: 0,
    },
    officialKpis: [],
    pendingReview: {
      total: 0,
      metrics: [],
      sourceRule: KPI_SOURCE_RULES.pendingReview,
    },
    healthDimensions: HEALTH_DIMENSIONS.map((dimension) => ({
      ...dimension,
      score: null,
      detail: "No project data yet",
      count: 0,
      sourceRule: KPI_SOURCE_RULES.portfolioHealth,
      cutoffDate: null,
    })),
    workflowQueues: [],
    projectHealth: [],
    emptyState: {
      title: "No projects yet",
      message:
        "Create a project to start tracking schedule, cost, approvals, procurement, quality, and document-control health.",
      action: { label: "Create Project", target: { module: "projects" } },
    },
  };
}

function queueTarget(projectId, module, child, filters = {}) {
  return {
    projectId,
    module,
    ...(child ? { child } : {}),
    ...filters,
  };
}

function buildQueueItem({
  id,
  projectId,
  projectName,
  title,
  meta,
  severity = "attention",
  module,
  child,
  targetFilters = {},
  dueDate = null,
  valueWithheld = null,
}) {
  return {
    id,
    projectId,
    projectName,
    title,
    meta,
    severity,
    dueDate: toIso(dueDate),
    target: queueTarget(projectId, module, child, {
      recordId: id,
      ...targetFilters,
    }),
    ...(valueWithheld ? { valueWithheld } : {}),
  };
}

function buildQueue({ key, label, count, description, items, module, child }) {
  return {
    key,
    label,
    count,
    description,
    items,
    defaultTarget: items[0]
      ? items[0].target
      : { projectId: null, module, child },
  };
}

function buildKpi({
  key,
  label,
  value,
  detail,
  sourceRule,
  cutoffDate,
  generatedAt,
  target,
  unit = "count",
}) {
  return {
    key,
    label,
    value,
    unit,
    detail,
    sourceRule,
    sourceStatus: OFFICIAL_SOURCE_STATUS,
    cutoffDate,
    generatedAt,
    target,
  };
}

function buildPendingMetric({
  key,
  label,
  count,
  detail,
  target,
  source,
  cutoffDate,
}) {
  return {
    key,
    label,
    count,
    detail,
    source,
    sourceStatus: "pending-review",
    excludedFromOfficialKpis: true,
    cutoffDate,
    target,
  };
}

function summarizeRiskRows({ rows, projectById, today }) {
  const bySeverity = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
  };

  let daysAtRisk = 0;

  const risks = rows.map((row) => {
    const risk = computeProcurementRisk(row, {
      project: projectById.get(row.projectId),
      today,
    });

    bySeverity[risk.severity] += 1;
    daysAtRisk += risk.daysAtRisk || 0;

    return { row, risk };
  });

  const penalty =
    bySeverity.critical * 25 +
    bySeverity.high * 15 +
    bySeverity.medium * 8 +
    bySeverity.low * 3;

  const atRiskItems = bySeverity.critical + bySeverity.high + bySeverity.medium;

  const topRisks = risks
    .filter(({ risk }) => risk.isAtRisk)
    .sort((a, b) => {
      const severityDelta =
        SEVERITY_RANK[b.risk.severity] - SEVERITY_RANK[a.risk.severity];
      if (severityDelta !== 0) return severityDelta;
      return (b.risk.daysAtRisk || 0) - (a.risk.daysAtRisk || 0);
    })
    .slice(0, ACTION_LIMIT)
    .map(({ row, risk }) => ({
      id: row.id,
      projectId: row.projectId,
      projectName: projectById.get(row.projectId)?.name || "Project",
      item: row.item,
      source: row.ref ? "procurement_order" : "long_lead",
      ref: row.ref || null,
      severity: risk.severity,
      reason: risk.reason,
      daysAtRisk: risk.daysAtRisk,
      needDate: serializeDate(risk.needDate),
      orderByDate: serializeDate(risk.orderByDate),
      expectedDeliveryDate: serializeDate(risk.expectedDeliveryDate),
      impactedActivity: risk.impactedActivity,
    }));

  return {
    bySeverity,
    atRiskItems,
    daysAtRisk,
    penalty,
    topRisks,
    risks,
  };
}

async function getEvReports({ orgId, projects }) {
  const settled = await Promise.allSettled(
    projects.map(async (project) => {
      const report = await evService.buildOfficialEvReport({
        orgId,
        projectId: project.id,
      });
      return [project.id, report];
    }),
  );

  return settled.reduce((map, result) => {
    if (result.status === "fulfilled") {
      const [projectId, report] = result.value;
      map.set(projectId, report);
    }
    return map;
  }, new Map());
}

/**
 * The RFIs and submittals this caller's own registers list on each project
 * (rfi.service listRfis, submittal.service listSubmittals), as where clauses:
 * on a project they reach through a party (company-party isPartyScopedAccess,
 * the access requireProjectAccess resolves for that project's routes) only
 * the records routed to their parties (applyPartyWorkflowVisibility), and an
 * RFI draft only to its author and its manager (rfi-workflow
 * withDraftVisibility). The overdue queues listed every project's RFIs and
 * submittals — ref and subject — to a party guest, drafts included
 * (certification R7); the queues, their counts and the scores built from
 * them now hold what the registers hold, as the IPC queue does through
 * ipcAccessFor. A company-wide read without a person (the portfolio
 * snapshot) is not filtered.
 */
async function workflowRecordScopes({ orgId, userId, role, isCompanyAdmin, projectIds }) {
  const base = { projectId: { in: projectIds }, archivedAt: null };
  if (!userId) return { rfi: base, submittal: base };
  const {
    assertProjectAccess,
    canAccessAllProjects,
  } = require("./project-authorization.service");
  const {
    applyPartyWorkflowVisibility,
    isPartyScopedAccess,
  } = require("./company-party.service");
  const { withDraftVisibility } = require("./rfi-workflow.service");

  let open = projectIds;
  let scoped = [];
  // A PM who is no workspace admin reaches every project through the
  // organisation (assertProjectAccess answers scope "org"): never a party.
  if (!canAccessAllProjects(role, { isCompanyAdmin }) || isCompanyAdmin) {
    const accesses = await Promise.all(
      projectIds.map(async (projectId) => [
        projectId,
        await assertProjectAccess({ orgId, projectId, userId, role, isCompanyAdmin }).catch(() => null),
      ]),
    );
    open = accesses
      .filter(([, access]) => access && !isPartyScopedAccess(access))
      .map(([projectId]) => projectId);
    scoped = accesses.filter(([, access]) => access && isPartyScopedAccess(access));
  }
  const routed = () => ({
    archivedAt: null,
    OR: [
      ...(open.length ? [{ projectId: { in: open } }] : []),
      ...scoped.map(([projectId, access]) =>
        applyPartyWorkflowVisibility({ projectId }, access),
      ),
    ],
  });
  return {
    rfi: withDraftVisibility(routed(), userId),
    submittal: routed(),
  };
}

async function getWorkspaceDashboard({
  orgId,
  userId,
  role,
  isCompanyAdmin = false,
  // Portfolio snapshots (OCTA-RPT-BUILDER-023) need every project's health,
  // not just the six most at risk.
  allProjects = false,
  // One project only (the project-level AI, services/ai/sources): narrows the
  // projects the caller can open; it never widens them.
  onlyProjectId = null,
  // What the caller may be shown of each project's IPC queue, as the IPC
  // routes decide it: async (projectId) => ({ certificates, lines }). A
  // certificate line is a BOQ row's claim (one per approved allocation,
  // valued off the row), so `lines` implies `certificates`. Omitted (a
  // company-wide read such as the portfolio snapshot), every project's
  // queue is counted.
  ipcAccessFor = null,
  // Every other queue, as its own module's routes decide it (certification
  // N3): async (projectId) => ({ can(moduleName), projectWideTasks }). A
  // project's schedule, progress, procurement, NCR, inspection, safety,
  // change-order, risk, RFI and submittal queues come only from where the
  // caller may read that module, and its tasks under the task list's own
  // rule (every task with project-wide task visibility, otherwise their
  // own). Omitted (a company-wide read such as the portfolio snapshot),
  // nothing is narrowed.
  moduleAccessFor = null,
}) {
  const projects = await prisma.project.findMany({
    where: {
      orgId,
      archivedAt: null,
      ...getProjectAccessWhere({ userId, role, isCompanyAdmin }),
      ...(onlyProjectId ? { id: onlyProjectId } : {}),
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      dataDate: true,
      contractValue: true,
      currency: true,
      updatedAt: true,
    },
  });

  if (!projects.length) {
    return buildEmptyDashboard();
  }

  const projectIds = projects.map((project) => project.id);
  const projectIdFilter = { in: projectIds };
  const today = new Date();
  const projectById = new Map(projects.map((project) => [project.id, project]));

  // The IPC queue counts and lists only what the caller may read: a
  // project's certificates where they may read its IPC, and its certificate
  // lines only where they may also read its BOQ.
  let ipcCertificateProjectIds = projectIds;
  let ipcLineProjectIds = projectIds;
  // A submitted certificate's net payable follows its retention, which the
  // cap (a rate of the contract value) may limit: where that value is
  // withheld from the caller, so is the net payable (utils/boq-figures
  // withheldCertificateTotals, as GET /ipc decides it). Keyed by project:
  // the contract's terms, for the projects whose BOQ the caller may not read.
  const ipcCapTerms = new Map();
  if (typeof ipcAccessFor === "function") {
    const ipcAccess = await Promise.all(
      projectIds.map(async (id) => [id, (await ipcAccessFor(id)) || {}]),
    );
    ipcCertificateProjectIds = ipcAccess
      .filter(([, access]) => access.certificates)
      .map(([id]) => id);
    ipcLineProjectIds = ipcAccess
      .filter(([, access]) => access.certificates && access.lines)
      .map(([id]) => id);
    const noBoqIds = ipcAccess
      .filter(([, access]) => access.certificates && !access.lines)
      .map(([id]) => id);
    if (noBoqIds.length) {
      const contracts = await prisma.primeContract.findMany({
        where: { orgId, projectId: { in: noBoqIds } },
        select: { projectId: true, originalValueSource: true, retentionCapRate: true },
      });
      for (const contract of contracts) ipcCapTerms.set(contract.projectId, contract);
    }
  }
  const ipcCertificateProjectFilter = { in: ipcCertificateProjectIds };
  const ipcLineProjectFilter = { in: ipcLineProjectIds };
  // The other queues: per module, the projects whose module the caller may
  // read there. A party guest refused a module on its routes (403) was shown
  // that module's records here — change orders with their values, risks,
  // safety and procurement items, other people's tasks (certification N3).
  const QUEUE_MODULES = ["schedule", "progress", "procurement", "ncr", "inspection", "safety", "change_order", "risk", "task", "rfi", "submittal"];
  let moduleProjectIds = Object.fromEntries(QUEUE_MODULES.map((moduleName) => [moduleName, projectIds]));
  let ownTaskProjectIds = [];
  if (typeof moduleAccessFor === "function") {
    const decided = await Promise.all(projectIds.map(async (id) => [id, (await moduleAccessFor(id)) || null]));
    const may = (access, moduleName) => Boolean(access && typeof access.can === "function" && access.can(moduleName));
    moduleProjectIds = Object.fromEntries(
      QUEUE_MODULES.map((moduleName) => [moduleName, decided.filter(([, access]) => may(access, moduleName)).map(([id]) => id)]),
    );
    ownTaskProjectIds = decided
      .filter(([id, access]) => moduleProjectIds.task.includes(id) && !access.projectWideTasks)
      .map(([id]) => id);
  }
  const inModule = (moduleName) => ({ in: moduleProjectIds[moduleName] });
  const allTaskProjectIds = moduleProjectIds.task.filter((id) => !ownTaskProjectIds.includes(id));
  const workflowScopes = await workflowRecordScopes({
    orgId,
    userId,
    role,
    isCompanyAdmin,
    projectIds,
  });

  const [
    activities,
    scheduleApprovalCount,
    scheduleApprovals,
    progressSubmissionCount,
    progressSubmissions,
    dailyReportCount,
    siteDiaryCount,
    ipcCertificateCount,
    ipcItemCount,
    ipcCertificates,
    ipcItems,
    ipcPaymentCertificateCount,
    ipcPaymentCertificates,
    procurementOrders,
    procurementPackages,
    procurementLines,
    activityMaterials,
    longLeadItems,
    ncrRecords,
    itpRecords,
    safetyIncidents,
    rfis,
    submittals,
    changeOrders,
    risks,
    tasks,
  ] = await Promise.all([
    prisma.activity.findMany({
      where: { projectId: inModule("schedule"), isActive: true },
      select: {
        id: true,
        projectId: true,
        name: true,
        wbsCode: true,
        earlyFinish: true,
        endDate: true,
        isCritical: true,
        isMilestone: true,
        progress: {
          where: { status: "approved" },
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { pctComplete: true },
        },
      },
    }),
    prisma.scheduleRevision.count({
      where: { projectId: inModule("schedule"), status: "under_review" },
    }),
    prisma.scheduleRevision.findMany({
      where: { projectId: inModule("schedule"), status: "under_review" },
      take: ACTION_LIMIT,
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        projectId: true,
        label: true,
        activityCount: true,
        submittedAt: true,
        createdAt: true,
        project: { select: { name: true } },
      },
    }),
    prisma.progressSubmission.count({
      where: { projectId: inModule("progress"), status: "submitted" },
    }),
    prisma.progressSubmission.findMany({
      where: { projectId: inModule("progress"), status: "submitted" },
      take: ACTION_LIMIT,
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        projectId: true,
        pctComplete: true,
        submittedAt: true,
        activity: { select: { name: true, wbsCode: true } },
        project: { select: { name: true } },
      },
    }),
    prisma.dailyReport.count({
      where: { projectId: inModule("progress"), status: "submitted" },
    }),
    prisma.siteDiary.count({
      where: { projectId: inModule("progress"), status: "submitted" },
    }),
    prisma.ipcCertificate.count({
      where: { projectId: ipcCertificateProjectFilter, status: "submitted" },
    }),
    prisma.ipcItem.count({
      where: { projectId: ipcLineProjectFilter, status: "submitted" },
    }),
    prisma.ipcCertificate.findMany({
      where: { projectId: ipcCertificateProjectFilter, status: "submitted" },
      take: ACTION_LIMIT,
      orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        projectId: true,
        period: true,
        totalCert: true,
        netPayable: true,
        submittedAt: true,
        project: { select: { name: true, currency: true } },
      },
    }),
    prisma.ipcItem.findMany({
      where: { projectId: ipcLineProjectFilter, status: "submitted" },
      take: ACTION_LIMIT,
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        projectId: true,
        ipcPeriod: true,
        netPayable: true,
        project: { select: { name: true, currency: true } },
      },
    }),
    prisma.ipcCertificate.count({
      where: {
        projectId: ipcCertificateProjectFilter,
        status: { in: ["certified", "paid"] },
        OR: [
          { paymentStatus: { in: ["unpaid", "partially_paid"] } },
          { retentionStatus: { in: ["held", "partially_released"] } },
        ],
      },
    }),
    prisma.ipcCertificate.findMany({
      where: {
        projectId: ipcCertificateProjectFilter,
        status: { in: ["certified", "paid"] },
        OR: [
          { paymentStatus: { in: ["unpaid", "partially_paid"] } },
          { retentionStatus: { in: ["held", "partially_released"] } },
        ],
      },
      take: ACTION_LIMIT,
      orderBy: [{ certifiedAt: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        projectId: true,
        period: true,
        netPayable: true,
        balanceDue: true,
        paymentStatus: true,
        retentionStatus: true,
        certifiedAt: true,
        dueDate: true,
        project: { select: { name: true, currency: true } },
      },
    }),
    prisma.procurementOrder.findMany({
      where: { projectId: inModule("procurement") },
      include: {
        activity: { select: ACTIVITY_SELECT },
      },
    }),
    prisma.procurementPackage.findMany({
      where: { projectId: inModule("procurement") },
      include: {
        activity: { select: ACTIVITY_SELECT },
      },
    }),
    prisma.procurementPoLine.findMany({
      where: { projectId: inModule("procurement") },
      include: {
        order: { select: { id: true, ref: true, status: true } },
        activity: { select: ACTIVITY_SELECT },
      },
    }),
    prisma.activityMaterial.findMany({
      where: { projectId: inModule("procurement") },
      include: {
        // Each line with its order's status: a line on a cancelled or closed
        // order is no promise the material can still wait on (CERT-2).
        poLines: {
          include: { order: { select: { status: true } } },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        activity: { select: ACTIVITY_SELECT },
      },
    }),
    prisma.longLeadItem.findMany({
      where: { projectId: inModule("procurement") },
      include: {
        activity: {
          select: {
            id: true,
            name: true,
            wbsCode: true,
            startDate: true,
            endDate: true,
            earlyStart: true,
            earlyFinish: true,
            baselineStart: true,
            baselineFinish: true,
            lateStart: true,
            lateFinish: true,
            isCritical: true,
            totalFloat: true,
          },
        },
      },
    }),
    prisma.ncrRecord.findMany({
      where: { projectId: inModule("ncr") },
      select: {
        id: true,
        projectId: true,
        ref: true,
        severity: true,
        description: true,
        status: true,
        dueDate: true,
        project: { select: { name: true } },
      },
    }),
    prisma.itpRecord.findMany({
      where: { projectId: inModule("inspection") },
      select: {
        id: true,
        projectId: true,
        ref: true,
        title: true,
        status: true,
        dueDate: true,
        project: { select: { name: true } },
      },
    }),
    prisma.safetyIncident.findMany({
      where: { projectId: inModule("safety"), archivedAt: null },
      select: {
        id: true,
        projectId: true,
        ref: true,
        title: true,
        incidentType: true,
        severity: true,
        status: true,
        dueDate: true,
        project: { select: { name: true } },
      },
    }),
    prisma.rfi.findMany({
      where: { AND: [workflowScopes.rfi, { projectId: inModule("rfi") }] },
      select: {
        id: true,
        projectId: true,
        ref: true,
        subject: true,
        status: true,
        dueDate: true,
        responseRequiredBy: true,
        project: { select: { name: true } },
      },
    }),
    prisma.submittal.findMany({
      where: { AND: [workflowScopes.submittal, { projectId: inModule("submittal") }] },
      select: {
        id: true,
        projectId: true,
        ref: true,
        title: true,
        status: true,
        dueDate: true,
        project: { select: { name: true } },
      },
    }),
    prisma.changeOrder.findMany({
      where: {
        projectId: inModule("change_order"),
        archivedAt: null,
        status: { in: ["pending", "approved"] },
      },
      select: {
        id: true,
        projectId: true,
        ref: true,
        description: true,
        value: true,
        scheduleImpact: true,
        status: true,
        submittedDate: true,
        approvedAt: true,
        updatedAt: true,
        project: { select: { name: true, currency: true } },
      },
    }),
    prisma.risk.findMany({
      where: { projectId: inModule("risk"), archivedAt: null },
      select: {
        id: true,
        projectId: true,
        ref: true,
        description: true,
        severity: true,
        status: true,
        owner: true,
        dueDate: true,
        escalationLevel: true,
        closeoutSubmittedAt: true,
        updatedAt: true,
        project: { select: { name: true } },
        activityLinks: {
          select: {
            activityId: true,
            scheduleImpactDays: true,
            activity: {
              select: { id: true, name: true, activityCode: true, wbsCode: true },
            },
          },
          take: 3,
          orderBy: [{ createdAt: "asc" }],
        },
      },
    }),
    prisma.task.findMany({
      where: {
        archivedAt: null,
        OR: [
          { projectId: { in: allTaskProjectIds } },
          { projectId: { in: ownTaskProjectIds }, OR: [{ assigneeId: userId || "" }, { createdById: userId || "" }] },
        ],
      },
      select: {
        id: true,
        projectId: true,
        taskNumber: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        updatedAt: true,
        assignee: { select: { id: true, name: true } },
        activity: { select: { id: true, name: true, wbsCode: true } },
        project: { select: { name: true } },
      },
    }),
  ]);

  const evReports = await getEvReports({ orgId, projects });
  // "My open items": every record where this user is owner / reviewer /
  // approver / assignee / ball in court, resolved by id only.
  const myOpenItems = await require("./record-assignment.service")
    .listMyOpenItems({ orgId, userId, projectIds, limit: 100 })
    .catch((error) => {
      console.error("[workspace-dashboard] my open items failed", error);
      return { items: [], summary: { total: 0, overdue: 0, ballInCourt: 0, byType: {} } };
    });
  const generatedAt = new Date().toISOString();
  // The official cutoff is the latest EV cutoff among the projects' EV
  // reports (each on its own default basis, D4) — never a project's data
  // date, which is neither an EV cutoff nor an instant with a zone. It is
  // stated as the EV screens state it: its calendar date, the zone it ends
  // in, and the note when that project has no zone of its own (D1). With no
  // EV report at all, the answer's own time stands in, as before.
  const evCutoffIso = latestIso(
    [...evReports.values()].map((report) => report?.reporting?.cutoffDate),
  );
  const cutoffDate = evCutoffIso || generatedAt;
  const cutoffReporting = evCutoffIso
    ? [...evReports.values()]
        .map((report) => report?.reporting)
        .find((reporting) => reporting?.cutoffDate && toIso(reporting.cutoffDate) === evCutoffIso) || null
    : null;
  const sourceUpdatedAt =
    latestIso([
      ...projects.map((project) => project.updatedAt),
      ...changeOrders.map((row) => row.updatedAt),
      ...risks.map((row) => row.updatedAt),
      ...tasks.map((row) => row.updatedAt),
    ]) || generatedAt;
  const activitiesByProject = groupByProject(activities);
  const ncrsByProject = groupByProject(ncrRecords);
  const itpsByProject = groupByProject(itpRecords);
  const incidentsByProject = groupByProject(safetyIncidents);
  const rfisByProject = groupByProject(rfis);
  const submittalsByProject = groupByProject(submittals);
  const risksByProject = groupByProject(risks);
  const tasksByProject = groupByProject(tasks);
  const pendingChangeOrders = changeOrders.filter(
    (row) => lower(row.status) === "pending",
  );
  const approvedChangeOrders = changeOrders.filter(
    (row) => lower(row.status) === "approved",
  );
  const pendingChangeOrdersByProject = groupByProject(pendingChangeOrders);
  const approvedChangeOrdersByProject = groupByProject(approvedChangeOrders);
  const procurementPackageRows = procurementPackages.map((row) => ({
    ...buildPackageRiskRow(row),
    projectId: row.projectId,
    source: "procurement_package",
  }));
  // A line on a cancelled or closed order will deliver nothing more: it is
  // no one's risk, as the lead-time alert has it (CERT-2).
  const procurementLineRows = procurementLines.filter((row) => !isOnSettledOrder(row)).map((row) => ({
    ...buildLineRiskRow(row),
    projectId: row.projectId,
    source: "po_line",
  }));
  const activityMaterialRows = activityMaterials.map((row) => ({
    ...buildMaterialRiskRow(row),
    projectId: row.projectId,
    source: "activity_material",
  }));
  const procurementRows = [
    ...procurementOrders,
    ...procurementPackageRows,
    ...procurementLineRows,
    ...activityMaterialRows,
    ...longLeadItems,
  ].filter((row) => isOfficialStatus(row.status));
  const procurementSummary = summarizeRiskRows({
    rows: procurementRows,
    projectById,
    today,
  });
  const procurementRisksByProject = countByProject(
    procurementSummary.risks.map(({ row, risk }) => ({ ...row, risk })),
    (row) => row.risk.isAtRisk,
  );

  const delayedActivities = activities.filter((activity) =>
    isDelayedActivity({
      project: projectById.get(activity.projectId),
      activity,
      today,
    }),
  );
  const delayedByProject = countByProject(delayedActivities);
  const criticalActivities = activities.filter(
    (activity) => activity.isCritical && !activity.isMilestone,
  );

  const overdueNcrs = ncrRecords.filter(
    (row) =>
      row.dueDate && new Date(row.dueDate) < today && isOpenStatus(row.status),
  );
  const overdueSafety = safetyIncidents.filter(
    (row) =>
      row.dueDate && new Date(row.dueDate) < today && isOpenStatus(row.status),
  );
  const overdueRfis = rfis.filter((row) => {
    const dueDate = row.responseRequiredBy || row.dueDate;
    return (
      dueDate &&
      new Date(dueDate) < today &&
      isOpenStatus(row.status, RFI_CLOSED_STATUSES)
    );
  });
  const pendingSubmittals = submittals.filter((row) =>
    ["pending", "under_review", "resubmit"].includes(lower(row.status)),
  );
  const pendingNcrCloseouts = ncrRecords.filter(
    (row) => lower(row.status) === "submitted",
  );
  const pendingSafetyCloseouts = safetyIncidents.filter(
    (row) => lower(row.status) === "submitted",
  );
  const submittedRiskCloseouts = risks.filter(
    (row) => lower(row.status) === "submitted",
  );
  const overdueRiskMitigations = risks.filter(
    (row) =>
      row.dueDate &&
      new Date(row.dueDate) < today &&
      ["open", "monitoring"].includes(lower(row.status)),
  );
  const overdueSubmittals = pendingSubmittals.filter(
    (row) => row.dueDate && new Date(row.dueDate) < today,
  );
  const openTasks = tasks.filter((row) => isOpenStatus(row.status));
  const overdueTasks = openTasks.filter(
    (row) => row.dueDate && new Date(row.dueDate) < today,
  );

  const overdueNcrsByProject = countByProject(overdueNcrs);
  const overdueSafetyByProject = countByProject(overdueSafety);
  const overdueRfisByProject = countByProject(overdueRfis);
  const overdueSubmittalsByProject = countByProject(overdueSubmittals);
  const openTasksByProject = countByProject(openTasks);
  const overdueTasksByProject = countByProject(overdueTasks);
  const scheduleApprovalsByProject = countByProject(scheduleApprovals);
  const progressApprovalsByProject = countByProject(progressSubmissions);
  const qaCloseoutsByProject = countByProject([
    ...pendingNcrCloseouts,
    ...pendingSafetyCloseouts,
  ]);
  const riskActionsByProject = countByProject([
    ...submittedRiskCloseouts,
    ...overdueRiskMitigations,
  ]);
  const ipcActionsByProject = countByProject([
    ...ipcCertificates,
    ...ipcItems,
    ...ipcPaymentCertificates,
  ]);

  const projectHealth = projects.map((project) => {
    const projectActivities = activitiesByProject.get(project.id) || [];
    const projectNcrs = ncrsByProject.get(project.id) || [];
    const projectItps = itpsByProject.get(project.id) || [];
    const projectIncidents = incidentsByProject.get(project.id) || [];
    const projectRfis = rfisByProject.get(project.id) || [];
    const projectSubmittals = submittalsByProject.get(project.id) || [];
    const projectRisks = risksByProject.get(project.id) || [];
    const projectTasks = tasksByProject.get(project.id) || [];
    const projectPendingChangeOrders =
      pendingChangeOrdersByProject.get(project.id) || [];
    const projectApprovedChangeOrders =
      approvedChangeOrdersByProject.get(project.id) || [];
    const evReport = evReports.get(project.id) || {};
    const spi = evReport.spi;
    const cpi = evReport.cpi;

    const projectOverdueRiskMitigations = projectRisks.filter(
      (row) =>
        row.dueDate &&
        new Date(row.dueDate) < today &&
        ["open", "monitoring"].includes(lower(row.status)),
    ).length;
    const scheduleScore = clampScore(
      (spi === null || spi === undefined ? 60 : scoreByIndex(Number(spi))) -
        projectOverdueRiskMitigations * 5,
    );
    const costScore =
      cpi === null || cpi === undefined
        ? 60
        : clampScore(scoreByIndex(Number(cpi)));
    const approvedScheduleImpactDays = projectApprovedChangeOrders.reduce(
      (sum, row) => sum + Math.max(0, toNumber(row.scheduleImpact)),
      0,
    );
    const commercialScore = clampScore(
      100 -
        projectApprovedChangeOrders.length * 2 -
        approvedScheduleImpactDays * 0.5,
    );
    const supplyChainScore = clampScore(
      100 - toNumber(procurementRisksByProject.get(project.id)) * 12,
    );

    const majorNCRs = projectNcrs.filter(
      (row) => lower(row.severity) === "major",
    ).length;
    const minorNCRs = projectNcrs.filter(
      (row) => lower(row.severity) === "minor",
    ).length;
    const failedITPs = projectItps.filter(
      (row) => lower(row.status) === "failed",
    ).length;
    const qualityScore = clampScore(
      100 - majorNCRs * 20 - minorNCRs * 8 - failedITPs * 15,
    );

    const ltiCount = projectIncidents.filter(
      (row) => lower(row.incidentType) === "lti",
    ).length;
    const fatalityCount = projectIncidents.filter(
      (row) => lower(row.incidentType) === "fatality",
    ).length;
    const openInvestigations = projectIncidents.filter((row) =>
      isOpenStatus(row.status),
    ).length;
    const safetyScore = clampScore(
      100 - fatalityCount * 100 - ltiCount * 20 - openInvestigations * 5,
    );

    const projectOverdueRfis = projectRfis.filter((row) => {
      const dueDate = row.responseRequiredBy || row.dueDate;
      return (
        dueDate &&
        new Date(dueDate) < today &&
        isOpenStatus(row.status, RFI_CLOSED_STATUSES)
      );
    }).length;
    const projectPendingSubmittals = projectSubmittals.filter((row) =>
      ["pending", "under_review", "resubmit"].includes(lower(row.status)),
    ).length;
    const projectOverdueSubmittals = projectSubmittals.filter(
      (row) =>
        row.dueDate &&
        new Date(row.dueDate) < today &&
        ["pending", "under_review", "resubmit"].includes(lower(row.status)),
    ).length;
    const docControlScore = clampScore(
      100 -
        projectOverdueRfis * 10 -
        projectOverdueSubmittals * 10 -
        projectPendingSubmittals * 5,
    );

    const dimensions = {
      schedule: scheduleScore,
      cost: costScore,
      commercial: commercialScore,
      supplyChain: supplyChainScore,
      quality: qualityScore,
      safety: safetyScore,
      docControl: docControlScore,
    };

    const overallScore = clampScore(
      average(Object.values(dimensions), projectActivities.length ? 60 : 50),
    );
    const workflowActions =
      toNumber(scheduleApprovalsByProject.get(project.id)) +
      toNumber(progressApprovalsByProject.get(project.id)) +
      toNumber(qaCloseoutsByProject.get(project.id)) +
      toNumber(ipcActionsByProject.get(project.id)) +
      toNumber(riskActionsByProject.get(project.id)) +
      projectPendingChangeOrders.length +
      toNumber(procurementRisksByProject.get(project.id)) +
      toNumber(overdueNcrsByProject.get(project.id)) +
      toNumber(overdueSafetyByProject.get(project.id)) +
      toNumber(overdueRfisByProject.get(project.id)) +
      toNumber(overdueSubmittalsByProject.get(project.id)) +
      toNumber(overdueTasksByProject.get(project.id));
    const weakestDimension = Object.entries(dimensions).sort(
      (a, b) => a[1] - b[1],
    )[0];

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      currency: project.currency,
      contractValue: toNumber(project.contractValue),
      startDate: toIso(project.startDate),
      endDate: toIso(project.endDate),
      overallScore,
      dimensions,
      weakestDimension: {
        key: weakestDimension[0],
        label:
          HEALTH_DIMENSIONS.find((item) => item.key === weakestDimension[0])
            ?.label || weakestDimension[0],
        score: weakestDimension[1],
      },
      spi: spi === null || spi === undefined ? null : Number(spi),
      cpi: cpi === null || cpi === undefined ? null : Number(cpi),
      ev: toNumber(evReport.ev),
      pv: toNumber(evReport.pv),
      ac: toNumber(evReport.ac),
      eac: toNumber(evReport.eac),
      bac: toNumber(evReport.totalBudget),
      criticalActivities: projectActivities.filter(
        (activity) => activity.isCritical && !activity.isMilestone,
      ).length,
      delayedActivities: toNumber(delayedByProject.get(project.id)),
      workflowActions,
      riskMitigations: toNumber(riskActionsByProject.get(project.id)),
      procurementRisks: toNumber(procurementRisksByProject.get(project.id)),
      pendingChangeOrders: projectPendingChangeOrders.length,
      overdueNcrRfi:
        toNumber(overdueNcrsByProject.get(project.id)) +
        toNumber(overdueSafetyByProject.get(project.id)) +
        toNumber(overdueRfisByProject.get(project.id)) +
        toNumber(overdueSubmittalsByProject.get(project.id)),
      openTasks: projectTasks.filter((row) => isOpenStatus(row.status)).length,
      overdueTasks: toNumber(overdueTasksByProject.get(project.id)),
      target: queueTarget(project.id, "overview"),
    };
  });

  const healthDimensions = HEALTH_DIMENSIONS.map((dimension) => {
    const scores = projectHealth.map(
      (project) => project.dimensions[dimension.key],
    );

    const detailByKey = {
      schedule: `${delayedActivities.length} delayed activities, ${overdueRiskMitigations.length} overdue risk mitigations, ${overdueTasks.length} overdue tasks`,
      cost: `${projectHealth.filter((project) => project.dimensions.cost < 80).length} CPI watch projects`,
      commercial: `${approvedChangeOrders.length} approved change orders`,
      supplyChain: `${procurementSummary.atRiskItems} procurement risks`,
      quality: `${overdueNcrs.length} overdue NCRs`,
      safety: `${safetyIncidents.filter((row) => isOpenStatus(row.status)).length} open investigations, ${overdueSafety.length} overdue actions`,
      docControl: `${overdueRfis.length} overdue RFIs, ${overdueSubmittals.length} overdue submittals`,
    };

    return {
      ...dimension,
      score: clampScore(average(scores, 60)),
      detail: detailByKey[dimension.key],
      count: scores.length,
      sourceRule:
        dimension.key === "schedule" || dimension.key === "cost"
          ? KPI_SOURCE_RULES.portfolioHealth
          : KPI_SOURCE_RULES[
              dimension.key === "supplyChain"
                ? "procurementAtRisk"
                : dimension.key === "docControl"
                  ? "overdueDocQuality"
                  : "portfolioHealth"
            ],
      cutoffDate,
      target:
        dimension.key === "cost"
          ? queueTarget(projectHealth[0]?.id || null, "cost", "activity", {
              status: "official",
              source: "cost_record.actual_through_date",
            })
          : dimension.key === "docControl"
            ? queueTarget(
                overdueRfis[0]?.projectId ||
                  overdueSubmittals[0]?.projectId ||
                  null,
                "docControl",
                overdueRfis[0] ? "rfi" : "submittals",
                {
                  status: overdueRfis[0] ? "open" : "under_review",
                  source: overdueRfis[0] ? "rfi" : "submittal",
                },
              )
            : queueTarget(projectHealth[0]?.id || null, "overview"),
    };
  });

  const progressApprovalCount =
    progressSubmissionCount + dailyReportCount + siteDiaryCount;
  const ipcActionCount =
    ipcCertificateCount + ipcItemCount + ipcPaymentCertificateCount;

  const workflowQueues = [
    buildQueue({
      key: "scheduleApprovals",
      label: "Schedule approvals",
      count: scheduleApprovalCount,
      description: "Revisions waiting for PM or planning review",
      module: "schedule",
      child: "revisions",
      items: scheduleApprovals.map((row) =>
        buildQueueItem({
          id: row.id,
          projectId: row.projectId,
          projectName: row.project.name,
          title: row.label || "Schedule revision",
          meta: `${row.activityCount} activities`,
          module: "schedule",
          child: "revisions",
          targetFilters: {
            status: "under_review",
            source: "schedule_revision",
          },
          dueDate: row.submittedAt || row.createdAt,
        }),
      ),
    }),
    buildQueue({
      key: "progressApprovals",
      label: "Progress approvals",
      count: progressApprovalCount,
      description: "Submitted progress, daily reports, and site diaries",
      module: "schedule",
      child: "progress",
      items: progressSubmissions.map((row) =>
        buildQueueItem({
          id: row.id,
          projectId: row.projectId,
          projectName: row.project.name,
          title: row.activity?.name || "Progress submission",
          meta: `${toNumber(row.pctComplete).toFixed(1)}% complete`,
          module: "schedule",
          child: "progress",
          targetFilters: {
            status: "submitted",
            source: "progress_submission",
          },
          dueDate: row.submittedAt,
        }),
      ),
    }),
    buildQueue({
      key: "ipcActions",
      label: "IPC actions",
      count: ipcActionCount,
      description: "Submitted IPC plus open payment and retention status",
      module: "commercial",
      child: "ipc",
      items: [
        ...ipcCertificates.map((row) => {
          // Only projects whose BOQ the caller may not read have terms here.
          const shown = ipcCapTerms.has(row.projectId)
            ? withheldCertificateTotals(
                { status: "submitted", netPayable: row.netPayable },
                ipcCapTerms.get(row.projectId),
                { boq: false },
              )
            : row;
          return buildQueueItem({
            id: row.id,
            projectId: row.projectId,
            projectName: row.project.name,
            title: row.period,
            meta: shown.valueWithheld
              ? `${row.project.currency} —`
              : `${row.project.currency} ${toNumber(row.netPayable || row.totalCert).toLocaleString()}`,
            valueWithheld: shown.valueWithheld || null,
            module: "commercial",
            child: "ipc",
            targetFilters: {
              status: "submitted",
              source: "ipc_certificate",
            },
            dueDate: row.submittedAt,
          });
        }),
        ...ipcPaymentCertificates.map((row) =>
          buildQueueItem({
            id: `payment-${row.id}`,
            projectId: row.projectId,
            projectName: row.project.name,
            title: `${row.period} payment status`,
            meta: `${row.project.currency} ${toNumber(row.balanceDue).toLocaleString()} balance - payment ${row.paymentStatus.replaceAll("_", " ")} - retention ${row.retentionStatus.replaceAll("_", " ")}`,
            severity:
              toNumber(row.balanceDue) > 0 || row.retentionStatus !== "released"
                ? "attention"
                : "low",
            module: "commercial",
            child: "ipc",
            targetFilters: {
              status: "certified",
              source: "ipc_certificate",
            },
            dueDate: row.dueDate || row.certifiedAt,
          }),
        ),
        ...ipcItems.map((row) =>
          buildQueueItem({
            id: row.id,
            projectId: row.projectId,
            projectName: row.project.name,
            title: row.ipcPeriod,
            meta: `${row.project.currency} ${toNumber(row.netPayable).toLocaleString()}`,
            module: "commercial",
            child: "ipc",
            targetFilters: {
              status: "submitted",
              source: "ipc_item",
            },
          }),
        ),
      ].slice(0, ACTION_LIMIT),
    }),
    buildQueue({
      key: "pendingChangeOrders",
      label: "Change order review",
      count: pendingChangeOrders.length,
      description: "Submitted change orders awaiting PM approval",
      module: "commercial",
      child: "change-orders",
      items: pendingChangeOrders.slice(0, ACTION_LIMIT).map((row) =>
        buildQueueItem({
          id: row.id,
          projectId: row.projectId,
          projectName: row.project.name,
          title: row.ref,
          meta: `${row.project.currency} ${toNumber(row.value).toLocaleString()} - ${row.description || "Pending change order"}`,
          severity: "attention",
          module: "commercial",
          child: "change-orders",
          targetFilters: {
            status: "pending",
            source: "change_order",
          },
          dueDate: row.submittedDate || row.updatedAt,
        }),
      ),
    }),
    buildQueue({
      key: "riskCloseouts",
      label: "Risk closeout review",
      count: submittedRiskCloseouts.length,
      description: "Mitigation closeouts awaiting PM approval",
      module: "schedule",
      child: "risks",
      items: submittedRiskCloseouts.slice(0, ACTION_LIMIT).map((row) => {
        const activity = row.activityLinks?.[0]?.activity;
        return buildQueueItem({
          id: row.id,
          projectId: row.projectId,
          projectName: row.project.name,
          title: row.ref,
          meta: `${row.owner || "Unassigned"} - ${row.description}${
            activity
              ? ` - ${activity.activityCode || activity.wbsCode || activity.name}`
              : ""
          }`,
          severity: lower(row.severity),
          module: "schedule",
          child: "risks",
          targetFilters: {
            status: "submitted",
            source: "risk",
          },
          dueDate: row.closeoutSubmittedAt || row.dueDate,
        });
      }),
    }),
    buildQueue({
      key: "qaSafetyCloseouts",
      label: "QA/Safety closeout review",
      count: pendingNcrCloseouts.length + pendingSafetyCloseouts.length,
      description: "Submitted NCR and safety closeouts awaiting PM approval",
      module: "quality",
      child: "ncr",
      items: [
        ...pendingNcrCloseouts.map((row) =>
          buildQueueItem({
            id: row.id,
            projectId: row.projectId,
            projectName: row.project.name,
            title: row.ref,
            meta: row.description || `${row.severity} NCR closeout`,
            severity:
              lower(row.severity) === "major" ? "critical" : "attention",
            module: "quality",
            child: "ncr",
            targetFilters: {
              status: row.status,
              source: "ncr",
            },
            dueDate: row.dueDate,
          }),
        ),
        ...pendingSafetyCloseouts.map((row) =>
          buildQueueItem({
            id: row.id,
            projectId: row.projectId,
            projectName: row.project.name,
            title: row.ref || row.title,
            meta: `${row.incidentType.replaceAll("_", " ")} closeout`,
            severity: ["fatality", "critical", "high"].includes(
              lower(row.severity || row.incidentType),
            )
              ? "critical"
              : "attention",
            module: "quality",
            child: "safety",
            targetFilters: {
              status: row.status,
              source: "safety_incident",
            },
            dueDate: row.dueDate,
          }),
        ),
      ].slice(0, ACTION_LIMIT),
    }),
    buildQueue({
      key: "procurementRisks",
      label: "Procurement risks",
      count: procurementSummary.atRiskItems,
      description: "Long-lead and purchase-order dates at risk",
      module: "schedule",
      child: "longLead",
      items: procurementSummary.topRisks.map((risk) =>
        buildQueueItem({
          id: risk.id,
          projectId: risk.projectId,
          projectName: risk.projectName,
          title: risk.item,
          meta: `${risk.severity} - ${risk.reason.replaceAll("_", " ")}`,
          severity: risk.severity,
          module: "schedule",
          child: "longLead",
          targetFilters: {
            status: "official",
            source: risk.source,
          },
          dueDate: risk.needDate,
        }),
      ),
    }),
    buildQueue({
      key: "overdueRiskMitigations",
      label: "Overdue Risk Mitigations",
      count: overdueRiskMitigations.length,
      description: "Open mitigation actions past due date",
      module: "schedule",
      child: "risks",
      items: overdueRiskMitigations.slice(0, ACTION_LIMIT).map((row) => {
        const activity = row.activityLinks?.[0]?.activity;
        return buildQueueItem({
          id: row.id,
          projectId: row.projectId,
          projectName: row.project.name,
          title: row.ref,
          meta: `${row.owner || "Unassigned"} - ${row.description}${
            activity
              ? ` - ${activity.activityCode || activity.wbsCode || activity.name}`
              : ""
          }`,
          severity:
            lower(row.severity) === "critical" ? "critical" : "attention",
          module: "schedule",
          child: "risks",
          targetFilters: {
            status: "overdue",
            source: "risk",
          },
          dueDate: row.dueDate,
        });
      }),
    }),
    buildQueue({
      key: "overdueTasks",
      label: "Overdue Tasks",
      count: overdueTasks.length,
      description: "Assigned project tasks past due date",
      module: "tasks",
      items: overdueTasks.slice(0, ACTION_LIMIT).map((row) =>
        buildQueueItem({
          id: row.id,
          projectId: row.projectId,
          projectName: row.project.name,
          title: row.taskNumber,
          meta: `${row.title}${row.assignee?.name ? ` - ${row.assignee.name}` : ""}`,
          severity: row.priority === "critical" ? "critical" : "attention",
          module: "tasks",
          targetFilters: {
            status: row.status,
            source: "task",
            taskId: row.id,
          },
          dueDate: row.dueDate,
        }),
      ),
    }),
    buildQueue({
      key: "overdueNcrs",
      label: "Overdue NCRs",
      count: overdueNcrs.length,
      description: "Quality records past due date",
      module: "quality",
      child: "ncr",
      items: overdueNcrs.slice(0, ACTION_LIMIT).map((row) =>
        buildQueueItem({
          id: row.id,
          projectId: row.projectId,
          projectName: row.project.name,
          title: row.ref,
          meta: row.description || `${row.severity} NCR`,
          severity: lower(row.severity) === "major" ? "critical" : "attention",
          module: "quality",
          child: "ncr",
          targetFilters: {
            status: row.status,
            source: "ncr",
          },
          dueDate: row.dueDate,
        }),
      ),
    }),
    buildQueue({
      key: "overdueSafety",
      label: "Overdue Safety Actions",
      count: overdueSafety.length,
      description: "Safety investigations and closeout actions past due",
      module: "quality",
      child: "safety",
      items: overdueSafety.slice(0, ACTION_LIMIT).map((row) =>
        buildQueueItem({
          id: row.id,
          projectId: row.projectId,
          projectName: row.project.name,
          title: row.ref || row.title,
          meta: `${row.incidentType.replaceAll("_", " ")} - ${row.title}`,
          severity: ["fatality", "critical", "high"].includes(
            lower(row.severity || row.incidentType),
          )
            ? "critical"
            : "attention",
          module: "quality",
          child: "safety",
          targetFilters: {
            status: row.status,
            source: "safety_incident",
          },
          dueDate: row.dueDate,
        }),
      ),
    }),
    buildQueue({
      key: "overdueRfis",
      label: "Overdue RFIs",
      count: overdueRfis.length,
      description: "Document-control responses past due",
      module: "docControl",
      child: "rfi",
      items: overdueRfis.slice(0, ACTION_LIMIT).map((row) =>
        buildQueueItem({
          id: row.id,
          projectId: row.projectId,
          projectName: row.project.name,
          title: row.ref,
          meta: row.subject,
          severity: "attention",
          module: "docControl",
          child: "rfi",
          targetFilters: {
            status: row.status,
            source: "rfi",
          },
          dueDate: row.responseRequiredBy || row.dueDate,
        }),
      ),
    }),
    buildQueue({
      key: "overdueSubmittals",
      label: "Overdue Submittals",
      count: overdueSubmittals.length,
      description: "Submittal reviews past due date",
      module: "docControl",
      child: "submittals",
      items: overdueSubmittals.slice(0, ACTION_LIMIT).map((row) =>
        buildQueueItem({
          id: row.id,
          projectId: row.projectId,
          projectName: row.project.name,
          title: row.ref,
          meta: row.title,
          severity: "attention",
          module: "docControl",
          child: "submittals",
          targetFilters: {
            status: row.status,
            source: "submittal",
          },
          dueDate: row.dueDate,
        }),
      ),
    }),
  ];

  const atRiskProjects = [...projectHealth]
    .sort((a, b) => {
      if (a.overallScore !== b.overallScore) {
        return a.overallScore - b.overallScore;
      }
      return b.workflowActions - a.workflowActions;
    })
    .slice(0, 6);

  const approvalQueueCount =
    scheduleApprovalCount +
    progressApprovalCount +
    pendingNcrCloseouts.length +
    pendingSafetyCloseouts.length +
    submittedRiskCloseouts.length +
    ipcActionCount +
    pendingChangeOrders.length;
  const officialCostActualRows = [...evReports.values()].reduce(
    (sum, report) =>
      sum + toNumber(report?.sourceSummary?.ac?.officialActualActivities),
    0,
  );
  const officialCostMissingRows = [...evReports.values()].reduce(
    (sum, report) =>
      sum + toNumber(report?.sourceSummary?.ac?.missingActualActivities),
    0,
  );
  const firstHealthProject = atRiskProjects[0] || projectHealth[0] || null;
  const firstDelayedActivity = delayedActivities[0] || null;
  const firstCriticalActivity = criticalActivities[0] || null;
  const firstDocQualityProjectId =
    overdueSafety[0]?.projectId ||
    overdueRfis[0]?.projectId ||
    overdueSubmittals[0]?.projectId ||
    overdueNcrs[0]?.projectId ||
    null;
  const firstDocQualityChild = overdueSafety[0]
    ? "safety"
    : overdueRfis[0]
      ? "rfi"
      : overdueSubmittals[0]
        ? "submittals"
        : "ncr";
  const firstDocQualityModule =
    firstDocQualityChild === "ncr" || firstDocQualityChild === "safety"
      ? "quality"
      : "docControl";
  const firstDocQualitySource = overdueSafety[0]
    ? "safety_incident"
    : overdueRfis[0]
      ? "rfi"
      : overdueSubmittals[0]
        ? "submittal"
        : "ncr";
  const officialKpis = [
    buildKpi({
      key: "portfolioHealth",
      label: "Portfolio Health",
      value:
        projectHealth.length > 0
          ? clampScore(
              average(
                projectHealth.map((project) => project.overallScore),
                60,
              ),
            )
          : null,
      unit: "score",
      detail: "Approved EV, official workflow records, and active source data",
      sourceRule: KPI_SOURCE_RULES.portfolioHealth,
      cutoffDate,
      generatedAt,
      target: queueTarget(firstHealthProject?.id || null, "overview", null, {
        status: "official",
        source: "project_health",
      }),
    }),
    buildKpi({
      key: "activeProjects",
      label: "Active Projects",
      value: projects.filter((project) => project.status === "active").length,
      detail: `${projects.length} visible projects`,
      sourceRule: KPI_SOURCE_RULES.activeProjects,
      cutoffDate,
      generatedAt,
      target: queueTarget(null, "projects", null, {
        status: "active",
        source: "project",
      }),
    }),
    buildKpi({
      key: "openTasks",
      label: "Open Tasks",
      value: openTasks.length,
      detail: `${overdueTasks.length} overdue persisted tasks`,
      sourceRule: KPI_SOURCE_RULES.openTasks,
      cutoffDate,
      generatedAt,
      target: queueTarget(overdueTasks[0]?.projectId || null, "tasks", null, {
        status: overdueTasks[0]?.status || "open",
        source: "task",
      }),
    }),
    buildKpi({
      key: "criticalActivities",
      label: "Critical Activities",
      value: criticalActivities.length,
      detail: `${delayedActivities.length} delayed by latest approved progress`,
      sourceRule: KPI_SOURCE_RULES.criticalActivities,
      cutoffDate,
      generatedAt,
      target: queueTarget(
        firstCriticalActivity?.projectId ||
          firstDelayedActivity?.projectId ||
          firstHealthProject?.id ||
          null,
        "schedule",
        firstCriticalActivity ? "critical" : "progress",
        {
          status: "official",
          source: "activity",
        },
      ),
    }),
    buildKpi({
      key: "costActuals",
      label: "Official Cost Actuals",
      value: officialCostActualRows,
      detail: `${officialCostMissingRows} active activities missing actual-through cost`,
      sourceRule: KPI_SOURCE_RULES.costActuals,
      cutoffDate,
      generatedAt,
      target: queueTarget(firstHealthProject?.id || null, "cost", "activity", {
        status: "official",
        source: "cost_record.actual_through_date",
      }),
    }),
    buildKpi({
      key: "procurementAtRisk",
      label: "Procurement Risks",
      value: procurementSummary.atRiskItems,
      detail: "Draft, rejected, cancelled, and void records excluded",
      sourceRule: KPI_SOURCE_RULES.procurementAtRisk,
      cutoffDate,
      generatedAt,
      target: queueTarget(
        procurementSummary.topRisks[0]?.projectId ||
          firstHealthProject?.id ||
          null,
        "schedule",
        "longLead",
        {
          status: "official",
          source: procurementSummary.topRisks[0]?.source || "procurement",
        },
      ),
    }),
    buildKpi({
      key: "overdueDocQuality",
      label: "Overdue QA/Safety/Docs",
      value:
        overdueNcrs.length +
        overdueSafety.length +
        overdueRfis.length +
        overdueSubmittals.length,
      detail: "Open overdue NCR, safety, RFI, and active submittal records",
      sourceRule: KPI_SOURCE_RULES.overdueDocQuality,
      cutoffDate,
      generatedAt,
      target: queueTarget(
        firstDocQualityProjectId,
        firstDocQualityModule,
        firstDocQualityChild,
        {
          status:
            firstDocQualityChild === "safety"
              ? overdueSafety[0]?.status || "open"
              : "open",
          source: firstDocQualitySource,
        },
      ),
    }),
  ];
  const pendingReviewMetrics = [
    buildPendingMetric({
      key: "scheduleApprovals",
      label: "Schedule revisions",
      count: scheduleApprovalCount,
      detail: "Under review",
      source: "schedule_revision",
      cutoffDate,
      target: queueTarget(
        scheduleApprovals[0]?.projectId || null,
        "schedule",
        "revisions",
        {
          status: "under_review",
          source: "schedule_revision",
        },
      ),
    }),
    buildPendingMetric({
      key: "progressApprovals",
      label: "Progress submissions",
      count: progressApprovalCount,
      detail: "Submitted progress, daily reports, and site diaries",
      source: "progress_submission",
      cutoffDate,
      target: queueTarget(
        progressSubmissions[0]?.projectId || null,
        "schedule",
        "progress",
        {
          status: "submitted",
          source: "progress_submission",
        },
      ),
    }),
    buildPendingMetric({
      key: "ipcActions",
      label: "IPC/payment actions",
      count: ipcActionCount,
      detail: "Submitted IPC plus certified payment/retention follow-up",
      source: "ipc_certificate",
      cutoffDate,
      target: queueTarget(
        ipcCertificates[0]?.projectId ||
          ipcPaymentCertificates[0]?.projectId ||
          null,
        "commercial",
        "ipc",
        {
          status: "submitted",
          source: "ipc_certificate",
        },
      ),
    }),
    buildPendingMetric({
      key: "changeOrders",
      label: "Change orders",
      count: pendingChangeOrders.length,
      detail: "Pending PM approval",
      source: "change_order",
      cutoffDate,
      target: queueTarget(
        pendingChangeOrders[0]?.projectId || null,
        "commercial",
        "change-orders",
        {
          status: "pending",
          source: "change_order",
        },
      ),
    }),
    buildPendingMetric({
      key: "riskCloseouts",
      label: "Risk closeouts",
      count: submittedRiskCloseouts.length,
      detail: "Submitted mitigation closeouts",
      source: "risk",
      cutoffDate,
      target: queueTarget(
        submittedRiskCloseouts[0]?.projectId || null,
        "schedule",
        "risks",
        {
          status: "submitted",
          source: "risk",
        },
      ),
    }),
    buildPendingMetric({
      key: "qaSafetyCloseouts",
      label: "QA/safety closeouts",
      count: pendingNcrCloseouts.length + pendingSafetyCloseouts.length,
      detail: "Submitted NCR and safety closeouts",
      source: "ncr,safety_incident",
      cutoffDate,
      target: queueTarget(
        pendingNcrCloseouts[0]?.projectId ||
          pendingSafetyCloseouts[0]?.projectId ||
          null,
        "quality",
        pendingSafetyCloseouts[0] && !pendingNcrCloseouts[0] ? "safety" : "ncr",
        {
          status: "submitted",
          source:
            pendingSafetyCloseouts[0] && !pendingNcrCloseouts[0]
              ? "safety_incident"
              : "ncr",
        },
      ),
    }),
    buildPendingMetric({
      key: "submittals",
      label: "Submittal reviews",
      count: pendingSubmittals.length,
      detail: "Pending, under review, or resubmit",
      source: "submittal",
      cutoffDate,
      target: queueTarget(
        pendingSubmittals[0]?.projectId || null,
        "docControl",
        "submittals",
        {
          status: pendingSubmittals[0]?.status || "under_review",
          source: "submittal",
        },
      ),
    }),
  ];

  return {
    generatedAt,
    dataFreshness: {
      generatedAt,
      cutoffDate,
      cutoffLocalDate: cutoffReporting?.cutoffLocalDate || null,
      cutoffTimeZone: cutoffReporting?.timeZone || null,
      cutoffTimeZoneSource: cutoffReporting?.timeZoneSource || null,
      cutoffTimeZoneNote: cutoffReporting?.timeZoneNote ?? null,
      sourceUpdatedAt,
      note: "Official KPI cards use approved or active source records through cutoff; pending-review metrics are displayed separately.",
    },
    kpiSourceRules: KPI_SOURCE_RULES,
    myOpenItems,
    summary: {
      totalProjects: projects.length,
      activeProjects: projects.filter((project) => project.status === "active")
        .length,
      totalContractValue: projects.reduce(
        (sum, project) => sum + toNumber(project.contractValue),
        0,
      ),
      portfolioHealthScore: clampScore(
        average(
          projectHealth.map((project) => project.overallScore),
          60,
        ),
      ),
      delayedActivities: delayedActivities.length,
      criticalActivities: criticalActivities.length,
      approvalQueueCount,
      procurementAtRisk: procurementSummary.atRiskItems,
      overdueNcrRfi:
        overdueNcrs.length +
        overdueSafety.length +
        overdueRfis.length +
        overdueSubmittals.length,
      openTasks: openTasks.length,
      overdueTasks: overdueTasks.length,
    },
    officialKpis,
    pendingReview: {
      total: pendingReviewMetrics.reduce((sum, item) => sum + item.count, 0),
      metrics: pendingReviewMetrics,
      sourceRule: KPI_SOURCE_RULES.pendingReview,
    },
    healthDimensions,
    workflowQueues,
    projectHealth: allProjects ? projectHealth : atRiskProjects,
    emptyState: null,
  };
}

module.exports = {
  getWorkspaceDashboard,
};
