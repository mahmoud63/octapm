const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  subValuation: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  activity: { findMany: jest.fn() },
  activityBoqAllocation: { findMany: jest.fn() },
  boqItem: { findMany: jest.fn() },
  subValuationActivityLink: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  subValuationAllocationLink: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};

const mockAuditService = {
  ACTIONS: {
    CREATED: 'created',
    DELETED: 'deleted',
    STATUS_CHANGED: 'status_changed',
    UPDATED: 'updated',
  },
  ENTITY_TYPES: { SUB_VALUATION: 'sub_valuation' },
  recordEvent: jest.fn(),
  serializeEvent: jest.fn((event) => event),
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => mockAuditService);

const subValuationService = require('../sub-valuation.service');

describe('sub valuation traceability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'project-1',
      orgId: 'org-1',
      defaultRetentionRate: 5,
    });
  });

  it('links sub valuations to activities and approved BOQ allocations', async () => {
    mockPrisma.subValuation.count.mockResolvedValue(0);
    mockPrisma.subValuation.create.mockResolvedValue({
      id: 'sv-1',
      projectId: 'project-1',
      ref: 'SV-01',
      subcontractor: 'Concrete Sub',
      period: '2026-06',
      workDone: 1000,
      materialsOnSite: 200,
      grossPayable: 1200,
      retentionRate: 5,
      retention: 60,
      backCharges: 0,
      netPayable: 1140,
      status: 'draft',
      activityLinks: [],
      allocationLinks: [],
    });
    mockPrisma.activity.findMany.mockResolvedValue([{ id: 'activity-1' }]);
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      { id: 'alloc-1', boqItemId: 'boq-1' },
    ]);
    mockPrisma.boqItem.findMany.mockResolvedValue([]);

    await subValuationService.createSubValuation({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'qs-1',
      payload: {
        subcontractor: 'Concrete Sub',
        period: '2026-06',
        workDone: 1000,
        materialsOnSite: 200,
        activityLinks: [{ activityId: 'activity-1', amount: 1200 }],
        allocationLinks: [
          {
            allocationId: 'alloc-1',
            quantity: 4,
            workDoneAmount: 1000,
            materialsOnSiteAmount: 200,
          },
        ],
      },
    });

    expect(mockPrisma.subValuationActivityLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            subValuationId: 'sv-1',
            activityId: 'activity-1',
            amount: 1200,
          }),
        ],
      }),
    );
    expect(mockPrisma.subValuationAllocationLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            subValuationId: 'sv-1',
            allocationId: 'alloc-1',
            boqItemId: 'boq-1',
            workDoneAmount: 1000,
            materialsOnSiteAmount: 200,
          }),
        ],
      }),
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'sub_valuation',
        entityId: 'sv-1',
        action: 'created',
      }),
    );
  });
});
