jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const {
  CONTRACT_EVENT_VALUE_WITHHELD,
  CONTRACT_VALUE_WITHHELD,
  withheldAuditHistory,
  withheldBillingStatement,
  withheldPrimeContract,
} = require("../boq-figures");

/**
 * The client contract's original value (owner decisions 1-3, 2026-09-29):
 * an established value (project_value, contract_entry) reaches every IPC /
 * contract reader; an unconfirmed BOQ fallback, or a value of unestablished
 * source, reaches only a member who may read the BOQ — never as zero.
 */
const BOQ = { boq: true, budget: true };
const NO_BOQ = [
  { boq: false, budget: true },
  { boq: false, budget: false },
];

const contract = (over = {}) => ({
  id: "pc-1",
  ref: "PC-1",
  originalValue: 32465.76,
  originalValueSource: "boq_fallback",
  approvedChangesValue: 1000,
  pendingChangesValue: 0,
  revisedValue: 33465.76,
  advanceRate: 10,
  advanceAmount: 3246.58,
  advancePaidAmount: 500,
  advanceRecoveredAmount: 0,
  advanceOutstanding: 500,
  retentionRate: 5,
  ...over,
});

const statement = (over = {}) => ({
  contract: contract(over),
  summary: {
    originalValue: 32465.76,
    approvedChangesValue: 1000,
    revisedValue: 33465.76,
    previousCertified: 0,
    currentCertified: 1200,
    retentionThisPeriod: 60,
    advanceAmount: 3246.58,
    advancePaid: 500,
    cumulativeCertified: 1200,
    remainingToCertify: 32265.76,
    invoiced: 0,
    received: 0,
  },
  current: { id: "ipc-1", period: "P01", totalCert: 1200 },
  periods: [{ id: "ipc-1", period: "P01", totalCert: 1200 }],
});

const secrets = ["32465.76", "33465.76", "32265.76", "3246.58"];

describe("withheldPrimeContract", () => {
  it("hands a BOQ reader every contract exactly as built", () => {
    for (const source of ["boq_fallback", "unestablished", "project_value", "contract_entry", undefined]) {
      const built = contract({ originalValueSource: source });
      expect(withheldPrimeContract(built, BOQ)).toBe(built);
    }
  });

  it("hands everyone an established value exactly as built", () => {
    for (const access of NO_BOQ) {
      for (const source of ["project_value", "contract_entry"]) {
        const built = contract({ originalValueSource: source });
        expect(withheldPrimeContract(built, access)).toBe(built);
      }
    }
  });

  it("leaves the amount out — original, revised, and the advance agreed as a rate of it — for a member without BOQ read, never zero, and says why", () => {
    for (const access of NO_BOQ) {
      for (const [source, reason] of [
        ["boq_fallback", CONTRACT_VALUE_WITHHELD.boq_fallback],
        ["unestablished", CONTRACT_VALUE_WITHHELD.unestablished],
        [null, CONTRACT_VALUE_WITHHELD.unestablished],
      ]) {
        const built = contract({ originalValueSource: source });
        const answer = withheldPrimeContract(built, access);
        const { originalValue, revisedValue, advanceAmount, ...rest } = built;
        expect([originalValue, revisedValue, advanceAmount]).toEqual([32465.76, 33465.76, 3246.58]);
        expect(answer).toEqual({
          ...rest,
          valueWithheld: { keys: ["originalValue", "revisedValue", "advanceAmount"], source: source || "unestablished", reason },
        });
        for (const secret of secrets) expect([secret, JSON.stringify(answer).includes(secret)]).toEqual([secret, false]);
        // The independently authorized figures stay.
        expect(answer).toMatchObject({ approvedChangesValue: 1000, advancePaidAmount: 500, advanceOutstanding: 500, retentionRate: 5 });
        expect(built.originalValue).toBe(32465.76);
      }
    }
  });

  it("keeps an advance agreed with no rate — it is not a share of the value", () => {
    const answer = withheldPrimeContract(contract({ advanceRate: 0, advanceAmount: 777 }), NO_BOQ[0]);
    expect(answer.advanceAmount).toBe(777);
    expect(answer.valueWithheld.keys).toEqual(["originalValue", "revisedValue"]);
  });
});

describe("withheldBillingStatement — the contract value", () => {
  it("hands a BOQ reader the statement exactly as built, and everyone an established one", () => {
    const built = statement();
    expect(withheldBillingStatement(built, BOQ)).toBe(built);
    for (const access of NO_BOQ) {
      const established = statement({ originalValueSource: "project_value" });
      expect(withheldBillingStatement(established, access)).toBe(established);
    }
  });

  it("leaves the amount out of the contract and the summary — original, revised, remaining to certify, the advance agreed — and keeps the rest", () => {
    for (const access of NO_BOQ) {
      const built = statement();
      const answer = withheldBillingStatement(built, access);
      const { originalValue, revisedValue, remainingToCertify, advanceAmount, ...summary } = built.summary;
      expect([originalValue, revisedValue, remainingToCertify, advanceAmount]).toEqual([32465.76, 33465.76, 32265.76, 3246.58]);
      expect(answer.summary).toEqual({
        ...summary,
        valueWithheld: {
          keys: ["originalValue", "revisedValue", "remainingToCertify", "advanceAmount"],
          source: "boq_fallback",
          reason: CONTRACT_VALUE_WITHHELD.boq_fallback,
        },
      });
      expect(answer.contract).toEqual(withheldPrimeContract(built.contract, access));
      expect(answer.current).toBe(built.current);
      expect(answer.periods).toBe(built.periods);
      for (const secret of secrets) expect([secret, JSON.stringify(answer).includes(secret)]).toEqual([secret, false]);
    }
  });
});

describe("withheldAuditHistory — contract.manage events", () => {
  const event = (oldSummary, newSummary, over = {}) => ({
    id: "ev-1",
    entityType: "project",
    recordType: "project",
    actorId: "user-1",
    occurredAt: "2026-09-29T10:00:00.000Z",
    summary: { transition: "contract.manage", ref: "PC-1" },
    oldSummary,
    newSummary,
    ...over,
  });
  const history = (...events) => ({ events, nextCursor: null });

  it("hands a BOQ reader the history exactly as built", () => {
    const built = history(event({ originalValue: 32465.76, originalValueSource: "boq_fallback" }, { originalValue: 32465.76, originalValueSource: "boq_fallback" }));
    expect(withheldAuditHistory(built, BOQ, { contractValueSource: "boq_fallback" })).toBe(built);
  });

  it("leaves out each summary's original value that was not established, and keeps the established ones", () => {
    const save = event({ originalValue: 32465.76, originalValueSource: "boq_fallback", taxRate: 0 }, { originalValue: 32465.76, originalValueSource: "boq_fallback", taxRate: 5 });
    const entry = event({ originalValue: 32465.76, originalValueSource: "boq_fallback" }, { originalValue: 250000, originalValueSource: "contract_entry" }, { id: "ev-2" });
    const later = event({ originalValue: 250000, originalValueSource: "contract_entry" }, { originalValue: 260000, originalValueSource: "contract_entry" }, { id: "ev-3" });
    const other = { id: "ev-4", entityType: "project", recordType: "project", summary: { transition: "archive" }, newSummary: { originalValue: 1 } };
    for (const access of NO_BOQ) {
      const answer = withheldAuditHistory(history(save, entry, later, other), access, { contractValueSource: "contract_entry" });
      expect(answer.events[0]).toEqual({
        ...save,
        oldSummary: { originalValueSource: "boq_fallback", taxRate: 0 },
        newSummary: { originalValueSource: "boq_fallback", taxRate: 5 },
        valueWithheld: { parts: ["oldSummary", "newSummary"], keys: ["originalValue"], reason: CONTRACT_EVENT_VALUE_WITHHELD },
      });
      expect(answer.events[1]).toEqual({
        ...entry,
        oldSummary: { originalValueSource: "boq_fallback" },
        valueWithheld: { parts: ["oldSummary"], keys: ["originalValue"], reason: CONTRACT_EVENT_VALUE_WITHHELD },
      });
      expect(answer.events[2]).toBe(later);
      expect(answer.events[3]).toBe(other);
      expect(JSON.stringify(answer).includes("32465.76")).toBe(false);
    }
  });

  it("takes an event that states no source as a project value only while the contract is project_value now", () => {
    const legacy = event({ originalValue: 9290000, retentionRate: 5 }, { originalValue: 9290000, retentionRate: 5 });
    expect(withheldAuditHistory(history(legacy), NO_BOQ[0], { contractValueSource: "project_value" }).events[0]).toBe(legacy);
    for (const source of ["boq_fallback", "unestablished", "contract_entry", null, undefined]) {
      const answer = withheldAuditHistory(history(legacy), NO_BOQ[0], { contractValueSource: source });
      expect([source, JSON.stringify(answer).includes("9290000")]).toEqual([source, false]);
      expect(answer.events[0].valueWithheld.parts).toEqual(["oldSummary", "newSummary"]);
    }
    // No option passed: not established.
    expect(withheldAuditHistory(history(legacy), NO_BOQ[0]).events[0]).toHaveProperty("valueWithheld");
  });
});
