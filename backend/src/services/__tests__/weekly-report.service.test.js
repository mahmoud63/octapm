const mockPrisma = {
  activity: { findMany: jest.fn() },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const weeklyReportService = require('../weekly-report.service');

/**
 * A weekly report's activity lists name activities of its own project only
 * (CERT-2 isolation sweep: another company's activity id was stored as given).
 */
describe('weekly report activity lists', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Only activity-own-1 and activity-own-2 are activities of project-1.
    mockPrisma.activity.findMany.mockImplementation(async ({ where }) =>
      where.id.in
        .filter((id) => ['activity-own-1', 'activity-own-2'].includes(id) && where.projectId === 'project-1')
        .map((id) => ({ id })),
    );
  });

  it('accepts the project\'s own activities in either list', async () => {
    await expect(
      weeklyReportService.assertReportActivities({
        projectId: 'project-1',
        payload: { activitiesCompleted: ['activity-own-1'], activitiesInProgress: ['activity-own-2', 'activity-own-1'] },
      }),
    ).resolves.toBeUndefined();
    expect(mockPrisma.activity.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['activity-own-1'] }, projectId: 'project-1' },
      select: { id: true },
    });
  });

  it.each(['activitiesCompleted', 'activitiesInProgress'])('refuses %s naming an activity that is not this project\'s (404 ACTIVITY_NOT_FOUND)', async (field) => {
    await expect(
      weeklyReportService.assertReportActivities({ projectId: 'project-1', payload: { [field]: ['activity-own-1', 'activity-foreign'] } }),
    ).rejects.toMatchObject({ status: 404, code: 'ACTIVITY_NOT_FOUND' });
  });

  it('answers another company\'s activity exactly as one that exists nowhere', async () => {
    const answer = async (id) => weeklyReportService.assertReportActivities({ projectId: 'project-1', payload: { activitiesCompleted: [id] } }).catch((error) => `${error.status} ${error.code} ${error.message}`);
    // activity-own-1 of another project is "foreign" from project-2's side.
    const foreign = await weeklyReportService.assertReportActivities({ projectId: 'project-2', payload: { activitiesCompleted: ['activity-own-1'] } }).catch((error) => `${error.status} ${error.code} ${error.message}`);
    expect(foreign).toBe(await answer('activity-nowhere'));
  });

  it('looks nothing up when the payload states no list (or an empty or null one)', async () => {
    await weeklyReportService.assertReportActivities({ projectId: 'project-1', payload: { remarks: 'x' } });
    await weeklyReportService.assertReportActivities({ projectId: 'project-1', payload: { activitiesCompleted: [], activitiesInProgress: null } });
    expect(mockPrisma.activity.findMany).not.toHaveBeenCalled();
  });
});
