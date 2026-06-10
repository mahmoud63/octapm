const mockPrisma = {
  approvalWorkflowEvent: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const approvalWorkflowService = require('../approval-workflow.service');

describe('approval workflow state machine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.approvalWorkflowEvent.create.mockResolvedValue({
      id: 'approval-event-1',
      orgId: 'org-1',
      projectId: 'project-1',
      recordType: 'change_order',
      recordId: 'co-1',
      workflowType: 'change_order',
      action: 'approved',
      fromStatus: 'pending',
      toStatus: 'approved',
      actorId: 'pm-1',
      actorRole: 'pm',
      decision: 'approved',
      reason: 'Owner approval received',
      comment: null,
      metadataJson: { value: 1200 },
      createdAt: new Date('2026-06-10T10:00:00.000Z'),
    });
  });

  it('records the actor, decision, and status transition for an approval', async () => {
    const result = await approvalWorkflowService.recordTransition({
      tx: mockPrisma,
      orgId: 'org-1',
      projectId: 'project-1',
      recordType: approvalWorkflowService.RECORD_TYPES.CHANGE_ORDER,
      recordId: 'co-1',
      fromStatus: 'pending',
      toStatus: 'approved',
      actorId: 'pm-1',
      actorRole: 'pm',
      reason: 'Owner approval received',
      metadata: { value: 1200 },
    });

    expect(result.action).toBe('approved');
    expect(mockPrisma.approvalWorkflowEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        recordType: 'change_order',
        recordId: 'co-1',
        workflowType: 'change_order',
        action: 'approved',
        fromStatus: 'pending',
        toStatus: 'approved',
        actorId: 'pm-1',
        actorRole: 'pm',
        decision: 'approved',
        reason: 'Owner approval received',
        metadataJson: { value: 1200 },
      }),
    });
  });

  it('rejects direct approval when a record must be submitted first', async () => {
    await expect(
      approvalWorkflowService.recordTransition({
        tx: mockPrisma,
        orgId: 'org-1',
        projectId: 'project-1',
        recordType: approvalWorkflowService.RECORD_TYPES.BOQ_ALLOCATION,
        recordId: 'alloc-1',
        fromStatus: 'draft',
        toStatus: 'approved',
        actorId: 'pm-1',
      }),
    ).rejects.toMatchObject({
      code: 'APPROVAL_WORKFLOW_INVALID_TRANSITION',
    });

    expect(mockPrisma.approvalWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('requires a reason for rejection decisions', async () => {
    await expect(
      approvalWorkflowService.recordTransition({
        tx: mockPrisma,
        orgId: 'org-1',
        projectId: 'project-1',
        recordType: approvalWorkflowService.RECORD_TYPES.SUBMITTAL,
        recordId: 'sub-1',
        fromStatus: 'under_review',
        toStatus: 'rejected',
        actorId: 'pm-1',
      }),
    ).rejects.toMatchObject({
      code: 'APPROVAL_WORKFLOW_REASON_REQUIRED',
    });
  });
});
