const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  boqItem: { findFirst: jest.fn(), findMany: jest.fn() },
  activity: { findFirst: jest.fn() },
  activityBoqAllocation: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  ipcItem: { findMany: jest.fn() },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const service = require('../activity-boq-allocation.service');

describe('activity BOQ allocation service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.ipcItem.findMany.mockResolvedValue([]);
  });

  it('rejects totals above the BOQ quantity', () => {
    expect(() =>
      service.assertAllocationCapacity({
        boqItem: { id: 'boq-1', qty: 10, amount: 100 },
        existingTotals: { quantity: 9, amount: 50 },
        nextQuantity: 2,
        nextAmount: 10,
      }),
    ).toThrow(/quantity/i);
  });

  it('rejects totals above the BOQ amount', () => {
    expect(() =>
      service.assertAllocationCapacity({
        boqItem: { id: 'boq-1', qty: 10, amount: 100 },
        existingTotals: { quantity: 5, amount: 95 },
        nextQuantity: 1,
        nextAmount: 10,
      }),
    ).toThrow(/amount/i);
  });

  it('enforces tenant scoping before creating allocations', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.createAllocation({
        orgId: 'org-2',
        projectId: 'project-1',
        userId: 'user-1',
        payload: {
          boqItemId: 'boq-1',
          activityId: 'activity-1',
          quantity: 1,
          amount: 10,
        },
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });

    expect(mockPrisma.boqItem.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.activityBoqAllocation.create).not.toHaveBeenCalled();
  });

  it('approves submitted allocations with audit fields', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.activityBoqAllocation.findFirst.mockResolvedValueOnce({
      id: 'allocation-1',
      projectId: 'project-1',
      boqItemId: 'boq-1',
      activityId: 'activity-1',
      quantity: 2,
      amount: 50,
      weight: 25,
      status: 'submitted',
      isActive: true,
    });
    mockPrisma.activityBoqAllocation.findFirst.mockResolvedValueOnce(null);
    mockPrisma.boqItem.findFirst.mockResolvedValue({
      id: 'boq-1',
      projectId: 'project-1',
      qty: 10,
      amount: 100,
    });
    // Approval re-reads the activity for the mapping warnings (PC-3).
    mockPrisma.activity.findFirst.mockResolvedValue({
      id: 'activity-1',
      projectId: 'project-1',
      progressMethod: null,
    });
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([]);
    mockPrisma.activityBoqAllocation.update.mockResolvedValue({
      id: 'allocation-1',
      projectId: 'project-1',
      boqItemId: 'boq-1',
      activityId: 'activity-1',
      quantity: 2,
      amount: 50,
      weight: 25,
      source: 'manual',
      status: 'approved',
      isActive: true,
      notes: null,
      approvedBy: 'user-1',
      approvedAt: new Date('2026-06-08T00:00:00.000Z'),
      boqItem: null,
      activity: null,
    });

    const result = await service.approveAllocation({
      orgId: 'org-1',
      projectId: 'project-1',
      allocationId: 'allocation-1',
      userId: 'user-1',
    });

    expect(result.status).toBe('approved');
    expect(mockPrisma.activityBoqAllocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'allocation-1' },
        data: expect.objectContaining({
          status: 'approved',
          isActive: true,
          approvedBy: 'user-1',
        }),
      }),
    );
    expect(mockPrisma.activityBoqAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          boqItemId: 'boq-1',
          isActive: true,
          status: { in: ['approved'] },
          id: { not: 'allocation-1' },
        }),
      }),
    );
  });

  it('rejects duplicate active BOQ item and activity pairs before create', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.boqItem.findFirst.mockResolvedValue({
      id: 'boq-1',
      projectId: 'project-1',
      qty: 10,
      rate: 25,
      amount: 250,
    });
    mockPrisma.activity.findFirst.mockResolvedValue({
      id: 'activity-1',
      projectId: 'project-1',
    });
    mockPrisma.activityBoqAllocation.findFirst.mockResolvedValue({
      id: 'existing-allocation',
    });

    await expect(
      service.createAllocation({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'user-1',
        payload: {
          boqItemId: 'boq-1',
          activityId: 'activity-1',
          quantity: 1,
          amount: 25,
        },
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ACTIVE_ALLOCATION' });

    expect(mockPrisma.activityBoqAllocation.create).not.toHaveBeenCalled();
  });

  it('normalizes active pair unique-index conflicts to a duplicate allocation error', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.boqItem.findFirst.mockResolvedValue({
      id: 'boq-1',
      projectId: 'project-1',
      qty: 10,
      rate: 25,
      amount: 250,
    });
    mockPrisma.activity.findFirst.mockResolvedValue({
      id: 'activity-1',
      projectId: 'project-1',
    });
    mockPrisma.activityBoqAllocation.findFirst.mockResolvedValue(null);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([]);
    mockPrisma.activityBoqAllocation.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: 'ActivityBoqAllocation_active_pair_key' },
    });

    await expect(
      service.createAllocation({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'user-1',
        payload: {
          boqItemId: 'boq-1',
          activityId: 'activity-1',
          quantity: 1,
          amount: 25,
        },
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ACTIVE_ALLOCATION' });
  });

  it('rolls up only approved active allocation totals by activity', async () => {
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      { activityId: 'activity-1', quantity: 2, amount: 50, weight: 25 },
      { activityId: 'activity-1', quantity: 3, amount: 75, weight: 30 },
      { activityId: 'activity-2', quantity: 1, amount: 10, weight: 5 },
    ]);

    const totals = await service.getApprovedActivityAllocationTotals({
      projectId: 'project-1',
    });

    expect(mockPrisma.activityBoqAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 'project-1',
          status: 'approved',
          isActive: true,
          activity: { isActive: true },
        },
      }),
    );
    expect(totals.get('activity-1')).toMatchObject({
      quantity: 5,
      amount: 125,
      weight: 55,
      count: 2,
    });
  });

  it('builds scheduled, unscheduled, earned, and certified BOQ value states', async () => {
    mockPrisma.boqItem.findMany.mockResolvedValue([
      {
        id: 'boq-1',
        code: '1.1',
        ref: null,
        description: 'Excavation',
        qty: 10,
        amount: 1000,
      },
    ]);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      {
        boqItemId: 'boq-1',
        quantity: 6,
        amount: 600,
        status: 'approved',
        activity: { progress: [{ pctComplete: 50 }] },
      },
      {
        boqItemId: 'boq-1',
        quantity: 1,
        amount: 100,
        status: 'submitted',
        activity: { progress: [{ pctComplete: 100 }] },
      },
    ]);
    mockPrisma.ipcItem.findMany.mockResolvedValue([
      { boqItemId: 'boq-1', currentCert: 250 },
    ]);

    const summary = await service.buildAllocationSummary({
      projectId: 'project-1',
    });

    expect(summary).toMatchObject({
      scheduledQuantity: 6,
      scheduledValue: 600,
      unscheduledQuantity: 4,
      unscheduledValue: 400,
      earnedValue: 300,
      certifiedValue: 250,
    });
    expect(summary.items[0]).toMatchObject({
      scheduledValue: 600,
      unscheduledValue: 400,
      earnedValue: 300,
      certifiedValue: 250,
      pendingAllocatedAmount: 100,
    });
    expect(mockPrisma.ipcItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'project-1',
          status: { in: ['certified', 'paid'] },
        }),
      }),
    );
  });
});
