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
