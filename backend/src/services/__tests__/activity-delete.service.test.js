const mockPrisma = {
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn(), delete: jest.fn() },
  costRecord: { count: jest.fn() },
  activityProgress: { count: jest.fn() },
  dailyReport: { count: jest.fn() },
  // PC-6: the installed quantities recorded against the activity keep it too.
  quantityProgressEntry: { count: jest.fn() },
  dailyLogQuantity: { count: jest.fn() },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../activity-boq-allocation.service', () => ({
  getApprovedActivityAllocationTotals: jest.fn(),
}));
jest.mock('../cpm.service', () => ({
  applyCpmToProject: jest.fn(),
  workingDayToDate: jest.fn(() => null),
}));
jest.mock('../activity-dependency.service', () => ({
  replaceActivityDependencies: jest.fn(),
  serializeDependencyDto: jest.fn(),
}));
jest.mock('../progress.service', () => ({
  assertProgressSubmitAllowed: jest.fn(),
  createProgressSubmission: jest.fn(),
  serializeMethodConfig: jest.fn((row) => row || null),
  serializeSubmission: jest.fn((row) => row || null),
}));

const activityService = require('../activity.service');

const MESSAGE_TAIL =
  'Records stay on their activity; take it out of the programme through a schedule revision instead.';

describe('deleteActivity', () => {
  const activity = { id: 'activity-1', projectId: 'project-1', activityCode: 'G100', name: 'Excavate', isActive: true };
  const call = () => activityService.deleteActivity({ orgId: 'org-1', projectId: 'project-1', activityId: 'activity-1' });
  const refusal = async () => {
    let error;
    await call().catch((thrown) => {
      error = thrown;
    });
    expect(error).toBeDefined();
    return error;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1', orgId: 'org-1' });
    mockPrisma.activity.findFirst.mockResolvedValue(activity);
    mockPrisma.costRecord.count.mockResolvedValue(0);
    mockPrisma.activityProgress.count.mockResolvedValue(0);
    mockPrisma.dailyReport.count.mockResolvedValue(0);
    mockPrisma.quantityProgressEntry.count.mockResolvedValue(0);
    mockPrisma.dailyLogQuantity.count.mockResolvedValue(0);
    mockPrisma.activity.delete.mockResolvedValue(activity);
  });

  it('deletes an activity that no record keeps', async () => {
    await expect(call()).resolves.toEqual({ deleted: true });
    expect(mockPrisma.activity.delete).toHaveBeenCalledWith({ where: { id: 'activity-1' } });
    for (const model of ['costRecord', 'activityProgress', 'dailyReport', 'quantityProgressEntry', 'dailyLogQuantity']) {
      expect(mockPrisma[model].count).toHaveBeenCalledWith({ where: { activityId: 'activity-1' } });
    }
  });

  it('refuses, 409 ACTIVITY_IN_USE with the counts, the activity an activated revision gave a cost record — and never reaches the delete', async () => {
    mockPrisma.costRecord.count.mockResolvedValue(1);
    const error = await refusal();
    expect([error.status, error.code, error.message, error.details]).toEqual([
      409,
      'ACTIVITY_IN_USE',
      `Activity G100 cannot be deleted: 1 cost record is linked to it. ${MESSAGE_TAIL}`,
      { activityId: 'activity-1', activityCode: 'G100', partOfActiveSchedule: true, keptBy: { costRecords: 1, progress: 0, dailyReports: 0, quantityEntries: 0, dailyLogQuantities: 0 } },
    ]);
    expect(mockPrisma.activity.delete).not.toHaveBeenCalled();
  });

  it('names every kind of record that keeps it, in the plural, for a retired activity by name when it has no code', async () => {
    mockPrisma.activity.findFirst.mockResolvedValue({ ...activity, activityCode: null, isActive: false });
    mockPrisma.costRecord.count.mockResolvedValue(2);
    mockPrisma.activityProgress.count.mockResolvedValue(1);
    mockPrisma.dailyReport.count.mockResolvedValue(3);
    mockPrisma.quantityProgressEntry.count.mockResolvedValue(4);
    mockPrisma.dailyLogQuantity.count.mockResolvedValue(1);
    const error = await refusal();
    expect(error.message).toBe(`Activity Excavate cannot be deleted: 2 cost records, 1 progress record, 3 daily reports, 4 quantity progress entries, 1 daily-log quantity row are linked to it. ${MESSAGE_TAIL}`);
    expect(error.details).toEqual({ activityId: 'activity-1', activityCode: null, partOfActiveSchedule: false, keptBy: { costRecords: 2, progress: 1, dailyReports: 3, quantityEntries: 4, dailyLogQuantities: 1 } });
  });

  it('turns a foreign-key refusal the list does not know (Prisma P2003) into the same structured 409, never a 500', async () => {
    const prismaError = Object.assign(new Error('Foreign key constraint violated: `Other_activityId_fkey (index)`'), {
      code: 'P2003',
      meta: { field_name: 'Other_activityId_fkey (index)' },
    });
    mockPrisma.activity.delete.mockRejectedValue(prismaError);
    const error = await refusal();
    expect([error.status, error.code, error.message]).toEqual([
      409,
      'ACTIVITY_IN_USE',
      `Activity G100 cannot be deleted: another record is linked to it. ${MESSAGE_TAIL}`,
    ]);
    expect(error.details.keptBy).toEqual({ costRecords: 0, progress: 0, dailyReports: 0, quantityEntries: 0, dailyLogQuantities: 0, constraint: 'Other_activityId_fkey (index)' });
  });

  it('lets any other failure through unchanged', async () => {
    mockPrisma.activity.delete.mockRejectedValue(Object.assign(new Error('connection lost'), { code: 'P1001' }));
    await expect(call()).rejects.toMatchObject({ code: 'P1001' });
  });
});
