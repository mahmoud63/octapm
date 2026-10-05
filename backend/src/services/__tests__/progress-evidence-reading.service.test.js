/**
 * CERT-2 (group evidence-6): evidence links are read in time linear in the
 * text, before the transaction, and a link that resolves to a file link is
 * judged by what it resolves to.
 *
 * The fifth round's linkForms parsed every whitespace token of an evidence
 * text as a URL and searched the paths it had kept for each new one: 50,000
 * short tokens in a note took seconds, inside the request's transaction, and
 * the transaction expired (500 P2028). fileKey's /\.+$/ tried every run of
 * dots (a key of 100,000 dots and a letter: 3.5 s). And every key the text
 * held as written was judged: the caller's own file written
 * '…/uploads/x/../<own>' was refused for the key 'x', a link field with a tab
 * or a line break inside the own key for the part before it.
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
const OWN_DOC_2 = '0d0c0000-dddd-4ddd-8ddd-dddddddddddd';
const FOREIGN_DOC = '0d0c0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOWHERE_DOC = '0d0c0000-cccc-4ccc-8ccc-cccccccccccc';
const upload = (p, d) => `/api/v1/projects/${p}/site-reporting/uploads/${d}`;
const cut = (id, at, by) => `${id.slice(0, at)}${by}${id.slice(at)}`;

const submit = (evidence, extra = {}) =>
  progressService.createProgressSubmission({
    orgId: 'org-1',
    projectId: PROJECT,
    activityId: 'activity-1',
    userId: 'pm-1',
    userRole: 'pm',
    payload: { method: 'percent', pctComplete: 40, evidence },
    ...extra,
  });
const stored = () => mockPrisma.progressSubmission.create.mock.calls.at(-1)?.[0]?.data?.evidenceJson;
const answerOf = (error, id) => JSON.stringify([error.status, error.code, error.message, JSON.stringify(error.details ?? null).split(id).join('<sent>')]);
const timed = (fn) => {
  const started = process.hrtime.bigint();
  const value = fn();
  return { value, ms: Number(process.hrtime.bigint() - started) / 1e6 };
};
const fill = (bytes, make) => {
  const parts = [];
  let size = 0;
  for (let i = 0; size < bytes; i += 1) {
    parts.push(make(i));
    size += parts.at(-1).length + 1;
  }
  return parts.join(' ');
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, orgId: 'org-1' });
  mockPrisma.activity.findFirst.mockResolvedValue({ id: 'activity-1', projectId: PROJECT, isActive: true });
  mockPrisma.activityProgressMethod.findFirst.mockResolvedValue(null);
  mockPrisma.projectDocument.findMany.mockImplementation(async ({ where }) => {
    const wanted = new Set([...(where.OR?.[0]?.id?.in || []), ...(where.OR?.[1]?.storageKey?.in || [])]);
    return [OWN_DOC, OWN_DOC_2].filter((id) => wanted.has(id) && where.projectId === PROJECT && where.orgId === 'org-1').map((id) => ({ id, storageKey: id, uploadedBy: 'uploader-1' }));
  });
  mockPrisma.progressSubmission.create.mockImplementation(async ({ data }) => ({ id: 'submission-1', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...data }));
});

describe('evidence is read in time linear in the text (CERT-2, evidence-6)', () => {
  it('a note or a caption of short tokens — 50,000 of them, 2 MB, 8.5 MB — is read in milliseconds (round 5: seconds)', () => {
    for (const text of [Array.from({ length: 50_000 }, (_, i) => `/n${i}`).join(' '), fill(2 * 1024 * 1024, (i) => `/n${i.toString(36)}`), fill(8.5 * 1024 * 1024, (i) => `/n${i.toString(36)}`)]) {
      for (const evidence of [{ notes: text }, { photos: [{ url: 'https://example.test/a.jpg', caption: text }] }, { photos: [{ url: text }] }]) {
        const { value, ms } = timed(() => progressService.scanEvidence({ projectId: PROJECT, evidence }));
        expect(value.error).toBeNull();
        expect(value.shape).toEqual({ keys: [], photoIds: [], revisionIds: [], otherProject: false });
        expect(ms).toBeLessThan(500);
      }
    }
  });

  it('2 MB of distinct file links, each read, is read well under a second', () => {
    const text = fill(2 * 1024 * 1024, (i) => `/api/v1/projects/${PROJECT}/site-reporting/x${i.toString(36)}/../uploads/${OWN_DOC}`);
    const { value, ms } = timed(() => progressService.scanEvidence({ projectId: PROJECT, evidence: { notes: text } }));
    expect(value.shape.keys).toEqual([OWN_DOC]);
    expect(ms).toBeLessThan(1500);
  });

  it('a key of 100,000 dots and a letter is read in milliseconds (/\\.+$/ took 3.5 s) and is missing', async () => {
    const evidence = { photos: [{ url: upload(PROJECT, `${'.'.repeat(100_000)}x`) }] };
    const { value, ms } = timed(() => progressService.scanEvidence({ projectId: PROJECT, evidence }));
    expect(ms).toBeLessThan(200);
    expect(value.shape.keys).toEqual([`${'.'.repeat(100_000)}x`]);
    await expect(submit(evidence)).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
    // A sentence's closing dots are still not the key's.
    expect(progressService.scanEvidence({ projectId: PROJECT, evidence: { notes: `see ${upload(PROJECT, OWN_DOC)}...` } }).shape.keys).toEqual([OWN_DOC]);
  });

  it('a token is a link from whitespace to whitespace, whatever whitespace JavaScript reads (no-break, ideographic, line separator, BOM)', async () => {
    for (const space of [' ', '　', ' ', '﻿', ' ', '\u000b']) {
      await submit({ notes: `see${space}${upload(PROJECT, OWN_DOC)}${space}taken` });
      expect(stored()).toEqual({ notes: `see${space}${upload(PROJECT, OWN_DOC)}${space}taken` });
      await expect(submit({ notes: `see${space}${upload(PROJECT, FOREIGN_DOC)}${space}taken` })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [FOREIGN_DOC] } });
      await expect(submit({ notes: `x${space}${upload(OTHER_PROJECT, OWN_DOC)}` })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
    }
    // A zero-width space is not whitespace: the token runs on, and its link is still read.
    await expect(submit({ notes: `see​${upload(PROJECT, FOREIGN_DOC)}` })).rejects.toMatchObject({ status: 400, details: { missing: [FOREIGN_DOC] } });
  });
});

describe('a link that resolves to a file link is judged by what it resolves to (CERT-2, evidence-6)', () => {
  // [label, link(document) …]: the own file accepted, another company's refused exactly as one that exists nowhere.
  const LINKS = [
    ['"x/../<key>"', (d) => ({ url: `${upload(PROJECT, 'x')}/../${d}` })],
    ['"x/../<key>" in a note', (d) => ({ notes: `see ${upload(PROJECT, 'x')}/../${d}` })],
    ['a tab inside the key of a url', (d) => ({ photos: [{ url: upload(PROJECT, cut(d, 13, '\t')) }] })],
    ['a CRLF inside the key of a fileUrl', (d) => ({ photos: [{ fileUrl: upload(PROJECT, cut(d, 20, '\r\n')), fileName: 'a.jpg' }] })],
    ['a line feed inside the key of a downloadUrl', (d) => ({ photos: [{ downloadUrl: `https://api.octapm.test${upload(PROJECT, cut(d, 3, '\n'))}` }] })],
    ['a photo that is a link, a tab inside its key', (d) => ({ photos: [upload(PROJECT, cut(d, 30, '\t'))] })],
  ];
  const asEvidence = (value) => (value.url ? { photos: [value] } : value);

  it.each(LINKS)('%s naming the own file is accepted and stored as written', async (_label, make) => {
    const evidence = asEvidence(make(OWN_DOC));
    await submit(evidence);
    expect(stored()).toEqual(evidence);
  });

  it.each(LINKS)('%s naming another company\'s file is refused exactly as one naming nowhere, nothing written', async (_label, make) => {
    const answers = [];
    for (const id of [FOREIGN_DOC, NOWHERE_DOC]) {
      const error = await submit(asEvidence(make(id))).catch((thrown) => thrown);
      expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [id] } });
      answers.push(answerOf(error, id));
    }
    expect(new Set(answers).size).toBe(1);
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });

  it('an identifier the text names in a file link counts, though the link resolves past it', async () => {
    // "…/uploads/<id>/../<own>": the own file is fetched, but the id written is checked too.
    for (const id of [FOREIGN_DOC, NOWHERE_DOC]) {
      await expect(submit({ photos: [{ url: `${upload(PROJECT, id)}/../${OWN_DOC}` }] })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [id] } });
    }
    await submit({ photos: [{ url: `${upload(PROJECT, OWN_DOC_2)}/../${OWN_DOC}` }] });
    expect(stored()).toEqual({ photos: [{ url: `${upload(PROJECT, OWN_DOC_2)}/../${OWN_DOC}` }] });
    // A project written there that is not this one: refused without a lookup, whoever's document follows.
    jest.clearAllMocks();
    await expect(submit({ photos: [{ url: `${upload(OTHER_PROJECT, OWN_DOC)}/../../../../${PROJECT}/site-reporting/uploads/${OWN_DOC}` }] })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
    expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
  });

  it('a query or a fragment naming a file is judged with the link it is on', async () => {
    for (const tail of [`?next=${upload(PROJECT, FOREIGN_DOC)}`, `#${upload(PROJECT, FOREIGN_DOC)}`]) {
      await expect(submit({ photos: [{ url: `${upload(PROJECT, OWN_DOC)}${tail}` }] })).rejects.toMatchObject({ status: 400, details: { missing: [FOREIGN_DOC] } });
    }
    await expect(submit({ photos: [{ url: `${upload(PROJECT, OWN_DOC)}?next=${upload(OTHER_PROJECT, OWN_DOC)}` }] })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
    await submit({ photos: [{ url: `${upload(PROJECT, OWN_DOC)}?next=${upload(PROJECT, OWN_DOC_2)}` }] });
    expect(stored()).toEqual({ photos: [{ url: `${upload(PROJECT, OWN_DOC)}?next=${upload(PROJECT, OWN_DOC_2)}` }] });
  });

  it('a link in a note is read without the quotes, brackets and punctuation around it (round 5 refused the own file quoted)', async () => {
    for (const wrap of [(l) => `"${l}"`, (l) => `<${l}>`, (l) => `\u201c${l}\u201d`, (l) => `(${l}).`, (l) => `'${l}',`, (l) => `\u00ab${l}\u00bb`]) {
      const own = { notes: `see ${wrap(`https://api.octapm.example${upload(PROJECT, OWN_DOC)}`)} taken at 9` };
      await submit(own);
      expect(stored()).toEqual(own);
      const answers = [];
      for (const id of [FOREIGN_DOC, NOWHERE_DOC]) {
        const error = await submit({ notes: `see ${wrap(upload(PROJECT, id))}` }).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [id] } });
        answers.push(answerOf(error, id));
      }
      expect(new Set(answers).size).toBe(1);
      await expect(submit({ notes: `see ${wrap(upload(OTHER_PROJECT, OWN_DOC))}` })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
    }
  });

  it('a link that resolves to no file link is judged as written', async () => {
    // "…/uploads/<id>/.." resolves to the uploads folder: the id written is checked.
    await expect(submit({ notes: `${upload(PROJECT, FOREIGN_DOC)}/..` })).rejects.toMatchObject({ status: 400, details: { missing: [FOREIGN_DOC] } });
    // "//projects/<other>/…": the parser reads 'projects' as a host; as written it names another project.
    await expect(submit({ notes: `//projects/${OTHER_PROJECT}/site-reporting/uploads/${OWN_DOC}` })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
  });

  it('text that cannot name a file is stored without a lookup: no route word, or no file word', async () => {
    for (const notes of [`see /api/v1/projectz/${OTHER_PROJECT}/site-reporting/uploads/${FOREIGN_DOC}`, `https://app.octapm.example/projects/${OTHER_PROJECT}/rfi/${FOREIGN_DOC}`, `%70rojects/${OTHER_PROJECT}/site-reporting/uploads/${FOREIGN_DOC}`]) {
      await submit({ notes });
      expect(stored()).toEqual({ notes });
    }
    expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
  });
});

describe('evidence is read before the transaction (CERT-2, evidence-6)', () => {
  it('the reading a caller hands createProgressSubmission for the same evidence is the one used — the text is not read again', async () => {
    const evidence = { notes: 'measured on site' };
    const reading = progressService.scanSubmissionEvidence({ projectId: PROJECT, payload: { evidence } });
    // A reading that says the note names the own document: its keys are looked up, so it was used.
    const handed = { ...reading, shape: { keys: [OWN_DOC], photoIds: [], revisionIds: [], otherProject: false } };
    await submit(evidence, { evidenceScan: handed });
    expect(mockPrisma.projectDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ id: { in: [OWN_DOC] } }, { storageKey: { in: [OWN_DOC] } }] }) }));
    // A reading of other evidence is not used: this note is read again.
    jest.clearAllMocks();
    await submit({ notes: 'other' }, { evidenceScan: handed });
    expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
  });

  it('createProgressSubmission reads the evidence before it opens its transaction', async () => {
    let readInside = false;
    const text = `see ${upload(PROJECT, OWN_DOC)}`;
    mockPrisma.$transaction.mockImplementationOnce(async (fn) => {
      // The reading made before: a note changed now is not read again inside.
      payload.evidence.notes = 'changed inside the transaction';
      const result = await fn(mockPrisma);
      readInside = mockPrisma.projectDocument.findMany.mock.calls.length === 0;
      return result;
    });
    const payload = { method: 'percent', pctComplete: 40, evidence: { notes: text } };
    await progressService.createProgressSubmission({ orgId: 'org-1', projectId: PROJECT, activityId: 'activity-1', userId: 'pm-1', userRole: 'pm', payload });
    expect(readInside).toBe(false);
    expect(mockPrisma.projectDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ id: { in: [OWN_DOC] } }, { storageKey: { in: [OWN_DOC] } }] }) }));
  });

  it('a refusal read before the transaction is answered where it was: a project that is not found still answers 404 first', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);
    await expect(submit({ photos: { not: 'a list' } })).rejects.toMatchObject({ status: 404 });
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, orgId: 'org-1' });
    await expect(submit({ photos: { not: 'a list' } })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
  });
});

/**
 * CERT-2 (availability-7): the sixth round read every token holding
 * 'projects' or 'bids' and a leaf word, and built a URL for each: 8.5 MB of
 * distinct 'projects<i>uploads' tokens held the event loop 2.2 s (HEAD: 8 ms),
 * and 8.5 MB of distinct bidder-portal links named 280,000 keys — a RangeError
 * (500) before the lookup, and past 16,383 keys the lookup's bind variables
 * (500). A link the parser takes as written is now judged as written, without
 * a URL; a token where no file route begins is not read; and evidence naming
 * more than MAX_EVIDENCE_FILES files is refused 400 before any lookup.
 */
describe('evidence names a bounded number of files, read without a URL where none is needed (CERT-2, availability-7)', () => {
  // Counts the URLs built while it is in place (a subclass: a jest spy cannot be called with new).
  const urlsBuilt = () => {
    const NativeURL = global.URL;
    let built = 0;
    global.URL = class CountedURL extends NativeURL {
      constructor(...args) {
        super(...args);
        built += 1;
      }
    };
    return { count: () => built, done: () => { global.URL = NativeURL; } };
  };

  it('8.5 MB of distinct tokens where no file route begins, or that name no file as written, is read in milliseconds and builds no URL', () => {
    for (const [label, make, bound] of [
      ['projects<i>uploads', (i) => `projects${i}uploads`, 200],
      ['projects/<i>uploads', (i) => `projects/${i}uploads`, 600],
      ['/projects/<i>/site-reporting/uploadsX/<i>', (i) => `/projects/${i}/site-reporting/uploadsX/${i}`, 800],
    ]) {
      const text = fill(8.5 * 1024 * 1024, make);
      const urls = urlsBuilt();
      const { value, ms } = timed(() => progressService.scanEvidence({ projectId: PROJECT, evidence: { notes: text } }));
      urls.done();
      expect([label, value.error, value.shape]).toEqual([label, null, { keys: [], photoIds: [], revisionIds: [], otherProject: false }]);
      expect([label, urls.count()]).toEqual([label, 0]);
      expect([label, ms < bound]).toEqual([label, true]);
    }
  });

  it('a link the parser takes as written is judged without a URL, exactly as it resolves — relative, with a query, in a link field', async () => {
    const urls = urlsBuilt();
    const readings = [
      progressService.scanEvidence({ projectId: PROJECT, evidence: { notes: `see ${upload(PROJECT, OWN_DOC)} and api/v1/projects/${PROJECT}/site-reporting/uploads/${OWN_DOC_2}` } }),
      progressService.scanEvidence({ projectId: PROJECT, evidence: { photos: [{ url: `projects/${PROJECT}/attachments/documents/${FOREIGN_DOC}?next=${upload(PROJECT, NOWHERE_DOC)}` }] } }),
    ];
    urls.done();
    expect(urls.count()).toBe(0);
    expect(readings[0].shape.keys).toEqual([OWN_DOC, OWN_DOC_2]);
    expect(readings[1].shape.keys).toEqual([FOREIGN_DOC, NOWHERE_DOC]);
    // A relative link names the file as the parser resolves it: another company's is refused, the own accepted.
    for (const id of [FOREIGN_DOC, NOWHERE_DOC]) {
      await expect(submit({ notes: `projects/${PROJECT}/site-reporting/uploads/${id}` })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [id] } });
    }
    await expect(submit({ notes: `projects/${OTHER_PROJECT}/site-reporting/uploads/${OWN_DOC}` })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
    await submit({ notes: `projects/${PROJECT}/site-reporting/uploads/${OWN_DOC}` });
    expect(stored()).toEqual({ notes: `projects/${PROJECT}/site-reporting/uploads/${OWN_DOC}` });
  });

  it('a link that needs normalising is still parsed: dot segments, an escaped dot, a backslash, a scheme, a host', () => {
    for (const [link, keys] of [
      [`${upload(PROJECT, 'x')}/../${OWN_DOC}`, [OWN_DOC]],
      [`${upload(PROJECT, 'x')}/%2e%2E/${OWN_DOC}`, [OWN_DOC]],
      [`\\api\\v1\\projects\\${PROJECT}\\site-reporting\\uploads\\${OWN_DOC}`, [OWN_DOC]],
      [`https://api.octapm.test${upload(PROJECT, OWN_DOC)}`, [OWN_DOC]],
    ]) {
      const urls = urlsBuilt();
      const reading = progressService.scanEvidence({ projectId: PROJECT, evidence: { photos: [{ url: link }] } });
      urls.done();
      expect([link, reading.shape?.keys, urls.count() > 0]).toEqual([link, keys, true]);
    }
    // "//projects/<other>/…": the parser reads 'projects' as a host; as written it names another project.
    expect(progressService.scanEvidence({ projectId: PROJECT, evidence: { notes: `//projects/${OTHER_PROJECT}/site-reporting/uploads/${OWN_DOC}` } }).shape.otherProject).toBe(true);
  });

  it('the same link written many times is read once', () => {
    const text = fill(8.5 * 1024 * 1024, () => upload(PROJECT, OWN_DOC));
    const { value, ms } = timed(() => progressService.scanEvidence({ projectId: PROJECT, evidence: { notes: text } }));
    expect(value.shape.keys).toEqual([OWN_DOC]);
    expect(ms).toBeLessThan(800);
  });

  it(`more than MAX_EVIDENCE_FILES (${progressService.MAX_EVIDENCE_FILES}) files named is refused 400 VALIDATION_ERROR naming the evidence, before any lookup — 8.5 MB of bidder-portal links in milliseconds`, async () => {
    const many = (count, make) => ({ photos: Array.from({ length: count }, (_, i) => ({ key: make(i) })) });
    const id = (i) => `0d0c0000-eeee-4eee-8eee-${String(i).padStart(12, '0')}`;
    for (const evidence of [many(1001, id), { notes: Array.from({ length: 1001 }, (_, i) => upload(PROJECT, id(i))).join(' ') }, { photos: [{ url: 'https://x.test/a.jpg', caption: fill(8.5 * 1024 * 1024, (i) => `/public/bids/t${i}/documents/d${i}`) }] }]) {
      jest.clearAllMocks();
      const started = Date.now();
      const error = await submit(evidence).catch((thrown) => thrown);
      expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: [{ field: 'evidence', message: `Evidence names more than ${progressService.MAX_EVIDENCE_FILES} files`, location: 'body' }] });
      expect(Date.now() - started).toBeLessThan(1000);
      expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.progressSubmission.create).not.toHaveBeenCalled();
    }
    // At the cap: one lookup of every key, each counted once however often named.
    jest.clearAllMocks();
    const atCap = { photos: [...many(1000, id).photos, ...many(1000, id).photos] };
    await expect(submit(atCap)).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
    expect(mockPrisma.projectDocument.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.projectDocument.findMany.mock.calls[0][0].where.OR[0].id.in).toHaveLength(1000);
    // The own file, named 5,000 times: accepted.
    await submit({ photos: Array.from({ length: 5000 }, () => ({ key: OWN_DOC })) });
    expect(stored().photos).toHaveLength(5000);
  });
});
