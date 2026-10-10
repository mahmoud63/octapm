/**
 * AI usage ledger (AI-1): one AiRun row per model call, successful or not, written by the
 * gateway only. It feeds the organisation's usage view now and Superadmin later. A ledger
 * write never fails the feature: an error is logged without the prompt or any key.
 */
const { prisma } = require("../../config/db");

// A client without the AiRun model (migration not applied, client not regenerated) is reported
// once, so a silent gap in the ledger cannot go unnoticed (AI-1 live check, 2026-10-10).
let warnedMissing = false;
const ready = () => {
  const ok = Boolean(prisma?.aiRun?.create);
  if (!ok && !warnedMissing && process.env.NODE_ENV !== "test") {
    warnedMissing = true;
    console.error("[ai] usage ledger unavailable: the Prisma client has no AiRun model");
  }
  return ok;
};
const int = (value) => (Number.isFinite(value) ? Math.round(value) : null);

const record = async (run) => {
  if (!ready()) return null;
  try {
    const row = await prisma.aiRun.create({
      data: {
        orgId: run.orgId || null,
        projectId: run.projectId || null,
        userId: run.userId || null,
        apiClientId: run.apiClientId || null,
        jobId: run.jobId || null,
        actorKind: run.actorKind || "system",
        feature: String(run.feature || "unspecified").slice(0, 80),
        provider: run.provider || null,
        model: run.model || null,
        status: run.status,
        errorClass: run.errorClass ? String(run.errorClass).slice(0, 80) : null,
        inputTokens: int(run.inputTokens),
        outputTokens: int(run.outputTokens),
        costMicros: int(run.costMicros),
        latencyMs: int(run.latencyMs) ?? 0,
        retries: int(run.retries) ?? 0,
        requestId: run.requestId ? String(run.requestId).slice(0, 120) : null,
        route: run.route ? String(run.route).slice(0, 200) : null,
      },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    console.error(`[ai] usage ledger write failed: ${error?.code || error?.name || "error"}`);
    return null;
  }
};

/** One organisation's usage between two instants, by feature and by status (no prompt content). */
const summary = async ({ orgId, from, to }) => {
  if (!prisma.aiRun?.groupBy) return { byFeature: [], byStatus: [], totals: { runs: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 } };
  const where = { orgId, createdAt: { gte: from, lt: to } };
  const [byFeature, byStatus] = await Promise.all([
    prisma.aiRun.groupBy({ by: ["feature"], where, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, costMicros: true }, _avg: { latencyMs: true } }),
    prisma.aiRun.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const features = byFeature
    .map((row) => ({ feature: row.feature, runs: row._count._all, inputTokens: row._sum.inputTokens || 0, outputTokens: row._sum.outputTokens || 0, costMicros: row._sum.costMicros || 0, avgLatencyMs: Math.round(row._avg.latencyMs || 0) }))
    .sort((a, b) => b.runs - a.runs || a.feature.localeCompare(b.feature));
  const totals = features.reduce((sum, row) => ({ runs: sum.runs + row.runs, inputTokens: sum.inputTokens + row.inputTokens, outputTokens: sum.outputTokens + row.outputTokens, costMicros: sum.costMicros + row.costMicros }), { runs: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 });
  return { from: from.toISOString(), to: to.toISOString(), byFeature: features, byStatus: byStatus.map((row) => ({ status: row.status, runs: row._count._all })).sort((a, b) => a.status.localeCompare(b.status)), totals };
};

module.exports = { record, summary };
