const mockPrisma = {
  project: { findFirst: jest.fn() },
  boqItem: { findMany: jest.fn() },
  activity: { findMany: jest.fn() },
  scheduleRevision: { findFirst: jest.fn() },
  costRecord: { count: jest.fn() },
  activityCostLoading: { count: jest.fn() },
  reportingPeriod: { count: jest.fn() },
  organisation: { findUnique: jest.fn() },
  wbsNode: { findMany: jest.fn() },
  location: { findMany: jest.fn() },
  projectCostCode: { count: jest.fn() },
  boqRevision: { findMany: jest.fn() },
  activityBoqAllocation: { findMany: jest.fn() },
  approvalWorkflowEvent: { findMany: jest.fn() },
  organizationMembership: { findMany: jest.fn() },
};

const mockBuildAllocationSummary = jest.fn();
const mockBuildScheduleReadiness = jest.fn();
// A staged revision is judged on its own snapshot (none of it is active).
const mockBuildReadinessActivitiesFromSnapshot = jest.fn(() => []);

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../activity-boq-allocation.service", () => ({
  buildAllocationSummary: mockBuildAllocationSummary,
}));
jest.mock("../schedule.service", () => ({
  buildScheduleReadiness: mockBuildScheduleReadiness,
  buildReadinessActivitiesFromSnapshot: mockBuildReadinessActivitiesFromSnapshot,
}));

const setupReadinessService = require("../project-setup-readiness.service");

const project = {
  id: "project-1",
  orgId: "org-1",
  name: "Tower",
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2026-12-31T00:00:00.000Z"),
  duration: 12,
  contractValue: 100,
  clientName: "Client",
  contractorName: "Contractor",
};

const emptyAllocationSummary = {
  totalBoqAmount: 0,
  approvedAllocatedAmount: 0,
  pendingAllocatedAmount: 0,
  unallocatedAmount: 0,
};

describe("project setup readiness service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue(project);
    mockPrisma.boqItem.findMany.mockResolvedValue([]);
    mockBuildAllocationSummary.mockResolvedValue(emptyAllocationSummary);
    mockPrisma.activity.findMany.mockResolvedValue([]);
    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockPrisma.costRecord.count.mockResolvedValue(0);
    mockPrisma.activityCostLoading.count.mockResolvedValue(0);
    mockPrisma.reportingPeriod.count.mockResolvedValue(0);
    mockPrisma.organisation.findUnique.mockResolvedValue({ id: "org-1", slug: "acme" });
    mockPrisma.wbsNode.findMany.mockResolvedValue([]);
    mockPrisma.location.findMany.mockResolvedValue([]);
    mockPrisma.projectCostCode.count.mockResolvedValue(0);
    mockPrisma.boqRevision.findMany.mockResolvedValue([]);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([]);
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValue([]);
    mockPrisma.organizationMembership.findMany.mockResolvedValue([]);
    mockBuildScheduleReadiness.mockReturnValue({
      ready: true,
      blockingCount: 0,
      checks: [],
    });
  });

  // A project with its structure in place and its bill approved: what the
  // "everything complete" scenario below builds on.
  const structureInPlace = () => {
    mockPrisma.wbsNode.findMany.mockResolvedValue([
      { id: "wbs-1", code: "A", name: "Substructure" },
    ]);
    mockPrisma.location.findMany.mockResolvedValue([
      { id: "loc-1", code: "B1", name: "Block 1", path: "loc-1" },
    ]);
    mockPrisma.projectCostCode.count.mockResolvedValue(3);
    mockPrisma.boqRevision.findMany.mockResolvedValue([
      {
        id: "boq-rev-1",
        revisionNumber: 1,
        label: "Tender bill",
        status: "approved",
        baselineLocked: false,
        lockedAt: null,
        itemCount: 1,
        totalAmount: 100,
        createdAt: new Date("2026-01-10T00:00:00.000Z"),
      },
    ]);
  };
  const filedBoqItem = {
    id: "boq-1",
    code: "1.1",
    description: "Concrete",
    qty: 10,
    amount: 100,
    unit: "m3",
    unitCode: "M3",
    wbsNodeId: "wbs-1",
    locationId: "loc-1",
    costCodeId: "cc-1",
    mappingRule: "required",
  };

  it("surfaces critical blockers for an empty project", async () => {
    const result = await setupReadinessService.getSetupReadiness({
      orgId: "org-1",
      projectId: "project-1",
    });

    expect(result.rulesetVersion).toBe("fb-015-v2");
    expect(result.summary.readyForProgress).toBe(false);
    expect(result.summary.readyForReporting).toBe(false);
    expect(result.summary.blockedSteps).toBeGreaterThan(0);
    expect(result.gates.progress.ready).toBe(false);
    expect(result.gates.reporting.ready).toBe(false);
    expect(result.steps.find((step) => step.key === "boq_upload")).toEqual(
      expect.objectContaining({
        status: "blocked",
        blockers: expect.arrayContaining([
          expect.objectContaining({ code: "NO_BOQ" }),
        ]),
      }),
    );
    expect(
      result.gates.progress.blockers.map((blocker) => blocker.code),
    ).toEqual(
      expect.arrayContaining([
        "NO_BOQ",
        "NO_SCHEDULE",
        "NO_SCHEDULE_REVISION",
        "BASELINE_NOT_LOCKED",
      ]),
    );
    expect(
      result.gates.reporting.blockers.map((blocker) => blocker.code),
    ).toEqual(
      expect.arrayContaining([
        "NO_BOQ",
        "NO_SCHEDULE",
        "NO_APPROVED_COST_LOADING",
        "NO_REPORTING_PERIODS",
      ]),
    );
    expect(result.gates.reporting.blockers[0]).toEqual(
      expect.objectContaining({
        target: expect.objectContaining({ module: expect.any(String) }),
      }),
    );
    expect(mockBuildScheduleReadiness).not.toHaveBeenCalled();

    // The §89 sequence: structure between the profile and the upload, the
    // bill's approval right after the upload (PC-4). Both are advisory.
    expect(result.steps.map((step) => step.key).slice(0, 5)).toEqual([
      "project_profile",
      "structure_setup",
      "boq_upload",
      "boq_approval",
      "schedule_generation",
    ]);
    expect(result.summary.totalSteps).toBe(12);
    const structure = result.steps.find((step) => step.key === "structure_setup");
    expect(structure.requiredFor).toEqual([]);
    expect(structure.status).toBe("attention");
    expect(structure.warnings.map((warning) => warning.code)).toEqual([
      "NO_WBS",
      "NO_LOCATIONS",
      "NO_PROJECT_COST_CODES",
    ]);
    expect(structure.warnings[0].items[0].href).toBe(
      "/o/acme/projects/project-1/controls/structure",
    );
    expect(result.steps.find((step) => step.key === "boq_approval").status).toBe("pending");
    expect(result.structure).toEqual({
      wbsNodes: 0,
      locations: 0,
      projectCostCodes: 0,
      unitsUnresolved: 0,
    });
    // Every issue carries its per-item detail, even when the record is the project.
    expect(result.gates.progress.blockers[0]).toEqual(
      expect.objectContaining({ items: expect.any(Array), count: expect.any(Number) }),
    );
    // The structure step guides six things (§21), each pointing at where it
    // is done; the ones that need the bill or the schedule first are pending.
    expect(structure.guides.map((guide) => [guide.key, guide.status])).toEqual([
      ["wbs", "attention"],
      ["locations", "attention"],
      ["cost_codes", "attention"],
      ["boq_structure", "pending"],
      ["schedule_structure", "pending"],
      ["mapping_readiness", "pending"],
    ]);
    expect(structure.guides[1].href).toBe("/o/acme/projects/project-1/locations");
    expect(result.steps.filter((step) => step.guides).map((step) => step.key)).toEqual([
      "structure_setup",
    ]);
    // The §33 headline reads left to right as the checks fall.
    expect(result.summary.headline.map((entry) => `${entry.label} ${entry.value}`)).toEqual([
      "BOQ imported FAIL",
      // No schedule at all (R5-4): said as that, not as a failed import.
      "Schedule No schedule yet",
      "Mapping 0%",
      "Unmapped BOQ quantity 0",
      "Unmapped BOQ value 0",
      // Nothing assessed yet: no count, never "0".
      "Critical unmapped activities Waiting for active schedule",
      "Baseline NOT APPROVED",
      "Cost loading INCOMPLETE",
    ]);
    expect(result.summary.headline[0].tone).toBe("blocked");
    expect(result.summary.scheduleState).toBe("none");
    expect(mockPrisma.approvalWorkflowEvent.findMany).not.toHaveBeenCalled();
  });

  it("names the offending rows with a link to fix them, and warns about the bill's approval without blocking", async () => {
    structureInPlace();
    mockPrisma.boqRevision.findMany.mockResolvedValue([
      {
        id: "boq-rev-2",
        revisionNumber: 2,
        label: null,
        source: "upload",
        status: "imported",
        baselineLocked: false,
        lockedAt: null,
        itemCount: 2,
        addedCount: 1,
        updatedCount: 1,
        removedCount: 0,
        unchangedCount: 0,
        blockedCount: 1,
        totalAmount: 300,
        compareJson: {
          // As PC-2 writes a row it could not apply: the machine code and
          // the sentence a person reads.
          blocked: [
            {
              code: "1.3",
              description: "Blinding",
              reason: "DUPLICATE_BOQ_ITEM_CODE",
              message: 'BOQ item code "1.3" belongs to a hand-entered row',
            },
          ],
        },
        createdAt: new Date("2026-01-12T00:00:00.000Z"),
      },
    ]);
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValue([
      {
        id: "event-1",
        action: "submit",
        fromStatus: "imported",
        toStatus: "under_review",
        actorId: "user-qs",
        actorRole: "qs",
        decision: null,
        reason: null,
        comment: "Please review",
        createdAt: new Date("2026-01-13T00:00:00.000Z"),
      },
    ]);
    mockPrisma.organizationMembership.findMany.mockResolvedValue([
      { userId: "user-qs", user: { name: "Quinn Surveyor" } },
    ]);
    mockPrisma.boqItem.findMany.mockResolvedValue([
      filedBoqItem,
      {
        id: "boq-2",
        code: "1.2",
        description: "Rebar",
        qty: 5,
        amount: 200,
        unit: "tonnes-ish",
        unitCode: null,
        wbsNodeId: null,
        locationId: null,
        costCodeId: null,
        mappingRule: "",
      },
    ]);
    mockBuildAllocationSummary.mockResolvedValue({
      totalBoqAmount: 300,
      approvedAllocatedAmount: 0,
      pendingAllocatedAmount: 0,
      unallocatedAmount: 300,
      items: [
        { boqItemId: "boq-1", code: "1.1", description: "Concrete", mappingRule: "required", unallocatedQuantity: 10, unallocatedAmount: 100 },
        { boqItemId: "boq-2", code: "1.2", description: "Rebar", mappingRule: "required", unallocatedQuantity: 5, unallocatedAmount: 200 },
      ],
    });
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: "activity-1",
        name: "Foundations",
        activityCode: "A100",
        wbsNodeId: null,
        calendarId: "1",
        isMilestone: false,
        isCritical: true,
        assignments: [],
        progressMethod: null,
        predecessorLinks: [],
      },
    ]);

    const result = await setupReadinessService.getSetupReadiness({
      orgId: "org-1",
      projectId: "project-1",
    });

    // PC-4's filing and matching checks are advisories (default b): the
    // original step completes as the base derived it, and what is filed
    // under what is reported on the Structure step.
    const boqUpload = result.steps.find((step) => step.key === "boq_upload");
    expect(boqUpload.status).toBe("complete");
    expect(boqUpload.warnings).toEqual([]);
    expect(boqUpload.advisories.map((advisory) => advisory.code)).toEqual(["BOQ_UNIT_UNRESOLVED"]);
    const structureStep = result.steps.find((step) => step.key === "structure_setup");
    expect(structureStep.advisories.map((advisory) => advisory.code)).toEqual([
      "BOQ_ITEMS_WITHOUT_WBS",
      "ACTIVITIES_WITHOUT_WBS",
      "BOQ_ITEMS_WITHOUT_COST_CODE",
    ]);
    expect(structureStep.advisories.every((advisory) => advisory.severity === "advisory")).toBe(true);
    expect(structureStep.advisories[0]).toEqual(
      expect.objectContaining({
        count: 1,
        items: [
          {
            type: "boq_item",
            id: "boq-2",
            code: "1.2",
            label: "Rebar",
            missing: "WBS node",
            // No page files a BOQ row under a WBS node yet: named, not linked.
            href: null,
          },
        ],
      }),
    );
    expect(structureStep.advisories[0].message).toContain("it comes with the BOQ item detail");
    expect(structureStep.advisories[2].items.every((item) => item.href === null)).toBe(true);

    const approval = result.steps.find((step) => step.key === "boq_approval");
    expect(approval.status).toBe("attention");
    expect(approval.blockers).toEqual([]);
    expect(approval.warnings.map((warning) => warning.code)).toEqual([
      "BOQ_REVISION_NOT_APPROVED",
      "BOQ_MAPPING_RULE_UNSET",
    ]);
    expect(approval.warnings[0].items[0]).toEqual(
      expect.objectContaining({ type: "boq_revision", id: "boq-rev-2", code: "Rev 2" }),
    );
    expect(approval.warnings[1].items[0].id).toBe("boq-2");
    // The revision's own record (§22): changes, the rows it could not apply,
    // and its review trail with the actor named through the membership.
    expect(result.context.boqRevision).toMatchObject({
      id: "boq-rev-2",
      source: "upload",
      changes: { added: 1, updated: 1, removed: 0, unchanged: 0, blocked: 1 },
      validation: {
        blockedCount: 1,
        blocked: [
          {
            code: "1.3",
            description: "Blinding",
            reason: "DUPLICATE_BOQ_ITEM_CODE",
            message: 'BOQ item code "1.3" belongs to a hand-entered row',
          },
        ],
      },
      history: [
        expect.objectContaining({
          action: "submit",
          toStatus: "under_review",
          actorName: "Quinn Surveyor",
          at: "2026-01-13T00:00:00.000Z",
        }),
      ],
    });
    expect(mockPrisma.organizationMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "org-1", userId: { in: ["user-qs"] } } }),
    );
    expect(approval.counts).toMatchObject({ revisionItems: 2, revisionChanges: 2, revisionBlockedRows: 1 });
    // The gates do not know the new steps: nothing soft became hard.
    expect(result.gates.baseline.blockers.map((b) => b.code)).not.toContain(
      "BOQ_REVISION_NOT_APPROVED",
    );

    const structure = result.steps.find((step) => step.key === "structure_setup");
    expect(structure.warnings.map((warning) => warning.code)).toEqual(["UOM_UNRESOLVED"]);
    expect(structure.warnings[0].items[0]).toEqual(
      expect.objectContaining({ type: "unit", code: "tonnes-ish" }),
    );

    const schedule = result.steps.find((step) => step.key === "schedule_generation");
    expect(schedule.warnings).toEqual([]);
    expect(schedule.advisories.map((advisory) => advisory.code)).toEqual(["IMPORTED_CALENDAR_UNMAPPED"]);
    expect(schedule.advisories[0].items[0]).toEqual(
      expect.objectContaining({
        type: "activity",
        id: "activity-1",
        code: "A100",
        href: "/o/acme/projects/project-1/activities?recordId=activity-1&source=activity",
      }),
    );

    const allocation = result.steps.find((step) => step.key === "boq_allocation");
    const unallocated = allocation.blockers.find((b) => b.code === "UNALLOCATED_BOQ");
    expect(unallocated.count).toBe(2);
    expect(unallocated.items.map((item) => item.id)).toEqual(["boq-1", "boq-2"]);
    expect(unallocated.items[0].href).toBe(
      "/o/acme/projects/project-1/controls/mapping?recordId=boq-1&source=boq_item",
    );
    expect(result.coverage).toEqual(
      expect.objectContaining({ totalBoqAmount: 300, unallocatedAmount: 300 }),
    );
    expect(result.coverage.items).toBeUndefined();
    // The critical activity has no approved allocation: the headline says so,
    // and the structure guides name what is still to file.
    expect(result.summary.criticalUnmappedActivities).toBe(1);
    expect(result.summary.scheduleState).toBe("active");
    expect(result.summary.headline.map((entry) => `${entry.label} ${entry.value}`)).toEqual([
      "BOQ imported PASS",
      // Activities without a revision count as a schedule, as the step says.
      "Schedule imported PASS",
      "Mapping 0%",
      // By unit, never added across units; the unit leaving most value open first.
      "Unmapped BOQ quantity 5 tonnes-ish · 10 m3",
      "Unmapped BOQ value 300",
      "Critical unmapped activities 1",
      "Baseline NOT APPROVED",
      "Cost loading INCOMPLETE",
    ]);
    expect(result.summary.headline.find((entry) => entry.key === "mapping").tone).toBe("blocked");
    const structureGuides = result.steps.find((step) => step.key === "structure_setup").guides;
    expect(structureGuides.find((guide) => guide.key === "boq_structure")).toMatchObject({
      status: "attention",
      count: 2,
      detail: "1 row without a WBS node (filing comes with the BOQ item detail) · 1 with an unknown unit",
      href: "/o/acme/projects/project-1/boq",
    });
    expect(structureGuides.find((guide) => guide.key === "schedule_structure")).toMatchObject({
      status: "attention",
      count: 2,
      detail: "1 activity without a WBS node · 1 on an unmapped calendar",
    });
    expect(structureGuides.find((guide) => guide.key === "mapping_readiness")).toMatchObject({
      status: "attention",
      detail: "0% covered · 1 row without a rule · 2 required rows open",
      href: "/o/acme/projects/project-1/controls/mapping",
    });

    // A member who may not read the BOQ gets the same steps, statuses,
    // codes and gates — and none of the bill's rows, values, quantities or
    // review trail, nor how many rows or allocations a mapping issue
    // concerns (owner decision C), nor how many BOQ rows a filing or unit
    // issue concerns (the owner's rule on BOQ-derived counts). Every other
    // issue keeps its count.
    const restricted = await setupReadinessService.getSetupReadiness({
      orgId: "org-1",
      projectId: "project-1",
      canReadBoq: false,
    });
    const MAPPING_CODES = new Set([
      "BOQ_MAPPING_RULE_UNSET",
      "NO_APPROVED_ALLOCATIONS",
      "UNALLOCATED_BOQ",
      "OPTIONAL_UNALLOCATED",
      "PENDING_ALLOCATIONS",
      "SUGGESTIONS_PENDING",
      "UNIT_MISMATCH_COUNT",
      "LOCATION_MISMATCH_COUNT",
      // BOQ row counts.
      "BOQ_ITEMS_WITHOUT_WBS",
      "BOQ_ITEMS_WITHOUT_COST_CODE",
      "BOQ_UNIT_UNRESOLVED",
      "UOM_UNRESOLVED",
    ]);
    const shape = (readiness, { mappingCounts = true } = {}) => {
      const entry = (issue) => [issue.code, !mappingCounts && MAPPING_CODES.has(issue.code) ? undefined : issue.count];
      return readiness.steps.map((step) => [
        step.key,
        step.status,
        step.blockers.map(entry),
        step.warnings.map(entry),
        step.advisories.map(entry),
      ]);
    };
    expect(shape(restricted)).toEqual(shape(result, { mappingCounts: false }));
    // ... and the full answer does count them, so the omission is real.
    expect(result.steps.find((step) => step.key === "boq_approval").warnings.find((w) => w.code === "BOQ_MAPPING_RULE_UNSET").count).toBe(1);
    for (const name of ["baseline", "progress", "reporting"]) {
      expect(restricted.gates[name].ready).toBe(result.gates[name].ready);
      expect(restricted.gates[name].blockers.map((b) => b.code)).toEqual(
        result.gates[name].blockers.map((b) => b.code),
      );
    }
    expect(restricted.summary.nextAction).toEqual(result.summary.nextAction);
    const restrictedIssues = restricted.steps.flatMap((step) => [...step.blockers, ...step.warnings, ...step.advisories]);
    for (const issue of restrictedIssues) {
      for (const item of issue.items) {
        expect(["boq_item", "allocation", "boq_revision", "unit"]).not.toContain(item.type);
      }
    }
    const restrictedUnallocated = restricted.steps
      .find((step) => step.key === "boq_allocation")
      .blockers.find((b) => b.code === "UNALLOCATED_BOQ");
    expect(restrictedUnallocated).toMatchObject({ items: [], itemsWithheld: true, mappingDetailsWithheld: true });
    expect(restrictedUnallocated).not.toHaveProperty("count");
    const restrictedRuleUnset = restricted.steps
      .find((step) => step.key === "boq_approval")
      .warnings.find((w) => w.code === "BOQ_MAPPING_RULE_UNSET");
    expect(restrictedRuleUnset.message).toBe("Some BOQ rows have no mapping rule (required, optional or not applicable).");
    expect(restrictedRuleUnset.details).toEqual({});
    expect(restricted.steps.find((step) => step.key === "boq_approval").counts).not.toHaveProperty("itemsWithoutMappingRule");
    // Activities are not the bill's: they are still named.
    expect(
      restricted.steps.find((step) => step.key === "schedule_generation").advisories[0].items[0].id,
    ).toBe("activity-1");
    // No share (rounded or not) and no row counts: the coverage is withheld.
    expect(restricted.coverage).toEqual({ withheld: true, reason: "Mapping details unavailable to you" });
    expect(restricted.summary.headline.find((entry) => entry.key === "mapping")).toEqual({
      key: "mapping",
      label: "Mapping",
      value: "—",
      tone: "neutral",
      raw: null,
      withheld: true,
      reason: "Mapping details unavailable to you",
    });
    // Nor how many critical activities have no approved allocation (owner
    // decision, 2026-09-28): the reader's 1 is neither in the summary nor in
    // the headline, whose entry says why — no count and no tone. The
    // critical activities themselves (the schedule step's count) stay.
    expect(restricted.summary).not.toHaveProperty("criticalUnmappedActivities");
    expect(restricted.summary).toMatchObject({
      criticalUnmappedWithheld: true,
      criticalUnmappedReason: "Mapping details unavailable to you",
    });
    expect(result.summary).not.toHaveProperty("criticalUnmappedWithheld");
    expect(restricted.summary.headline.find((entry) => entry.key === "critical_unmapped")).toEqual({
      key: "critical_unmapped",
      label: "Critical unmapped activities",
      value: "—",
      tone: "neutral",
      raw: null,
      withheld: true,
      reason: "Mapping details unavailable to you",
    });
    const criticalActivitiesOf = (readiness) =>
      readiness.steps.find((step) => step.key === "schedule_generation").counts.criticalActivities;
    expect(criticalActivitiesOf(restricted)).toBe(criticalActivitiesOf(result));
    expect(criticalActivitiesOf(result)).toBeGreaterThan(0);
    expect(
      restricted.steps.find((step) => step.key === "structure_setup").guides.find((guide) => guide.key === "mapping_readiness"),
    ).toMatchObject({ count: null, detail: "Mapping details unavailable to you", detailsWithheld: true });
    expect(restricted.context.boqRevision).not.toHaveProperty("totalAmount");
    expect(restricted.context.boqRevision).not.toHaveProperty("history");
    // No count of the bill's rows anywhere: the revision's, the steps', the
    // BOQ-structure guide's, the structure summary's, the issues'.
    expect(restricted.context.boqRevision.validation).toEqual({ blocked: [] });
    expect(restricted.context.boqRevision).toMatchObject({ countsWithheld: true, reason: "BOQ details unavailable to you" });
    for (const key of ["itemCount", "changes"]) expect(restricted.context.boqRevision).not.toHaveProperty(key);
    expect(result.context.boqRevision.validation.blockedCount).toBe(1);
    expect(restricted.structure).toEqual({
      wbsNodes: result.structure.wbsNodes,
      locations: result.structure.locations,
      projectCostCodes: result.structure.projectCostCodes,
      unitsUnresolvedWithheld: true,
      reason: "BOQ details unavailable to you",
    });
    const restrictedCounts = (key) => restricted.steps.find((step) => step.key === key).counts;
    for (const key of ["boqItems", "itemsWithoutWbs", "itemsWithoutCostCode", "itemsWithUnresolvedUnit"]) {
      expect(restrictedCounts("boq_upload")).not.toHaveProperty(key);
    }
    for (const key of ["revisionItems", "revisionChanges", "revisionBlockedRows"]) {
      expect(restrictedCounts("boq_approval")).not.toHaveProperty(key);
    }
    expect(restrictedCounts("structure_setup")).not.toHaveProperty("unitsUnresolved");
    expect(
      restricted.steps.find((step) => step.key === "structure_setup").guides.find((guide) => guide.key === "boq_structure"),
    ).toMatchObject({ count: null, detail: "BOQ details unavailable to you", detailsWithheld: true });
    const restrictedWithoutWbs = restricted.steps
      .find((step) => step.key === "structure_setup")
      .advisories.find((a) => a.code === "BOQ_ITEMS_WITHOUT_WBS");
    expect(restrictedWithoutWbs).toMatchObject({
      severity: "advisory",
      message: "Some BOQ rows have no WBS node.",
      details: {},
      boqDetailsWithheld: true,
      reason: "BOQ details unavailable to you",
    });
    expect(restrictedWithoutWbs).not.toHaveProperty("count");
    const restrictedUom = restricted.steps.find((step) => step.key === "structure_setup").warnings.find((w) => w.code === "UOM_UNRESOLVED");
    expect(restrictedUom).toMatchObject({ severity: "warning", details: {}, boqDetailsWithheld: true });
    expect(restrictedUom.message).not.toMatch(/\d/);
    const restrictedHeadline = restricted.summary.headline.map((entry) => entry.key);
    expect(restrictedHeadline).not.toContain("unmapped_boq");
    expect(restrictedHeadline).not.toContain("unmapped_quantity");
    const text = JSON.stringify(restricted);
    for (const secret of ["Rebar", "Concrete", "tonnes-ish", "Quinn Surveyor", "Blinding", "Please review"]) {
      expect(text).not.toContain(secret);
    }

    // The official reporting gate EV freezes into a locked period keeps the
    // shape it had before PC-4: no records, no links, no count.
    const gate = await setupReadinessService.getOfficialReportingGate({
      orgId: "org-1",
      projectId: "project-1",
    });
    expect(gate.blockers.map((b) => b.code)).toEqual(result.gates.reporting.blockers.map((b) => b.code));
    expect(gate.blockers.length).toBeGreaterThan(0);
    for (const entry of [...gate.blockers, ...gate.warnings]) {
      expect(entry).not.toHaveProperty("items");
      expect(entry).not.toHaveProperty("count");
      expect(entry).toEqual(expect.objectContaining({ code: expect.any(String), stepKey: expect.any(String) }));
    }
  });

  it("keeps nextAction on the ten original steps and offers the advisory steps apart", async () => {
    // Everything the ten steps need, but no structure and a bill entered by
    // hand: the ten are clear, the two advisory steps are not.
    const baselinedRevision = {
      id: "revision-1",
      label: "Baseline",
      status: "baselined",
      isActive: true,
      activityCount: 1,
      approvedAt: new Date("2026-02-01T00:00:00.000Z"),
      baselinedAt: new Date("2026-02-02T00:00:00.000Z"),
    };
    mockPrisma.boqItem.findMany.mockResolvedValue([{ ...filedBoqItem, wbsNodeId: null }]);
    mockBuildAllocationSummary.mockResolvedValue({
      totalBoqAmount: 100,
      approvedAllocatedAmount: 100,
      pendingAllocatedAmount: 0,
      unallocatedAmount: 0,
    });
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: "activity-1",
        name: "Foundations",
        wbsNodeId: null,
        isMilestone: false,
        isCritical: true,
        assignments: [{ id: "assignment-1" }],
        progressMethod: { id: "method-1", method: "quantity", quantityUnit: "m3" },
        predecessorLinks: [],
      },
    ]);
    mockPrisma.scheduleRevision.findFirst.mockReset();
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(baselinedRevision);
    mockPrisma.costRecord.count.mockResolvedValue(1);
    mockPrisma.activityCostLoading.count.mockResolvedValue(1);
    mockPrisma.reportingPeriod.count.mockResolvedValue(1);

    const result = await setupReadinessService.getSetupReadiness({
      orgId: "org-1",
      projectId: "project-1",
    });

    const original = result.steps.filter(
      (step) => !["structure_setup", "boq_approval"].includes(step.key),
    );
    expect(original.map((step) => [step.key, step.status]).filter(([, status]) => status !== "complete")).toEqual([]);
    expect(result.steps.find((step) => step.key === "structure_setup").status).toBe("attention");
    expect(result.summary.nextAction).toBeNull();
    expect(result.summary.advisoryAction).toMatchObject({
      stepKey: "structure_setup",
      label: "Open Structure",
      target: { module: "controls", child: "structure" },
    });
    // The schedule baseline locks the bill, so the approval step is done.
    expect(result.context.boqBaseline).toEqual({
      locked: true,
      source: "schedule_baseline",
      boqRevisionId: null,
    });
  });

  it("names the BOQ lock the way the BOQ page does: the schedule baseline first, then the revision locked last", async () => {
    mockPrisma.boqRevision.findMany.mockResolvedValue([
      // Newest number first, as the query orders them; revision 1 was locked
      // after revision 2.
      { id: "boq-rev-2", revisionNumber: 2, status: "superseded", baselineLocked: true, lockedAt: new Date("2026-01-05T00:00:00.000Z"), createdAt: new Date("2026-01-04T00:00:00.000Z") },
      { id: "boq-rev-1", revisionNumber: 1, status: "baselined", baselineLocked: true, lockedAt: new Date("2026-02-05T00:00:00.000Z"), createdAt: new Date("2026-01-01T00:00:00.000Z") },
    ]);
    const bare = await setupReadinessService.getSetupReadiness({ orgId: "org-1", projectId: "project-1" });
    expect(bare.context.boqBaseline).toEqual({ locked: true, source: "boq_revision", boqRevisionId: "boq-rev-1" });

    const baselined = { id: "revision-9", status: "baselined", isActive: true, activityCount: 0, baselinedAt: new Date("2026-03-01T00:00:00.000Z") };
    mockPrisma.scheduleRevision.findFirst.mockReset();
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(baselined);
    const withSchedule = await setupReadinessService.getSetupReadiness({ orgId: "org-1", projectId: "project-1" });
    expect(withSchedule.context.boqBaseline).toEqual({
      locked: true,
      source: "schedule_baseline",
      boqRevisionId: "boq-rev-1",
    });
  });

  it("reports ready-for-progress after BOQ, allocation, baseline, assignments, and EV basis are complete", async () => {
    const baselinedRevision = {
      id: "revision-1",
      label: "Baseline",
      status: "baselined",
      isActive: true,
      activityCount: 1,
      approvedAt: new Date("2026-02-01T00:00:00.000Z"),
      baselinedAt: new Date("2026-02-02T00:00:00.000Z"),
    };
    structureInPlace();
    mockPrisma.boqItem.findMany.mockResolvedValue([filedBoqItem]);
    mockBuildAllocationSummary.mockResolvedValue({
      totalBoqAmount: 100,
      approvedAllocatedAmount: 100,
      pendingAllocatedAmount: 0,
      unallocatedAmount: 0,
    });
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: "activity-1",
        name: "Foundations",
        wbsNodeId: "wbs-1",
        isMilestone: false,
        isCritical: true,
        assignments: [{ id: "assignment-1" }],
        progressMethod: { id: "method-1", method: "quantity", quantityUnit: "m3" },
        predecessorLinks: [],
      },
    ]);
    mockPrisma.scheduleRevision.findFirst.mockReset();
    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(baselinedRevision)
      .mockResolvedValueOnce(baselinedRevision)
      .mockResolvedValueOnce(baselinedRevision);
    mockPrisma.costRecord.count.mockResolvedValue(1);
    mockPrisma.activityCostLoading.count.mockResolvedValue(1);
    mockPrisma.reportingPeriod.count.mockResolvedValue(1);
    mockBuildScheduleReadiness.mockReturnValue({
      ready: true,
      blockingCount: 0,
      checks: [
        {
          key: "predecessors",
          label: "Predecessor logic",
          passed: true,
          severity: "blocking",
          message: "Predecessor references are valid.",
        },
      ],
    });

    const result = await setupReadinessService.getSetupReadiness({
      orgId: "org-1",
      projectId: "project-1",
    });

    expect(result.summary.readyForProgress).toBe(true);
    expect(result.summary.readyForReporting).toBe(true);
    expect(result.gates.progress.ready).toBe(true);
    expect(result.gates.reporting.ready).toBe(true);
    expect(result.gates.baseline.alreadyLocked).toBe(true);
    expect(result.summary.blockingCount).toBe(0);
    expect(result.steps.every((step) => step.status === "complete")).toBe(true);
  });

  it("opens the baseline gate when the approved schedule has no readiness blockers", async () => {
    const approvedRevision = {
      id: "revision-2",
      label: "Rev A",
      status: "approved",
      isActive: true,
      activityCount: 1,
      approvedAt: new Date("2026-02-01T00:00:00.000Z"),
      baselinedAt: null,
    };
    mockPrisma.boqItem.findMany.mockResolvedValue([
      { id: "boq-1", qty: 10, amount: 100 },
    ]);
    mockBuildAllocationSummary.mockResolvedValue({
      totalBoqAmount: 100,
      approvedAllocatedAmount: 100,
      pendingAllocatedAmount: 0,
      unallocatedAmount: 0,
    });
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: "activity-1",
        name: "Foundations",
        isMilestone: false,
        isCritical: true,
        assignments: [{ id: "assignment-1" }],
        progressMethod: { id: "method-1", method: "quantity" },
        predecessorLinks: [],
      },
    ]);
    mockPrisma.scheduleRevision.findFirst.mockReset();
    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(approvedRevision)
      .mockResolvedValueOnce(approvedRevision)
      .mockResolvedValueOnce(null);
    mockPrisma.costRecord.count.mockResolvedValue(1);
    mockPrisma.activityCostLoading.count.mockResolvedValue(1);
    mockPrisma.reportingPeriod.count.mockResolvedValue(1);
    mockBuildScheduleReadiness.mockReturnValue({
      ready: true,
      blockingCount: 0,
      checks: [],
    });

    const result = await setupReadinessService.getSetupReadiness({
      orgId: "org-1",
      projectId: "project-1",
    });

    expect(result.summary.readyForBaseline).toBe(true);
    expect(result.gates.baseline.ready).toBe(true);
    expect(result.gates.progress.ready).toBe(false);
    expect(result.gates.reporting.ready).toBe(false);
    expect(result.gates.progress.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "BASELINE_NOT_LOCKED" }),
      ]),
    );
  });

  // Owner decision E2 (2026-09-28): the baseline gate agrees with the lock —
  // a bill with no in-scope value is refused like no bill.
  const approvedWithBill = (rows, summary) => {
    const approvedRevision = {
      id: "revision-2",
      label: "Rev A",
      status: "approved",
      isActive: true,
      activityCount: 1,
      approvedAt: new Date("2026-02-01T00:00:00.000Z"),
      baselinedAt: null,
    };
    mockPrisma.boqItem.findMany.mockResolvedValue(rows);
    mockBuildAllocationSummary.mockResolvedValue(summary);
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: "activity-1",
        name: "Foundations",
        isMilestone: false,
        isCritical: true,
        assignments: [{ id: "assignment-1" }],
        progressMethod: { id: "method-1", method: "quantity" },
        predecessorLinks: [],
      },
    ]);
    mockPrisma.scheduleRevision.findFirst.mockReset();
    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(approvedRevision)
      .mockResolvedValueOnce(approvedRevision)
      .mockResolvedValueOnce(null);
    mockPrisma.costRecord.count.mockResolvedValue(1);
    mockPrisma.activityCostLoading.count.mockResolvedValue(1);
    mockPrisma.reportingPeriod.count.mockResolvedValue(1);
    return setupReadinessService.getSetupReadiness({ orgId: "org-1", projectId: "project-1" });
  };

  it("keeps the baseline gate shut on a token bill — only a not-applicable row, or only an optional row — naming the missing step (E2)", async () => {
    for (const [rule, summary] of [
      ["not_applicable", { totalBoqAmount: 100, notApplicableAmount: 100, approvedAllocatedAmount: 0, pendingAllocatedAmount: 0, unallocatedAmount: 0 }],
      ["optional", { totalBoqAmount: 100, approvedAllocatedAmount: 0, pendingAllocatedAmount: 0, unallocatedAmount: 100, optionalUnallocatedAmount: 100 }],
    ]) {
      const result = await approvedWithBill([{ id: "boq-1", qty: 10, amount: 100, mappingRule: rule }], summary);
      expect([rule, result.gates.baseline.ready, result.summary.readyForBaseline]).toEqual([rule, false, false]);
      const blocker = result.gates.baseline.blockers.find((entry) => entry.code === "BOQ_NO_IN_SCOPE_VALUE");
      expect([rule, blocker]).toEqual([
        rule,
        expect.objectContaining({
          stepKey: "boq_upload",
          severity: "blocking",
          message:
            "The bill has no in-scope value to map: every priced row is marked not applicable or optional. Mark the rows that belong to the schedule as required (Project Controls › Mapping), map them, then lock the baseline.",
        }),
      ]);
    }
  });

  it("opens the baseline gate on a mixed bill — the in-scope row fully mapped beside a not-applicable row (E2)", async () => {
    const result = await approvedWithBill(
      [
        { id: "boq-1", qty: 10, amount: 100, mappingRule: "required" },
        { id: "boq-2", qty: 1, amount: 50, mappingRule: "not_applicable" },
      ],
      { totalBoqAmount: 150, notApplicableAmount: 50, approvedAllocatedAmount: 100, pendingAllocatedAmount: 0, unallocatedAmount: 0 },
    );
    expect(result.gates.baseline.blockers.map((entry) => entry.code)).toEqual([]);
    expect(result.gates.baseline.ready).toBe(true);
  });

  it("counts a bill worth one cent as no value, and in-scope rows worth one cent as no in-scope value — the rule the lock and the schedule readiness use (closure review)", async () => {
    // One required row at one cent, nothing mapped.
    const cent = await approvedWithBill([{ id: "boq-1", qty: 1, amount: 0.01, mappingRule: "required" }], {
      totalBoqAmount: 0.01, approvedAllocatedAmount: 0, pendingAllocatedAmount: 0, unallocatedAmount: 0.01,
    });
    expect([cent.gates.baseline.ready, cent.gates.baseline.blockers.map((entry) => entry.code)]).toEqual([false, expect.arrayContaining(["BOQ_HAS_NO_VALUE"])]);
    // ... beside a priced not-applicable row: no in-scope value.
    const beside = await approvedWithBill(
      [
        { id: "boq-1", qty: 1, amount: 0.01, mappingRule: "required" },
        { id: "boq-2", qty: 1, amount: 250000, mappingRule: "not_applicable" },
      ],
      { totalBoqAmount: 250000.01, notApplicableAmount: 250000, approvedAllocatedAmount: 0, pendingAllocatedAmount: 0, unallocatedAmount: 0.01 },
    );
    const codes = beside.gates.baseline.blockers.map((entry) => entry.code);
    expect([beside.gates.baseline.ready, codes.includes("BOQ_NO_IN_SCOPE_VALUE"), codes.includes("BOQ_HAS_NO_VALUE")]).toEqual([false, true, false]);
  });

  // Owner decision R5-4 (2026-09-30): the headline tells three schedule
  // states apart — none, imported/staged, active — and states how many
  // critical activities are unmapped only once an active schedule has been
  // assessed. The BOQ restriction on that count is unchanged.
  describe("the headline's three schedule states (R5-4)", () => {
    const stagedRevision = (overrides = {}) => ({
      id: "revision-staged",
      label: "P6 import",
      status: "approved",
      isActive: false,
      activityCount: 3,
      approvedAt: new Date("2026-02-01T00:00:00.000Z"),
      baselinedAt: null,
      ...overrides,
    });
    const activeRevision = {
      id: "revision-active",
      label: "Rev A",
      status: "approved",
      isActive: true,
      activityCount: 2,
      approvedAt: new Date("2026-02-01T00:00:00.000Z"),
      baselinedAt: null,
    };
    // The three lookups by what they ask for, so the check can be run for
    // several callers in one test.
    const revisions = ({ active = null, latest = null, baselined = null }) => {
      mockPrisma.scheduleRevision.findFirst.mockReset();
      mockPrisma.scheduleRevision.findFirst.mockImplementation(async ({ where }) =>
        where.isActive ? active : where.status === "baselined" ? baselined : latest,
      );
    };
    const criticalActivity = (id, overrides = {}) => ({
      id,
      name: `Activity ${id}`,
      isMilestone: false,
      isCritical: true,
      assignments: [],
      progressMethod: null,
      predecessorLinks: [],
      ...overrides,
    });
    const check = (canReadBoq) =>
      setupReadinessService.getSetupReadiness({ orgId: "org-1", projectId: "project-1", canReadBoq });
    const entry = (readiness, key) => readiness.summary.headline.find((item) => item.key === key);
    const WAITING = {
      key: "critical_unmapped",
      label: "Critical unmapped activities",
      value: "Waiting for active schedule",
      tone: "neutral",
      raw: null,
      waiting: true,
    };
    // Nothing was assessed: no count anywhere, for anyone — and no claim
    // that anything was withheld, since there is nothing to withhold.
    const expectWaiting = (readiness) => {
      expect(entry(readiness, "critical_unmapped")).toEqual(WAITING);
      expect(readiness.summary).not.toHaveProperty("criticalUnmappedActivities");
      expect(readiness.summary).not.toHaveProperty("criticalUnmappedWithheld");
      expect(readiness.summary).toMatchObject({
        criticalUnmappedWaiting: true,
        criticalUnmappedReason: "Waiting for active schedule",
      });
    };

    it("no schedule: 'No schedule yet', and the critical entry waits — for a BOQ reader and for a member who may not read the BOQ", async () => {
      revisions({});
      for (const canReadBoq of [true, false]) {
        const readiness = await check(canReadBoq);
        expect([canReadBoq, readiness.summary.scheduleState]).toEqual([canReadBoq, "none"]);
        expect(entry(readiness, "schedule_imported")).toEqual({
          key: "schedule_imported",
          label: "Schedule",
          value: "No schedule yet",
          tone: "blocked",
          raw: false,
        });
        expectWaiting(readiness);
      }
    });

    it("a staged revision (imported, not activated): the import reads complete and the critical entry waits — never '0', never the done tone", async () => {
      for (const status of ["approved", "draft", "under_review"]) {
        revisions({ latest: stagedRevision({ status }) });
        for (const canReadBoq of [true, false]) {
          const readiness = await check(canReadBoq);
          expect([status, canReadBoq, readiness.summary.scheduleState]).toEqual([status, canReadBoq, "staged"]);
          expect([status, entry(readiness, "schedule_imported")]).toEqual([
            status,
            {
              key: "schedule_imported",
              label: "Schedule imported",
              value: "PASS (waiting for activation)",
              tone: "info",
              raw: true,
            },
          ]);
          expectWaiting(readiness);
          const critical = entry(readiness, "critical_unmapped");
          expect(critical.value).not.toMatch(/\d/);
          expect(critical.tone).not.toBe("done");
          // The mapping share stays the bill's: withheld from the member.
          expect(Boolean(entry(readiness, "mapping").withheld)).toBe(!canReadBoq);
        }
      }
    });

    it("a staged revision that was rejected, or has no activities, still fails — and the critical entry still waits", async () => {
      for (const overrides of [{ status: "rejected" }, { activityCount: 0 }]) {
        revisions({ latest: stagedRevision(overrides) });
        const readiness = await check(true);
        expect(readiness.summary.scheduleState).toBe("staged");
        expect(entry(readiness, "schedule_imported")).toMatchObject({
          label: "Schedule imported",
          value: "FAIL",
          tone: "blocked",
          raw: false,
        });
        expectWaiting(readiness);
      }
    });

    it("an active schedule: the count for a BOQ reader (1, then 0 once mapped), withheld from a member who may not read the BOQ", async () => {
      revisions({ active: activeRevision, latest: activeRevision });
      mockPrisma.activity.findMany.mockResolvedValue([
        criticalActivity("activity-1"),
        criticalActivity("activity-2", { isCritical: false }),
      ]);

      const reader = await check(true);
      expect(reader.summary.scheduleState).toBe("active");
      expect(entry(reader, "schedule_imported")).toEqual({
        key: "schedule_imported",
        label: "Schedule imported",
        value: "PASS",
        tone: "done",
        raw: true,
      });
      expect(entry(reader, "critical_unmapped")).toEqual({
        key: "critical_unmapped",
        label: "Critical unmapped activities",
        value: "1",
        tone: "review",
        raw: 1,
      });
      expect(reader.summary.criticalUnmappedActivities).toBe(1);
      expect(reader.summary).not.toHaveProperty("criticalUnmappedWaiting");
      expect(reader.summary).not.toHaveProperty("criticalUnmappedWithheld");

      // The member: no count, no tone that says whether there are any — the
      // server's reason instead, and not the waiting state (it is assessed).
      const member = await check(false);
      expect(member.summary.scheduleState).toBe("active");
      expect(entry(member, "schedule_imported")).toEqual(entry(reader, "schedule_imported"));
      expect(entry(member, "critical_unmapped")).toEqual({
        key: "critical_unmapped",
        label: "Critical unmapped activities",
        value: "—",
        tone: "neutral",
        raw: null,
        withheld: true,
        reason: "Mapping details unavailable to you",
      });
      expect(member.summary).not.toHaveProperty("criticalUnmappedActivities");
      expect(member.summary).not.toHaveProperty("criticalUnmappedWaiting");
      expect(member.summary).toMatchObject({
        criticalUnmappedWithheld: true,
        criticalUnmappedReason: "Mapping details unavailable to you",
      });

      // Mapped: an assessed zero is a fact, and reads as one.
      mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
        { id: "allocation-1", boqItemId: "boq-1", activityId: "activity-1", status: "approved", suggestedBy: null, locationId: null },
      ]);
      const mapped = await check(true);
      expect(entry(mapped, "critical_unmapped")).toEqual({
        key: "critical_unmapped",
        label: "Critical unmapped activities",
        value: "0",
        tone: "done",
        raw: 0,
      });
      expect(mapped.summary.criticalUnmappedActivities).toBe(0);
    });

    // The Setup Readiness card prints a step's counts as chips under the
    // headline. "Activities: 0 · Progress acts: 0 · Critical: 0" beside
    // "Schedule imported PASS (waiting for activation)" counts a schedule
    // that is not there: a step states the active schedule's counts only
    // once one is active.
    const ACTIVE_SCHEDULE_COUNTS = [
      "activeActivities",
      "progressActivities",
      "criticalActivities",
      "milestones",
      "activitiesWithoutWbs",
      "activitiesWithUnmappedCalendar",
      "assignedProgressActivities",
      "progressMethodCount",
      "quantityMethodsWithoutUnit",
    ];
    const countsOf = (readiness, key) => readiness.steps.find((step) => step.key === key).counts;
    const SCHEDULE_STEPS = ["schedule_generation", "engineer_assignment", "progress_method_configuration", "progress_readiness"];

    it("no step counts the active schedule while none is active; a staged revision's activities are named as the revision's", async () => {
      const cases = [
        ["none", {}, undefined],
        ["staged draft", { latest: stagedRevision({ status: "draft" }) }, 3],
        ["staged approved", { latest: stagedRevision() }, 3],
        ["staged rejected", { latest: stagedRevision({ status: "rejected" }) }, 3],
        ["staged empty", { latest: stagedRevision({ activityCount: 0 }) }, 0],
      ];
      for (const [label, lookups, revisionActivities] of cases) {
        revisions(lookups);
        for (const canReadBoq of [true, false]) {
          const readiness = await check(canReadBoq);
          const tag = `${label} / ${canReadBoq ? "reader" : "member"}`;
          for (const key of SCHEDULE_STEPS) {
            const counts = countsOf(readiness, key);
            expect([tag, key, ACTIVE_SCHEDULE_COUNTS.filter((name) => name in counts)]).toEqual([tag, key, []]);
          }
          // What the revision holds is the schedule's own, every caller's.
          expect([tag, countsOf(readiness, "schedule_generation").revisionActivities]).toEqual([tag, revisionActivities]);
          expect([tag, countsOf(readiness, "schedule_generation").revisionStatus]).toEqual([
            tag,
            lookups.latest ? lookups.latest.status : null,
          ]);
          // The lock is not the active schedule's: it stays.
          expect([tag, countsOf(readiness, "progress_readiness")]).toEqual([tag, { baselineLocked: false }]);
        }
      }
    });

    it("an active schedule: the steps count it as before, for every caller, and name no staged revision", async () => {
      revisions({ active: activeRevision, latest: activeRevision });
      mockPrisma.activity.findMany.mockResolvedValue([
        criticalActivity("activity-1"),
        criticalActivity("activity-2", { isCritical: false }),
        criticalActivity("activity-3", { isMilestone: true }),
      ]);
      for (const canReadBoq of [true, false]) {
        const readiness = await check(canReadBoq);
        expect(countsOf(readiness, "schedule_generation")).toMatchObject({
          revisionStatus: "approved",
          activeActivities: 3,
          progressActivities: 2,
          criticalActivities: 1,
          milestones: 1,
        });
        expect(countsOf(readiness, "schedule_generation")).not.toHaveProperty("revisionActivities");
        expect(countsOf(readiness, "engineer_assignment")).toEqual({ assignedProgressActivities: 0, progressActivities: 2 });
        expect(countsOf(readiness, "progress_method_configuration")).toEqual({
          progressMethodCount: 0,
          progressActivities: 2,
          quantityMethodsWithoutUnit: 0,
        });
        expect(countsOf(readiness, "progress_readiness")).toEqual({
          baselineLocked: false,
          progressActivities: 2,
          progressMethodCount: 0,
          assignedProgressActivities: 0,
        });
      }
    });

    it("the gates do not read the schedule state: the staged and empty projects keep their blockers", async () => {
      revisions({});
      const none = await check(true);
      expect(none.steps.find((step) => step.key === "schedule_generation").blockers.map((b) => b.code)).toEqual(["NO_SCHEDULE"]);
      revisions({ latest: stagedRevision() });
      const staged = await check(true);
      const step = staged.steps.find((item) => item.key === "schedule_generation");
      expect(step.blockers).toEqual([]);
      expect(step.warnings.map((w) => w.code)).toEqual(["SCHEDULE_NOT_ACTIVE"]);
      expect(staged.gates.baseline.ready).toBe(false);
    });
  });
});
