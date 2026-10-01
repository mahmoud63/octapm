jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const { QUANTITY_ENTRY_BOQ_KEYS, QUANTITY_ENTRY_WITHHELD, withheldQuantityEntries, withheldQuantityEntry, withheldQuantityEntryResult, withheldProgressSubmission, withheldProgressSubmissions, withheldActivity, withheldDailyLog, withheldDailyLogQuantity, withheldAllocatedItems, DAILY_LOG_QUANTITY_WITHHELD, DAILY_LOG_TOTALS_WITHHELD, ALLOCATED_ITEM_WITHHELD, ACTIVITY_QUANTITY_WITHHELD, ACTIVITY_QUANTITY_FIGURE_KEYS } = require("../boq-figures");

// An entry as quantity-progress.service builds it.
const entry = (id) => ({
  id,
  projectId: "p-1",
  activityId: "a-1",
  boqItemId: "item-1",
  allocationId: "al-1",
  locationId: null,
  quantity: 12.5,
  unitCode: "m3",
  date: "2026-09-01",
  source: "daily_log",
  status: "submitted",
  submissionId: null,
  dailyLogId: "log-1",
  provenance: { source: "daily_log", recordedBy: "u-1", recordedAt: "2026-09-01T08:00:00.000Z", dailyLogId: "log-1", official: false, approvedBy: null },
  activity: { id: "a-1", name: "Pour", code: "A100" },
  boqItem: { id: "item-1", code: "1.1", description: "Concrete", unit: "m3", unitCode: "m3" },
  location: null,
  submission: null,
});

const BOQ = { boq: true, budget: true };
const COST = { boq: false, budget: true };

describe("PC-6: a quantity entry for a member who may not read the BOQ (binding BOQ-access rule)", () => {
  it("a BOQ reader receives the entry, the list and the write's answer exactly as built — the same objects", () => {
    const built = entry("e-1");
    const list = [built];
    const result = { entries: list, created: 1, replayed: 0, warnings: [{ code: "QUANTITY_OVER_ALLOCATION", wouldBe: 105 }] };
    expect(withheldQuantityEntry(built, BOQ)).toBe(built);
    expect(withheldQuantityEntries(list, BOQ)).toBe(list);
    expect(withheldQuantityEntryResult(result, BOQ)).toBe(result);
  });

  it("anyone else — a cost reader included — is told the entry exists, its status, date, activity and provenance, and nothing of its figure", () => {
    const given = withheldQuantityEntry(entry("e-1"), COST);
    for (const key of QUANTITY_ENTRY_BOQ_KEYS) expect(given).not.toHaveProperty(key);
    expect(given).toMatchObject({
      id: "e-1",
      activityId: "a-1",
      status: "submitted",
      date: "2026-09-01",
      source: "daily_log",
      provenance: { source: "daily_log", recordedBy: "u-1", official: false },
      activity: { id: "a-1", name: "Pour" },
      boqWithheld: { keys: ["quantity", "unitCode", "boqItemId", "boqItem", "allocationId"], reason: QUANTITY_ENTRY_WITHHELD },
    });
    // Omitted, never zeroed.
    expect(given.quantity).toBeUndefined();
    expect(JSON.stringify(given)).not.toMatch(/12\.5|item-1|al-1|"m3"/);
  });

  it("a list and a write's answer are withheld row by row, and the warnings keep their code and activity only", () => {
    const result = withheldQuantityEntryResult(
      {
        entries: [entry("e-1"), entry("e-2")],
        entry: entry("e-1"),
        created: 2,
        replayed: 0,
        warnings: [{ code: "QUANTITY_OVER_ALLOCATION", entryId: "e-2", activityId: "a-1", boqItemId: "item-1", allocationQuantity: 100, approvedQuantity: 95, entryQuantity: 10, wouldBe: 105, message: "95 + 10 > 100" }],
      },
      COST,
    );
    expect(result.created).toBe(2);
    expect(result.entries.map((row) => row.boqWithheld.keys)).toEqual([QUANTITY_ENTRY_BOQ_KEYS, QUANTITY_ENTRY_BOQ_KEYS]);
    expect(result.entry).not.toHaveProperty("quantity");
    expect(result.warnings).toEqual([{ code: "QUANTITY_OVER_ALLOCATION", entryId: "e-2", activityId: "a-1", boqWithheld: { keys: ["boqItemId", "allocationQuantity", "approvedQuantity", "entryQuantity", "wouldBe", "message"], reason: QUANTITY_ENTRY_WITHHELD } }]);
    expect(JSON.stringify(result)).not.toMatch(/105|item-1|12\.5/);
  });

  it("the delete answer, which carries no figure, passes untouched", () => {
    const deleted = { deleted: true, id: "e-1" };
    expect(withheldQuantityEntryResult(deleted, COST)).toEqual(deleted);
  });
});

describe("PC-6: a progress submission's quantity figures (installed from the entries, planned from the allocations) go to BOQ readers only", () => {
  const submission = {
    id: "s-1",
    activityId: "a-1",
    method: "quantity",
    status: "submitted",
    pctComplete: 37.5,
    quantityComplete: 60,
    quantityPlanned: 160,
    quantityUnit: "m3",
    quantityEntryIds: ["e-1", "e-2"],
    progressSource: { source: "manual", submissionId: "s-1", submittedBy: "u-1", approvedBy: null, entries: 2 },
    quantity: { installed: 60, planned: 160, plannedBasis: "approved_allocations" },
  };

  it("a BOQ reader's submission is the same object", () => {
    expect(withheldProgressSubmission(submission, BOQ)).toBe(submission);
    expect(withheldProgressSubmissions([submission], BOQ)).toEqual([submission]);
  });

  it("a cost reader keeps the percentage, status, method, entry ids and provenance — never a quantity, a unit or the basis block", () => {
    const answer = withheldProgressSubmission(submission, COST);
    for (const key of ["quantityComplete", "quantityPlanned", "quantityUnit", "quantity"]) expect(answer).not.toHaveProperty(key);
    expect(answer).toMatchObject({ pctComplete: 37.5, status: "submitted", method: "quantity", quantityEntryIds: ["e-1", "e-2"], progressSource: { entries: 2 }, boqWithheld: { keys: ["quantityComplete", "quantityPlanned", "quantityUnit", "quantity"], reason: expect.stringMatching(/may read the BOQ/) } });
    expect(withheldProgressSubmissions([submission, null], COST)).toEqual([answer, null]);
    const percent = { id: "s-2", method: "percent", pctComplete: 10, status: "submitted" };
    expect(withheldProgressSubmission(percent, COST)).toBe(percent);
  });

  it("the activity's pendingProgress goes the same way, beside the mapping figures", () => {
    const activity = { id: "a-1", name: "Pour", allocatedBoqQuantity: 160, pctComplete: 0, pendingProgress: submission, progressSource: null };
    const answer = withheldActivity(activity, COST);
    expect(answer).not.toHaveProperty("allocatedBoqQuantity");
    expect(answer.pendingProgress).not.toHaveProperty("quantityPlanned");
    expect(answer.pendingProgress).toMatchObject({ pctComplete: 37.5, boqWithheld: expect.any(Object) });
    expect(withheldActivity(activity, BOQ)).toBe(activity);
  });

  it("the register's quantity figures (PC-6 integration): installed and planned are answered as a withheld marker with the reason — no value, never a zero; pending and bundled entries go through the ledger's rule", () => {
    const entry = { id: "e-1", activityId: "a-1", status: "submitted", date: "2026-09-05", quantity: 15, unitCode: "m3", boqItemId: "item-1", boqItem: { id: "item-1", code: "1.1" }, allocationId: "al-1", provenance: { source: "daily_log", recordedBy: "u-1" } };
    const activity = {
      id: "a-1",
      pctComplete: 75,
      installedQuantity: { installed: [{ boqItemId: "item-1", code: "1.1", description: "Blockwork", unitCode: "m3", quantity: 15, entries: 1 }], asOf: "2026-10-01T00:00:00.000Z", basis: "Σ approved entries" },
      plannedQuantity: { planned: 20, unitCode: "m3", basis: "approved_allocations" },
      pendingQuantityEntries: [entry],
      pendingProgress: { ...submission, quantityEntries: [entry] },
    };
    const answer = withheldActivity(activity, COST);
    for (const key of ACTIVITY_QUANTITY_FIGURE_KEYS) expect(answer[key]).toEqual({ withheld: { reason: ACTIVITY_QUANTITY_WITHHELD } });
    expect(answer.pctComplete).toBe(75);
    for (const row of [answer.pendingQuantityEntries[0], answer.pendingProgress.quantityEntries[0]]) {
      expect(row).toMatchObject({ id: "e-1", status: "submitted", date: "2026-09-05", provenance: { source: "daily_log" }, boqWithheld: { keys: ["quantity", "unitCode", "boqItemId", "boqItem", "allocationId"], reason: QUANTITY_ENTRY_WITHHELD } });
      for (const key of QUANTITY_ENTRY_BOQ_KEYS) expect(row).not.toHaveProperty(key);
    }
    expect(JSON.stringify(answer)).not.toMatch(/"quantity":\s*(15|20)|"planned":\s*20|"1\.1"/);
    // A BOQ reader's activity is the same object; an activity without the figures gains none.
    expect(withheldActivity(activity, BOQ)).toBe(activity);
    expect(withheldActivity({ id: "a-2", pctComplete: 10 }, COST)).toEqual({ id: "a-2", pctComplete: 10 });
  });
});

// ─── PC-6 §4: the daily log's quantities section and the allocated-items picker ───

describe("the daily log's quantities section", () => {
  const row = () => ({
    id: "q-1",
    section: "quantities",
    status: "approved",
    activityId: "a-1",
    activity: { id: "a-1", name: "Pour", code: "A100" },
    boqItemId: "item-1",
    boqItem: { id: "item-1", code: "1.1", description: "Concrete in footings", unit: "m3", unitCode: "m3" },
    allocationId: "al-1",
    locationId: null,
    quantity: 12.5,
    unitCode: "m3",
    notes: "bay 3",
    progressEntry: { id: "e-1", status: "submitted", official: false, source: "daily_log", submissionId: null, recordedBy: "u-1" },
  });
  const log = () => ({ id: "log-1", date: "2026-09-05", status: "submitted", sections: { manpower: [{ id: "mp-1" }], quantities: [row()] }, totals: { quantities: [{ unitCode: "m3", quantity: 12.5, rows: 1 }], entries: 2 } });

  it("a reader who may not read the BOQ keeps the item's description and unit name, the activity, the notes and the entry's state; loses the quantity, its unit code, the item's id and code and the allocation — the ledger's rule", () => {
    const withheld = withheldDailyLogQuantity(row(), COST);
    expect(withheld).toMatchObject({ id: "q-1", boqItem: { description: "Concrete in footings", unit: "m3", unitCode: "m3" }, activity: { name: "Pour" }, notes: "bay 3", progressEntry: { id: "e-1", status: "submitted", official: false } });
    for (const key of ["quantity", "unitCode", "boqItemId", "allocationId"]) expect(withheld).not.toHaveProperty(key);
    for (const key of ["id", "code"]) expect(withheld.boqItem).not.toHaveProperty(key);
    expect(withheld.boqWithheld).toEqual({ keys: ["quantity", "unitCode", "boqItemId", "allocationId", "boqItem.id", "boqItem.code"], reason: DAILY_LOG_QUANTITY_WITHHELD });
    expect(JSON.stringify(withheld)).not.toContain("12.5");
    expect(withheldDailyLogQuantity(row(), BOQ)).toEqual(row());
  });

  it("withheldDailyLog maps the quantities section and withholds the per-unit totals (never zeroed), leaving the other sections and the row count", () => {
    const answer = withheldDailyLog(log(), COST);
    expect(answer.sections.manpower).toEqual([{ id: "mp-1" }]);
    expect(answer.sections.quantities[0].boqWithheld.keys).toEqual(["quantity", "unitCode", "boqItemId", "allocationId", "boqItem.id", "boqItem.code"]);
    expect(answer.totals).toEqual({ entries: 2, boqWithheld: { keys: ["quantities"], reason: DAILY_LOG_TOTALS_WITHHELD } });
    expect(JSON.stringify(answer)).not.toContain("12.5");
    expect(withheldDailyLog(log(), BOQ)).toEqual(log());
    const empty = { id: null, exists: false, sections: { quantities: [] }, totals: { quantityRows: 0, quantities: [] } };
    expect(withheldDailyLog(empty, COST)).toEqual({ ...empty, sections: { quantities: [] }, totals: { quantityRows: 0, boqWithheld: { keys: ["quantities"], reason: DAILY_LOG_TOTALS_WITHHELD } } });
    expect(withheldDailyLog(null, COST)).toBeNull();
  });

  it("the allocated-items picker keeps id, description and unit for every progress reader; code, allocation and allocated quantity for BOQ readers", () => {
    const result = { activityId: "a-1", activity: { id: "a-1", name: "Pour", code: "A100" }, items: [{ id: "item-1", code: "1.1", description: "Concrete in footings", unit: "m3", unitCode: "m3", allocationId: "al-1", allocationIds: ["al-1"], allocatedQuantity: 100 }] };
    const answer = withheldAllocatedItems(result, COST);
    expect(answer.items).toEqual([{ id: "item-1", description: "Concrete in footings", unit: "m3", unitCode: "m3" }]);
    expect(answer.boqWithheld).toEqual({ keys: ["code", "allocationId", "allocationIds", "allocatedQuantity"], reason: ALLOCATED_ITEM_WITHHELD });
    expect(answer.activity).toEqual(result.activity);
    expect(withheldAllocatedItems(result, BOQ)).toBe(result);
  });
});
