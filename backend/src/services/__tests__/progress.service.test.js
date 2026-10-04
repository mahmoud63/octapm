const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  activityAssignment: { findMany: jest.fn() },
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
    findFirst: jest.fn(async () => null),
  },
  // PC-6 integration: a typed quantity submission mints one entry at approval.
  quantityProgressEntry: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []), create: jest.fn(async ({ data }) => ({ id: 'entry-minted', ...data })), updateMany: jest.fn() },
  activityBoqAllocation: { findMany: jest.fn(async () => []) },
  // The documents a submission's photo evidence names (CERT-2 isolation).
  projectDocument: { findMany: jest.fn(async () => []) },
};
const mockAuditService = {
  ACTIONS: { APPROVED: 'approved', CREATED: 'created', REJECTED: 'rejected' },
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
    mockPrisma.activityAssignment.findMany.mockResolvedValue([
      { activityId: 'activity-1' },
    ]);
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

  it('weighs a partial milestone list against every configured milestone with its configured weight', () => {
    const methodConfig = { method: 'weighted_milestone', milestoneWeightsJson: [{ id: 'a', weight: 40 }, { id: 'b', weight: 60 }] };
    const pctOf = (milestones) => progressService.calculateProgressPercent({ method: 'weighted_milestone', methodConfig, payload: { milestones } });
    // 'a' complete alone is 40 % of the configured 100 — never 100 % of the 40 it names.
    expect(pctOf([{ id: 'a', complete: true }])).toBe(40);
    // A weight the client sends never replaces the configured one.
    expect(pctOf([{ id: 'a', complete: true, weight: 1000 }])).toBe(40);
    expect(pctOf([{ id: 'b', pctComplete: 50 }])).toBe(30);
    expect(pctOf([{ id: 'a', complete: true }, { id: 'b', complete: true }])).toBe(100);
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
      userRole: 'site_engineer',
      payload: {
        method: 'percent',
        pctComplete: 35,
      },
    });

    expect(submission.status).toBe('submitted');
    expect(submission.pctComplete).toBe(35);
    expect(mockPrisma.activityProgress.create).not.toHaveBeenCalled();
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'progress_submission',
        entityId: 'submission-1',
        action: 'created',
        actorId: 'user-1',
        newStatus: 'submitted',
        summary: expect.objectContaining({
          transition: 'submission.submit',
          activityId: 'activity-1',
          pctComplete: 35,
        }),
      }),
    );
  });

  it('blocks progress submissions from unassigned field users', async () => {
    mockPrisma.activityAssignment.findMany.mockResolvedValue([]);

    await expect(
      progressService.createProgressSubmission({
        orgId: 'org-1',
        projectId: 'project-1',
        activityId: 'activity-1',
        userId: 'site-2',
        userRole: 'site_engineer',
        payload: {
          method: 'percent',
          pctComplete: 35,
        },
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED',
      details: { activityIds: ['activity-1'] },
    });
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });

  it('allows PM and planning overrides without an activity assignment row', async () => {
    mockPrisma.activityAssignment.findMany.mockResolvedValue([]);
    mockPrisma.progressSubmission.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'submission-override',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...data,
      }),
    );

    const submission = await progressService.createProgressSubmission({
      orgId: 'org-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      userId: 'pm-1',
      userRole: 'pm',
      payload: {
        method: 'percent',
        pctComplete: 50,
      },
    });

    expect(submission.id).toBe('submission-override');
    expect(mockPrisma.activityAssignment.findMany).not.toHaveBeenCalled();
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
        userRole: 'site_engineer',
        payload: {
          method: 'percent',
          pctComplete: 35,
        },
      }),
    ).rejects.toMatchObject({ code: 'PROGRESS_EVIDENCE_REQUIRED' });
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });

  describe('photo evidence names documents of this project only (CERT-2 isolation)', () => {
    const submit = (evidence) =>
      progressService.createProgressSubmission({
        orgId: 'org-1',
        projectId: 'project-1',
        activityId: 'activity-1',
        userId: 'pm-1',
        userRole: 'pm',
        payload: { method: 'percent', pctComplete: 40, evidence },
      });

    beforeEach(() => {
      mockPrisma.progressSubmission.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'submission-evidence', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...data }),
      );
    });

    it('refuses a key that is not a document of this project before anything is written', async () => {
      mockPrisma.projectDocument.findMany.mockResolvedValue([]);
      await expect(submit({ photos: [{ key: 'foreign-doc' }] })).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_SITE_PHOTO_REFERENCE',
        details: { missing: ['foreign-doc'] },
      });
      // The lookup is scoped to the caller's organisation and this project.
      expect(mockPrisma.projectDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: 'project-1',
            orgId: 'org-1',
            OR: [{ id: { in: ['foreign-doc'] } }, { storageKey: { in: ['foreign-doc'] } }],
          },
        }),
      );
      expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
      expect(mockAuditService.recordEvent).not.toHaveBeenCalled();
    });

    it('checks every document field of a photo, not only its key', async () => {
      mockPrisma.projectDocument.findMany.mockResolvedValue([{ id: 'own-doc', storageKey: 'own-storage' }]);
      await expect(submit({ photos: [{ key: 'own-doc', documentId: 'foreign-doc' }] })).rejects.toMatchObject({
        code: 'INVALID_SITE_PHOTO_REFERENCE',
        details: { missing: ['foreign-doc'] },
      });
      await expect(submit([{ storageKey: 'foreign-doc' }])).rejects.toMatchObject({ code: 'INVALID_SITE_PHOTO_REFERENCE' });
      expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    });

    // CERT-2 shapes: a document named in another shape was skipped by the check
    // and the evidence stored as given, keeping another company's document id.
    it.each([
      ['an array', (id) => [id]],
      ['a nested array', (id) => [[id]]],
      ['an object', (id) => ({ id })],
      ['a number', () => 12345],
    ])('refuses a document named by %s — own, foreign or nowhere alike — before anything is written', async (_label, shape) => {
      mockPrisma.projectDocument.findMany.mockResolvedValue([{ id: 'own-doc', storageKey: 'own-storage' }]);
      for (const field of ['key', 'documentId', 'storageKey']) {
        for (const id of ['own-doc', 'foreign-doc', 'nowhere-doc']) {
          await expect(submit({ photos: [{ [field]: shape(id) }] })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
        }
      }
      expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    });

    it('accepts the project\'s own documents, by id or by storage key, and stores the evidence as given', async () => {
      mockPrisma.projectDocument.findMany.mockResolvedValue([{ id: 'own-doc', storageKey: 'own-storage' }]);
      const evidence = { photos: [{ key: 'own-doc', documentId: 'own-doc', storageKey: 'own-doc', url: '/x' }, { key: 'own-storage' }] };
      const submission = await submit(evidence);
      expect(submission.id).toBe('submission-evidence');
      expect(mockPrisma.progressSubmission.create).toHaveBeenCalledWith({ data: expect.objectContaining({ evidenceJson: evidence }) });
    });

    it('does not look documents up for evidence that names none (a URL, notes)', async () => {
      await submit({ photos: [{ url: 'https://example.test/photo.jpg' }, 'https://example.test/b.jpg'], notes: 'see photos' });
      expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.progressSubmission.create).toHaveBeenCalled();
    });
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

  describe('the milestone method is respected like quantity', () => {
    const milestoneConfig = {
      id: 'config-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      method: 'weighted_milestone',
      evidenceRequired: false,
      inspectionRequired: false,
      plannedQuantity: null,
      quantityUnit: null,
      milestoneWeightsJson: [
        { id: 'formwork', name: 'Formwork', weight: 40 },
        { id: 'pour', name: 'Pour', weight: 60 },
      ],
    };
    const submit = (payload) =>
      progressService.createProgressSubmission({ orgId: 'org-1', projectId: 'project-1', activityId: 'activity-1', userId: 'pm-1', userRole: 'pm', payload });

    beforeEach(() => {
      mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(milestoneConfig);
      mockPrisma.progressSubmission.create.mockImplementation(async ({ data }) => ({ id: 'submission-m', ...data }));
    });

    it('a percentage with no milestone state is refused 400 MILESTONES_REQUIRED — named or not, a draft too — never recorded at a figure worked from the configuration', async () => {
      for (const payload of [{ pctComplete: 60 }, { method: 'weighted_milestone', pctComplete: 60 }, { pctComplete: 60, status: 'draft' }, { method: 'weighted_milestone', milestones: [] }]) {
        await expect(submit(payload)).rejects.toMatchObject({
          status: 400,
          code: 'MILESTONES_REQUIRED',
          details: { activityId: 'activity-1', method: 'weighted_milestone', milestones: [{ id: 'formwork', name: 'Formwork' }, { id: 'pour', name: 'Pour' }] },
        });
      }
      expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    });

    it('a milestone the activity does not configure is no milestone state: a percentage beside it is refused 400 MILESTONES_REQUIRED naming the unknown ids, never recorded at the client percentage', async () => {
      const configured = [{ id: 'formwork', name: 'Formwork' }, { id: 'pour', name: 'Pour' }];
      for (const [payload, unknownMilestones] of [
        [{ method: 'weighted_milestone', pctComplete: 60, milestones: [{ id: 'bogus', complete: true }] }, ['bogus']],
        [{ pctComplete: 60, milestoneProgressJson: [{ id: 'nope' }] }, ['nope']],
        [{ pctComplete: 60, milestones: [{ id: 'formwork', complete: true }, { id: 'bogus', complete: true }] }, ['bogus']],
      ]) {
        await expect(submit(payload)).rejects.toMatchObject({
          status: 400,
          code: 'MILESTONES_REQUIRED',
          details: { activityId: 'activity-1', method: 'weighted_milestone', milestones: configured, unknownMilestones },
        });
      }
      expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
      // Stated rows that carry no CONFIGURED weight leave nothing to weigh: refused the same way. (A weight the
      // client sends is never the weight: { formwork, weight 0 } is still formwork's configured 40.)
      mockPrisma.activityProgressMethod.findFirst.mockResolvedValue({
        ...milestoneConfig,
        milestoneWeightsJson: [...milestoneConfig.milestoneWeightsJson, { id: 'snagging', name: 'Snagging', weight: 0 }],
      });
      await expect(submit({ pctComplete: 60, milestones: [{ id: 'snagging', complete: true }] })).rejects.toMatchObject({
        status: 400,
        code: 'MILESTONES_REQUIRED',
        message: expect.stringMatching(/carry no configured weight/),
      });
      expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
      const weighed = await submit({ pctComplete: 60, milestones: [{ id: 'formwork', weight: 0, complete: true }, { id: 'pour', weight: 0 }] });
      expect(weighed).toMatchObject({ method: 'weighted_milestone', pctComplete: 40 });
    });

    it('the writer refuses a queued milestone submission naming only an unknown milestone; nothing official is written', async () => {
      mockPrisma.progressSubmission.findFirst.mockResolvedValue({
        id: 'submission-bogus',
        projectId: 'project-1',
        activityId: 'activity-1',
        method: 'weighted_milestone',
        source: 'manual',
        pctComplete: 60,
        milestoneProgressJson: [{ id: 'bogus', complete: true }],
        evidenceJson: null,
        status: 'submitted',
        quantityEntries: [],
        activity,
      });
      await expect(
        progressService.approveProgressSubmission({ orgId: 'org-1', projectId: 'project-1', activityId: 'activity-1', submissionId: 'submission-bogus', userId: 'reviewer-1' }),
      ).rejects.toMatchObject({ status: 400, code: 'MILESTONES_REQUIRED', details: { submissionId: 'submission-bogus', unknownMilestones: ['bogus'] } });
      expect(mockPrisma.activityProgress.create).not.toHaveBeenCalled();
    });

    it('a submission stating its milestones is recorded at their weighted figure', async () => {
      const row = await submit({ milestones: [{ id: 'formwork', complete: true }, { id: 'pour', pctComplete: 50 }] });
      expect(row).toMatchObject({ method: 'weighted_milestone', pctComplete: 70 });
    });

    it('a configuration with no weighted milestone, and an activity with no configured method, take the percentage as before', async () => {
      mockPrisma.activityProgressMethod.findFirst.mockResolvedValue({ ...milestoneConfig, milestoneWeightsJson: [] });
      expect(await submit({ pctComplete: 35 })).toMatchObject({ method: 'weighted_milestone', pctComplete: 35 });
      mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(null);
      expect(await submit({ method: 'weighted_milestone', pctComplete: 45 })).toMatchObject({ method: 'weighted_milestone', pctComplete: 45 });
    });

    it('the writer refuses a milestone submission in the queue that states no milestone; nothing official is written', async () => {
      const pending = {
        id: 'submission-old',
        projectId: 'project-1',
        activityId: 'activity-1',
        method: 'weighted_milestone',
        source: 'manual',
        pctComplete: 0,
        milestoneProgressJson: null,
        evidenceJson: null,
        status: 'submitted',
        quantityEntries: [],
        activity,
      };
      mockPrisma.progressSubmission.findFirst.mockResolvedValue(pending);
      await expect(
        progressService.approveProgressSubmission({ orgId: 'org-1', projectId: 'project-1', activityId: 'activity-1', submissionId: 'submission-old', userId: 'reviewer-1' }),
      ).rejects.toMatchObject({ status: 400, code: 'MILESTONES_REQUIRED', details: { submissionId: 'submission-old' } });
      expect(mockPrisma.progressSubmission.update).not.toHaveBeenCalled();
      expect(mockPrisma.activityProgress.create).not.toHaveBeenCalled();
    });
  });
});
