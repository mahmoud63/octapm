/**
 * CERT-2 (group evidence-lines-5): a file link is matched as a client
 * resolves it, and a key that cannot name a document is never looked up.
 *
 * FILE_LINK matched the literal text, so a link the WHATWG URL parser —
 * browsers, fetch, axios — resolves to a stored file escaped it: a './'
 * segment, backslashes for slashes, a tab or newline inside the path, an
 * escaped project id ('%63e2c…', which Express decodes). Another company's
 * document or photo was stored as evidence (200/201). The bidder portal's
 * document link (`/public/bids/:token/documents/:documentId`) was not a file
 * link at all. Each is now checked as a document field is.
 *
 * A key was decoded (decodeURIComponent) and looked up as it came: '%00'
 * became a NUL and Postgres answered 500 (22021). A key with a character no
 * id or storage key has is missing, without a lookup.
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
const TOKEN = 'bidtoken_0123456789abcdefABCDEF';
// '0' is %30: Express decodes the parameter to the plain id.
const escaped = (id) => `%${id.charCodeAt(0).toString(16)}${id.slice(1)}`;

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
const answerOf = (error, id) => JSON.stringify([error.status, error.code, error.message, JSON.stringify(error.details ?? null).split(id).join('<sent>')]);

// [label, link(project, document), whether only a link field reads it so (a tab
// or line break inside it: the URL parser drops them from a link; free text
// breaks there)]
const DOCUMENT_LINKS = [
  ['a "./" segment', (p, d) => `/api/v1/projects/${p}/site-reporting/./uploads/${d}`, false],
  ['a "%2e" segment', (p, d) => `/api/v1/projects/${p}/site-reporting/%2e/uploads/${d}`, false],
  ['a ".." segment', (p, d) => `/api/v1/projects/${p}/workflow/x/../uploads/${d}`, false],
  ['backslashes for slashes, absolute', (p, d) => `https://h\\api\\v1\\projects\\${p}\\site-reporting\\uploads\\${d}`, false],
  ['backslashes for slashes, below the base', (p, d) => `\\projects\\${p}\\workflow\\uploads\\${d}`, false],
  ['a tab inside the path', (p, d) => `/api/v1/projects/${p}/site-re\tporting/uploads/${d}`, true],
  ['a newline inside the path', (p, d) => `https://api.octapm.example/api/v1/proj\nects/${p}/attachments/documents/${d}`, true],
  ['a carriage return inside a segment', (p, d) => `/api/v1/projects/${p}/bo\rq/uploads/${d}`, true],
  ['a tab inside the path and a query', (p, d) => `/api/v1/projects/${p}/site-re\tporting/uploads/${d}?a b`, true],
  ['an escaped project id', (p, d) => `/api/v1/projects/${escaped(p)}/site-reporting/uploads/${d}`, false],
  ['an upper-case route', (p, d) => `/API/V1/PROJECTS/${p}/SITE-REPORTING/UPLOADS/${d}`, false],
];

describe('progress evidence: file links as a client resolves them (CERT-2, evidence-lines-5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, orgId: 'org-1' });
    mockPrisma.activity.findFirst.mockResolvedValue({ id: 'activity-1', projectId: PROJECT, isActive: true });
    mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(null);
    mockPrisma.projectDocument.findMany.mockImplementation(async ({ where }) => {
      const wanted = new Set([...(where.OR?.[0]?.id?.in || []), ...(where.OR?.[1]?.storageKey?.in || [])]);
      return wanted.has(OWN_DOC) && where.projectId === PROJECT && where.orgId === 'org-1' ? [{ id: OWN_DOC, storageKey: OWN_DOC, uploadedBy: 'uploader-1' }] : [];
    });
    mockPrisma.photo.findMany.mockImplementation(async ({ where }) =>
      where.id.in.includes(OWN_PHOTO) && where.projectId === PROJECT && where.orgId === 'org-1' ? [{ id: OWN_PHOTO }] : [],
    );
    mockPrisma.progressSubmission.create.mockImplementation(async ({ data }) => ({ id: 'submission-1', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...data }));
  });

  describe.each(DOCUMENT_LINKS)('a link with %s', (_label, link, linkFieldOnly) => {
    // Where a client reads it as a link: a photo's url, fileUrl, downloadUrl, a photo that is a link — and, unless
    // a tab or line break breaks it, a link in a note or a caption.
    const shapes = (url) => [
      { photos: [{ url }] },
      { photos: [{ fileUrl: url, fileName: 'a.jpg' }] },
      { photos: [{ downloadUrl: url }] },
      { photos: [url] },
      ...(linkFieldOnly ? [] : [{ notes: `see ${url}` }, { photos: [{ url: 'https://example.test/a.jpg', caption: `at ${url}` }] }]),
    ];

    it('naming this project\'s own document is accepted and stored as written', async () => {
      for (const evidence of shapes(link(PROJECT, OWN_DOC))) {
        await submit(evidence);
        expect(stored()).toEqual(evidence);
      }
    });

    it('naming another company\'s document is refused exactly as one that exists nowhere, nothing written', async () => {
      const answers = [];
      for (const id of [FOREIGN_DOC, NOWHERE_DOC]) {
        for (const evidence of shapes(link(PROJECT, id))) {
          const error = await submit(evidence).catch((thrown) => thrown);
          expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [id] } });
          answers.push(answerOf(error, id));
        }
      }
      expect(new Set(answers).size).toBe(1);
      expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    });

    it('into another project is refused without a lookup, whoever\'s document it names', async () => {
      for (const id of [OWN_DOC, FOREIGN_DOC, NOWHERE_DOC]) {
        for (const evidence of shapes(link(OTHER_PROJECT, id))) {
          const error = await submit(evidence).catch((thrown) => thrown);
          expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
          expect(error.details).toBeUndefined();
        }
      }
      expect(lookups()).toBe(0);
      expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    });
  });

  it('free text is not joined across its line breaks: a note\'s own link followed by a line of text is the own link', async () => {
    for (const evidence of [
      { notes: `/api/v1/projects/${PROJECT}/site-reporting/uploads/${OWN_DOC}\nTaken at 9am` },
      { photos: [{ url: 'https://example.test/a.jpg', caption: `north bay, see /projects/${PROJECT}/photos/${OWN_PHOTO}/file\r\nsecond line` }] },
    ]) {
      await submit(evidence);
      expect(stored()).toEqual(evidence);
    }
  });

  it('a line break that ends a link ends it: the link up to it is checked as well as the joined one', async () => {
    for (const notes of [
      `see /api/v1/projects/${PROJECT}/site-reporting/uploads/${FOREIGN_DOC}\nmore`,
      // Joined, the dot segments climb out of the path; up to the line break, they name the document.
      `see /api/v1/projects/${PROJECT}/site-reporting/./uploads/${FOREIGN_DOC}\n/../../../../../../../x`,
    ]) {
      const error = await submit({ notes }).catch((thrown) => thrown);
      expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
      expect(error.details.missing).toContain(FOREIGN_DOC);
    }
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });

  it('a ".." that climbs into another project is that project\'s link', async () => {
    const error = await submit({ photos: [{ url: `/api/v1/projects/${PROJECT}/../${OTHER_PROJECT}/site-reporting/uploads/${OWN_DOC}` }] }).catch((thrown) => thrown);
    expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
    expect(lookups()).toBe(0);
  });

  it('a photo link with a "./" segment or an escaped photo id names that photo', async () => {
    for (const make of [(id) => `/projects/${PROJECT}/photos/./${id}/file`, (id) => `/api/v1/projects/${PROJECT}/photos/${escaped(id)}/thumbnail`]) {
      await submit({ photos: [make(OWN_PHOTO)] });
      expect(stored()).toEqual({ photos: [make(OWN_PHOTO)] });
      await expect(submit({ photos: [make(FOREIGN_PHOTO)] })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [FOREIGN_PHOTO] } });
    }
    await expect(submit({ photos: [`/projects/${OTHER_PROJECT}/photos/./${OWN_PHOTO}/file`] })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
  });

  it('the bidder portal\'s document link names a document of this project', async () => {
    for (const link of [(d) => `/api/v1/public/bids/${TOKEN}/documents/${d}`, (d) => `https://api.octapm.example/api/v1/public/bids/${TOKEN}/./documents/${d}?download=1`]) {
      await submit({ photos: [{ url: link(OWN_DOC) }] });
      expect(stored()).toEqual({ photos: [{ url: link(OWN_DOC) }] });
      const answers = [];
      for (const id of [FOREIGN_DOC, NOWHERE_DOC]) {
        const error = await submit({ photos: [{ url: link(id) }] }).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [id] } });
        answers.push(answerOf(error, id));
      }
      expect(new Set(answers).size).toBe(1);
    }
  });

  it('a key that decodes to a character no id has is missing, never looked up (no 500)', async () => {
    for (const [written, key] of [['%00', '\u0000'], [`${OWN_DOC.slice(0, 8)}%00${OWN_DOC.slice(8)}`, `${OWN_DOC.slice(0, 8)}\u0000${OWN_DOC.slice(8)}`], ['ab%01cd', 'ab\u0001cd'], ['a%2Fb', 'a/b'], ['a%20b', 'a b']]) {
      for (const evidence of [{ photos: [{ url: `/api/v1/projects/${PROJECT}/site-reporting/uploads/${written}` }] }, { notes: `see /projects/${PROJECT}/workflow/uploads/${written}` }]) {
        const error = await submit(evidence).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [key] } });
      }
    }
    expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
    // Beside a key that can name one, only that key is looked up.
    const error = await submit({ photos: [{ key: OWN_DOC }, { url: `/api/v1/projects/${PROJECT}/site-reporting/uploads/%00` }] }).catch((thrown) => thrown);
    expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: ['\u0000'] } });
    expect(mockPrisma.projectDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ id: { in: [OWN_DOC] } }, { storageKey: { in: [OWN_DOC] } }] }) }));
    // A document field with such a character is missing without a lookup too.
    jest.clearAllMocks();
    await expect(submit({ photos: [{ key: 'x\u0001y' }] })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: ['x\u0001y'] } });
    expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });

  it('stores what is not a file link as written: other products, the product\'s pages, links across lines of a note', async () => {
    const texts = [
      `https://acc.autodesk.com/docs/files/projects/${OTHER_PROJECT}?folderUrn=urn:adsk.wipprod:fs.folder:co.abc&viewModel=detail`,
      `https://app.octapm.example/projects/${OTHER_PROJECT}/rfi/${FOREIGN_DOC}`,
      `https://app.octapm.example/projects/${PROJECT}/./schedule?activity=${FOREIGN_DOC}`,
      `C:\\site\\photos\\north bay.jpg`,
      'measured on site,\nsee the photo log.',
    ];
    for (const text of texts) {
      for (const evidence of [{ photos: [{ url: text }] }, { notes: text }]) {
        await submit(evidence);
        expect(stored()).toEqual(evidence);
      }
    }
    expect(lookups()).toBe(0);
    // A note whose own link is split over lines is checked and accepted.
    const note = { notes: `measured, see\n/api/v1/projects/${PROJECT}/site-reporting/uploads/${OWN_DOC}.` };
    await submit(note);
    expect(stored()).toEqual(note);
  });
});
