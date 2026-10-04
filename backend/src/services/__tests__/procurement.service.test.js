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
  // What a PO line's cost coding may name (CERT-2).
  boqItem: { findMany: jest.fn() },
  budgetLine: { findMany: jest.fn() },
  materialMaster: { findMany: jest.fn() },
  costCode: { findMany: jest.fn() },
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

  /**
   * CERT-2 injection sweep: a PO line took another company's BOQ item, budget
   * line and cost code, stored them on procurement_po_line and answered them
   * back. Each is refused exactly as an id that exists nowhere is, before the
   * order is written; the project's own are kept.
   */
  describe('what a PO line\'s cost coding may name (CERT-2)', () => {
    const rows = {
      boqItem: [{ id: 'boq-1', projectId: 'project-1' }, { id: 'boq-x', projectId: 'project-x' }],
      budgetLine: [{ id: 'bl-1', projectId: 'project-1' }, { id: 'bl-x', projectId: 'project-x' }],
      materialMaster: [{ id: 'mm-1', projectId: 'project-1' }, { id: 'mm-x', projectId: 'project-x' }],
      costCode: [{ id: 'cc-1', orgId: 'org-1' }, { id: 'cc-x', orgId: 'org-x' }],
    };
    beforeEach(() => {
      for (const [model, list] of Object.entries(rows)) {
        mockPrisma[model].findMany.mockImplementation(async ({ where }) =>
          list.filter((row) => where.id.in.includes(row.id) && (where.projectId ? row.projectId === where.projectId : row.orgId === where.orgId)),
        );
      }
    });
    afterEach(() => {
      for (const model of Object.keys(rows)) mockPrisma[model].findMany.mockReset();
      mockPrisma.procurementOrder.create.mockReset();
    });
    const order = (line) =>
      procurementService.createPurchaseOrder({
        orgId: 'org-1',
        projectId: 'project-1',
        actor: { id: 'proc-1', role: 'procurement' },
        payload: {
          ref: 'PO-CERT2',
          item: 'Switchgear',
          lines: [{ description: 'Main switchgear', unit: 'PCS', orderedQty: 1, unitCost: 1, activityId: 'activity-1', ...line }],
        },
      });

    test.each([
      ['boqItemId', 'boq-1', 'boq-x', 'BOQ_ITEM_NOT_FOUND'],
      ['budgetLineId', 'bl-1', 'bl-x', 'BUDGET_LINE_NOT_FOUND'],
      ['costCodeId', 'cc-1', 'cc-x', 'COST_CODE_NOT_FOUND'],
      ['materialMasterId', 'mm-1', 'mm-x', 'MATERIAL_NOT_FOUND'],
    ])('%s: another company\'s is refused like one that exists nowhere; the project\'s own is kept', async (field, own, foreign, code) => {
      await expect(order({ [field]: foreign })).rejects.toMatchObject({ status: 404, code });
      await expect(order({ [field]: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ status: 404, code });
      expect(mockPrisma.procurementOrder.create).not.toHaveBeenCalled();
      expect(mockPrisma.procurementPoLine.create).not.toHaveBeenCalled();
      expect(mockPrisma.auditEvent.create).not.toHaveBeenCalled();

      // The fake stops short of a full order; what matters is the line it was asked to store.
      mockPrisma.procurementOrder.create.mockResolvedValue({ id: 'order-1', projectId: 'project-1', ref: 'PO-1', status: 'planned', leadWeeks: 0, requiredTiming: 'activity_start', needOffsetDays: 0, bufferDays: 14 });
      const outcome = await order({ [field]: own }).catch((error) => error);
      expect(outcome?.code).not.toBe(code);
      expect(mockPrisma.procurementPoLine.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ [field]: own }) }),
      );
    });

    // CERT-2 shapes: a cost code sent in another shape was skipped by the check
    // and then stored as String(value) — ["<id>"] became another company's id.
    test.each([
      ['an array', (id) => [id]],
      ['a nested array', (id) => [[id]]],
      ['an object', (id) => ({ id })],
      ['a number', () => 12345],
    ])('costCodeId sent as %s is refused like a cost code that exists nowhere, own or foreign alike, before the order is written', async (_label, shape) => {
      for (const id of ['cc-1', 'cc-x', '00000000-0000-4000-8000-000000000000']) {
        await expect(order({ costCodeId: shape(id) })).rejects.toMatchObject({ status: 404, code: 'COST_CODE_NOT_FOUND' });
      }
      expect(mockPrisma.procurementOrder.create).not.toHaveBeenCalled();
      expect(mockPrisma.procurementPoLine.create).not.toHaveBeenCalled();
    });
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

  /**
   * Delivery receipts moved out of this service.
   *
   * Two tests stood here, driving a second receipt writer that recorded the
   * delivery and updated the order but put nothing on a shelf. There is one
   * writer now, in goods-receipt.service, and its tests cover the same
   * ground: over-receipt is refused there, and the material balance and
   * lead-time alert it now moves are asserted there too.
   */

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

/**
 * CERT-2 (bodies-4): the lead-time alert is one per procurement package too.
 * A second order (or a material) on a package that already had an alert found
 * nothing by its own key, created a second alert for the package, broke the
 * unique (projectId, packageId) key, and the buyer was answered 409 with
 * Prisma's own text. The alert holding the package is brought up to date.
 */
describe('a lead-time alert per package (CERT-2)', () => {
  const day = (n) => new Date(Date.now() + n * 86_400_000);
  // Promised five weeks after it is needed: at risk.
  const atRiskLine = (over = {}) => ({
    id: 'line-2', projectId: 'project-1', orderId: 'order-2', activityId: activity.id, activity, packageId: 'pkg-1',
    activityMaterialId: null, requiredDate: day(5), promisedDate: day(40), leadWeeks: 0, bufferDays: 0,
    status: 'ordered', orderedQty: 1, receivedQty: 0, issuedQty: 0, ...over,
  });
  beforeEach(() => {
    mockPrisma.procurementLeadTimeAlert.findFirst.mockReset();
    mockPrisma.procurementLeadTimeAlert.findMany.mockReset();
    mockPrisma.procurementLeadTimeAlert.create.mockReset();
    mockPrisma.procurementLeadTimeAlert.update.mockReset();
    mockPrisma.procurementLeadTimeAlert.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
    mockPrisma.procurementLeadTimeAlert.create.mockImplementation(async ({ data }) => ({ id: 'alert-new', ...data }));
  });

  test('a second line on a package whose alert another line holds updates that alert — no second alert', async () => {
    mockPrisma.procurementLeadTimeAlert.findFirst.mockResolvedValue(null);
    mockPrisma.procurementLeadTimeAlert.findMany.mockResolvedValue([{ id: 'alert-pkg', projectId: 'project-1', packageId: 'pkg-1', poLineId: 'line-1', activityMaterialId: null, status: 'acknowledged' }]);

    await procurementService.syncLeadTimeAlert({ tx: mockPrisma, projectId: 'project-1', project, line: atRiskLine() });

    expect(mockPrisma.procurementLeadTimeAlert.create).not.toHaveBeenCalled();
    expect(mockPrisma.procurementLeadTimeAlert.update).toHaveBeenCalledWith({
      where: { id: 'alert-pkg' },
      data: expect.objectContaining({ packageId: 'pkg-1', poLineId: 'line-2', orderId: 'order-2', status: 'acknowledged' }),
    });
    expect(mockPrisma.procurementLeadTimeAlert.findMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1', OR: [{ poLineId: 'line-2' }, { packageId: 'pkg-1' }] },
    });
  });

  test('a resolved package alert taken over by an at-risk line is opened again', async () => {
    mockPrisma.procurementLeadTimeAlert.findFirst.mockResolvedValue(null);
    mockPrisma.procurementLeadTimeAlert.findMany.mockResolvedValue([{ id: 'alert-pkg', projectId: 'project-1', packageId: 'pkg-1', poLineId: null, activityMaterialId: null, status: 'resolved' }]);
    await procurementService.syncLeadTimeAlert({ tx: mockPrisma, projectId: 'project-1', project, line: atRiskLine() });
    expect(mockPrisma.procurementLeadTimeAlert.update.mock.calls[0][0].data).toMatchObject({ status: 'open', resolvedAt: null, resolvedBy: null });
  });

  test('a link that yet another alert holds stays with it: the line\'s own alert is updated without the package', async () => {
    mockPrisma.procurementLeadTimeAlert.findFirst.mockResolvedValue({ id: 'alert-own', projectId: 'project-1', packageId: null, poLineId: 'line-2', status: 'open' });
    mockPrisma.procurementLeadTimeAlert.findMany.mockResolvedValue([
      { id: 'alert-own', projectId: 'project-1', packageId: null, poLineId: 'line-2', status: 'open' },
      { id: 'alert-pkg', projectId: 'project-1', packageId: 'pkg-1', poLineId: 'line-1', status: 'open' },
    ]);
    await procurementService.syncLeadTimeAlert({ tx: mockPrisma, projectId: 'project-1', project, line: atRiskLine() });
    expect(mockPrisma.procurementLeadTimeAlert.create).not.toHaveBeenCalled();
    const [{ where, data }] = mockPrisma.procurementLeadTimeAlert.update.mock.calls[0];
    expect(where).toEqual({ id: 'alert-own' });
    expect(data).not.toHaveProperty('packageId');
    expect(data.poLineId).toBe('line-2');
  });

  test('a package nobody holds yet gets its alert created', async () => {
    mockPrisma.procurementLeadTimeAlert.findFirst.mockResolvedValue(null);
    mockPrisma.procurementLeadTimeAlert.findMany.mockResolvedValue([]);
    await procurementService.syncLeadTimeAlert({ tx: mockPrisma, projectId: 'project-1', project, line: atRiskLine() });
    expect(mockPrisma.procurementLeadTimeAlert.update).not.toHaveBeenCalled();
    expect(mockPrisma.procurementLeadTimeAlert.create).toHaveBeenCalledWith({ data: expect.objectContaining({ packageId: 'pkg-1', poLineId: 'line-2', status: 'open' }) });
  });

  test('a material on a package whose alert a line holds takes that alert over', async () => {
    mockPrisma.procurementLeadTimeAlert.findFirst.mockResolvedValue(null);
    mockPrisma.procurementLeadTimeAlert.findMany.mockResolvedValue([{ id: 'alert-pkg', projectId: 'project-1', packageId: 'pkg-1', poLineId: 'line-1', activityMaterialId: null, status: 'open' }]);
    const material = { id: 'mat-1', projectId: 'project-1', activityId: activity.id, activity, procurementPackageId: 'pkg-1', name: 'Cable', plannedQty: 3, qty: 3, requiredDate: day(5), leadWeeks: 12, bufferDays: 0, status: 'planned', poLines: [] };
    await procurementService.syncLeadTimeAlert({ tx: mockPrisma, projectId: 'project-1', project, material });
    expect(mockPrisma.procurementLeadTimeAlert.create).not.toHaveBeenCalled();
    expect(mockPrisma.procurementLeadTimeAlert.update).toHaveBeenCalledWith({ where: { id: 'alert-pkg' }, data: expect.objectContaining({ activityMaterialId: 'mat-1', packageId: 'pkg-1', poLineId: null }) });
  });
});

/**
 * CERT-2 (bodies-4): what an order is worth fits its value column, a
 * Decimal(18,2). 1e15 of something at 100.00 failed at the write with a 500.
 */
describe('an order\'s value fits its column (CERT-2)', () => {
  const order = (lines) =>
    procurementService.createPurchaseOrder({ orgId: 'org-1', projectId: 'project-1', actor: { id: 'proc-1', role: 'procurement' }, payload: { ref: 'PO-BIG', item: 'Big', lines } });
  const line = (over) => ({ description: 'Line', unit: 'nr', activityId: 'activity-1', ...over });
  beforeEach(() => {
    for (const model of ['boqItem', 'budgetLine', 'materialMaster', 'costCode']) mockPrisma[model].findMany.mockResolvedValue([]);
  });

  test.each([
    ['one line of 1e15 at 100.00', [line({ orderedQty: 1e15, unitCost: 100 })]],
    ['two lines that only together pass 10^16', [line({ orderedQty: 6e13, unitCost: 100 }), line({ orderedQty: 6e13, unitCost: 100 })]],
  ])('%s is a 400 PO_VALUE_TOO_LARGE before anything is written', async (_label, lines) => {
    await expect(order(lines)).rejects.toMatchObject({ status: 400, code: 'PO_VALUE_TOO_LARGE' });
    expect(mockPrisma.procurementOrder.create).not.toHaveBeenCalled();
    expect(mockPrisma.procurementPoLine.create).not.toHaveBeenCalled();
  });

  test('an order worth just under 10^16 is not refused for its value', async () => {
    const outcome = await order([line({ orderedQty: 99_999_999_999, unitCost: '99999.99' })]).catch((error) => error);
    expect(outcome?.code).not.toBe('PO_VALUE_TOO_LARGE');
    expect(mockPrisma.procurementOrder.create).toHaveBeenCalled();
  });
});
