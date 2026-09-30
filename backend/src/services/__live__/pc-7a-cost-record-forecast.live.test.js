/**
 * PC-7a 3d (owner, 2026-09-29, carried from the Round-4 closure) — a cost
 * record's default forecast. Proven against a real API process and the real
 * local Postgres.
 *
 * The defect: POST /cost/activity/:activityId with no forecast on an activity
 * with an approved allocation answered 500. resolveForecast defaulted to
 * budget + 1.1 × (actual − budget), which is −0.1 × budget before any actual;
 * the CostRecord money check refused the write and the 500 quoted the Prisma
 * call. The rule now: the larger of the record's budget and its actual — the
 * cost summary's own estimate at completion for a record without a forecast
 * (estimateAtCompletion) — and any figure the service would still write below
 * 0 is 400 COST_RECORD_MONEY_INVALID, never the database's refusal.
 *
 * One UTC project in a throwaway "LiveTest <uuid>" organisation: a BOQ item
 * of 30,000 allocated 10,000 to each of three activities (approved), and a
 * store of cement at 10 a bag. Nothing outside that organisation is written;
 * the Phase 21 certified project and the database's 12 legacy opening-balance
 * entries are only read, before and after, and must be byte-identical.
 *
 *   npm run test:live -- src/services/__live__/pc-7a-cost-record-forecast.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const { addMoney } = require("../../utils/money");
const { reconcile } = require("../cost-reconciliation.service");

const CERTIFIED_PROJECT = "0ce999f2-b175-432b-8551-20182b4fc990";
const UNIT_COST = 10;
const ALLOCATED = 10_000;

// Read-only: what the certified project and the legacy opening balances are.
const certifiedFingerprint = async () => {
  const project = await prisma.project.findUnique({ where: { id: CERTIFIED_PROJECT }, select: { orgId: true } });
  if (!project) return null;
  const sha = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const records = await prisma.costRecord.findMany({ where: { projectId: CERTIFIED_PROJECT }, orderBy: { id: "asc" }, select: { id: true, budget: true, committed: true, actual: true, forecast: true, updatedAt: true } });
  const lines = await prisma.budgetLine.findMany({ where: { projectId: CERTIFIED_PROJECT }, orderBy: { id: "asc" }, select: { id: true, originalBudget: true, actual: true, forecast: true, updatedAt: true } });
  const legacy = await prisma.costLedgerEntry.findMany({ where: { sourceType: "legacy_opening_balance" }, orderBy: { id: "asc" }, select: { id: true, projectId: true, amount: true, incurredOn: true } });
  const report = await reconcile({ orgId: project.orgId, projectId: CERTIFIED_PROJECT });
  return {
    records: sha(records),
    lines: sha(lines),
    legacy: sha(legacy),
    legacyCount: legacy.length,
    legacyTotal: legacy.reduce((sum, row) => addMoney(sum, row.amount), 0),
    ledger: report.ledger.total,
    budgetDelta: addMoney(report.budget.recordedTotal, -report.budget.derivedTotal),
    activityDelta: addMoney(report.activity.recordedTotal, -report.activity.derivedTotal),
    balanced: report.balanced,
  };
};

liveDescribe("PC-7a 3d: a cost record written without a forecast gets a sensible, non-negative one", () => {
  let live;
  let api;
  let certifiedBefore;
  const built = { activities: {} };

  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const at = (route) => `/api/v1/projects/${built.project.id}${route}`;
  const send = async (route, body, expected = 201) => {
    const response = await api.post(route, body, auth());
    expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
    return response.body.data;
  };
  const issue = (name, qty) =>
    send("/api/v1/inventory/stock/issue", { itemId: built.itemId, warehouseId: built.warehouseId, quantity: qty, projectId: built.project.id, activityId: built.activities[name] });
  const stored = (name) => prisma.costRecord.findFirst({ where: { projectId: built.project.id, activityId: built.activities[name] } });

  beforeAll(async () => {
    certifiedBefore = await certifiedFingerprint();
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4" });
    built.project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest PC-7a 3d forecast", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    const stamp = Date.now().toString(36);
    const warehouse = await send("/api/v1/inventory/warehouses", { code: `W3D${stamp}`.slice(0, 30), name: "LiveTest store 3d", kind: "site", projectId: built.project.id });
    const item = await send("/api/v1/inventory/items", { sku: `LT3D-${stamp}`, name: "LiveTest cement", unit: "bag" });
    built.warehouseId = warehouse.id;
    built.itemId = item.id;
    await send("/api/v1/inventory/stock/receive", { itemId: item.id, warehouseId: warehouse.id, quantity: 5000, unitCost: UNIT_COST, projectId: built.project.id });

    const boq = await send(at("/boq/items"), { code: "1.1", description: "Concrete", quantity: 300, unit: "m3", rate: 100 });
    for (const [index, name] of ["fresh", "under", "over"].entries()) {
      const activity = await send(at("/activities"), { name: `Activity ${name}`, activityCode: `F${index + 1}00`, duration: 5, startDate: "2026-01-05", endDate: "2026-01-09", engineerIds: [live.user.id] });
      const allocation = await send(at("/activity-boq-allocations"), { boqItemId: boq.item.id, activityId: activity.id, quantity: 100 });
      for (const step of ["submit", "approve"]) await send(at(`/activity-boq-allocations/${allocation.id}/${step}`), {}, 200);
      built.activities[name] = activity.id;
    }
  }, 300_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("a record created with no forecast on an allocated activity is 201 with forecast = its budget (was 500: −0.1 × budget)", async () => {
    const record = await send(at(`/cost/activity/${built.activities.fresh}`), {});
    expect({ budget: record.budget, actual: record.actual, forecast: record.forecast }).toEqual({ budget: ALLOCATED, actual: 0, forecast: ALLOCATED });
    const row = await stored("fresh");
    expect([row.budget.toString(), row.forecast.toString()]).toEqual(["10000", "10000"]);
    // A category alone, again without a forecast, leaves the default standing.
    const again = await send(at(`/cost/activity/${built.activities.fresh}`), { labour: 500 });
    expect(again.forecast).toBe(ALLOCATED);
  });

  it("actual below budget: a budget written without a forecast stores the budget (was budget + 1.1 × (actual − budget) = 1,200, below the 2,000 spent)", async () => {
    await issue("under", 200); // AC 2,000 through the ledger
    expect((await stored("under")).actual.toString()).toBe("2000");
    const record = await send(at(`/cost/activity/${built.activities.under}`), { budget: ALLOCATED });
    expect({ budget: record.budget, actual: record.actual, forecast: record.forecast }).toEqual({ budget: ALLOCATED, actual: 2000, forecast: ALLOCATED });
  });

  it("actual above budget: PATCH of the budget without a forecast stores the actual — never below what is spent", async () => {
    await issue("over", 1500); // AC 15,000 through the ledger
    const row = await stored("over");
    expect(row.actual.toString()).toBe("15000");
    const response = await api.request("PATCH", at(`/cost/${row.id}`), { body: { budget: ALLOCATED }, headers: auth() });
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    expect({ budget: response.body.data.budget, actual: response.body.data.actual, forecast: response.body.data.forecast }).toEqual({ budget: ALLOCATED, actual: 15000, forecast: 15000 });
    // A typed forecast still stands as typed.
    const typed = await api.request("PATCH", at(`/cost/${row.id}`), { body: { forecast: 17500 }, headers: auth() });
    expect([typed.status, typed.body?.data?.forecast]).toEqual([200, 17500]);
  });

  it("invalid money is a business error, never a 500 that quotes the database", async () => {
    for (const body of [{ forecast: -1 }, { budget: -10 }, { forecast: "lots" }]) {
      const response = await api.post(at(`/cost/activity/${built.activities.fresh}`), body, auth());
      expect([JSON.stringify(body), response.status]).toEqual([JSON.stringify(body), 400]);
      expect(JSON.stringify(response.body)).not.toMatch(/prisma|costRecord\.|invocation/i);
    }
    const row = await stored("fresh");
    expect(row.forecast.toString()).toBe("10000");
  });

  it("the summary's forecast is Σ the records' estimates at completion, and the project reconciles to 0.00 with no duplicate postings", async () => {
    const summary = await api.get(at("/cost/summary"), auth());
    expect(summary.status).toBe(200);
    // fresh 10,000 + under 10,000 + over 17,500 (typed, above actual)
    expect(summary.body.data.totals.forecast).toBe(37_500);
    expect(summary.body.data.eac.mostLikely).toBe(37_500);
    expect(summary.body.data.truth.records.forecast).toBe("projection:typed_or_greater_of_budget_and_actual");

    const recon = await api.get(at("/cost/reconciliation"), auth());
    expect(recon.status).toBe(200);
    const data = recon.body.data;
    expect(data.balanced).toBe(true);
    expect([data.ledger.total, data.activity.recordedTotal, data.activity.derivedTotal]).toEqual([17_000, 17_000, 17_000]);
    const postings = await prisma.costLedgerEntry.findMany({ where: { projectId: built.project.id }, select: { sourceType: true, sourceKey: true } });
    expect(postings.map((row) => row.sourceType).sort()).toEqual(["material_issue", "material_issue"]);
    expect(new Set(postings.map((row) => row.sourceKey)).size).toBe(postings.length);
  });

  it("read-only: the certified project and the 12 legacy opening balances are byte-identical, and the certified project still reconciles to 0.00", async () => {
    const after = await certifiedFingerprint();
    expect(after).toEqual(certifiedBefore);
    if (after) {
      expect([after.budgetDelta, after.activityDelta, after.balanced]).toEqual([0, 0, true]);
      expect([after.legacyCount, after.legacyTotal]).toEqual([12, 12_568_290.33]);
    }
  });
});
