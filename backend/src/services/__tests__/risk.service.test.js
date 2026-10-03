const { referenceCounterMock } = require("./helpers/reference-counter-mock");
const mockPrisma = {
  ...referenceCounterMock(),
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findMany: jest.fn() },
  risk: {
    count: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  riskActivityLink: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  workflowStatusHistory: {
    create: jest.fn(),
  },
  approvalWorkflowEvent: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  auditEvent: {
    create: jest.fn(),
  },
  recordHistorySnapshot: {
    create: jest.fn(),
  },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const riskService = require("../risk.service");

const activity = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Excavate basement",
  activityCode: "ACT-0001",
  p6ActivityId: null,
  wbsCode: "01.10",
  isCritical: true,
  totalFloat: 0,
  startDate: new Date("2026-06-01T00:00:00.000Z"),
  endDate: new Date("2026-06-10T00:00:00.000Z"),
};
const activityTwo = {
  ...activity,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Form retaining wall",
  activityCode: "ACT-0002",
  wbsCode: "01.20",
};

const riskRow = (patch = {}) => ({
  id: "risk-1",
  projectId: "project-1",
  ref: "RSK-01",
  description: "Utility diversion approval may delay excavation",
  probability: "high",
  impact: "high",
  severity: "HIGH",
  mitigation: "Expedite authority approval",
  responsePlan: "Follow up with utility authority daily",
  residualProbability: "medium",
  residualImpact: "medium",
  residualSeverity: "MEDIUM",
  residualDescription: null,
  phase: "Enabling works",
  owner: "Planning Lead",
  dueDate: new Date("2026-06-15T00:00:00.000Z"),
  escalationLevel: "watch",
  escalationNotes: null,
  status: "monitoring",
  closeoutComment: null,
  closeoutSubmittedBy: null,
  closeoutSubmittedAt: null,
  closedBy: null,
  closedAt: null,
  rejectedBy: null,
  rejectedAt: null,
  rejectionReason: null,
  reopenedBy: null,
  reopenedAt: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  activityLinks: [
    {
      id: "link-1",
      projectId: "project-1",
      riskId: "risk-1",
      activityId: activity.id,
      relationType: "primary",
      scheduleImpactDays: 5,
      costImpact: 1000,
      notes: "Critical excavation path",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
      activity,
    },
  ],
  ...patch,
});

describe("risk service activity impact and closeout workflow", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1" });
    mockPrisma.activity.findMany.mockResolvedValue([activity, activityTwo]);
    mockPrisma.workflowStatusHistory.create.mockImplementation(({ data }) => ({
      id: "history-1",
      ...data,
    }));
    mockPrisma.approvalWorkflowEvent.create.mockImplementation(({ data }) => ({
      id: "event-1",
      ...data,
      createdAt: data.createdAt || new Date("2026-06-01T00:00:00.000Z"),
    }));
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValue([]);
    mockPrisma.auditEvent.create.mockImplementation(({ data }) => ({
      id: "audit-1",
      ...data,
      occurredAt: data.occurredAt || new Date("2026-06-01T00:00:00.000Z"),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    }));
    mockPrisma.recordHistorySnapshot.create.mockResolvedValue({
      id: "snapshot-1",
    });
  });

  it("creates a risk with multiple activity impact links", async () => {
    const created = riskRow({
      status: "open",
      activityLinks: [
        riskRow().activityLinks[0],
        {
          ...riskRow().activityLinks[0],
          id: "link-2",
          activityId: activityTwo.id,
          relationType: "affected",
          scheduleImpactDays: 2,
          costImpact: 500,
          activity: activityTwo,
        },
      ],
    });
    mockPrisma.risk.count.mockResolvedValue(0);
    mockPrisma.risk.create.mockImplementation(({ data }) => ({
      ...created,
      ...data,
      id: "risk-1",
      ref: "RSK-01",
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    }));
    mockPrisma.risk.findFirst.mockResolvedValue(created);

    const result = await riskService.createRisk({
      orgId: "org-1",
      projectId: "project-1",
      payload: {
        description: created.description,
        probability: "high",
        impact: "high",
        severity: "HIGH",
        owner: "Planning Lead",
        dueDate: "2026-06-15",
        activityLinks: [
          {
            activityId: activity.id,
            relationType: "primary",
            scheduleImpactDays: 5,
            costImpact: 1000,
          },
          {
            activityId: activityTwo.id,
            relationType: "affected",
            scheduleImpactDays: 2,
            costImpact: 500,
          },
        ],
      },
      userId: "planner-1",
      userRole: "planning_eng",
    });

    expect(result.activityLinks).toHaveLength(2);
    expect(mockPrisma.riskActivityLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            riskId: "risk-1",
            activityId: activity.id,
            relationType: "primary",
            scheduleImpactDays: 5,
          }),
          expect.objectContaining({
            activityId: activityTwo.id,
            relationType: "affected",
            costImpact: 500,
          }),
        ]),
      }),
    );
    expect(mockPrisma.approvalWorkflowEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: "risk",
          action: "created",
          toStatus: "open",
        }),
      }),
    );
  });

  it("refuses an activityId beside activityLinks that is not this project's, before anything is written (CERT-2)", async () => {
    const foreignActivity = "33333333-3333-4333-8333-333333333333";
    // The project has only its own two activities; the third is another company's.
    mockPrisma.activity.findMany.mockImplementation(({ where }) =>
      Promise.resolve([activity, activityTwo].filter((row) => where.id.in.includes(row.id) && where.projectId === "project-1")),
    );
    const payload = {
      description: "Late delivery of reinforcement",
      probability: "low",
      impact: "medium",
      activityId: foreignActivity,
      activityLinks: [{ activityId: activity.id, relationType: "affects" }],
    };
    await expect(riskService.createRisk({ orgId: "org-1", projectId: "project-1", payload, userId: "planner-1", userRole: "planning_eng" })).rejects.toMatchObject({
      status: 400,
      code: "RISK_ACTIVITY_INVALID",
    });
    expect(mockPrisma.activity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project-1", id: { in: [foreignActivity] }, isActive: true } }));
    expect(mockPrisma.risk.create).not.toHaveBeenCalled();
    expect(mockPrisma.riskActivityLink.createMany).not.toHaveBeenCalled();

    mockPrisma.risk.findFirst.mockResolvedValue(riskRow());
    await expect(
      riskService.updateRisk({ orgId: "org-1", projectId: "project-1", riskId: "risk-1", payload: { mitigation: "x", activityId: foreignActivity, activityLinks: [{ activityId: activity.id }] }, userId: "planner-1", userRole: "planning_eng" }),
    ).rejects.toMatchObject({ status: 400, code: "RISK_ACTIVITY_INVALID" });
    expect(mockPrisma.risk.update).not.toHaveBeenCalled();
  });

  it("submits and approves risk closeout with audit trail", async () => {
    const existing = riskRow();
    const submitted = riskRow({
      status: "submitted",
      closeoutComment: "Permit received and mitigation complete",
      closeoutSubmittedBy: "planner-1",
      closeoutSubmittedAt: new Date("2026-06-11T00:00:00.000Z"),
    });
    const closed = riskRow({
      status: "closed",
      closedBy: "pm-1",
      closedAt: new Date("2026-06-12T00:00:00.000Z"),
    });
    mockPrisma.risk.findFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(submitted);
    mockPrisma.risk.update
      .mockResolvedValueOnce(submitted)
      .mockResolvedValueOnce(riskRow({ status: "closed" }));

    const closeout = await riskService.submitRiskCloseout({
      orgId: "org-1",
      projectId: "project-1",
      riskId: "risk-1",
      payload: {
        closeoutComment: "Permit received and mitigation complete",
      },
      userId: "planner-1",
      userRole: "planning_eng",
    });

    expect(closeout.status).toBe("submitted");
    expect(mockPrisma.workflowStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: "risk",
          oldStatus: "monitoring",
          newStatus: "submitted",
        }),
      }),
    );

    mockPrisma.risk.findFirst
      .mockResolvedValueOnce(submitted)
      .mockResolvedValueOnce(closed);

    const approved = await riskService.approveRiskCloseout({
      orgId: "org-1",
      projectId: "project-1",
      riskId: "risk-1",
      comment: "Accepted by PM",
      userId: "pm-1",
      userRole: "pm",
    });

    expect(approved.status).toBe("closed");
    expect(mockPrisma.approvalWorkflowEvent.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: "risk",
          fromStatus: "submitted",
          toStatus: "closed",
          action: "approved",
          actorRole: "pm",
        }),
      }),
    );
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "risk",
          action: "status_changed",
          newStatus: "closed",
        }),
      }),
    );
  });

  it("rejects risk closeout approval before submission", async () => {
    mockPrisma.risk.findFirst.mockResolvedValueOnce(
      riskRow({ status: "monitoring" }),
    );

    await expect(
      riskService.approveRiskCloseout({
        orgId: "org-1",
        projectId: "project-1",
        riskId: "risk-1",
        comment: "Accepted by PM",
        userId: "pm-1",
        userRole: "pm",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "RISK_NOT_READY_FOR_APPROVAL",
    });

    expect(mockPrisma.risk.update).not.toHaveBeenCalled();
  });

  it("archives risks without deleting activity impact history", async () => {
    const existing = riskRow({ status: "monitoring" });
    const archived = riskRow({
      status: "archived",
      archivedAt: new Date("2026-06-12T00:00:00.000Z"),
      archivedBy: "planner-1",
    });
    mockPrisma.risk.findFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(archived);
    mockPrisma.risk.update.mockResolvedValue(archived);

    const result = await riskService.deleteRisk({
      orgId: "org-1",
      projectId: "project-1",
      riskId: "risk-1",
      userId: "planner-1",
      userRole: "planning_eng",
    });

    expect(mockPrisma.risk.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "risk-1" },
        data: expect.objectContaining({
          status: "archived",
          archivedAt: expect.any(Date),
          archivedBy: "planner-1",
        }),
      }),
    );
    expect(mockPrisma.risk.delete).not.toHaveBeenCalled();
    expect(mockPrisma.riskActivityLink.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.workflowStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: "risk",
          oldStatus: "monitoring",
          newStatus: "archived",
        }),
      }),
    );
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "risk",
          action: "archived",
          oldStatus: "monitoring",
          newStatus: "archived",
        }),
      }),
    );
    expect(result).toMatchObject({
      id: "risk-1",
      archived: true,
      deleted: false,
      status: "archived",
    });
  });
});
