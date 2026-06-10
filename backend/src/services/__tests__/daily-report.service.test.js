const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  dailyReport: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  auditEvent: {
    create: jest.fn(),
  },
  activityProgress: {
    create: jest.fn(),
  },
  activityProgressMethod: {
    findFirst: jest.fn(),
  },
  progressSubmission: {
    create: jest.fn(),
  },
  projectDocument: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const dailyReportService = require('../daily-report.service');

describe('daily report service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'project-1',
      orgId: 'org-1',
    });
    mockPrisma.activity.findFirst.mockResolvedValue({
      id: 'activity-1',
      projectId: 'project-1',
      isActive: true,
    });
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue({
      projectId: 'project-1',
      activityId: 'activity-1',
      method: 'percent',
      plannedQuantity: null,
      quantityUnit: null,
      milestoneWeightsJson: null,
      inspectionRequired: false,
      evidenceRequired: true,
    });
    mockPrisma.auditEvent.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'audit-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        ...data,
      }),
    );
    mockPrisma.projectDocument.findMany.mockResolvedValue([]);
    mockPrisma.projectDocument.updateMany.mockResolvedValue({ count: 0 });
  });

  it('stores manpower, materials, equipment, photos, and linked progress evidence', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    mockPrisma.dailyReport.create.mockResolvedValue({
      id: 'report-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      engineerId: 'user-1',
      date: createdAt,
      pctProgress: 25,
      manpowerJson: [{ trade: 'crew', workers: 8, hours: 8 }],
      materialsJson: [{ name: 'rebar', qty: 4, unit: 'ton' }],
      equipmentJson: [{ name: 'crane', hours: 3 }],
      photosJson: [{ url: 'https://example.test/site.jpg' }],
      notes: 'north zone',
      status: 'submitted',
      submittedAt: createdAt,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      createdAt,
      updatedAt: createdAt,
    });
    mockPrisma.progressSubmission.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'submission-1',
        createdAt,
        updatedAt: createdAt,
        ...data,
      }),
    );
    mockPrisma.dailyReport.findFirst.mockResolvedValue({
      id: 'report-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      engineerId: 'user-1',
      date: createdAt,
      pctProgress: 25,
      manpowerJson: [{ trade: 'crew', workers: 8, hours: 8 }],
      materialsJson: [{ name: 'rebar', qty: 4, unit: 'ton' }],
      equipmentJson: [{ name: 'crane', hours: 3 }],
      photosJson: [{ url: 'https://example.test/site.jpg' }],
      notes: 'north zone',
      status: 'submitted',
      submittedAt: createdAt,
      reviewedBy: null,
      reviewedAt: null,
      createdAt,
      updatedAt: createdAt,
      activity: {
        id: 'activity-1',
        name: 'Foundations',
        wbsCode: 'A.01',
        p6ActivityId: 'A1000',
      },
      progressSubmissions: [],
    });

    const report = await dailyReportService.createDailyReport({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'user-1',
      payload: {
        activityId: 'activity-1',
        date: '2026-01-01',
        pctProgress: 25,
        manpower: [{ trade: 'crew', workers: 8, hours: 8 }],
        materials: [{ name: 'rebar', qty: 4, unit: 'ton' }],
        equipment: [{ name: 'crane', hours: 3 }],
        photos: [{ url: 'https://example.test/site.jpg' }],
        notes: 'north zone',
      },
    });

    expect(report.photos).toHaveLength(1);
    expect(mockPrisma.progressSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'daily_report',
          dailyReportId: 'report-1',
          method: 'percent',
          pctComplete: 25,
          evidenceJson: {
            photos: [{ url: 'https://example.test/site.jpg' }],
          },
        }),
      }),
    );
  });

  it('returns the original report for duplicate mobile client requests', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    mockPrisma.dailyReport.findFirst.mockResolvedValue({
      id: 'report-existing',
      projectId: 'project-1',
      activityId: 'activity-1',
      engineerId: 'user-1',
      date: createdAt,
      shift: 'day',
      pctProgress: 15,
      weatherJson: { summary: 'Clear' },
      manpowerJson: [],
      materialsJson: [],
      equipmentJson: [],
      issuesJson: [],
      photosJson: [],
      notes: 'cached retry',
      clientRequestId: 'mobile-request-1',
      clientCreatedAt: createdAt,
      deviceId: 'tablet-7',
      status: 'submitted',
      submittedAt: createdAt,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      createdAt,
      updatedAt: createdAt,
      activity: { id: 'activity-1', name: 'Foundations' },
      progressSubmissions: [],
    });

    const report = await dailyReportService.createDailyReport({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'user-1',
      payload: {
        activityId: 'activity-1',
        date: '2026-01-01',
        pctProgress: 15,
        clientRequestId: 'mobile-request-1',
        clientCreatedAt: '2026-01-01T06:30:00.000Z',
        deviceId: 'tablet-7',
      },
    });

    expect(report.id).toBe('report-existing');
    expect(report.clientRequestId).toBe('mobile-request-1');
    expect(mockPrisma.activity.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.dailyReport.create).not.toHaveBeenCalled();
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });

  it('rejects photo references that were not uploaded for the project', async () => {
    mockPrisma.projectDocument.findMany.mockResolvedValue([]);

    await expect(
      dailyReportService.createDailyReport({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'user-1',
        payload: {
          activityId: 'activity-1',
          date: '2026-01-01',
          pctProgress: 10,
          photos: [{ key: 'foreign-photo-id' }],
        },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_SITE_PHOTO_REFERENCE',
    });

    expect(mockPrisma.dailyReport.create).not.toHaveBeenCalled();
  });

  it('approves a submitted report and linked progress submission', async () => {
    const now = new Date('2026-01-02T00:00:00.000Z');
    mockPrisma.dailyReport.findFirst.mockResolvedValueOnce({
      id: 'report-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      engineerId: 'user-1',
      date: now,
      pctProgress: 40,
      manpowerJson: [],
      materialsJson: [],
      equipmentJson: [],
      photosJson: [{ url: 'https://example.test/site.jpg' }],
      notes: 'ready for review',
      status: 'submitted',
      submittedAt: now,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
      activity: { id: 'activity-1', name: 'Foundations' },
      progressSubmissions: [
        {
          id: 'submission-1',
          projectId: 'project-1',
          activityId: 'activity-1',
          dailyReportId: 'report-1',
          method: 'percent',
          source: 'daily_report',
          pctComplete: 40,
          evidenceJson: { photos: [{ url: 'https://example.test/site.jpg' }] },
          status: 'submitted',
          activity: { id: 'activity-1', name: 'Foundations' },
        },
      ],
    });
    mockPrisma.progressSubmission = {
      ...mockPrisma.progressSubmission,
      findFirst: jest.fn().mockResolvedValue({
        id: 'submission-1',
        projectId: 'project-1',
        activityId: 'activity-1',
        dailyReportId: 'report-1',
        method: 'percent',
        source: 'daily_report',
        pctComplete: 40,
        evidenceJson: { photos: [{ url: 'https://example.test/site.jpg' }] },
        status: 'submitted',
        submittedBy: 'user-1',
        submittedAt: now,
        activity: { id: 'activity-1', name: 'Foundations' },
      }),
      update: jest.fn().mockResolvedValue({
        id: 'submission-1',
        projectId: 'project-1',
        activityId: 'activity-1',
        dailyReportId: 'report-1',
        method: 'percent',
        source: 'daily_report',
        pctComplete: 40,
        evidenceJson: { photos: [{ url: 'https://example.test/site.jpg' }] },
        status: 'approved',
        reviewedBy: 'pm-1',
        reviewedAt: now,
      }),
    };
    mockPrisma.activityProgress.create.mockResolvedValue({
      id: 'progress-1',
    });
    mockPrisma.dailyReport.update.mockResolvedValue({
      id: 'report-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      engineerId: 'user-1',
      date: now,
      pctProgress: 40,
      manpowerJson: [],
      materialsJson: [],
      equipmentJson: [],
      photosJson: [{ url: 'https://example.test/site.jpg' }],
      notes: 'ready for review',
      status: 'approved',
      submittedAt: now,
      reviewedBy: 'pm-1',
      reviewedAt: now,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
      activity: { id: 'activity-1', name: 'Foundations' },
      progressSubmissions: [],
    });

    const report = await dailyReportService.approveDailyReport({
      orgId: 'org-1',
      projectId: 'project-1',
      reportId: 'report-1',
      userId: 'pm-1',
    });

    expect(report.status).toBe('approved');
    expect(mockPrisma.activityProgress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          submissionId: 'submission-1',
          pctComplete: 40,
          status: 'approved',
        }),
      }),
    );
  });
});
