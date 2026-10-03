const mockPrisma = {
  project: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  auditEvent: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  // The record rules a reader is judged by (document-text.service RECORD_RULES).
  rfi: { findMany: jest.fn() },
  task: { findMany: jest.fn() },
  conversation: { findMany: jest.fn() },
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
    mockPrisma.rfi.findMany.mockResolvedValue([]);
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.conversation.findMany.mockResolvedValue([]);
  });

  const at = (iso) => new Date(iso);
  const auditRow = (id, occurredAt, extra = {}) => ({ id, orgId: 'org-1', projectId: 'project-1', entityType: 'rfi', entityId: 'rfi-x', action: 'updated', actorId: null, occurredAt, createdAt: occurredAt, summaryJson: {}, attachmentsJson: [], metadataJson: {}, ...extra });
  const approvalRow = (id, createdAt, extra = {}) => ({ id, orgId: 'org-1', projectId: 'project-1', recordType: 'rfi', recordId: 'rfi-x', workflowType: 'rfi', action: 'approved', decision: 'approved', actorId: null, metadataJson: {}, createdAt, ...extra });
  const statusRow = (id, createdAt, extra = {}) => ({ id, projectId: 'project-1', recordType: 'rfi', recordId: 'rfi-x', oldStatus: 'open', newStatus: 'answered', createdBy: null, createdAt, ...extra });
  const whereOf = (mock) => mock.mock.calls[mock.mock.calls.length - 1][0].where;

  it('gives a party reader only the history of the records its modules and its own rules admit (certification L43)', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.rfi.findMany.mockResolvedValue([{ id: 'rfi-x' }]);
    const t = at('2026-09-01T10:00:00.000Z');
    // What the database answers after the where below; the events whose content names a record are judged after.
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      auditRow('a-rfi-x', t),
      auditRow('a-activity', t, { entityType: 'activity', entityId: 'act-1' }),
      auditRow('a-file-x', t, { entityType: 'attachment', entityId: 'att-1', summaryJson: { recordType: 'rfi', recordId: 'rfi-x', fileName: 'x.pdf' } }),
      auditRow('a-file-y', t, { entityType: 'attachment', entityId: 'att-2', summaryJson: { recordType: 'rfi', recordId: 'rfi-y', fileName: 'y.pdf' } }),
      auditRow('a-file-co', t, { entityType: 'attachment', entityId: 'att-3', metadataJson: { recordType: 'change_order', recordId: 'co-1' } }),
      auditRow('a-revision-y', t, { entityType: 'document_revision', entityId: 'rev-1', summaryJson: { recordType: 'rfi', recordId: 'rfi-y', revision: 'B' } }),
      auditRow('a-contract', t, { entityType: 'project', entityId: 'project-1', summaryJson: { transition: 'contract.manage', ref: 'PC-1' } }),
    ]);
    const viewer = { id: 'guest-x', userId: 'guest-x', canRead: (moduleName) => !['change_order', 'ipc', 'cost', 'commitment', 'sub_pay_app'].includes(moduleName), partyIds: ['party-x'], companyIds: ['company-x'] };

    const result = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'all', limit: 50, order: 'asc', viewer });

    // The routed RFIs of the guest's party, on this project — and of those, no colleague's draft (certification R16).
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        AND: [
          { OR: [{ ownerPartyId: { in: ['party-x'] } }, { reviewerPartyId: { in: ['party-x'] } }, { approverPartyId: { in: ['party-x'] } }] },
          { OR: [{ status: { not: 'draft' } }, { createdBy: 'guest-x' }, { managerUserId: 'guest-x' }] },
        ],
      },
      select: { id: true },
    });
    // The guest's own tasks only, as its party's rule says.
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith({ where: { projectId: 'project-1', OR: [{ assigneeId: 'guest-x' }, { createdById: 'guest-x' }] }, select: { id: true } });
    const auditWhere = whereOf(mockPrisma.auditEvent.findMany);
    expect(auditWhere).toMatchObject({ orgId: 'org-1', projectId: 'project-1' });
    const [notIn, onlyIn, ruled] = auditWhere.AND;
    expect(notIn.entityType.notIn).toEqual(expect.arrayContaining(['change_order', 'ipc_certificate', 'cost_record', 'direct_cost', 'commitment', 'sub_pay_app', 'budget_line', 'burn_rate_entry']));
    expect(notIn.entityType.notIn).not.toContain('rfi');
    // A party reader is given only the types of a module it reads; a type of no known module is not.
    expect(onlyIn.entityType.in).toEqual(expect.arrayContaining(['rfi', 'activity', 'attachment', 'document_revision']));
    expect(onlyIn.entityType.in).not.toContain('change_order');
    expect(onlyIn.entityType.in).not.toContain('background_job');
    expect(ruled.OR).toEqual(expect.arrayContaining([{ entityType: 'rfi', entityId: { in: ['rfi-x'] } }, { entityType: 'submittal', entityId: { in: [] } }]));
    expect(ruled.OR[0].entityType.notIn).toEqual(expect.arrayContaining(['rfi', 'submittal', 'task']));
    // The other sources name the record as recordType / recordId.
    expect(whereOf(mockPrisma.approvalWorkflowEvent.findMany).AND[2].OR).toEqual(expect.arrayContaining([{ recordType: 'rfi', recordId: { in: ['rfi-x'] } }]));
    expect(whereOf(mockPrisma.workflowStatusHistory.findMany).AND[0].recordType.notIn).toContain('change_order');

    // A file of company Y's RFI, a file of a change order, Y's RFI's revision and the client contract's change are left out.
    expect(result.events.map((event) => event.id)).toEqual(['a-rfi-x', 'a-activity', 'a-file-x']);
  });

  it('gives a company member the history of the modules its role reads, with no party rule (certification L43)', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.auditEvent.findMany.mockResolvedValue([auditRow('a-contract', at('2026-09-01T10:00:00.000Z'), { entityType: 'project', entityId: 'project-1', summaryJson: { transition: 'contract.manage' } })]);
    const site = { id: 'site-1', userId: 'site-1', canRead: (moduleName) => !['change_order', 'ipc', 'cost', 'commitment', 'sub_pay_app', 'bid', 'eot'].includes(moduleName), partyIds: null, companyIds: null, projectWideTasks: true };

    const result = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'audit', viewer: site });

    const where = whereOf(mockPrisma.auditEvent.findMany);
    expect(where.AND[0].entityType.notIn).toEqual(expect.arrayContaining(['change_order', 'ipc_certificate', 'commitment', 'bid_package', 'eot_claim']));
    expect(where.AND.some((clause) => clause.entityType?.in)).toBe(false);
    // Only the rules that bind everyone are read — a conversation's members, and of the
    // RFIs every one but a colleague's draft (certification R16); the party clauses
    // (the routed RFIs) are not.
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith({ where: { projectId: 'project-1', OR: [{ status: { not: 'draft' } }, { createdBy: 'site-1' }, { managerUserId: 'site-1' }] }, select: { id: true } });
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith({ where: { projectId: 'project-1', OR: [{ members: { some: { userId: 'site-1', leftAt: null } } }] }, select: { id: true } });
    // The client contract's change is the contract's: not for a reader without its module.
    expect(result.events).toEqual([]);
    const pm = { ...site, canRead: () => true };
    expect((await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'audit', viewer: pm })).events).toHaveLength(1);
  });

  it("keeps a company member to the tasks GET /tasks shows them and leaves out a colleague's draft RFI (certification R16)", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.task.findMany.mockResolvedValue([{ id: 'task-own' }]);
    // The RFIs the QS may see: every one but the PM's draft.
    mockPrisma.rfi.findMany.mockResolvedValue([{ id: 'rfi-sent' }]);
    const t = at('2026-09-01T10:00:00.000Z');
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      auditRow('a-file-draft', t, { entityType: 'attachment', entityId: 'att-9', summaryJson: { recordType: 'rfi', recordId: 'rfi-draft-of-pm' } }),
      auditRow('a-file-sent', t, { entityType: 'attachment', entityId: 'att-6', summaryJson: { recordType: 'rfi', recordId: 'rfi-sent' } }),
      auditRow('a-file-task', t, { entityType: 'attachment', entityId: 'att-8', summaryJson: { recordType: 'task', recordId: 'task-other' } }),
      auditRow('a-file-own', t, { entityType: 'attachment', entityId: 'att-7', summaryJson: { recordType: 'task', recordId: 'task-own' } }),
    ]);
    const qs = { id: 'qs-1', userId: 'qs-1', canRead: () => true, partyIds: null, companyIds: null, projectWideTasks: false };

    const result = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'all', viewer: qs });

    // The QS's own tasks (assigned or created), the task routes' rule; every RFI but a colleague's draft.
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith({ where: { projectId: 'project-1', OR: [{ assigneeId: 'qs-1' }, { createdById: 'qs-1' }] }, select: { id: true } });
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith({ where: { projectId: 'project-1', OR: [{ status: { not: 'draft' } }, { createdBy: 'qs-1' }, { managerUserId: 'qs-1' }] }, select: { id: true } });
    for (const [mock, type, id] of [[mockPrisma.auditEvent.findMany, 'entityType', 'entityId'], [mockPrisma.approvalWorkflowEvent.findMany, 'recordType', 'recordId'], [mockPrisma.workflowStatusHistory.findMany, 'recordType', 'recordId']]) {
      const ruled = whereOf(mock).AND.find((clause) => clause.OR && clause.OR.some((part) => part[type] === 'task')).OR;
      expect(ruled[0][type].notIn).toEqual(expect.arrayContaining(['task', 'rfi']));
      expect(ruled).toEqual(expect.arrayContaining([{ [type]: 'task', [id]: { in: ['task-own'] } }, { [type]: 'rfi', [id]: { in: ['rfi-sent'] } }]));
    }
    // A file on a colleague's task or draft is left out; the files on the QS's own task and a sent RFI are kept.
    expect(result.events.map((event) => event.id)).toEqual(['a-file-sent', 'a-file-own']);

    // A PM sees every task: the task rule does not bind them; every RFI they may see is listed.
    mockPrisma.task.findMany.mockClear();
    mockPrisma.rfi.findMany.mockResolvedValue([{ id: 'rfi-sent' }, { id: 'rfi-draft-of-pm' }]);
    const pm = { ...qs, id: 'pm-1', userId: 'pm-1', projectWideTasks: true };
    const all = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'all', viewer: pm });
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
    expect(all.events.map((event) => event.id)).toEqual(['a-file-draft', 'a-file-sent', 'a-file-task', 'a-file-own']);
  });

  it('holds a viewer that does not say it sees every task to its own, and decides the flag as GET /tasks does', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.auditEvent.findMany.mockResolvedValue([]);
    const unsaid = { id: 'who-1', userId: 'who-1', canRead: () => true, partyIds: null, companyIds: null };
    await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'audit', viewer: unsaid });
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith({ where: { projectId: 'project-1', OR: [{ assigneeId: 'who-1' }, { createdById: 'who-1' }] }, select: { id: true } });
    expect(auditService.projectWideTaskVisibility({ role: 'qs', projectAccess: { role: 'qs' } })).toBe(false);
    expect(auditService.projectWideTaskVisibility({ role: 'site_engineer', projectAccess: { role: 'planning_eng' } })).toBe(true);
    expect(auditService.projectWideTaskVisibility({ role: 'pm', projectAccess: null })).toBe(true);
    expect(auditService.projectWideTaskVisibility({ role: 'pm', projectAccess: { role: 'external_party' } })).toBe(false);
    // Rebuilt for a caller handed no request: a stated flag stands; a person who cannot be resolved sees their own.
    await expect(auditService.withTaskVisibility({ orgId: 'org-1', projectId: 'project-1', viewer: { ...unsaid, projectWideTasks: true } })).resolves.toMatchObject({ projectWideTasks: true });
    await expect(auditService.withTaskVisibility({ orgId: 'org-1', projectId: 'project-1', viewer: unsaid })).resolves.toMatchObject({ userId: 'who-1', projectWideTasks: false });
  });

  it('fills a page past the events withheld from the reader, and never hands out the position of one (certification R17)', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.rfi.findMany.mockResolvedValue([{ id: 'rfi-x' }]);
    const t = (minute) => at(`2026-09-01T10:${String(minute).padStart(2, '0')}:00.000Z`);
    const file = (id, minute, recordId) => auditRow(id, t(minute), { entityType: 'attachment', entityId: `att-${id}`, summaryJson: { recordType: 'rfi', recordId } });
    const guest = { id: 'guest-x', userId: 'guest-x', canRead: () => true, partyIds: ['party-x'], companyIds: ['company-x'] };
    const decoded = (cursor) => Buffer.from(String(cursor).slice(3), 'base64url').toString('utf8');

    // Three files on company Y's RFI, then files of both companies.
    mockPrisma.auditEvent.findMany
      .mockResolvedValueOnce([file('f1', 1, 'rfi-y'), file('f2', 2, 'rfi-y'), file('f3', 3, 'rfi-y')])
      .mockResolvedValueOnce([file('f4', 4, 'rfi-x'), file('f5', 5, 'rfi-y'), file('f6', 6, 'rfi-x'), file('f7', 7, 'rfi-y'), file('f8', 8, 'rfi-y')])
      .mockResolvedValueOnce([file('f9', 9, 'rfi-x')]);
    const page = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'audit', limit: 2, order: 'asc', viewer: guest });
    expect(page.events.map((event) => event.id)).toEqual(['f4', 'f6']);
    // The reading went on after the last row read, with a larger take, until an event past the page was given.
    const calls = mockPrisma.auditEvent.findMany.mock.calls.map(([args]) => args);
    expect(calls.map((args) => args.take)).toEqual([3, 5, 9]);
    expect(calls[1].where.AND).toEqual(expect.arrayContaining([{ OR: [{ occurredAt: { gt: t(3) } }, { occurredAt: t(3), id: { gt: 'f3' } }] }]));
    expect(calls[2].where.AND).toEqual(expect.arrayContaining([{ OR: [{ occurredAt: { gt: t(8) } }, { occurredAt: t(8), id: { gt: 'f8' } }] }]));
    // The cursor is the last event given, never a withheld one (f7, f8 were read last).
    expect(decoded(page.nextCursor)).toBe(`${t(6).getTime()}.0.f6`);

    // Nothing left for this reader: no empty page with a cursor.
    mockPrisma.auditEvent.findMany.mockReset();
    mockPrisma.auditEvent.findMany
      .mockResolvedValueOnce([file('f7', 7, 'rfi-y'), file('f8', 8, 'rfi-y'), file('f9', 9, 'rfi-x')])
      .mockResolvedValueOnce([]);
    const last = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'audit', limit: 2, order: 'asc', viewer: guest, cursor: page.nextCursor });
    expect(last.events.map((event) => event.id)).toEqual(['f9']);
    expect(last.nextCursor).toBeNull();
    mockPrisma.auditEvent.findMany.mockReset();
    mockPrisma.auditEvent.findMany.mockResolvedValueOnce([file('f10', 10, 'rfi-y')]);
    const withheld = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'audit', limit: 2, order: 'asc', viewer: guest, cursor: page.nextCursor });
    expect(withheld).toEqual({ events: [], nextCursor: null });

    // Every source read to its end in one go: every row read is judged, none is left behind.
    mockPrisma.auditEvent.findMany.mockReset();
    mockPrisma.auditEvent.findMany.mockResolvedValueOnce([file('g1', 1, 'rfi-y'), file('g2', 2, 'rfi-y')]);
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValueOnce([approvalRow('p1', t(3)), approvalRow('p2', t(4))]);
    const tail = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'all', limit: 2, order: 'asc', viewer: guest });
    expect(tail.events.map((event) => event.id)).toEqual(['approval:p1', 'approval:p2']);
    expect(tail.nextCursor).toBeNull();
  });

  it('pages every source by its position in the one timeline (certification X-PARTY-1)', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    const t9 = at('2026-09-01T09:00:00.000Z');
    const t10 = at('2026-09-01T10:00:00.000Z');
    const t11 = at('2026-09-01T11:00:00.000Z');
    mockPrisma.auditEvent.findMany.mockResolvedValueOnce([auditRow('a1', t10), auditRow('a2', t11)]);
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValueOnce([approvalRow('p1', t10)]);
    mockPrisma.workflowStatusHistory.findMany.mockResolvedValueOnce([statusRow('s1', t9)]);

    const first = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'all', limit: 2, order: 'asc' });
    // At the same instant the audit row comes before the approval row.
    expect(first.events.map((event) => event.id)).toEqual(['status:s1', 'a1']);
    expect(first.nextCursor).toMatch(/^h1\./);

    mockPrisma.auditEvent.findMany.mockResolvedValueOnce([auditRow('a2', t11)]);
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValueOnce([approvalRow('p1', t10)]);
    mockPrisma.workflowStatusHistory.findMany.mockResolvedValueOnce([]);
    const second = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'all', limit: 2, order: 'asc', cursor: first.nextCursor });
    // Every source is asked from the cursor's position: its own source after the row, the later sources from the same instant.
    expect(whereOf(mockPrisma.auditEvent.findMany).AND).toEqual([{ OR: [{ occurredAt: { gt: t10 } }, { occurredAt: t10, id: { gt: 'a1' } }] }]);
    expect(whereOf(mockPrisma.approvalWorkflowEvent.findMany).AND).toEqual([{ createdAt: { gte: t10 } }]);
    expect(whereOf(mockPrisma.workflowStatusHistory.findMany).AND).toEqual([{ createdAt: { gte: t10 } }]);
    expect(second.events.map((event) => event.id)).toEqual(['approval:p1', 'a2']);
    expect(second.nextCursor).toBeNull();

    // Newest first, the order at one instant is reversed, and so are the bounds.
    mockPrisma.auditEvent.findMany.mockResolvedValueOnce([auditRow('a1', t10)]);
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValueOnce([approvalRow('p1', t10)]);
    mockPrisma.workflowStatusHistory.findMany.mockResolvedValueOnce([statusRow('s1', t10)]);
    const newest = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'all', limit: 2, order: 'desc' });
    expect(newest.events.map((event) => event.id)).toEqual(['status:s1', 'approval:p1']);
    mockPrisma.auditEvent.findMany.mockResolvedValueOnce([]);
    mockPrisma.approvalWorkflowEvent.findMany.mockResolvedValueOnce([]);
    mockPrisma.workflowStatusHistory.findMany.mockResolvedValueOnce([]);
    await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'all', limit: 2, order: 'desc', cursor: newest.nextCursor });
    expect(whereOf(mockPrisma.auditEvent.findMany).AND).toEqual([{ occurredAt: { lte: t10 } }]);
    expect(whereOf(mockPrisma.approvalWorkflowEvent.findMany).AND).toEqual([{ OR: [{ createdAt: { lt: t10 } }, { createdAt: t10, id: { lt: 'p1' } }] }]);
    expect(whereOf(mockPrisma.workflowStatusHistory.findMany).AND).toEqual([{ createdAt: { lt: t10 } }]);
  });

  it("reads a cursor of the earlier form as its audit event's position and refuses one that names no position", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    const t10 = at('2026-09-01T10:00:00.000Z');
    mockPrisma.auditEvent.findFirst.mockResolvedValueOnce({ id: 'a1', occurredAt: t10 });
    mockPrisma.auditEvent.findMany.mockResolvedValueOnce([]);
    await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', source: 'audit', order: 'desc', cursor: 'a1' });
    expect(mockPrisma.auditEvent.findFirst).toHaveBeenCalledWith({ where: { id: 'a1', orgId: 'org-1', projectId: 'project-1' }, select: { id: true, occurredAt: true } });
    expect(whereOf(mockPrisma.auditEvent.findMany).AND).toEqual([{ OR: [{ occurredAt: { lt: t10 } }, { occurredAt: t10, id: { lt: 'a1' } }] }]);

    mockPrisma.auditEvent.findFirst.mockResolvedValueOnce(null);
    await expect(auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', cursor: 'not-an-event' })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    await expect(auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', cursor: `h1.${Buffer.from('garbage').toString('base64url')}` })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
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

  it("stores a Prisma Decimal handed to any summary as the amount, never as the Decimal's internals, for every caller", async () => {
    const { Prisma } = require('@prisma/client');
    const occurredAt = new Date('2026-09-30T09:00:00.000Z');
    mockPrisma.auditEvent.create.mockImplementation(({ data }) => Promise.resolve({ id: 'audit-3', createdAt: occurredAt, ...data }));

    const value = new Prisma.Decimal('4321.09');
    // The internals a raw Decimal carries as own properties: walked field by
    // field they were what the event stored until 2026-09-30.
    expect(Object.keys(value).sort()).toEqual(['constructor', 'd', 'e', 's']);

    const event = await auditService.recordEvent({
      orgId: 'org-1',
      projectId: 'project-1',
      entityType: auditService.ENTITY_TYPES.CHANGE_ORDER,
      entityId: 'co-1',
      action: auditService.ACTIONS.UPDATED,
      occurredAt,
      oldSummary: { ref: 'VO-01', value: new Prisma.Decimal('1500.00') },
      newSummary: { ref: 'VO-01', value, links: [{ amount: new Prisma.Decimal('-0.50') }] },
      summary: { transition: 'change_order.update', value, quantity: new Prisma.Decimal('12.345') },
      metadata: { huge: new Prisma.Decimal('12345678901234567890.12') },
    });

    const { data } = mockPrisma.auditEvent.create.mock.calls[0][0];
    expect(data.summaryJson).toEqual({ transition: 'change_order.update', value: 4321.09, quantity: 12.345 });
    expect(data.oldSummaryJson).toEqual({ ref: 'VO-01', value: 1500 });
    expect(data.newSummaryJson).toEqual({ ref: 'VO-01', value: 4321.09, links: [{ amount: -0.5 }] });
    // An amount a double cannot carry exactly is stored as its exact text.
    expect(data.metadataJson).toEqual({ huge: '12345678901234567890.12' });
    expect(JSON.stringify(data)).not.toMatch(/"d":|"constructor"|function/);

    const snapshot = mockPrisma.recordHistorySnapshot.create.mock.calls[0][0].data;
    expect(snapshot.snapshotJson.value).toBe(4321.09);
    expect(snapshot.previousSnapshotJson.value).toBe(1500);
    expect(snapshot.changeSetJson.value).toEqual({ before: 1500, after: 4321.09 });
    expect(event.summary.value).toBe(4321.09);
  });

  it('reads a row written with the old Decimal-internals shape as the amount, without rewriting the row', async () => {
    const { Prisma } = require('@prisma/client');
    const at = new Date('2026-09-10T10:00:00.000Z');
    // Exactly what the old writer stored: the Decimal's own properties, the
    // constructor function turned into its source text.
    const stored = (text) => {
      const decimal = new Prisma.Decimal(text);
      return { d: [...decimal.d], e: decimal.e, s: decimal.s, constructor: String(decimal.constructor) };
    };
    const row = {
      id: 'audit-old', orgId: 'org-1', projectId: 'project-1', entityType: 'change_order', entityId: 'co-1', action: 'approved', actorId: null, actorRole: null, occurredAt: at, createdAt: at,
      oldSummaryJson: { ref: 'VO-01', value: stored('1500.00') },
      newSummaryJson: { ref: 'VO-01', value: stored('4321.09'), costImpact: { d: [1234567, 8900000], e: 6, s: 1 }, links: [{ amount: stored('-0.005') }] },
      summaryJson: { transition: 'change_order.approve', value: stored('98765432109876.54'), zero: stored('0'), truncated: { d: '[truncated]', e: 3, s: 1, constructor: 'function Decimal(v) {}' }, plain: { d: [1], e: 0 } },
      attachmentsJson: [],
      metadataJson: { big: stored('12345678901234567890.12') },
    };
    const before = JSON.stringify(row);
    mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    mockPrisma.auditEvent.findMany.mockResolvedValue([row]);

    const { events } = await auditService.listEvents({ orgId: 'org-1', projectId: 'project-1', entityType: 'change_order', entityId: 'co-1', source: 'audit' });

    expect(events).toHaveLength(1);
    expect(events[0].oldSummary).toEqual({ ref: 'VO-01', value: 1500 });
    expect(events[0].newSummary).toEqual({ ref: 'VO-01', value: 4321.09, costImpact: 1234567.89, links: [{ amount: -0.005 }] });
    expect(events[0].summary.value).toBe(98765432109876.55);
    expect(events[0].summary.zero).toBe(0);
    expect(events[0].metadata.big).toBe(12345678901234567000);
    // Digits lost at the depth limit cannot be recovered (no value, not the
    // internals); a look-alike that is not the shape stays what it is.
    expect(events[0].summary.truncated).toBeNull();
    expect(events[0].summary.plain).toEqual({ d: [1], e: 0 });
    expect(JSON.stringify(events[0]).includes('function')).toBe(false);
    // The read decodes; nothing is written back.
    expect(JSON.stringify(row)).toBe(before);
    expect(mockPrisma.auditEvent.create).not.toHaveBeenCalled();
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
