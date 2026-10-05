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
 * CERT-2 (bodies-4, alerts-money-5): the lead-time alert is one per
 * procurement package (and per material, and per order line), so it speaks
 * for everything in its scope: the WORST risk among every line and material,
 * recomputed from all of them on each change, resolved only when none is at
 * risk, and opened again when an acknowledged risk worsens. Round 4 made the
 * package's alert follow whichever line changed last: an on-time delivery on
 * a second order resolved it while the first order's line was five weeks
 * late, and an acknowledgement of a small slip carried over to a far larger
 * one. A stateful store, with the table's three unique keys enforced.
 */
describe('a lead-time alert per scope carries the worst open risk (CERT-2)', () => {
  const day = (n) => new Date(Date.now() + n * 86_400_000);
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return cond.some((each) => matches(row, each));
      if (cond === null) return row[key] === null || row[key] === undefined;
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        if ('in' in cond) return cond.in.includes(row[key]);
        if ('notIn' in cond) return !cond.notIn.includes(row[key]);
        if ('not' in cond) return row[key] !== cond.not;
        // A relation filter (a line's order): the related row matches.
        return Boolean(row[key]) && typeof row[key] === 'object' && matches(row[key], cond);
      }
      return row[key] === cond;
    });
  let store;
  let seq;
  const table = (name, { unique = [] } = {}) => ({
    findFirst: jest.fn(async ({ where }) => {
      const row = store[name].find((each) => matches(each, where));
      return row ? { ...row } : null;
    }),
    findMany: jest.fn(async ({ where } = {}) => store[name].filter((each) => matches(each, where)).map((row) => ({ ...row }))),
    create: jest.fn(async ({ data }) => {
      const row = { id: `${name}-${(seq += 1)}`, createdAt: new Date(), updatedAt: new Date(), acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, resolvedBy: null, ...data };
      for (const key of unique) {
        if (row[key] && store[name].some((each) => each.projectId === row.projectId && each[key] === row[key])) {
          throw Object.assign(new Error(`Unique constraint failed on the fields: (\`projectId\`,\`${key}\`)`), { code: 'P2002' });
        }
      }
      store[name].push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }) => {
      const row = store[name].find((each) => each.id === where.id);
      const next = { ...row, ...data, updatedAt: new Date() };
      for (const key of unique) {
        if (next[key] && store[name].some((each) => each.id !== row.id && each.projectId === next.projectId && each[key] === next[key])) {
          throw Object.assign(new Error(`Unique constraint failed on the fields: (\`projectId\`,\`${key}\`)`), { code: 'P2002' });
        }
      }
      Object.assign(row, next);
      return { ...row };
    }),
    // One statement for many rows, each held to the unique keys as the table holds it (availability-7).
    updateMany: jest.fn(async ({ where, data }) => {
      const rows = store[name].filter((each) => matches(each, where));
      for (const row of rows) {
        const next = { ...row, ...data, updatedAt: data.updatedAt || new Date() };
        for (const key of unique) {
          if (next[key] && store[name].some((each) => each.id !== row.id && each.projectId === next.projectId && each[key] === next[key])) {
            throw Object.assign(new Error(`Unique constraint failed on the fields: (\`projectId\`,\`${key}\`)`), { code: 'P2002' });
          }
        }
        Object.assign(row, next);
      }
      return { count: rows.length };
    }),
    createMany: jest.fn(async ({ data }) => {
      for (const each of data) {
        const row = { id: `${name}-${(seq += 1)}`, createdAt: new Date(), updatedAt: new Date(), acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, resolvedBy: null, ...each };
        for (const key of unique) {
          if (row[key] && store[name].some((other) => other.projectId === row.projectId && other[key] === row[key])) {
            throw Object.assign(new Error(`Unique constraint failed on the fields: (\`projectId\`,\`${key}\`)`), { code: 'P2002' });
          }
        }
        store[name].push(row);
      }
      return { count: data.length };
    }),
  });
  const tx = {
    procurementLeadTimeAlert: table('alerts', { unique: ['poLineId', 'activityMaterialId', 'packageId'] }),
    procurementPoLine: table('lines'),
    activityMaterial: table('materials'),
    procurementPackage: table('packages'),
  };
  const lineOn = (id, over = {}) => {
    const row = {
      id, projectId: 'project-1', orderId: `order-of-${id}`, order: { ref: `PO-${id}`, status: 'issued' }, activityId: activity.id, activity,
      packageId: 'pkg-1', activityMaterialId: null, requiredDate: day(5), promisedDate: day(40), leadWeeks: 0, bufferDays: 0,
      status: 'ordered', orderedQty: 1, receivedQty: 0, issuedQty: 0, createdAt: new Date(), ...over,
    };
    store.lines.push(row);
    return row;
  };
  const change = (row, over) => Object.assign(row, over);
  const sync = (subject) => procurementService.syncLeadTimeAlert({ tx, projectId: 'project-1', project, ...subject });
  const open = () => store.alerts.filter((row) => row.status !== 'resolved');
  beforeEach(() => {
    seq = 0;
    store = { alerts: [], lines: [], materials: [], packages: [{ id: 'pkg-1', projectId: 'project-1', status: 'planning', activityId: activity.id, activity, requiredOnSiteDate: day(30), leadWeeks: 0, bufferDays: 0 }] };
  });

  test('two orders on one package: the alert carries the worse line, and stays open after the other order is delivered', async () => {
    const late = lineOn('line-1', { promisedDate: day(40) });
    const lesser = lineOn('line-2', { promisedDate: day(10) });
    await sync({ line: late });
    await sync({ line: lesser });
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]).toMatchObject({ packageId: 'pkg-1', poLineId: 'line-1', orderId: 'order-of-line-1', status: 'open', reason: 'delivery_after_need', daysAtRisk: 35 });

    // The second order's line is delivered in full.
    change(lesser, { receivedQty: 1, status: 'received' });
    const after = await sync({ line: lesser });
    expect(store.alerts).toHaveLength(1);
    expect(after).toMatchObject({ status: 'open', severity: 'critical', poLineId: 'line-1', daysAtRisk: 35 });
    expect(open()).toHaveLength(1);
  });

  test('resolved only when nothing on the package is at risk, and opened again when something is', async () => {
    const one = lineOn('line-1');
    const two = lineOn('line-2', { promisedDate: day(10) });
    await sync({ line: one });
    change(one, { receivedQty: 1, status: 'received' });
    expect(await sync({ line: one })).toMatchObject({ status: 'open', poLineId: 'line-2', daysAtRisk: 5 });
    change(two, { receivedQty: 1, status: 'received' });
    expect(await sync({ line: two })).toMatchObject({ status: 'resolved', severity: 'none', daysAtRisk: 0 });
    const three = lineOn('line-3', { promisedDate: day(20) });
    expect(await sync({ line: three })).toMatchObject({ id: store.alerts[0].id, status: 'open', poLineId: 'line-3', resolvedAt: null });
    expect(store.alerts).toHaveLength(1);
  });

  test('an acknowledged alert is opened again when the risk worsens — not when it stays as acknowledged or eases', async () => {
    const small = lineOn('line-1', { promisedDate: day(8) });
    await sync({ line: small });
    change(store.alerts[0], { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: 'pm-1' });
    // Synced again with nothing changed: still acknowledged.
    expect(await sync({ line: small })).toMatchObject({ status: 'acknowledged', daysAtRisk: 3 });
    // A second order, eighty days late, on the same package: a worse risk than was acknowledged.
    const big = lineOn('line-2', { promisedDate: day(85) });
    expect(await sync({ line: big })).toMatchObject({ status: 'open', poLineId: 'line-2', daysAtRisk: 80, acknowledgedAt: null, acknowledgedBy: null });
    // Acknowledged again, then the supplier improves the promise: easing keeps the acknowledgement.
    change(store.alerts[0], { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: 'pm-1' });
    change(big, { promisedDate: day(45) });
    expect(await sync({ line: big })).toMatchObject({ status: 'acknowledged', daysAtRisk: 40, acknowledgedBy: 'pm-1' });
    expect(store.alerts).toHaveLength(1);
  });

  test('a higher severity reopens an acknowledgement; days that time alone added to the same overdue line do not', async () => {
    const calm = { ...activity, isCritical: false };
    const overdue = lineOn('line-1', { activity: calm, requiredDate: day(60), promisedDate: day(-3) });
    await sync({ line: overdue });
    expect(store.alerts[0]).toMatchObject({ reason: 'delivery_overdue', severity: 'high', daysAtRisk: 3 });
    // Acknowledged two days ago at one day overdue: the two days since are time, not news.
    change(store.alerts[0], { status: 'acknowledged', daysAtRisk: 1, updatedAt: day(-2) });
    expect(await sync({ line: overdue })).toMatchObject({ status: 'acknowledged', daysAtRisk: 3 });
    // Acknowledged today at nought: three days is more than time explains.
    change(store.alerts[0], { status: 'acknowledged', daysAtRisk: 0, updatedAt: new Date() });
    expect(await sync({ line: overdue })).toMatchObject({ status: 'open' });
    // From high to critical (more than a week overdue) reopens whatever the days.
    change(store.alerts[0], { status: 'acknowledged', updatedAt: day(-30) });
    change(overdue, { promisedDate: day(-9) });
    expect(await sync({ line: overdue })).toMatchObject({ status: 'open', severity: 'critical' });
  });

  test('materials on the package count: a material not yet ordered past its order-by date keeps the alert open once every line is in', async () => {
    const line = lineOn('line-1', { promisedDate: day(10) });
    store.materials.push({ id: 'mat-1', projectId: 'project-1', activityId: activity.id, activity, procurementPackageId: 'pkg-1', name: 'Cable', plannedQty: 3, qty: 3, requiredDate: day(5), leadWeeks: 12, bufferDays: 0, status: 'planned', poLines: [], createdAt: new Date() });
    await sync({ material: store.materials[0] });
    change(line, { receivedQty: 1, status: 'received' });
    const after = await sync({ line });
    expect(after).toMatchObject({ status: 'open', packageId: 'pkg-1', activityMaterialId: 'mat-1', poLineId: null, reason: 'order_by_missed' });
    expect(store.alerts).toHaveLength(1);
  });

  test('a cancelled order\'s line, a cancelled material and a cancelled line hold nothing open', async () => {
    const late = lineOn('line-1');
    await sync({ line: late });
    change(late, { order: { ref: 'PO-line-1', status: 'cancelled' } });
    expect(await sync({ line: late })).toMatchObject({ status: 'resolved' });
    store.materials.push({ id: 'mat-1', projectId: 'project-1', activityId: activity.id, activity, procurementPackageId: 'pkg-1', name: 'Cable', plannedQty: 3, requiredDate: day(5), leadWeeks: 12, bufferDays: 0, status: 'cancelled', poLines: [], createdAt: new Date() });
    const voided = lineOn('line-2', { status: 'cancelled' });
    expect(await sync({ line: voided })).toMatchObject({ status: 'resolved' });
  });

  test('the package\'s own planning dates speak for it only until something is ordered on it', async () => {
    change(store.packages[0], { requiredOnSiteDate: day(5), leadWeeks: 12, latestOrderDate: day(-79) });
    const own = await sync({ packageRow: store.packages[0] });
    expect(own).toMatchObject({ packageId: 'pkg-1', poLineId: null, reason: 'order_by_missed', status: 'open' });
    // Ordered, and promised in time: the package still reads "planning", but its lines speak now.
    lineOn('line-1', { requiredDate: day(30), promisedDate: day(20) });
    expect(await sync({ line: store.lines[0] })).toMatchObject({ status: 'resolved' });
  });

  test('a material\'s own alert is taken into its package\'s when it joins one — no second alert, no unique key broken', async () => {
    store.materials.push({ id: 'mat-1', projectId: 'project-1', activityId: activity.id, activity, procurementPackageId: null, name: 'Cable', plannedQty: 3, requiredDate: day(5), leadWeeks: 12, bufferDays: 0, status: 'planned', poLines: [], createdAt: new Date() });
    const own = await sync({ material: store.materials[0] });
    expect(own).toMatchObject({ activityMaterialId: 'mat-1', packageId: null, status: 'open' });
    change(store.alerts[0], { status: 'acknowledged', acknowledgedBy: 'pm-1' });
    // Ordered on the package: the material now belongs to it.
    change(store.materials[0], { procurementPackageId: 'pkg-1', status: 'ordered' });
    const line = lineOn('line-1', { activityMaterialId: 'mat-1', promisedDate: day(10) });
    const taken = await sync({ line });
    expect(store.alerts).toHaveLength(1);
    expect(taken).toMatchObject({ id: own.id, packageId: 'pkg-1' });
    // A package that already had its alert closes the material's instead of colliding with it.
    store.packages.push({ id: 'pkg-2', projectId: 'project-1', status: 'planning', activityId: activity.id, activity, requiredOnSiteDate: day(30), leadWeeks: 0, bufferDays: 0 });
    store.materials.push({ id: 'mat-2', projectId: 'project-1', activityId: activity.id, activity, procurementPackageId: null, name: 'Duct', plannedQty: 3, requiredDate: day(5), leadWeeks: 12, bufferDays: 0, status: 'planned', poLines: [], createdAt: new Date() });
    await sync({ material: store.materials[1] });
    const other = lineOn('line-2', { packageId: 'pkg-2', promisedDate: day(40) });
    await sync({ line: other });
    change(store.materials[1], { procurementPackageId: 'pkg-2', status: 'ordered' });
    const merged = await sync({ material: store.materials[1] });
    expect(merged).toMatchObject({ packageId: 'pkg-2', status: 'open' });
    const materialAlert = store.alerts.find((row) => row.id !== merged.id && row.id !== own.id);
    expect(materialAlert).toMatchObject({ status: 'resolved', activityMaterialId: null, packageId: null });
    expect(open()).toHaveLength(2);
  });

  test('a material taken off a package: the package\'s alert that pointed at it is worked again without it', async () => {
    store.materials.push({ id: 'mat-1', projectId: 'project-1', activityId: activity.id, activity, procurementPackageId: 'pkg-1', name: 'Cable', plannedQty: 3, requiredDate: day(5), leadWeeks: 12, bufferDays: 0, status: 'planned', poLines: [], createdAt: new Date() });
    lineOn('line-1', { requiredDate: day(30), promisedDate: day(20) });
    const pkgAlert = await sync({ material: store.materials[0] });
    expect(pkgAlert).toMatchObject({ packageId: 'pkg-1', activityMaterialId: 'mat-1', status: 'open' });
    change(store.materials[0], { procurementPackageId: null });
    const own = await sync({ material: store.materials[0] });
    expect(own).toMatchObject({ activityMaterialId: 'mat-1', packageId: null, status: 'open' });
    expect(store.alerts.find((row) => row.id === pkgAlert.id)).toMatchObject({ status: 'resolved', activityMaterialId: null });
  });

  // ── round 6 ──────────────────────────────────────────────────────────────

  test('round 6: many lines on one package — the package\'s lines are read once, and its one alert is on the worst', async () => {
    const lines = Array.from({ length: 60 }, (_, k) => lineOn(`line-${k + 1}`, { promisedDate: day(5 + (k % 40)) }));
    tx.procurementPoLine.findMany.mockClear();
    await procurementService.syncLeadTimeAlerts({ tx, projectId: 'project-1', project, lines });
    const scopeReads = tx.procurementPoLine.findMany.mock.calls.filter(([args]) => args?.where?.OR);
    expect(scopeReads).toHaveLength(1);
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]).toMatchObject({ packageId: 'pkg-1', poLineId: 'line-40', daysAtRisk: 39, status: 'open' });
  });

  test('round 6: a scope\'s cancelled and closed lines are not read when it is worked', async () => {
    lineOn('line-1', { order: { ref: 'PO-1', status: 'cancelled' } });
    lineOn('line-2', { order: { ref: 'PO-2', status: 'closed' } });
    lineOn('line-3', { status: 'cancelled' });
    const live = lineOn('line-4', { promisedDate: day(12) });
    tx.procurementPoLine.findMany.mockClear();
    await sync({ line: live });
    const [read] = tx.procurementPoLine.findMany.mock.results.filter((_, i) => tx.procurementPoLine.findMany.mock.calls[i][0]?.where?.OR);
    expect((await read.value).map((row) => row.id)).toEqual(['line-4']);
    expect(store.alerts[0]).toMatchObject({ poLineId: 'line-4', daysAtRisk: 7, status: 'open' });
  });

  test('round 6: a material ordered on an order since cancelled or closed is not kept at risk by that order\'s promise', async () => {
    const calm = { ...activity, isCritical: false };
    for (const settled of ['cancelled', 'closed']) {
      store.alerts = [];
      store.lines = [];
      const line = lineOn(`line-${settled}`, { activity: calm, activityMaterialId: 'mat-1', requiredDate: day(30), promisedDate: day(40) });
      store.materials = [{ id: 'mat-1', projectId: 'project-1', activityId: activity.id, activity: calm, procurementPackageId: 'pkg-1', name: 'Cable', plannedQty: 1, requiredDate: day(30), leadWeeks: 0, bufferDays: 0, status: 'ordered', poLines: [line], createdAt: new Date() }];
      expect(await sync({ line })).toMatchObject({ status: 'open', reason: 'delivery_after_need', daysAtRisk: 10 });
      // The order will deliver nothing more: neither its line nor the material's view of it is a risk.
      change(line, { order: { ref: 'PO-x', status: settled } });
      expect(await sync({ line })).toMatchObject({ status: 'resolved', severity: 'none' });
    }
    // The scope reads each material's lines with their order's status — without it the rule above has nothing to go on.
    expect(tx.activityMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ poLines: expect.objectContaining({ include: { order: { select: { status: true } } } }) }) }));
    // The material's own view: no promise from a settled order; ordered on nothing live, it is not on order.
    const row = procurementService.buildMaterialRiskRow(store.materials[0]);
    expect(row).toMatchObject({ promisedDate: null, expectedDeliveryDate: null, status: 'not_ordered' });
    // A line whose order was not read with it is judged by its own status, as before.
    expect(procurementService.buildMaterialRiskRow({ ...store.materials[0], poLines: [{ status: 'ordered', promisedDate: day(40) }] })).toMatchObject({ status: 'ordered' });
  });

  test('round 6: an open alert keeps its subject — a resolved alert gives up the link it was resolved on', async () => {
    store.packages.push({ id: 'pkg-2', projectId: 'project-1', status: 'planning', activityId: activity.id, activity, requiredOnSiteDate: day(200), leadWeeks: 0, bufferDays: 0 });
    const material = { id: 'mat-1', projectId: 'project-1', activityId: activity.id, activity, procurementPackageId: 'pkg-1', name: 'Cable', plannedQty: 3, requiredDate: day(5), leadWeeks: 12, bufferDays: 0, status: 'planned', poLines: [], createdAt: new Date() };
    store.materials.push(material);
    const first = await sync({ material });
    expect(first).toMatchObject({ packageId: 'pkg-1', activityMaterialId: 'mat-1', status: 'open' });
    // Needed much later: nothing on pkg-1 is at risk, and its alert is resolved — on the material.
    change(material, { requiredDate: day(300) });
    expect(await sync({ material })).toMatchObject({ id: first.id, status: 'resolved', activityMaterialId: 'mat-1' });
    // Moved to pkg-2 and needed soon again: pkg-2's open alert is on the material, and pkg-1's resolved one let it go.
    change(material, { procurementPackageId: 'pkg-2', requiredDate: day(5) });
    const second = await sync({ material });
    expect(second).toMatchObject({ packageId: 'pkg-2', activityMaterialId: 'mat-1', status: 'open', reason: 'order_by_missed' });
    expect(store.alerts.find((row) => row.id === first.id)).toMatchObject({ status: 'resolved', activityMaterialId: null, packageId: 'pkg-1' });
  });

  test('round 6: a member of the scope is its alert\'s subject even when another open alert points at it', async () => {
    store.packages.push({ id: 'pkg-2', projectId: 'project-1', status: 'planning', activityId: activity.id, activity, requiredOnSiteDate: day(200), leadWeeks: 0, bufferDays: 0 });
    // A material planned on pkg-2, ordered on a line that names pkg-1: pkg-1's alert points at the line, and at the material it was ordered against.
    const line = lineOn('line-1', { activityMaterialId: 'mat-1', promisedDate: day(40) });
    const material = { id: 'mat-1', projectId: 'project-1', activityId: activity.id, activity, procurementPackageId: 'pkg-1', name: 'Cable', plannedQty: 1, requiredDate: day(5), leadWeeks: 0, bufferDays: 0, status: 'ordered', poLines: [line], createdAt: new Date() };
    store.materials.push(material);
    const onLine = await sync({ line });
    expect(onLine).toMatchObject({ packageId: 'pkg-1', poLineId: 'line-1', activityMaterialId: 'mat-1', status: 'open' });
    // The material is moved to pkg-2, where it is the worst risk (35 days, its line's promise).
    change(material, { procurementPackageId: 'pkg-2' });
    const moved = await sync({ material });
    expect(moved).toMatchObject({ packageId: 'pkg-2', activityMaterialId: 'mat-1', status: 'open', reason: 'delivery_after_need' });
    expect(store.alerts.find((row) => row.id === onLine.id)).toMatchObject({ packageId: 'pkg-1', poLineId: 'line-1', activityMaterialId: null, status: 'open' });
  });

  test('round 6: deleting the activity of a package\'s worst line keeps the package\'s alert, worked again on the line still late', async () => {
    const worst = lineOn('line-1', { promisedDate: day(40) });
    lineOn('line-2', { activityId: 'activity-2', promisedDate: day(10) });
    await procurementService.syncLeadTimeAlerts({ tx, projectId: 'project-1', project, lines: store.lines });
    expect(store.alerts[0]).toMatchObject({ poLineId: 'line-1', daysAtRisk: 35 });
    const released = await procurementService.releaseLeadTimeAlertLinks({ tx, projectId: 'project-1', lineIds: [worst.id], materialIds: [] });
    expect(store.alerts[0]).toMatchObject({ poLineId: null, packageId: 'pkg-1' });
    // The cascade: the line is gone.
    store.lines = store.lines.filter((row) => row.id !== worst.id);
    await procurementService.syncReleasedLeadTimeAlerts({ tx, projectId: 'project-1', project, released });
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]).toMatchObject({ packageId: 'pkg-1', poLineId: 'line-2', daysAtRisk: 5, status: 'open' });
  });

  test('round 6: deleting a line a material\'s alert points at keeps the material\'s alert; a line\'s own alert goes with it', async () => {
    const material = { id: 'mat-1', projectId: 'project-1', activityId: 'activity-2', activity, procurementPackageId: null, name: 'Cable', plannedQty: 1, requiredDate: day(5), leadWeeks: 1, bufferDays: 0, status: 'planned', poLines: [], createdAt: new Date() };
    store.materials.push(material);
    const ordered = lineOn('line-1', { packageId: null, activityMaterialId: 'mat-1', promisedDate: day(60) });
    const loose = lineOn('line-2', { packageId: null, promisedDate: day(20) });
    await procurementService.syncLeadTimeAlerts({ tx, projectId: 'project-1', project, lines: [ordered, loose] });
    expect(store.alerts).toHaveLength(2);
    const materialAlert = store.alerts.find((row) => row.activityMaterialId === 'mat-1');
    expect(materialAlert).toMatchObject({ poLineId: 'line-1', packageId: null });
    const released = await procurementService.releaseLeadTimeAlertLinks({ tx, projectId: 'project-1', lineIds: ['line-1', 'line-2'], materialIds: [] });
    // The line's own alert is left to the cascade; the material's gives the line up.
    expect(store.alerts.find((row) => row.id === materialAlert.id)).toMatchObject({ poLineId: null, activityMaterialId: 'mat-1' });
    expect(store.alerts.find((row) => row.id !== materialAlert.id)).toMatchObject({ poLineId: 'line-2' });
    store.lines = [];
    store.alerts = store.alerts.filter((row) => row.poLineId !== 'line-2');
    await procurementService.syncReleasedLeadTimeAlerts({ tx, projectId: 'project-1', project, released });
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]).toMatchObject({ id: materialAlert.id, activityMaterialId: 'mat-1', reason: 'order_by_missed', status: 'open' });
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

/**
 * CERT-2 (alerts-6): an order's lines are written first, and the alert of
 * every scope they are in is worked ONCE afterwards — not once per line, which
 * read the package's every line again for each line and ran a 180-line order
 * past its transaction's five seconds (a 500).
 */
describe('an order works each lead-time alert scope once (CERT-2, round 6)', () => {
  const line = (n) => ({ description: `Line ${n}`, unit: 'nr', activityId: 'activity-1', orderedQty: 1, unitCost: 10, promisedDate: '2026-12-01' });
  beforeEach(() => {
    for (const model of ['boqItem', 'budgetLine', 'materialMaster', 'costCode']) mockPrisma[model].findMany.mockResolvedValue([]);
    mockPrisma.procurementPackage.findFirst.mockResolvedValue({ id: 'pkg-1', projectId: 'project-1', status: 'planning' });
    mockPrisma.procurementOrder.create.mockResolvedValue({ id: 'order-1', projectId: 'project-1', packageId: 'pkg-1', ref: 'PO-ONE', item: 'One', status: 'planned', leadWeeks: 0, bufferDays: 14, needOffsetDays: 0, requiredTiming: 'activity_start' });
    mockPrisma.procurementPoLine.create.mockImplementation(async ({ data }) => ({ id: `line-${data.lineNumber}`, ...data }));
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([]);
  });

  test('a three-line order on one package reads the package\'s lines once, after every line is written', async () => {
    // The order's totals are re-added by purchase-order.service afterwards; this fake stops there.
    await procurementService.createPurchaseOrder({ orgId: 'org-1', projectId: 'project-1', actor: { id: 'proc-1' }, payload: { ref: 'PO-ONE', item: 'One', packageId: 'pkg-1', lines: [line(1), line(2), line(3)] } }).catch(() => null);
    expect(mockPrisma.procurementPoLine.create).toHaveBeenCalledTimes(3);
    const reads = mockPrisma.procurementPoLine.findMany.mock.calls.map(([args], i) => ({ args, order: mockPrisma.procurementPoLine.findMany.mock.invocationCallOrder[i] })).filter(({ args }) => args?.where?.OR);
    expect(reads).toHaveLength(1);
    expect(reads[0].order).toBeGreaterThan(Math.max(...mockPrisma.procurementPoLine.create.mock.invocationCallOrder));
  });
});
