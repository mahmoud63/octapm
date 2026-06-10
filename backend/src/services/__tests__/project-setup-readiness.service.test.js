const mockPrisma = {
  project: { findFirst: jest.fn() },
  boqItem: { findMany: jest.fn() },
  activity: { findMany: jest.fn() },
  scheduleRevision: { findFirst: jest.fn() },
  costRecord: { count: jest.fn() },
  activityCostLoading: { count: jest.fn() },
  reportingPeriod: { count: jest.fn() },
};

const mockBuildAllocationSummary = jest.fn();
const mockBuildScheduleReadiness = jest.fn();

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../activity-boq-allocation.service', () => ({
  buildAllocationSummary: mockBuildAllocationSummary,
}));
jest.mock('../schedule.service', () => ({
  buildScheduleReadiness: mockBuildScheduleReadiness,
}));

const setupReadinessService = require('../project-setup-readiness.service');

const project = {
  id: 'project-1',
  orgId: 'org-1',
  name: 'Tower',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: new Date('2026-12-31T00:00:00.000Z'),
  duration: 12,
  contractValue: 100,
  clientName: 'Client',
  contractorName: 'Contractor',
};

const emptyAllocationSummary = {
  totalBoqAmount: 0,
  approvedAllocatedAmount: 0,
  pendingAllocatedAmount: 0,
  unallocatedAmount: 0,
};

describe('project setup readiness service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue(project);
    mockPrisma.boqItem.findMany.mockResolvedValue([]);
    mockBuildAllocationSummary.mockResolvedValue(emptyAllocationSummary);
    mockPrisma.activity.findMany.mockResolvedValue([]);
    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockPrisma.costRecord.count.mockResolvedValue(0);
    mockPrisma.activityCostLoading.count.mockResolvedValue(0);
    mockPrisma.reportingPeriod.count.mockResolvedValue(0);
    mockBuildScheduleReadiness.mockReturnValue({
      ready: true,
      blockingCount: 0,
      checks: [],
    });
  });

  it('surfaces critical blockers for an empty project', async () => {
    const result = await setupReadinessService.getSetupReadiness({
      orgId: 'org-1',
      projectId: 'project-1',
    });

    expect(result.rulesetVersion).toBe('fb-015-v1');
    expect(result.summary.readyForProgress).toBe(false);
    expect(result.summary.blockedSteps).toBeGreaterThan(0);
    expect(result.gates.progress.ready).toBe(false);
    expect(result.steps.find((step) => step.key === 'boq_upload')).toEqual(
      expect.objectContaining({
        status: 'blocked',
        blockers: expect.arrayContaining([
          expect.objectContaining({ code: 'NO_BOQ' }),
        ]),
      }),
    );
    expect(
      result.gates.progress.blockers.map((blocker) => blocker.code),
    ).toEqual(
      expect.arrayContaining([
        'NO_BOQ',
        'NO_SCHEDULE',
        'NO_SCHEDULE_REVISION',
        'BASELINE_NOT_LOCKED',
      ]),
    );
    expect(mockBuildScheduleReadiness).not.toHaveBeenCalled();
  });

  it('reports ready-for-progress after BOQ, allocation, baseline, assignments, and EV basis are complete', async () => {
    const baselinedRevision = {
      id: 'revision-1',
      label: 'Baseline',
      status: 'baselined',
      isActive: true,
      activityCount: 1,
      approvedAt: new Date('2026-02-01T00:00:00.000Z'),
      baselinedAt: new Date('2026-02-02T00:00:00.000Z'),
    };
    mockPrisma.boqItem.findMany.mockResolvedValue([
      { id: 'boq-1', qty: 10, amount: 100 },
    ]);
    mockBuildAllocationSummary.mockResolvedValue({
      totalBoqAmount: 100,
      approvedAllocatedAmount: 100,
      pendingAllocatedAmount: 0,
      unallocatedAmount: 0,
    });
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: 'activity-1',
        name: 'Foundations',
        isMilestone: false,
        isCritical: true,
        assignments: [{ id: 'assignment-1' }],
        progressMethod: { id: 'method-1', method: 'quantity' },
        predecessorLinks: [],
      },
    ]);
    mockPrisma.scheduleRevision.findFirst.mockReset();
    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(baselinedRevision)
      .mockResolvedValueOnce(baselinedRevision)
      .mockResolvedValueOnce(baselinedRevision);
    mockPrisma.costRecord.count.mockResolvedValue(1);
    mockPrisma.activityCostLoading.count.mockResolvedValue(1);
    mockPrisma.reportingPeriod.count.mockResolvedValue(1);
    mockBuildScheduleReadiness.mockReturnValue({
      ready: true,
      blockingCount: 0,
      checks: [
        {
          key: 'predecessors',
          label: 'Predecessor logic',
          passed: true,
          severity: 'blocking',
          message: 'Predecessor references are valid.',
        },
      ],
    });

    const result = await setupReadinessService.getSetupReadiness({
      orgId: 'org-1',
      projectId: 'project-1',
    });

    expect(result.summary.readyForProgress).toBe(true);
    expect(result.gates.progress.ready).toBe(true);
    expect(result.gates.baseline.alreadyLocked).toBe(true);
    expect(result.summary.blockingCount).toBe(0);
    expect(result.steps.every((step) => step.status === 'complete')).toBe(true);
  });

  it('opens the baseline gate when the approved schedule has no readiness blockers', async () => {
    const approvedRevision = {
      id: 'revision-2',
      label: 'Rev A',
      status: 'approved',
      isActive: true,
      activityCount: 1,
      approvedAt: new Date('2026-02-01T00:00:00.000Z'),
      baselinedAt: null,
    };
    mockPrisma.boqItem.findMany.mockResolvedValue([
      { id: 'boq-1', qty: 10, amount: 100 },
    ]);
    mockBuildAllocationSummary.mockResolvedValue({
      totalBoqAmount: 100,
      approvedAllocatedAmount: 100,
      pendingAllocatedAmount: 0,
      unallocatedAmount: 0,
    });
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: 'activity-1',
        name: 'Foundations',
        isMilestone: false,
        isCritical: true,
        assignments: [{ id: 'assignment-1' }],
        progressMethod: { id: 'method-1', method: 'quantity' },
        predecessorLinks: [],
      },
    ]);
    mockPrisma.scheduleRevision.findFirst.mockReset();
    mockPrisma.scheduleRevision.findFirst
      .mockResolvedValueOnce(approvedRevision)
      .mockResolvedValueOnce(approvedRevision)
      .mockResolvedValueOnce(null);
    mockPrisma.costRecord.count.mockResolvedValue(1);
    mockPrisma.activityCostLoading.count.mockResolvedValue(1);
    mockPrisma.reportingPeriod.count.mockResolvedValue(1);
    mockBuildScheduleReadiness.mockReturnValue({
      ready: true,
      blockingCount: 0,
      checks: [],
    });

    const result = await setupReadinessService.getSetupReadiness({
      orgId: 'org-1',
      projectId: 'project-1',
    });

    expect(result.summary.readyForBaseline).toBe(true);
    expect(result.gates.baseline.ready).toBe(true);
    expect(result.gates.progress.ready).toBe(false);
    expect(result.gates.progress.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BASELINE_NOT_LOCKED' }),
      ]),
    );
  });
});
