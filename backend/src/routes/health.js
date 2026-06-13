const express = require("express");
const { asyncHandler } = require("../utils/async-handler");
const { sendSuccess } = require("../utils/api-response");
const { authenticate } = require("../middleware/auth");
const { HttpError } = require("../utils/http-error");
const { prisma } = require("../config/db");
const evService = require("../services/earned-value.service");
const {
  summarizeProcurementRisks,
} = require("../services/procurement-risk.service");
const {
  buildMaterialRiskRow,
  buildPackageRiskRow,
} = require("../services/procurement.service");

const router = express.Router({ mergeParams: true });

router.use(authenticate);

const EXCLUDED_OFFICIAL_STATUSES = new Set([
  "draft",
  "rejected",
  "cancelled",
  "canceled",
  "void",
]);

const KPI_SOURCE_RULES = Object.freeze({
  schedule: {
    source: "Activity + official EV report",
    formula:
      "Schedule score uses official EV SPI; delayed activity counts use latest approved ActivityProgress only.",
    officialOnly: true,
  },
  cost: {
    source: "Official EV report",
    formula:
      "Cost score uses official EV CPI from CostRecord.actualThroughDate rows through cutoff; draft progress actuals are excluded.",
    officialOnly: true,
  },
  commercial: {
    source: "Approved ChangeOrder records",
    formula:
      "Commercial score uses approved change-order count and approved schedule impact. Draft, pending, and rejected change orders are separated from official score inputs.",
    officialOnly: true,
  },
  supplyChain: {
    source: "Procurement and long-lead records",
    formula:
      "Supply-chain score uses official procurement records with draft, rejected, cancelled, and void statuses excluded.",
    officialOnly: true,
  },
  quality: {
    source: "NCR and ITP records",
    formula:
      "Quality Score = 100 - (majorNCRs * 20) - (minorNCRs * 8) - (failedITPs * 15).",
    officialOnly: true,
  },
  safety: {
    source: "SafetyIncident records",
    formula:
      "Safety score deducts fatalities, LTIs, and open investigations from 100.",
    officialOnly: true,
  },
  docControl: {
    source: "RFI, Submittal, and Drawing records",
    formula:
      "Doc-control score uses open overdue RFIs, active submittals, and IFC drawing ratio; rejected submittals are excluded.",
    officialOnly: true,
  },
  pendingReview: {
    source: "Submitted/pending workflow records",
    formula:
      "Submitted progress, IPC, pending change orders, and active submittal reviews are shown separately and do not feed official KPI score inputs.",
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

function lower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isOfficialStatus(value) {
  return !EXCLUDED_OFFICIAL_STATUSES.has(lower(value));
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function queueTarget(module, child, filters = {}) {
  return {
    projectId: null,
    module,
    ...(child ? { child } : {}),
    ...filters,
  };
}

function pendingMetric({ key, label, count, source, target, cutoffDate }) {
  return {
    key,
    label,
    count,
    source,
    sourceStatus: "pending-review",
    excludedFromOfficialKpis: true,
    cutoffDate,
    target,
  };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, orgId: req.user.orgId },
    });

    if (!project) {
      throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
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
      procurementPackages,
      procurementLines,
      activityMaterials,
      longLeadItems,
      changeOrders,
      progressSubmissionCount,
      ipcSubmissionCount,
      evReport,
    ] = await Promise.all([
      prisma.activity.findMany({
        where: { projectId: req.params.projectId },
        include: {
          progress: {
            where: { status: "approved" },
            orderBy: { updatedAt: "desc" },
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
      prisma.procurementPackage.findMany({
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
      prisma.activityMaterial.findMany({
        where: { projectId: req.params.projectId },
        include: {
          poLines: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
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
      prisma.changeOrder.findMany({
        where: {
          projectId: req.params.projectId,
          status: { in: ["pending", "approved"] },
        },
        include: {
          activityLinks: true,
        },
      }),
      prisma.progressSubmission.count({
        where: { projectId: req.params.projectId, status: "submitted" },
      }),
      prisma.ipcCertificate.count({
        where: { projectId: req.params.projectId, status: "submitted" },
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
    const cutoffDate =
      evReport.reporting?.cutoffDate || toIso(project.dataDate) || toIso(today);
    const generatedAt = new Date().toISOString();
    const pendingChangeOrders = changeOrders.filter(
      (row) => lower(row.status) === "pending",
    );
    const approvedChangeOrders = changeOrders.filter(
      (row) => lower(row.status) === "approved",
    );

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
    const costScore = cpi === null ? 60 : clampScore(scoreByIndex(Number(cpi)));

    const approvedScheduleImpactDays = approvedChangeOrders.reduce(
      (sum, row) =>
        sum +
        Math.max(
          0,
          Number(row.scheduleImpact || 0) +
            (row.activityLinks || []).reduce(
              (linkSum, link) =>
                linkSum + Number(link.approvedScheduleImpactDays || 0),
              0,
            ),
        ),
      0,
    );
    const commercialScore = clampScore(
      100 - approvedChangeOrders.length * 2 - approvedScheduleImpactDays * 0.5,
    );

    const procurementLineRows = procurementLines.map((line) => {
      const orderedQty = Number(line.orderedQty || 0);
      const receivedQty = Number(line.receivedQty || 0);
      const issuedQty = Number(line.issuedQty || 0);
      const warehouseStatus =
        issuedQty >= orderedQty && orderedQty > 0
          ? "issued"
          : receivedQty >= orderedQty && orderedQty > 0
            ? "received"
            : receivedQty > 0 || issuedQty > 0
              ? "partial"
              : "not_received";

      return {
        ...line,
        item: line.description,
        ref: line.order?.ref || null,
        source: "po_line",
        expectedDeliveryDate: line.promisedDate,
        deliveryDate: line.promisedDate,
        warehouseStatus,
      };
    });
    const procurementPackageRows = procurementPackages.map((row) => ({
      ...buildPackageRiskRow(row),
      projectId: row.projectId,
      source: "procurement_package",
    }));
    const activityMaterialRows = activityMaterials.map((row) => ({
      ...buildMaterialRiskRow(row),
      projectId: row.projectId,
      source: "activity_material",
    }));
    const officialProcurementRows = [
      ...procurement,
      ...procurementPackageRows,
      ...procurementLineRows,
      ...activityMaterialRows,
      ...longLeadItems,
    ].filter((row) => isOfficialStatus(row.status));

    const overduePO = officialProcurementRows.filter((row) => {
      if (!row.deliveryDate) return false;
      const status = String(row.status || "").toLowerCase();
      const warehouseStatus = String(row.warehouseStatus || "").toLowerCase();
      const isClear =
        ["delivered", "received", "issued", "complete", "closed"].includes(
          status,
        ) || ["received", "issued"].includes(warehouseStatus);
      return new Date(row.deliveryDate) < today && !isClear;
    }).length;
    const procurementRisk = summarizeProcurementRisks(officialProcurementRows, {
      project,
      today,
    });
    const supplyChainScore = clampScore(100 - procurementRisk.penalty);

    const majorNCRs = ncrs.filter((row) => row.severity === "major").length;
    const minorNCRs = ncrs.filter((row) => row.severity === "minor").length;
    const failedITPs = itps.filter((row) => row.status === "failed").length;
    const qualityScore = clampScore(
      100 - majorNCRs * 20 - minorNCRs * 8 - failedITPs * 15,
    );

    const ltiCount = incidents.filter(
      (row) => row.incidentType === "lti",
    ).length;
    const fatalityCount = incidents.filter(
      (row) => row.incidentType === "fatality",
    ).length;
    const openInvestigations = incidents.filter(
      (row) => row.status !== "closed",
    ).length;
    const safetyScore = clampScore(
      100 - fatalityCount * 100 - ltiCount * 20 - openInvestigations * 5,
    );

    const overdueRfis = rfis.filter((row) => {
      if (!row.dueDate) return false;
      return new Date(row.dueDate) < today && row.status !== "closed";
    }).length;

    const pendingSubmittals = submittals.filter((row) =>
      ["pending", "under_review", "resubmit"].includes(row.status),
    ).length;

    const ifcCount = drawings.filter(
      (row) => String(row.purpose || "").toLowerCase() === "ifc",
    ).length;
    const ifcRatio = drawings.length > 0 ? ifcCount / drawings.length : 1;

    const docControlScore = clampScore(
      100 - overdueRfis * 10 - pendingSubmittals * 5 + ifcRatio * 10,
    );

    const dimensions = [
      {
        key: "schedule",
        label: "Schedule",
        score: scheduleScore,
        sourceRule: KPI_SOURCE_RULES.schedule,
        cutoffDate,
        target: queueTarget(
          "schedule",
          delayedCount > 0 ? "progress" : "critical",
          {
            status: "official",
            source: "activity_progress",
          },
        ),
        detail: {
          spi: spi === null ? null : Number(spi.toFixed(2)),
          delayedActivities: delayedCount,
          basisWarnings: evReport.basisWarnings,
          sourceRule: KPI_SOURCE_RULES.schedule,
          cutoffDate,
        },
      },
      {
        key: "cost",
        label: "Cost",
        score: costScore,
        sourceRule: KPI_SOURCE_RULES.cost,
        cutoffDate,
        target: queueTarget("cost", "activity", {
          status: "official",
          source: "cost_record.actual_through_date",
        }),
        detail: {
          cpi: cpi === null ? null : Number(cpi.toFixed(2)),
          ac: Number(ac.toFixed(0)),
          ev: Number(ev.toFixed(0)),
          unallocatedBoqAmount: Number(
            Number(evReport.unallocatedBoqAmount || 0).toFixed(0),
          ),
          acSource: evReport.sourceSummary?.ac || null,
          sourceRule: KPI_SOURCE_RULES.cost,
          cutoffDate,
        },
      },
      {
        key: "commercial",
        label: "Commercial",
        score: commercialScore,
        sourceRule: KPI_SOURCE_RULES.commercial,
        cutoffDate,
        target: queueTarget("commercial", "change-orders", {
          status: "approved",
          source: "change_order",
        }),
        detail: {
          approvedChangeOrders: approvedChangeOrders.length,
          approvedScheduleImpactDays,
          pendingChangeOrders: pendingChangeOrders.length,
          sourceRule: KPI_SOURCE_RULES.commercial,
          cutoffDate,
        },
      },
      {
        key: "supplyChain",
        label: "Supply Chain",
        score: supplyChainScore,
        sourceRule: KPI_SOURCE_RULES.supplyChain,
        cutoffDate,
        target: queueTarget("schedule", "longLead", {
          status: "official",
          source: "procurement",
        }),
        detail: {
          overduePOs: overduePO,
          atRiskItems: procurementRisk.atRiskItems,
          criticalRisks: procurementRisk.bySeverity.critical,
          highRisks: procurementRisk.bySeverity.high,
          mediumRisks: procurementRisk.bySeverity.medium,
          daysAtRisk: procurementRisk.daysAtRisk,
          topRisks: procurementRisk.topRisks,
          sourceRule: KPI_SOURCE_RULES.supplyChain,
          cutoffDate,
        },
      },
      {
        key: "quality",
        label: "Quality",
        score: qualityScore,
        sourceRule: KPI_SOURCE_RULES.quality,
        cutoffDate,
        target: queueTarget("quality", "ncr", {
          status: "open",
          source: "ncr",
        }),
        detail: {
          majorNCRs,
          minorNCRs,
          failedITPs,
          sourceRule: KPI_SOURCE_RULES.quality,
          cutoffDate,
        },
      },
      {
        key: "safety",
        label: "Safety",
        score: safetyScore,
        sourceRule: KPI_SOURCE_RULES.safety,
        cutoffDate,
        target: queueTarget("quality", "safety", {
          status: "open",
          source: "safety_incident",
        }),
        detail: {
          ltiCount,
          fatalityCount,
          openInvestigations,
          sourceRule: KPI_SOURCE_RULES.safety,
          cutoffDate,
        },
      },
      {
        key: "docControl",
        label: "Doc Control",
        score: docControlScore,
        sourceRule: KPI_SOURCE_RULES.docControl,
        cutoffDate,
        target: queueTarget(
          "docControl",
          overdueRfis > 0 ? "rfi" : "submittals",
          {
            status: overdueRfis > 0 ? "open" : "under_review",
            source: overdueRfis > 0 ? "rfi" : "submittal",
          },
        ),
        detail: {
          overdueRfis,
          pendingSubmittals,
          ifcRatio: `${Math.round(ifcRatio * 100)}%`,
          sourceRule: KPI_SOURCE_RULES.docControl,
          cutoffDate,
        },
      },
    ];

    const overallScore = clampScore(
      dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length,
    );
    const pendingReviewMetrics = [
      pendingMetric({
        key: "progressSubmissions",
        label: "Progress submissions",
        count: progressSubmissionCount,
        source: "progress_submission",
        cutoffDate,
        target: queueTarget("schedule", "progress", {
          status: "submitted",
          source: "progress_submission",
        }),
      }),
      pendingMetric({
        key: "ipcSubmissions",
        label: "IPC submissions",
        count: ipcSubmissionCount,
        source: "ipc_certificate",
        cutoffDate,
        target: queueTarget("commercial", "ipc", {
          status: "submitted",
          source: "ipc_certificate",
        }),
      }),
      pendingMetric({
        key: "changeOrders",
        label: "Change orders",
        count: pendingChangeOrders.length,
        source: "change_order",
        cutoffDate,
        target: queueTarget("commercial", "change-orders", {
          status: "pending",
          source: "change_order",
        }),
      }),
      pendingMetric({
        key: "submittals",
        label: "Submittal reviews",
        count: pendingSubmittals,
        source: "submittal",
        cutoffDate,
        target: queueTarget("docControl", "submittals", {
          status: "under_review",
          source: "submittal",
        }),
      }),
    ];

    return sendSuccess(res, {
      generatedAt,
      dataFreshness: {
        generatedAt,
        cutoffDate,
        sourceUpdatedAt: toIso(project.updatedAt),
        note: "Official health dimensions use approved or active source records through cutoff; pending-review metrics are displayed separately.",
      },
      kpiSourceRules: KPI_SOURCE_RULES,
      overallScore,
      dimensions,
      pendingReview: {
        total: pendingReviewMetrics.reduce((sum, item) => sum + item.count, 0),
        metrics: pendingReviewMetrics,
        sourceRule: KPI_SOURCE_RULES.pendingReview,
      },
    });
  }),
);

module.exports = router;
