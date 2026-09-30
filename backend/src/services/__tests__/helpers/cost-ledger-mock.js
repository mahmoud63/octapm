/**
 * An in-memory stand-in for the cost ledger and the projections it maintains.
 *
 * Every posting service now writes through `cost-ledger.service`, so every
 * suite that approves a timesheet, an invoice or a pay application needs these
 * three tables. Duplicating them per suite invites them to drift apart, and the
 * one behaviour that must be identical everywhere is the unique `sourceKey` —
 * it is what makes a posting idempotent, and a mock that forgets it would let a
 * double-post pass.
 *
 * Usage, inside the `jest.mock("../../config/db")` factory:
 *
 *   const ledger = require("./helpers/cost-ledger-mock").createCostLedgerMock();
 *   const mockPrisma = { ...yourTables, ...ledger.tables };
 *   // and in beforeEach: ledger.reset();
 */
const createCostLedgerMock = ({ idPrefix = "cle" } = {}) => {
  const store = { entries: [], budgetLines: [], costRecords: [], allocations: [] };
  let seq = 0;
  const nextId = (p) => `${p}-${(seq += 1)}`;
  const clone = (row) => (row ? JSON.parse(JSON.stringify(row)) : row);
  const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

  /** Only the shapes the ledger service actually queries with. */
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, expected]) => {
      if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
        if ("in" in expected) return expected.in.includes(row[key]);
        if ("not" in expected) return row[key] !== expected.not;
        return true;
      }
      return row[key] === expected;
    });

  const tables = {
    costLedgerEntry: {
      findFirst: jest.fn(async ({ where }) => clone(store.entries.find((row) => matches(row, where)) || null)),
      findMany: jest.fn(async ({ where = {} } = {}) => store.entries.filter((row) => matches(row, where)).map(clone)),
      create: jest.fn(async ({ data }) => {
        // The real unique index is (orgId, sourceKey). Enforcing it here is the
        // whole point: without it a suite could not tell a double-post from a
        // correct one.
        if (store.entries.some((row) => row.orgId === data.orgId && row.sourceKey === data.sourceKey)) {
          const error = new Error("Unique constraint failed on the fields: (`orgId`,`sourceKey`)");
          error.code = "P2002";
          throw error;
        }
        const row = { id: nextId(idPrefix), postedAt: new Date(), reversalOfId: null, ...data };
        store.entries.push(row);
        return clone(row);
      }),
    },

    budgetLine: {
      findFirst: jest.fn(async ({ where }) => clone(store.budgetLines.find((row) => matches(row, where)) || null)),
      findMany: jest.fn(async ({ where = {} } = {}) => store.budgetLines.filter((row) => matches(row, where)).map(clone)),
      update: jest.fn(async ({ where, data }) => {
        const row = store.budgetLines.find((r) => r.id === where.id);
        if (!row) return null;
        if (data.actual?.increment !== undefined) row.actual = round2((row.actual || 0) + data.actual.increment);
        else if (data.actual?.decrement !== undefined) row.actual = round2((row.actual || 0) - data.actual.decrement);
        else if (data.actual !== undefined) row.actual = round2(data.actual);
        return clone(row);
      }),
    },

    costRecord: {
      findFirst: jest.fn(async ({ where }) => clone(store.costRecords.find((row) => matches(row, where)) || null)),
      findMany: jest.fn(async ({ where = {} } = {}) => store.costRecords.filter((row) => matches(row, where)).map(clone)),
      update: jest.fn(async ({ where, data }) => {
        const row = store.costRecords.find((r) => r.id === where.id);
        if (!row) return null;
        if (data.actual?.increment !== undefined) row.actual = round2((row.actual || 0) + data.actual.increment);
        else if (data.actual?.decrement !== undefined) row.actual = round2((row.actual || 0) - data.actual.decrement);
        else if (data.actual !== undefined) row.actual = round2(data.actual);
        if (data.actualThroughDate) row.actualThroughDate = data.actualThroughDate;
        return clone(row);
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        let count = 0;
        for (const row of store.costRecords) {
          if (!matches(row, where)) continue;
          if (data.actual !== undefined) row.actual = round2(data.actual);
          if (data.actualThroughDate) row.actualThroughDate = data.actualThroughDate;
          count += 1;
        }
        return { count };
      }),
      create: jest.fn(async ({ data }) => {
        const row = { id: nextId("cr"), actual: 0, ...data };
        store.costRecords.push(row);
        return clone(row);
      }),
    },
    // The approved allocations a record's initial default forecast is worked
    // from (R5-2, cost-record-default.service). None unless a test seeds one.
    activityBoqAllocation: {
      findMany: jest.fn(async ({ where = {} } = {}) => store.allocations.filter((row) => matches(row, { projectId: where.projectId, activityId: where.activityId })).map(clone)),
    },
  };

  return {
    store,
    tables,
    reset() {
      store.entries.length = 0;
      store.budgetLines.length = 0;
      store.costRecords.length = 0;
      store.allocations.length = 0;
      seq = 0;
    },
    seedBudgetLine(row) {
      const line = { id: row.id || nextId("bl"), actual: 0, status: "active", ...row };
      store.budgetLines.push(line);
      return line;
    },
    seedCostRecord(row) {
      const record = { id: row.id || nextId("cr"), actual: 0, ...row };
      store.costRecords.push(record);
      return record;
    },
    /** An approved allocation of `amount` on an activity. */
    seedAllocation(row) {
      const allocation = { id: row.id || nextId("alloc"), quantity: 1, weight: 0, status: "approved", isActive: true, ...row };
      store.allocations.push(allocation);
      return allocation;
    },
    /** Net ledger total, optionally filtered — what a reconciliation would derive. */
    total(filter = {}) {
      return round2(
        store.entries
          .filter((row) => matches(row, filter))
          .reduce((sum, row) => sum + Number(row.amount), 0),
      );
    },
  };
};

module.exports = { createCostLedgerMock };
