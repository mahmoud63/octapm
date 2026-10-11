jest.mock("../../../config/db", () => ({ prisma: { project: { findFirst: jest.fn(async () => ({ name: "Riverside Tower", dataDate: null })) }, activity: { findMany: jest.fn() } } }));
jest.mock("../../../middleware/rbac", () => ({ hasPermission: jest.fn() }));
jest.mock("../../progress.service", () => ({ listProgressSubmissions: jest.fn() }));
jest.mock("../../../utils/boq-figures", () => ({ boqFigureAccess: jest.fn(() => ({ boq: false, budget: false })), withheldProgressSubmissions: jest.fn((rows) => rows), canReadBoq: jest.fn() }));
jest.mock("../../activity-boq-allocation.service", () => ({ getCoverage: jest.fn() }));

const { prisma } = require("../../../config/db");
const { hasPermission } = require("../../../middleware/rbac");
const progressService = require("../../progress.service");
const { withheldProgressSubmissions } = require("../../../utils/boq-figures");
const { moduleSources } = require("../sources/module-sources");

const P = "11111111-1111-4111-8111-111111111111";
const view = { user: { id: "u-1", orgId: "org-1" }, projectAccess: { id: P } };
const TODAY = new Date();

describe("module sources (AI-7)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.activity.findMany.mockResolvedValue([
      { id: "a1", name: "Piling", activityCode: "A1100", startDate: new Date("2026-01-01"), endDate: new Date("2026-02-01"), physComplete: 40, totalFloat: 0, isCritical: true, isMilestone: false },
      { id: "a2", name: "Frame", activityCode: "A1200", startDate: new Date("2026-02-01"), endDate: new Date(TODAY.getTime() + 30 * 86_400_000), physComplete: 100, totalFloat: 5, isCritical: false, isMilestone: false },
    ]);
  });

  test("schedule: none without schedule read; CPM results as stored, the Delayed rule applied", async () => {
    hasPermission.mockReturnValue(false);
    expect(await moduleSources({ view, projectId: P, moduleKey: "schedule" })).toEqual([]);
    expect(prisma.activity.findMany).not.toHaveBeenCalled();

    hasPermission.mockImplementation((_view, moduleName) => moduleName === "schedule");
    const sources = await moduleSources({ view, projectId: P, moduleKey: "schedule", child: "critical" });
    expect(sources[0]).toMatchObject({ type: "schedule_facts" });
    expect(sources[0].text).toMatch(/1 open activities on the critical path/);
    expect(sources[0].text).toMatch(/1 activities delayed/);
    expect(sources[0].text).toMatch(/Delayed \d+ calendar days past finish: A1100 Piling/);
    expect(sources.map((source) => source.id)).toEqual([`${P}:schedule`, "a1"]);
    expect(prisma.activity.findMany.mock.calls[0][0].select.budget).toBeUndefined();
  });

  test("BOQ: nothing for a caller who may not read the BOQ; the coverage summary and its gaps for one who may", async () => {
    const { canReadBoq } = require("../../../utils/boq-figures");
    const allocationService = require("../../activity-boq-allocation.service");
    canReadBoq.mockReturnValue(false);
    expect(await moduleSources({ view, projectId: P, moduleKey: "boq" })).toEqual([]);
    expect(allocationService.getCoverage).not.toHaveBeenCalled();

    canReadBoq.mockReturnValue(true);
    allocationService.getCoverage.mockResolvedValue({
      totalBoqAmount: 1000, activeAllocatedAmount: 600, approvedAllocatedAmount: 500, pendingAllocatedAmount: 100, unallocatedAmount: 400,
      counts: { complete: 1, partial: 1, unmapped: 1, over: 0, notApplicable: 0 },
      items: [
        { boqItemId: "b1", code: "01", description: "Piling", mappingState: "complete", unallocatedAmount: 0, pendingAllocatedAmount: 0, allocationCount: 1 },
        { boqItemId: "b2", code: "02", description: "Frame", mappingState: "partial", unallocatedAmount: 100, pendingAllocatedAmount: 100, allocationCount: 1 },
        { boqItemId: "b3", code: "03", description: "Facade", mappingState: "unmapped", unallocatedAmount: 300, pendingAllocatedAmount: 0, allocationCount: 0 },
      ],
    });
    const sources = await moduleSources({ view, projectId: P, moduleKey: "boq" });
    expect(allocationService.getCoverage).toHaveBeenCalledWith({ orgId: "org-1", projectId: P });
    expect(sources[0].text).toMatch(/3 BOQ rows: 1 fully allocated, 1 partly, 1 unallocated/);
    expect(sources.slice(1).map((source) => source.id)).toEqual(["b3", "b2"]);
  });

  test("official progress is the latest approved submission over a stale stored figure", async () => {
    hasPermission.mockImplementation((_view, moduleName) => moduleName === "progress");
    prisma.activity.findMany.mockResolvedValue([
      { id: "a1", physComplete: 0, progress: [{ pctComplete: 100 }] },
      { id: "a2", physComplete: 0, progress: [] },
      { id: "a3", physComplete: 30, progress: [] },
    ]);
    progressService.listProgressSubmissions.mockResolvedValue([{ id: "s9", activityId: "a2", activity: { name: "Frame" }, status: "submitted", pctComplete: 50, submittedAt: TODAY }]);
    const [facts] = await moduleSources({ view, projectId: P, moduleKey: "schedule", child: "progress" });
    expect(facts.text).toMatch(/OFFICIAL: 3 activities: 1 complete, 1 in progress, 1 not started/);
    expect(facts.text).toMatch(/SUBMITTED \(not official\): Frame — 50% .*official now 0%/);
  });

  test("progress: submitted is never official, drafts are not read, the route's withholding applies", async () => {
    hasPermission.mockImplementation((_view, moduleName) => moduleName === "progress");
    progressService.listProgressSubmissions.mockResolvedValue([
      { id: "s1", activityId: "a1", activity: { name: "Piling", p6ActivityId: "A1100" }, status: "submitted", pctComplete: 60, submittedAt: TODAY },
      { id: "s2", activityId: "a2", activity: { name: "Frame" }, status: "approved", pctComplete: 100, reviewedAt: TODAY },
      { id: "s3", activityId: "a1", activity: { name: "Piling" }, status: "draft", pctComplete: 90, notes: "private draft" },
    ]);
    const sources = await moduleSources({ view, projectId: P, moduleKey: "schedule", child: "progress" });
    expect(progressService.listProgressSubmissions).toHaveBeenCalledWith({ orgId: "org-1", projectId: P });
    expect(withheldProgressSubmissions).toHaveBeenCalled();
    const text = sources[0].text;
    expect(text).toMatch(/SUBMITTED \(not official\): A1100 Piling — 60% submitted .*; official now 40%/);
    expect(text).toMatch(/APPROVED \(official\): Frame — 100%/);
    expect(JSON.stringify(sources)).not.toMatch(/private draft|90%/);
    expect(sources[1]).toMatchObject({ id: "s1", status: "submitted" });
    // The official figure is the latest APPROVED submission (as the product reads it), not a stale stored %.
    expect(prisma.activity.findMany.mock.calls[0][0].select.progress).toEqual({ where: { status: "approved" }, orderBy: { updatedAt: "desc" }, take: 1, select: { pctComplete: true } });

    hasPermission.mockReturnValue(false);
    progressService.listProgressSubmissions.mockClear();
    expect(await moduleSources({ view, projectId: P, moduleKey: "schedule", child: "progress" })).toEqual([]);
    expect(progressService.listProgressSubmissions).not.toHaveBeenCalled();
  });
});
