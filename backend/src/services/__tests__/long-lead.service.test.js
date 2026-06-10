const mockPrisma = {
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  longLeadItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const longLeadService = require('../long-lead.service');

const project = {
  id: 'project-1',
  orgId: 'org-1',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
};

const activity = {
  id: 'activity-1',
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
});

describe('long lead service procurement controls', () => {
  test('requires an activity link for schedule-critical procurement items', async () => {
    await expect(
      longLeadService.createLongLeadItem({
        orgId: 'org-1',
        projectId: 'project-1',
        payload: {
          item: 'Main transformer',
          leadWeeks: 14,
          criticality: 'high',
          status: 'not_ordered',
        },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'PROCUREMENT_ACTIVITY_REQUIRED',
    });

    expect(mockPrisma.longLeadItem.create).not.toHaveBeenCalled();
  });

  test('rejects activity links outside the active project schedule', async () => {
    mockPrisma.activity.findFirst.mockResolvedValue(null);

    await expect(
      longLeadService.createLongLeadItem({
        orgId: 'org-1',
        projectId: 'project-1',
        payload: {
          item: 'Curtain wall',
          activityId: 'activity-missing',
          leadWeeks: 6,
          criticality: 'medium',
        },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_ACTIVITY_LINK',
    });
  });

  test('warehouse receipt transitions delivered status and reduces risk', async () => {
    const existing = {
      id: 'll-1',
      projectId: 'project-1',
      activityId: activity.id,
      item: 'Switchgear',
      leadWeeks: 10,
      requiredTiming: 'activity_start',
      needOffsetDays: 0,
      bufferDays: 14,
      orderBy: null,
      expectedDeliveryDate: new Date('2026-08-15T00:00:00.000Z'),
      deliveredAt: null,
      warehouseStatus: 'not_received',
      criticality: 'critical',
      risk: null,
      status: 'ordered',
      supplier: null,
      activity,
    };

    mockPrisma.longLeadItem.findFirst.mockResolvedValue(existing);
    mockPrisma.activity.findFirst.mockResolvedValue(activity);
    mockPrisma.longLeadItem.update.mockImplementation(({ data }) =>
      Promise.resolve({
        ...existing,
        ...data,
        activity,
      }),
    );

    const result = await longLeadService.updateLongLeadItem({
      orgId: 'org-1',
      projectId: 'project-1',
      itemId: 'll-1',
      payload: { warehouseStatus: 'received' },
    });

    const updateArgs = mockPrisma.longLeadItem.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe('delivered');
    expect(updateArgs.data.deliveredAt).toBeInstanceOf(Date);
    expect(result.warehouseStatus).toBe('received');
    expect(result.procurementRisk.severity).toBe('none');
    expect(result.procurementRisk.reason).toBe('received');
  });
});
