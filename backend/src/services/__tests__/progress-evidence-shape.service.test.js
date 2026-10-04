/**
 * CERT-2 (group people-evidence-3): progress evidence names documents of the
 * submission's own project only, in the one shape the product's clients send.
 *
 * A document named in another shape than photos[{ key }] — photos as an
 * object, a list inside the list, a bare id as a photo, a `documents` list, a
 * key beside photos[], an unknown photo field, an id where a link or a
 * description belongs — was skipped by the document check and stored as given
 * (another company's document id in ProgressSubmission.evidenceJson). Each is
 * now invalid input (400 VALIDATION_ERROR) before any lookup, whoever's id it
 * carries; a link into the product names this project and its own documents
 * only; a photo's uploader is read from its document. The shapes the clients
 * send are stored as they are.
 */
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  activityAssignment: { findMany: jest.fn() },
  activityProgressMethod: { findFirst: jest.fn(), upsert: jest.fn() },
  progressSubmission: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  activityProgress: { create: jest.fn(), findFirst: jest.fn(async () => null) },
  quantityProgressEntry: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []), create: jest.fn(), updateMany: jest.fn() },
  activityBoqAllocation: { findMany: jest.fn(async () => []) },
  projectDocument: { findMany: jest.fn(async () => []) },
};
const mockAuditService = {
  ACTIONS: { APPROVED: 'approved', CREATED: 'created', REJECTED: 'rejected' },
  ENTITY_TYPES: { PROGRESS_SUBMISSION: 'progress_submission' },
  recordEvent: jest.fn(),
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../audit.service', () => mockAuditService);

const progressService = require('../progress.service');

const PROJECT = '0ce1a7e2-1111-4111-8111-111111111111';
const OTHER_PROJECT = '0ce1a7e2-2222-4222-8222-222222222222';
const OWN_DOC = '0d0c0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_DOC = '0d0c0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOWHERE_DOC = '0d0c0000-cccc-4ccc-8ccc-cccccccccccc';
const UPLOADER = '05e40000-1111-4111-8111-111111111111';
const FOREIGN_PERSON = '05e40000-2222-4222-8222-222222222222';
const link = (project, doc) => `/api/v1/projects/${project}/site-reporting/uploads/${doc}`;

const submit = (evidence, field = 'evidence') =>
  progressService.createProgressSubmission({
    orgId: 'org-1',
    projectId: PROJECT,
    activityId: 'activity-1',
    userId: 'pm-1',
    userRole: 'pm',
    payload: { method: 'percent', pctComplete: 40, [field]: evidence },
  });
const stored = () => mockPrisma.progressSubmission.create.mock.calls.at(-1)?.[0]?.data?.evidenceJson;

describe('progress evidence: the accepted shape (CERT-2 shapes, second round)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, orgId: 'org-1' });
    mockPrisma.activity.findFirst.mockResolvedValue({ id: 'activity-1', projectId: PROJECT, isActive: true });
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(null);
    // Only the own document exists in this project.
    mockPrisma.projectDocument.findMany.mockImplementation(async ({ where }) => {
      const wanted = new Set([...(where.OR?.[0]?.id?.in || []), ...(where.OR?.[1]?.storageKey?.in || [])]);
      return (wanted.has(OWN_DOC) || wanted.has('own-storage')) && where.projectId === PROJECT && where.orgId === 'org-1' ? [{ id: OWN_DOC, storageKey: 'own-storage', uploadedBy: UPLOADER }] : [];
    });
    mockPrisma.progressSubmission.create.mockImplementation(async ({ data }) => ({ id: 'submission-1', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...data }));
  });

  it.each([
    ['photos as an object', (id) => ({ photos: { key: id } })],
    ['a list inside the list', (id) => ({ photos: [[{ key: id }]] })],
    ['a bare id as a photo', (id) => ({ photos: [id] })],
    ['a documents list', (id) => ({ documents: [{ documentId: id }] })],
    ['a key beside photos[]', (id) => ({ key: id, photos: [] })],
    ['a documentId at the top', (id) => ({ documentId: id })],
    ['a storageKey at the top', (id) => ({ storageKey: id })],
    ['an uploader at the top', (id) => ({ uploadedBy: id })],
    ['a field a photo does not have', (id) => ({ photos: [{ id }] })],
    ['an unknown field beside an own key', (id) => ({ photos: [{ key: OWN_DOC, fileId: id }] })],
    ['an id as a photo\'s link', (id) => ({ photos: [{ url: id }] })],
    ['an id as a description', (id) => ({ measurementSheet: id })],
    ['an id as the notes', (id) => ({ notes: ` ${id} ` })],
    ['a list as a photo field', (id) => ({ photos: [{ caption: [id] }] })],
    ['an object as an uploader', (id) => ({ photos: [{ key: OWN_DOC, uploadedBy: { id } }] })],
    ['an object as a description', (id) => ({ notes: { id } })],
    ['an id as a name', (id) => ({ [id]: 'x' })],
  ])('refuses %s as invalid input — the own, a foreign and a nowhere document alike — before any lookup or write', async (_label, shape) => {
    for (const id of [OWN_DOC, FOREIGN_DOC, NOWHERE_DOC]) {
      const error = await submit(shape(id)).catch((thrown) => thrown);
      expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Validation failed' });
      // The refusal never repeats the value it was given.
      expect(JSON.stringify(error.details)).not.toContain(id);
    }
    expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    expect(mockAuditService.recordEvent).not.toHaveBeenCalled();
  });

  it('refuses evidenceJson that is a list or a text holding an id, as it refuses evidence', async () => {
    for (const id of [OWN_DOC, FOREIGN_DOC, NOWHERE_DOC]) {
      await expect(submit([id], 'evidenceJson')).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      await expect(submit(id, 'evidenceJson')).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      await expect(submit({ photos: { key: id } }, 'evidenceJson')).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    }
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });

  it('refuses a link into another project — another company\'s or one that exists nowhere alike — without a lookup', async () => {
    const answers = [];
    for (const project of [OTHER_PROJECT, '0ce1a7e2-3333-4333-8333-333333333333']) {
      for (const evidence of [{ photos: [{ url: link(project, OWN_DOC) }] }, { photos: [link(project, OWN_DOC)] }, { notes: `see ${link(project, OWN_DOC)}` }]) {
        const error = await submit(evidence).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', message: 'Photo evidence must reference documents uploaded to this project' });
        answers.push(JSON.stringify({ status: error.status, code: error.code, message: error.message, details: error.details ?? null }));
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });

  it('checks the document a link into this project names, as a document field: another\'s and a nowhere one alike, the own accepted', async () => {
    for (const doc of [FOREIGN_DOC, NOWHERE_DOC]) {
      await expect(submit({ photos: [{ url: link(PROJECT, doc) }] })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [doc] } });
    }
    expect(mockPrisma.projectDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: PROJECT, orgId: 'org-1', OR: [{ id: { in: [FOREIGN_DOC] } }, { storageKey: { in: [FOREIGN_DOC] } }] } }),
    );
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    const evidence = { photos: [{ url: link(PROJECT, OWN_DOC) }] };
    await submit(evidence);
    expect(stored()).toEqual(evidence);
  });

  it('keeps a document field that is not one text the refusal of a reference naming nothing (the first shapes round)', async () => {
    for (const value of [[OWN_DOC], { id: OWN_DOC }, 12345]) {
      await expect(submit({ photos: [{ key: value }] })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
    }
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });

  it('stores the uploader of the document a photo names, never the one the request says', async () => {
    const answers = [];
    for (const person of [FOREIGN_PERSON, NOWHERE_DOC, UPLOADER]) {
      await submit({ notes: 'north bay', photos: [{ key: OWN_DOC, name: 'bay.png', uploadedBy: person }, { url: 'https://example.test/a.jpg', uploadedBy: person }] });
      answers.push(stored());
    }
    for (const evidence of answers) {
      expect(evidence).toEqual({ notes: 'north bay', photos: [{ key: OWN_DOC, name: 'bay.png', uploadedBy: UPLOADER }, { url: 'https://example.test/a.jpg', uploadedBy: null }] });
    }
  });

  it('stores what the clients send as it is: the upload\'s answer, a typed link, a link as a photo, notes and descriptions', async () => {
    const uploadAnswer = {
      documentId: OWN_DOC,
      key: OWN_DOC,
      storageKey: OWN_DOC,
      url: link(PROJECT, OWN_DOC),
      fileUrl: link(PROJECT, OWN_DOC),
      downloadUrl: link(PROJECT, OWN_DOC),
      filename: 'bay.png',
      fileName: 'bay.png',
      originalName: 'IMG_0001.png',
      mimeType: 'image/png',
      size: 70,
      sizeBytes: 70,
      storage: 'local',
      scanStatus: 'clean',
      retentionExpiresAt: '2033-01-01T00:00:00.000Z',
      uploadedBy: UPLOADER,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    };
    for (const evidence of [
      { photos: [uploadAnswer] },
      { photos: [{ url: 'https://example.test/photo.jpg' }] },
      { photos: ['https://sharepoint.example.test/sites/x/{3F2504E0-4F89-11D3-9A0C-0305E82C3301}/a.jpg'] },
      { notes: 'photographed on site', photos: [{ key: OWN_DOC, url: link(PROJECT, OWN_DOC), name: 'bay.png', type: 'photo' }] },
      { measurementSheet: 'MS-07 joint measurement', method: "joint measurement with the client's QS", count: 2, signed: true, extra: null },
      { photos: [{ key: 'own-storage', caption: 'by storage key', takenAt: '2026-01-01T08:00:00.000Z' }] },
    ]) {
      await submit(evidence);
      expect(stored()).toEqual(evidence);
    }
  });
});
