const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  boqItem: { count: jest.fn() },
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
    // A bill exists unless a test says otherwise (reset, so a queued answer
    // a failing test left behind never reaches the next one).
    mockPrisma.boqItem.count.mockReset().mockResolvedValue(2);
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

  it('approves with the BOQ still unallocated: coverage is a baseline check, not an approval check (D5)', async () => {
    mockCurrentRevision(revision);
    mockBuildAllocationSummary.mockResolvedValue({
      totalBoqAmount: 100,
      approvedAllocatedAmount: 0,
      pendingAllocatedAmount: 0,
      unallocatedAmount: 100,
    });

    const result = await scheduleService.approveRevision({
      orgId: 'org-1',
      projectId: 'project-1',
      revisionId: 'revision-1',
      userId: 'user-1',
    });
    expect(result.status).toBe('approved');
  });

  it('refuses the baseline lock while BOQ value is unallocated, naming Project Controls › Mapping (D5)', async () => {
    mockCurrentRevision({ ...revision, status: 'approved', isActive: true }, { active: true });
    mockBuildAllocationSummary.mockResolvedValue({
      totalBoqAmount: 100,
      approvedAllocatedAmount: 0,
      pendingAllocatedAmount: 0,
      unallocatedAmount: 100,
    });

    await expect(
      scheduleService.lockBaseline({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId: 'revision-1',
        userId: 'pm-1',
      }),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_READY',
      message:
        'Schedule readiness checks must pass before baseline lock: BOQ allocations — BOQ value remains unallocated to approved schedule activities (Project Controls › Mapping).',
    });
    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
  });

  it('blocks approval when the revision\'s own logic fails', async () => {
    mockCurrentRevision(revision);
    mockPrisma.activity.findMany.mockResolvedValue(
      readyActivities.map((activity) => ({ ...activity, predecessors: null })),
    );

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

  it('refuses the baseline lock of a project with no BOQ item, before any schedule step, and writes nothing', async () => {
    mockPrisma.boqItem.count.mockResolvedValue(0);

    await expect(
      scheduleService.lockBaseline({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId: 'revision-1',
        userId: 'pm-1',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'BOQ_REQUIRED_FOR_BASELINE',
      message:
        'BOQ required before baseline lock: upload the BOQ (BOQ page), then map it to the schedule and lock the baseline.',
    });

    expect(mockPrisma.boqItem.count).toHaveBeenCalledWith({
      where: { projectId: 'project-1', isActive: true },
    });
    // Named before the revision is even looked up, and nothing is written.
    expect(mockPrisma.scheduleRevision.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleRevision.update).not.toHaveBeenCalled();
    expect(mockAuditService.recordEvent).not.toHaveBeenCalled();
  });

  it('refuses the baseline lock when the bill is removed before the lock writes, inside its transaction', async () => {
    mockCurrentRevision({ ...revision, status: 'approved', isActive: true }, { active: true });
    mockPrisma.boqItem.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

    await expect(
      scheduleService.lockBaseline({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId: 'revision-1',
        userId: 'pm-1',
      }),
    ).rejects.toMatchObject({ code: 'BOQ_REQUIRED_FOR_BASELINE' });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleRevision.update).not.toHaveBeenCalled();
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

describe('scheduleNotReadyMessage', () => {
  const check = (key, label, message) => ({
    key,
    label,
    message,
    severity: 'blocking',
    passed: false,
  });

  it('keeps an acronym that starts a check message, and lower-cases an ordinary first word mid-sentence', () => {
    const message = scheduleService.scheduleNotReadyMessage(
      {
        checks: [
          check('predecessors', 'Predecessor logic', 'At least one predecessor relationship is required.'),
          check('allocations', 'BOQ allocations', 'BOQ value remains unallocated to approved schedule activities.'),
          check('critical_path', 'Critical path', 'A critical path is required.'),
          { key: 'date_sanity', label: 'Dates', message: 'Passed.', severity: 'blocking', passed: true },
        ],
      },
      'approval',
    );
    expect(message).toBe(
      'Schedule readiness checks must pass before approval: ' +
        'Predecessor logic — at least one predecessor relationship is required (Schedule › Gantt › Edit); ' +
        'BOQ allocations — BOQ value remains unallocated to approved schedule activities (Project Controls › Mapping); ' +
        'Critical path — a critical path is required (Schedule › More actions › Recalculate CPM).',
    );
    expect(message).not.toMatch(/\bbOQ\b/);
    // The read-only Critical Path tab and the Activities table are never
    // named as places to fix anything.
    expect(message).not.toMatch(/Schedule › Critical Path|Schedule › Activities/);
  });

  it('a staged revision is never sent to a page that shows only the active schedule: its fix is the corrected import, or the rejection', () => {
    const readiness = scheduleService.buildScheduleReadiness({
      project: { id: 'p', startDate: new Date('2026-01-05'), endDate: new Date('2026-12-18') },
      revision: { id: 'r', isActive: false, status: 'under_review' },
      activities: [
        { id: 'a', name: 'A', duration: 5, earlyStart: 0, earlyFinish: 5, totalFloat: 0, isCritical: true, predecessors: '' },
        { id: 'b', name: 'B', duration: 5, earlyStart: 5, earlyFinish: 10, totalFloat: 0, isCritical: true, predecessors: '' },
      ],
      allocationSummary: {},
    });
    const message = scheduleService.scheduleNotReadyMessage(readiness, 'approval', { gate: 'approval' });
    expect(message).toBe(
      'Schedule readiness checks must pass before approval: Predecessor logic — at least one predecessor relationship is required. ' +
        'A staged revision cannot be edited: correct the schedule at its source and import it again, or regenerate it from the BOQ (Schedule › Update Schedule) — the new revision replaces this one, or reject this revision (Schedule Review).',
    );
    expect(message).not.toMatch(/Gantt|Activities|Critical Path/);
    // A reader who may not import is told who can.
    const denied = scheduleService.scheduleNotReadyMessage(readiness, 'approval', {
      gate: 'approval',
      access: { can: () => false },
    });
    expect(denied).toBe(`${message} The step on Schedule › Update Schedule needs a member who can create schedules (import or generate); ask one of them.`);
    expect(scheduleService.scheduleNotReadyMessage(readiness, 'approval', { gate: 'approval', access: { can: () => true } })).toBe(message);
  });
});

describe('the baseline readiness says what the lock says: no BOQ, no baseline', () => {
  // A sound, active schedule: its own logic passes both gates.
  const sound = (allocationSummary) =>
    scheduleService.buildScheduleReadiness({
      project: { id: 'p', startDate: new Date('2026-01-05'), endDate: new Date('2026-12-18') },
      revision: { id: 'r', isActive: true, status: 'approved' },
      activities: [
        { id: 'a', name: 'A', activityCode: 'A', duration: 5, earlyStart: 0, earlyFinish: 5, totalFloat: 0, isCritical: true, predecessors: '' },
        { id: 'b', name: 'B', activityCode: 'B', duration: 5, earlyStart: 5, earlyFinish: 10, totalFloat: 0, isCritical: true, predecessors: 'A' },
      ],
      allocationSummary,
    });

  it('with no BOQ row the baseline is not ready, and its first failing step is the upload on the BOQ page', () => {
    const readiness = sound({ items: [], totalBoqAmount: 0 });

    // The approval's verdict is the revision's own logic, unchanged.
    expect([readiness.ready, readiness.blockingCount]).toEqual([true, 0]);
    expect([readiness.baselineReady, readiness.baselineBlockingCount]).toEqual([false, 1]);
    expect(readiness.checks[0]).toEqual({
      key: 'boq_present',
      label: 'BOQ',
      requiredFor: ['baseline'],
      passed: false,
      severity: 'blocking',
      message: 'No BOQ has been uploaded; a baseline locks a BOQ mapped to the schedule.',
      details: {},
      fix: {
        where: 'BOQ page',
        inline: true,
        permission: 'boq.create',
        next: 'upload the BOQ (BOQ page)',
        text: "Upload the BOQ on the BOQ page, then map it to the schedule's activities (Project Controls › Mapping) and lock the baseline.",
      },
    });
    // Said as the lock's refusal is said, with the page that offers the step.
    expect(scheduleService.scheduleNotReadyMessage(readiness, 'baseline lock', { gate: 'baseline' })).toBe(
      'Schedule readiness checks must pass before baseline lock: BOQ — no BOQ has been uploaded; a baseline locks a BOQ mapped to the schedule (BOQ page).',
    );
  });

  it('with a BOQ the check passes and names nothing; the mapping is the next step', () => {
    const readiness = sound({ items: [{ id: 'i1' }], totalBoqAmount: 1000, allocatableBoqAmount: 1000, unallocatedAmount: 1000, approvedAllocatedAmount: 0 });

    expect(readiness.checks[0]).toMatchObject({ key: 'boq_present', passed: true, fix: null, details: {} });
    expect(readiness.checks.filter((check) => !check.passed).map((check) => check.key)).toEqual(['allocations']);
    expect(readiness.baselineReady).toBe(false);

    const mapped = sound({ items: [{ id: 'i1' }], totalBoqAmount: 1000, unallocatedAmount: 0, approvedAllocatedAmount: 1000 });
    expect([mapped.ready, mapped.baselineReady, mapped.baselineBlockingCount]).toEqual([true, true, 0]);
  });

  it('a summary that does not list the rows says nothing about the BOQ (no check is invented)', () => {
    expect(sound({}).checks.map((check) => check.key)).toEqual(['predecessors', 'allocations', 'critical_path', 'date_sanity']);
  });
});
