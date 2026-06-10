const mockPrisma = {
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  procurementSupplier: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  procurementPackage: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  procurementOrder: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  procurementPoLine: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  deliveryReceipt: {
    create: jest.fn(),
  },
  deliveryReceiptLine: {
    create: jest.fn(),
  },
  activityMaterial: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  activityMaterialUsage: {
    create: jest.fn(),
  },
  procurementLeadTimeAlert: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  auditEvent: {
    create: jest.fn(),
  },
  recordHistorySnapshot: {
    create: jest.fn(),
  },
  $transaction: jest.fn((callback) => callback(mockPrisma)),
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const procurementService = require('../procurement.service');

const project = {
  id: 'project-1',
  orgId: 'org-1',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
};

const activity = {
  id: 'activity-1',
  projectId: 'project-1',
  name: 'Install switchgear',
  wbsCode: 'EL.10',
  startDate: new Date('2026-08-01T00:00:00.000Z'),
  endDate: new Date('2026-08-10T00:00:00.000Z'),
  earlyStart: 180,
  earlyFinish: 190,
  baselineStart: null,
  baselineFinish: null,
  lateStart: null,
  lateFinish: null,
  isCritical: true,
  totalFloat: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.project.findFirst.mockResolvedValue(project);
  mockPrisma.activity.findFirst.mockResolvedValue(activity);
  mockPrisma.auditEvent.create.mockResolvedValue({
    id: 'audit-1',
    orgId: 'org-1',
    projectId: 'project-1',
    entityType: 'procurement_order',
    entityId: 'entity-1',
    action: 'created',
    occurredAt: new Date('2026-06-01T00:00:00.000Z'),
    summaryJson: {},
    attachmentsJson: [],
    metadataJson: {},
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
  });
});

describe('procurement service material workflow controls', () => {
  test('requires every PO line to be linked to an activity', async () => {
    await expect(
      procurementService.createPurchaseOrder({
        orgId: 'org-1',
        projectId: 'project-1',
        actor: { id: 'proc-1', role: 'procurement' },
        payload: {
          ref: 'PO-001',
          item: 'Electrical equipment package',
          lines: [
            {
              description: 'Main switchgear',
              unit: 'PCS',
              orderedQty: 1,
              unitCost: 50000,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'PROCUREMENT_ACTIVITY_REQUIRED',
    });

    expect(mockPrisma.procurementOrder.create).not.toHaveBeenCalled();
  });

  test('blocks receipt quantities that exceed the ordered balance', async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      projectId: 'project-1',
      packageId: null,
      supplierId: 'supplier-1',
      status: 'issued',
    });
    mockPrisma.procurementPoLine.findFirst.mockResolvedValue({
      id: 'line-1',
      projectId: 'project-1',
      orderId: 'po-1',
      activityId: activity.id,
      activityMaterialId: 'mat-1',
      description: 'Switchgear',
      unit: 'PCS',
      orderedQty: 10,
      receivedQty: 8,
      rejectedQty: 0,
      issuedQty: 0,
      consumedQty: 0,
      status: 'ordered',
      leadWeeks: 12,
      requiredTiming: 'activity_start',
      needOffsetDays: 0,
      bufferDays: 14,
      promisedDate: new Date('2026-08-15T00:00:00.000Z'),
      activity,
    });

    await expect(
      procurementService.recordDeliveryReceipt({
        orgId: 'org-1',
        projectId: 'project-1',
        orderId: 'po-1',
        actor: { id: 'wh-1', role: 'warehouse' },
        payload: {
          receiptNumber: 'GRN-001',
          lines: [{ poLineId: 'line-1', acceptedQty: 3 }],
        },
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'RECEIPT_QTY_EXCEEDS_ORDERED',
    });

    expect(mockPrisma.deliveryReceipt.create).not.toHaveBeenCalled();
  });

  test('posts receipts, updates line/material balances, and recalculates alert state', async () => {
    const line = {
      id: 'line-1',
      projectId: 'project-1',
      orderId: 'po-1',
      packageId: 'pkg-1',
      supplierId: 'supplier-1',
      activityId: activity.id,
      activityMaterialId: 'mat-1',
      description: 'Switchgear',
      unit: 'PCS',
      orderedQty: 10,
      receivedQty: 2,
      rejectedQty: 0,
      issuedQty: 0,
      consumedQty: 0,
      status: 'ordered',
      leadWeeks: 12,
      requiredTiming: 'activity_start',
      needOffsetDays: 0,
      bufferDays: 14,
      promisedDate: new Date('2026-07-20T00:00:00.000Z'),
      activity,
    };

    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: 'po-1',
      projectId: 'project-1',
      packageId: 'pkg-1',
      supplierId: 'supplier-1',
      status: 'issued',
    });
    mockPrisma.procurementPoLine.findFirst.mockResolvedValue(line);
    mockPrisma.deliveryReceipt.create.mockResolvedValue({
      id: 'receipt-1',
      projectId: 'project-1',
      orderId: 'po-1',
      receiptNumber: 'GRN-001',
    });
    mockPrisma.deliveryReceiptLine.create.mockResolvedValue({
      id: 'receipt-line-1',
      poLineId: 'line-1',
      acceptedQty: 4,
      issuedQty: 3,
    });
    mockPrisma.procurementPoLine.update.mockResolvedValue({
      ...line,
      receivedQty: 6,
      issuedQty: 3,
      status: 'partial',
      activity,
    });
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([
      { orderedQty: 10, receivedQty: 6, issuedQty: 3 },
    ]);
    mockPrisma.activityMaterial.update.mockResolvedValue({
      id: 'mat-1',
      receivedQty: 4,
      issuedQty: 3,
      status: 'partial',
    });
    mockPrisma.procurementLeadTimeAlert.findFirst.mockResolvedValue({
      id: 'alert-1',
      status: 'open',
    });
    mockPrisma.procurementLeadTimeAlert.update.mockResolvedValue({
      id: 'alert-1',
      status: 'resolved',
    });

    const result = await procurementService.recordDeliveryReceipt({
      orgId: 'org-1',
      projectId: 'project-1',
      orderId: 'po-1',
      actor: { id: 'wh-1', role: 'warehouse' },
      payload: {
        receiptNumber: 'GRN-001',
        lines: [{ poLineId: 'line-1', acceptedQty: 4, issuedQty: 3 }],
      },
    });

    expect(result.receipt.id).toBe('receipt-1');
    expect(mockPrisma.procurementPoLine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'line-1' },
        data: expect.objectContaining({
          receivedQty: 6,
          issuedQty: 3,
          status: 'partial',
        }),
      }),
    );
    expect(mockPrisma.activityMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mat-1' },
        data: expect.objectContaining({
          receivedQty: { increment: 4 },
          issuedQty: { increment: 3 },
        }),
      }),
    );
    expect(mockPrisma.procurementOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-1' },
        data: expect.objectContaining({ status: 'partial' }),
      }),
    );
  });

  test('blocks activity usage that exceeds issued material quantity', async () => {
    mockPrisma.activityMaterial.findFirst.mockResolvedValue({
      id: 'mat-1',
      projectId: 'project-1',
      activityId: activity.id,
      name: 'Rebar',
      issuedQty: 40,
      consumedQty: 35,
      wasteQty: 1,
    });

    await expect(
      procurementService.recordActivityMaterialUsage({
        orgId: 'org-1',
        projectId: 'project-1',
        activityId: activity.id,
        materialId: 'mat-1',
        actor: { id: 'site-1', role: 'site_engineer' },
        payload: { usedQty: 5, wasteQty: 1 },
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'MATERIAL_USAGE_EXCEEDS_ISSUED_QTY',
    });

    expect(mockPrisma.activityMaterialUsage.create).not.toHaveBeenCalled();
  });
});
