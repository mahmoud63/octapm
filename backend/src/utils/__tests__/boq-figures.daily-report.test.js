jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const { PROGRESS_SUBMISSION_WITHHELD, withheldDailyReport, withheldDailyReports } = require("../boq-figures");

// A daily report as daily-report.service serialises it: its linked
// submissions are progressService.serializeSubmission rows, whole.
const report = (id) => ({
  id,
  activityId: "a-1",
  status: "submitted",
  pctProgress: 0,
  materials: [{ name: "Cement", qty: 20, unit: "bags" }],
  activity: { id: "a-1", name: "Pour", wbsCode: "1.1", p6ActivityId: "A100" },
  progressSubmissions: [
    {
      id: `s-${id}`,
      method: "quantity",
      pctComplete: 9.25,
      status: "submitted",
      source: "daily_report",
      quantityComplete: 37,
      quantityPlanned: 400,
      quantityUnit: "m3",
      quantity: { plannedBasis: "approved_allocations", installedBasis: "client" },
      quantityEntries: [{ id: "e-1", quantity: 37, unitCode: "m3", boqItemId: "item-1", allocationId: "al-1", status: "submitted" }],
    },
  ],
  equipmentUsagePostings: [],
});

const BOQ = { boq: true, budget: true };
const COST = { boq: false, budget: true };

describe("the legacy daily report for a member who may not read the BOQ (binding BOQ-access rule)", () => {
  it("a BOQ reader's report is the same object", () => {
    const row = report("r-1");
    expect(withheldDailyReport(row, BOQ)).toBe(row);
    const list = [row];
    expect(withheldDailyReports(list, BOQ)).toBe(list);
  });

  it("each linked submission loses its typed, planned and unit figures and its basis; percentage, method, status and source stay; the report's own lines stay", () => {
    const out = withheldDailyReport(report("r-1"), COST);
    const [submission] = out.progressSubmissions;
    expect(submission).toEqual({
      id: "s-r-1",
      method: "quantity",
      pctComplete: 9.25,
      status: "submitted",
      source: "daily_report",
      quantityEntries: [{ id: "e-1", status: "submitted", boqWithheld: expect.any(Object) }],
      boqWithheld: { keys: ["quantityComplete", "quantityPlanned", "quantityUnit", "quantity"], reason: PROGRESS_SUBMISSION_WITHHELD },
    });
    expect(out.materials).toEqual([{ name: "Cement", qty: 20, unit: "bags" }]);
    expect(out.activity).toEqual({ id: "a-1", name: "Pour", wbsCode: "1.1", p6ActivityId: "A100" });
  });

  it("the list withholds every report; a report with no submission and nothing at all pass through", () => {
    const out = withheldDailyReports([report("r-1"), report("r-2")], COST);
    expect(out.map((row) => row.progressSubmissions[0].quantityComplete)).toEqual([undefined, undefined]);
    expect(JSON.stringify(out)).not.toMatch(/"(quantityComplete|quantityPlanned|quantityUnit)":/);
    const empty = { id: "r-3", progressSubmissions: [] };
    expect(withheldDailyReport(empty, COST)).toEqual(empty);
    expect(withheldDailyReport(null, COST)).toBeNull();
  });
});
