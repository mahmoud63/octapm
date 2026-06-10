const mockPrisma = {
  project: {
    findFirst: jest.fn(),
  },
  rfi: {
    findMany: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
  },
  submittal: {
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
  costRecord: {
    findMany: jest.fn(),
  },
};

const mockAttachWorkflowDetailsToRecords = jest.fn(({ records }) =>
  Promise.resolve(records),
);
const mockGetApprovedActivityAllocationTotals = jest.fn();

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

jest.mock('../workflow-support.service', () => ({
  RECORD_TYPES: {
    RFI: 'rfi',
    SUBMITTAL: 'submittal',
  },
  assignmentData: jest.fn(),
  attachWorkflowDetailsToRecords: mockAttachWorkflowDetailsToRecords,
  primaryActivityIdFromPayload: jest.fn(),
  recordDocumentRevisions: jest.fn(),
  recordWorkflowHistory: jest.fn(),
  syncWorkflowReferences: jest.fn(),
}));

jest.mock('../activity-boq-allocation.service', () => ({
  getApprovedActivityAllocationTotals: mockGetApprovedActivityAllocationTotals,
}));

const rfiService = require('../rfi.service');
const submittalService = require('../submittal.service');
const costService = require('../cost.service');

describe('large list API pagination, filtering, search, and sorting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.rfi.groupBy.mockResolvedValue([]);
    mockPrisma.rfi.aggregate.mockResolvedValue({ _sum: { scheduleImpact: 0 } });
    mockPrisma.submittal.groupBy.mockResolvedValue([]);
    mockGetApprovedActivityAllocationTotals.mockResolvedValue(new Map());
  });

  it('lists RFIs with bounded cursor pagination and searchable filters', async () => {
    mockPrisma.rfi.findMany.mockResolvedValue([
      { id: 'rfi-1', status: 'open', scheduleImpact: 2 },
      { id: 'rfi-2', status: 'open', scheduleImpact: 3 },
      { id: 'rfi-3', status: 'open', scheduleImpact: 4 },
    ]);
    mockPrisma.rfi.groupBy.mockResolvedValue([
      { status: 'open', _count: { _all: 8 } },
    ]);
    mockPrisma.rfi.aggregate.mockResolvedValue({
      _sum: { scheduleImpact: 12 },
    });

    const result = await rfiService.listRfis({
      orgId: 'org-1',
      projectId: 'project-1',
      query: {
        cursor: '00000000-0000-4000-8000-000000000001',
        limit: 2,
        status: 'open',
        priority: 'urgent',
        search: 'pump',
        sortBy: 'dueDate',
        sortDir: 'asc',
      },
    });

    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'project-1', orgId: 'org-1' },
    });
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'project-1',
          status: 'open',
          priority: 'urgent',
          OR: expect.arrayContaining([
            { ref: { contains: 'pump', mode: 'insensitive' } },
            { subject: { contains: 'pump', mode: 'insensitive' } },
            { question: { contains: 'pump', mode: 'insensitive' } },
          ]),
        }),
        take: 3,
        cursor: { id: '00000000-0000-4000-8000-000000000001' },
        skip: 1,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(mockAttachWorkflowDetailsToRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        recordType: 'rfi',
        records: [
          { id: 'rfi-1', status: 'open', scheduleImpact: 2 },
          { id: 'rfi-2', status: 'open', scheduleImpact: 3 },
        ],
      }),
    );
    expect(result.rows).toHaveLength(2);
    expect(result.pagination).toEqual({ limit: 2, nextCursor: 'rfi-3' });
    expect(result.summary).toEqual({
      open: 8,
      answered: 0,
      closed: 0,
      scheduleImpactDays: 12,
    });
  });

  it('lists submittals with status filtering, search, sorting, and cursor metadata', async () => {
    mockPrisma.submittal.findMany.mockResolvedValue([
      { id: 'sub-1', status: 'under_review' },
      { id: 'sub-2', status: 'under_review' },
    ]);
    mockPrisma.submittal.groupBy.mockResolvedValue([
      { status: 'under_review', _count: { _all: 5 } },
      { status: 'approved', _count: { _all: 2 } },
    ]);

    const result = await submittalService.listSubmittals({
      orgId: 'org-1',
      projectId: 'project-1',
      query: {
        limit: 1,
        status: 'under_review',
        search: 'concrete',
        sortBy: 'submittedOn',
        sortDir: 'desc',
      },
    });

    expect(mockPrisma.submittal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'project-1',
          status: 'under_review',
          OR: expect.arrayContaining([
            { ref: { contains: 'concrete', mode: 'insensitive' } },
            { title: { contains: 'concrete', mode: 'insensitive' } },
            { specRef: { contains: 'concrete', mode: 'insensitive' } },
          ]),
        }),
        take: 2,
        orderBy: [{ submittedOn: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(result.rows).toEqual([{ id: 'sub-1', status: 'under_review' }]);
    expect(result.pagination).toEqual({ limit: 1, nextCursor: 'sub-2' });
    expect(result.summary).toEqual({
      pending: 0,
      underReview: 5,
      approved: 2,
      resubmit: 0,
      rejected: 0,
    });
  });

  it('lists cost records with activity search, phase filtering, sorting, and page-local allocation budgets', async () => {
    mockPrisma.costRecord.findMany.mockResolvedValue([
      {
        id: 'cost-1',
        activityId: 'activity-1',
        budget: 100,
        actual: 90,
        activity: { id: 'activity-1', category: 'Structure' },
      },
      {
        id: 'cost-2',
        activityId: 'activity-2',
        budget: 200,
        actual: 80,
        activity: { id: 'activity-2', category: 'Structure' },
      },
      {
        id: 'cost-3',
        activityId: 'activity-3',
        budget: 300,
        actual: 70,
        activity: { id: 'activity-3', category: 'Structure' },
      },
    ]);
    mockGetApprovedActivityAllocationTotals.mockResolvedValue(
      new Map([
        ['activity-1', { amount: 1000 }],
        ['activity-2', { amount: 2000 }],
      ]),
    );

    const result = await costService.getCostRecords({
      orgId: 'org-1',
      projectId: 'project-1',
      query: {
        cursor: '00000000-0000-4000-8000-000000000002',
        limit: 2,
        category: 'Structure',
        search: 'steel',
        sortBy: 'actual',
        sortDir: 'desc',
      },
    });

    expect(mockPrisma.costRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 'project-1',
          activity: {
            isActive: true,
            category: { equals: 'Structure', mode: 'insensitive' },
            OR: expect.arrayContaining([
              { name: { contains: 'steel', mode: 'insensitive' } },
              { wbsCode: { contains: 'steel', mode: 'insensitive' } },
              { category: { contains: 'steel', mode: 'insensitive' } },
            ]),
          },
        },
        take: 3,
        cursor: { id: '00000000-0000-4000-8000-000000000002' },
        skip: 1,
        orderBy: [{ actual: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(mockGetApprovedActivityAllocationTotals).toHaveBeenCalledWith({
      projectId: 'project-1',
      activityIds: ['activity-1', 'activity-2'],
    });
    expect(result.rows).toEqual([
      expect.objectContaining({
        id: 'cost-1',
        generatedBudget: 100,
        budget: 1000,
      }),
      expect.objectContaining({
        id: 'cost-2',
        generatedBudget: 200,
        budget: 2000,
      }),
    ]);
    expect(result.pagination).toEqual({ limit: 2, nextCursor: 'cost-3' });
  });
});
