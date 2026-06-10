const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  reportingPeriod: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  activity: { findFirst: jest.fn(), findMany: jest.fn() },
  activityCostLoading: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  costRecord: { findMany: jest.fn() },
  budgetRevision: { findMany: jest.fn() },
  evPeriodSnapshot: { upsert: jest.fn() },
};

const mockBuildAllocationSummary = jest.fn();
const mockGetApprovedActivityAllocationTotals = jest.fn();

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../activity-boq-allocation.service', () => ({
  buildAllocationSummary: mockBuildAllocationSummary,
  getApprovedActivityAllocationTotals: mockGetApprovedActivityAllocationTotals,
}));

const evService = require('../earned-value.service');

const project = {
  id: 'project-1',
  orgId: 'org-1',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  reportingCutoffDay: 25,
  projectCalendar: 'five_day',
};

const period = {
  id: 'period-1',
  projectId: 'project-1',
  code: '2026-01',
  label: 'Jan 2026',
  periodStart: new Date('2026-01-01T00:00:00.000Z'),
  periodEnd: new Date('2026-01-31T00:00:00.000Z'),
  cutoffDate: new Date('2026-01-31T00:00:00.000Z'),
  status: 'open',
  lockedBy: null,
  lockedAt: null,
  evSnapshot: null,
};

const activity = {
  id: 'activity-1',
  projectId: 'project-1',
  name: 'Excavation',
  p6ActivityId: 'A-100',
  wbsCode: null,
  earlyFinish: 10,
  isCritical: true,
  sortOrder: 1,
  progress: [
    {
      pctComplete: 50,
      actualCost: null,
      progressMethod: 'percent_complete',
      status: 'approved',
      approvedAt: new Date('2026-01-20T00:00:00.000Z'),
      updatedAt: new Date('2026-01-20T00:00:00.000Z'),
    },
  ],
};

function mockReportInputs({
  allocationAmount = 1000,
  plannedValue = 500,
  actualCost = 400,
  actualRows = null,
  pctComplete = 50,
  progressRows = null,
  budgetRevisions = [],
} = {}) {
  mockPrisma.project.findFirst.mockResolvedValue(project);
  mockPrisma.reportingPeriod.findFirst.mockResolvedValue(period);
  mockPrisma.activity.findMany.mockResolvedValue([
    {
      ...activity,
      progress:
        progressRows ??
        [
          {
            ...activity.progress[0],
            pctComplete,
          },
        ],
    },
  ]);
  mockGetApprovedActivityAllocationTotals.mockResolvedValue(
    new Map([
      [
        'activity-1',
        {
          quantity: 1,
          amount: allocationAmount,
          weight: 100,
          count: 1,
        },
      ],
    ]),
  );
  mockBuildAllocationSummary.mockResolvedValue({
    approvedAllocatedAmount: allocationAmount,
    unallocatedAmount: 0,
  });
  mockPrisma.activityCostLoading.findMany.mockResolvedValue(
    plannedValue === null
      ? []
      : [
          {
            id: 'loading-1',
            activityId: 'activity-1',
            plannedValue,
            plannedDate: new Date('2026-01-15T00:00:00.000Z'),
            status: 'approved',
          },
        ],
  );
  mockPrisma.costRecord.findMany.mockResolvedValue(
    actualRows ||
      (actualCost === null
      ? []
      : [
          {
            id: 'cost-1',
            activityId: 'activity-1',
            actual: actualCost,
            actualThroughDate: new Date('2026-01-20T00:00:00.000Z'),
            updatedAt: new Date('2026-01-20T00:00:00.000Z'),
          },
        ]),
  );
  mockPrisma.budgetRevision.findMany.mockResolvedValue(budgetRevisions);
}

describe('earned value service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('computes official SPI, CPI, and EAC from approved PV, EV, and AC', async () => {
    mockReportInputs();

    const report = await evService.buildOfficialEvReport({
      orgId: 'org-1',
      projectId: 'project-1',
      periodId: 'period-1',
    });

    expect(report.pv).toBe(500);
    expect(report.ev).toBe(500);
    expect(report.ac).toBe(400);
    expect(report.spi).toBe(1);
    expect(report.cpi).toBe(1.25);
    expect(report.eac).toBe(800);
    expect(report.sourceSummary.ac.estimatesExcludedFromOfficialAc).toBe(true);
    expect(mockPrisma.costRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          actualThroughDate: { not: null, lte: expect.any(Date) },
        }),
      }),
    );
  });

  it('keeps zero-cost reports null-indexed instead of forcing green scores', async () => {
    mockReportInputs({
      allocationAmount: 0,
      plannedValue: null,
      actualCost: null,
      pctComplete: 0,
    });

    const report = await evService.buildOfficialEvReport({
      orgId: 'org-1',
      projectId: 'project-1',
      periodId: 'period-1',
    });

    expect(report.totalBudget).toBe(0);
    expect(report.pv).toBe(0);
    expect(report.ev).toBe(0);
    expect(report.ac).toBe(0);
    expect(report.spi).toBeNull();
    expect(report.cpi).toBeNull();
    expect(report.eac).toBe(0);
  });

  it('raises EAC when official AC overruns earned value', async () => {
    mockReportInputs({ actualCost: 800 });

    const report = await evService.buildOfficialEvReport({
      orgId: 'org-1',
      projectId: 'project-1',
      periodId: 'period-1',
    });

    expect(report.cpi).toBe(0.625);
    expect(report.eac).toBe(1600);
    expect(report.alerts.cpiAlert).toBe(true);
  });

  it('applies approved budget revisions to revised BAC and EAC', async () => {
    mockReportInputs({
      budgetRevisions: [
        {
          id: 'br-1',
          ref: 'BR-01',
          title: 'Owner change',
          changeType: 'addition',
          amount: 200,
          effectiveDate: new Date('2026-01-10T00:00:00.000Z'),
          status: 'approved',
        },
      ],
    });

    const report = await evService.buildOfficialEvReport({
      orgId: 'org-1',
      projectId: 'project-1',
      periodId: 'period-1',
    });

    expect(report.totalBudget).toBe(1200);
    expect(report.approvedBudgetRevisionDelta).toBe(200);
    expect(report.eac).toBe(960);
    expect(report.sourceSummary.budget.appliedBudgetRevisions).toHaveLength(1);
  });

  it('excludes submitted or missing progress from official EV until approval', async () => {
    mockReportInputs({ progressRows: [] });

    const report = await evService.buildOfficialEvReport({
      orgId: 'org-1',
      projectId: 'project-1',
      periodId: 'period-1',
    });

    expect(report.ev).toBe(0);
    expect(report.sourceSummary.ev.approvedProgressActivities).toBe(0);
    expect(report.sourceSummary.ev.missingProgressActivities).toBe(1);
  });

  it('uses progress approved by the cutoff and ignores later approvals', async () => {
    mockReportInputs({
      progressRows: [
        {
          pctComplete: 90,
          actualCost: null,
          progressMethod: 'percent_complete',
          status: 'approved',
          approvedAt: new Date('2026-02-05T00:00:00.000Z'),
          updatedAt: new Date('2026-02-05T00:00:00.000Z'),
        },
        {
          pctComplete: 40,
          actualCost: null,
          progressMethod: 'percent_complete',
          status: 'approved',
          approvedAt: new Date('2026-01-25T00:00:00.000Z'),
          updatedAt: new Date('2026-01-25T00:00:00.000Z'),
        },
      ],
    });

    const report = await evService.buildOfficialEvReport({
      orgId: 'org-1',
      projectId: 'project-1',
      periodId: 'period-1',
    });

    expect(report.ev).toBe(400);
    expect(report.activityBreakdown[0].pct).toBe(40);
    expect(mockPrisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          progress: expect.objectContaining({
            where: expect.objectContaining({
              OR: expect.arrayContaining([
                { approvedAt: { lte: expect.any(Date) } },
              ]),
            }),
          }),
        }),
      }),
    );
  });

  it('uses only cost-record actuals through the cutoff for official AC', async () => {
    mockReportInputs({
      actualRows: [
        {
          id: 'cost-future',
          activityId: 'activity-1',
          actual: 900,
          actualThroughDate: new Date('2026-02-05T00:00:00.000Z'),
          updatedAt: new Date('2026-01-28T00:00:00.000Z'),
        },
        {
          id: 'cost-current',
          activityId: 'activity-1',
          actual: 400,
          actualThroughDate: new Date('2026-01-31T00:00:00.000Z'),
          updatedAt: new Date('2026-02-10T00:00:00.000Z'),
        },
      ],
    });

    const report = await evService.buildOfficialEvReport({
      orgId: 'org-1',
      projectId: 'project-1',
      periodId: 'period-1',
    });

    expect(report.ac).toBe(400);
    expect(report.cpi).toBe(1.25);
    expect(report.activityBreakdown[0].actualCostSource).toBe(
      'cost_record.actual_through_date',
    );
    expect(report.activityBreakdown[0].officialActualThroughDate).toBe(
      '2026-01-31T00:00:00.000Z',
    );
  });

  it('does not use progress actual-cost estimates as official AC', async () => {
    mockReportInputs({
      actualCost: null,
      progressRows: [
        {
          pctComplete: 50,
          actualCost: 800,
          progressMethod: 'percent_complete',
          status: 'approved',
          approvedAt: new Date('2026-01-20T00:00:00.000Z'),
          updatedAt: new Date('2026-01-20T00:00:00.000Z'),
        },
      ],
    });

    const report = await evService.buildOfficialEvReport({
      orgId: 'org-1',
      projectId: 'project-1',
      periodId: 'period-1',
    });

    expect(report.ac).toBe(0);
    expect(report.cpi).toBeNull();
    expect(report.activityBreakdown[0].estimatedActualCost).toBe(800);
    expect(report.activityBreakdown[0].actualCostSource).toBe(
      'missing_official_actual',
    );
  });

  it('locks a reporting period by persisting a period snapshot', async () => {
    mockReportInputs();
    mockPrisma.evPeriodSnapshot.upsert.mockImplementation(({ create }) =>
      Promise.resolve({ id: 'snapshot-1', ...create }),
    );
    mockPrisma.reportingPeriod.update.mockResolvedValue({
      ...period,
      status: 'locked',
      lockedBy: 'user-1',
      lockedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const report = await evService.lockReportingPeriod({
      orgId: 'org-1',
      projectId: 'project-1',
      periodId: 'period-1',
      userId: 'user-1',
    });

    expect(mockPrisma.evPeriodSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reportingPeriodId: 'period-1' },
        create: expect.objectContaining({
          pv: 500,
          ev: 500,
          ac: 400,
          totalBudget: 1000,
          lockedBy: 'user-1',
        }),
      }),
    );
    expect(mockPrisma.reportingPeriod.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'period-1' },
        data: expect.objectContaining({
          status: 'locked',
          lockedBy: 'user-1',
        }),
      }),
    );
    expect(report.reporting.isSnapshot).toBe(true);
    expect(report.reporting.snapshotId).toBe('snapshot-1');
  });
});
