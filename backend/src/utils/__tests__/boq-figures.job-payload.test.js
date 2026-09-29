jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const { JOB_BILL_WITHHELD, withheldJob } = require("../boq-figures");

// A schedule.generate job as jobs/job.service serializeJob builds it: its
// input is the uploaded bill (rawText), which Pass 1 structures.
const generationJob = () => ({
  id: "job-1",
  type: "schedule.generate",
  status: "queued",
  payload: {
    label: "Rev B",
    userId: "user-1",
    fileName: "bill.csv",
    rawText: ["Item | Description | Qty | Unit | Rate | Amount", "1.1 | Concrete | 100 | m3 | 213.37 | 21337.00"].join("\n"),
  },
  progress: { step: "Structuring BOQ" },
});

describe("withheldJob (§12)", () => {
  it("hands a BOQ reader the job exactly as built", () => {
    const built = generationJob();
    expect(withheldJob(built, { boq: true, budget: true })).toBe(built);
  });

  it("leaves the uploaded bill out of a schedule.generate job's input for a member without BOQ read, cost readers included, and says so", () => {
    for (const access of [{ boq: false, budget: true }, { boq: false, budget: false }]) {
      const built = generationJob();
      const answer = withheldJob(built, access);
      expect(answer).toEqual({
        ...generationJob(),
        payload: { label: "Rev B", userId: "user-1", fileName: "bill.csv" },
        payloadWithheld: { keys: ["rawText"], reason: JOB_BILL_WITHHELD },
      });
      expect(JSON.stringify(answer)).not.toContain("213.37");
      // Output only: the serialized job is not touched.
      expect(built.payload.rawText).toContain("21337.00");
    }
  });

  it("takes the BOQ reader's view when no access is passed, as every withheld* helper does — the route always passes the caller's", () => {
    expect(withheldJob(generationJob()).payload).toHaveProperty("rawText");
    expect(withheldJob(generationJob(), undefined).payload).toHaveProperty("rawText");
    expect(withheldJob(generationJob(), { boq: false, budget: false }).payload).not.toHaveProperty("rawText");
  });

  it("returns every job whose input carries no bill untouched", () => {
    const others = [
      { id: "j2", type: "schedule.import", payload: { fileName: "p6.xer" } },
      { id: "j3", type: "report.render", payload: { rawText: "not a bill" } },
      { id: "j4", type: "schedule.generate", payload: { label: "no text" } },
      { id: "j5", type: "schedule.generate", payload: null },
      null,
    ];
    for (const job of others) expect(withheldJob(job, { boq: false, budget: false })).toBe(job);
  });
});
