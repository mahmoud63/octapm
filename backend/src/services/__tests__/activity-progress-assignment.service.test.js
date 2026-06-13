const mockPrisma = {
  project: { findFirst: jest.fn() },
  activity: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockProgressService = {
  assertProgressSubmitAllowed: jest.fn(),
  createProgressSubmission: jest.fn(),
  serializeMethodConfig: jest.fn((row) => row || null),
  serializeSubmission: jest.fn((row) => row || null),
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
jest.mock('../progress.service', () => mockProgressService);

const activityService = require('../activity.service');

const project = { id: 'project-1', orgId: 'org-1' };
const activity = {
  id: 'activity-1',
  projectId: 'project-1',
  name: 'Pour slab',
  progress: [],
  assignments: [],
  predecessorLinks: [],
  progressMethod: null,
  progressSubmissions: [],
};

describe('activity progress assignment authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue(project);
    mockPrisma.activity.findFirst.mockResolvedValue(activity);
    mockPrisma.activity.findMany.mockResolvedValue([
      { id: 'activity-1', budget: 1000 },
    ]);
    mockProgressService.assertProgressSubmitAllowed.mockResolvedValue();
    mockProgressService.createProgressSubmission.mockResolvedValue({
      id: 'submission-1',
      activityId: 'activity-1',
      status: 'submitted',
    });
  });

  it('allows an assigned site engineer to submit progress', async () => {
    const result = await activityService.updateProgress({
      orgId: 'org-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      userId: 'site-1',
      userRole: 'site_engineer',
      payload: { pctComplete: 35 },
    });

    expect(result.submission).toMatchObject({ id: 'submission-1' });
    expect(mockProgressService.createProgressSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        activityId: 'activity-1',
        userId: 'site-1',
        userRole: 'site_engineer',
      }),
    );
  });

  it('preflights bulk progress authorization before creating submissions', async () => {
    mockPrisma.activity.findMany.mockResolvedValue([
      { id: 'activity-1', budget: 1000 },
      { id: 'activity-2', budget: 2000 },
    ]);

    await activityService.bulkUpdateProgress({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'site-1',
      userRole: 'site_engineer',
      updates: [
        { activityId: 'activity-1', pctComplete: 10 },
        { activityId: 'activity-2', pctComplete: 20 },
      ],
    });

    expect(mockProgressService.assertProgressSubmitAllowed).toHaveBeenCalledWith({
      projectId: 'project-1',
      activityIds: ['activity-1', 'activity-2'],
      userId: 'site-1',
      userRole: 'site_engineer',
    });
    expect(mockProgressService.createProgressSubmission).toHaveBeenCalledTimes(2);
  });

  it('does not create partial bulk submissions when authorization fails', async () => {
    mockPrisma.activity.findMany.mockResolvedValue([
      { id: 'activity-1', budget: 1000 },
      { id: 'activity-2', budget: 2000 },
    ]);
    mockProgressService.assertProgressSubmitAllowed.mockRejectedValueOnce({
      status: 403,
      code: 'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED',
      details: { activityIds: ['activity-2'] },
    });

    await expect(
      activityService.bulkUpdateProgress({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'site-1',
        userRole: 'site_engineer',
        updates: [
          { activityId: 'activity-1', pctComplete: 10 },
          { activityId: 'activity-2', pctComplete: 20 },
        ],
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED',
      details: { activityIds: ['activity-2'] },
    });
    expect(mockProgressService.createProgressSubmission).not.toHaveBeenCalled();
  });
});
