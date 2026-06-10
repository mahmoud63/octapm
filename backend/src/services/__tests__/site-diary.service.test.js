const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  siteDiary: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  auditEvent: {
    create: jest.fn(),
  },
  projectDocument: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const siteDiaryService = require('../site-diary.service');

describe('site diary service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'project-1',
      orgId: 'org-1',
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

  it('stores project-level manpower, equipment, materials, photos, and notes', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    mockPrisma.projectDocument.findMany.mockResolvedValue([
      { id: 'photo-1.jpg', storageKey: 'photo-1.jpg' },
    ]);
    mockPrisma.siteDiary.create.mockResolvedValue({
      id: 'diary-1',
      projectId: 'project-1',
      engineerId: 'user-1',
      date: createdAt,
      shift: 'day',
      weather: 'Clear',
      weatherJson: { summary: 'Clear' },
      workers: 12,
      visitors: 'client team',
      workDone: 'Concrete pour',
      issues: null,
      issuesJson: [],
      instructions: null,
      manpowerJson: [{ trade: 'civil', workers: 12, hours: 8 }],
      materialsJson: [{ name: 'concrete', qty: 60, unit: 'm3' }],
      equipmentJson: [{ name: 'pump', hours: 6 }],
      photosJson: [{ key: 'photo-1.jpg', url: '/api/v1/photo-1.jpg' }],
      notes: 'No blockers',
      status: 'submitted',
      submittedAt: createdAt,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      clientRequestId: 'diary-mobile-1',
      clientCreatedAt: createdAt,
      deviceId: 'tablet-7',
      createdAt,
      updatedAt: createdAt,
    });

    const diary = await siteDiaryService.createSiteDiary({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'user-1',
      payload: {
        date: '2026-01-01',
        weather: 'Clear',
        weatherDetails: { summary: 'Clear' },
        shift: 'day',
        workers: 12,
        visitors: 'client team',
        workDone: 'Concrete pour',
        manpower: [{ trade: 'civil', workers: 12, hours: 8 }],
        materials: [{ name: 'concrete', qty: 60, unit: 'm3' }],
        equipment: [{ name: 'pump', hours: 6 }],
        photos: [{ key: 'photo-1.jpg', url: '/api/v1/photo-1.jpg' }],
        notes: 'No blockers',
        status: 'submitted',
        clientRequestId: 'diary-mobile-1',
        clientCreatedAt: '2026-01-01T06:30:00.000Z',
        deviceId: 'tablet-7',
      },
    });

    expect(diary.status).toBe('submitted');
    expect(diary.materials).toHaveLength(1);
    expect(diary.lineSummary.photoCount).toBe(1);
    expect(mockPrisma.projectDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          linkedEntityType: 'site_diary',
          linkedEntityId: 'diary-1',
        },
      }),
    );
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'site_diary',
          action: 'created',
        }),
      }),
    );
  });

  it('returns the original diary for duplicate mobile client requests', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    mockPrisma.siteDiary.findFirst.mockResolvedValue({
      id: 'diary-existing',
      projectId: 'project-1',
      engineerId: 'user-1',
      date: createdAt,
      shift: 'night',
      weather: 'Windy',
      weatherJson: { summary: 'Windy' },
      workers: 8,
      visitors: null,
      workDone: 'Night pour',
      issues: null,
      issuesJson: [],
      instructions: null,
      manpowerJson: [],
      materialsJson: [],
      equipmentJson: [],
      photosJson: [],
      notes: null,
      status: 'submitted',
      submittedAt: createdAt,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      clientRequestId: 'diary-mobile-1',
      clientCreatedAt: createdAt,
      deviceId: 'tablet-7',
      createdAt,
      updatedAt: createdAt,
    });

    const diary = await siteDiaryService.createSiteDiary({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'user-1',
      payload: {
        date: '2026-01-01',
        workers: 8,
        clientRequestId: 'diary-mobile-1',
      },
    });

    expect(diary.id).toBe('diary-existing');
    expect(diary.clientRequestId).toBe('diary-mobile-1');
    expect(mockPrisma.siteDiary.create).not.toHaveBeenCalled();
    expect(mockPrisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects diary photo references that are not project site photos', async () => {
    mockPrisma.projectDocument.findMany.mockResolvedValue([]);

    await expect(
      siteDiaryService.createSiteDiary({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'user-1',
        payload: {
          date: '2026-01-01',
          workers: 8,
          photos: [{ key: 'other-project-photo' }],
          status: 'submitted',
        },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_SITE_PHOTO_REFERENCE',
    });

    expect(mockPrisma.siteDiary.create).not.toHaveBeenCalled();
  });

  it('rejects a submitted diary with reviewer metadata and reason', async () => {
    const date = new Date('2026-01-02T00:00:00.000Z');
    mockPrisma.siteDiary.findFirst.mockResolvedValue({
      id: 'diary-1',
      projectId: 'project-1',
      engineerId: 'user-1',
      date,
      weather: 'Windy',
      workers: 8,
      visitors: null,
      workDone: 'Formwork',
      issues: null,
      instructions: null,
      manpowerJson: [],
      materialsJson: [],
      equipmentJson: [],
      photosJson: [],
      notes: null,
      status: 'submitted',
      submittedAt: date,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      createdAt: date,
      updatedAt: date,
    });
    mockPrisma.siteDiary.update.mockResolvedValue({
      id: 'diary-1',
      projectId: 'project-1',
      engineerId: 'user-1',
      date,
      weather: 'Windy',
      workers: 8,
      visitors: null,
      workDone: 'Formwork',
      issues: null,
      instructions: null,
      manpowerJson: [],
      materialsJson: [],
      equipmentJson: [],
      photosJson: [],
      notes: null,
      status: 'rejected',
      submittedAt: date,
      reviewedBy: 'pm-1',
      reviewedAt: date,
      rejectionReason: 'Missing photos',
      createdAt: date,
      updatedAt: date,
    });

    const diary = await siteDiaryService.rejectSiteDiary({
      orgId: 'org-1',
      projectId: 'project-1',
      diaryId: 'diary-1',
      userId: 'pm-1',
      reason: 'Missing photos',
    });

    expect(diary.status).toBe('rejected');
    expect(diary.rejectionReason).toBe('Missing photos');
  });
});
