const mockPrisma = {
  approvalWorkflowEvent: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const approvalWorkflowService = require("../approval-workflow.service");

describe("approval workflow state machine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.approvalWorkflowEvent.create.mockResolvedValue({
      id: "approval-event-1",
      orgId: "org-1",
      projectId: "project-1",
      recordType: "change_order",
      recordId: "co-1",
      workflowType: "change_order",
      action: "approved",
      fromStatus: "pending",
      toStatus: "approved",
      actorId: "pm-1",
      actorRole: "pm",
      decision: "approved",
      reason: "Owner approval received",
      comment: null,
      metadataJson: { value: 1200 },
      createdAt: new Date("2026-06-10T10:00:00.000Z"),
    });
  });

  it("records the actor, decision, and status transition for an approval", async () => {
    const result = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
      recordId: "co-1",
      fromStatus: "pending",
      toStatus: "approved",
      actorId: "pm-1",
      actorRole: "pm",
      reason: "Owner approval received",
      metadata: { value: 1200 },
    });

    expect(result.action).toBe("approved");
    expect(mockPrisma.approvalWorkflowEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        projectId: "project-1",
        recordType: "change_order",
        recordId: "co-1",
        workflowType: "change_order",
        action: "approved",
        fromStatus: "pending",
        toStatus: "approved",
        actorId: "pm-1",
        actorRole: "pm",
        decision: "approved",
        reason: "Owner approval received",
        metadataJson: { value: 1200 },
      }),
    });
  });

  it("requires change orders to be submitted before approval", async () => {
    await expect(
      approvalWorkflowService.recordTransition({
        tx: mockPrisma,
        orgId: "org-1",
        projectId: "project-1",
        recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
        recordId: "co-1",
        fromStatus: "draft",
        toStatus: "approved",
        actorId: "pm-1",
      }),
    ).rejects.toMatchObject({
      code: "APPROVAL_WORKFLOW_INVALID_TRANSITION",
    });

    expect(mockPrisma.approvalWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it("records change order submit and reopen workflow events", async () => {
    mockPrisma.approvalWorkflowEvent.create
      .mockResolvedValueOnce({
        id: "approval-event-submit",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "change_order",
        recordId: "co-1",
        workflowType: "change_order",
        action: "submitted",
        fromStatus: "draft",
        toStatus: "pending",
        actorId: "qs-1",
        actorRole: "qs",
        decision: "submitted",
        reason: null,
        comment: "Ready",
        metadataJson: {},
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "approval-event-reopen",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "change_order",
        recordId: "co-1",
        workflowType: "change_order",
        action: "reopened",
        fromStatus: "rejected",
        toStatus: "draft",
        actorId: "qs-1",
        actorRole: "qs",
        decision: "reopened",
        reason: null,
        comment: "Revise proof",
        metadataJson: {},
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      });

    const submitted = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
      recordId: "co-1",
      fromStatus: "draft",
      toStatus: "pending",
      actorId: "qs-1",
      actorRole: "qs",
      comment: "Ready",
    });
    const reopened = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
      recordId: "co-1",
      fromStatus: "rejected",
      toStatus: "draft",
      actorId: "qs-1",
      actorRole: "qs",
      comment: "Revise proof",
    });

    expect(submitted.action).toBe("submitted");
    expect(reopened.action).toBe("reopened");
  });

  it("rejects direct approval when a record must be submitted first", async () => {
    await expect(
      approvalWorkflowService.recordTransition({
        tx: mockPrisma,
        orgId: "org-1",
        projectId: "project-1",
        recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
        recordId: "alloc-1",
        fromStatus: "draft",
        toStatus: "approved",
        actorId: "pm-1",
      }),
    ).rejects.toMatchObject({
      code: "APPROVAL_WORKFLOW_INVALID_TRANSITION",
    });

    expect(mockPrisma.approvalWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it("requires a reason for rejection decisions", async () => {
    await expect(
      approvalWorkflowService.recordTransition({
        tx: mockPrisma,
        orgId: "org-1",
        projectId: "project-1",
        recordType: approvalWorkflowService.RECORD_TYPES.SUBMITTAL,
        recordId: "sub-1",
        fromStatus: "under_review",
        toStatus: "rejected",
        actorId: "pm-1",
      }),
    ).rejects.toMatchObject({
      code: "APPROVAL_WORKFLOW_REASON_REQUIRED",
    });
  });

  it("records RFI response approval as an approval decision", async () => {
    mockPrisma.approvalWorkflowEvent.create.mockResolvedValueOnce({
      id: "approval-event-2",
      orgId: "org-1",
      projectId: "project-1",
      recordType: "rfi",
      recordId: "rfi-1",
      workflowType: "rfi",
      action: "approved",
      fromStatus: "answered",
      toStatus: "closed",
      actorId: "pm-1",
      actorRole: "pm",
      decision: "approved",
      reason: null,
      comment: "Accepted",
      metadataJson: {},
      createdAt: new Date("2026-06-10T10:00:00.000Z"),
    });

    const result = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.RFI,
      recordId: "rfi-1",
      fromStatus: "answered",
      toStatus: "closed",
      actorId: "pm-1",
      actorRole: "pm",
      comment: "Accepted",
    });

    expect(result.action).toBe("approved");
    expect(result.decision).toBe("approved");
  });

  it("records forced RFI submit and submittal review events without changing status", async () => {
    mockPrisma.approvalWorkflowEvent.create
      .mockResolvedValueOnce({
        id: "approval-event-rfi-submit",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "rfi",
        recordId: "rfi-1",
        workflowType: "rfi",
        action: "submitted",
        fromStatus: "open",
        toStatus: "open",
        actorId: "site-1",
        actorRole: "site_engineer",
        decision: "submitted",
        reason: null,
        comment: "Submitted",
        metadataJson: {},
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "approval-event-sub-review",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "submittal",
        recordId: "sub-1",
        workflowType: "submittal",
        action: "reviewed",
        fromStatus: "under_review",
        toStatus: "under_review",
        actorId: "qs-1",
        actorRole: "qs",
        decision: "reviewed",
        reason: null,
        comment: "Reviewed",
        metadataJson: {},
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      });

    const rfiSubmit = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.RFI,
      recordId: "rfi-1",
      fromStatus: "open",
      toStatus: "open",
      actorId: "site-1",
      actorRole: "site_engineer",
      comment: "Submitted",
      force: true,
    });
    const submittalReview = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.SUBMITTAL,
      recordId: "sub-1",
      fromStatus: "under_review",
      toStatus: "under_review",
      actorId: "qs-1",
      actorRole: "qs",
      comment: "Reviewed",
      force: true,
    });

    expect(rfiSubmit.action).toBe("submitted");
    expect(submittalReview.action).toBe("reviewed");
  });

  it("records NCR closeout submission, approval, and rejection transitions", async () => {
    mockPrisma.approvalWorkflowEvent.create
      .mockResolvedValueOnce({
        id: "approval-event-submit",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "ncr",
        recordId: "ncr-1",
        workflowType: "ncr",
        action: "submitted",
        fromStatus: "open",
        toStatus: "submitted",
        actorId: "site-1",
        actorRole: "site_engineer",
        decision: "submitted",
        reason: null,
        comment: "Corrected and ready",
        metadataJson: {},
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "approval-event-approve",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "ncr",
        recordId: "ncr-1",
        workflowType: "ncr",
        action: "approved",
        fromStatus: "submitted",
        toStatus: "closed",
        actorId: "pm-1",
        actorRole: "pm",
        decision: "approved",
        reason: null,
        comment: "Accepted",
        metadataJson: {},
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "approval-event-reject",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "ncr",
        recordId: "ncr-2",
        workflowType: "ncr",
        action: "rejected",
        fromStatus: "submitted",
        toStatus: "open",
        actorId: "pm-1",
        actorRole: "pm",
        decision: "rejected",
        reason: "Corrective action incomplete",
        comment: "Corrective action incomplete",
        metadataJson: {},
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      });

    const submitted = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.NCR,
      recordId: "ncr-1",
      fromStatus: "open",
      toStatus: "submitted",
      actorId: "site-1",
      actorRole: "site_engineer",
      comment: "Corrected and ready",
    });
    const approved = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.NCR,
      recordId: "ncr-1",
      fromStatus: "submitted",
      toStatus: "closed",
      actorId: "pm-1",
      actorRole: "pm",
      comment: "Accepted",
    });
    const rejected = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.NCR,
      recordId: "ncr-2",
      fromStatus: "submitted",
      toStatus: "open",
      actorId: "pm-1",
      actorRole: "pm",
      reason: "Corrective action incomplete",
      comment: "Corrective action incomplete",
    });

    expect(submitted.action).toBe("submitted");
    expect(approved.action).toBe("approved");
    expect(rejected.action).toBe("rejected");
  });

  it("rejects direct NCR approval before closeout submission", async () => {
    await expect(
      approvalWorkflowService.recordTransition({
        tx: mockPrisma,
        orgId: "org-1",
        projectId: "project-1",
        recordType: approvalWorkflowService.RECORD_TYPES.NCR,
        recordId: "ncr-1",
        fromStatus: "open",
        toStatus: "closed",
        actorId: "pm-1",
      }),
    ).rejects.toMatchObject({
      code: "APPROVAL_WORKFLOW_INVALID_TRANSITION",
    });
  });

  it("records risk closeout submission, PM decision, and reopen transitions", async () => {
    mockPrisma.approvalWorkflowEvent.create
      .mockResolvedValueOnce({
        id: "approval-event-risk-submit",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "risk",
        recordId: "risk-1",
        workflowType: "risk",
        action: "submitted",
        fromStatus: "monitoring",
        toStatus: "submitted",
        actorId: "planner-1",
        actorRole: "planning_eng",
        decision: "submitted",
        reason: null,
        comment: "Mitigation complete",
        metadataJson: {},
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "approval-event-risk-approve",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "risk",
        recordId: "risk-1",
        workflowType: "risk",
        action: "approved",
        fromStatus: "submitted",
        toStatus: "closed",
        actorId: "pm-1",
        actorRole: "pm",
        decision: "approved",
        reason: null,
        comment: "Accepted",
        metadataJson: {},
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "approval-event-risk-reject",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "risk",
        recordId: "risk-2",
        workflowType: "risk",
        action: "rejected",
        fromStatus: "submitted",
        toStatus: "monitoring",
        actorId: "pm-1",
        actorRole: "pm",
        decision: "rejected",
        reason: "Residual risk remains high",
        comment: "Residual risk remains high",
        metadataJson: {},
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "approval-event-risk-reopen",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "risk",
        recordId: "risk-1",
        workflowType: "risk",
        action: "reopened",
        fromStatus: "closed",
        toStatus: "monitoring",
        actorId: "pm-1",
        actorRole: "pm",
        decision: "reopened",
        reason: null,
        comment: "Impact returned",
        metadataJson: {},
        createdAt: new Date("2026-06-10T10:00:00.000Z"),
      });

    const submitted = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: "risk-1",
      fromStatus: "monitoring",
      toStatus: "submitted",
      actorId: "planner-1",
      actorRole: "planning_eng",
      comment: "Mitigation complete",
    });
    const approved = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: "risk-1",
      fromStatus: "submitted",
      toStatus: "closed",
      actorId: "pm-1",
      actorRole: "pm",
      comment: "Accepted",
    });
    const rejected = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: "risk-2",
      fromStatus: "submitted",
      toStatus: "monitoring",
      actorId: "pm-1",
      actorRole: "pm",
      reason: "Residual risk remains high",
      comment: "Residual risk remains high",
    });
    const reopened = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: "risk-1",
      fromStatus: "closed",
      toStatus: "monitoring",
      actorId: "pm-1",
      actorRole: "pm",
      comment: "Impact returned",
    });

    expect(submitted.action).toBe("submitted");
    expect(approved.action).toBe("approved");
    expect(rejected.action).toBe("rejected");
    expect(reopened.action).toBe("reopened");
  });

  it("requires a PM rejection reason for risk closeout", async () => {
    await expect(
      approvalWorkflowService.recordTransition({
        tx: mockPrisma,
        orgId: "org-1",
        projectId: "project-1",
        recordType: approvalWorkflowService.RECORD_TYPES.RISK,
        recordId: "risk-1",
        fromStatus: "submitted",
        toStatus: "monitoring",
        actorId: "pm-1",
      }),
    ).rejects.toMatchObject({
      code: "APPROVAL_WORKFLOW_REASON_REQUIRED",
    });
  });

  it("records safety closeout submission and PM reopen transitions", async () => {
    mockPrisma.approvalWorkflowEvent.create.mockResolvedValueOnce({
      id: "approval-event-safety-submit",
      orgId: "org-1",
      projectId: "project-1",
      recordType: "safety_incident",
      recordId: "safe-1",
      workflowType: "safety_incident",
      action: "submitted",
      fromStatus: "investigating",
      toStatus: "submitted",
      actorId: "site-1",
      actorRole: "site_engineer",
      decision: "submitted",
      reason: null,
      comment: "Corrective action complete",
      metadataJson: {},
      createdAt: new Date("2026-06-10T10:00:00.000Z"),
    });

    const submitted = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.SAFETY_INCIDENT,
      recordId: "safe-1",
      fromStatus: "investigating",
      toStatus: "submitted",
      actorId: "site-1",
      actorRole: "site_engineer",
      comment: "Corrective action complete",
    });

    expect(submitted.action).toBe("submitted");

    mockPrisma.approvalWorkflowEvent.create.mockResolvedValueOnce({
      id: "approval-event-safety-reopen",
      orgId: "org-1",
      projectId: "project-1",
      recordType: "safety_incident",
      recordId: "safe-1",
      workflowType: "safety_incident",
      action: "reopened",
      fromStatus: "closed",
      toStatus: "investigating",
      actorId: "pm-1",
      actorRole: "pm",
      decision: "reopened",
      reason: null,
      comment: "Follow-up failed",
      metadataJson: {},
      createdAt: new Date("2026-06-10T10:00:00.000Z"),
    });

    const reopened = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      recordType: approvalWorkflowService.RECORD_TYPES.SAFETY_INCIDENT,
      recordId: "safe-1",
      fromStatus: "closed",
      toStatus: "investigating",
      actorId: "pm-1",
      actorRole: "pm",
      comment: "Follow-up failed",
    });

    expect(reopened.action).toBe("reopened");
  });
});
