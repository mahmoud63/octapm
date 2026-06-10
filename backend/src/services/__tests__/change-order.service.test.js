const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  changeOrder: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  activity: { findMany: jest.fn() },
  activityBoqAllocation: { findMany: jest.fn() },
  boqItem: { findMany: jest.fn() },
  projectDocument: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  commercialAttachmentRef: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  commercialCorrespondenceLink: {
    findMany: jest.fn(),
  },
  auditEvent: {
    findMany: jest.fn(),
  },
  changeOrderActivityLink: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  changeOrderAllocationLink: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};
const mockAuditService = {
  ACTIONS: {
    APPROVED: 'approved',
    CREATED: 'created',
    DELETED: 'deleted',
    REJECTED: 'rejected',
    STATUS_CHANGED: 'status_changed',
    UPDATED: 'updated',
  },
  ENTITY_TYPES: { CHANGE_ORDER: 'change_order' },
  recordEvent: jest.fn(),
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => mockAuditService);

const changeOrderService = require('../change-order.service');

const existing = {
  id: 'co-1',
  projectId: 'project-1',
  activityId: 'activity-1',
  ref: 'VO-01',
  description: 'Owner requested wall finish change',
  category: 'variation',
  value: 1250,
  status: 'pending',
  scheduleImpact: 2,
  approvedDate: null,
  approvedAt: null,
  approvalComment: null,
  rejectedReason: null,
};

describe('change order service audit history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'project-1',
      orgId: 'org-1',
    });
    mockPrisma.projectDocument.findMany.mockResolvedValue([]);
    mockPrisma.projectDocument.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.commercialAttachmentRef.findMany.mockResolvedValue([]);
    mockPrisma.commercialCorrespondenceLink.findMany.mockResolvedValue([]);
    mockPrisma.auditEvent.findMany.mockResolvedValue([]);
  });

  it('records approver metadata and emits audit when a change order is approved', async () => {
    mockPrisma.changeOrder.findFirst.mockResolvedValue(existing);
    mockPrisma.projectDocument.findMany.mockResolvedValue([
      {
        id: 'doc-approval',
        projectId: 'project-1',
        documentType: 'workflow_evidence',
        fileName: 'owner-approval.pdf',
        mimeType: 'application/pdf',
        storageKey: 'approval-doc-key',
        scanStatus: 'clean',
        status: 'available',
      },
    ]);
    mockPrisma.changeOrder.update.mockImplementation(({ data }) =>
      Promise.resolve({
        ...existing,
        ...data,
        activity: { id: 'activity-1', name: 'Wall finishes', wbsCode: 'A-100' },
      }),
    );

    const result = await changeOrderService.updateChangeOrder({
      orgId: 'org-1',
      projectId: 'project-1',
      coId: 'co-1',
      userId: 'pm-1',
      payload: {
        status: 'approved',
        approvalComment: 'Approved by owner',
        attachmentRefs: [{ documentId: 'doc-approval' }],
      },
    });

    expect(result.status).toBe('approved');
    expect(mockPrisma.changeOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'co-1' },
        data: expect.objectContaining({
          status: 'approved',
          approvedBy: 'pm-1',
          approvedAt: expect.any(Date),
          approvedDate: expect.any(Date),
          approvalComment: 'Approved by owner',
          updatedBy: 'pm-1',
        }),
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'change_order',
        entityId: 'co-1',
        action: 'approved',
        actorId: 'pm-1',
        oldStatus: 'pending',
        newStatus: 'approved',
        reason: 'Approved by owner',
      }),
    );
  });

  it('preserves audit history when a change order is deleted', async () => {
    mockPrisma.changeOrder.findFirst.mockResolvedValue(existing);
    mockPrisma.changeOrder.delete.mockResolvedValue(existing);

    await changeOrderService.deleteChangeOrder({
      orgId: 'org-1',
      projectId: 'project-1',
      coId: 'co-1',
      userId: 'pm-1',
    });

    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'change_order',
        entityId: 'co-1',
        action: 'deleted',
        actorId: 'pm-1',
        oldStatus: 'pending',
      }),
    );
    expect(mockPrisma.changeOrder.delete).toHaveBeenCalledWith({
      where: { id: 'co-1' },
    });
  });

  it('links a change order to multiple activities and approved BOQ allocations', async () => {
    mockPrisma.changeOrder.count.mockResolvedValue(0);
    mockPrisma.changeOrder.create.mockResolvedValue({
      id: 'co-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      ref: 'VO-01',
      description: 'Changed foundation detail',
      category: 'variation',
      value: 5000,
      status: 'pending',
      scheduleImpact: 3,
      activityLinks: [],
      allocationLinks: [],
    });
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: 'activity-1',
        name: 'Foundation',
        totalFloat: 0,
        isCritical: true,
      },
      {
        id: 'activity-2',
        name: 'Waterproofing',
        totalFloat: 2,
        isCritical: false,
      },
    ]);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      { id: 'alloc-1', boqItemId: 'boq-1' },
    ]);
    mockPrisma.boqItem.findMany.mockResolvedValue([]);

    await changeOrderService.createChangeOrder({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'qs-1',
      payload: {
        description: 'Changed foundation detail',
        value: 5000,
        scheduleImpact: 3,
        activityLinks: [
          {
            activityId: 'activity-1',
            scheduleImpactDays: 3,
            costImpact: 3500,
            baselineFinish: '2026-07-01',
            impactedFinish: '2026-07-04',
            impactBasis: 'Owner-directed foundation detail',
          },
          {
            activityId: 'activity-2',
            scheduleImpactDays: 1,
            costImpact: 1500,
            baselineFinish: '2026-07-03',
            impactedFinish: '2026-07-04',
          },
        ],
        allocationLinks: [{ allocationId: 'alloc-1', amount: 5000 }],
      },
    });

    expect(mockPrisma.changeOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activityId: 'activity-1' }),
      }),
    );
    expect(mockPrisma.changeOrderActivityLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            activityId: 'activity-1',
            criticalPathImpact: true,
            scheduleImpactDays: 3,
            costImpact: 3500,
            baselineFinish: new Date('2026-07-01'),
            impactedFinish: new Date('2026-07-04'),
            impactBasis: 'Owner-directed foundation detail',
            cpmSnapshotJson: expect.objectContaining({
              totalFloat: 0,
              scheduleImpactDays: 3,
              criticalPathImpactDays: 3,
              costImpact: 3500,
            }),
          }),
          expect.objectContaining({
            activityId: 'activity-2',
            floatImpactDays: 2,
            costImpact: 1500,
            criticalPathImpactDays: 0,
          }),
        ]),
      }),
    );
    expect(mockPrisma.changeOrderAllocationLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            allocationId: 'alloc-1',
            boqItemId: 'boq-1',
            amount: 5000,
          }),
        ],
      }),
    );
  });

  it('requires activity impact proof and clean supporting documents before approval', async () => {
    mockPrisma.changeOrder.count.mockResolvedValue(0);
    await expect(
      changeOrderService.createChangeOrder({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'pm-1',
        payload: {
          description: 'Acceleration directive without substantiation',
          value: 12000,
          scheduleImpact: 5,
          status: 'approved',
          activityLinks: [],
          attachmentRefs: [],
        },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'CHANGE_ORDER_IMPACT_PROOF_REQUIRED',
    });

    expect(mockPrisma.changeOrder.create).not.toHaveBeenCalled();
  });

  it('links clean project documents as supporting change order evidence', async () => {
    mockPrisma.changeOrder.count.mockResolvedValue(0);
    mockPrisma.projectDocument.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        projectId: 'project-1',
        documentType: 'workflow_evidence',
        fileName: 'VO-01-notice.pdf',
        mimeType: 'application/pdf',
        storageKey: 'private-doc-key',
        scanStatus: 'clean',
        status: 'available',
      },
    ]);
    mockPrisma.changeOrder.create.mockResolvedValue({
      id: 'co-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      ref: 'VO-01',
      description: 'Changed foundation detail',
      category: 'variation',
      value: 5000,
      status: 'pending',
      scheduleImpact: 3,
      activityLinks: [],
      allocationLinks: [],
    });
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: 'activity-1',
        name: 'Foundation',
        totalFloat: 0,
        isCritical: true,
      },
    ]);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([]);
    mockPrisma.boqItem.findMany.mockResolvedValue([]);

    await changeOrderService.createChangeOrder({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'qs-1',
      payload: {
        description: 'Changed foundation detail',
        value: 5000,
        scheduleImpact: 3,
        activityLinks: [{ activityId: 'activity-1', scheduleImpactDays: 3 }],
        attachmentRefs: [{ documentId: 'doc-1', description: 'Notice' }],
      },
    });

    expect(mockPrisma.projectDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 'project-1',
          id: { in: ['doc-1'] },
          scanStatus: 'clean',
        },
      }),
    );
    expect(mockPrisma.commercialAttachmentRef.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            projectId: 'project-1',
            recordType: 'change_order',
            recordId: 'co-1',
            documentId: 'doc-1',
            fileName: 'VO-01-notice.pdf',
            storageKey: 'private-doc-key',
            description: 'Notice',
          }),
        ],
      }),
    );
    expect(mockPrisma.projectDocument.updateMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        id: { in: ['doc-1'] },
      },
      data: {
        status: 'linked',
        linkedEntityType: 'change_order',
        linkedEntityId: 'co-1',
      },
    });
  });
});
