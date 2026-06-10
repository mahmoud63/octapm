const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  rfi: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  submittal: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  costRecord: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockAuditService = {
  ENTITY_TYPES: {
    RFI: 'rfi',
    SUBMITTAL: 'submittal',
    COST_RECORD: 'cost_record',
  },
  ACTIONS: {
    CREATED: 'created',
    UPDATED: 'updated',
    STATUS_CHANGED: 'status_changed',
    DELETED: 'deleted',
  },
  recordEvent: jest.fn(),
};

const mockWorkflow = {
  RECORD_TYPES: {
    RFI: 'rfi',
    SUBMITTAL: 'submittal',
  },
  assignmentData: jest.fn(() => ({})),
  attachWorkflowDetailsToRecords: jest.fn(({ records }) =>
    Promise.resolve(records),
  ),
  primaryActivityIdFromPayload: jest.fn((payload, fallback = null) =>
    payload.activityId === undefined ? fallback : payload.activityId,
  ),
  recordDocumentRevisions: jest.fn(),
  recordWorkflowHistory: jest.fn(),
  syncWorkflowReferences: jest.fn(),
};

const mockGetApprovedActivityAllocationTotals = jest.fn();

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => mockAuditService);
jest.mock('../workflow-support.service', () => mockWorkflow);
jest.mock('../activity-boq-allocation.service', () => ({
  getApprovedActivityAllocationTotals: mockGetApprovedActivityAllocationTotals,
}));

const rfiService = require('../rfi.service');
const submittalService = require('../submittal.service');
const costService = require('../cost.service');

describe('contractual record audit history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockAuditService.recordEvent.mockResolvedValue({ id: 'audit-1' });
    mockGetApprovedActivityAllocationTotals.mockResolvedValue(new Map());
  });

  it('emits a central audit event when an RFI answer changes status', async () => {
    const existing = {
      id: 'rfi-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      ref: 'RFI-001',
      subject: 'Confirm footing detail',
      question: 'Which detail applies?',
      response: null,
      discipline: 'civil',
      priority: 'normal',
      status: 'open',
      scheduleImpact: 0,
      owner: 'Site',
      reviewer: null,
      approver: null,
      raisedBy: 'Site Engineer',
      answeredBy: null,
      raisedDate: new Date('2026-06-01T00:00:00.000Z'),
      dueDate: new Date('2026-06-08T00:00:00.000Z'),
      responseRequiredBy: null,
      answeredDate: null,
    };
    const updated = {
      ...existing,
      response: 'Use S-401 detail 3',
      status: 'answered',
      answeredBy: 'Consultant',
    };
    mockPrisma.rfi.findFirst.mockResolvedValue(existing);
    mockPrisma.rfi.update.mockResolvedValue(updated);

    await rfiService.updateRfi({
      orgId: 'org-1',
      projectId: 'project-1',
      rfiId: 'rfi-1',
      payload: {
        status: 'answered',
        response: 'Use S-401 detail 3',
        answeredBy: 'Consultant',
        comment: 'Consultant response received',
      },
      userId: 'planner-1',
      userRole: 'planning_eng',
    });

    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'rfi',
        entityId: 'rfi-1',
        action: 'status_changed',
        actorId: 'planner-1',
        actorRole: 'planning_eng',
        oldStatus: 'open',
        newStatus: 'answered',
        reason: 'Consultant response received',
        oldSummary: expect.objectContaining({
          ref: 'RFI-001',
          status: 'open',
          response: null,
        }),
        newSummary: expect.objectContaining({
          ref: 'RFI-001',
          status: 'answered',
          response: 'Use S-401 detail 3',
        }),
      }),
    );
  });

  it('emits a central audit event with actor context when a submittal is created', async () => {
    const created = {
      id: 'sub-1',
      projectId: 'project-1',
      activityId: 'activity-2',
      ref: 'SUB-001',
      title: 'Concrete mix design',
      discipline: 'civil',
      revision: 'A',
      specRef: '03 30 00',
      status: 'under_review',
      owner: 'QS',
      reviewer: null,
      approver: null,
      submittedOn: new Date('2026-06-04T00:00:00.000Z'),
      dueDate: null,
      reviewedOn: null,
      remarks: 'Initial issue',
    };
    mockPrisma.submittal.count.mockResolvedValue(0);
    mockPrisma.submittal.create.mockResolvedValue(created);

    await submittalService.createSubmittal({
      orgId: 'org-1',
      projectId: 'project-1',
      payload: {
        activityId: 'activity-2',
        title: 'Concrete mix design',
        discipline: 'civil',
        specRef: '03 30 00',
        status: 'under_review',
        owner: 'QS',
        remarks: 'Initial issue',
      },
      userId: 'qs-1',
      userRole: 'qs',
    });

    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'submittal',
        entityId: 'sub-1',
        action: 'created',
        actorId: 'qs-1',
        actorRole: 'qs',
        oldStatus: null,
        newStatus: 'under_review',
        newSummary: expect.objectContaining({
          ref: 'SUB-001',
          title: 'Concrete mix design',
          status: 'under_review',
          specRef: '03 30 00',
        }),
      }),
    );
  });

  it('emits a central audit event when a cost record is updated', async () => {
    const existing = {
      id: 'cost-1',
      projectId: 'project-1',
      activityId: 'activity-1',
      labour: 100,
      material: 200,
      equipment: 0,
      subcontract: 0,
      indirect: 0,
      overhead: 0,
      contingency: 0,
      budget: 1000,
      committed: 450,
      actual: 250,
      actualThroughDate: new Date('2026-06-01T00:00:00.000Z'),
      forecast: 1000,
    };
    const updated = {
      ...existing,
      actual: 325,
      committed: 500,
      actualThroughDate: new Date('2026-06-05T00:00:00.000Z'),
      forecast: 1082.5,
    };
    mockPrisma.costRecord.findFirst.mockResolvedValue(existing);
    mockPrisma.costRecord.update.mockResolvedValue(updated);

    await costService.updateCostRecord({
      orgId: 'org-1',
      projectId: 'project-1',
      costRecordId: 'cost-1',
      payload: {
        actual: 325,
        committed: 500,
        actualThroughDate: '2026-06-05T00:00:00.000Z',
      },
      userId: 'cost-1',
      userRole: 'cost_controller',
    });

    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'cost_record',
        entityId: 'cost-1',
        action: 'updated',
        actorId: 'cost-1',
        actorRole: 'cost_controller',
        oldSummary: expect.objectContaining({
          activityId: 'activity-1',
          actual: 250,
          committed: 450,
        }),
        newSummary: expect.objectContaining({
          activityId: 'activity-1',
          actual: 325,
          committed: 500,
        }),
      }),
    );
  });
});
