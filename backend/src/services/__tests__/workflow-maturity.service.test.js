const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findMany: jest.fn() },
  rfi: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  workflowActivityLink: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  workflowAttachment: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  workflowStatusHistory: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  documentRevision: {
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
};
const mockAuditService = {
  ENTITY_TYPES: { RFI: 'rfi' },
  ACTIONS: {
    UPDATED: 'updated',
    STATUS_CHANGED: 'status_changed',
    DELETED: 'deleted',
    CREATED: 'created',
  },
  recordEvent: jest.fn(),
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => mockAuditService);

const rfiService = require('../rfi.service');

describe('workflow maturity support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.activity.findMany.mockResolvedValue([
      { id: 'activity-1' },
      { id: 'activity-2' },
    ]);
    mockPrisma.workflowAttachment.findMany.mockResolvedValue([
      {
        id: 'att-1',
        recordId: 'rfi-1',
        fileName: 'response.pdf',
        fileUrl: '/api/v1/projects/project-1/workflow/uploads/file.pdf',
      },
    ]);
    mockPrisma.workflowActivityLink.findMany.mockResolvedValue([
      {
        id: 'link-1',
        recordId: 'rfi-1',
        activityId: 'activity-1',
        relationType: 'primary',
        activity: { id: 'activity-1', name: 'Excavate', isCritical: true },
      },
      {
        id: 'link-2',
        recordId: 'rfi-1',
        activityId: 'activity-2',
        relationType: 'affected',
        activity: { id: 'activity-2', name: 'Formwork', isCritical: false },
      },
    ]);
    mockPrisma.workflowStatusHistory.findMany.mockResolvedValue([
      {
        id: 'hist-1',
        recordId: 'rfi-1',
        oldStatus: 'open',
        newStatus: 'answered',
        comment: 'Consultant response received',
      },
    ]);
    mockPrisma.documentRevision.findMany.mockResolvedValue([
      {
        id: 'rev-1',
        recordId: 'rfi-1',
        revision: 'B',
        status: 'answered',
      },
    ]);
    mockAuditService.recordEvent.mockResolvedValue({ id: 'audit-1' });
  });

  it('records status transitions, attachments, revisions, and multi-activity links', async () => {
    const existing = {
      id: 'rfi-1',
      projectId: 'project-1',
      activityId: 'activity-0',
      ref: 'RFI-001',
      subject: 'Confirm footing detail',
      question: 'Which detail applies?',
      response: null,
      discipline: 'civil',
      priority: 'normal',
      status: 'open',
      scheduleImpact: 0,
      owner: null,
      reviewer: null,
      approver: null,
      raisedBy: 'Site',
      answeredBy: null,
      raisedDate: new Date('2026-06-01T00:00:00Z'),
      dueDate: new Date('2026-06-08T00:00:00Z'),
      responseRequiredBy: null,
      answeredDate: null,
    };
    mockPrisma.rfi.findFirst.mockResolvedValue(existing);
    mockPrisma.rfi.update.mockImplementation(({ data }) =>
      Promise.resolve({
        ...existing,
        ...data,
        id: 'rfi-1',
        status: 'answered',
      }),
    );

    const result = await rfiService.updateRfi({
      orgId: 'org-1',
      projectId: 'project-1',
      rfiId: 'rfi-1',
      userId: 'user-1',
      userRole: 'planning_eng',
      payload: {
        status: 'answered',
        response: 'Use S-401 detail 3',
        owner: 'Planning Engineer',
        activityLinks: [
          { activityId: 'activity-1', relationType: 'primary' },
          { activityId: 'activity-2', relationType: 'affected' },
        ],
        attachmentRefs: [
          {
            fileName: 'response.pdf',
            fileUrl: '/api/v1/projects/project-1/workflow/uploads/file.pdf',
            mimeType: 'application/pdf',
          },
        ],
        revision: 'B',
        comment: 'Consultant response received',
      },
    });

    expect(mockPrisma.rfi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rfi-1' },
        data: expect.objectContaining({
          activityId: 'activity-1',
          status: 'answered',
          owner: 'Planning Engineer',
        }),
      }),
    );
    expect(mockPrisma.workflowActivityLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            recordType: 'rfi',
            recordId: 'rfi-1',
            activityId: 'activity-1',
            relationType: 'primary',
          }),
          expect.objectContaining({
            activityId: 'activity-2',
            relationType: 'affected',
          }),
        ]),
      }),
    );
    expect(mockPrisma.workflowAttachment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            recordType: 'rfi',
            recordId: 'rfi-1',
            fileName: 'response.pdf',
            uploadedBy: 'user-1',
          }),
        ],
      }),
    );
    expect(mockPrisma.workflowStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          oldStatus: 'open',
          newStatus: 'answered',
          comment: 'Consultant response received',
          createdBy: 'user-1',
          actorRole: 'planning_eng',
        }),
      }),
    );
    expect(mockPrisma.documentRevision.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            recordType: 'rfi',
            recordId: 'rfi-1',
            revision: 'B',
            status: 'answered',
          }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(result.activityLinks).toHaveLength(2);
    expect(result.attachments).toHaveLength(1);
    expect(result.history[0].newStatus).toBe('answered');
    expect(result.revisions[0].revision).toBe('B');
  });
});
