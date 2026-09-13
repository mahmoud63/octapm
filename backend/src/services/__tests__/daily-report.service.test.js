const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  activityAssignment: { findMany: jest.fn() },
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
  equipment: {
    findMany: jest.fn(),
  },
  activityEquipmentUsage: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  costRecord: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
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
    mockPrisma.activityAssignment.findMany.mockResolvedValue([
      { activityId: 'activity-1' },
    ]);
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
    mockPrisma.equipment.findMany.mockResolvedValue([]);
    mockPrisma.activityEquipmentUsage.findMany.mockResolvedValue([]);
    mockPrisma.activityEquipmentUsage.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: `usage-${data.sourceLineIndex ?? 1}`,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        ...data,
      }),
    );
    mockPrisma.costRecord.findFirst.mockResolvedValue(null);
    mockPrisma.costRecord.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'cost-1',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...data,
      }),
    );
    mockPrisma.costRecord.update.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'cost-1',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...data,
      }),
    );
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
      userRole: 'site_engineer',
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
    expect(mockPrisma.activityEquipmentUsage.create).not.toHaveBeenCalled();
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

  it('posts approved equipment usage to activity history and cost', async () => {
    const reportDate = new Date('2026-01-03T00:00:00.000Z');
    const reviewedAt = new Date('2026-01-04T00:00:00.000Z');
    mockPrisma.dailyReport.findFirst.mockResolvedValueOnce({
      id: 'report-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      engineerId: 'site-1',
      date: reportDate,
      pctProgress: 0,
      manpowerJson: [],
      materialsJson: [],
      equipmentJson: [
        { equipmentId: 'equip-1', name: 'Tower crane', hours: 4 },
      ],
      photosJson: [],
      notes: 'crane lift approved',
      status: 'submitted',
      submittedAt: reportDate,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      createdAt: reportDate,
      updatedAt: reportDate,
      activity: { id: 'activity-1', name: 'Foundations' },
      progressSubmissions: [],
      equipmentUsages: [],
    });
    mockPrisma.dailyReport.update.mockResolvedValue({
      id: 'report-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      engineerId: 'site-1',
      date: reportDate,
      pctProgress: 0,
      manpowerJson: [],
      materialsJson: [],
      equipmentJson: [
        { equipmentId: 'equip-1', name: 'Tower crane', hours: 4 },
      ],
      photosJson: [],
      notes: 'crane lift approved',
      status: 'approved',
      submittedAt: reportDate,
      reviewedBy: 'pm-1',
      reviewedAt,
      rejectionReason: null,
      createdAt: reportDate,
      updatedAt: reviewedAt,
      activity: { id: 'activity-1', name: 'Foundations' },
      progressSubmissions: [],
      equipmentUsages: [],
    });
    mockPrisma.equipment.findMany.mockResolvedValue([
      {
        id: 'equip-1',
        projectId: 'project-1',
        name: 'Tower crane',
        rateType: 'daily',
        rate: 800,
      },
    ]);
    mockPrisma.costRecord.findFirst.mockResolvedValue({
      id: 'cost-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      labour: 0,
      material: 0,
      equipment: 100,
      subcontract: 0,
      indirect: 0,
      overhead: 0,
      contingency: 0,
      budget: 1000,
      committed: 0,
      actual: 250,
      actualThroughDate: new Date('2026-01-02T00:00:00.000Z'),
      forecast: 1000,
      updatedAt: reportDate,
    });

    const report = await dailyReportService.approveDailyReport({
      orgId: 'org-1',
      projectId: 'project-1',
      reportId: 'report-1',
      userId: 'pm-1',
      userRole: 'pm',
    });

    expect(report.status).toBe('approved');
    expect(mockPrisma.activityEquipmentUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
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
          status: 'approved',
          approvedBy: 'pm-1',
          approvedAt: reviewedAt,
        }),
      }),
    );
    expect(mockPrisma.costRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cost-1' },
        data: expect.objectContaining({
          equipment: 500,
          // actual is no longer written here: the ledger posts it (Phase 21D, CX21-418)
          actualThroughDate: reportDate,
        }),
      }),
    );
    expect(require("../cost-ledger.service").post).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: "equipment", amount: 400, activityId: "activity-1", projectId: "project-1" }),
    );
    expect(mockPrisma.costRecord.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actual: expect.anything() }) }));
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'activity_equipment_usage',
          entityId: 'usage-0',
          action: 'created',
          newStatus: 'approved',
          summaryJson: expect.objectContaining({
            transition: 'daily_report.equipment_usage.post',
            dailyReportId: 'report-1',
          }),
        }),
      }),
    );
  });
});

jest.mock('../cost-ledger.service', () => ({
  post: jest.fn(async ({ amount }) => ({ posted: true, entry: { amount } })),
}));
