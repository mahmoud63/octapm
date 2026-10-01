/**
 * Money overrun kinds (OCTAPM_CHANGE_INTELLIGENCE.md §1). Each figure is the
 * one its owner states — the budget register (budget.service listBudgetLines:
 * revised, committed, forecast), the commitment register (commitment.service
 * listCommitments: the revised commitment value) and the cost ledger
 * (cost-ledger.service certifiedAgainstCommitment), the official EV report
 * (earned-value.service buildOfficialEvReport: EAC, revised BAC, CPI) and the
 * IPC certificate's stored over-certification. The rules compare; they never
 * compute money, never feed CostRecord.forecast, BudgetLine.forecast or the
 * EAC, and write nothing. The forecast's change-order impacts are not read
 * (R5-1: they stay a forecast).
 *
 * Money kinds follow cost:read; certified_over_earned is BOQ-derived (the
 * certificate's lines are BOQ rows) and is withheld from a non-BOQ reader too.
 */
const { prisma } = require("../../config/db");
const { THRESHOLDS, CPI_ALERT, overRatioSeverity, round2 } = require("./_thresholds");

const budgetService = () => require("../budget.service");
const commitmentService = () => require("../commitment.service");
const costLedgerService = () => require("../cost-ledger.service");
const evService = () => require("../earned-value.service");

const budgetLines = (ctx) => ctx.memo("budgetLines", async () => (await budgetService().listBudgetLines({ orgId: ctx.orgId, projectId: ctx.projectId })).items || []);
const lineLabel = (line) => [line.costCode?.code, line.costCode?.name, line.costType].filter(Boolean).join(" · ") || line.description || null;

const COMMITTED_BASIS =
  "Committed on the budget register (budget.service deriveLine): executed/closed commitments and approved commitment change orders posted to the line (committedFromCommitments), else the line's manual committed figure";
const REVISED_BASIS = "Revised budget on the budget register (budget.service deriveLine): original + approved change orders + revisions and transfers";

// ─── certified_over_earned ──────────────────────────────────────────────────

const certifiedOverEarned = {
  kind: "certified_over_earned",
  severity: "critical",
  subjectType: "ipc_certificate",
  module: "cost",
  boqDerived: true,
  evaluate: async ({ projectId, cutoff, ctx }) => {
    const threshold = THRESHOLDS.certified_over_earned;
    // The figure ipc.service stored when it certified the certificate — read as
    // stored, never recomputed (a later progress change does not move it).
    const certificates = await prisma.ipcCertificate.findMany({
      where: {
        projectId,
        status: { in: ["certified", "paid"] },
        overCertificationAmount: { gt: threshold.tolerance },
        ...(cutoff ? { certifiedAt: { lte: cutoff } } : {}),
      },
      select: {
        id: true, period: true, status: true, certifiedAt: true, overCertificationAmount: true,
        earnedValueAtCertification: true, approvedLimitAtCertification: true, certificationOverrideReason: true,
      },
      orderBy: { certifiedAt: "asc" },
    });
    return certificates.map((certificate) => ({
      subjectType: "ipc_certificate",
      subjectId: certificate.id,
      measured: {
        value: round2(certificate.overCertificationAmount),
        unitCode: ctx.currency,
        basis:
          "IpcCertificate.overCertificationAmount, stored by ipc.service at certification: the larger of Σ cumulative certified above earned value and Σ cumulative certified above the approved limit, over the certificate's lines",
      },
      limit: {
        value: 0,
        unitCode: ctx.currency,
        basis: "Nothing is certified beyond earned value: any stored over-certification is the exception (earned value at certification is IpcCertificate.earnedValueAtCertification)",
      },
      data: {
        label: certificate.period,
        period: certificate.period,
        status: certificate.status,
        certifiedAt: certificate.certifiedAt ? certificate.certifiedAt.toISOString() : null,
        earnedValueAtCertification: round2(certificate.earnedValueAtCertification),
        approvedLimitAtCertification: round2(certificate.approvedLimitAtCertification),
        overrideRecorded: Boolean(certificate.certificationOverrideReason),
      },
    }));
  },
};

// ─── committed_over_budget ──────────────────────────────────────────────────

const committedOverBudget = {
  kind: "committed_over_budget",
  severity: "warning",
  subjectType: "budget_line",
  module: "cost",
  boqDerived: false,
  evaluate: async ({ ctx }) => {
    const threshold = THRESHOLDS.committed_over_budget;
    const lines = await budgetLines(ctx);
    return lines
      .filter((line) => line.status === "active" && Number(line.committed) > Number(line.revisedBudget) + threshold.tolerance)
      .map((line) => ({
        subjectType: "budget_line",
        subjectId: line.id,
        severity: overRatioSeverity({ measured: line.committed, limit: line.revisedBudget, ratio: threshold.criticalOverRatio }),
        measured: { value: round2(line.committed), unitCode: ctx.currency, basis: COMMITTED_BASIS },
        limit: { value: round2(line.revisedBudget), unitCode: ctx.currency, basis: REVISED_BASIS },
        groupKeys: { costCodeId: line.costCodeId || null },
        data: {
          label: lineLabel(line),
          costType: line.costType,
          committedFromCommitments: round2(line.committedFromCommitments),
          committedManual: round2(line.committedManual),
          exceedance: round2(Number(line.committed) - Number(line.revisedBudget)),
        },
      }));
  },
};

// ─── actual_over_committed ──────────────────────────────────────────────────

const actualOverCommitted = {
  kind: "actual_over_committed",
  severity: "warning",
  subjectType: "commitment",
  module: "cost",
  boqDerived: false,
  evaluate: async ({ orgId, projectId, ctx }) => {
    const threshold = THRESHOLDS.actual_over_committed;
    const { items } = await commitmentService().listCommitments({ orgId, projectId, query: {}, viewer: null });
    if (items.length >= 500) ctx.note("actual_over_committed: the commitment register answers its first 500 commitments; later ones are not compared");
    const posting = items.filter((item) => commitmentService().POSTING_STATUSES.includes(item.status));
    const rows = [];
    for (const commitment of posting) {
      const actual = await costLedgerService().certifiedAgainstCommitment({ projectId, commitmentId: commitment.id });
      const revised = Number(commitment.revised) || 0;
      if (!(Number(actual) > revised + threshold.tolerance)) continue;
      rows.push({
        subjectType: "commitment",
        subjectId: commitment.id,
        severity: overRatioSeverity({ measured: actual, limit: revised, ratio: threshold.criticalOverRatio }),
        measured: {
          value: round2(actual),
          unitCode: commitment.currency || ctx.currency,
          basis: "Cost-ledger total on the commitment (cost-ledger.service certifiedAgainstCommitment: Σ CostLedgerEntry.amount naming it, reversals netted)",
        },
        limit: {
          value: round2(revised),
          unitCode: commitment.currency || ctx.currency,
          basis: "Revised commitment value (commitment.service totalsFor: Σ SOV lines + approved commitment change orders)",
        },
        data: {
          label: [commitment.ref, commitment.title].filter(Boolean).join(" · "),
          status: commitment.status,
          original: round2(commitment.original),
          approvedChanges: round2(commitment.approvedChanges),
          exceedance: round2(Number(actual) - revised),
        },
      });
    }
    return rows;
  },
};

// ─── forecast_over_revised ──────────────────────────────────────────────────

const forecastOverRevised = {
  kind: "forecast_over_revised",
  severity: "warning",
  subjectType: "project",
  module: "cost",
  boqDerived: false,
  evaluate: async ({ orgId, projectId, cutoff, ctx }) => {
    const threshold = THRESHOLDS.forecast_over_revised;
    const rows = [];

    // The project: the official EAC against revised BAC — the same EV answer
    // the forecast and the health card read (the default reporting period,
    // its stored snapshot when locked), or the cutoff asked for.
    const report = await evService().buildOfficialEvReport({
      orgId,
      projectId,
      ...(cutoff ? { cutoffDate: cutoff, useLockedSnapshot: false } : { useLockedSnapshot: true }),
      includeReadiness: false,
    });
    const eac = Number(report?.eac) || 0;
    const bac = Number(report?.totalBudget) || 0;
    if (bac > 0 && eac > bac + threshold.tolerance) {
      const period = report.reporting?.period || null;
      const cutoffText = report.reporting?.cutoffLocalDate || null;
      rows.push({
        subjectType: "project",
        subjectId: projectId,
        severity: report.cpi != null && report.cpi < CPI_ALERT ? "critical" : "warning",
        measured: {
          value: round2(eac),
          unitCode: ctx.currency,
          basis: `Official EAC (earned-value.service buildOfficialEvReport, ${cutoff ? "at the cutoff asked for" : report.reporting?.isSnapshot ? "the default reporting period's locked snapshot" : "the default reporting period"}): revised BAC / CPI — a projection`,
        },
        limit: {
          value: round2(bac),
          unitCode: ctx.currency,
          basis: "Revised BAC — budget at completion (EV basis): approved allocations + approved budget revisions at the cutoff",
        },
        data: {
          label: ctx.projectName,
          cpi: report.cpi ?? null,
          spi: report.spi ?? null,
          eacBasis: report.eacBasis ?? null,
          periodId: period?.id ?? null,
          cutoffLocalDate: cutoffText,
          exceedance: round2(eac - bac),
        },
      });
    }

    // Each budget line: its forecast against its revised budget, as the
    // register states both (a typed forecast, or the register's default).
    const lines = await budgetLines(ctx);
    for (const line of lines) {
      if (line.status !== "active" || !(Number(line.forecast) > Number(line.revisedBudget) + threshold.tolerance)) continue;
      rows.push({
        subjectType: "budget_line",
        subjectId: line.id,
        severity: overRatioSeverity({ measured: line.forecast, limit: line.revisedBudget, ratio: threshold.criticalOverRatio }),
        measured: {
          value: round2(line.forecast),
          unitCode: ctx.currency,
          basis: line.forecastIsManual
            ? "Forecast on the budget register: the line's typed forecast (a projection)"
            : "Forecast on the budget register: the register's default, max(revised, actual, committed) (budget.service deriveLine — a projection)",
        },
        limit: { value: round2(line.revisedBudget), unitCode: ctx.currency, basis: REVISED_BASIS },
        groupKeys: { costCodeId: line.costCodeId || null },
        data: {
          label: lineLabel(line),
          costType: line.costType,
          forecastIsManual: Boolean(line.forecastIsManual),
          actual: round2(line.actual),
          committed: round2(line.committed),
          exceedance: round2(Number(line.forecast) - Number(line.revisedBudget)),
        },
      });
    }
    return rows;
  },
};

module.exports = [certifiedOverEarned, committedOverBudget, actualOverCommitted, forecastOverRevised];
