/**
 * CERT-2 (group people-evidence-3): the people a daily report names.
 *
 * engineerId was stored as given: another company's person was stored and
 * served back, one who exists nowhere answered 500 from the database's foreign
 * key (which told the two apart). It is now a person of this organisation by
 * membership — another company's person and a nowhere id get the same 404 —
 * checked when it is set or changed. A photo's uploader (a person) is read
 * from the document the photo names, never stored as given; a photo that is
 * not in the accepted shape is refused before anything is written.
 */
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  organizationMembership: { findMany: jest.fn() },
  dailyReport: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  projectDocument: { findMany: jest.fn(), updateMany: jest.fn(async () => ({ count: 0 })) },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => ({
  recordEvent: jest.fn(async () => null),
  ENTITY_TYPES: { DAILY_REPORT: 'daily_report' },
  ACTIONS: { CREATED: 'created', UPDATED: 'updated' },
}));
jest.mock('../equipment.service', () => ({ postDailyReportEquipmentUsage: jest.fn() }));

const dailyReportService = require('../daily-report.service');

const PROJECT = '0ce1a7e2-1111-4111-8111-111111111111';
const MEMBER = '05e40000-1111-4111-8111-111111111111';
const BOTH = '05e40000-3333-4333-8333-333333333333';
const FOREIGN = '05e40000-2222-4222-8222-222222222222';
const NOWHERE = '05e40000-4444-4444-8444-444444444444';
const OWN_DOC = '0d0c0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UPLOADER = '05e40000-5555-4555-8555-555555555555';

const row = (data = {}) => ({
  id: 'report-1',
  projectId: PROJECT,
  activityId: 'activity-1',
  engineerId: MEMBER,
  date: new Date('2026-01-01T00:00:00.000Z'),
  status: 'draft',
  pctProgress: 0,
  photosJson: [],
  progressSubmissions: [],
  equipmentUsages: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...data,
});
const create = (payload) =>
  dailyReportService.createDailyReport({
    orgId: 'org-1',
    projectId: PROJECT,
    userId: MEMBER,
    userRole: 'site_engineer',
    payload: { activityId: 'activity-1', date: '2026-01-01', status: 'draft', ...payload },
  });
const update = (payload) =>
  dailyReportService.updateDailyReport({ orgId: 'org-1', projectId: PROJECT, reportId: 'report-1', userId: MEMBER, payload });

describe('daily report people (CERT-2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, orgId: 'org-1' });
    mockPrisma.activity.findFirst.mockResolvedValue({ id: 'activity-1', projectId: PROJECT, isActive: true });
    // MEMBER and BOTH (home elsewhere) belong to org-1; FOREIGN belongs to another company only.
    mockPrisma.organizationMembership.findMany.mockImplementation(async ({ where }) =>
      where.orgId === 'org-1' ? where.userId.in.filter((id) => [MEMBER, BOTH].includes(id)).map((userId) => ({ userId })) : [],
    );
    mockPrisma.projectDocument.findMany.mockResolvedValue([{ id: OWN_DOC, storageKey: OWN_DOC, uploadedBy: UPLOADER }]);
    mockPrisma.dailyReport.create.mockImplementation(async ({ data }) => row(data));
    mockPrisma.dailyReport.findFirst.mockImplementation(async ({ where }) => (where.clientRequestId ? null : row()));
    mockPrisma.dailyReport.update.mockImplementation(async ({ data }) => row(data));
  });

  it('refuses an engineer who is not a member — another company\'s person and a nowhere id alike — before anything is written', async () => {
    const answers = [];
    for (const engineerId of [FOREIGN, NOWHERE]) {
      const error = await create({ engineerId }).catch((thrown) => thrown);
      expect(error).toMatchObject({ status: 404, code: 'USER_NOT_FOUND', message: 'The engineer is not a member of this organisation' });
      answers.push(JSON.stringify([error.status, error.code, error.message, error.details ?? null]));
    }
    expect(new Set(answers).size).toBe(1);
    expect(mockPrisma.organizationMembership.findMany).toHaveBeenCalledWith({
      // Active or suspended here: an invitation not yet accepted is not membership (L38).
      where: { orgId: 'org-1', userId: { in: [FOREIGN] }, status: { in: ['active', 'suspended'] } },
      select: { userId: true },
    });
    expect(mockPrisma.dailyReport.create).not.toHaveBeenCalled();
  });

  it('refuses an engineer that is not one identifier, whoever it wraps', async () => {
    for (const engineerId of [[MEMBER], [[FOREIGN]], { id: MEMBER }, 12345]) {
      await expect(create({ engineerId })).rejects.toMatchObject({ status: 404, code: 'USER_NOT_FOUND' });
    }
    expect(mockPrisma.dailyReport.create).not.toHaveBeenCalled();
  });

  it('accepts a member as the engineer, including one whose home workspace is another company', async () => {
    for (const engineerId of [MEMBER, BOTH]) {
      const report = await create({ engineerId });
      expect(mockPrisma.dailyReport.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ engineerId }) });
      expect(report.id).toBe('report-1');
    }
  });

  it('defaults the engineer to the caller without a lookup', async () => {
    await create({});
    expect(mockPrisma.organizationMembership.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.dailyReport.create).toHaveBeenCalledWith({ data: expect.objectContaining({ engineerId: MEMBER }) });
  });

  it('checks an engineer an update sets or changes, and leaves the report as it was when refused', async () => {
    for (const engineerId of [FOREIGN, NOWHERE]) {
      await expect(update({ engineerId })).rejects.toMatchObject({ status: 404, code: 'USER_NOT_FOUND' });
    }
    expect(mockPrisma.dailyReport.update).not.toHaveBeenCalled();
    await update({ engineerId: BOTH });
    expect(mockPrisma.dailyReport.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ engineerId: BOTH }) }));
    // Unchanged: no lookup (a report whose engineer has since left can still be edited).
    mockPrisma.organizationMembership.findMany.mockClear();
    await update({ engineerId: MEMBER, notes: 'kept' });
    expect(mockPrisma.organizationMembership.findMany).not.toHaveBeenCalled();
  });

  it('stores a photo\'s uploader from its document, never the person the request names', async () => {
    for (const uploadedBy of [FOREIGN, NOWHERE, UPLOADER]) {
      await create({ photos: [{ key: OWN_DOC, filename: 'bay.png', uploadedBy }, { url: 'https://example.test/a.jpg', uploadedBy }] });
      const { photosJson } = mockPrisma.dailyReport.create.mock.calls.at(-1)[0].data;
      expect(photosJson.map((photo) => [photo.key, photo.uploadedBy])).toEqual([[OWN_DOC, UPLOADER], [null, null]]);
      expect(JSON.stringify(photosJson)).not.toContain(FOREIGN);
    }
  });

  it('refuses photos that are not in the accepted shape before anything is written', async () => {
    for (const photos of [[OWN_DOC], [{ url: FOREIGN }], [{ url: `/api/v1/projects/0ce1a7e2-2222-4222-8222-222222222222/site-reporting/uploads/${OWN_DOC}` }], [{ key: OWN_DOC, name: { id: FOREIGN } }]]) {
      await expect(create({ photos })).rejects.toMatchObject({ status: 400 });
    }
    expect(mockPrisma.dailyReport.create).not.toHaveBeenCalled();
    await expect(update({ photos: [{ url: NOWHERE }] })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(mockPrisma.dailyReport.update).not.toHaveBeenCalled();
  });
});
