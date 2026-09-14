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
