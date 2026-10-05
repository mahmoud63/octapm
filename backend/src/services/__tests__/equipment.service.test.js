const mockPrisma = {
  project: { findFirst: jest.fn() },
  equipment: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findFirst: jest.fn(),
  },
  activityEquipmentUsage: {
    findMany: jest.fn(),
  },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
// CERT-2 (alerts-6): the ledger posts what it is given; the audit is not under test.
jest.mock('../cost-ledger.service', () => ({
  post: jest.fn(async ({ amount }) => ({ posted: true, entry: { amount } })),
}));
jest.mock('../audit.service', () => ({
  ENTITY_TYPES: { COST_RECORD: 'cost_record', ACTIVITY_EQUIPMENT_USAGE: 'activity_equipment_usage' },
  ACTIONS: { CREATED: 'created', UPDATED: 'updated' },
  recordEvent: jest.fn(async () => null),
}));

const equipmentService = require('../equipment.service');

describe('equipment service utilization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'project-1',
      orgId: 'org-1',
    });
  });

  it('summarizes approved equipment usage by activity and equipment', async () => {
    mockPrisma.activityEquipmentUsage.findMany.mockResolvedValue([
      {
        id: 'usage-1',
        projectId: 'project-1',
        activityId: 'activity-1',
        equipmentId: 'equip-1',
        dailyReportId: 'report-1',
        sourceLineIndex: 0,
        equipmentName: 'Tower crane',
        hours: 4,
        rateType: 'daily',
        rate: 800,
        costAmount: 400,
        usageDate: new Date('2026-01-03T00:00:00.000Z'),
        status: 'approved',
        recordedBy: 'site-1',
        approvedBy: 'pm-1',
        approvedAt: new Date('2026-01-04T00:00:00.000Z'),
        notes: null,
        createdAt: new Date('2026-01-04T00:00:00.000Z'),
        activity: {
          id: 'activity-1',
          name: 'Foundations',
          wbsCode: 'A.01',
          category: 'Substructure',
        },
        equipment: {
          id: 'equip-1',
          name: 'Tower crane',
          rateType: 'daily',
          rate: 800,
        },
        dailyReport: {
          id: 'report-1',
          date: new Date('2026-01-03T00:00:00.000Z'),
          status: 'approved',
        },
      },
      {
        id: 'usage-2',
        projectId: 'project-1',
        activityId: 'activity-1',
        equipmentId: null,
        dailyReportId: 'report-1',
        sourceLineIndex: 1,
        equipmentName: 'Small pump',
        hours: 2,
        rateType: 'hourly',
        rate: 0,
        costAmount: 0,
        usageDate: new Date('2026-01-03T00:00:00.000Z'),
        status: 'approved',
        recordedBy: 'site-1',
        approvedBy: 'pm-1',
        approvedAt: new Date('2026-01-04T00:00:00.000Z'),
        notes: null,
        createdAt: new Date('2026-01-04T00:00:00.000Z'),
        activity: {
          id: 'activity-1',
          name: 'Foundations',
          wbsCode: 'A.01',
          category: 'Substructure',
        },
        equipment: null,
        dailyReport: {
          id: 'report-1',
          date: new Date('2026-01-03T00:00:00.000Z'),
          status: 'approved',
        },
      },
    ]);

    const report = await equipmentService.getEquipmentUtilization({
      orgId: 'org-1',
      projectId: 'project-1',
      activityId: 'activity-1',
    });

    expect(mockPrisma.activityEquipmentUsage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 'project-1',
          status: 'approved',
          activityId: 'activity-1',
        },
      }),
    );
    expect(report.totals).toMatchObject({
      hours: 6,
      costAmount: 400,
      unpricedHours: 2,
      pricedHours: 4,
      usageCount: 2,
      activityCount: 1,
      equipmentCount: 2,
    });
    expect(report.byActivity[0]).toMatchObject({
      activityId: 'activity-1',
      activityName: 'Foundations',
      hours: 6,
      costAmount: 400,
      usageCount: 2,
    });
    expect(report.byEquipment[0]).toMatchObject({
      equipmentId: 'equip-1',
      equipmentName: 'Tower crane',
      hours: 4,
      costAmount: 400,
    });
  });
});

/**
 * CERT-2 (alerts-6): an approved daily report's equipment moves the activity's
 * equipment category by exactly what the ledger posted, as an exact decimal,
 * and only while it fits its Decimal(18,2) column. It was added up in floating
 * point and written unchecked, with every other category written back through
 * a float: an equipment category at 9.9e15 and 2e14 of equipment failed the
 * approval with a 500.
 */
describe("an activity's equipment cost fits its column (CERT-2, round 6)", () => {
  const tx = {
    activityEquipmentUsage: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }) => ({ id: `usage-${data.sourceLineIndex}`, ...data })),
    },
    equipment: { findMany: jest.fn(async () => [{ id: 'eq-1', name: 'Crane', rateType: 'hourly', rate: 100000000000000 }]) },
    costRecord: { findFirst: jest.fn(), update: jest.fn(async ({ data }) => ({ id: 'cr-1', ...data })), create: jest.fn() },
  };
  const report = { id: 'report-1', activityId: 'activity-1', date: new Date('2026-09-01T00:00:00.000Z'), equipmentJson: [{ equipmentId: 'eq-1', hours: 2 }] };
  const post = () => equipmentService.postDailyReportEquipmentUsage({ tx, orgId: 'org-1', projectId: 'project-1', report, actorId: 'pm-1' });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('a posting that would take the equipment category past 10^16 is a 400 COST_LEDGER_TOTAL_TOO_LARGE, and the record is not written', async () => {
    tx.costRecord.findFirst.mockResolvedValue({ id: 'cr-1', equipment: '9900000000000000.00', actualThroughDate: null });
    await expect(post()).rejects.toMatchObject({ status: 400, code: 'COST_LEDGER_TOTAL_TOO_LARGE', details: { projection: 'activity_equipment' } });
    expect(tx.costRecord.update).not.toHaveBeenCalled();
    expect(tx.costRecord.create).not.toHaveBeenCalled();
  });

  it('one that fits moves the category by exactly what was posted, as an exact decimal, and writes no other category', async () => {
    tx.costRecord.findFirst.mockResolvedValue({ id: 'cr-1', equipment: '9799999999999999.99', labour: '9999999999999999.99', actualThroughDate: null });
    await post();
    const { data } = tx.costRecord.update.mock.calls[0][0];
    expect(data.equipment.toFixed(2)).toBe('9999999999999999.99');
    expect(Object.keys(data).sort()).toEqual(['actualThroughDate', 'equipment']);
  });
});
