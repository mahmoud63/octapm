const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findMany: jest.fn() },
  eotClaim: {
    count: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  eotClaimActivityLink: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  eotClaimWeatherDelayLink: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  projectDocument: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  commercialAttachmentRef: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  commercialCorrespondenceLink: {
    findMany: jest.fn(),
  },
  auditEvent: {
    findMany: jest.fn(),
  },
};

const mockAuditService = {
  ACTIONS: {
    CREATED: 'created',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    STATUS_CHANGED: 'status_changed',
    UPDATED: 'updated',
  },
  ENTITY_TYPES: { EOT_CLAIM: 'eot_claim' },
  recordEvent: jest.fn(),
  serializeEvent: jest.fn((event) => event),
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => mockAuditService);

const eotService = require('../eot.service');

describe('EOT traceability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'project-1',
      orgId: 'org-1',
      name: 'Tower',
      ldRatePerDay: 1000,
    });
    mockPrisma.projectDocument.findMany.mockResolvedValue([]);
    mockPrisma.projectDocument.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.commercialAttachmentRef.findMany.mockResolvedValue([]);
    mockPrisma.commercialCorrespondenceLink.findMany.mockResolvedValue([]);
    mockPrisma.auditEvent.findMany.mockResolvedValue([]);
  });

  it('creates affected activity links with critical path impact', async () => {
    mockPrisma.eotClaim.count.mockResolvedValue(0);
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: 'activity-1',
        name: 'Structure',
        p6ActivityId: 'A100',
        wbsCode: '01',
        totalFloat: 0,
        isCritical: true,
      },
      {
        id: 'activity-2',
        name: 'Facade',
        p6ActivityId: 'A200',
        wbsCode: '02',
        totalFloat: 3,
        isCritical: false,
      },
    ]);
    const created = {
      id: 'eot-1',
      projectId: 'project-1',
      ref: 'EOT-01',
      eventName: 'Storm shutdown',
      eventType: null,
      delayDays: 5,
      eotDaysGranted: 2,
      ldRatePerDay: 1000,
      ldLiability: 3000,
      status: 'draft',
      activityLinks: [],
      weatherDelayLinks: [],
    };
    mockPrisma.eotClaim.create.mockResolvedValue(created);
    mockPrisma.eotClaim.findFirst.mockResolvedValue({
      ...created,
      activityLinks: [
        { activityId: 'activity-1', criticalPathImpactDays: 5 },
        { activityId: 'activity-2', criticalPathImpactDays: 2 },
      ],
      weatherDelayLinks: [],
    });

    const result = await eotService.createEotClaim({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'pm-1',
      payload: {
        eventName: 'Storm shutdown',
        delayDays: 5,
        eotDaysGranted: 2,
        activityLinks: [
          {
            activityId: 'activity-1',
            delayDays: 5,
            delayStart: '2026-08-10',
            delayEnd: '2026-08-15',
            impactedFinish: '2026-09-05',
            impactBasis: 'Storm closure notice and CPM fragnet',
          },
          { activityId: 'activity-2', delayDays: 5 },
        ],
      },
    });

    expect(result.activityLinks).toHaveLength(2);
    expect(mockPrisma.eotClaimActivityLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            activityId: 'activity-1',
            isCritical: true,
            criticalPathImpactDays: 5,
            delayStart: new Date('2026-08-10'),
            delayEnd: new Date('2026-08-15'),
            impactedFinish: new Date('2026-09-05'),
            impactBasis: 'Storm closure notice and CPM fragnet',
            approvedEotDays: 2,
            ldExposure: 3000,
            cpmSnapshotJson: expect.objectContaining({
              totalFloat: 0,
              effectiveDelay: 7,
              approvedEotDays: 2,
              ldApplicableDays: 5,
            }),
          }),
          expect.objectContaining({
            activityId: 'activity-2',
            floatDays: 3,
            criticalPathImpactDays: 2,
          }),
        ]),
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'eot_claim',
        entityId: 'eot-1',
        summary: expect.objectContaining({
          criticalPathImpactDays: 7,
          activityLinks: 2,
        }),
      }),
    );
  });

  it('rejects submitted EOT claims without affected activities and supporting documents', async () => {
    mockPrisma.eotClaim.count.mockResolvedValue(0);

    await expect(
      eotService.createEotClaim({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'pm-1',
        payload: {
          eventName: 'Unsubstantiated access delay',
          delayDays: 4,
          eotDaysGranted: 4,
          status: 'submitted',
          activityLinks: [],
          attachmentRefs: [],
        },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'EOT_IMPACT_PROOF_REQUIRED',
    });

    expect(mockPrisma.eotClaim.create).not.toHaveBeenCalled();
  });

  it('recalculates and persists EOT activity impacts when claim delay inputs are updated', async () => {
    mockPrisma.eotClaim.findFirst.mockResolvedValue({
      id: 'eot-1',
      projectId: 'project-1',
      ref: 'EOT-01',
      eventName: 'Storm shutdown',
      eventType: null,
      delayDays: 5,
      eotDaysGranted: 2,
      ldRatePerDay: 1000,
      ldLiability: 3000,
      analysis: null,
      claimLetter: null,
      status: 'draft',
    });
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: 'activity-1',
        name: 'Structure',
        p6ActivityId: 'A100',
        wbsCode: '01',
        totalFloat: 1,
        isCritical: false,
      },
    ]);
    mockPrisma.projectDocument.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        projectId: 'project-1',
        documentType: 'workflow_evidence',
        fileName: 'EOT-01-fragnet.pdf',
        mimeType: 'application/pdf',
        storageKey: 'private-eot-key',
        scanStatus: 'clean',
        status: 'available',
      },
    ]);
    mockPrisma.eotClaim.update.mockResolvedValue({
      id: 'eot-1',
      projectId: 'project-1',
      ref: 'EOT-01',
      eventName: 'Storm shutdown',
      eventType: null,
      delayDays: 8,
      eotDaysGranted: 3,
      ldRatePerDay: 1000,
      ldLiability: 4000,
      analysis: 'Updated CPM fragnet',
      claimLetter: 'Updated claim letter',
      status: 'submitted',
      activityLinks: [],
      weatherDelayLinks: [],
    });

    await eotService.updateEotClaim({
      orgId: 'org-1',
      projectId: 'project-1',
      claimId: 'eot-1',
      userId: 'pm-1',
      workflowAction: 'submit',
      payload: {
        status: 'submitted',
        delayDays: 8,
        eotDaysGranted: 3,
        analysis: 'Updated CPM fragnet',
        activityLinks: [{ activityId: 'activity-1', delayDays: 8 }],
        attachmentRefs: [{ documentId: 'doc-1' }],
      },
    });

    expect(mockPrisma.eotClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          delayDays: 8,
          eotDaysGranted: 3,
          ldLiability: 4000,
          affectedActivities: expect.arrayContaining([
            expect.objectContaining({
              id: 'activity-1',
              criticalPathImpactDays: 7,
            }),
          ]),
        }),
      }),
    );
    expect(mockPrisma.eotClaimActivityLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            activityId: 'activity-1',
            delayDays: 8,
            criticalPathImpactDays: 7,
            approvedEotDays: 3,
            ldExposure: 4000,
          }),
        ],
      }),
    );
  });

  it('submits EOT claims through the workflow endpoint and blocks direct approvals', async () => {
    mockPrisma.eotClaim.findFirst.mockResolvedValue({
      id: 'eot-1',
      projectId: 'project-1',
      ref: 'EOT-01',
      eventName: 'Storm shutdown',
      eventType: null,
      delayDays: 5,
      eotDaysGranted: 2,
      ldRatePerDay: 1000,
      ldLiability: 3000,
      analysis: null,
      claimLetter: null,
      status: 'draft',
      activityLinks: [{ activityId: 'activity-1' }],
      weatherDelayLinks: [],
    });
    mockPrisma.eotClaim.update.mockResolvedValue({
      id: 'eot-1',
      projectId: 'project-1',
      ref: 'EOT-01',
      eventName: 'Storm shutdown',
      status: 'submitted',
      delayDays: 5,
      eotDaysGranted: 2,
      ldLiability: 3000,
      activityLinks: [{ activityId: 'activity-1' }],
      weatherDelayLinks: [],
    });
    mockPrisma.commercialAttachmentRef.findMany.mockResolvedValue([
      { id: 'att-1', recordId: 'eot-1' },
    ]);

    await eotService.submitEotClaim({
      orgId: 'org-1',
      projectId: 'project-1',
      claimId: 'eot-1',
      userId: 'planner-1',
      userRole: 'planning_eng',
    });

    expect(mockPrisma.eotClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'submitted',
          submittedBy: 'planner-1',
          submittedAt: expect.any(Date),
        }),
      }),
    );

    await expect(
      eotService.updateEotClaim({
        orgId: 'org-1',
        projectId: 'project-1',
        claimId: 'eot-1',
        userId: 'pm-1',
        payload: { status: 'approved' },
      }),
    ).rejects.toMatchObject({ code: 'EOT_WORKFLOW_ACTION_REQUIRED' });
  });

  it('approves submitted EOT claims with revised completion recommendation metadata', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'project-1',
      orgId: 'org-1',
      name: 'Tower',
      completionDate: new Date('2026-12-31T00:00:00Z'),
      ldRatePerDay: 1000,
    });
    mockPrisma.eotClaim.findFirst.mockResolvedValue({
      id: 'eot-1',
      projectId: 'project-1',
      ref: 'EOT-01',
      eventName: 'Storm shutdown',
      eventType: null,
      delayDays: 5,
      eotDaysGranted: 2,
      ldRatePerDay: 1000,
      ldLiability: 3000,
      analysis: null,
      claimLetter: null,
      status: 'submitted',
      activityLinks: [{ activityId: 'activity-1', criticalPathImpactDays: 5 }],
      weatherDelayLinks: [],
    });
    mockPrisma.eotClaim.findMany.mockResolvedValue([{ eotDaysGranted: 3 }]);
    mockPrisma.eotClaim.update.mockResolvedValue({
      id: 'eot-1',
      projectId: 'project-1',
      ref: 'EOT-01',
      eventName: 'Storm shutdown',
      status: 'approved',
      delayDays: 5,
      eotDaysGranted: 2,
      ldLiability: 3000,
      revisedCompletionRecommendation: new Date('2027-01-05T00:00:00Z'),
      cumulativeApprovedEotDays: 5,
      activityLinks: [{ activityId: 'activity-1', criticalPathImpactDays: 5 }],
      weatherDelayLinks: [],
    });
    mockPrisma.commercialAttachmentRef.findMany.mockResolvedValue([
      { id: 'att-1', recordId: 'eot-1' },
    ]);

    await eotService.approveEotClaim({
      orgId: 'org-1',
      projectId: 'project-1',
      claimId: 'eot-1',
      comment: 'Critical path proof accepted',
      userId: 'pm-1',
      userRole: 'pm',
    });

    expect(mockPrisma.eotClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'approved',
          approvedBy: 'pm-1',
          officialAt: expect.any(Date),
          cumulativeApprovedEotDays: 5,
          revisedCompletionRecommendation: new Date('2027-01-05T00:00:00Z'),
        }),
      }),
    );
  });
});
