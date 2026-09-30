/**
 * Post-import seeding creates cost records only under the same lock every
 * other creator holds, and the schema forbids a second row for the pair
 * (Phase 21D, CX21-474).
 */
const fs = require("fs");
const path = require("path");
const calls = [];
const mockPrisma = {
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
  $executeRaw: jest.fn(async (strings, ...values) => { calls.push(`lock:${strings.join("?")}|${values.join(",")}`); return 0; }),
  activity: { findMany: jest.fn(async () => [{ id: "act-1", name: "Excavate", earlyStart: 0 }]) },
  costRecord: { findMany: jest.fn(async () => { calls.push("read"); return []; }), createMany: jest.fn(async ({ data }) => { calls.push(`create:${data.length}`); return { count: data.length }; }) },
  // The approved allocations the seed's default forecast is worked from (R5-2).
  activityBoqAllocation: { findMany: jest.fn(async () => []) },
  longLeadItem: { findMany: jest.fn(async () => [{ id: "ll-1" }]), createMany: jest.fn(async () => ({ count: 0 })) },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
const service = require("../post-import.service");

describe("Phase 21D — integrity (release challenge, seventh pass)", () => {
  it("CX21-474: seeding holds the (project, activity) pair, reads again under it, then creates", async () => {
    await service.runPostImportSeeding("p1");
    const lockAt = calls.findIndex((c) => c.startsWith("lock:") && c.includes("pg_advisory_xact_lock") && c.includes("cost-record:p1:act-1"));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(calls.lastIndexOf("read")).toBeGreaterThan(lockAt);
    expect(calls.findIndex((c) => c.startsWith("create:"))).toBeGreaterThan(calls.lastIndexOf("read"));
  });

  // Owner decision R5-2: the seed supplies no forecast, so each record gets
  // the initial default — the larger of the activity's approved allocation and
  // its actual (0) — and is marked 'default', never left unmarked.
  it("R5-2: every seeded record is marked 'default' and carries max(0, approved allocation, actual 0)", async () => {
    mockPrisma.activity.findMany.mockResolvedValueOnce([{ id: "act-1" }, { id: "act-2" }]);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValueOnce([{ activityId: "act-2", quantity: 1, amount: 2500, weight: 0 }]);
    mockPrisma.costRecord.createMany.mockClear();
    await service.runPostImportSeeding("p1");
    const [{ data }] = mockPrisma.costRecord.createMany.mock.calls[0];
    expect(data.map((row) => ({ activityId: row.activityId, budget: row.budget, actual: row.actual, forecast: row.forecast, forecastSource: row.forecastSource }))).toEqual([
      { activityId: "act-1", budget: 0, actual: 0, forecast: 0, forecastSource: "default" },
      { activityId: "act-2", budget: 0, actual: 0, forecast: 2500, forecastSource: "default" },
    ]);
  });

  it("CX21-474: the schema forbids a second projection row for one activity", () => {
    const schema = fs.readFileSync(path.join(__dirname, "../../../prisma/schema.prisma"), "utf8");
    const model = schema.slice(schema.indexOf("model CostRecord {"), schema.indexOf("}", schema.indexOf("model CostRecord {")));
    expect(model).toMatch(/@@unique\(\[projectId, activityId\]\)/);
  });
});

describe("Phase 21D — integrity (release challenge, eighth pass)", () => {
  it("CX21-483: the unique-pair migration merges and removes duplicate rows before creating the index", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../../prisma/migrations/20261001090100_cost_record_unique_pair/migration.sql"), "utf8");
    const dedupe = sql.indexOf('DELETE FROM "CostRecord"');
    const index = sql.indexOf("CREATE UNIQUE INDEX");
    expect(dedupe).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThan(dedupe);
    expect(sql).toMatch(/PARTITION BY "projectId", *"activityId"/);
  });
});

describe("Phase 21D — integrity (release challenge, ninth pass)", () => {
  it("CX21-490: the unique-pair migration keeps every figure the duplicates held — actual summed, the rest the largest of them — before it removes them", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../../prisma/migrations/20261001090100_cost_record_unique_pair/migration.sql"), "utf8");
    const fold = sql.slice(0, sql.indexOf('DELETE FROM "CostRecord"'));
    expect(fold).toMatch(/SUM\(c\.actual\)/);
    for (const column of ["labour", "material", "equipment", "subcontract", "indirect", "overhead", "contingency", "budget", "forecast", "committed"]) {
      expect(fold).toMatch(new RegExp(`MAX\\(c\\.${column}\\)`));
    }
    expect(fold).toMatch(/MAX\(c\."actualThroughDate"\)/);
  });
});
