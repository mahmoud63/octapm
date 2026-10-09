const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  boqItem: { count: jest.fn(), aggregate: jest.fn() },
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

// The bill as the lock reads it, one state per check the lock makes
// (before its transaction, then inside it): how many active rows it has, the
// value of its priced rows (the sum of the amounts above zero) and the value
// of its in-scope ones (priced, and a rule neither not applicable nor
// optional). Each check starts with the rows' count, which moves to the next
// state.
function mockBill(...states) {
  let check = -1;
  const current = () => states[Math.min(Math.max(check, 0), states.length - 1)];
  mockPrisma.boqItem.count.mockImplementation(() => {
    check += 1;
    return Promise.resolve(current().items);
  });
  mockPrisma.boqItem.aggregate.mockImplementation(({ where }) =>
    Promise.resolve({ _sum: { amount: where.mappingRule ? current().inScope : current().priced } }),
  );
}
const IN_SCOPE_BILL = { items: 2, priced: 200, inScope: 200 };

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
    mockPrisma.boqItem.aggregate.mockReset().mockResolvedValue({ _sum: { amount: 200 } });
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

  it('refuses the baseline lock of a project whose bill has no priced row, naming the pricing, before any schedule step, and writes nothing (E2)', async () => {
    // A bill of two rows, both at rate 0: in scope by rule, no value.
    mockBill({ items: 2, priced: 0, inScope: 0 });

    await expect(
      scheduleService.lockBaseline({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId: 'revision-1',
        userId: 'pm-1',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'BOQ_VALUE_REQUIRED_FOR_BASELINE',
      message:
        'BOQ required before baseline lock: the bill has no value to map; price its rows (BOQ page), map them to the schedule, then lock the baseline.',
    });

    // Priced: the value of the active rows with an amount above zero.
    expect(mockPrisma.boqItem.aggregate).toHaveBeenCalledWith({
      where: { projectId: 'project-1', isActive: true, amount: { gt: 0 } },
      _sum: { amount: true },
    });
    expect(mockPrisma.scheduleRevision.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleRevision.update).not.toHaveBeenCalled();
    expect(mockAuditService.recordEvent).not.toHaveBeenCalled();
  });

  it('refuses the baseline lock of a project whose bill has no in-scope value (every priced row not applicable or optional), before any schedule step, and writes nothing (E2)', async () => {
    // A bill of two priced rows; none in scope for mapping.
    mockBill({ items: 2, priced: 2, inScope: 0 });

    await expect(
      scheduleService.lockBaseline({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId: 'revision-1',
        userId: 'pm-1',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'BOQ_SCOPE_REQUIRED_FOR_BASELINE',
      message:
        'BOQ required before baseline lock: the bill has no in-scope value to map; mark the rows that belong to the schedule as required (Project Controls › Mapping), map them, then lock the baseline.',
    });

    // In scope: the value of the rows whose rule is neither not applicable
    // nor optional, with an amount above zero.
    expect(mockPrisma.boqItem.aggregate).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        isActive: true,
        amount: { gt: 0 },
        mappingRule: { notIn: ['not_applicable', 'optional'] },
      },
      _sum: { amount: true },
    });
    expect(mockPrisma.scheduleRevision.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleRevision.update).not.toHaveBeenCalled();
    expect(mockAuditService.recordEvent).not.toHaveBeenCalled();
  });

  it('counts a bill worth one cent as no value, and one whose in-scope rows are worth one cent as out of scope — refused before any schedule step, nothing written (closure review)', async () => {
    // One required row at one cent, nothing mapped: the coverage check cannot
    // tell it covered (its remainder is within the cent tolerance), so it is
    // no value, as the setup gate says (BOQ_HAS_NO_VALUE).
    mockBill({ items: 1, priced: 0.01, inScope: 0.01 });
    await expect(
      scheduleService.lockBaseline({ orgId: 'org-1', projectId: 'project-1', revisionId: 'revision-1', userId: 'pm-1' }),
    ).rejects.toMatchObject({ status: 400, code: 'BOQ_VALUE_REQUIRED_FOR_BASELINE' });
    // ... and beside a priced not-applicable row, the in-scope cent is no
    // in-scope value.
    mockBill({ items: 2, priced: 250000.01, inScope: 0.01 });
    await expect(
      scheduleService.lockBaseline({ orgId: 'org-1', projectId: 'project-1', revisionId: 'revision-1', userId: 'pm-1' }),
    ).rejects.toMatchObject({ status: 400, code: 'BOQ_SCOPE_REQUIRED_FOR_BASELINE' });
    // Two cents are value.
    mockBill({ items: 1, priced: 0.02, inScope: 0.02 });
    mockCurrentRevision({ ...revision, status: 'draft' });
    await expect(
      scheduleService.lockBaseline({ orgId: 'org-1', projectId: 'project-1', revisionId: 'revision-1', userId: 'pm-1' }),
    ).rejects.not.toMatchObject({ code: expect.stringMatching(/^BOQ_/) });
    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleRevision.update).not.toHaveBeenCalled();
    expect(mockAuditService.recordEvent).not.toHaveBeenCalled();
  });

  it('refuses the baseline lock when the in-scope value is marked out of scope before the lock writes, inside its transaction (E2)', async () => {
    mockCurrentRevision({ ...revision, status: 'approved', isActive: true }, { active: true });
    // Before the transaction: in scope. Inside it: the bill is there and
    // priced, its value out of scope.
    mockBill(IN_SCOPE_BILL, { items: 2, priced: 200, inScope: 0 });

    await expect(
      scheduleService.lockBaseline({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId: 'revision-1',
        userId: 'pm-1',
      }),
    ).rejects.toMatchObject({ code: 'BOQ_SCOPE_REQUIRED_FOR_BASELINE' });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleRevision.update).not.toHaveBeenCalled();
  });

  it('refuses the baseline lock when the bill is priced at 0 before the lock writes, inside its transaction (E2)', async () => {
    mockCurrentRevision({ ...revision, status: 'approved', isActive: true }, { active: true });
    mockBill(IN_SCOPE_BILL, { items: 2, priced: 0, inScope: 0 });

    await expect(
      scheduleService.lockBaseline({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId: 'revision-1',
        userId: 'pm-1',
      }),
    ).rejects.toMatchObject({ code: 'BOQ_VALUE_REQUIRED_FOR_BASELINE' });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.activity.update).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleRevision.update).not.toHaveBeenCalled();
  });

  it('refuses the baseline lock when the bill is removed before the lock writes, inside its transaction', async () => {
    mockCurrentRevision({ ...revision, status: 'approved', isActive: true }, { active: true });
    // Before the transaction: a bill, in scope. Inside it: no bill.
    mockBill(IN_SCOPE_BILL, { items: 0, priced: 0, inScope: 0 });

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
    // Owner decision R5-2: activation supplies no forecast, so the record gets
    // the initial default — its staged budget (actual 0) — and is marked
    // 'default'. Unmarked, it would read as entered: never re-derived, and
    // sent to a member who may not read the BOQ.
    expect(mockPrisma.costRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ activityId: 'activity-3', budget: 80, actual: 0, forecast: 80, forecastSource: 'default' }),
        ]),
      }),
    );
    for (const row of mockPrisma.costRecord.createMany.mock.calls.flatMap(([call]) => call.data)) {
      expect([row.activityId, row.forecastSource, row.forecast]).toEqual([row.activityId, 'default', Math.max(0, row.budget, row.actual)]);
    }

    expect(mockPrisma.activityProgress.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.costRecord.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.longLeadItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.risk.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.activityAssignment.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.activityMaterial.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.activityEquipment.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.resourceAllocation.deleteMany).not.toHaveBeenCalled();
  });

  // CERT-3 WP-1 (lead only: Prisma is mocked; the pure cases are in
  // schedule-activation-keeps-codes.test.js and the proof is live). A file
  // revision's stored rows state no activity code, budget, category or
  // milestone flag (buildImportSnapshot writes none), so the mapped activities
  // keep their own; the file still drives the schedule fields.
  it('activates a file revision keeping each mapped activity\'s code, budget, category and milestone flag (CERT-3 WP-1)', async () => {
    const fileRow = (overrides) => ({
      sourceActivityId: overrides.draftKey,
      uid: null,
      wbsCode: null,
      calendarId: null,
      physComplete: 0,
      lateStart: null,
      lateFinish: null,
      totalFloat: 0,
      isCritical: true,
      ...overrides,
    });
    const stagedRevision = {
      ...revision,
      id: 'revision-3',
      status: 'approved',
      isActive: false,
      source: 'xer',
      snapshotJson: {
        source: 'xer',
        wbs: [],
        activities: [
          fileRow({ draftKey: '1001', p6ActivityId: 'A100', name: 'Site clearance (file)', duration: 5, originalDuration: 5, remainingDuration: 5, earlyStart: 0, earlyFinish: 5, startDate: '2026-01-05T08:00:00.000Z', endDate: '2026-01-09T17:00:00.000Z', sortOrder: 0 }),
          fileRow({ draftKey: '1009', p6ActivityId: 'M900', name: 'Substructure complete (file)', duration: 0, originalDuration: 0, remainingDuration: 0, earlyStart: 5, earlyFinish: 5, startDate: '2026-01-12T08:00:00.000Z', endDate: '2026-01-12T08:00:00.000Z', sortOrder: 1 }),
        ],
        dependencies: [],
      },
    };
    for (const row of stagedRevision.snapshotJson.activities) {
      for (const key of ['activityCode', 'budget', 'category', 'isMilestone']) expect(row).not.toHaveProperty(key);
    }
    const existingActivities = [
      { id: 'activity-1', projectId: 'project-1', name: 'Site clearance', activityCode: 'A100', p6ActivityId: null, wbsCode: null, budget: 60000, category: 'civil', isMilestone: false, duration: 3, sortOrder: 0 },
      { id: 'activity-9', projectId: 'project-1', name: 'M900', activityCode: 'M900', p6ActivityId: null, wbsCode: null, budget: 0, category: 'inspection', isMilestone: true, duration: 0, sortOrder: 1 },
    ];

    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(stagedRevision)
      .mockResolvedValueOnce({ ...revision, id: 'revision-1', status: 'approved', isActive: true });
    mockPrisma.activity.findMany.mockResolvedValueOnce(existingActivities);
    mockPrisma.activity.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
    mockPrisma.scheduleRevision.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ ...stagedRevision, id: where.id, ...data }),
    );

    const result = await scheduleService.activateRevision({
      orgId: 'org-1',
      projectId: 'project-1',
      revisionId: 'revision-3',
      userId: 'pm-1',
      mappings: [
        { oldActivityId: 'activity-1', newActivityKey: '1001' },
        { oldActivityId: 'activity-9', newActivityKey: '1009' },
      ],
      unmappedRemovals: [],
    });

    expect(result.revision.isActive).toBe(true);
    expect(mockPrisma.activity.create).not.toHaveBeenCalled();
    const updateOf = (id) => mockPrisma.activity.update.mock.calls.map(([call]) => call).find((call) => call.where.id === id).data;
    expect(updateOf('activity-1')).toMatchObject({
      activityCode: 'A100', budget: 60000, category: 'civil', isMilestone: false,
      p6ActivityId: 'A100', name: 'Site clearance (file)', duration: 5, isActive: true,
    });
    expect(updateOf('activity-9')).toMatchObject({
      activityCode: 'M900', budget: 0, category: 'inspection', isMilestone: true,
      p6ActivityId: 'M900', name: 'Substructure complete (file)', duration: 0, isActive: true,
    });
  });

  // CERT-3 WP-1 (lead only). A generated revision's stored row states its
  // milestone flag, and activation reads it through the stored row at the
  // staged row's index (storedRowByKey) — also for a duplicate draftKey,
  // which getSnapshotActivities renames to `key#index`. Without the stored
  // row, the activities' own (opposite) flags would be kept.
  it('activates a generated revision taking each stored row\'s stated milestone flag, by the staged row\'s index (CERT-3 WP-1)', async () => {
    const aiRow = (overrides) => ({
      wbsCode: null, duration: 2, earlyStart: 0, earlyFinish: 2, totalFloat: 0, isCritical: true, budget: 10, category: 'structural', ...overrides,
    });
    const stagedRevision = {
      ...revision,
      id: 'revision-4',
      status: 'approved',
      isActive: false,
      source: 'ai',
      snapshotJson: {
        source: 'ai',
        activities: [
          aiRow({ draftKey: 'G-100', activityCode: 'G-100', p6ActivityId: 'G-100', name: 'Frame complete', isMilestone: true, duration: 0, earlyFinish: 0, sortOrder: 0 }),
          aiRow({ draftKey: 'G-100', activityCode: 'G-101', p6ActivityId: 'G-101', name: 'Columns', isMilestone: false, sortOrder: 1 }),
        ],
      },
    };
    const existingActivities = [
      { id: 'activity-1', projectId: 'project-1', name: 'One', activityCode: 'A100', p6ActivityId: null, wbsCode: null, budget: 500, category: 'civil', isMilestone: false, sortOrder: 0 },
      { id: 'activity-2', projectId: 'project-1', name: 'Two', activityCode: 'A110', p6ActivityId: null, wbsCode: null, budget: 700, category: 'civil', isMilestone: true, sortOrder: 1 },
    ];

    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(stagedRevision)
      .mockResolvedValueOnce({ ...revision, id: 'revision-1', status: 'approved', isActive: true });
    mockPrisma.activity.findMany.mockResolvedValueOnce(existingActivities);
    mockPrisma.activity.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
    mockPrisma.scheduleRevision.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ ...stagedRevision, id: where.id, ...data }),
    );

    await scheduleService.activateRevision({
      orgId: 'org-1',
      projectId: 'project-1',
      revisionId: 'revision-4',
      userId: 'pm-1',
      mappings: [
        { oldActivityId: 'activity-1', newActivityKey: 'G-100' },
        { oldActivityId: 'activity-2', newActivityKey: 'G-100#2' },
      ],
      unmappedRemovals: [],
    });

    const updateOf = (id) => mockPrisma.activity.update.mock.calls.map(([call]) => call).find((call) => call.where.id === id).data;
    // The revision's code, category and flag; the activity's budget (H2, H3).
    expect(updateOf('activity-1')).toMatchObject({ activityCode: 'G-100', category: 'structural', isMilestone: true, budget: 500, name: 'Frame complete' });
    expect(updateOf('activity-2')).toMatchObject({ activityCode: 'G-101', category: 'structural', isMilestone: false, budget: 700, name: 'Columns' });
  });

  // CERT-3 WP-1, Codex R-M1 (lead only). Every row of the revision becomes an
  // active activity, mapped or new, so a mapped activity keeps its code only
  // when no other row carries it (a file row carries its code as its P6 id);
  // the exports' identity (activityCode || p6ActivityId) stays distinct.
  it('activates crossed file mappings leaving no two activities with one export identity (CERT-3 WP-1)', async () => {
    const fileRow = (draftKey, p6ActivityId, sortOrder) => ({
      draftKey, sourceActivityId: draftKey, p6ActivityId, name: `Row ${p6ActivityId}`, uid: null, wbsCode: null, calendarId: null,
      duration: 2, originalDuration: 2, remainingDuration: 2, earlyStart: 0, earlyFinish: 2, physComplete: 0,
      lateStart: null, lateFinish: null, totalFloat: 0, isCritical: true,
      startDate: '2026-01-05T08:00:00.000Z', endDate: '2026-01-06T17:00:00.000Z', sortOrder,
    });
    const stagedRevision = {
      ...revision,
      id: 'revision-5',
      status: 'approved',
      isActive: false,
      source: 'xer',
      snapshotJson: {
        source: 'xer',
        wbs: [],
        activities: [fileRow('1001', 'A100', 0), fileRow('1002', 'A110', 1), fileRow('1003', 'A120', 2), fileRow('1004', 'A130', 3), fileRow('1005', 'A140', 4), fileRow('1006', 'A150', 5)],
        dependencies: [],
      },
    };
    const own = (id, activityCode, sortOrder) => ({ id, projectId: 'project-1', name: id, activityCode, p6ActivityId: null, wbsCode: null, budget: 100, category: 'civil', isMilestone: false, duration: 2, sortOrder });
    const existingActivities = [
      own('activity-1', 'A100', 0), // onto A110's row; A100's row is mapped from activity-2
      own('activity-2', null, 1), // onto A100's row
      own('activity-3', 'A120', 2), // onto A130's row; A120's row is created new
      own('activity-4', 'H-9', 3), // a code no row carries, onto A150's row
      own('activity-5', 'A140', 4), // onto the row that carries its code
    ];

    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(stagedRevision)
      .mockResolvedValueOnce({ ...revision, id: 'revision-1', status: 'approved', isActive: true });
    mockPrisma.activity.findMany.mockResolvedValueOnce(existingActivities);
    mockPrisma.activity.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
    mockPrisma.activity.create.mockImplementation(({ data }) => Promise.resolve({ id: `new-${data.p6ActivityId}`, ...data }));
    mockPrisma.scheduleRevision.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ ...stagedRevision, id: where.id, ...data }),
    );

    await scheduleService.activateRevision({
      orgId: 'org-1',
      projectId: 'project-1',
      revisionId: 'revision-5',
      userId: 'pm-1',
      mappings: [
        { oldActivityId: 'activity-1', newActivityKey: '1002' },
        { oldActivityId: 'activity-2', newActivityKey: '1001' },
        { oldActivityId: 'activity-3', newActivityKey: '1004' },
        { oldActivityId: 'activity-4', newActivityKey: '1006' },
        { oldActivityId: 'activity-5', newActivityKey: '1005' },
      ],
      unmappedRemovals: [],
    });

    const updateOf = (id) => mockPrisma.activity.update.mock.calls.map(([call]) => call).find((call) => call.where.id === id).data;
    expect(['activity-1', 'activity-2', 'activity-3', 'activity-4', 'activity-5'].map((id) => [id, updateOf(id).activityCode, updateOf(id).p6ActivityId])).toEqual([
      ['activity-1', null, 'A110'],
      ['activity-2', null, 'A100'],
      ['activity-3', null, 'A130'],
      ['activity-4', 'H-9', 'A150'],
      ['activity-5', 'A140', 'A140'],
    ]);
    // A120's row is created new, with no code: its identity is its P6 id.
    expect(mockPrisma.activity.create.mock.calls.map(([call]) => [call.data.activityCode, call.data.p6ActivityId])).toEqual([[null, 'A120']]);
    const identities = [
      ...['activity-1', 'activity-2', 'activity-3', 'activity-4', 'activity-5'].map((id) => updateOf(id).activityCode || updateOf(id).p6ActivityId),
      ...mockPrisma.activity.create.mock.calls.map(([call]) => call.data.activityCode || call.data.p6ActivityId),
    ];
    expect(identities).toHaveLength(6);
    expect(new Set(identities).size).toBe(identities.length);
  });

  // CERT-3 WP-1, Codex diff round 2 (lead only). A row's stated code is an
  // identity it carries as much as its P6 id: crossing an activity coded C-X
  // onto a code-less row, while the row stating C-X is created new, leaves
  // the mapped activity without C-X.
  it('activates a crossed mapping against a row that states the code, leaving no two activities with one export identity (CERT-3 WP-1)', async () => {
    const aiRow = (overrides) => ({
      wbsCode: null, duration: 2, earlyStart: 0, earlyFinish: 2, totalFloat: 0, isCritical: true, budget: 10, category: 'structural', isMilestone: false, ...overrides,
    });
    const stagedRevision = {
      ...revision,
      id: 'revision-6',
      status: 'approved',
      isActive: false,
      source: 'ai',
      snapshotJson: {
        source: 'ai',
        activities: [
          aiRow({ draftKey: 'P-X', activityCode: 'C-X', p6ActivityId: 'P-X', name: 'States C-X', sortOrder: 0 }),
          aiRow({ draftKey: 'P-B', p6ActivityId: 'P-B', name: 'States no code', sortOrder: 1 }),
        ],
      },
    };
    expect(stagedRevision.snapshotJson.activities[1]).not.toHaveProperty('activityCode');
    const existingActivities = [
      { id: 'activity-1', projectId: 'project-1', name: 'One', activityCode: 'C-X', p6ActivityId: null, wbsCode: null, budget: 500, category: 'civil', isMilestone: false, sortOrder: 0 },
    ];

    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(stagedRevision)
      .mockResolvedValueOnce({ ...revision, id: 'revision-1', status: 'approved', isActive: true });
    mockPrisma.activity.findMany.mockResolvedValueOnce(existingActivities);
    mockPrisma.activity.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
    mockPrisma.activity.create.mockImplementation(({ data }) => Promise.resolve({ id: `new-${data.p6ActivityId}`, ...data }));
    mockPrisma.scheduleRevision.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ ...stagedRevision, id: where.id, ...data }),
    );

    await scheduleService.activateRevision({
      orgId: 'org-1',
      projectId: 'project-1',
      revisionId: 'revision-6',
      userId: 'pm-1',
      mappings: [{ oldActivityId: 'activity-1', newActivityKey: 'P-B' }],
      unmappedRemovals: [],
    });

    const updated = mockPrisma.activity.update.mock.calls.map(([call]) => call).find((call) => call.where.id === 'activity-1').data;
    expect([updated.activityCode, updated.p6ActivityId]).toEqual([null, 'P-B']);
    const created = mockPrisma.activity.create.mock.calls.map(([call]) => [call.data.activityCode, call.data.p6ActivityId]);
    expect(created).toEqual([['C-X', 'P-X']]);
    const identities = [updated.activityCode || updated.p6ActivityId, ...created.map(([code, p6]) => code || p6)];
    expect(identities).toEqual(['P-B', 'C-X']);
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
        permission: 'boq.upload',
        next: 'upload the BOQ (BOQ page)',
        text: "Upload the BOQ on the BOQ page, then map it to the schedule's activities (Project Controls › Mapping) and lock the baseline.",
      },
    });
    // Said as the lock's refusal is said, with the page that offers the step.
    expect(scheduleService.scheduleNotReadyMessage(readiness, 'baseline lock', { gate: 'baseline' })).toBe(
      'Schedule readiness checks must pass before baseline lock: BOQ — no BOQ has been uploaded; a baseline locks a BOQ mapped to the schedule (BOQ page).',
    );
  });

  it('with a bill none of whose rows is priced the check fails and names the pricing on the BOQ page; the allocations check does not say nothing blocks the baseline (E2)', () => {
    const readiness = sound({
      items: [
        { id: 'i1', mappingRule: 'required', amount: 0 },
        { id: 'i2', mappingRule: 'required', amount: 0 },
      ],
      totalBoqAmount: 0,
      approvedAllocatedAmount: 0,
    });
    expect([readiness.ready, readiness.baselineReady, readiness.baselineBlockingCount]).toEqual([true, false, 1]);
    expect(readiness.checks[0]).toEqual({
      key: 'boq_present',
      label: 'BOQ',
      requiredFor: ['baseline'],
      passed: false,
      severity: 'blocking',
      message: 'The bill has no value to map: none of its rows is priced; a baseline locks a BOQ mapped to the schedule.',
      details: {},
      fix: {
        where: 'BOQ page',
        inline: true,
        permission: 'boq.edit',
        next: "price the BOQ's rows (BOQ page)",
        text: "Price the BOQ's rows on the BOQ page, then map them to the schedule's activities (Project Controls › Mapping) and lock the baseline.",
      },
    });
    const allocations = readiness.checks.find((check) => check.key === 'allocations');
    expect([allocations.passed, allocations.message]).toEqual([true, 'No in-scope BOQ value to allocate yet.']);
    expect(scheduleService.scheduleNotReadyMessage(readiness, 'baseline lock', { gate: 'baseline' })).toBe(
      'Schedule readiness checks must pass before baseline lock: BOQ — the bill has no value to map: none of its rows is priced; a baseline locks a BOQ mapped to the schedule (BOQ page).',
    );
    // Who may price the rows, named when the reader may not.
    expect(
      scheduleService.scheduleNotReadyMessage(readiness, 'baseline lock', { gate: 'baseline', access: { can: () => false } }),
    ).toContain("The step on BOQ page needs a member who can edit the BOQ's rows; ask one of them.");
  });

  it('the fixes name the permission each page gates: the upload and a row\'s edit are the BOQ\'s own create and update; a mapping rule is the allocation update', () => {
    expect(scheduleService.FIX_PERMISSIONS['boq.upload']).toEqual({ module: 'boq', action: 'create', transition: null, who: 'upload the BOQ' });
    expect(scheduleService.FIX_PERMISSIONS['boq.edit']).toEqual({ module: 'boq', action: 'update', transition: null, who: "edit the BOQ's rows" });
    expect(scheduleService.FIX_PERMISSIONS['boq.update']).toMatchObject({ module: 'boq', action: 'update', transition: 'allocation.update' });
    expect(scheduleService.FIX_PERMISSIONS['boq.create']).toMatchObject({ module: 'boq', action: 'create', transition: 'allocation.create' });
  });

  it('with a BOQ the check passes and names nothing; the mapping is the next step', () => {
    const readiness = sound({ items: [{ id: 'i1', mappingRule: 'required', amount: 1000 }], totalBoqAmount: 1000, allocatableBoqAmount: 1000, unallocatedAmount: 1000, approvedAllocatedAmount: 0 });

    expect(readiness.checks[0]).toMatchObject({ key: 'boq_present', passed: true, fix: null, details: {} });
    expect(readiness.checks.filter((check) => !check.passed).map((check) => check.key)).toEqual(['allocations']);
    expect(readiness.baselineReady).toBe(false);

    const mapped = sound({ items: [{ id: 'i1', mappingRule: 'required', amount: 1000 }], totalBoqAmount: 1000, unallocatedAmount: 0, approvedAllocatedAmount: 1000 });
    expect([mapped.ready, mapped.baselineReady, mapped.baselineBlockingCount]).toEqual([true, true, 0]);
  });

  it('a token bill — only a not-applicable row, or only an optional row — fails the check like no bill, and its fix is the mapping rule (E2)', () => {
    for (const [name, row, summary] of [
      ['not applicable', { id: 'i1', mappingRule: 'not_applicable', amount: 500 }, { totalBoqAmount: 500, notApplicableAmount: 500, unallocatedAmount: 0 }],
      ['optional', { id: 'i1', mappingRule: 'optional', amount: 500 }, { totalBoqAmount: 500, unallocatedAmount: 500, optionalUnallocatedAmount: 500 }],
    ]) {
      const readiness = sound({ items: [row], approvedAllocatedAmount: 0, ...summary });
      // The coverage check passes vacuously on such a bill; this one does not.
      // Nor does the coverage check say nothing blocks the baseline beside it.
      const allocations = readiness.checks.find((check) => check.key === 'allocations');
      expect([name, allocations.passed, allocations.message]).toEqual([name, true, 'No in-scope BOQ value to allocate yet.']);
      expect([name, readiness.ready, readiness.baselineReady, readiness.baselineBlockingCount]).toEqual([name, true, false, 1]);
      expect([name, readiness.checks[0]]).toEqual([
        name,
        {
          key: 'boq_present',
          label: 'BOQ',
          requiredFor: ['baseline'],
          passed: false,
          severity: 'blocking',
          message:
            'The bill has no in-scope value to map: every priced row is marked not applicable or optional; a baseline locks a BOQ mapped to the schedule.',
          details: {},
          fix: {
            where: 'Project Controls › Mapping',
            inline: true,
            permission: 'boq.update',
            next: 'mark the rows that belong to the schedule as required (Project Controls › Mapping)',
            text: "Mark the BOQ rows that belong to the schedule as required on Project Controls › Mapping, map them to the schedule's activities and lock the baseline.",
          },
        },
      ]);
    }
    // A required row with no value is no in-scope value either.
    expect(sound({ items: [{ id: 'i1', mappingRule: 'required', amount: 0 }], totalBoqAmount: 0 }).checks[0].passed).toBe(false);
  });

  it('a mixed bill — in-scope rows fully mapped beside not-applicable rows — passes, and the baseline is ready (E2)', () => {
    const readiness = sound({
      items: [
        { id: 'i1', mappingRule: 'required', amount: 1000 },
        { id: 'i2', mappingRule: '', amount: 200 },
        { id: 'i3', mappingRule: 'not_applicable', amount: 500 },
      ],
      totalBoqAmount: 1700,
      notApplicableAmount: 500,
      unallocatedAmount: 0,
      approvedAllocatedAmount: 1200,
    });
    expect(readiness.checks[0]).toMatchObject({ key: 'boq_present', passed: true, fix: null });
    expect([readiness.ready, readiness.baselineReady, readiness.baselineBlockingCount]).toEqual([true, true, 0]);
  });

  it('a summary that does not list the rows says nothing about the BOQ (no check is invented)', () => {
    expect(sound({}).checks.map((check) => check.key)).toEqual(['predecessors', 'allocations', 'critical_path', 'date_sanity']);
  });
});

describe("one threshold for value, and no vacuous coverage on an in-scope bill (closure review, 2026-09-29)", () => {
  const sound = (allocationSummary) =>
    scheduleService.buildScheduleReadiness({
      project: { id: "p", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
      revision: { id: "r", isActive: true, status: "approved" },
      activities: [
        { id: "a", name: "A", activityCode: "A", duration: 5, earlyStart: 0, earlyFinish: 5, totalFloat: 0, isCritical: true, predecessors: "" },
        { id: "b", name: "B", activityCode: "B", duration: 5, earlyStart: 5, earlyFinish: 10, totalFloat: 0, isCritical: true, predecessors: "A" },
      ],
      allocationSummary,
    });
  const check = (readiness, key) => readiness.checks.find((entry) => entry.key === key);

  it("a bill whose only value is one required cent, unmapped, is not baseline-ready: it is unpriced, as the lock and the setup gate say", () => {
    const readiness = sound({ items: [{ amount: 0.01, mappingRule: "required" }], totalBoqAmount: 0.01, approvedAllocatedAmount: 0, pendingAllocatedAmount: 0, unallocatedAmount: 0.01 });
    expect(readiness.baselineReady).toBe(false);
    expect(check(readiness, "boq_present")).toMatchObject({ passed: false, message: "The bill has no value to map: none of its rows is priced; a baseline locks a BOQ mapped to the schedule." });
  });

  it("a required cent beside a $250,000 not-applicable row: no in-scope value, and no sentence that nothing blocks the baseline", () => {
    const readiness = sound({
      items: [{ amount: 0.01, mappingRule: "required" }, { amount: 250000, mappingRule: "not_applicable" }],
      totalBoqAmount: 250000.01, notApplicableAmount: 250000, approvedAllocatedAmount: 0, pendingAllocatedAmount: 0, unallocatedAmount: 0.01, optionalUnallocatedAmount: 0,
    });
    expect(readiness.baselineReady).toBe(false);
    expect(check(readiness, "boq_present")).toMatchObject({ passed: false });
    // Money is subtracted in cents: the allocatable value is the cent itself.
    expect(check(readiness, "allocations").details.allocatableBoqAmount).toBe(0.01);
    const message = scheduleService.scheduleNotReadyMessage(readiness, "baseline", { gate: "baseline" });
    expect(message).not.toMatch(/nothing blocks the baseline/);
  });

  it("on an in-scope bill the coverage check never passes without approved allocations — and a refusal always names the mapping", () => {
    // In scope by its rows; the summary says nothing is left unallocated
    // (pending allocations cover it) and nothing is approved.
    const readiness = sound({
      items: [{ amount: 100, mappingRule: "required" }],
      totalBoqAmount: 100, approvedAllocatedAmount: 0, pendingAllocatedAmount: 100, unallocatedAmount: 0,
    });
    expect(check(readiness, "boq_present")).toMatchObject({ passed: true });
    expect(check(readiness, "allocations")).toMatchObject({ passed: false, message: "No approved BOQ allocation covers the in-scope BOQ value yet." });
    const message = scheduleService.scheduleNotReadyMessage(readiness, "baseline", { gate: "baseline" });
    expect(message).toContain("BOQ allocations");
    expect(message).toContain("Project Controls › Mapping");
    expect(message).not.toMatch(/nothing blocks the baseline/);
    // Even when the summary's amounts say there is nothing to cover.
    const vacuous = sound({ items: [{ amount: 100, mappingRule: "required" }], totalBoqAmount: 0, approvedAllocatedAmount: 0, pendingAllocatedAmount: 0, unallocatedAmount: 0 });
    expect(check(vacuous, "allocations").passed).toBe(false);
    expect(vacuous.baselineReady).toBe(false);
  });

  it("covered by approved allocations, the check passes", () => {
    const readiness = sound({ items: [{ amount: 100, mappingRule: "required" }], totalBoqAmount: 100, approvedAllocatedAmount: 100, pendingAllocatedAmount: 0, unallocatedAmount: 0 });
    expect(check(readiness, "allocations")).toMatchObject({ passed: true, message: "Approved allocations cover the BOQ value." });
  });
});

// HR-S2 (owner decision, CERT-3 WP-1): a milestone, or any zero-duration
// element, is a point in time, and CPM stores it with start = end: date_sanity
// passes it. A finish before the start fails, and so does a finish on the
// start of an activity that has a duration. Start and end are always two
// distinct Date instances, so a reference comparison of the dates cannot
// pass them.
describe("HR-S2 — date_sanity: a zero-duration element with start = end is valid", () => {
  const PROJECT = { id: "p", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") };
  const activityA = () => ({
    id: "a", name: "A", activityCode: "A", duration: 5, earlyStart: 0, earlyFinish: 5, totalFloat: 0, isCritical: true,
    predecessors: "", startDate: new Date("2026-01-05"), endDate: new Date("2026-01-12"),
  });
  const milestoneM = (overrides = {}) => ({
    id: "m", name: "M", activityCode: "M", duration: 0, earlyStart: 5, earlyFinish: 5, totalFloat: 0, isCritical: true,
    predecessors: "A", startDate: new Date("2026-01-12"), endDate: new Date("2026-01-12"),
    ...overrides,
  });
  const readinessOf = ({ revision, m = milestoneM(), allocationSummary = {} }) =>
    scheduleService.buildScheduleReadiness({ project: PROJECT, revision, activities: [activityA(), m], allocationSummary });
  const dateSanity = (readiness) => readiness.checks.find((entry) => entry.key === "date_sanity");
  const STAGED = { id: "r", isActive: false, status: "under_review" };
  const ACTIVE = { id: "r", isActive: true, status: "approved" };
  const COVERED = {
    items: [{ amount: 100, mappingRule: "required" }],
    totalBoqAmount: 100, approvedAllocatedAmount: 100, pendingAllocatedAmount: 0, unallocatedAmount: 0,
  };

  it("the fixture's milestone has one instant in two Date objects", () => {
    const m = milestoneM();
    expect(m.startDate).not.toBe(m.endDate);
    expect(m.startDate.getTime()).toBe(m.endDate.getTime());
  });

  it("R1: on a staged revision the milestone passes date_sanity, and the approval is ready", () => {
    const readiness = readinessOf({ revision: STAGED });
    expect(dateSanity(readiness)).toMatchObject({ passed: true, fix: null, details: { invalidRows: [] } });
    expect(readiness.ready).toBe(true);
    expect(readiness.blockingCount).toBe(0);
  });

  it("R2: on the active revision, with the BOQ covered, the baseline is ready", () => {
    const readiness = readinessOf({ revision: ACTIVE, allocationSummary: COVERED });
    expect(dateSanity(readiness)).toMatchObject({ passed: true, details: { invalidRows: [] } });
    expect([readiness.ready, readiness.baselineReady, readiness.baselineBlockingCount]).toEqual([true, true, 0]);
  });

  it("R3: start = end with duration 3 fails date_sanity, and the approval is not ready", () => {
    const readiness = readinessOf({ revision: STAGED, m: milestoneM({ duration: 3 }) });
    expect(dateSanity(readiness).passed).toBe(false);
    expect(dateSanity(readiness).details.invalidRows).toEqual([{ activityId: "m", issue: "finish_date_before_start_date" }]);
    expect(readiness.ready).toBe(false);
  });

  it("R4: a zero-duration element finishing before its start fails date_sanity as R3 does", () => {
    const readiness = readinessOf({ revision: STAGED, m: milestoneM({ endDate: new Date("2026-01-09") }) });
    expect(dateSanity(readiness).passed).toBe(false);
    expect(dateSanity(readiness).details.invalidRows).toEqual([{ activityId: "m", issue: "finish_date_before_start_date" }]);
    expect(readiness.ready).toBe(false);
  });

  it("dates given as ISO strings (a staged snapshot's stored form) are judged the same way", () => {
    const iso = "2026-01-12T00:00:00.000Z";
    expect(dateSanity(readinessOf({ revision: STAGED, m: milestoneM({ startDate: iso, endDate: iso }) })).passed).toBe(true);
    expect(dateSanity(readinessOf({ revision: STAGED, m: milestoneM({ startDate: iso, endDate: iso, duration: 3 }) })).passed).toBe(false);
  });
});
