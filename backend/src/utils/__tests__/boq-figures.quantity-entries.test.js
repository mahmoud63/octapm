jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const { QUANTITY_ENTRY_BOQ_KEYS, QUANTITY_ENTRY_WITHHELD, withheldQuantityEntries, withheldQuantityEntry, withheldQuantityEntryResult, withheldProgressSubmission, withheldProgressSubmissions, withheldActivity } = require("../boq-figures");

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
});
