/**
 * CERT-2 (group evidence-4): which links in progress evidence are the
 * product's files, and which fields a photo may carry.
 *
 * The third round took every link holding /projects/<id> — on any host — for
 * a link into the product, and every other identifier in it for a document
 * key: an Autodesk Construction Cloud folder link, an in-app link to the
 * project's own RFI, were refused 400 INVALID_SITE_PHOTO_REFERENCE. The UAT
 * runner's photo ({ fileName, fileUrl, mimeType, sizeBytes, description }) was
 * refused 400 VALIDATION_ERROR for its description. Now only a link the
 * product serves as a stored file (its own download routes, with or without
 * /api/v1, on any host) names a file, checked as a document field is: this
 * project's document, photo or revision; another company's and one that
 * exists nowhere alike. Every other link is the caller's text.
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
  photo: { findMany: jest.fn(async () => []) },
  documentRevision: { findMany: jest.fn(async () => []) },
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
const OWN_PHOTO = '0f0f0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_PHOTO = '0f0f0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWN_REVISION = '0e0e0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_REVISION = '0e0e0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWN_RFI = '0a0a0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const submit = (evidence) =>
  progressService.createProgressSubmission({
    orgId: 'org-1',
    projectId: PROJECT,
    activityId: 'activity-1',
    userId: 'pm-1',
    userRole: 'pm',
    payload: { method: 'percent', pctComplete: 40, evidence },
  });
const stored = () => mockPrisma.progressSubmission.create.mock.calls.at(-1)?.[0]?.data?.evidenceJson;
const lookups = () =>
  mockPrisma.projectDocument.findMany.mock.calls.length +
  mockPrisma.photo.findMany.mock.calls.length +
  mockPrisma.documentRevision.findMany.mock.calls.length;

// Each product file route, as a link a client may write: [label, link(project, id), the id kind].
const FILE_LINKS = [
  ['site-reporting upload', (p, id) => `/api/v1/projects/${p}/site-reporting/uploads/${id}`, 'document'],
  ['workflow upload', (p, id) => `/api/v1/projects/${p}/workflow/uploads/${id}`, 'document'],
  ['doc-control upload answer', (p, id) => `/api/v1/projects/${p}/doc-control/uploads/${id}`, 'document'],
  ['boq upload', (p, id) => `/api/v1/projects/${p}/boq/uploads/${id}`, 'document'],
  ['import upload', (p, id) => `/api/v1/projects/${p}/import/uploads/${id}`, 'document'],
  ['schedule upload', (p, id) => `/api/v1/projects/${p}/schedule/uploads/${id}`, 'document'],
  ['attachment document download', (p, id) => `/api/v1/projects/${p}/attachments/documents/${id}`, 'document'],
  ['absolute upload link on the API host', (p, id) => `https://api.octapm.example/api/v1/projects/${p}/site-reporting/uploads/${id}`, 'document'],
  ['upload link on another host', (p, id) => `https://elsewhere.example/api/v1/projects/${p}/workflow/uploads/${id}?download=1`, 'document'],
  ['photo file', (p, id) => `/api/v1/projects/${p}/photos/${id}/file`, 'photo'],
  ['photo thumbnail, below the API base (the mobile client)', (p, id) => `/projects/${p}/photos/${id}/thumbnail`, 'photo'],
  ['revision download', (p, id) => `/api/v1/projects/${p}/doc-control/revisions/${id}/download`, 'revision'],
  ['revision preview', (p, id) => `https://api.octapm.example/api/v1/projects/${p}/doc-control/revisions/${id}/preview`, 'revision'],
];
const OWN = { document: OWN_DOC, photo: OWN_PHOTO, revision: OWN_REVISION };
const FOREIGN = { document: FOREIGN_DOC, photo: FOREIGN_PHOTO, revision: FOREIGN_REVISION };

describe('progress evidence: links and photo fields (CERT-2, evidence-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, orgId: 'org-1' });
    mockPrisma.activity.findFirst.mockResolvedValue({ id: 'activity-1', projectId: PROJECT, isActive: true });
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(null);
    // Only this project's own document, photo and revision exist here.
    mockPrisma.projectDocument.findMany.mockImplementation(async ({ where }) => {
      const wanted = new Set([...(where.OR?.[0]?.id?.in || []), ...(where.OR?.[1]?.storageKey?.in || [])]);
      return wanted.has(OWN_DOC) && where.projectId === PROJECT && where.orgId === 'org-1' ? [{ id: OWN_DOC, storageKey: OWN_DOC, uploadedBy: 'uploader-1' }] : [];
    });
    mockPrisma.photo.findMany.mockImplementation(async ({ where }) =>
      where.id.in.includes(OWN_PHOTO) && where.projectId === PROJECT && where.orgId === 'org-1' ? [{ id: OWN_PHOTO }] : [],
    );
    mockPrisma.documentRevision.findMany.mockImplementation(async ({ where }) =>
      where.id.in.includes(OWN_REVISION) && where.projectId === PROJECT ? [{ id: OWN_REVISION }] : [],
    );
    mockPrisma.progressSubmission.create.mockImplementation(async ({ data }) => ({ id: 'submission-1', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...data }));
  });

  it('stores links that are not the product\'s files as the caller wrote them, without a lookup', async () => {
    const pages = [
      `https://acc.autodesk.com/docs/files/projects/${OTHER_PROJECT}?folderUrn=urn:adsk.wipprod:fs.folder:co.abc&viewModel=detail&moduleId=folders`,
      `https://app.octapm.example/o/acme/projects/${PROJECT}/rfi/${OWN_RFI}`,
      `https://app.octapm.example/projects/${PROJECT}/schedule/activities/${OWN_RFI}`,
      `/api/v1/projects/${PROJECT}/rfi/${OWN_RFI}`,
      `https://app.octapm.example/projects/${OTHER_PROJECT}/rfi/${FOREIGN_DOC}`,
    ];
    for (const url of pages) {
      for (const evidence of [{ photos: [{ url }] }, { photos: [url] }, { notes: `see ${url}` }]) {
        await submit(evidence);
        expect(stored()).toEqual(evidence);
      }
    }
    expect(lookups()).toBe(0);
  });

  it('accepts and stores every field the product\'s clients send in a photo — the UAT runner\'s description included', async () => {
    const uat = { fileName: 'uat-evidence-r1.jpg', fileUrl: 'https://example.com/uat-evidence.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, description: 'Synthetic UAT evidence reference' };
    const driver = { key: OWN_DOC, url: `/api/v1/projects/${PROJECT}/site-reporting/uploads/${OWN_DOC}`, name: 'bay.png', type: 'photo' };
    const daily = { key: OWN_DOC, url: null, filename: 'bay.png', originalName: 'IMG_1.png', mimeType: 'image/png', size: 70, storage: 'local', caption: 'north bay', takenAt: null, uploadedBy: null, uploadedAt: null };
    for (const evidence of [{ photos: [uat] }, { notes: 'UAT progress update.', photos: [uat, driver] }]) {
      await submit(evidence);
      expect(stored()).toEqual(evidence);
    }
    // A daily report's photo carries its uploader, read from the document it names.
    await submit({ photos: [daily] });
    expect(stored()).toEqual({ photos: [{ ...daily, uploadedBy: 'uploader-1' }] });
  });

  it('still refuses a field no client sends, a value that is not one scalar, and an id standing alone', async () => {
    for (const evidence of [{ photos: [{ fileId: OWN_DOC }] }, { photos: [{ description: [OWN_DOC] }] }, { photos: [{ description: OWN_DOC }] }]) {
      await expect(submit(evidence)).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    }
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });

  describe.each(FILE_LINKS)('a %s link', (_label, link, kind) => {
    it('naming this project\'s own file is accepted and stored as written', async () => {
      for (const evidence of [{ photos: [{ url: link(PROJECT, OWN[kind]) }] }, { photos: [link(PROJECT, OWN[kind])] }, { notes: `measured, see ${link(PROJECT, OWN[kind])}.` }]) {
        await submit(evidence);
        expect(stored()).toEqual(evidence);
      }
    });

    it('naming another company\'s file is refused exactly as one that exists nowhere, before anything is written', async () => {
      const answers = [];
      for (const id of [FOREIGN[kind], NOWHERE_DOC]) {
        const error = await submit({ photos: [{ url: link(PROJECT, id) }] }).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', message: 'Photo evidence must reference documents uploaded to this project', details: { missing: [id] } });
        answers.push(JSON.stringify([error.status, error.code, error.message, String(error.details.missing).replace(id, '<sent>')]));
      }
      expect(new Set(answers).size).toBe(1);
      const model = { document: mockPrisma.projectDocument, photo: mockPrisma.photo, revision: mockPrisma.documentRevision }[kind];
      expect(model.findMany).toHaveBeenCalled();
      expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    });

    it('into another project is refused without a lookup, whoever\'s file it names', async () => {
      for (const id of [OWN[kind], FOREIGN[kind], NOWHERE_DOC]) {
        const error = await submit({ photos: [{ url: link(OTHER_PROJECT, id) }] }).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
        expect(error.details).toBeUndefined();
      }
      expect(lookups()).toBe(0);
      expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    });
  });

  it('reads a file link\'s key as its route does: decoded, without a sentence\'s closing dots', async () => {
    await submit({ notes: `photo at /api/v1/projects/${PROJECT}/site-reporting/uploads/${encodeURIComponent(OWN_DOC)}...` });
    expect(mockPrisma.projectDocument.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ id: { in: [OWN_DOC] } }, { storageKey: { in: [OWN_DOC] } }] }) }));
    expect(mockPrisma.progressSubmission.create).toHaveBeenCalledTimes(1);
  });

  it('checks every file link in one text, and the photo and revision lookups are scoped to this project (and company)', async () => {
    const text = `before /api/v1/projects/${PROJECT}/photos/${OWN_PHOTO}/file and after /api/v1/projects/${PROJECT}/doc-control/revisions/${FOREIGN_REVISION}/download`;
    await expect(submit({ notes: text })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [FOREIGN_REVISION] } });
    expect(mockPrisma.photo.findMany).toHaveBeenCalledWith({ where: { id: { in: [OWN_PHOTO] }, projectId: PROJECT, orgId: 'org-1' }, select: { id: true } });
    expect(mockPrisma.documentRevision.findMany).toHaveBeenCalledWith({ where: { id: { in: [FOREIGN_REVISION] }, projectId: PROJECT }, select: { id: true } });
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });
});
