const { prisma } = require("../config/db");
const { getProjectAccessWhere } = require("./project-authorization.service");

/**
 * Portfolio (OCTA-RPT-BUILDER-023).
 *
 * The workspace dashboard computes project health from every register and
 * the official EV report — right, but slow for fifty projects. The portfolio
 * page therefore reads one precomputed `ProjectHealthSnapshot` row per
 * project, refreshed by the `portfolio.refresh` job (hourly per organisation,
 * or on demand), and shows when the numbers were computed.
 */

const STALE_MS = 2 * 60 * 60 * 1000;
const RFI_CLOSED = ["answered", "closed"];
const NCR_CLOSED = ["closed", "complete", "completed"];
const PUNCH_OPEN = ["open", "ready_for_review", "in_dispute"];
const SUBMITTAL_PENDING = ["pending", "under_review", "resubmit"];

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const monthKey = (date) => new Date(date).toISOString().slice(0, 7);
const addMonths = (key, count) => {
  const [year, month] = key.split("-").map(Number);
  return monthKey(new Date(Date.UTC(year, month - 1 + count, 1)));
};
const countMap = (groups) => new Map((groups || []).map((group) => [group.projectId, toNumber(group._count?._all)]));

/** Recomputes every project's snapshot for an organisation. */
const refreshSnapshots = async ({ orgId, now = new Date() }) => {
  const dashboard = await require("./workspace-dashboard.service").getWorkspaceDashboard({ orgId, userId: null, role: "pm", isCompanyAdmin: true, allProjects: true });
  const rows = dashboard.projectHealth || [];
  const ids = rows.map((row) => row.id);
  if (!ids.length) return { projects: 0, updated: 0, computedAt: now.toISOString() };

  const inScope = { projectId: { in: ids } };
  const [cash, rfiOpen, rfiOverdue, punchOpen, ncrOpen, submittalsPending] = await Promise.all([
    prisma.cashFlowEntry.findMany({ where: inScope, select: { projectId: true, period: true, inflow: true, outflow: true } }),
    prisma.rfi.groupBy({ by: ["projectId"], where: { ...inScope, archivedAt: null, status: { notIn: RFI_CLOSED } }, _count: { _all: true } }),
    prisma.rfi.findMany({ where: { ...inScope, archivedAt: null, status: { notIn: RFI_CLOSED }, OR: [{ responseRequiredBy: { lt: now } }, { responseRequiredBy: null, dueDate: { lt: now } }] }, select: { projectId: true } }),
    prisma.punchItem.groupBy({ by: ["projectId"], where: { ...inScope, kind: "punch", status: { in: PUNCH_OPEN } }, _count: { _all: true } }),
    prisma.ncrRecord.groupBy({ by: ["projectId"], where: { ...inScope, status: { notIn: NCR_CLOSED } }, _count: { _all: true } }),
    prisma.submittal.groupBy({ by: ["projectId"], where: { ...inScope, archivedAt: null, status: { in: SUBMITTAL_PENDING } }, _count: { _all: true } }),
  ]);

  const current = monthKey(now);
  const horizon = new Set([current, addMonths(current, 1), addMonths(current, 2)]);
  const cashByProject = new Map();
  for (const entry of cash) {
    const bucket = cashByProject.get(entry.projectId) || { in90: 0, out90: 0, toDate: 0 };
    const inflow = toNumber(entry.inflow);
    const outflow = toNumber(entry.outflow);
    if (entry.period <= current) bucket.toDate += inflow - outflow;
    if (horizon.has(entry.period)) {
      bucket.in90 += inflow;
      bucket.out90 += outflow;
    }
    cashByProject.set(entry.projectId, bucket);
  }
  const overdueRfiByProject = new Map();
  for (const row of rfiOpen && rfiOverdue ? rfiOverdue : []) overdueRfiByProject.set(row.projectId, (overdueRfiByProject.get(row.projectId) || 0) + 1);
  const openRfis = countMap(rfiOpen);
  const openPunch = countMap(punchOpen);
  const openNcrs = countMap(ncrOpen);
  const pendingSubmittals = countMap(submittalsPending);

  let updated = 0;
  for (const row of rows) {
    const money = (value) => Math.round(toNumber(value) * 100) / 100;
    const cashRow = cashByProject.get(row.id) || { in90: 0, out90: 0, toDate: 0 };
    const data = {
      orgId,
      overallScore: row.overallScore ?? null,
      dimensionsJson: row.dimensions || {},
      weakestDimension: row.weakestDimension?.key || null,
      spi: row.spi ?? null,
      cpi: row.cpi ?? null,
      ev: money(row.ev),
      pv: money(row.pv),
      ac: money(row.ac),
      eac: money(row.eac),
      bac: money(row.bac),
      cashIn90: money(cashRow.in90),
      cashOut90: money(cashRow.out90),
      cashNet90: money(cashRow.in90 - cashRow.out90),
      cashNetToDate: money(cashRow.toDate),
      openRfis: openRfis.get(row.id) || 0,
      overdueRfis: overdueRfiByProject.get(row.id) || 0,
      openPunch: openPunch.get(row.id) || 0,
      openNcrs: openNcrs.get(row.id) || 0,
      pendingSubmittals: pendingSubmittals.get(row.id) || 0,
      openTasks: toNumber(row.openTasks),
      overdueTasks: toNumber(row.overdueTasks),
      pendingChangeOrders: toNumber(row.pendingChangeOrders),
      delayedActivities: toNumber(row.delayedActivities),
      criticalActivities: toNumber(row.criticalActivities),
      procurementRisks: toNumber(row.procurementRisks),
      overdueItems: toNumber(row.overdueNcrRfi) + toNumber(row.overdueTasks),
      computedAt: now,
    };
    await prisma.projectHealthSnapshot.upsert({ where: { projectId: row.id }, create: { projectId: row.id, ...data }, update: data });
    updated += 1;
  }
  return { projects: rows.length, updated, computedAt: now.toISOString() };
};

const serializeSnapshot = (snapshot, now) => {
  if (!snapshot) return null;
  const number = (value) => (value === null || value === undefined ? null : Number(value));
  return {
    overallScore: snapshot.overallScore ?? null,
    dimensions: snapshot.dimensionsJson || {},
    weakestDimension: snapshot.weakestDimension || null,
    spi: number(snapshot.spi),
    cpi: number(snapshot.cpi),
    ev: number(snapshot.ev),
    pv: number(snapshot.pv),
    ac: number(snapshot.ac),
    eac: number(snapshot.eac),
    bac: number(snapshot.bac),
    cashIn90: number(snapshot.cashIn90),
    cashOut90: number(snapshot.cashOut90),
    cashNet90: number(snapshot.cashNet90),
    cashNetToDate: number(snapshot.cashNetToDate),
    openRfis: snapshot.openRfis,
    overdueRfis: snapshot.overdueRfis,
    openPunch: snapshot.openPunch,
    openNcrs: snapshot.openNcrs,
    pendingSubmittals: snapshot.pendingSubmittals,
    openTasks: snapshot.openTasks,
    overdueTasks: snapshot.overdueTasks,
    pendingChangeOrders: snapshot.pendingChangeOrders,
    delayedActivities: snapshot.delayedActivities,
    criticalActivities: snapshot.criticalActivities,
    procurementRisks: snapshot.procurementRisks,
    overdueItems: snapshot.overdueItems,
    openItems: snapshot.openRfis + snapshot.openPunch + snapshot.openNcrs + snapshot.pendingSubmittals + snapshot.openTasks,
    computedAt: toIso(snapshot.computedAt),
    stale: now.getTime() - new Date(snapshot.computedAt).getTime() > STALE_MS,
  };
};

/**
 * One row per project the caller can open; snapshots only, no recomputation.
 *
 * A project's contract value is one of its commercial terms, which the
 * project record states only where the caller may read them there
 * (project.service COMMERCIAL_TERMS: ipc:read on that project's own view).
 * `commercialAccessForProjects(ids)` answers with the ids whose terms the
 * caller may read; on any other row the value is withheld (`contractValue:
 * null, contractValueWithheld: true`), and the summary adds up the readable
 * rows only — null when there is none, `contractValueWithheld: true` when
 * any was left out (certification R20). Without that answer every row's is
 * withheld.
 */
const getPortfolio = async ({ orgId, user, projectIds = null, now = new Date(), commercialAccessForProjects = null }) => {
  const projects = await prisma.project.findMany({
    where: { orgId, archivedAt: null, ...(projectIds ? { id: { in: projectIds } } : {}), ...getProjectAccessWhere({ userId: user.id, role: user.role, isCompanyAdmin: user.isCompanyAdmin }) },
    select: { id: true, name: true, status: true, currency: true, contractValue: true, startDate: true, endDate: true, clientName: true, healthSnapshot: true },
    orderBy: { name: "asc" },
  });
  const answered = typeof commercialAccessForProjects === "function" ? await commercialAccessForProjects(projects.map((project) => project.id)) : null;
  const termsReadable = (projectId) => answered instanceof Set && answered.has(projectId);
  const rows = projects.map((project) => ({
    id: project.id,
    name: project.name,
    status: project.status,
    currency: project.currency,
    client: project.clientName || null,
    ...(termsReadable(project.id) ? { contractValue: toNumber(project.contractValue) } : { contractValue: null, contractValueWithheld: true }),
    startDate: toIso(project.startDate),
    endDate: toIso(project.endDate),
    snapshot: serializeSnapshot(project.healthSnapshot, now),
    stale: !project.healthSnapshot || now.getTime() - new Date(project.healthSnapshot.computedAt).getTime() > STALE_MS,
    path: `/projects/${project.id}/overview`,
  }));
  const scored = rows.filter((row) => row.snapshot && row.snapshot.overallScore !== null);
  const sum = (pick) => rows.reduce((total, row) => total + (row.snapshot ? toNumber(pick(row.snapshot)) : 0), 0);
  const computedAt = rows.reduce((latest, row) => (row.snapshot?.computedAt && (!latest || row.snapshot.computedAt > latest) ? row.snapshot.computedAt : latest), null);
  const refreshing = Boolean(await prisma.backgroundJob.findFirst({ where: { orgId, type: "portfolio.refresh", status: { in: ["queued", "running"] } }, select: { id: true } }));
  const valued = rows.filter((row) => !row.contractValueWithheld);
  const valueWithheld = valued.length < rows.length;
  return {
    generatedAt: now.toISOString(),
    computedAt,
    refreshing,
    summary: {
      projects: rows.length,
      active: rows.filter((row) => row.status === "active").length,
      contractValue: valueWithheld && !valued.length ? null : Math.round(valued.reduce((total, row) => total + row.contractValue, 0) * 100) / 100,
      ...(valueWithheld ? { contractValueWithheld: true } : {}),
      averageHealth: scored.length ? Math.round(scored.reduce((total, row) => total + row.snapshot.overallScore, 0) / scored.length) : null,
      atRisk: scored.filter((row) => row.snapshot.overallScore < 60).length,
      spiWatch: rows.filter((row) => row.snapshot?.spi !== null && row.snapshot?.spi !== undefined && row.snapshot.spi < 0.9).length,
      cpiWatch: rows.filter((row) => row.snapshot?.cpi !== null && row.snapshot?.cpi !== undefined && row.snapshot.cpi < 0.9).length,
      openItems: sum((snapshot) => snapshot.openItems),
      overdueItems: sum((snapshot) => snapshot.overdueItems),
      cashNet90: Math.round(sum((snapshot) => snapshot.cashNet90) * 100) / 100,
      staleCount: rows.filter((row) => row.stale).length,
    },
    rows,
  };
};

const requestRefresh = async ({ orgId, user }) => {
  const jobService = require("../jobs/job.service");
  const pending = await prisma.backgroundJob.findFirst({ where: { orgId, type: jobService.JOB_TYPES.PORTFOLIO_REFRESH, status: { in: [jobService.JOB_STATUSES.QUEUED, jobService.JOB_STATUSES.RUNNING] } }, select: { id: true, status: true } });
  if (pending) return { jobId: pending.id, status: pending.status, queued: false };
  const job = await jobService.enqueueJob({ orgId, type: jobService.JOB_TYPES.PORTFOLIO_REFRESH, payload: { trigger: "manual" }, requestedBy: user?.id || null, maxAttempts: 2 });
  return { jobId: job.id, status: job.status, queued: true };
};

const runPortfolioRefreshJob = async ({ job }) => refreshSnapshots({ orgId: job.orgId });

module.exports = { STALE_MS, getPortfolio, refreshSnapshots, requestRefresh, runPortfolioRefreshJob, serializeSnapshot };
