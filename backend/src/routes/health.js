const express = require('express');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { HttpError } = require('../utils/http-error');
const { prisma } = require('../config/db');
const evService = require('../services/earned-value.service');
const {
  summarizeProcurementRisks,
} = require('../services/procurement-risk.service');

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
      ncrs,
      itps,
      incidents,
      rfis,
      submittals,
      drawings,
      procurement,
      procurementLines,
      longLeadItems,
      pendingChangeOrders,
      evReport,
    ] = await Promise.all([
      prisma.activity.findMany({
        where: { projectId: req.params.projectId },
        include: {
          progress: {
            where: { status: 'approved' },
            orderBy: { updatedAt: 'desc' },
            take: 1,
          },
        },
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
      prisma.procurementPoLine.findMany({
        where: { projectId: req.params.projectId },
        include: {
          order: { select: { id: true, ref: true, status: true } },
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
      prisma.longLeadItem.findMany({
        where: { projectId: req.params.projectId },
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
      prisma.changeOrder.count({
        where: { projectId: req.params.projectId, status: 'pending' },
      }),
      evService.buildOfficialEvReport({
        orgId: req.user.orgId,
        projectId: req.params.projectId,
      }),
    ]);

    const today = new Date();
    const ev = Number(evReport.ev || 0);
    const ac = Number(evReport.ac || 0);
    const spi = evReport.spi;
    const cpi = evReport.cpi;

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

    const scheduleScore =
      spi === null ? 60 : clampScore(scoreByIndex(Number(spi)));
    const costScore =
      cpi === null ? 60 : clampScore(scoreByIndex(Number(cpi)));

    const commercialScore = clampScore(100 - pendingChangeOrders * 10);

    const procurementLineRows = procurementLines.map((line) => {
      const orderedQty = Number(line.orderedQty || 0);
      const receivedQty = Number(line.receivedQty || 0);
      const issuedQty = Number(line.issuedQty || 0);
      const warehouseStatus =
        issuedQty >= orderedQty && orderedQty > 0
          ? 'issued'
          : receivedQty >= orderedQty && orderedQty > 0
            ? 'received'
            : receivedQty > 0 || issuedQty > 0
              ? 'partial'
              : 'not_received';

      return {
        ...line,
        item: line.description,
        ref: line.order?.ref || null,
        expectedDeliveryDate: line.promisedDate,
        deliveryDate: line.promisedDate,
        warehouseStatus,
      };
    });

    const overduePO = [...procurement, ...procurementLineRows].filter((row) => {
      if (!row.deliveryDate) return false;
      const status = String(row.status || '').toLowerCase();
      const warehouseStatus = String(row.warehouseStatus || '').toLowerCase();
      const isClear =
        ['delivered', 'received', 'issued', 'complete', 'closed'].includes(
          status,
        ) || ['received', 'issued'].includes(warehouseStatus);
      return new Date(row.deliveryDate) < today && !isClear;
    }).length;
    const procurementRisk = summarizeProcurementRisks(
      [...procurement, ...procurementLineRows, ...longLeadItems],
      { project, today },
    );
    const supplyChainScore = clampScore(100 - procurementRisk.penalty);

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
          spi: spi === null ? null : Number(spi.toFixed(2)),
          delayedActivities: delayedCount,
          basisWarnings: evReport.basisWarnings,
        },
      },
      {
        key: 'cost',
        label: 'Cost',
        score: costScore,
        detail: {
          cpi: cpi === null ? null : Number(cpi.toFixed(2)),
          ac: Number(ac.toFixed(0)),
          ev: Number(ev.toFixed(0)),
          unallocatedBoqAmount: Number(
            Number(evReport.unallocatedBoqAmount || 0).toFixed(0),
          ),
          acSource: evReport.sourceSummary?.ac || null,
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
          atRiskItems: procurementRisk.atRiskItems,
          criticalRisks: procurementRisk.bySeverity.critical,
          highRisks: procurementRisk.bySeverity.high,
          mediumRisks: procurementRisk.bySeverity.medium,
          daysAtRisk: procurementRisk.daysAtRisk,
          topRisks: procurementRisk.topRisks,
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
