const mockPrisma = {
  project: { findFirst: jest.fn() },
  auditEvent: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  recordHistorySnapshot: {
    create: jest.fn(),
  },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const auditService = require('../audit.service');

describe('audit service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records compact structured events and redacts sensitive summary keys', async () => {
    const occurredAt = new Date('2026-06-09T10:00:00.000Z');
    mockPrisma.auditEvent.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'audit-1',
        createdAt: occurredAt,
        ...data,
      }),
    );

    const event = await auditService.recordEvent({
      orgId: 'org-1',
      projectId: 'project-1',
      entityType: auditService.ENTITY_TYPES.CHANGE_ORDER,
      entityId: 'co-1',
      action: auditService.ACTIONS.APPROVED,
      actorId: 'pm-1',
      occurredAt,
      oldStatus: 'pending',
      newStatus: 'approved',
      reason: 'Owner approval',
      summary: {
        ref: 'VO-01',
        password: 'do-not-store',
        nested: { accessToken: 'token-value' },
      },
    });

    expect(event.id).toBe('audit-1');
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'change_order',
        entityId: 'co-1',
        action: 'approved',
        actorId: 'pm-1',
        oldStatus: 'pending',
        newStatus: 'approved',
        reason: 'Owner approval',
        summaryJson: expect.objectContaining({
          ref: 'VO-01',
          password: '[redacted]',
          nested: expect.objectContaining({ accessToken: '[redacted]' }),
        }),
      }),
    });
    expect(mockPrisma.recordHistorySnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'change_order',
        entityId: 'co-1',
        action: 'approved',
        actorId: 'pm-1',
        auditEventId: 'audit-1',
        previousSnapshotJson: null,
        snapshotJson: expect.objectContaining({
          ref: 'VO-01',
          password: '[redacted]',
        }),
      }),
    });
  });

  it('stores old and new record snapshots with a compact change set', async () => {
    const occurredAt = new Date('2026-06-09T12:00:00.000Z');
    mockPrisma.auditEvent.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'audit-2',
        createdAt: occurredAt,
        ...data,
      }),
    );

    await auditService.recordEvent({
      orgId: 'org-1',
      projectId: 'project-1',
      entityType: 'cost_record',
      entityId: 'cost-1',
      action: auditService.ACTIONS.UPDATED,
      actorId: 'cost-controller-1',
      actorRole: 'cost_controller',
      occurredAt,
      oldSummary: {
        activityId: 'activity-1',
        actual: 100,
        secretToken: 'do-not-store',
      },
      newSummary: {
        activityId: 'activity-1',
        actual: 125,
        secretToken: 'new-secret',
      },
      metadata: { source: 'cost_control' },
    });

    expect(mockPrisma.recordHistorySnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'cost_record',
        entityId: 'cost-1',
        action: 'updated',
        actorId: 'cost-controller-1',
        actorRole: 'cost_controller',
        auditEventId: 'audit-2',
        previousSnapshotJson: expect.objectContaining({
          activityId: 'activity-1',
          actual: 100,
          secretToken: '[redacted]',
        }),
        snapshotJson: expect.objectContaining({
          activityId: 'activity-1',
          actual: 125,
          secretToken: '[redacted]',
        }),
        changeSetJson: expect.objectContaining({
          actual: { before: 100, after: 125 },
        }),
        metadataJson: expect.objectContaining({ source: 'cost_control' }),
      }),
    });
  });

  it('lists events by tenant-scoped project and entity filters', async () => {
    const occurredAt = new Date('2026-06-09T11:00:00.000Z');
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'schedule_revision',
        entityId: 'revision-1',
        action: 'baseline_locked',
        actorId: 'pm-1',
        occurredAt,
        createdAt: occurredAt,
        oldStatus: 'approved',
        newStatus: 'baselined',
        summaryJson: {},
        attachmentsJson: [],
        metadataJson: {},
      },
    ]);

    const result = await auditService.listEvents({
      orgId: 'org-1',
      projectId: 'project-1',
      entityType: 'schedule_revision',
      entityId: 'revision-1',
      limit: 20,
      order: 'asc',
    });

    expect(result.events).toHaveLength(1);
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'project-1', orgId: 'org-1' },
      select: { id: true },
    });
    expect(mockPrisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orgId: 'org-1',
          projectId: 'project-1',
          entityType: 'schedule_revision',
          entityId: 'revision-1',
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: 21,
      }),
    );
  });
});
