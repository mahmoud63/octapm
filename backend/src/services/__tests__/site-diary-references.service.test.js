/**
 * CERT-2 (group evidence-4): what a site diary names.
 *
 * A diary stored its engineer, its photos and its equipment and material
 * lines as given: another company's person as the engineer (201, served back)
 * while one who exists nowhere answered 500 from the foreign key; a photo's
 * uploader (a person), a bare id as a link, a link into another company's
 * project; another company's equipment and materials. Now the engineer is a
 * member of this organisation (404 alike), the photos take progress
 * evidence's shape and name this project's files only, each uploader read from
 * its document, and the lines name this project's equipment and materials —
 * each checked when the request sends it, so an edit that leaves the photos
 * alone does not re-check them.
 */
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  organizationMembership: { findMany: jest.fn() },
  siteDiary: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  projectDocument: { findMany: jest.fn(), updateMany: jest.fn(async () => ({ count: 0 })) },
  equipment: { findMany: jest.fn() },
  activityMaterial: { findMany: jest.fn() },
  materialMaster: { findMany: jest.fn(async () => []) },
  photo: { findMany: jest.fn(async () => []) },
  documentRevision: { findMany: jest.fn(async () => []) },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => ({
  recordEvent: jest.fn(async () => null),
  ENTITY_TYPES: { SITE_DIARY: 'site_diary', DAILY_REPORT: 'daily_report' },
  ACTIONS: { CREATED: 'created', UPDATED: 'updated' },
}));

const siteDiaryService = require('../site-diary.service');

const PROJECT = '0ce1a7e2-1111-4111-8111-111111111111';
const OTHER_PROJECT = '0ce1a7e2-2222-4222-8222-222222222222';
const MEMBER = '05e40000-1111-4111-8111-111111111111';
const BOTH = '05e40000-3333-4333-8333-333333333333';
const FOREIGN = '05e40000-2222-4222-8222-222222222222';
const NOWHERE = '05e40000-4444-4444-8444-444444444444';
const OWN_DOC = '0d0c0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_DOC = '0d0c0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UPLOADER = '05e40000-5555-4555-8555-555555555555';
const OWN_EQUIPMENT = '0e900000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWN_MATERIAL = '0a700000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const link = (project, doc) => `/api/v1/projects/${project}/site-reporting/uploads/${doc}`;

const row = (data = {}) => ({
  id: 'diary-1',
  projectId: PROJECT,
  engineerId: MEMBER,
  date: new Date('2026-01-01T00:00:00.000Z'),
  status: 'draft',
  workers: 0,
  photosJson: [{ key: OWN_DOC, url: null, uploadedBy: UPLOADER }, { url: 'https://acc.autodesk.com/docs/files/projects/x' }],
  equipmentJson: [],
  materialsJson: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...data,
});
const create = (payload) =>
  siteDiaryService.createSiteDiary({ orgId: 'org-1', projectId: PROJECT, userId: MEMBER, payload: { date: '2026-01-01', status: 'draft', ...payload } });
const update = (payload) =>
  siteDiaryService.updateSiteDiary({ orgId: 'org-1', projectId: PROJECT, diaryId: 'diary-1', userId: MEMBER, payload });
const answerOf = (error, id) => JSON.stringify([error.status, error.code, error.message, JSON.stringify(error.details ?? null).split(id).join('<sent>')]);

describe('site diary references (CERT-2, evidence-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, orgId: 'org-1' });
    mockPrisma.organizationMembership.findMany.mockImplementation(async ({ where }) =>
      where.orgId === 'org-1' ? where.userId.in.filter((id) => [MEMBER, BOTH].includes(id)).map((userId) => ({ userId })) : [],
    );
    // The own site photo, available and clean, in this project and company only.
    mockPrisma.projectDocument.findMany.mockImplementation(async ({ where }) => {
      const wanted = new Set([...(where.OR?.[0]?.id?.in || []), ...(where.OR?.[1]?.storageKey?.in || [])]);
      return wanted.has(OWN_DOC) && where.projectId === PROJECT && where.orgId === 'org-1' ? [{ id: OWN_DOC, storageKey: OWN_DOC, uploadedBy: UPLOADER }] : [];
    });
    mockPrisma.equipment.findMany.mockImplementation(async ({ where }) => where.id.in.filter((id) => id === OWN_EQUIPMENT && where.projectId === PROJECT).map((id) => ({ id })));
    mockPrisma.activityMaterial.findMany.mockImplementation(async ({ where }) => where.id.in.filter((id) => id === OWN_MATERIAL && where.projectId === PROJECT).map((id) => ({ id })));
    mockPrisma.siteDiary.create.mockImplementation(async ({ data }) => row(data));
    mockPrisma.siteDiary.findFirst.mockImplementation(async ({ where }) => (where.clientRequestId ? null : row()));
    mockPrisma.siteDiary.update.mockImplementation(async ({ data }) => row(data));
  });

  it('refuses an engineer who is not a member — another company\'s person and a nowhere id alike — on create and update', async () => {
    const answers = [];
    for (const engineerId of [FOREIGN, NOWHERE]) {
      for (const send of [create, update]) {
        const error = await send({ engineerId }).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 404, code: 'USER_NOT_FOUND', message: 'The engineer is not a member of this organisation' });
        answers.push(answerOf(error, engineerId));
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect(mockPrisma.siteDiary.create).not.toHaveBeenCalled();
    expect(mockPrisma.siteDiary.update).not.toHaveBeenCalled();
    for (const engineerId of [MEMBER, BOTH]) await create({ engineerId });
    expect(mockPrisma.siteDiary.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ engineerId: BOTH }) });
  });

  it('stores a photo\'s uploader from its document, never the person the request names', async () => {
    for (const uploadedBy of [FOREIGN, NOWHERE]) {
      await create({ photos: [{ key: OWN_DOC, filename: 'bay.png', uploadedBy }, { url: 'https://example.test/a.jpg', uploadedBy }] });
      const { photosJson } = mockPrisma.siteDiary.create.mock.calls.at(-1)[0].data;
      expect(photosJson.map((photo) => [photo.key, photo.uploadedBy])).toEqual([[OWN_DOC, UPLOADER], [null, null]]);
      expect(JSON.stringify(photosJson)).not.toContain(FOREIGN);
    }
  });

  it('refuses photos outside the accepted shape or naming another company\'s file, before anything is written', async () => {
    for (const [photos, code] of [
      [[FOREIGN_DOC], 'VALIDATION_ERROR'],
      [[{ url: FOREIGN_DOC }], 'VALIDATION_ERROR'],
      [[{ key: OWN_DOC, name: { id: FOREIGN_DOC } }], 'VALIDATION_ERROR'],
      [[{ url: link(OTHER_PROJECT, FOREIGN_DOC) }], 'INVALID_SITE_PHOTO_REFERENCE'],
      [[{ url: link(PROJECT, FOREIGN_DOC) }], 'INVALID_SITE_PHOTO_REFERENCE'],
      [[{ key: FOREIGN_DOC }], 'INVALID_SITE_PHOTO_REFERENCE'],
    ]) {
      await expect(create({ photos })).rejects.toMatchObject({ status: 400, code });
      await expect(update({ photos })).rejects.toMatchObject({ status: 400, code });
    }
    expect(mockPrisma.siteDiary.create).not.toHaveBeenCalled();
    expect(mockPrisma.siteDiary.update).not.toHaveBeenCalled();
  });

  it('stores what the clients send: the upload answer, a link to the own file, another product\'s link', async () => {
    const upload = { documentId: OWN_DOC, key: OWN_DOC, storageKey: OWN_DOC, url: link(PROJECT, OWN_DOC), filename: 'bay.png', originalName: 'IMG_1.png', mimeType: 'image/png', size: 70, storage: 'local', uploadedBy: UPLOADER, uploadedAt: '2026-01-01T00:00:00.000Z' };
    await create({ photos: [upload, { url: 'https://acc.autodesk.com/docs/files/projects/x?folderUrn=y' }] });
    const { photosJson } = mockPrisma.siteDiary.create.mock.calls.at(-1)[0].data;
    expect(photosJson).toEqual([
      expect.objectContaining({ key: OWN_DOC, url: link(PROJECT, OWN_DOC), filename: 'bay.png', uploadedBy: UPLOADER }),
      expect.objectContaining({ url: 'https://acc.autodesk.com/docs/files/projects/x?folderUrn=y', key: null }),
    ]);
  });

  it('checks equipment and material lines on create and when an update sends them', async () => {
    await expect(create({ equipment: [{ equipmentId: NOWHERE, hours: 1 }] })).rejects.toMatchObject({ status: 400, code: 'EQUIPMENT_USAGE_LINK_INVALID', message: 'Site diary equipment must reference project equipment' });
    await expect(update({ materials: [{ materialId: NOWHERE }] })).rejects.toMatchObject({ status: 400, code: 'MATERIAL_LINK_INVALID', message: 'Site diary materials must reference materials of this project' });
    expect(mockPrisma.siteDiary.create).not.toHaveBeenCalled();
    expect(mockPrisma.siteDiary.update).not.toHaveBeenCalled();
    await create({ equipment: [{ equipmentId: OWN_EQUIPMENT, name: 'crane', hours: 1 }], materials: [{ materialId: OWN_MATERIAL, qty: 1 }] });
    expect(mockPrisma.siteDiary.create).toHaveBeenCalledTimes(1);
  });

  it('an update that sends no photos does not re-check the stored ones and keeps them as stored', async () => {
    mockPrisma.projectDocument.findMany.mockResolvedValue([]);
    await update({ notes: 'edited without photos' });
    expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.siteDiary.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ notes: 'edited without photos', photosJson: row().photosJson }) }));
  });
});
