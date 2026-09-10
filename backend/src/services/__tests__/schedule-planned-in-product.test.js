/**
 * A schedule planned inside OctaPM, one activity at a time, must be visible.
 *
 * `getProjectSchedule` returned `null` whenever the project had no
 * ScheduleRevision — and a revision is only ever written by a P6/MSP import or
 * an AI generation, never by `POST /projects/:id/activities`. A project
 * planned in the product therefore had fourteen activities with their CPM
 * computed and stored, and every screen that reads the schedule reported an
 * empty project: the Gantt and the critical path fell back to the upload
 * prompt, the module bar said "Activities (0)", the cost dashboard did not
 * render at all, and site reporting was handed an empty activity list
 * (OCTA-SCHED-GREENFIELD-121, found by the Phase 21 greenfield simulation).
 *
 * The revision is a record of where a schedule came from. It is not the
 * source of truth for what is on the programme — the activities are — so when
 * there is no revision to read, one is derived from them.
 */

const mockPrisma = {
  project: { findFirst: jest.fn() },
  activity: { findMany: jest.fn() },
  scheduleRevision: { findFirst: jest.fn() },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../activity-boq-allocation.service", () => ({
  buildAllocationSummary: jest.fn(async () => ({
    approvedAllocatedAmount: 0,
    unallocatedAmount: 0,
  })),
  getApprovedActivityAllocationTotals: jest.fn(async () => new Map()),
  assertAllocationCapacity: jest.fn(),
  computeDefaultWeight: jest.fn(),
}));

const scheduleService = require("../schedule.service");

const PROJECT = {
  id: "proj-1",
  orgId: "org-1",
  name: "Greenfield Tower",
  startDate: new Date("2027-01-04"),
  endDate: new Date("2027-12-17"),
  dataDate: null,
  createdAt: new Date("2027-01-01"),
};

/** Two activities on the critical path, one milestone, one with float. */
const activity = (over = {}) => ({
  id: "act-1",
  projectId: PROJECT.id,
  name: "Bulk excavation",
  activityCode: "A110",
  wbsCode: "1 Substructure",
  p6ActivityId: null,
  duration: 10,
  earlyStart: 5,
  earlyFinish: 15,
  lateStart: 5,
  lateFinish: 15,
  totalFloat: 0,
  isCritical: true,
  isMilestone: false,
  isActive: true,
  budget: null,
  progress: [],
  predecessorLinks: [],
  successorLinks: [],
  assignedEngineers: [],
  ...over,
});

const ACTIVITIES = [
  activity(),
  activity({ id: "act-2", activityCode: "A120", name: "Blinding", earlyStart: 15, earlyFinish: 18 }),
  activity({
    id: "act-3",
    activityCode: "A140",
    name: "Backfill",
    totalFloat: 6,
    isCritical: false,
  }),
  activity({
    id: "act-4",
    activityCode: "M900",
    name: "Practical completion",
    duration: 0,
    isMilestone: true,
  }),
];

beforeEach(() => {
  mockPrisma.project.findFirst.mockResolvedValue(PROJECT);
  mockPrisma.activity.findMany.mockResolvedValue(ACTIVITIES);
  // No revision: nothing was imported and nothing was AI-generated.
  mockPrisma.scheduleRevision.findFirst.mockResolvedValue(null);
});

describe("a schedule planned in the product, with no revision behind it", () => {
  it("is returned rather than reported as no schedule at all", async () => {
    const schedule = await scheduleService.getProjectSchedule({
      orgId: PROJECT.orgId,
      projectId: PROJECT.id,
    });

    expect(schedule).not.toBeNull();
    expect(schedule.activities).toHaveLength(4);
  });

  it("counts the activities that exist, not the ones a revision remembered", async () => {
    const schedule = await scheduleService.getProjectSchedule({
      orgId: PROJECT.orgId,
      projectId: PROJECT.id,
    });

    // This is the number the module bar shows: it said "Activities (0)".
    expect(schedule.revision.activityCount).toBe(4);
    expect(schedule.revision.criticalCount).toBe(3);
  });

  it("carries the project's own dates so the Gantt has a window to draw in", async () => {
    const schedule = await scheduleService.getProjectSchedule({
      orgId: PROJECT.orgId,
      projectId: PROJECT.id,
    });

    expect(schedule.revision.projectSummary).toMatchObject({
      startDate: PROJECT.startDate,
      endDate: PROJECT.endDate,
    });
  });

  it("names the critical path and the milestones from the activities", async () => {
    const schedule = await scheduleService.getProjectSchedule({
      orgId: PROJECT.orgId,
      projectId: PROJECT.id,
    });

    expect(schedule.revision.criticalPath).toEqual(
      expect.arrayContaining(["A110", "A120", "M900"]),
    );
    expect(schedule.revision.criticalPath).not.toContain("A140");
    expect(schedule.revision.milestones.map((m) => m.activityCode)).toEqual(["M900"]);
  });

  it("says the schedule was planned here rather than imported", async () => {
    const schedule = await scheduleService.getProjectSchedule({
      orgId: PROJECT.orgId,
      projectId: PROJECT.id,
    });

    expect(schedule.revision.source).toBe("in_product");
    // There is no stored revision, so there is no id to point an audit trail at.
    expect(schedule.revision.id).toBeNull();
  });

  it("still reports nothing for a project that genuinely has no activities", async () => {
    mockPrisma.activity.findMany.mockResolvedValue([]);

    const schedule = await scheduleService.getProjectSchedule({
      orgId: PROJECT.orgId,
      projectId: PROJECT.id,
    });

    expect(schedule).toBeNull();
  });
});

describe("a schedule that was imported", () => {
  it("keeps the totals the import recorded", async () => {
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue({
      id: "rev-1",
      projectId: PROJECT.id,
      label: "Rev 2 - P6 import",
      activityCount: 999,
      criticalCount: 42,
      totalBudget: 1234,
      source: "p6_import",
      isActive: true,
      status: "baselined",
      snapshotJson: { criticalPath: ["FROM-SNAPSHOT"], milestones: [] },
      createdAt: new Date("2027-02-01"),
    });

    const schedule = await scheduleService.getProjectSchedule({
      orgId: PROJECT.orgId,
      projectId: PROJECT.id,
    });

    expect(schedule.revision.id).toBe("rev-1");
    expect(schedule.revision.activityCount).toBe(999);
    expect(schedule.revision.criticalPath).toEqual(["FROM-SNAPSHOT"]);
    expect(schedule.revision.source).toBe("p6_import");
  });
});
