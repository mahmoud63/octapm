const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findUnique: jest.fn(), findFirst: jest.fn() },
  scheduleRevision: { findFirst: jest.fn() },
  boqRevision: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  projectDocument: {
    update: jest.fn(),
  },
  boqItem: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  activity: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  activityBoqAllocation: {
    count: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  activityDependency: {
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  boqActivity: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
};

const mockNextActivityCode = jest.fn();
const mockBuildAllocationSummary = jest.fn();
const mockAssertAllocationCapacity = jest.fn();
const mockAssertAiQuota = jest.fn();
const mockAnthropicMessagesCreate = jest.fn();
const mockAuditService = {
  ENTITY_TYPES: {
    BOQ_ITEM: "boq_item",
    BOQ_REVISION: "boq_revision",
  },
  ACTIONS: {
    CREATED: "created",
    UPDATED: "updated",
    DELETED: "deleted",
    IMPORTED: "imported",
  },
  recordEvent: jest.fn(),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("@anthropic-ai/sdk", () =>
  jest.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicMessagesCreate },
  })),
);
jest.mock("../../utils/activity-code", () => ({
  nextActivityCode: mockNextActivityCode,
}));
jest.mock("../../middleware/subscription-gate", () => ({
  assertAiQuota: mockAssertAiQuota,
  incrementAiUsage: jest.fn(),
}));
jest.mock("../activity-boq-allocation.service", () => ({
  assertAllocationCapacity: mockAssertAllocationCapacity,
  buildAllocationSummary: mockBuildAllocationSummary,
  computeDefaultWeight: jest.fn(({ amount, boqItem }) =>
    Number(boqItem?.amount || 0) > 0
      ? (Number(amount || 0) / Number(boqItem.amount)) * 100
      : 0,
  ),
  // A rate edit re-derives draft allocations (PC-3); the live test proves
  // the figures, this mock only keeps the edit path callable.
  rederiveAllocationsForBoqItem: jest
    .fn()
    .mockResolvedValue({ rederived: [], warnings: [] }),
}));
jest.mock("../boq-calculation.service", () => ({
  calculateFinancials: jest.fn((items, summary) =>
    Promise.resolve({
      subtotal1: items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      extraServices: [],
      subtotal2: items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      totalProjectCost: items.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0,
      ),
      scheduledValue: summary?.scheduledValue ?? 0,
      unscheduledValue: summary?.unscheduledValue ?? 0,
      earnedValue: summary?.earnedValue ?? 0,
      certifiedValue: summary?.certifiedValue ?? 0,
    }),
  ),
}));
jest.mock("../audit.service", () => mockAuditService);
jest.mock("../../jobs/job.service", () => ({
  JOB_TYPES: { BOQ_PARSE: "boq.parse", SCHEDULE_GENERATE: "schedule.generate" },
  enqueueJob: jest.fn(async ({ projectId }) => ({
    id: "job-1",
    projectId,
    status: "queued",
  })),
  recordCompletedJob: jest.fn(async ({ projectId }) => ({
    id: "job-1",
    projectId,
    status: "succeeded",
  })),
}));

const XLSX = require("@e965/xlsx");
const service = require("../boq.service");

function makeBoqWorkbookBuffer(rows) {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Code", "Description", "Quantity", "Unit", "Rate"],
    ...rows,
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "BOQ");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

describe("BOQ service integrity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertAiQuota.mockResolvedValue();
    mockAnthropicMessagesCreate.mockResolvedValue({
      content: [{ text: '{"boqActivities":[]}' }],
    });
    mockNextActivityCode.mockResolvedValue("EX-001");
    mockAssertAllocationCapacity.mockImplementation(() => {});
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([]);
    mockBuildAllocationSummary.mockResolvedValue({
      scheduledValue: 0,
      unscheduledValue: 500,
      earnedValue: 0,
      certifiedValue: 0,
      items: [],
    });
    mockPrisma.projectDocument.update.mockResolvedValue({ id: "doc-1" });
    mockAuditService.recordEvent.mockResolvedValue({ id: "audit-1" });
  });

  it("rejects duplicate BOQ item codes before update", async () => {
    mockPrisma.boqItem.findFirst
      .mockResolvedValueOnce({
        id: "boq-1",
        projectId: "project-1",
        code: "1.1",
        qty: 5,
        rate: 100,
      })
      .mockResolvedValueOnce({ id: "boq-2", code: "1.2" });

    await expect(
      service.updateBoqItem("project-1", "boq-1", { code: "1.2" }),
    ).rejects.toMatchObject({ code: "DUPLICATE_BOQ_ITEM_CODE" });

    expect(mockPrisma.boqItem.update).not.toHaveBeenCalled();
    expect(mockAuditService.recordEvent).not.toHaveBeenCalled();
  });

  it("scopes BOQ item update lookup by project before updating by primary id", async () => {
    const existing = {
      id: "boq-1",
      projectId: "project-1",
      code: "1.1",
      description: "Excavation",
      qty: 5,
      unit: "m3",
      rate: 100,
      amount: 500,
      isManual: true,
      isActive: true,
      sortOrder: 0,
    };
    const updated = {
      ...existing,
      unit: "m",
      activityBoqAllocations: [],
    };

    mockPrisma.project.findFirst.mockResolvedValue({
      id: "project-1",
      orgId: "org-1",
    });
    mockPrisma.boqRevision.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(null);
    mockPrisma.boqItem.findFirst.mockResolvedValue(existing);
    mockPrisma.boqItem.update.mockResolvedValue(updated);
    mockPrisma.boqItem.findMany.mockResolvedValue([updated]);

    await service.updateBoqItem(
      "project-1",
      "boq-1",
      { unit: "m" },
      { orgId: "org-1", userId: "qs-1", userRole: "qs" },
    );

    expect(mockPrisma.boqItem.findFirst).toHaveBeenCalledWith({
      where: { id: "boq-1", projectId: "project-1" },
    });
    expect(mockPrisma.boqItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "boq-1" },
      }),
    );
    expect(mockPrisma.boqItem.findUnique).not.toHaveBeenCalled();
  });

  it("records BOQ item edits in the central audit history with old and new snapshots", async () => {
    const existing = {
      id: "boq-1",
      projectId: "project-1",
      code: "1.1",
      description: "Excavation",
      qty: 5,
      unit: "m3",
      rate: 100,
      amount: 500,
      isManual: true,
      isActive: true,
      sortOrder: 0,
    };
    const updated = {
      ...existing,
      description: "Excavation revised",
      rate: 120,
      amount: 600,
      activityBoqAllocations: [],
    };

    mockPrisma.project.findFirst.mockResolvedValue({
      id: "project-1",
      orgId: "org-1",
    });
    mockPrisma.boqRevision.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(null);
    mockPrisma.boqItem.findFirst.mockResolvedValue(existing);
    mockPrisma.boqItem.update.mockResolvedValue(updated);
    mockPrisma.boqItem.findMany.mockResolvedValue([updated]);

    await service.updateBoqItem(
      "project-1",
      "boq-1",
      { description: "Excavation revised", rate: 120 },
      { orgId: "org-1", userId: "qs-1", userRole: "qs" },
    );

    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        projectId: "project-1",
        entityType: "boq_item",
        entityId: "boq-1",
        action: "updated",
        actorId: "qs-1",
        actorRole: "qs",
        oldSummary: expect.objectContaining({
          code: "1.1",
          description: "Excavation",
          amount: 500,
        }),
        newSummary: expect.objectContaining({
          code: "1.1",
          description: "Excavation revised",
          amount: 600,
        }),
      }),
    );
  });

  it("scopes BOQ item delete lookup by project before deleting by primary id", async () => {
    const item = {
      id: "boq-1",
      projectId: "project-1",
      code: "1.1",
      description: "Excavation",
      qty: 5,
      unit: "m3",
      rate: 100,
      amount: 500,
      isManual: true,
      isActive: true,
      sortOrder: 0,
    };

    mockPrisma.project.findFirst.mockResolvedValue({
      id: "project-1",
      orgId: "org-1",
    });
    mockPrisma.boqRevision.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(null);
    mockPrisma.boqItem.findFirst.mockResolvedValue(item);
    mockPrisma.boqItem.findMany.mockResolvedValue([]);

    await service.deleteBoqItem("project-1", "boq-1", {
      orgId: "org-1",
      userId: "qs-1",
      userRole: "qs",
    });

    expect(mockPrisma.boqItem.findFirst).toHaveBeenCalledWith({
      where: { id: "boq-1", projectId: "project-1" },
    });
    expect(mockPrisma.boqItem.delete).toHaveBeenCalledWith({
      where: { id: "boq-1" },
    });
    expect(mockPrisma.boqItem.findUnique).not.toHaveBeenCalled();
  });

  it("creates manual BOQ rows on the official Activity allocation spine", async () => {
    const createdActivity = {
      id: "activity-1",
      projectId: "project-1",
      name: "Excavate",
      activityCode: "EX-001",
      wbsCode: null,
      p6ActivityId: null,
      predecessors: null,
      sortOrder: 0,
    };
    const createdAllocation = {
      id: "allocation-1",
      projectId: "project-1",
      boqItemId: "boq-1",
      activityId: "activity-1",
      quantity: 5,
      amount: 500,
      weight: 100,
      source: "manual",
      status: "draft",
      isActive: true,
      activity: createdActivity,
    };
    const itemWithActivities = {
      id: "boq-1",
      projectId: "project-1",
      code: "1.1",
      description: "Excavation",
      qty: 5,
      unit: "m3",
      rate: 100,
      amount: 500,
      isManual: true,
      sortOrder: 0,
      createdAt: new Date("2026-06-08T00:00:00.000Z"),
      activityBoqAllocations: [createdAllocation],
    };

    mockPrisma.boqItem.findFirst.mockResolvedValue(null);
    mockPrisma.boqItem.count.mockResolvedValue(0);
    mockPrisma.boqItem.create.mockResolvedValue({
      id: "boq-1",
      projectId: "project-1",
      code: "1.1",
      description: "Excavation",
      qty: 5,
      unit: "m3",
      rate: 100,
      amount: 500,
    });
    mockPrisma.activity.count.mockResolvedValue(0);
    mockPrisma.activity.create.mockResolvedValue(createdActivity);
    mockPrisma.activityBoqAllocation.create.mockResolvedValue(
      createdAllocation,
    );
    mockPrisma.boqItem.findUnique.mockResolvedValue(itemWithActivities);
    mockPrisma.boqItem.findMany.mockResolvedValue([itemWithActivities]);

    await service.createManualBoqItem("project-1", {
      code: "1.1",
      description: "Excavation",
      quantity: 5,
      unit: "m3",
      rate: 100,
      activityName: "Excavate",
      activityCode: "CLIENT-999",
    });

    expect(mockPrisma.boqItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        code: "1.1",
        activeCodeKey: "1.1",
        isManual: true,
      }),
    });
    expect(mockNextActivityCode).toHaveBeenCalledWith(
      "project-1",
      "Excavation",
      mockPrisma,
    );
    expect(mockPrisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        name: "Excavate",
        activityCode: "EX-001",
        wbsCode: null,
        budget: 500,
      }),
    });
    expect(mockPrisma.activityBoqAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        boqItemId: "boq-1",
        activityId: "activity-1",
        quantity: 5,
        amount: 500,
        status: "draft",
        source: "manual",
      }),
    });
    expect(mockPrisma.boqActivity.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activityCode: "CLIENT-999" }),
      }),
    );
    expect(mockPrisma.boqActivity.create).not.toHaveBeenCalled();
  });

  it("normalizes manual BOQ codes and maps concurrent DB duplicates to the BOQ duplicate error", async () => {
    mockPrisma.boqRevision.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(null);
    mockPrisma.boqItem.findFirst.mockResolvedValue(null);
    mockPrisma.boqItem.count.mockResolvedValue(0);
    mockPrisma.boqItem.create.mockRejectedValue({
      code: "P2002",
      meta: { target: ["projectId", "activeCodeKey"] },
    });

    await expect(
      service.createManualBoqItem("project-1", {
        code: " a   01 ",
        description: "Excavation",
        quantity: 5,
        unit: "m3",
        rate: 100,
        activityName: "Excavate",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_BOQ_ITEM_CODE" });

    expect(mockPrisma.boqItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: "A 01",
        activeCodeKey: "A 01",
      }),
    });
    expect(mockPrisma.activity.create).not.toHaveBeenCalled();
  });

  it("adds BOQ activity helpers as real schedule activities with draft allocations", async () => {
    const boqItem = {
      id: "boq-1",
      projectId: "project-1",
      code: "1.1",
      description: "Excavation",
      qty: 10,
      unit: "m3",
      rate: 100,
      amount: 1000,
      isActive: true,
    };
    const createdActivity = {
      id: "activity-2",
      projectId: "project-1",
      name: "Excavate north zone",
      activityCode: "EX-001",
      wbsCode: null,
      p6ActivityId: null,
      predecessors: null,
      sortOrder: 1,
    };

    mockPrisma.boqItem.findFirst.mockResolvedValue(boqItem);
    mockPrisma.activity.count.mockResolvedValue(1);
    mockPrisma.activityBoqAllocation.count.mockResolvedValue(0);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([]);
    mockPrisma.activity.create.mockResolvedValue(createdActivity);
    mockPrisma.activityBoqAllocation.create.mockResolvedValue({
      id: "allocation-2",
      projectId: "project-1",
      boqItemId: "boq-1",
      activityId: "activity-2",
      quantity: 4,
      amount: 400,
      weight: 40,
      source: "manual",
      status: "draft",
      isActive: true,
      activity: createdActivity,
    });

    const result = await service.createActivity("project-1", "boq-1", {
      activityName: "Excavate north zone",
      unit: "m3",
      quantity: 4,
      rate: 100,
      dependencyType: null,
      predecessorCode: null,
    });

    expect(mockPrisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        name: "Excavate north zone",
        activityCode: "EX-001",
        wbsCode: null,
        budget: 400,
      }),
    });
    expect(mockPrisma.activityBoqAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        boqItemId: "boq-1",
        activityId: "activity-2",
        quantity: 4,
        amount: 400,
        status: "draft",
      }),
    });
    expect(mockPrisma.boqActivity.create).not.toHaveBeenCalled();
    expect(result.activity).toMatchObject({
      id: "activity-2",
      allocationId: "allocation-2",
      activityCode: "EX-001",
      activityName: "Excavate north zone",
      quantity: 4,
      budget: 400,
      allocationStatus: "draft",
    });
  });

  it("renders BOQ activities from official allocations and schedule activities", async () => {
    const createdAt = new Date("2026-06-08T00:00:00.000Z");
    const boqItem = {
      id: "boq-1",
      projectId: "project-1",
      code: "1.1",
      description: "Excavation",
      qty: 5,
      unit: "m3",
      rate: 100,
      amount: 500,
      isManual: true,
      sortOrder: 0,
      createdAt,
      updatedAt: createdAt,
      activityBoqAllocations: [
        {
          id: "allocation-1",
          projectId: "project-1",
          boqItemId: "boq-1",
          activityId: "activity-1",
          quantity: 5,
          amount: 500,
          weight: 100,
          source: "manual",
          status: "approved",
          isActive: true,
          activity: {
            id: "activity-1",
            projectId: "project-1",
            name: "Excavate",
            activityCode: "EX-001",
            wbsCode: null,
            p6ActivityId: null,
            predecessors: null,
            sortOrder: 0,
            predecessorLinks: [],
          },
        },
      ],
    };

    mockPrisma.boqItem.findMany.mockResolvedValue([boqItem]);
    mockPrisma.boqRevision.findMany.mockResolvedValue([]);
    mockPrisma.boqRevision.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(null);

    const result = await service.getProjectBoq("project-1");

    expect(mockPrisma.boqItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          activityBoqAllocations: expect.any(Object),
        }),
      }),
    );
    expect(result.items[0].activities).toEqual([
      expect.objectContaining({
        id: "activity-1",
        allocationId: "allocation-1",
        activityCode: "EX-001",
        activityName: "Excavate",
        allocationStatus: "approved",
      }),
    ]);
  });

  it("rejects BOQ uploads that duplicate an existing manual BOQ item code", async () => {
    const buffer = makeBoqWorkbookBuffer([["1.1", "Excavation", 5, "m3", 100]]);

    mockPrisma.project.findUnique.mockResolvedValue({ orgId: "org-1" });
    mockPrisma.project.findFirst.mockResolvedValue({ orgId: "org-1" });
    mockPrisma.boqItem.findMany.mockResolvedValueOnce([{ code: "1.1" }]);

    await expect(
      service.processBoqUpload("project-1", buffer, null),
    ).rejects.toMatchObject({ code: "DUPLICATE_BOQ_ITEM_CODE" });

    expect(mockPrisma.boqItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.boqItem.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.boqItem.findMany).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        isManual: true,
        isActive: true,
        activeCodeKey: { in: ["1.1"] },
      },
      select: { code: true },
    });
  });

  it("maps concurrent upload BOQ code unique violations to the duplicate code error", async () => {
    const buffer = makeBoqWorkbookBuffer([
      [" a   01 ", "Excavation", 5, "m3", 100],
    ]);

    mockPrisma.project.findUnique.mockResolvedValue({ orgId: "org-1" });
    mockPrisma.project.findFirst.mockResolvedValue({ orgId: "org-1" });
    mockPrisma.boqItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockPrisma.boqRevision.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(null);
    mockPrisma.boqRevision.create.mockResolvedValue({
      id: "rev-1",
      projectId: "project-1",
      revisionNumber: 1,
      label: "Rev 1",
      status: "imported",
      baselineLocked: false,
      itemCount: 1,
      addedCount: 1,
      updatedCount: 0,
      removedCount: 0,
      unchangedCount: 0,
      blockedCount: 0,
      totalAmount: 500,
      createdAt: new Date("2026-06-09T00:00:00.000Z"),
    });
    mockPrisma.boqItem.create.mockRejectedValue({
      code: "P2002",
      meta: { target: ["projectId", "activeCodeKey"] },
    });

    await expect(
      service.processBoqUpload("project-1", buffer, "Rev 1"),
    ).rejects.toMatchObject({ code: "DUPLICATE_BOQ_ITEM_CODE" });

    expect(mockPrisma.boqItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: "A 01",
        activeCodeKey: "A 01",
        isActive: true,
      }),
    });
  });

  it("imports a revised BOQ without deleting existing uploaded rows", async () => {
    const buffer = makeBoqWorkbookBuffer([
      ["1.1", "Excavation revised", 6, "m3", 100],
      ["1.2", "Backfill", 4, "m3", 80],
    ]);

    mockPrisma.project.findUnique.mockResolvedValue({ orgId: "org-1" });
    mockPrisma.project.findFirst.mockResolvedValue({ orgId: "org-1" });
    mockPrisma.boqItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "boq-1",
          code: "1.1",
          description: "Excavation",
          qty: 5,
          unit: "m3",
          rate: 100,
          amount: 500,
          sortOrder: 0,
          baselineLocked: false,
        },
      ]);
    mockPrisma.boqRevision.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(null);
    mockPrisma.boqRevision.create.mockResolvedValue({
      id: "rev-1",
      projectId: "project-1",
      revisionNumber: 1,
      label: "Rev 1",
      status: "imported",
      baselineLocked: false,
      itemCount: 2,
      addedCount: 1,
      updatedCount: 1,
      removedCount: 0,
      unchangedCount: 0,
      blockedCount: 0,
      totalAmount: 920,
      createdAt: new Date("2026-06-09T00:00:00.000Z"),
    });
    mockPrisma.boqItem.update.mockResolvedValue({ id: "boq-1" });
    mockPrisma.boqItem.create.mockResolvedValue({ id: "boq-2" });

    const result = await service.processBoqUpload(
      "project-1",
      buffer,
      "Rev 1",
      {
        documentId: "doc-1",
        orgId: "org-1",
        userId: "user-1",
      },
    );

    expect(result).toMatchObject({
      revisionId: "rev-1",
      mode: "imported",
      baselineLocked: false,
    });
    expect(mockPrisma.boqItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.boqItem.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.boqItem.update).toHaveBeenCalledWith({
      where: { id: "boq-1" },
      data: expect.objectContaining({
        revisionId: "rev-1",
        code: "1.1",
        activeCodeKey: "1.1",
        description: "Excavation revised",
        qty: 6,
        amount: 600,
        isActive: true,
      }),
    });
    expect(mockPrisma.boqItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        revisionId: "rev-1",
        code: "1.2",
        activeCodeKey: "1.2",
        description: "Backfill",
        isActive: true,
      }),
    });
    expect(mockPrisma.boqRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceDocumentId: "doc-1",
        createdBy: "user-1",
      }),
    });
    expect(mockPrisma.projectDocument.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: expect.objectContaining({
        status: "linked",
        linkedEntityType: "boq_revision",
        linkedEntityId: "rev-1",
      }),
    });
  });

  it("saves a comparison-only BOQ revision when the baseline is locked", async () => {
    const buffer = makeBoqWorkbookBuffer([
      ["1.1", "Excavation revised", 6, "m3", 100],
      ["2.1", "Concrete", 3, "m3", 250],
    ]);

    mockPrisma.project.findUnique.mockResolvedValue({ orgId: "org-1" });
    mockPrisma.boqItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "boq-1",
          code: "1.1",
          description: "Excavation",
          qty: 5,
          unit: "m3",
          rate: 100,
          amount: 500,
          sortOrder: 0,
          baselineLocked: true,
        },
      ]);
    mockPrisma.boqRevision.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ revisionNumber: 2 });
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue({
      id: "schedule-baseline-1",
      status: "baselined",
      baselinedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    mockPrisma.boqRevision.create.mockResolvedValue({
      id: "rev-3",
      projectId: "project-1",
      revisionNumber: 3,
      label: "Client Rev B",
      status: "comparison_only",
      baselineLocked: false,
      itemCount: 2,
      addedCount: 1,
      updatedCount: 1,
      removedCount: 0,
      unchangedCount: 0,
      blockedCount: 0,
      totalAmount: 1350,
      createdAt: new Date("2026-06-09T00:00:00.000Z"),
    });
    mockPrisma.boqItem.create.mockResolvedValue({ id: "candidate-1" });

    const result = await service.processBoqUpload(
      "project-1",
      buffer,
      "Client Rev B",
    );

    expect(result).toMatchObject({
      revisionId: "rev-3",
      mode: "comparison_only",
      baselineLocked: true,
    });
    expect(mockPrisma.boqItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.boqItem.update).not.toHaveBeenCalled();
    expect(mockPrisma.boqItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        revisionId: "rev-3",
        isActive: false,
        activeCodeKey: null,
        supersededReason: expect.stringContaining("baseline is locked"),
      }),
    });
  });
});

describe("Phase 21D — integrity (the twenty-third loop's own finding)", () => {
  it("P21-169 / CX21-544: deleting a manual BOQ row retires only the activity the row minted, marked as such, that carries nothing else — an activity it was merely allocated to, or one created later by the schedule, keeps its schedule and its history", async () => {
    const item = { id: "boq-1", projectId: "project-1", code: "1.1", description: "Excavation", qty: 5, unit: "m3", rate: 100, amount: 500, isManual: true, isActive: true, sortOrder: 0, createdAt: new Date("2026-09-14T07:00:00.000Z") };
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1", orgId: "org-1" });
    mockPrisma.boqRevision.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(null);
    mockPrisma.boqItem.findFirst.mockResolvedValue(item);
    mockPrisma.boqItem.findMany.mockResolvedValue([]);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      { id: "al-old", activityId: "act-old", status: "draft" }, // an activity that existed before the row
      { id: "al-new", activityId: "act-new", status: "draft" }, // the activity the row minted
      { id: "al-later", activityId: "act-later", status: "draft" }, // created after the row, by the schedule
    ]);
    mockPrisma.activityBoqAllocation.updateMany = jest.fn(async () => ({ count: 3 }));
    mockPrisma.activityBoqAllocation.count.mockResolvedValue(0);
    // only act-new carries the row's mark
    mockPrisma.activity.findFirst.mockImplementation(async ({ where }) => (where.id === "act-new" && where.mintedByBoqItemId === "boq-1" && where.projectId === "project-1" ? { id: "act-new" } : null));
    mockPrisma.activity.updateMany = jest.fn(async () => ({ count: 1 }));
    await service.deleteBoqItem("project-1", "boq-1", { orgId: "org-1", userId: "pm-1", userRole: "pm" });
    expect(mockPrisma.activity.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "act-later", projectId: "project-1", mintedByBoqItemId: "boq-1" } }));
    expect(mockPrisma.activity.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.activity.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["act-new"] } } }));
    // and a minted activity that already carries an allocation on another row is kept too
    mockPrisma.activity.updateMany.mockClear();
    mockPrisma.activityBoqAllocation.count.mockResolvedValue(1);
    await service.deleteBoqItem("project-1", "boq-1", { orgId: "org-1", userId: "pm-1", userRole: "pm" });
    expect(mockPrisma.activity.updateMany).not.toHaveBeenCalled();
    mockPrisma.activity.findFirst.mockReset();
    delete mockPrisma.activity.updateMany;
    delete mockPrisma.activityBoqAllocation.updateMany;
  });

  it("CX21-544: removing a BOQ link rejects the allocation and retires the activity only if the row minted it and nothing else touched it — a live activity the link pointed at keeps its schedule", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1", orgId: "org-1" });
    mockPrisma.boqRevision.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(null);
    mockPrisma.activityBoqAllocation.findFirst.mockResolvedValue({ id: "al-1", boqItemId: "boq-1", activityId: "act-live", status: "draft", isActive: true, boqItem: { id: "boq-1" }, activity: { id: "act-live", predecessorLinks: [] } });
    mockPrisma.activityBoqAllocation.update.mockResolvedValue({});
    mockPrisma.activityBoqAllocation.count.mockResolvedValue(0);
    mockPrisma.activity.findFirst.mockResolvedValue(null); // not minted by the row
    mockPrisma.activity.update.mockClear();
    const kept = await service.deleteActivity("project-1", "act-live", { orgId: "org-1", userId: "pm-1", allocationId: "al-1" });
    expect(kept).toEqual({ allocationRejected: true, activityRetired: false });
    expect(mockPrisma.activityBoqAllocation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "al-1" }, data: expect.objectContaining({ status: "rejected", isActive: false }) }));
    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
    mockPrisma.activity.findFirst.mockResolvedValue({ id: "act-live" }); // minted by the row, nothing else on it
    const gone = await service.deleteActivity("project-1", "act-live", { orgId: "org-1", userId: "pm-1", allocationId: "al-1" });
    expect(gone.activityRetired).toBe(true);
    expect(mockPrisma.activity.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "act-live" }, data: expect.objectContaining({ isActive: false }) }));
    mockPrisma.activity.findFirst.mockReset();
  });
});

describe("Phase 21D — integrity (release challenge, fourteenth pass)", () => {
  it("CX21-553: deleting a BOQ row re-reads the allocations under the lock — a submission that landed since the eligibility check is caught, not overwritten", async () => {
    const item = { id: "boq-1", projectId: "project-1", code: "1.1", description: "Excavation", isManual: true, isActive: true, sortOrder: 0, createdAt: new Date("2026-09-15T00:00:00.000Z") };
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1", orgId: "org-1" });
    mockPrisma.boqRevision.findFirst.mockResolvedValue(null);
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue(null);
    mockPrisma.boqItem.findFirst.mockResolvedValue(item);
    mockPrisma.boqItem.findMany.mockResolvedValue([]);
    // before the transaction the allocation is a draft; under the lock it is approved
    mockPrisma.activityBoqAllocation.findMany
      .mockResolvedValueOnce([{ id: "al-1", activityId: "act-1", status: "draft" }])
      .mockResolvedValueOnce([{ id: "al-1", activityId: "act-1", status: "approved" }]);
    mockPrisma.$queryRaw = jest.fn(async () => []);
    await expect(service.deleteBoqItem("project-1", "boq-1", { orgId: "org-1", userId: "pm-1", userRole: "pm" })).rejects.toMatchObject({ status: 409, code: "BOQ_ITEM_HAS_LINKED_ALLOCATIONS" });
    expect(mockPrisma.boqItem.delete).not.toHaveBeenCalled();
    delete mockPrisma.$queryRaw;
  });
});
