const mockTx = { tx: true };
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockTx)),
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
  serializeProgressSource: jest.fn((row) => (row ? { source: row.source } : null)),
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
    // One transaction for the whole batch: every submission is made on it.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction.mock.calls[0][1]).toEqual({ maxWait: 10_000, timeout: 60_000 });
    for (const [call] of mockProgressService.createProgressSubmission.mock.calls) expect(call.tx).toBe(mockTx);
  });

  it('a refused update fails the whole batch inside its one transaction and names the update; nothing after it is attempted', async () => {
    const { HttpError } = require('../../utils/http-error');
    mockPrisma.activity.findMany.mockResolvedValue([
      { id: 'activity-1', budget: 1000 },
      { id: 'activity-2', budget: 2000 },
      { id: 'activity-3', budget: 3000 },
    ]);
    mockProgressService.createProgressSubmission
      .mockResolvedValueOnce({ id: 'submission-1', activityId: 'activity-1', status: 'submitted' })
      .mockRejectedValueOnce(new HttpError(409, 'PROGRESS_METHOD_MISMATCH', 'measured by quantity', { activityId: 'activity-2', effectiveMethod: 'quantity' }));
    let thrownInside = null;
    mockPrisma.$transaction.mockImplementationOnce(async (fn) => {
      try {
        return await fn(mockTx);
      } catch (error) {
        thrownInside = error;
        throw error;
      }
    });

    await expect(
      activityService.bulkUpdateProgress({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'site-1',
        userRole: 'site_engineer',
        updates: [
          { activityId: 'activity-1', pctComplete: 10 },
          { activityId: 'activity-2', method: 'percent', pctComplete: 90 },
          { activityId: 'activity-3', pctComplete: 30 },
        ],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'PROGRESS_METHOD_MISMATCH',
      details: { activityId: 'activity-2', effectiveMethod: 'quantity', batch: { index: 1, activityId: 'activity-2', updates: 3, written: 0 } },
    });
    // The refusal left the transaction's callback (so the database rolls the first submission back), and the third update was never attempted.
    expect(thrownInside).toMatchObject({ code: 'PROGRESS_METHOD_MISMATCH' });
    expect(mockProgressService.createProgressSubmission).toHaveBeenCalledTimes(2);
    for (const [call] of mockProgressService.createProgressSubmission.mock.calls) expect(call.tx).toBe(mockTx);
  });

  it('an update naming an activity that is not in the project is refused 404 before the batch starts, never skipped', async () => {
    mockPrisma.activity.findMany.mockResolvedValue([{ id: 'activity-1', budget: 1000 }]);
    await expect(
      activityService.bulkUpdateProgress({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'site-1',
        userRole: 'site_engineer',
        updates: [
          { activityId: 'activity-1', pctComplete: 10 },
          { activityId: 'activity-elsewhere', pctComplete: 20 },
        ],
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'ACTIVITY_NOT_FOUND',
      details: { batch: { index: 1, activityId: 'activity-elsewhere', updates: 2, written: 0 } },
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockProgressService.createProgressSubmission).not.toHaveBeenCalled();
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
