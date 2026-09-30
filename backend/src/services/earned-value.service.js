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
const {
  localDateOf,
  reportingDateOfStoredCutoff,
  reportingTimeZoneNote,
  resolveReportingCutoff,
  resolveReportingTimeZone,
  storedValueForReportingDate,
} = require("../utils/reporting-cutoff");
// Which rule gave the EAC (budget / CPI, or the budget with CPI 0 or none).
const { eacBasisOf } = require("../utils/eac-basis");
// Source / derived / projection labels on the report (labels only).
const { EV_REPORT_TRUTH, EV_HISTORY_TRUTH } = require("../utils/figure-truth");
// The server's sentences beside an EV figure (a cutoff not yet reached).
const { EV_NOTES, cutoffNotReached } = require("../utils/ev-notes");

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
  pv: "PV = sum(approved ActivityCostLoading.plannedValue where the plannedDate calendar date <= the cutoff date)",
  ev: "EV = sum(approved ActivityBoqAllocation.amount * latest approved ActivityProgress.pctComplete approved on/before cutoffDate / 100)",
  ac: "AC = sum(latest CostRecord.actual by activity where the CostRecord.actualThroughDate calendar date <= the cutoff date)",
  spi: "SPI = EV / PV when PV > 0; otherwise null",
  cpi: "CPI = EV / AC when AC > 0; otherwise null",
  eac: "EAC = revised BAC / CPI when CPI > 0; otherwise revised BAC",
  cutoff:
    "A reporting period cutoffDate is authoritative. It is a calendar date, kept as entered, that ends at the end of that date in the project time zone (Project.timezone, else the organisation default time zone, else UTC), computed for that date from the zone's own rules including daylight saving; PV, EV and AC are selected against that one cutoff. Real instants (progress approvedAt, budget-revision effectiveDate) are compared with the cutoff instant; calendar-date fields (cost-loading plannedDate, cost-record actualThroughDate, which a date input stores at 00:00 UTC of the date) count when their date is on or before the cutoff date, never the day after, in any zone. When the project has no time zone the report says which zone was used. A locked period keeps the instant and figures stored at the lock. Ad hoc cutoffDate is allowed for open calculations but is not a locked snapshot.",
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

/**
 * The zone a project's reporting cutoff is read in (owner decision D1):
 * Project.timezone, else the workspace's Organisation.defaultTimezone, else
 * UTC. The organisation row is read whole so a client generated before the
 * column existed simply finds none and falls back to UTC. Both are handed to
 * utils/reporting-cutoff, which alone decides the precedence.
 */
const resolveProjectReportingZone = async (project, tx = prisma) => {
  const organisation = project?.orgId
    ? (await tx.organisation?.findUnique?.({ where: { id: project.orgId } })) || null
    : null;
  return resolveReportingTimeZone({ project, organisation });
};

/**
 * THE reporting cutoff: the end of the cutoff's calendar date in the
 * project's reporting zone. PV, EV and AC — and the budget revisions in
 * force — are all selected against the one instant this returns; the
 * server's own time zone plays no part (utils/reporting-cutoff).
 */
const resolveCutoff = (value, zone) => {
  try {
    return resolveReportingCutoff({
      value,
      timeZone: zone.timeZone,
      timeZoneSource: zone.source,
    });
  } catch {
    throw new HttpError(400, "INVALID_DATE", "cutoffDate is invalid");
  }
};

/**
 * The bound a CALENDAR-DATE field is selected against (D1 date-only rule,
 * 2026-09-27). plannedDate (cost loadings), actualThroughDate (cost records,
 * fed by the ledger's incurredOn) and incurredOn are dates, not instants: a
 * date input stores them at 00:00 UTC of the date, and a TIMED cost (a
 * material issue's occurredAt, a pay application approved without a period
 * end) is stored by the ledger's writer as the date that instant falls on in
 * the project's reporting zone (cost-ledger economicDateOf, PC-7a 3c) — so a
 * 23:30 local issue carries the same date as a 23:30 local progress approval
 * and both count toward that date's cutoff. Such a row counts toward
 * a period when its calendar date — the UTC calendar date of the stored
 * value — is on or before the period's cutoff date, and a row dated the day
 * after never counts, in any zone. Compared as instants against the end of
 * the day in a zone west of UTC, the next date's 00:00 UTC would fall inside
 * the period. The bound is the last millisecond of the cutoff date in UTC;
 * for a project that resolves to UTC it is the cutoff instant itself.
 */
const calendarDateBound = (cutoff) => storedValueForReportingDate(cutoff.localDate);

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

// The S-curve's months are the project's: a month is its calendar dates in
// the reporting zone, and it ends where its last date ends there (the same
// rule as the cutoff — never the server's own month end).
const monthKeyOf = (instant, zone) => localDateOf(instant, zone.timeZone).slice(0, 7);

const nextMonthKey = (key) => {
  const [year, month] = key.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
};

const lastDateOfMonth = (key) => {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

const formatMonthLabel = (key) =>
  new Date(`${key}-01T00:00:00.000Z`).toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });

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

/**
 * The cutoff a period answers with (D1 and the owner's correction):
 *
 * - a locked period with its snapshot: the instant the snapshot stored, with
 *   the date and zone recorded at the lock — never re-read in a later zone;
 * - any other stored period: its reporting date (the UTC calendar date of
 *   the stored value — utils/reporting-cutoff) ending in the zone resolved
 *   now;
 * - an ad hoc period: the date it was built for, in the same zone.
 *
 * The raw stored value is never handed out as the instant.
 */
const describePeriodCutoff = (period, zone) => {
  if (period?.evSnapshot?.cutoffDate) {
    const recorded = period.evSnapshot.basisJson?.reporting || {};
    return {
      cutoffDate: new Date(period.evSnapshot.cutoffDate),
      localDate:
        recorded.cutoffLocalDate ||
        (period.cutoffDate ? reportingDateOfStoredCutoff(period.cutoffDate) : null),
      timeZone: recorded.timeZone || null,
      timeZoneSource: recorded.timeZoneSource || null,
      timeZoneNote: recorded.timeZoneNote ?? null,
      fromSnapshot: true,
    };
  }
  if (period?.isVirtual) return resolveCutoff(period.cutoffLocalDate, zone);
  let reportingDate;
  try {
    reportingDate = reportingDateOfStoredCutoff(period?.cutoffDate);
  } catch {
    throw new HttpError(400, "INVALID_DATE", "cutoffDate is invalid");
  }
  return resolveCutoff(reportingDate, zone);
};

/**
 * For a service outside EV that names a project's periods (the budget
 * snapshots): a function giving each period's cutoff as the reports use it.
 * The period should carry evSnapshot { cutoffDate, basisJson } when locked.
 */
const periodCutoffReader = async ({ orgId, projectId }, tx = prisma) => {
  const project = await ensureProject({ orgId, projectId }, tx);
  const zone = await resolveProjectReportingZone(project, tx);
  return (period) => {
    const cutoff = describePeriodCutoff(period, zone);
    return {
      cutoffDate: toIso(cutoff.cutoffDate),
      cutoffLocalDate: cutoff.localDate || null,
      timeZone: cutoff.timeZone || null,
      timeZoneSource: cutoff.timeZoneSource || null,
      timeZoneNote: cutoff.timeZoneNote ?? null,
    };
  };
};

const serializePeriod = (period, cutoff = null) =>
  period
    ? {
        id: period.id || null,
        code: period.code,
        label: period.label || period.code,
        periodStart: toIso(period.periodStart),
        periodEnd: toIso(period.periodEnd),
        // The instant the period's figures are cut at, never the stored value.
        cutoffDate: toIso(cutoff?.cutoffDate || null),
        cutoffLocalDate: cutoff?.localDate || null,
        timeZone: cutoff?.timeZone || null,
        timeZoneSource: cutoff?.timeZoneSource || null,
        timeZoneNote: cutoff?.timeZoneNote ?? null,
        status: period.status || OPEN_PERIOD,
        lockedBy: period.lockedBy || null,
        lockedAt: toIso(period.lockedAt),
        isVirtual: Boolean(period.isVirtual),
      }
    : null;

// An ad hoc period: the calendar date asked for (or today, in the project's
// reporting zone), ending at that local day's end.
const buildVirtualPeriod = ({ project, cutoffDate, zone }) => {
  const cutoff = resolveCutoff(cutoffDate || new Date(), zone);
  const periodStart = new Date(`${cutoff.localDate.slice(0, 7)}-01T00:00:00.000Z`);
  const code = `ADHOC-${cutoff.localDate}`;

  return {
    id: null,
    projectId: project.id,
    code,
    label: `Ad hoc ${cutoff.localDate}`,
    periodStart,
    periodEnd: cutoff.cutoffDate,
    cutoffDate: cutoff.cutoffDate,
    // The date it was built for: describePeriodCutoff reads the instant back
    // from this date, never from the instant.
    cutoffLocalDate: cutoff.localDate,
    status: OPEN_PERIOD,
    isVirtual: true,
  };
};

const resolveReportingPeriod = async (
  { project, periodId = null, cutoffDate = null, zone },
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
    // A calendar date (YYYY-MM-DD) is that date; a date-time names the date
    // it falls on in the reporting zone.
    return buildVirtualPeriod({ project, cutoffDate, zone });
  }

  const periods = await tx.reportingPeriod.findMany({
    where: { projectId: project.id },
    orderBy: [{ cutoffDate: "desc" }, { createdAt: "desc" }],
    include: { evSnapshot: true },
  });

  return (
    pickDefaultReportingPeriod(periods, zone) ||
    buildVirtualPeriod({ project, cutoffDate: new Date(), zone })
  );
};

/**
 * The default reporting period (owner decision D4): the latest period whose
 * cutoff instant — as the reports cut it (describePeriodCutoff: a locked
 * period's stored instant, an open one's reporting date ending in the zone
 * resolved now) — has passed. A period whose cutoff is still ahead is never
 * the default (PV would run to a future date while EV and AC stop at today);
 * it stays selectable by id. No passed period: null, and the caller cuts an
 * ad hoc report at today. `periods` arrive latest stored cutoff first; ties
 * on the instant keep that order.
 *
 * Every default EV basis goes through this — the EV report, the health
 * card, the forecast and the workspace home (resolveReportingPeriod).
 */
const pickDefaultReportingPeriod = (periods, zone, now = new Date()) => {
  const nowMs = new Date(now).getTime();
  let best = null;
  let bestMs = -Infinity;
  for (const period of periods || []) {
    const at = new Date(describePeriodCutoff(period, zone).cutoffDate).getTime();
    if (!Number.isFinite(at) || at > nowMs) continue;
    if (at > bestMs) {
      best = period;
      bestMs = at;
    }
  }
  return best;
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

// What the S-curve's EV points are (PC-4 merge gate round 3): EV is a
// figure measured at a cutoff, so the series carries it only at the month of
// this report's cutoff date — with the instant it was measured at and the PV
// through that same instant — and null in every other month. The base wrote
// this report's EV into every earlier month, a history nobody measured.
// Each locked period's snapshot holds its own EV at its own cutoff.
const S_CURVE_NOTE =
  "EV is given only in the month of this report's cutoff, measured at the cutoff instant (evMeasuredAt) against the PV through that same instant (pvAtCutoff); other months carry no EV — each locked period's snapshot holds its own. A month's pv is the planned value through the month's last date.";
const LEGACY_S_CURVE_NOTE =
  "This locked snapshot stored its S-curve before EV was given only at the cutoff: its EV in earlier months repeats the EV at the cutoff and is not a measured history.";

const buildOfficialSCurveData = ({ costLoadings, cutoffDate, cutoffLocalDate, ev, pv, zone }) => {
  if (!costLoadings.length) return [];

  // plannedDate is a calendar date: its month is the month of its own date
  // (the UTC calendar date of the stored value), and a month's PV takes the
  // loadings dated through its last date — the same date-only rule as PV.
  const plannedDates = costLoadings.map((row) =>
    new Date(row.plannedDate).getTime(),
  );
  const utc = { timeZone: "UTC" };
  const finish = monthKeyOf(Math.max(...plannedDates), utc);
  const rows = [];
  // The month the cutoff's calendar date falls in, in the reporting zone.
  const cutoffMonth = cutoffLocalDate
    ? String(cutoffLocalDate).slice(0, 7)
    : monthKeyOf(cutoffDate, zone);

  for (
    let month = monthKeyOf(Math.min(...plannedDates), utc);
    month <= finish;
    month = nextMonthKey(month)
  ) {
    const plannedThrough = storedValueForReportingDate(lastDateOfMonth(month));
    const monthPv = costLoadings
      .filter((row) => new Date(row.plannedDate) <= plannedThrough)
      .reduce((sum, row) => addMoney(sum, row.plannedValue), 0);

    const measured = month === cutoffMonth;
    rows.push({
      label: formatMonthLabel(month),
      pv: monthPv,
      ev: measured ? ev : null,
      ...(measured ? { evMeasuredAt: toIso(cutoffDate), pvAtCutoff: pv } : {}),
    });
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

  // The stored instant, and the date and zone recorded when it was locked.
  const cutoff = describePeriodCutoff({ ...period, evSnapshot: snapshot });

  return {
    ...metrics,
    spi: snapshot.spi,
    cpi: snapshot.cpi,
    eac: snapshot.eac,
    sv: snapshot.sv,
    cv: snapshot.cv,
    etc: snapshot.etc,
    // The rule the stored EAC was given by, read from the stored figures.
    eacBasis: eacBasisOf({
      totalBudget: snapshot.totalBudget,
      cpi: snapshot.cpi === null || snapshot.cpi === undefined ? null : Number(snapshot.cpi),
    }),
    // Source / derived / projection, and from what (labels only; not stored
    // with the snapshot — the stored figures are read back as they were).
    truth: EV_REPORT_TRUTH,
    reporting: {
      // A snapshot locked before its date was recorded is labelled with the
      // period's reporting date; its instant and figures are as stored.
      cutoffLocalDate: cutoff.localDate,
      ...(basisJson.reporting || {}),
      period: serializePeriod(period, cutoff),
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
    // Said, never rewritten: a series stored before EV was given only at
    // the cutoff repeats the cutoff's EV in earlier months.
    sCurveNote: (snapshot.sCurveJson || []).some(
      (row) => row && row.ev !== null && row.ev !== undefined && !row.evMeasuredAt,
    )
      ? LEGACY_S_CURVE_NOTE
      : S_CURVE_NOTE,
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
  const zone = await resolveProjectReportingZone(project, tx);
  const period = await resolveReportingPeriod(
    { project, periodId, cutoffDate, zone },
    tx,
  );

  // A locked period answers with what it stored: never recomputed, never
  // re-read against today's zone.
  if (useLockedSnapshot && period.evSnapshot) {
    return snapshotToReport({ snapshot: period.evSnapshot, period });
  }

  // One instant for PV, EV, AC and the budget revisions in force: the end
  // of the period's reporting date in the project's reporting zone, as
  // resolved now (D1) — the date as entered, the instant from the zone's
  // own rules for that date.
  const cutoff = describePeriodCutoff({ ...period, evSnapshot: null }, zone);
  const resolvedCutoffDate = cutoff.cutoffDate;
  // Calendar-date fields (plannedDate, actualThroughDate) are selected by
  // their date against the cutoff date; instants against the instant.
  const calendarThrough = calendarDateBound(cutoff);

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
    getApprovedCostLoadings({ projectId, cutoffDate: calendarThrough }, tx),
    getOfficialActualCostMap({ projectId, cutoffDate: calendarThrough }, tx),
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

  // A cutoff that has not been reached yet: PV runs to the cutoff while EV
  // and AC can only exist up to today, so SPI and SV compare a future plan
  // with to-date work. Said, not changed.
  if (cutoffNotReached(resolvedCutoffDate)) {
    basisWarnings.push(EV_NOTES.CUTOFF_NOT_REACHED);
  }

  // The project has no zone of its own: say which one the cutoff was read
  // in (the organisation's default, or UTC).
  if (cutoff.timeZoneNote) basisWarnings.push(cutoff.timeZoneNote);

  // The instant each figure's rows were selected against — one and the same.
  const selectedThrough = toIso(resolvedCutoffDate);
  const sourceSummary = {
    pv: {
      source: "approved_time_phased_cost_loading",
      approvedRows: costLoadings.length,
      plannedValueThroughCutoff: pv,
      selectedThrough,
    },
    ev: {
      source: "approved_progress_x_approved_allocations",
      approvedProgressActivities: approvedProgressCount,
      missingProgressActivities: missingProgressCount,
      legacyProgressDateFallbackActivities,
      selectedThrough,
    },
    ac: {
      officialSourcePriority: ["cost_record.actual_through_date"],
      officialActualActivities,
      missingActualActivities,
      estimatesExcludedFromOfficialAc: true,
      selectedThrough,
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
    // Which rule gave the EAC (not money; every reader receives it).
    eacBasis: eacBasisOf({ totalBudget: metrics.totalBudget, cpi: metrics.cpi }),
    // Source / derived / projection, and from what: PV, EV and AC are
    // derived; the EAC is a projection whose rule is eacBasis; totalBudget is
    // the "Budget at completion (EV basis)". Labels only.
    truth: EV_REPORT_TRUTH,
    reporting: {
      cutoffDay: resolveReportingCutoffDay(project),
      projectCalendar: project.projectCalendar || null,
      asOfDate: new Date().toISOString(),
      cutoffDate: toIso(resolvedCutoffDate),
      // What the instant is: the end of this calendar date in this zone,
      // and where the zone came from (project, organisation or utc).
      cutoffLocalDate: cutoff.localDate,
      timeZone: cutoff.timeZone,
      timeZoneSource: cutoff.timeZoneSource,
      // null when the project's own zone applied; otherwise the sentence
      // every client shows beside the cutoff.
      timeZoneNote: cutoff.timeZoneNote,
      period: serializePeriod(period, cutoff),
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
      cutoffLocalDate: cutoff.localDate,
      ev: metrics.ev,
      pv: metrics.pv,
      zone: { timeZone: cutoff.timeZone, source: cutoff.timeZoneSource },
    }),
    sCurveNote: S_CURVE_NOTE,
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
          // The instant the lock used and the date and zone it recorded.
          cutoffDate: true,
          basisJson: true,
        },
      },
    },
    orderBy: [{ cutoffDate: "desc" }, { createdAt: "desc" }],
  });

  // Each period's cutoff as the reports use it: its reporting date (as
  // entered) ending in the project's reporting zone resolved now, or, once
  // locked, the instant its snapshot stored.
  const zone = await resolveProjectReportingZone(project);
  return {
    // The zone an open period is read in today, and the note when the
    // project has none of its own.
    timeZone: zone.timeZone,
    timeZoneSource: zone.source,
    timeZoneNote: reportingTimeZoneNote({ timeZone: zone.timeZone, timeZoneSource: zone.source }),
    periods: rows.map((row) => ({
      ...serializePeriod(row, describePeriodCutoff(row, zone)),
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

// PC-7a item 3 — the S-curve's measured history. The formula S-curve gives
// EV only at the report's own cutoff (S_CURVE_NOTE); every earlier EV point
// that was ever measured lives in a locked period's EvPeriodSnapshot. The
// history is those snapshots, read exactly as stored at the lock — the
// instant, the date and zone recorded then (describePeriodCutoff, PC-4's one
// cutoff), and the figures. Nothing is recomputed, interpolated or filled in
// between periods: an open period, an ad hoc cutoff or a period locked
// without a snapshot has no point, and a later record never moves one.
const EV_HISTORY_NOTE =
  "Each history point is a locked reporting period's snapshot, read as stored at the lock: PV, EV and AC measured at that period's cutoff instant in the zone recorded then. Nothing is recomputed or filled in between periods; open periods have no point, and later records never move a locked one.";

const moneyOrNull = (value) =>
  value === null || value === undefined ? null : toMoneyNumber(value);
const ratioOrNull = (value) =>
  value === null || value === undefined ? null : Number(value);

/**
 * The locked periods' EV points for a project, earliest cutoff first, each
 * { periodId, code, label, cutoffDate, cutoffLocalDate, timeZone,
 * timeZoneSource, timeZoneNote, totalBudget, pv, ev, ac, eac, spi, cpi,
 * formulaVersion, lockedAt, snapshotId }. `through` (an instant) keeps only
 * the points cut on or before it, so a report never shows a period after
 * its own cutoff. Scoped by orgId through the project; read only.
 */
const listLockedEvHistory = async ({ orgId, projectId, through = null }, tx = prisma) => {
  await ensureProject({ orgId, projectId }, tx);
  const throughAt = through ? new Date(through) : null;
  const rows = await tx.evPeriodSnapshot.findMany({
    where: {
      projectId,
      // A snapshot whose period is not locked is not a history point.
      reportingPeriod: { projectId, status: LOCKED_PERIOD },
      ...(throughAt && Number.isFinite(throughAt.getTime())
        ? { cutoffDate: { lte: throughAt } }
        : {}),
    },
    include: { reportingPeriod: true },
    orderBy: [{ cutoffDate: "asc" }, { lockedAt: "asc" }, { id: "asc" }],
  });

  return rows.map((snapshot) => {
    const period = snapshot.reportingPeriod;
    const cutoff = describePeriodCutoff({ ...period, evSnapshot: snapshot });
    return {
      periodId: period.id,
      code: period.code,
      label: period.label || period.code,
      cutoffDate: toIso(snapshot.cutoffDate),
      cutoffLocalDate: cutoff.localDate || null,
      timeZone: cutoff.timeZone || null,
      timeZoneSource: cutoff.timeZoneSource || null,
      timeZoneNote: cutoff.timeZoneNote ?? null,
      totalBudget: toMoneyNumber(snapshot.totalBudget),
      pv: toMoneyNumber(snapshot.pv),
      ev: toMoneyNumber(snapshot.ev),
      ac: toMoneyNumber(snapshot.ac),
      eac: moneyOrNull(snapshot.eac),
      spi: ratioOrNull(snapshot.spi),
      cpi: ratioOrNull(snapshot.cpi),
      formulaVersion: snapshot.formulaVersion,
      lockedAt: toIso(snapshot.lockedAt),
      snapshotId: snapshot.id,
    };
  });
};

/**
 * An official EV report with the locked-period history through its cutoff
 * beside the formula S-curve: the report's own keys first, untouched, then
 * history, historyNote and historyTruth. The one way the history is added,
 * so every answer that carries it carries the same thing.
 */
const withLockedEvHistory = async (report, { orgId, projectId }, tx = prisma) => {
  const history = await listLockedEvHistory(
    {
      orgId,
      projectId,
      through: report?.reporting?.cutoffDate || null,
    },
    tx,
  );
  return {
    ...report,
    history,
    historyNote: EV_HISTORY_NOTE,
    historyTruth: EV_HISTORY_TRUTH,
  };
};

/**
 * The EV report as GET /reports/ev answers it: the official report
 * (buildOfficialEvReport, unchanged) with the locked-period history
 * (withLockedEvHistory). A period lock answers with the same thing for the
 * period it locked (lockReportingPeriod). Other readers of the report (the
 * health card, the forecast, the workspace home) do not carry it.
 */
const buildEvReportWithHistory = async ({ orgId, projectId, periodId = null, cutoffDate = null }) => {
  const report = await buildOfficialEvReport({ orgId, projectId, periodId, cutoffDate });
  return withLockedEvHistory(report, { orgId, projectId });
};

const createReportingPeriod = async ({ orgId, projectId, userId, payload }) => {
  const project = await ensureProject({ orgId, projectId });
  const periodStart = parseDate(payload.periodStart, "periodStart");
  const periodEnd = parseDate(payload.periodEnd, "periodEnd");
  // What is stored is the period's REPORTING DATE, exactly as entered
  // (utils/reporting-cutoff storedValueForReportingDate: the date's last
  // millisecond in UTC), so it never drifts when a zone changes later. The
  // instant is computed from that date in the zone resolved whenever the
  // period is read or locked.
  const zone = await resolveProjectReportingZone(project);
  const cutoff = resolveCutoff(payload.cutoffDate || payload.periodEnd, zone);

  if (periodEnd < periodStart) {
    throw new HttpError(
      400,
      "INVALID_REPORTING_PERIOD_DATES",
      "periodEnd must be on or after periodStart",
    );
  }

  const code = payload.code?.trim() || cutoff.localDate.slice(0, 7);

  const row = await prisma.reportingPeriod.create({
    data: {
      projectId,
      code,
      label: payload.label?.trim() || code,
      periodStart,
      periodEnd,
      cutoffDate: storedValueForReportingDate(cutoff.localDate),
      createdBy: userId || null,
    },
  });
  // The record as created, with the instant its figures will be cut at
  // today — not the stored date value.
  return {
    ...row,
    cutoffDate: toIso(cutoff.cutoffDate),
    cutoffLocalDate: cutoff.localDate,
    timeZone: cutoff.timeZone,
    timeZoneSource: cutoff.timeZoneSource,
    timeZoneNote: cutoff.timeZoneNote,
  };
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
        rejectedReason: rejectionReason,
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

    // The answer is the period's report as GET /reports/ev?periodId= gives
    // it: the stored snapshot's report with the locked-period history
    // (withLockedEvHistory), read in this transaction so it includes the
    // point this lock makes.
    if (period.status === LOCKED_PERIOD && period.evSnapshot) {
      return withLockedEvHistory(snapshotToReport({ snapshot: period.evSnapshot, period }), { orgId, projectId }, tx);
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

    return withLockedEvHistory(
      snapshotToReport({
        snapshot,
        period: { ...lockedPeriod, evSnapshot: snapshot },
      }),
      { orgId, projectId },
      tx,
    );
  });

module.exports = {
  FORMULA_VERSION,
  EV_FORMULAS,
  OFFICIAL_DATA_INPUTS,
  computeEvMetrics,
  computeBudgetRevisionDelta,
  buildOfficialEvReport,
  buildEvReportWithHistory,
  withLockedEvHistory,
  listLockedEvHistory,
  EV_HISTORY_NOTE,
  pickDefaultReportingPeriod,
  periodCutoffReader,
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
