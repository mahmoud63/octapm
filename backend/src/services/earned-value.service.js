const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const {
  addMoney,
  divideMoney,
  multiplyMoney,
  subtractMoney,
  toMoneyNumber,
} = require("../utils/money");
const {
  buildAllocationSummary,
  getApprovedActivityAllocationTotals,
} = require("./activity-boq-allocation.service");
const approvalWorkflowService = require("./approval-workflow.service");
const auditService = require("./audit.service");
const setupReadinessService = require("./project-setup-readiness.service");
const { normalizeRoleId } = require("../config/permissions");

const FORMULA_VERSION = "ev.v2";
const APPROVED = "approved";
const OPEN_PERIOD = "open";
const LOCKED_PERIOD = "locked";

const OFFICIAL_DATA_INPUTS = Object.freeze([
  {
    key: "approved_allocations",
    label: "Approved allocations",
    source: "ActivityBoqAllocation",
    requiredStatus: APPROVED,
  },
  {
    key: "approved_progress",
    label: "Approved progress",
    source: "ActivityProgress",
    requiredStatus: APPROVED,
  },
  {
    key: "approved_cost_loading",
    label: "Approved cost loading",
    source: "ActivityCostLoading",
    requiredStatus: APPROVED,
  },
]);

const EV_FORMULAS = Object.freeze({
  pv: "PV = sum(approved ActivityCostLoading.plannedValue where plannedDate <= cutoffDate)",
  ev: "EV = sum(approved ActivityBoqAllocation.amount * latest approved ActivityProgress.pctComplete approved on/before cutoffDate / 100)",
  ac: "AC = sum(latest CostRecord.actual by activity where CostRecord.actualThroughDate <= cutoffDate)",
  spi: "SPI = EV / PV when PV > 0; otherwise null",
  cpi: "CPI = EV / AC when AC > 0; otherwise null",
  eac: "EAC = revised BAC / CPI when CPI > 0; otherwise revised BAC",
  cutoff:
    "A reporting period cutoffDate is authoritative. Ad hoc cutoffDate is allowed for open calculations but is not a locked snapshot.",
  budgetRevisions:
    "Approved BudgetRevision rows effective on/before cutoffDate adjust revised BAC. PV still requires approved time-phased cost loading.",
  progressMethods:
    "Official EV uses approved ActivityProgress.pctComplete. Quantity, weighted milestone, inspection, manual, and percent submissions are calculated at approval time and do not affect EV while draft, submitted, or rejected.",
  actualCosts:
    "Official AC requires CostRecord.actualThroughDate. Progress actualCost fields are shown as estimates only and are excluded from official CPI/EAC.",
});

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clampPercent = (value) => Math.max(0, Math.min(100, toNumber(value)));

const parseDate = (value, field = "date") => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "INVALID_DATE", `${field} is invalid`);
  }
  return date;
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const dateKey = (date) => new Date(date).toISOString().slice(0, 10);

const endOfDay = (date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};

const isOnOrBefore = (value, cutoffDate) => {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date <= cutoffDate;
};

const progressEffectiveDate = (row) =>
  row?.approvedAt || row?.updatedAt || null;

const selectApprovedProgressForCutoff = (rows = [], cutoffDate) => {
  const candidates = rows
    .filter((row) => {
      if (!row || row.status !== APPROVED) return false;
      if (row.approvedAt && isOnOrBefore(row.approvedAt, cutoffDate)) {
        return true;
      }
      return !row.approvedAt && isOnOrBefore(row.updatedAt, cutoffDate);
    })
    .sort((a, b) => {
      const bDate = new Date(progressEffectiveDate(b) || 0).getTime();
      const aDate = new Date(progressEffectiveDate(a) || 0).getTime();
      return bDate - aDate;
    });

  const progress = candidates[0] || null;
  return {
    progress,
    usedUpdatedAtFallback: Boolean(progress && !progress.approvedAt),
  };
};

const buildMonthStart = (date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

const formatMonthLabel = (date) =>
  date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
};

const resolveReportingCutoffDay = (project) => {
  const cutoff = Number(project?.reportingCutoffDay);
  if (Number.isInteger(cutoff) && cutoff >= 1 && cutoff <= 31) return cutoff;
  return 25;
};

const computeBudgetRevisionDelta = (row) => {
  const amount = toMoneyNumber(row.amount);
  return row.changeType === "deduction" ? -amount : amount;
};

const trimOrNull = (value) => {
  const text = String(value || "").trim();
  return text || null;
};

const computeEvMetrics = ({ totalBudget, pv, ev, ac }) => {
  const normalizedBudget = toMoneyNumber(totalBudget);
  const normalizedPv = toMoneyNumber(pv);
  const normalizedEv = toMoneyNumber(ev);
  const normalizedAc = toMoneyNumber(ac);
  const spi = normalizedPv > 0 ? normalizedEv / normalizedPv : null;
  const cpi = normalizedAc > 0 ? normalizedEv / normalizedAc : null;
  const eac =
    normalizedBudget > 0
      ? cpi && cpi > 0
        ? divideMoney(normalizedBudget, cpi)
        : normalizedBudget
      : 0;

  return {
    totalBudget: normalizedBudget,
    pv: normalizedPv,
    ev: normalizedEv,
    ac: normalizedAc,
    spi,
    cpi,
    eac,
    sv: subtractMoney(normalizedEv, normalizedPv),
    cv: subtractMoney(normalizedEv, normalizedAc),
    etc: subtractMoney(eac, normalizedAc),
  };
};

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  return project;
};

const serializePeriod = (period) =>
  period
    ? {
        id: period.id || null,
        code: period.code,
        label: period.label || period.code,
        periodStart: toIso(period.periodStart),
        periodEnd: toIso(period.periodEnd),
        cutoffDate: toIso(period.cutoffDate),
        status: period.status || OPEN_PERIOD,
        lockedBy: period.lockedBy || null,
        lockedAt: toIso(period.lockedAt),
        isVirtual: Boolean(period.isVirtual),
      }
    : null;

const buildVirtualPeriod = ({ project, cutoffDate }) => {
  const cutoff = endOfDay(cutoffDate || new Date());
  const periodStart = buildMonthStart(cutoff);
  const code = `ADHOC-${dateKey(cutoff)}`;

  return {
    id: null,
    projectId: project.id,
    code,
    label: `Ad hoc ${dateKey(cutoff)}`,
    periodStart,
    periodEnd: cutoff,
    cutoffDate: cutoff,
    status: OPEN_PERIOD,
    isVirtual: true,
  };
};

const resolveReportingPeriod = async (
  { project, periodId = null, cutoffDate = null },
  tx = prisma,
) => {
  if (periodId) {
    const period = await tx.reportingPeriod.findFirst({
      where: { id: periodId, projectId: project.id },
      include: { evSnapshot: true },
    });

    if (!period) {
      throw new HttpError(
        404,
        "REPORTING_PERIOD_NOT_FOUND",
        "Reporting period not found",
      );
    }

    return period;
  }

  if (cutoffDate) {
    return buildVirtualPeriod({
      project,
      cutoffDate: parseDate(cutoffDate, "cutoffDate"),
    });
  }

  const latest = await tx.reportingPeriod.findFirst({
    where: { projectId: project.id },
    orderBy: [{ cutoffDate: "desc" }, { createdAt: "desc" }],
    include: { evSnapshot: true },
  });

  return latest || buildVirtualPeriod({ project, cutoffDate: new Date() });
};

const getApprovedBudgetRevisions = async (
  { projectId, cutoffDate },
  tx = prisma,
) =>
  tx.budgetRevision.findMany({
    where: {
      projectId,
      status: APPROVED,
      OR: [{ effectiveDate: null }, { effectiveDate: { lte: cutoffDate } }],
    },
    orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
  });

const getApprovedCostLoadings = async (
  { projectId, cutoffDate },
  tx = prisma,
) =>
  tx.activityCostLoading.findMany({
    where: {
      projectId,
      status: APPROVED,
      plannedDate: { lte: cutoffDate },
      activity: { isActive: true },
    },
    orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
  });

const buildOfficialDataInputs = ({
  approvedAllocatedAmount,
  approvedProgressCount,
  costLoadingCount,
}) =>
  OFFICIAL_DATA_INPUTS.map((input) => {
    if (input.key === "approved_allocations") {
      return {
        ...input,
        appliedAmount: toMoneyNumber(approvedAllocatedAmount),
      };
    }

    if (input.key === "approved_progress") {
      return {
        ...input,
        appliedCount: Number(approvedProgressCount || 0),
      };
    }

    if (input.key === "approved_cost_loading") {
      return {
        ...input,
        appliedCount: Number(costLoadingCount || 0),
      };
    }

    return input;
  });

const getReportingGate = async ({ orgId, projectId }) =>
  setupReadinessService.getOfficialReportingGate({ orgId, projectId });

const getOfficialActualCostMap = async (
  { projectId, cutoffDate },
  tx = prisma,
) => {
  const rows = await tx.costRecord.findMany({
    where: {
      projectId,
      actualThroughDate: { not: null, lte: cutoffDate },
      activity: { isActive: true },
    },
    orderBy: [{ actualThroughDate: "desc" }, { updatedAt: "desc" }],
  });

  return rows.reduce((map, row) => {
    if (!isOnOrBefore(row.actualThroughDate, cutoffDate)) {
      return map;
    }

    if (!map.has(row.activityId)) {
      map.set(row.activityId, {
        amount: toMoneyNumber(row.actual),
        source: "cost_record.actual_through_date",
        actualThroughDate: row.actualThroughDate,
        updatedAt: row.updatedAt,
      });
    }
    return map;
  }, new Map());
};

const buildPvByActivity = (costLoadings) =>
  costLoadings.reduce((map, row) => {
    map.set(
      row.activityId,
      addMoney(map.get(row.activityId) || 0, row.plannedValue),
    );
    return map;
  }, new Map());

const plannedFinishFromActivity = ({ project, activity }) => {
  if (
    !project.startDate ||
    activity.earlyFinish === null ||
    activity.earlyFinish === undefined
  ) {
    return null;
  }

  return addDays(project.startDate, activity.earlyFinish);
};

const buildOfficialSCurveData = ({ costLoadings, cutoffDate, ev }) => {
  if (!costLoadings.length) return [];

  const plannedDates = costLoadings.map((row) =>
    new Date(row.plannedDate).getTime(),
  );
  const start = buildMonthStart(new Date(Math.min(...plannedDates)));
  const finish = buildMonthStart(new Date(Math.max(...plannedDates)));
  const rows = [];
  const cursor = new Date(start);

  while (cursor <= finish) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const pv = costLoadings
      .filter((row) => new Date(row.plannedDate) <= monthEnd)
      .reduce((sum, row) => addMoney(sum, row.plannedValue), 0);

    rows.push({
      label: formatMonthLabel(cursor),
      pv,
      ev: monthEnd <= cutoffDate ? ev : null,
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return rows;
};

const buildEstimateValues = ({
  project,
  activities,
  cutoffDate,
  allocationTotals,
}) =>
  activities.reduce(
    (acc, activity) => {
      const budget = toNumber(allocationTotals.get(activity.id)?.amount);
      const { progress } = selectApprovedProgressForCutoff(
        activity.progress,
        cutoffDate,
      );
      const pct = clampPercent(progress?.pctComplete);
      const plannedFinish = plannedFinishFromActivity({ project, activity });

      if (plannedFinish && plannedFinish <= cutoffDate) {
        acc.estimatedPv = addMoney(acc.estimatedPv, budget);
      }

      if (progress?.actualCost !== null && progress?.actualCost !== undefined) {
        acc.estimatedAc = addMoney(acc.estimatedAc, progress.actualCost);
        acc.progressActualCostActivities += 1;
      } else {
        acc.estimatedAc = addMoney(
          acc.estimatedAc,
          multiplyMoney(multiplyMoney(budget, pct / 100), 1.03),
        );
        acc.derivedActualCostActivities += 1;
      }

      return acc;
    },
    {
      estimatedPv: 0,
      estimatedAc: 0,
      progressActualCostActivities: 0,
      derivedActualCostActivities: 0,
    },
  );

const snapshotToReport = ({ snapshot, period }) => {
  const basisJson = snapshot.basisJson || {};
  const metrics = computeEvMetrics({
    totalBudget: snapshot.totalBudget,
    pv: snapshot.pv,
    ev: snapshot.ev,
    ac: snapshot.ac,
  });

  return {
    ...metrics,
    spi: snapshot.spi,
    cpi: snapshot.cpi,
    eac: snapshot.eac,
    sv: snapshot.sv,
    cv: snapshot.cv,
    etc: snapshot.etc,
    reporting: {
      ...(basisJson.reporting || {}),
      period: serializePeriod(period),
      cutoffDate: toIso(snapshot.cutoffDate),
      formulaVersion: snapshot.formulaVersion,
      isSnapshot: true,
      snapshotId: snapshot.id,
      lockedAt: toIso(snapshot.lockedAt),
      lockedBy: snapshot.lockedBy || null,
    },
    basis: basisJson.basis || EV_FORMULAS,
    sourceSummary: basisJson.sourceSummary || {},
    estimates: basisJson.estimates || {},
    basisWarnings: basisJson.basisWarnings || [],
    readinessGate: basisJson.readinessGate || null,
    readinessOverride: basisJson.readinessOverride || null,
    officialDataInputs: basisJson.officialDataInputs || OFFICIAL_DATA_INPUTS,
    unallocatedBoqAmount: basisJson.unallocatedBoqAmount || 0,
    approvedAllocatedAmount: basisJson.approvedAllocatedAmount || 0,
    approvedBudgetRevisionDelta: basisJson.approvedBudgetRevisionDelta || 0,
    sCurve: snapshot.sCurveJson || [],
    activityBreakdown: snapshot.activityBreakdownJson || [],
    alerts: basisJson.alerts || {
      spiAlert: snapshot.spi !== null && snapshot.spi < 0.9,
      cpiAlert: snapshot.cpi !== null && snapshot.cpi < 0.9,
    },
    official: true,
  };
};

const buildOfficialEvReport = async ({
  orgId,
  projectId,
  periodId = null,
  cutoffDate = null,
  useLockedSnapshot = true,
  includeReadiness = true,
  tx = prisma,
}) => {
  const project = await ensureProject({ orgId, projectId }, tx);
  const period = await resolveReportingPeriod(
    { project, periodId, cutoffDate },
    tx,
  );
  const resolvedCutoffDate = endOfDay(period.cutoffDate);

  if (useLockedSnapshot && period.evSnapshot) {
    return snapshotToReport({ snapshot: period.evSnapshot, period });
  }

  const [
    activities,
    allocationTotals,
    allocationSummary,
    costLoadings,
    actualCostMap,
    budgetRevisions,
    reportingGate,
  ] = await Promise.all([
    tx.activity.findMany({
      where: { projectId, isActive: true },
      include: {
        progress: {
          where: {
            status: APPROVED,
            OR: [
              { approvedAt: { lte: resolvedCutoffDate } },
              {
                approvedAt: null,
                updatedAt: { lte: resolvedCutoffDate },
              },
            ],
          },
          orderBy: [{ approvedAt: "desc" }, { updatedAt: "desc" }],
          take: 5,
        },
      },
      orderBy: { sortOrder: "asc" },
    }),
    getApprovedActivityAllocationTotals({ projectId }, tx),
    buildAllocationSummary({ projectId }, tx),
    getApprovedCostLoadings({ projectId, cutoffDate: resolvedCutoffDate }, tx),
    getOfficialActualCostMap({ projectId, cutoffDate: resolvedCutoffDate }, tx),
    getApprovedBudgetRevisions(
      { projectId, cutoffDate: resolvedCutoffDate },
      tx,
    ),
    includeReadiness ? getReportingGate({ orgId, projectId }) : null,
  ]);

  const pvByActivity = buildPvByActivity(costLoadings);
  let ev = 0;
  let pv = 0;
  let ac = 0;
  let approvedProgressCount = 0;
  let missingProgressCount = 0;
  let officialActualActivities = 0;
  let missingActualActivities = 0;
  let legacyProgressDateFallbackActivities = 0;

  const activityRows = activities.map((activity) => {
    const allocation = allocationTotals.get(activity.id) || {
      amount: 0,
      quantity: 0,
      weight: 0,
      count: 0,
    };
    const budget = toMoneyNumber(allocation.amount);
    const { progress, usedUpdatedAtFallback } = selectApprovedProgressForCutoff(
      activity.progress,
      resolvedCutoffDate,
    );
    const pct = clampPercent(progress?.pctComplete);
    const activityPv = toMoneyNumber(pvByActivity.get(activity.id));
    const activityEv = multiplyMoney(budget, pct / 100);
    const officialActual = actualCostMap.get(activity.id) || null;
    const actualCost = officialActual ? officialActual.amount : 0;
    const estimatedActualCost =
      progress?.actualCost !== null && progress?.actualCost !== undefined
        ? toMoneyNumber(progress.actualCost)
        : multiplyMoney(multiplyMoney(budget, pct / 100), 1.03);

    if (progress) approvedProgressCount += 1;
    else missingProgressCount += 1;
    if (usedUpdatedAtFallback) legacyProgressDateFallbackActivities += 1;

    if (officialActual) officialActualActivities += 1;
    else missingActualActivities += 1;

    pv = addMoney(pv, activityPv);
    ev = addMoney(ev, activityEv);
    ac = addMoney(ac, actualCost);

    return {
      activityDbId: activity.id,
      activityId: activity.activityCode || activity.p6ActivityId || activity.id,
      name: activity.name,
      budget,
      pv: activityPv,
      ev: activityEv,
      ac: actualCost,
      actualCostSource: officialActual?.source || "missing_official_actual",
      officialActualThroughDate: toIso(officialActual?.actualThroughDate),
      officialActualUpdatedAt: toIso(officialActual?.updatedAt),
      estimatedActualCost,
      estimatedActualCostSource:
        progress?.actualCost !== null && progress?.actualCost !== undefined
          ? "activity_progress.actualCost_estimate"
          : "progress_percent_budget_1.03_estimate",
      pct: Number(pct.toFixed(2)),
      progressMethod: progress?.progressMethod || "percent_complete",
      progressStatus: progress?.status || "missing",
      quantityComplete: progress?.quantityComplete ?? null,
      quantityPlanned: progress?.quantityPlanned ?? null,
      quantityUnit: progress?.quantityUnit ?? null,
      inspectionStatus: progress?.inspectionStatus ?? null,
      hasEvidence: Boolean(progress?.evidenceJson),
      status: pct >= 100 ? "complete" : pct > 0 ? "in_progress" : "todo",
      isCritical: activity.isCritical,
    };
  });

  const approvedBudgetRevisionDelta = budgetRevisions.reduce(
    (sum, row) => addMoney(sum, computeBudgetRevisionDelta(row)),
    0,
  );
  const approvedAllocatedAmount = toMoneyNumber(
    allocationSummary.approvedAllocatedAmount,
  );
  const totalBudget = addMoney(
    approvedAllocatedAmount,
    approvedBudgetRevisionDelta,
  );
  const metrics = computeEvMetrics({ totalBudget, pv, ev, ac });
  const estimates = buildEstimateValues({
    project,
    activities,
    cutoffDate: resolvedCutoffDate,
    allocationTotals,
  });
  const appliedBudgetRevisions = budgetRevisions.map((row) => ({
    id: row.id,
    ref: row.ref,
    title: row.title,
    changeType: row.changeType,
    amount: toMoneyNumber(row.amount),
    delta: computeBudgetRevisionDelta(row),
    effectiveDate: toIso(row.effectiveDate),
    status: row.status,
  }));
  const basisWarnings = [];

  if (reportingGate && !reportingGate.ready) {
    basisWarnings.push(
      `Official reporting readiness is incomplete: ${reportingGate.message}`,
    );
  }

  if (costLoadings.length === 0 && approvedAllocatedAmount > 0) {
    basisWarnings.push(
      "No approved time-phased cost loading is available through this cutoff; official PV is zero.",
    );
  }

  if (missingActualActivities > 0) {
    basisWarnings.push(
      `${missingActualActivities} active activities do not have official cost-record actuals through this cutoff; estimates are excluded from official AC.`,
    );
  }

  if (legacyProgressDateFallbackActivities > 0) {
    basisWarnings.push(
      `${legacyProgressDateFallbackActivities} approved progress rows are legacy records without approvedAt; updatedAt was used for cutoff eligibility.`,
    );
  }

  if (period.isVirtual) {
    basisWarnings.push(
      "This is an open ad hoc calculation, not a locked reporting-period snapshot.",
    );
  }

  if (approvedBudgetRevisionDelta !== 0) {
    basisWarnings.push(
      "Approved budget revisions adjust revised BAC; distribute revisions through approved cost loading and allocations to affect PV/EV.",
    );
  }

  const sourceSummary = {
    pv: {
      source: "approved_time_phased_cost_loading",
      approvedRows: costLoadings.length,
      plannedValueThroughCutoff: pv,
    },
    ev: {
      source: "approved_progress_x_approved_allocations",
      approvedProgressActivities: approvedProgressCount,
      missingProgressActivities: missingProgressCount,
      legacyProgressDateFallbackActivities,
    },
    ac: {
      officialSourcePriority: ["cost_record.actual_through_date"],
      officialActualActivities,
      missingActualActivities,
      estimatesExcludedFromOfficialAc: true,
    },
    budget: {
      source: "approved_allocations_plus_approved_budget_revisions",
      approvedAllocatedAmount,
      approvedBudgetRevisionDelta,
      revisedBudgetAtCutoff: totalBudget,
      appliedBudgetRevisions,
    },
  };
  const officialDataInputs = buildOfficialDataInputs({
    approvedAllocatedAmount,
    approvedProgressCount,
    costLoadingCount: costLoadings.length,
  });
  const alerts = {
    spiAlert: metrics.spi !== null && metrics.spi < 0.9,
    cpiAlert: metrics.cpi !== null && metrics.cpi < 0.9,
  };

  return {
    ...metrics,
    reporting: {
      cutoffDay: resolveReportingCutoffDay(project),
      projectCalendar: project.projectCalendar || null,
      asOfDate: new Date().toISOString(),
      cutoffDate: toIso(resolvedCutoffDate),
      period: serializePeriod(period),
      formulaVersion: FORMULA_VERSION,
      isSnapshot: false,
    },
    basis: EV_FORMULAS,
    sourceSummary,
    estimates: {
      ...estimates,
      labels: {
        pv: "Prototype schedule estimate; not official PV",
        ac: "Prototype AC estimate; excluded from official AC",
      },
    },
    basisWarnings,
    readinessGate: reportingGate,
    readinessOverride: null,
    officialDataInputs,
    unallocatedBoqAmount: toMoneyNumber(allocationSummary.unallocatedAmount),
    approvedAllocatedAmount,
    approvedBudgetRevisionDelta,
    sCurve: buildOfficialSCurveData({
      costLoadings,
      cutoffDate: resolvedCutoffDate,
      ev: metrics.ev,
    }),
    activityBreakdown: activityRows
      .slice()
      .sort((a, b) => b.budget - a.budget)
      .slice(0, 20)
      .map((row) => ({
        activityId: row.activityId,
        name: row.name,
        budget: row.budget,
        pv: row.pv,
        ev: row.ev,
        ac: row.ac,
        actualCostSource: row.actualCostSource,
        officialActualThroughDate: row.officialActualThroughDate,
        estimatedActualCost: row.estimatedActualCost,
        estimatedActualCostSource: row.estimatedActualCostSource,
        pct: row.pct,
        status: row.status,
        progressMethod: row.progressMethod,
        progressStatus: row.progressStatus,
        isCritical: row.isCritical,
      })),
    alerts,
    official: true,
  };
};

const listReportingPeriods = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });
  const rows = await prisma.reportingPeriod.findMany({
    where: { projectId },
    include: {
      evSnapshot: {
        select: {
          id: true,
          pv: true,
          ev: true,
          ac: true,
          spi: true,
          cpi: true,
          lockedAt: true,
        },
      },
    },
    orderBy: [{ cutoffDate: "desc" }, { createdAt: "desc" }],
  });

  return {
    periods: rows.map((row) => ({
      ...serializePeriod(row),
      snapshot: row.evSnapshot
        ? {
            id: row.evSnapshot.id,
            pv: row.evSnapshot.pv,
            ev: row.evSnapshot.ev,
            ac: row.evSnapshot.ac,
            spi: row.evSnapshot.spi,
            cpi: row.evSnapshot.cpi,
            lockedAt: toIso(row.evSnapshot.lockedAt),
          }
        : null,
    })),
    suggestedCutoffDay: resolveReportingCutoffDay(project),
  };
};

const createReportingPeriod = async ({ orgId, projectId, userId, payload }) => {
  await ensureProject({ orgId, projectId });
  const periodStart = parseDate(payload.periodStart, "periodStart");
  const periodEnd = parseDate(payload.periodEnd, "periodEnd");
  const cutoffDate = endOfDay(
    payload.cutoffDate
      ? parseDate(payload.cutoffDate, "cutoffDate")
      : periodEnd,
  );

  if (periodEnd < periodStart) {
    throw new HttpError(
      400,
      "INVALID_REPORTING_PERIOD_DATES",
      "periodEnd must be on or after periodStart",
    );
  }

  const code =
    payload.code?.trim() ||
    `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(
      2,
      "0",
    )}`;

  return prisma.reportingPeriod.create({
    data: {
      projectId,
      code,
      label: payload.label?.trim() || code,
      periodStart,
      periodEnd,
      cutoffDate,
      createdBy: userId || null,
    },
  });
};

const ensurePeriodEditable = (period) => {
  if (period?.status === LOCKED_PERIOD) {
    throw new HttpError(
      409,
      "REPORTING_PERIOD_LOCKED",
      "Reporting period is locked",
    );
  }
};

const ensureCostLoading = async ({ projectId, costLoadingId }, tx = prisma) => {
  const row = await tx.activityCostLoading.findFirst({
    where: { id: costLoadingId, projectId },
    include: { reportingPeriod: true },
  });

  if (!row) {
    throw new HttpError(
      404,
      "COST_LOADING_NOT_FOUND",
      "Activity cost loading not found",
    );
  }

  return row;
};

const serializeCostLoading = (row, extra = {}) => ({
  id: row.id,
  projectId: row.projectId,
  activityId: row.activityId,
  reportingPeriodId: row.reportingPeriodId,
  plannedDate: toIso(row.plannedDate),
  plannedValue: row.plannedValue,
  source: row.source,
  baselineVersion: row.baselineVersion,
  status: row.status,
  notes: row.notes,
  submittedBy: row.submittedBy,
  submittedAt: toIso(row.submittedAt),
  approvedBy: row.approvedBy,
  approvedAt: toIso(row.approvedAt),
  rejectedBy: row.rejectedBy,
  rejectedAt: toIso(row.rejectedAt),
  rejectedReason: row.rejectedReason,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
  ...extra,
});

const listCostLoadings = async ({ orgId, projectId, status }) => {
  await ensureProject({ orgId, projectId });
  const rows = await prisma.activityCostLoading.findMany({
    where: { projectId, status: status || undefined },
    orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
  });

  const approvalHistoryById =
    await approvalWorkflowService.listEventsForRecords({
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.ACTIVITY_COST_LOADING,
      recordIds: rows.map((row) => row.id),
    });

  return rows.map((row) =>
    serializeCostLoading(row, {
      approvalHistory: approvalHistoryById.get(row.id) || [],
    }),
  );
};

const assertActivityInProject = async (
  { projectId, activityId },
  tx = prisma,
) => {
  const activity = await tx.activity.findFirst({
    where: { id: activityId, projectId, isActive: true },
  });

  if (!activity) {
    throw new HttpError(404, "ACTIVITY_NOT_FOUND", "Activity not found");
  }

  return activity;
};

const ensurePeriodInProject = async (
  { projectId, reportingPeriodId },
  tx = prisma,
) => {
  if (!reportingPeriodId) return null;

  const period = await tx.reportingPeriod.findFirst({
    where: { id: reportingPeriodId, projectId },
  });

  if (!period) {
    throw new HttpError(
      404,
      "REPORTING_PERIOD_NOT_FOUND",
      "Reporting period not found",
    );
  }

  ensurePeriodEditable(period);
  return period;
};

const createCostLoading = async ({
  orgId,
  projectId,
  userId,
  userRole = null,
  payload,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    await assertActivityInProject(
      { projectId, activityId: payload.activityId },
      tx,
    );
    await ensurePeriodInProject(
      { projectId, reportingPeriodId: payload.reportingPeriodId },
      tx,
    );

    const status = payload.status || "draft";
    const now = new Date();
    const row = await tx.activityCostLoading.create({
      data: {
        projectId,
        activityId: payload.activityId,
        reportingPeriodId: payload.reportingPeriodId || null,
        plannedDate: parseDate(payload.plannedDate, "plannedDate"),
        plannedValue: toMoneyNumber(payload.plannedValue),
        source: payload.source || "manual",
        baselineVersion: payload.baselineVersion?.trim() || null,
        status,
        notes: payload.notes?.trim() || null,
        submittedBy: status === "submitted" ? userId || null : null,
        submittedAt: status === "submitted" ? now : null,
        approvedBy: status === APPROVED ? userId || null : null,
        approvedAt: status === APPROVED ? now : null,
        createdBy: userId || null,
        updatedBy: userId || null,
      },
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.ACTIVITY_COST_LOADING,
      recordId: row.id,
      fromStatus: null,
      toStatus: row.status,
      actorId: userId,
      actorRole: userRole,
      metadata: {
        activityId: row.activityId,
        reportingPeriodId: row.reportingPeriodId,
        plannedDate: row.plannedDate,
        plannedValue: row.plannedValue,
      },
    });

    return serializeCostLoading(row);
  });

const updateCostLoading = async ({
  orgId,
  projectId,
  costLoadingId,
  userId,
  payload,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureCostLoading({ projectId, costLoadingId }, tx);
    ensurePeriodEditable(existing.reportingPeriod);

    if (existing.status === APPROVED) {
      throw new HttpError(
        400,
        "COST_LOADING_NOT_EDITABLE",
        "Approved cost loading cannot be edited",
      );
    }

    const nextActivityId = payload.activityId || existing.activityId;
    const nextPeriodId =
      payload.reportingPeriodId !== undefined
        ? payload.reportingPeriodId || null
        : existing.reportingPeriodId;

    await assertActivityInProject(
      { projectId, activityId: nextActivityId },
      tx,
    );
    await ensurePeriodInProject(
      { projectId, reportingPeriodId: nextPeriodId },
      tx,
    );

    const row = await tx.activityCostLoading.update({
      where: { id: costLoadingId },
      data: {
        activityId: nextActivityId,
        reportingPeriodId: nextPeriodId,
        plannedDate:
          payload.plannedDate !== undefined
            ? parseDate(payload.plannedDate, "plannedDate")
            : existing.plannedDate,
        plannedValue:
          payload.plannedValue !== undefined
            ? toMoneyNumber(payload.plannedValue)
            : existing.plannedValue,
        source: payload.source || existing.source,
        baselineVersion:
          payload.baselineVersion !== undefined
            ? payload.baselineVersion?.trim() || null
            : existing.baselineVersion,
        notes:
          payload.notes !== undefined
            ? payload.notes?.trim() || null
            : existing.notes,
        updatedBy: userId || null,
      },
    });

    return serializeCostLoading(row);
  });

const submitCostLoading = async ({
  orgId,
  projectId,
  costLoadingId,
  userId,
  userRole = null,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureCostLoading({ projectId, costLoadingId }, tx);
    ensurePeriodEditable(existing.reportingPeriod);

    if (!["draft", "rejected"].includes(existing.status)) {
      throw new HttpError(
        400,
        "INVALID_COST_LOADING_STATUS",
        "Only draft or rejected cost loading can be submitted",
      );
    }

    const now = new Date();
    const row = await tx.activityCostLoading.update({
      where: { id: costLoadingId },
      data: {
        status: "submitted",
        submittedBy: userId || null,
        submittedAt: now,
        rejectedBy: null,
        rejectedAt: null,
        rejectedReason: null,
        updatedBy: userId || null,
      },
    });

    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.ACTIVITY_COST_LOADING,
      recordId: costLoadingId,
      fromStatus: existing.status,
      toStatus: row.status,
      actorId: userId,
      actorRole: userRole,
      metadata: {
        activityId: row.activityId,
        reportingPeriodId: row.reportingPeriodId,
        plannedDate: row.plannedDate,
        plannedValue: row.plannedValue,
      },
    });

    return serializeCostLoading(row);
  });

const approveCostLoading = async ({
  orgId,
  projectId,
  costLoadingId,
  userId,
  userRole = null,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureCostLoading({ projectId, costLoadingId }, tx);
    ensurePeriodEditable(existing.reportingPeriod);

    if (existing.status === APPROVED) {
      return serializeCostLoading(existing);
    }

    if (existing.status !== "submitted") {
      throw new HttpError(
        400,
        "INVALID_COST_LOADING_STATUS",
        "Only submitted cost loading can be approved",
      );
    }

    const now = new Date();
    const row = await tx.activityCostLoading.update({
      where: { id: costLoadingId },
      data: {
        status: APPROVED,
        approvedBy: userId || null,
        approvedAt: now,
        rejectedBy: null,
        rejectedAt: null,
        rejectedReason: null,
        updatedBy: userId || null,
      },
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.ACTIVITY_COST_LOADING,
      recordId: costLoadingId,
      fromStatus: existing.status,
      toStatus: row.status,
      actorId: userId,
      actorRole: userRole,
      metadata: {
        activityId: row.activityId,
        reportingPeriodId: row.reportingPeriodId,
        plannedDate: row.plannedDate,
        plannedValue: row.plannedValue,
      },
    });

    return serializeCostLoading(row);
  });

const rejectCostLoading = async ({
  orgId,
  projectId,
  costLoadingId,
  userId,
  userRole = null,
  reason,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const existing = await ensureCostLoading({ projectId, costLoadingId }, tx);
    ensurePeriodEditable(existing.reportingPeriod);

    const rejectionReason = String(reason || "").trim();
    if (!rejectionReason) {
      throw new HttpError(
        400,
        "REJECT_REASON_REQUIRED",
        "A rejection reason is required",
      );
    }

    if (existing.status !== "submitted") {
      throw new HttpError(
        400,
        "INVALID_COST_LOADING_STATUS",
        "Only submitted cost loading can be rejected",
      );
    }

    const now = new Date();
    const row = await tx.activityCostLoading.update({
      where: { id: costLoadingId },
      data: {
        status: "rejected",
        rejectedBy: userId || null,
        rejectedAt: now,
        rejectedReason,
        updatedBy: userId || null,
      },
    });

    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.ACTIVITY_COST_LOADING,
      recordId: costLoadingId,
      fromStatus: existing.status,
      toStatus: row.status,
      actorId: userId,
      actorRole: userRole,
      reason: rejectionReason,
      metadata: {
        activityId: row.activityId,
        reportingPeriodId: row.reportingPeriodId,
        plannedDate: row.plannedDate,
        plannedValue: row.plannedValue,
      },
    });

    return serializeCostLoading(row);
  });

const resolveReportingReadinessOverride = async ({
  orgId,
  projectId,
  userId,
  userRole,
  overrideReason,
}) => {
  const gate = await getReportingGate({ orgId, projectId });
  if (!gate || gate.ready) {
    return { gate, override: null };
  }

  const reason = trimOrNull(overrideReason);
  if (!reason) {
    throw new HttpError(409, "REPORTING_READINESS_BLOCKED", gate.message, {
      gate,
    });
  }

  if (normalizeRoleId(userRole) !== "pm") {
    throw new HttpError(
      403,
      "REPORTING_READINESS_OVERRIDE_FORBIDDEN",
      "Only the Project Manager can override official reporting readiness gates.",
      { gate },
    );
  }

  return {
    gate,
    override: {
      reason,
      actorId: userId || null,
      actorRole: normalizeRoleId(userRole) || userRole || null,
      overriddenAt: new Date().toISOString(),
    },
  };
};

const lockReportingPeriod = async ({
  orgId,
  projectId,
  periodId,
  userId,
  userRole = null,
  overrideReason = null,
}) =>
  prisma.$transaction(async (tx) => {
    const project = await ensureProject({ orgId, projectId }, tx);
    const period = await tx.reportingPeriod.findFirst({
      where: { id: periodId, projectId },
      include: { evSnapshot: true },
    });

    if (!period) {
      throw new HttpError(
        404,
        "REPORTING_PERIOD_NOT_FOUND",
        "Reporting period not found",
      );
    }

    if (period.status === LOCKED_PERIOD && period.evSnapshot) {
      return snapshotToReport({ snapshot: period.evSnapshot, period });
    }

    const { gate: readinessGate, override: readinessOverride } =
      await resolveReportingReadinessOverride({
        orgId,
        projectId,
        userId,
        userRole,
        overrideReason,
      });

    const report = await buildOfficialEvReport({
      orgId,
      projectId,
      periodId,
      useLockedSnapshot: false,
      includeReadiness: false,
      tx,
    });
    const snapshotBasis = {
      reporting: report.reporting,
      basis: report.basis,
      sourceSummary: report.sourceSummary,
      estimates: report.estimates,
      basisWarnings: report.basisWarnings,
      alerts: report.alerts,
      unallocatedBoqAmount: report.unallocatedBoqAmount,
      approvedAllocatedAmount: report.approvedAllocatedAmount,
      approvedBudgetRevisionDelta: report.approvedBudgetRevisionDelta,
      projectCalendar: project.projectCalendar || null,
      readinessGate,
      readinessOverride,
      officialDataInputs: report.officialDataInputs,
    };
    const now = new Date();
    const snapshot = await tx.evPeriodSnapshot.upsert({
      where: { reportingPeriodId: periodId },
      create: {
        projectId,
        reportingPeriodId: periodId,
        cutoffDate: parseDate(report.reporting.cutoffDate, "cutoffDate"),
        formulaVersion: FORMULA_VERSION,
        totalBudget: report.totalBudget,
        pv: report.pv,
        ev: report.ev,
        ac: report.ac,
        spi: report.spi,
        cpi: report.cpi,
        eac: report.eac,
        sv: report.sv,
        cv: report.cv,
        etc: report.etc,
        basisJson: snapshotBasis,
        sCurveJson: report.sCurve,
        activityBreakdownJson: report.activityBreakdown,
        lockedBy: userId || null,
        lockedAt: now,
      },
      update: {
        cutoffDate: parseDate(report.reporting.cutoffDate, "cutoffDate"),
        formulaVersion: FORMULA_VERSION,
        totalBudget: report.totalBudget,
        pv: report.pv,
        ev: report.ev,
        ac: report.ac,
        spi: report.spi,
        cpi: report.cpi,
        eac: report.eac,
        sv: report.sv,
        cv: report.cv,
        etc: report.etc,
        basisJson: snapshotBasis,
        sCurveJson: report.sCurve,
        activityBreakdownJson: report.activityBreakdown,
        lockedBy: userId || null,
        lockedAt: now,
      },
    });

    const lockedPeriod = await tx.reportingPeriod.update({
      where: { id: periodId },
      data: {
        status: LOCKED_PERIOD,
        lockedBy: userId || null,
        lockedAt: now,
      },
    });

    // The budget by cost code is frozen with the period (OCTA-FIN-COSTCODE-019).
    await require("./budget.service").snapshotForPeriod({
      tx,
      orgId,
      projectId,
      periodId,
      userId: userId || null,
    });

    if (readinessOverride) {
      await auditService.recordEvent({
        tx,
        orgId,
        projectId,
        entityType: auditService.ENTITY_TYPES.PROJECT_SETUP_READINESS,
        entityId: projectId,
        action: auditService.ACTIONS.OVERRIDDEN,
        actorId: userId,
        actorRole: userRole,
        occurredAt: now,
        oldStatus: "blocked",
        newStatus: "overridden",
        reason: readinessOverride.reason,
        summary: {
          transition: "reporting_period.lock.override",
          periodId,
          blockerCount: readinessGate?.blockers?.length || 0,
          blockers: (readinessGate?.blockers || []).map((blocker) => ({
            code: blocker.code,
            stepKey: blocker.stepKey,
            stepLabel: blocker.stepLabel,
          })),
        },
        metadata: {
          readinessGate,
          readinessOverride,
        },
      });
    }

    return snapshotToReport({
      snapshot,
      period: { ...lockedPeriod, evSnapshot: snapshot },
    });
  });

module.exports = {
  FORMULA_VERSION,
  EV_FORMULAS,
  OFFICIAL_DATA_INPUTS,
  computeEvMetrics,
  computeBudgetRevisionDelta,
  buildOfficialEvReport,
  listReportingPeriods,
  createReportingPeriod,
  lockReportingPeriod,
  listCostLoadings,
  createCostLoading,
  updateCostLoading,
  submitCostLoading,
  approveCostLoading,
  rejectCostLoading,
  clampPercent,
};
