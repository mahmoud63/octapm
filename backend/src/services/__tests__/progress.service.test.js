const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  activityProgressMethod: {
    findFirst: jest.fn(),
    upsert: jest.fn(),
  },
  progressSubmission: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  activityProgress: {
    create: jest.fn(),
  },
};
const mockAuditService = {
  ACTIONS: { APPROVED: 'approved', REJECTED: 'rejected' },
  ENTITY_TYPES: { PROGRESS_SUBMISSION: 'progress_submission' },
  recordEvent: jest.fn(),
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => mockAuditService);

const progressService = require('../progress.service');

const project = { id: 'project-1', orgId: 'org-1' };
const activity = { id: 'activity-1', projectId: 'project-1', isActive: true };

describe('progress service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue(project);
    mockPrisma.activity.findFirst.mockResolvedValue(activity);
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(null);
  });

  it('calculates quantity progress from completed quantity and planned quantity', () => {
    const pct = progressService.calculateProgressPercent({
      method: 'quantity',
      payload: {
        quantityComplete: 45,
        quantityPlanned: 90,
      },
    });

    expect(pct).toBe(50);
  });

  it('calculates weighted milestone progress from milestone weights', () => {
    const pct = progressService.calculateProgressPercent({
      method: 'weighted_milestone',
      payload: {
        milestones: [
          { id: 'a', weight: 25, complete: true },
          { id: 'b', weight: 75, pctComplete: 40 },
        ],
      },
    });

    expect(pct).toBe(55);
  });

  it('stores submitted progress without creating official approved progress', async () => {
    mockPrisma.progressSubmission.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'submission-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...data,
      }),
    );

    const submission = await progressService.createProgressSubmission({
      orgId: 'org-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      userId: 'user-1',
      payload: {
        method: 'percent',
        pctComplete: 35,
      },
    });

    expect(submission.status).toBe('submitted');
    expect(submission.pctComplete).toBe(35);
    expect(mockPrisma.activityProgress.create).not.toHaveBeenCalled();
  });

  it('requires evidence when the activity method configuration requires it', async () => {
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue({
      projectId: 'project-1',
      activityId: 'activity-1',
      method: 'percent',
      evidenceRequired: true,
      inspectionRequired: false,
      plannedQuantity: null,
      quantityUnit: null,
      milestoneWeightsJson: null,
    });

    await expect(
      progressService.createProgressSubmission({
        orgId: 'org-1',
        projectId: 'project-1',
        activityId: 'activity-1',
        userId: 'user-1',
        payload: {
          method: 'percent',
          pctComplete: 35,
        },
      }),
    ).rejects.toMatchObject({ code: 'PROGRESS_EVIDENCE_REQUIRED' });
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });

  it('creates an approved ActivityProgress row when a submission is approved', async () => {
    const submitted = {
      id: 'submission-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      dailyReportId: null,
      method: 'quantity',
      source: 'mobile',
      pctComplete: 60,
      quantityComplete: 30,
      quantityPlanned: 50,
      quantityUnit: 'm3',
      milestoneProgressJson: null,
      inspectionStatus: null,
      actualCost: null,
      actualStart: null,
      actualFinish: null,
      notes: 'site update',
      evidenceJson: { photos: [{ url: 'https://example.test/photo.jpg' }] },
      status: 'submitted',
      submittedBy: 'user-1',
      submittedAt: new Date('2026-01-01T00:00:00.000Z'),
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      activity,
    };
    const approved = {
      ...submitted,
      status: 'approved',
      reviewedBy: 'reviewer-1',
      reviewedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    mockPrisma.progressSubmission.findFirst.mockResolvedValue(submitted);
    mockPrisma.progressSubmission.update.mockResolvedValue(approved);
    mockPrisma.activityProgress.create.mockResolvedValue({
      id: 'progress-1',
    });

    const result = await progressService.approveProgressSubmission({
      orgId: 'org-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      submissionId: 'submission-1',
      userId: 'reviewer-1',
    });

    expect(result.status).toBe('approved');
    expect(mockPrisma.activityProgress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activityId: 'activity-1',
          submissionId: 'submission-1',
          pctComplete: 60,
          progressMethod: 'quantity',
          status: 'approved',
          approvedBy: 'reviewer-1',
        }),
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'progress_submission',
        entityId: 'submission-1',
        action: 'approved',
        actorId: 'reviewer-1',
        oldStatus: 'submitted',
        newStatus: 'approved',
        summary: expect.objectContaining({
          activityId: 'activity-1',
          pctComplete: 60,
          method: 'quantity',
        }),
        attachments: [expect.objectContaining({ url: 'https://example.test/photo.jpg' })],
      }),
    );
  });
});
