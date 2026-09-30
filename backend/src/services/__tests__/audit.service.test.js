const mockPrisma = {
  project: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  auditEvent: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  approvalWorkflowEvent: {
    findMany: jest.fn(),
  },
  workflowStatusHistory: {
    findMany: jest.fn(),
  },
  workflowAttachment: {
    findMany: jest.fn(),
  },
  commercialAttachmentRef: {
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
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValue([]);
    mockPrisma.workflowStatusHistory.findMany.mockResolvedValue([]);
    mockPrisma.workflowAttachment.findMany.mockResolvedValue([]);
    mockPrisma.commercialAttachmentRef.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);
  });

  it('names the actor on every event, in one batched lookup, and carries no name (the UI shows "Former user") for an account that no longer exists', async () => {
    const at = new Date('2026-06-09T11:00:00.000Z');
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      { id: 'audit-1', orgId: 'org-1', projectId: 'project-1', entityType: 'change_order', entityId: 'co-1', action: 'updated', actorId: 'qs-1', actorRole: null, occurredAt: at, createdAt: at, summaryJson: {}, attachmentsJson: [], metadataJson: {} },
      { id: 'audit-2', orgId: 'org-1', projectId: 'project-1', entityType: 'change_order', entityId: 'co-1', action: 'updated', actorId: 'gone-1', actorRole: 'pm', occurredAt: at, createdAt: at, summaryJson: {}, attachmentsJson: [], metadataJson: {} },
    ]);
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValue([
      { id: 'approval-1', orgId: 'org-1', projectId: 'project-1', recordType: 'change_order', recordId: 'co-1', workflowType: 'change_order', action: 'approved', decision: 'approved', fromStatus: 'pending', toStatus: 'approved', actorId: 'pm-1', actorRole: 'pm', reason: null, comment: null, metadataJson: {}, createdAt: at },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'qs-1', name: 'Quinn Surveyor', role: 'qs' },
      { id: 'pm-1', name: 'Priya Manager', role: 'pm' },
    ]);

    const result = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', entityType: 'change_order', entityId: 'co-1', limit: 10, order: 'asc' });

    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(['qs-1', 'gone-1', 'pm-1']) } },
      select: { id: true, name: true, role: true },
    });
    // approval rows are exposed as "approval:<id>"; audit rows keep their own id
    const byId = Object.fromEntries(result.events.map((event) => [event.rawId || event.id, event]));
    expect(byId['audit-1']).toEqual(expect.objectContaining({ actorId: 'qs-1', actorName: 'Quinn Surveyor', actorRole: 'qs' }));
    expect(byId['approval-1']).toEqual(expect.objectContaining({ actorId: 'pm-1', actorName: 'Priya Manager' }));
    // a deleted account: no name to show, the stored role kept — the UI renders "Former user"
    expect(byId['audit-2']).toEqual(expect.objectContaining({ actorId: 'gone-1', actorName: null, actorRole: 'pm' }));
    expect(result.events.every((event) => 'actorName' in event)).toBe(true);
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

  // PC-7a: the audit is not optional, and the best-effort outbound log may
  // never break the caller's transaction.
  const callerTransaction = ({ outboundCreate, auditCreate, raw } = {}) => {
    const sql = [];
    return {
      sql,
      tx: {
        $executeRawUnsafe: jest.fn(raw || (async (statement) => {
          sql.push(statement.replace(/outbound_event_[0-9a-f]{16}/, 'sp'));
          return 0;
        })),
        auditEvent: { create: auditCreate || jest.fn(async ({ data }) => ({ id: 'audit-tx', createdAt: new Date(), ...data })) },
        recordHistorySnapshot: { create: jest.fn(async ({ data }) => ({ id: 'snapshot-tx', ...data })) },
        outboundEvent: { create: outboundCreate || jest.fn(async ({ data }) => ({ id: data.id })) },
      },
    };
  };
  const txEvent = (tx) => ({
    tx,
    orgId: 'org-1',
    projectId: 'project-1',
    entityType: 'prime_contract',
    entityId: 'contract-1',
    action: 'updated',
    actorId: 'pm-1',
    summary: { transition: 'contract.manage' },
  });

  it("a refused outbound insert inside the caller's transaction is rolled back to its own savepoint: the audit event and its history snapshot stand, and the call succeeds", async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const refused = Object.assign(new Error('Unique constraint failed on the fields: (`id`)'), { code: 'P2002' });
    const { tx, sql } = callerTransaction({ outboundCreate: jest.fn().mockRejectedValue(refused) });
    const event = await auditService.recordEvent(txEvent(tx));
    expect(event.id).toBe('audit-tx');
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.recordHistorySnapshot.create).toHaveBeenCalledTimes(1);
    expect(sql).toEqual(['SAVEPOINT sp', 'ROLLBACK TO SAVEPOINT sp', 'RELEASE SAVEPOINT sp']);
    expect(errorSpy).toHaveBeenCalledWith('[audit-domain-event]', refused);
    errorSpy.mockRestore();
  });

  it("a caller's transaction that can no longer commit is not swallowed", async () => {
    const { tx } = callerTransaction({
      raw: async () => {
        throw new Error('current transaction is aborted, commands ignored until end of transaction block');
      },
    });
    await expect(auditService.recordEvent(txEvent(tx))).rejects.toMatchObject({ transactionAborted: true });
  });

  it('an audit event that cannot be written fails the call (it is not best-effort)', async () => {
    const refused = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const { tx } = callerTransaction({ auditCreate: jest.fn().mockRejectedValue(refused) });
    await expect(auditService.recordEvent(txEvent(tx))).rejects.toBe(refused);
    expect(tx.outboundEvent.create).not.toHaveBeenCalled();
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

  it('combines audit, approval, status, and attachment history for a record', async () => {
    const auditAt = new Date('2026-06-09T11:00:00.000Z');
    const approvalAt = new Date('2026-06-09T12:00:00.000Z');
    const statusAt = new Date('2026-06-09T10:00:00.000Z');
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        orgId: 'org-1',
        projectId: 'project-1',
        entityType: 'change_order',
        entityId: 'co-1',
        action: 'updated',
        actorId: 'qs-1',
        actorRole: 'qs',
        occurredAt: auditAt,
        createdAt: auditAt,
        oldStatus: 'draft',
        newStatus: 'pending',
        summaryJson: { ref: 'VO-01' },
        attachmentsJson: [],
        metadataJson: {},
      },
    ]);
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValue([
      {
        id: 'approval-1',
        orgId: 'org-1',
        projectId: 'project-1',
        recordType: 'change_order',
        recordId: 'co-1',
        workflowType: 'change_order',
        action: 'approved',
        decision: 'approved',
        fromStatus: 'pending',
        toStatus: 'approved',
        actorId: 'pm-1',
        actorRole: 'pm',
        reason: 'Owner instruction accepted',
        comment: 'Approved for baseline update',
        metadataJson: { ref: 'VO-01' },
        createdAt: approvalAt,
      },
    ]);
    mockPrisma.workflowStatusHistory.findMany.mockResolvedValue([
      {
        id: 'status-1',
        projectId: 'project-1',
        recordType: 'change_order',
        recordId: 'co-1',
        oldStatus: null,
        newStatus: 'draft',
        comment: 'Created as draft',
        createdBy: 'qs-1',
        actorRole: 'qs',
        createdAt: statusAt,
      },
    ]);
    mockPrisma.commercialAttachmentRef.findMany.mockResolvedValue([
      {
        id: 'attach-1',
        projectId: 'project-1',
        recordType: 'change_order',
        recordId: 'co-1',
        documentId: 'doc-1',
        fileName: 'owner-instruction.pdf',
        fileUrl: '/download/doc-1',
        storageKey: 'org/project/doc-1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1200,
        description: 'Owner instruction',
        uploadedBy: 'qs-1',
        createdAt: auditAt,
      },
    ]);

    const result = await auditService.listEvents({
      orgId: 'org-1',
      projectId: 'project-1',
      entityType: 'change_order',
      entityId: 'co-1',
      limit: 10,
      order: 'asc',
    });

    expect(result.events.map((event) => event.source)).toEqual([
      'status',
      'audit',
      'approval',
    ]);
    expect(result.events[2]).toEqual(
      expect.objectContaining({
        source: 'approval',
        actorId: 'pm-1',
        actorRole: 'pm',
        decision: 'approved',
        reason: 'Owner instruction accepted',
        comment: 'Approved for baseline update',
      }),
    );
    expect(result.events[2].attachments).toEqual([
      expect.objectContaining({
        id: 'attach-1',
        fileName: 'owner-instruction.pdf',
      }),
    ]);
    expect(mockPrisma.approvalWorkflowEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: 'org-1',
          projectId: 'project-1',
          recordType: 'change_order',
          recordId: 'co-1',
        }),
      }),
    );
  });
});
