const express = require('express');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { HttpError } = require('../utils/http-error');
const { prisma } = require('../config/db');
const {
  buildAllocationSummary,
  getApprovedActivityAllocationTotals,
} = require('../services/activity-boq-allocation.service');

const router = express.Router({ mergeParams: true });

router.use(authenticate);

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function buildMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatMonthLabel(date) {
  return date.toLocaleDateString('en-GB', {
    month: 'short',
    year: '2-digit',
  });
}

function buildSCurveData(activities, projectStartDate) {
  if (!projectStartDate || activities.length === 0) return [];

  const plannedDates = activities
    .filter((row) => row.plannedFinish)
    .map((row) => row.plannedFinish.getTime());

  if (plannedDates.length === 0) return [];

  const start = buildMonthStart(new Date(projectStartDate));
  const finish = buildMonthStart(new Date(Math.max(...plannedDates)));
  const today = new Date();

  const rows = [];
  const cursor = new Date(start);

  while (cursor <= finish) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);

    const pv = activities
      .filter(
        (activity) =>
          activity.plannedFinish && activity.plannedFinish <= monthEnd,
      )
      .reduce((sum, activity) => sum + activity.budget, 0);

    const ev =
      monthEnd <= today
        ? activities
            .filter(
              (activity) =>
                activity.plannedFinish && activity.plannedFinish <= monthEnd,
            )
            .reduce((sum, activity) => sum + activity.ev, 0)
        : null;

    rows.push({
      label: formatMonthLabel(cursor),
      pv,
      ev,
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return rows;
}

router.get(
  '/ev',
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, orgId: req.user.orgId },
    });

    if (!project) {
      throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const [activities, costRecords, allocationTotals, allocationSummary] =
      await Promise.all([
        prisma.activity.findMany({
          where: { projectId: req.params.projectId },
          include: {
            progress: {
              orderBy: { updatedAt: 'desc' },
              take: 1,
            },
          },
        }),
        prisma.costRecord.findMany({
          where: { projectId: req.params.projectId },
        }),
        getApprovedActivityAllocationTotals({
          projectId: req.params.projectId,
        }),
        buildAllocationSummary({ projectId: req.params.projectId }),
      ]);

    const costByActivity = new Map();
    costRecords.forEach((row) => {
      costByActivity.set(row.activityId, Number(row.actual || 0));
    });

    const normalized = activities.map((activity) => {
      const allocation = allocationTotals.get(activity.id) || {
        amount: 0,
        weight: 0,
        count: 0,
      };
      const budget = Number(allocation.amount || 0);
      const pct = Number(activity.progress[0]?.pctComplete || 0);
      const fallbackAc = costByActivity.get(activity.id) || 0;
      const actualCost = Number(
        activity.progress[0]?.actualCost || fallbackAc || 0,
      );
      const plannedFinish = project.startDate
        ? addDays(project.startDate, activity.earlyFinish)
        : null;
      const ev = (pct / 100) * budget;

      return {
        id: activity.id,
        activityId: activity.p6ActivityId || activity.wbsCode || activity.id,
        name: activity.name,
        budget,
        pct,
        actualCost,
        plannedFinish,
        status: pct >= 100 ? 'complete' : pct > 0 ? 'in_progress' : 'todo',
        isCritical: activity.isCritical,
        ev,
      };
    });

    const totalBudget = allocationSummary.approvedAllocatedAmount;
    const ev = normalized.reduce((sum, row) => sum + row.ev, 0);
    const ac = normalized.reduce((sum, row) => sum + row.actualCost, 0);

    const today = new Date();
    const pv = normalized
      .filter((row) => row.plannedFinish && row.plannedFinish <= today)
      .reduce((sum, row) => sum + row.budget, 0);

    const spi = pv > 0 ? ev / pv : null;
    const cpi = ac > 0 ? ev / ac : null;
    const eac = cpi && cpi > 0 ? totalBudget / cpi : totalBudget;
    const sv = ev - pv;
    const cv = ev - ac;
    const etc = eac - ac;

    const sCurve = buildSCurveData(normalized, project.startDate);

    const activityBreakdown = normalized
      .slice()
      .sort((a, b) => b.budget - a.budget)
      .slice(0, 20)
      .map((row) => ({
        activityId: row.activityId,
        name: row.name,
        budget: row.budget,
        ev: row.ev,
        ac: row.actualCost,
        pct: Number(row.pct.toFixed(2)),
        status: row.status,
        isCritical: row.isCritical,
      }));

    return sendSuccess(res, {
      totalBudget,
      pv,
      ev,
      ac,
      spi,
      cpi,
      eac,
      sv,
      cv,
      etc,
      unallocatedBoqAmount: allocationSummary.unallocatedAmount,
      approvedAllocatedAmount: allocationSummary.approvedAllocatedAmount,
      sCurve,
      activityBreakdown,
      alerts: {
        spiAlert: spi !== null && spi < 0.9,
        cpiAlert: cpi !== null && cpi < 0.9,
      },
    });
  }),
);

module.exports = router;
