const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  scheduleRevision: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  activity: {
    findMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  activityDependency: {
    deleteMany: jest.fn(),
    findMany: jest.fn(),
    createMany: jest.fn(),
  },
  activityProgress: { deleteMany: jest.fn() },
  activityMaterial: { deleteMany: jest.fn() },
  activityEquipment: { deleteMany: jest.fn() },
  activityAssignment: { deleteMany: jest.fn() },
  costRecord: {
    deleteMany: jest.fn(),
    findMany: jest.fn(),
    createMany: jest.fn(),
  },
  longLeadItem: { deleteMany: jest.fn() },
  risk: { deleteMany: jest.fn() },
  resourceAllocation: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};

process.env.ANTHROPIC_API_KEY = 'test-key';

const mockBuildAllocationSummary = jest.fn();
const mockGetApprovedActivityAllocationTotals = jest.fn();
const mockAuditService = {
  ACTIONS: {
    APPROVED: 'approved',
    BASELINE_LOCKED: 'baseline_locked',
    REJECTED: 'rejected',
    STATUS_CHANGED: 'status_changed',
    SUPERSEDED: 'superseded',
  },
  ENTITY_TYPES: { SCHEDULE_REVISION: 'schedule_revision' },
  recordEvent: jest.fn(),
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

/**
 * Activating a revision recalculates the critical path. The engine itself is
 * covered by its own tests and by the live import harness; what matters here is
 * that activation asks for it, so the mock stands in for the calculation.
 */
const mockApplyCpm = jest.fn();
jest.mock('../cpm.service', () => ({
  ...jest.requireActual('../cpm.service'),
  applyCpmToProject: mockApplyCpm,
}));
jest.mock('../activity-boq-allocation.service', () => ({
  buildAllocationSummary: mockBuildAllocationSummary,
  getApprovedActivityAllocationTotals: mockGetApprovedActivityAllocationTotals,
}));
jest.mock('../audit.service', () => mockAuditService);

const scheduleService = require('../schedule.service');

const project = {
  id: 'project-1',
  orgId: 'org-1',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: new Date('2026-12-31T00:00:00.000Z'),
};

const revision = {
  id: 'revision-1',
  projectId: 'project-1',
  label: 'Rev A',
  activityCount: 2,
  criticalCount: 1,
  totalBudget: 100,
  status: 'under_review',
  statusTransitionLog: [],
  createdAt: new Date('2026-06-09T00:00:00.000Z'),
};

const readyActivities = [
  {
    id: 'activity-1',
    projectId: 'project-1',
    name: 'Start',
    wbsCode: 'A-100',
    p6ActivityId: null,
    duration: 1,
    earlyStart: 0,
    earlyFinish: 1,
    totalFloat: 0,
    isCritical: true,
    isMilestone: false,
    predecessors: null,
  },
  {
    id: 'activity-2',
    projectId: 'project-1',
    name: 'Finish',
    wbsCode: 'A-200',
    p6ActivityId: null,
    duration: 2,
    earlyStart: 1,
    earlyFinish: 3,
    totalFloat: 1,
    isCritical: false,
    isMilestone: false,
    predecessors: 'A-100',
  },
];

const readyAllocationSummary = {
  totalBoqAmount: 100,
  approvedAllocatedAmount: 100,
  pendingAllocatedAmount: 0,
  unallocatedAmount: 0,
};

function mockCurrentRevision(row = revision, { active = false } = {}) {
  mockPrisma.scheduleRevision.findFirst
    .mockResolvedValueOnce(active ? row : null)
    .mockResolvedValueOnce(active ? null : row)
    .mockResolvedValueOnce(row);
}

describe('schedule revision lifecycle service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue(project);
    mockPrisma.activity.findMany.mockResolvedValue(readyActivities);
    mockPrisma.activity.update.mockResolvedValue({});
    mockPrisma.activity.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `new-${data.p6ActivityId || data.wbsCode}`, ...data }),
    );
    mockPrisma.activityDependency.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.activityDependency.findMany.mockResolvedValue([]);
    mockPrisma.activityDependency.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.costRecord.findMany.mockResolvedValue([]);
    mockPrisma.costRecord.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.resourceAllocation.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.scheduleRevision.findMany.mockResolvedValue([]);
    mockPrisma.scheduleRevision.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...revision, ...data }),
    );
    mockBuildAllocationSummary.mockResolvedValue(readyAllocationSummary);
    mockGetApprovedActivityAllocationTotals.mockResolvedValue(new Map());
  });

  it('approves an under-review revision with approver audit fields', async () => {
    mockCurrentRevision(revision);

    const result = await scheduleService.approveRevision({
      orgId: 'org-1',
      projectId: 'project-1',
      revisionId: 'revision-1',
      userId: 'user-1',
      comment: 'Ready for baseline',
    });

    expect(result.status).toBe('approved');
    expect(mockPrisma.scheduleRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'revision-1' },
        data: expect.objectContaining({
          status: 'approved',
          approvedBy: 'user-1',
          approvedAt: expect.any(Date),
          approvalComment: 'Ready for baseline',
          readinessJson: expect.objectContaining({ ready: true }),
          statusTransitionLog: expect.arrayContaining([
            expect.objectContaining({
              from: 'under_review',
              to: 'approved',
              by: 'user-1',
            }),
          ]),
        }),
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'schedule_revision',
        entityId: 'revision-1',
        action: 'approved',
        actorId: 'user-1',
        oldStatus: 'under_review',
        newStatus: 'approved',
      }),
    );
  });

  it('blocks approval when readiness checks fail', async () => {
    mockCurrentRevision(revision);
    mockBuildAllocationSummary.mockResolvedValue({
      totalBoqAmount: 100,
      approvedAllocatedAmount: 0,
      pendingAllocatedAmount: 0,
      unallocatedAmount: 100,
    });

    await expect(
      scheduleService.approveRevision({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId: 'revision-1',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_NOT_READY' });

    expect(mockPrisma.scheduleRevision.update).not.toHaveBeenCalled();
  });

  it('rejects an under-review revision with a preserved reason', async () => {
    mockCurrentRevision(revision);

    const result = await scheduleService.rejectRevision({
      orgId: 'org-1',
      projectId: 'project-1',
      revisionId: 'revision-1',
      userId: 'pm-1',
      reason: 'Missing procurement logic',
    });

    expect(result.status).toBe('rejected');
    expect(mockPrisma.scheduleRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          rejectedBy: 'pm-1',
          rejectedAt: expect.any(Date),
          rejectionReason: 'Missing procurement logic',
          statusTransitionLog: expect.arrayContaining([
            expect.objectContaining({
              from: 'under_review',
              to: 'rejected',
              reason: 'Missing procurement logic',
            }),
          ]),
        }),
      }),
    );
  });

  it('does not baseline a draft revision', async () => {
    const draft = { ...revision, status: 'draft' };
    mockCurrentRevision(draft);

    await expect(
      scheduleService.lockBaseline({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId: 'revision-1',
        userId: 'pm-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REVISION_STATUS' });

    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
  });

  it('locks baseline only after approval and records baseline audit fields', async () => {
    const approved = { ...revision, status: 'approved' };
    mockCurrentRevision(approved);

    const result = await scheduleService.lockBaseline({
      orgId: 'org-1',
      projectId: 'project-1',
      revisionId: 'revision-1',
      userId: 'pm-1',
      comment: 'Owner approved baseline',
    });

    expect(result.locked).toBe(2);
    expect(mockPrisma.activity.update).toHaveBeenCalledTimes(2);
    expect(mockPrisma.scheduleRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'revision-1' },
        data: expect.objectContaining({
          status: 'baselined',
          baselinedBy: 'pm-1',
          baselinedAt: expect.any(Date),
          baselineComment: 'Owner approved baseline',
          statusTransitionLog: expect.arrayContaining([
            expect.objectContaining({
              from: 'approved',
              to: 'baselined',
              by: 'pm-1',
            }),
          ]),
        }),
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'schedule_revision',
        entityId: 'revision-1',
        action: 'baseline_locked',
        actorId: 'pm-1',
        oldStatus: 'approved',
        newStatus: 'baselined',
        reason: 'Owner approved baseline',
        summary: expect.objectContaining({ lockedActivities: 2 }),
      }),
    );
  });

  it('activates a staged approved revision without deleting linked operational records', async () => {
    const stagedRevision = {
      ...revision,
      id: 'revision-2',
      status: 'approved',
      isActive: false,
      source: 'ai',
      snapshotJson: {
        source: 'ai',
        activities: [
          {
            draftKey: 'A-100',
            p6ActivityId: 'A-100',
            name: 'Start revised',
            duration: 2,
            earlyStart: 0,
            earlyFinish: 2,
            totalFloat: 0,
            isCritical: true,
            budget: 120,
            sortOrder: 0,
          },
          {
            draftKey: 'A-300',
            p6ActivityId: 'A-300',
            name: 'New finish',
            duration: 3,
            earlyStart: 2,
            earlyFinish: 5,
            totalFloat: 0,
            isCritical: true,
            budget: 80,
            sortOrder: 1,
          },
        ],
      },
    };
    const activeRevision = {
      ...revision,
      id: 'revision-1',
      status: 'approved',
      isActive: true,
    };
    const existingActivities = [
      {
        id: 'activity-1',
        projectId: 'project-1',
        name: 'Start',
        p6ActivityId: 'A-100',
        wbsCode: null,
        sortOrder: 0,
      },
      {
        id: 'activity-2',
        projectId: 'project-1',
        name: 'Removed activity',
        p6ActivityId: 'A-200',
        wbsCode: null,
        sortOrder: 1,
      },
    ];

    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(stagedRevision)
      .mockResolvedValueOnce(activeRevision);
    mockPrisma.activity.findMany.mockResolvedValueOnce(existingActivities);
    mockPrisma.activity.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data }),
    );
    mockPrisma.activity.create.mockResolvedValue({
      id: 'activity-3',
      projectId: 'project-1',
      name: 'New finish',
      p6ActivityId: 'A-300',
    });
    mockPrisma.costRecord.findMany.mockResolvedValue([
      { activityId: 'activity-1' },
    ]);
    mockPrisma.scheduleRevision.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ ...stagedRevision, id: where.id, ...data }),
    );

    const result = await scheduleService.activateRevision({
      orgId: 'org-1',
      projectId: 'project-1',
      revisionId: 'revision-2',
      userId: 'pm-1',
      mappings: [{ oldActivityId: 'activity-1', newActivityKey: 'A-100' }],
      unmappedRemovals: [
        { oldActivityId: 'activity-2', reason: 'Deleted from approved update' },
      ],
      comment: 'Owner approved revision',
    });

    expect(result.revision.isActive).toBe(true);
    // Without this the planner's first sight of an imported programme is every
    // activity starting on day one with no dates, and a critical path copied
    // from the file rather than calculated.
    expect(mockApplyCpm).toHaveBeenCalledWith('project-1', expect.anything());
    expect(mockPrisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'activity-1' },
        data: expect.objectContaining({
          name: 'Start revised',
          isActive: true,
        }),
      }),
    );
    expect(mockPrisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'activity-2' },
        data: expect.objectContaining({
          isActive: false,
          retiredReason: 'Deleted from approved update',
          retiredRevisionId: 'revision-2',
        }),
      }),
    );
    expect(mockPrisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'New finish',
          isActive: true,
        }),
      }),
    );
    expect(mockPrisma.costRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ activityId: 'activity-3' }),
        ]),
      }),
    );

    expect(mockPrisma.activityProgress.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.costRecord.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.longLeadItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.risk.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.activityAssignment.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.activityMaterial.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.activityEquipment.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.resourceAllocation.deleteMany).not.toHaveBeenCalled();
  });

  it('requires a reason before retiring unmapped active activities', async () => {
    const stagedRevision = {
      ...revision,
      id: 'revision-2',
      status: 'approved',
      isActive: false,
      snapshotJson: {
        activities: [
          {
            draftKey: 'A-100',
            p6ActivityId: 'A-100',
            name: 'Start revised',
          },
        ],
      },
    };
    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(stagedRevision)
      .mockResolvedValueOnce({ ...revision, isActive: true });
    mockPrisma.activity.findMany.mockResolvedValueOnce([
      {
        id: 'activity-1',
        projectId: 'project-1',
        name: 'Start',
        p6ActivityId: 'A-100',
      },
      {
        id: 'activity-2',
        projectId: 'project-1',
        name: 'Removed activity',
        p6ActivityId: 'A-200',
      },
    ]);

    await expect(
      scheduleService.activateRevision({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId: 'revision-2',
        userId: 'pm-1',
        mappings: [{ oldActivityId: 'activity-1', newActivityKey: 'A-100' }],
        unmappedRemovals: [],
      }),
    ).rejects.toMatchObject({ code: 'UNMAPPED_REMOVAL_REASON_REQUIRED' });

    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
    expect(mockPrisma.activityProgress.deleteMany).not.toHaveBeenCalled();
  });
});
