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

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreByIndex(index) {
  if (index >= 1) return 100;
  if (index >= 0.9) return 80;
  if (index >= 0.75) return 60;
  return 40;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, orgId: req.user.orgId },
    });

    if (!project) {
      throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const [
      activities,
      costRecords,
      ncrs,
      itps,
      incidents,
      rfis,
      submittals,
      drawings,
      procurement,
      pendingChangeOrders,
      allocationTotals,
      allocationSummary,
    ] = await Promise.all([
      prisma.activity.findMany({
        where: { projectId: req.params.projectId },
        include: { progress: { orderBy: { updatedAt: 'desc' }, take: 1 } },
      }),
      prisma.costRecord.findMany({
        where: { projectId: req.params.projectId },
      }),
      prisma.ncrRecord.findMany({ where: { projectId: req.params.projectId } }),
      prisma.itpRecord.findMany({ where: { projectId: req.params.projectId } }),
      prisma.safetyIncident.findMany({
        where: { projectId: req.params.projectId },
      }),
      prisma.rfi.findMany({ where: { projectId: req.params.projectId } }),
      prisma.submittal.findMany({ where: { projectId: req.params.projectId } }),
      prisma.drawingRecord.findMany({
        where: { projectId: req.params.projectId },
      }),
      prisma.procurementOrder.findMany({
        where: { projectId: req.params.projectId },
      }),
      prisma.changeOrder.count({
        where: { projectId: req.params.projectId, status: 'pending' },
      }),
      getApprovedActivityAllocationTotals({
        projectId: req.params.projectId,
      }),
      buildAllocationSummary({ projectId: req.params.projectId }),
    ]);

    const costMap = new Map();
    costRecords.forEach((row) => {
      costMap.set(row.activityId, Number(row.actual || 0));
    });

    const ev = activities.reduce((sum, activity) => {
      const budget = Number(allocationTotals.get(activity.id)?.amount || 0);
      const pct = Number(activity.progress[0]?.pctComplete || 0);
      return sum + (budget * pct) / 100;
    }, 0);

    const ac = activities.reduce((sum, activity) => {
      const fromProgress = Number(activity.progress[0]?.actualCost || 0);
      const fallback = costMap.get(activity.id) || 0;
      return sum + (fromProgress || fallback);
    }, 0);

    const today = new Date();
    const pv = activities
      .filter((activity) => {
        if (
          !project.startDate ||
          activity.earlyFinish === null ||
          activity.earlyFinish === undefined
        ) {
          return false;
        }
        const finish = new Date(project.startDate);
        finish.setDate(finish.getDate() + Number(activity.earlyFinish));
        return finish <= today;
      })
      .reduce(
        (sum, activity) =>
          sum + Number(allocationTotals.get(activity.id)?.amount || 0),
        0,
      );

    const spi = pv > 0 ? ev / pv : 1;
    const cpi = ac > 0 ? ev / ac : 1;

    const delayedCount = activities.filter((activity) => {
      if (
        !project.startDate ||
        activity.earlyFinish === null ||
        activity.earlyFinish === undefined
      ) {
        return false;
      }
      const finish = new Date(project.startDate);
      finish.setDate(finish.getDate() + Number(activity.earlyFinish));
      const pct = Number(activity.progress[0]?.pctComplete || 0);
      return finish < today && pct < 100;
    }).length;

    const scheduleScore = clampScore(scoreByIndex(spi));
    const costScore = clampScore(scoreByIndex(cpi));

    const commercialScore = clampScore(100 - pendingChangeOrders * 10);

    const overduePO = procurement.filter((row) => {
      if (!row.deliveryDate) return false;
      return new Date(row.deliveryDate) < today && row.status !== 'delivered';
    }).length;
    const supplyChainScore = clampScore(100 - overduePO * 15);

    const majorNCRs = ncrs.filter((row) => row.severity === 'major').length;
    const minorNCRs = ncrs.filter((row) => row.severity === 'minor').length;
    const failedITPs = itps.filter((row) => row.status === 'failed').length;
    const qualityScore = clampScore(
      100 - majorNCRs * 20 - minorNCRs * 8 - failedITPs * 15,
    );

    const ltiCount = incidents.filter(
      (row) => row.incidentType === 'lti',
    ).length;
    const fatalityCount = incidents.filter(
      (row) => row.incidentType === 'fatality',
    ).length;
    const openInvestigations = incidents.filter(
      (row) => row.status !== 'closed',
    ).length;
    const safetyScore = clampScore(
      100 - fatalityCount * 100 - ltiCount * 20 - openInvestigations * 5,
    );

    const overdueRfis = rfis.filter((row) => {
      if (!row.dueDate) return false;
      return new Date(row.dueDate) < today && row.status !== 'closed';
    }).length;

    const pendingSubmittals = submittals.filter((row) =>
      ['pending', 'under_review', 'resubmit'].includes(row.status),
    ).length;

    const ifcCount = drawings.filter(
      (row) => String(row.purpose || '').toLowerCase() === 'ifc',
    ).length;
    const ifcRatio = drawings.length > 0 ? ifcCount / drawings.length : 1;

    const docControlScore = clampScore(
      100 - overdueRfis * 10 - pendingSubmittals * 5 + ifcRatio * 10,
    );

    const dimensions = [
      {
        key: 'schedule',
        label: 'Schedule',
        score: scheduleScore,
        detail: {
          spi: Number(spi.toFixed(2)),
          delayedActivities: delayedCount,
        },
      },
      {
        key: 'cost',
        label: 'Cost',
        score: costScore,
        detail: {
          cpi: Number(cpi.toFixed(2)),
          ac: Number(ac.toFixed(0)),
          ev: Number(ev.toFixed(0)),
          unallocatedBoqAmount: Number(
            allocationSummary.unallocatedAmount.toFixed(0),
          ),
        },
      },
      {
        key: 'commercial',
        label: 'Commercial',
        score: commercialScore,
        detail: {
          pendingChangeOrders,
        },
      },
      {
        key: 'supplyChain',
        label: 'Supply Chain',
        score: supplyChainScore,
        detail: {
          overduePOs: overduePO,
        },
      },
      {
        key: 'quality',
        label: 'Quality',
        score: qualityScore,
        detail: {
          majorNCRs,
          minorNCRs,
          failedITPs,
        },
      },
      {
        key: 'safety',
        label: 'Safety',
        score: safetyScore,
        detail: {
          ltiCount,
          fatalityCount,
          openInvestigations,
        },
      },
      {
        key: 'docControl',
        label: 'Doc Control',
        score: docControlScore,
        detail: {
          overdueRfis,
          pendingSubmittals,
          ifcRatio: `${Math.round(ifcRatio * 100)}%`,
        },
      },
    ];

    const overallScore = clampScore(
      dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length,
    );

    return sendSuccess(res, {
      overallScore,
      dimensions,
    });
  }),
);

module.exports = router;
