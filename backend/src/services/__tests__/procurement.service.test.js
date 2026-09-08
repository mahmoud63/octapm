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
  dailyReport: {
    findFirst: jest.fn(),
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
  mockPrisma.dailyReport.findFirst.mockResolvedValue(null);
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
  test('derives package required-on-site and latest-order dates from linked activity', async () => {
    mockPrisma.procurementSupplier.findFirst.mockResolvedValue(null);
    mockPrisma.procurementPackage.create.mockResolvedValue({
      id: 'pkg-1',
      projectId: 'project-1',
      supplierId: null,
      activityId: activity.id,
      packageNumber: 'PKG-001',
      title: 'Switchgear package',
      status: 'planning',
      requiredTiming: 'activity_start',
      needOffsetDays: 5,
      leadWeeks: 8,
      bufferDays: 10,
      requiredOnSiteDate: new Date('2026-07-27T00:00:00.000Z'),
      latestOrderDate: new Date('2026-05-22T00:00:00.000Z'),
    });
    mockPrisma.procurementLeadTimeAlert.findFirst.mockResolvedValue(null);
    mockPrisma.procurementLeadTimeAlert.create.mockResolvedValue({
      id: 'alert-1',
      status: 'open',
    });

    const row = await procurementService.createPackage({
      orgId: 'org-1',
      projectId: 'project-1',
      actor: { id: 'proc-1', role: 'procurement' },
      payload: {
        packageNumber: 'PKG-001',
        title: 'Switchgear package',
        activityId: activity.id,
        requiredTiming: 'activity_start',
        needOffsetDays: 5,
        leadWeeks: 8,
        bufferDays: 10,
      },
    });

    expect(mockPrisma.procurementPackage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requiredOnSiteDate: new Date('2026-07-27T00:00:00.000Z'),
          latestOrderDate: new Date('2026-05-22T00:00:00.000Z'),
        }),
      }),
    );
    expect(row.procurementRisk.orderByDate).toEqual(
      new Date('2026-05-22T00:00:00.000Z'),
    );
  });

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

  /**
   * A new order used to be stored as `issued` — reading as sent to a supplier
   * with submittedAt, approvedAt and issuedAt all null, and the register's
   * approval workflow bypassed entirely (OCTA-PROC-APPROVAL-067).
   */
  test('a new order is planned, not issued to a supplier', async () => {
    // The fake stops short of a full order, which is fine — what matters is
    // the status it was asked to store.
    await procurementService
      .createPurchaseOrder({
        orgId: 'org-1',
        projectId: 'project-1',
        actor: { id: 'proc-1', role: 'procurement' },
        payload: {
          ref: 'PO-002',
          item: 'Switchgear',
          activityId: 'activity-1',
          lines: [
            {
              description: 'Main switchgear',
              unit: 'PCS',
              orderedQty: 1,
              unitCost: 50000,
              activityId: 'activity-1',
            },
          ],
        },
      })
      .catch(() => null);

    expect(mockPrisma.procurementOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'planned' }) }),
    );
  });

  test('refuses to create an order already declared approved or issued', async () => {
    for (const status of ['approved', 'issued', 'acknowledged']) {
      await expect(
        procurementService.createPurchaseOrder({
          orgId: 'org-1',
          projectId: 'project-1',
          actor: { id: 'proc-1', role: 'procurement' },
          payload: {
            ref: `PO-${status}`,
            item: 'Switchgear',
            activityId: 'activity-1',
            status,
            lines: [
              { description: 'Main switchgear', unit: 'PCS', orderedQty: 1, unitCost: 1, activityId: 'activity-1' },
            ],
          },
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: 'PO_STATUS_NOT_PLANNABLE',
        details: expect.objectContaining({ requested: status }),
      });
    }
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

  test('links material usage to the matching daily report for traceability', async () => {
    mockPrisma.activityMaterial.findFirst.mockResolvedValue({
      id: 'mat-1',
      projectId: 'project-1',
      activityId: activity.id,
      name: 'Rebar',
      issuedQty: 40,
      consumedQty: 10,
      wasteQty: 0,
    });
    mockPrisma.dailyReport.findFirst.mockResolvedValue({
      id: 'report-1',
      projectId: 'project-1',
      activityId: activity.id,
      status: 'approved',
    });
    mockPrisma.activityMaterialUsage.create.mockResolvedValue({
      id: 'usage-1',
      dailyReportId: 'report-1',
      usedQty: 5,
      wasteQty: 0,
    });
    mockPrisma.activityMaterial.update.mockResolvedValue({
      id: 'mat-1',
      consumedQty: 15,
      wasteQty: 0,
      status: 'issued',
    });

    await procurementService.recordActivityMaterialUsage({
      orgId: 'org-1',
      projectId: 'project-1',
      activityId: activity.id,
      materialId: 'mat-1',
      actor: { id: 'site-1', role: 'site_engineer' },
      payload: { usedQty: 5, wasteQty: 0, dailyReportId: 'report-1' },
    });

    expect(mockPrisma.activityMaterialUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dailyReportId: 'report-1',
          activityId: activity.id,
        }),
      }),
    );
  });

  test('resolves lead-time alerts with audited workflow metadata', async () => {
    mockPrisma.procurementLeadTimeAlert.findFirst.mockResolvedValue({
      id: 'alert-1',
      projectId: 'project-1',
      activityId: activity.id,
      packageId: 'pkg-1',
      poLineId: null,
      activityMaterialId: null,
      status: 'acknowledged',
      severity: 'critical',
      reason: 'order_by_missed',
      needDate: new Date('2026-07-27T00:00:00.000Z'),
      orderByDate: new Date('2026-05-22T00:00:00.000Z'),
      expectedDeliveryDate: null,
    });
    mockPrisma.procurementLeadTimeAlert.update.mockResolvedValue({
      id: 'alert-1',
      projectId: 'project-1',
      activityId: activity.id,
      packageId: 'pkg-1',
      poLineId: null,
      activityMaterialId: null,
      status: 'resolved',
      severity: 'critical',
      reason: 'order_by_missed',
      needDate: new Date('2026-07-27T00:00:00.000Z'),
      orderByDate: new Date('2026-05-22T00:00:00.000Z'),
      expectedDeliveryDate: null,
    });

    await procurementService.resolveLeadTimeAlert({
      orgId: 'org-1',
      projectId: 'project-1',
      alertId: 'alert-1',
      actor: { id: 'pm-1', role: 'pm' },
      payload: { note: 'PO recovered with expediting plan' },
    });

    expect(mockPrisma.procurementLeadTimeAlert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alert-1' },
        data: expect.objectContaining({
          status: 'resolved',
          resolvedBy: 'pm-1',
          resolvedAt: expect.any(Date),
        }),
      }),
    );
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'procurement_alert',
          action: 'status_changed',
          oldStatus: 'acknowledged',
          newStatus: 'resolved',
          reason: 'PO recovered with expediting plan',
          summaryJson: expect.objectContaining({
            transition: 'alert.resolve',
            packageId: 'pkg-1',
          }),
        }),
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
