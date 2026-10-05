/**
 * CERT-2 (group evidence-lines-5): the shape of a site record's equipment and
 * material lines, and the photos a site record keeps — daily reports and site
 * diaries alike.
 *
 * A line was read only when it was an object, and only its equipmentId / id /
 * materialId: equipment: ['<id>'], materials: ['<id>'] and
 * equipment: [{ equipment: { id } }] were stored as sent (201), another
 * company's id with them. A line that is not an object and a line value that
 * is a list or an object are now invalid input (400 VALIDATION_ERROR), the own,
 * another company's and a nowhere id alike, before any lookup. An equipment
 * line names its equipmentId, else its id, as the approval reads it, so
 * { equipmentId: <own>, id: 'row-1' } is accepted.
 *
 * A photo was kept only by its url or key, so the UAT runner's
 * { fileName, fileUrl, mimeType, sizeBytes, description } was accepted (201)
 * and dropped unseen. Its fileUrl (or downloadUrl) is now its url, its
 * fileName its filename, its sizeBytes its size, its description kept, and
 * the photo is checked as every photo is.
 */
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  organizationMembership: { findMany: jest.fn(async () => []) },
  dailyReport: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
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
  ENTITY_TYPES: { DAILY_REPORT: 'daily_report', SITE_DIARY: 'site_diary' },
  ACTIONS: { CREATED: 'created', UPDATED: 'updated' },
}));
jest.mock('../equipment.service', () => ({ postDailyReportEquipmentUsage: jest.fn() }));

const dailyReportService = require('../daily-report.service');
const siteDiaryService = require('../site-diary.service');

const PROJECT = '0ce1a7e2-1111-4111-8111-111111111111';
const OWN_EQUIPMENT = '0e900000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_EQUIPMENT = '0e900000-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWN_MATERIAL = '0a700000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_MATERIAL = '0a700000-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOWHERE = '0c0c0000-cccc-4ccc-8ccc-cccccccccccc';
const OWN_DOC = '0d0c0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_DOC = '0d0c0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UPLOADER = '05e40000-5555-4555-8555-555555555555';
const upload = (project, doc) => `/api/v1/projects/${project}/site-reporting/uploads/${doc}`;

const reportRow = (data = {}) => ({
  id: 'report-1', projectId: PROJECT, activityId: 'activity-1', engineerId: 'member-1', date: new Date('2026-01-01T00:00:00.000Z'), status: 'draft', pctProgress: 0,
  photosJson: [], equipmentJson: [], materialsJson: [], progressSubmissions: [], equipmentUsages: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...data,
});
const diaryRow = (data = {}) => ({
  id: 'diary-1', projectId: PROJECT, engineerId: 'member-1', date: new Date('2026-01-01T00:00:00.000Z'), status: 'draft', workers: 0,
  photosJson: [], equipmentJson: [], materialsJson: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...data,
});

// [record, create(payload), update(payload), the model written]
const RECORDS = [
  [
    'daily report',
    (payload) => dailyReportService.createDailyReport({ orgId: 'org-1', projectId: PROJECT, userId: 'member-1', userRole: 'site_engineer', payload: { activityId: 'activity-1', date: '2026-01-01', status: 'draft', ...payload } }),
    (payload) => dailyReportService.updateDailyReport({ orgId: 'org-1', projectId: PROJECT, reportId: 'report-1', userId: 'member-1', payload }),
    () => mockPrisma.dailyReport,
  ],
  [
    'site diary',
    (payload) => siteDiaryService.createSiteDiary({ orgId: 'org-1', projectId: PROJECT, userId: 'member-1', payload: { date: '2026-01-01', status: 'draft', ...payload } }),
    (payload) => siteDiaryService.updateSiteDiary({ orgId: 'org-1', projectId: PROJECT, diaryId: 'diary-1', userId: 'member-1', payload }),
    () => mockPrisma.siteDiary,
  ],
];
// What the record was written with, in the order it was written (create and update alike).
const written = (model) =>
  ['create', 'update']
    .flatMap((method) => model()[method].mock.calls.map((call, i) => [model()[method].mock.invocationCallOrder[i], call[0].data]))
    .sort((a, b) => a[0] - b[0])
    .map(([, data]) => data);
const lookups = () => mockPrisma.equipment.findMany.mock.calls.length + mockPrisma.activityMaterial.findMany.mock.calls.length + mockPrisma.materialMaster.findMany.mock.calls.length;
const answerOf = (error, id) => JSON.stringify([error.status, error.code, error.message, JSON.stringify(error.details ?? null).split(id).join('<sent>')]);

describe.each(RECORDS)('%s lines and photos (CERT-2, evidence-lines-5)', (_record, create, update, model) => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, orgId: 'org-1' });
    mockPrisma.activity.findFirst.mockResolvedValue({ id: 'activity-1', projectId: PROJECT, isActive: true });
    mockPrisma.equipment.findMany.mockImplementation(async ({ where }) => (where.projectId === PROJECT ? where.id.in.filter((id) => id === OWN_EQUIPMENT).map((id) => ({ id })) : []));
    mockPrisma.activityMaterial.findMany.mockImplementation(async ({ where }) => (where.projectId === PROJECT ? where.id.in.filter((id) => id === OWN_MATERIAL).map((id) => ({ id })) : []));
    mockPrisma.projectDocument.findMany.mockImplementation(async ({ where }) => {
      const wanted = new Set([...(where.OR?.[0]?.id?.in || []), ...(where.OR?.[1]?.storageKey?.in || [])]);
      return wanted.has(OWN_DOC) && where.projectId === PROJECT && where.orgId === 'org-1' ? [{ id: OWN_DOC, storageKey: OWN_DOC, uploadedBy: UPLOADER }] : [];
    });
    mockPrisma.dailyReport.create.mockImplementation(async ({ data }) => reportRow(data));
    mockPrisma.dailyReport.findFirst.mockImplementation(async ({ where }) => (where.clientRequestId ? null : reportRow()));
    mockPrisma.dailyReport.update.mockImplementation(async ({ data }) => reportRow(data));
    mockPrisma.siteDiary.create.mockImplementation(async ({ data }) => diaryRow(data));
    mockPrisma.siteDiary.findFirst.mockImplementation(async ({ where }) => (where.clientRequestId ? null : diaryRow()));
    mockPrisma.siteDiary.update.mockImplementation(async ({ data }) => diaryRow(data));
  });

  it.each([
    ['equipment: ["<id>"]', (id) => ({ equipment: [id] }), 'equipment[0]', [OWN_EQUIPMENT, FOREIGN_EQUIPMENT]],
    ['materials: ["<id>"]', (id) => ({ materials: [id] }), 'materials[0]', [OWN_MATERIAL, FOREIGN_MATERIAL]],
    ['equipment: [{ equipment: { id } }]', (id) => ({ equipment: [{ equipment: { id }, hours: 1 }] }), 'equipment[0].equipment', [OWN_EQUIPMENT, FOREIGN_EQUIPMENT]],
    ['materials: [{ material: { id } }]', (id) => ({ materials: [{ material: { id }, qty: 1 }] }), 'materials[0].material', [OWN_MATERIAL, FOREIGN_MATERIAL]],
    ['equipment beside an own line: [{ equipmentId }, [{ id }]]', (id) => ({ equipment: [{ equipmentId: OWN_EQUIPMENT, hours: 1 }, [{ id }]] }), 'equipment[1]', [OWN_EQUIPMENT, FOREIGN_EQUIPMENT]],
    ['a line value that is a list: [{ equipmentId, tags: [id] }]', (id) => ({ equipment: [{ equipmentId: OWN_EQUIPMENT, tags: [id] }] }), 'equipment[0].tags', [OWN_EQUIPMENT, FOREIGN_EQUIPMENT]],
  ])('refuses %s as invalid input — the own, another company\'s and a nowhere id alike — before any lookup, on create and update', async (_label, lines, field, [own, foreign]) => {
    const answers = [];
    for (const id of [own, foreign, NOWHERE]) {
      for (const send of [create, update]) {
        const error = await send(lines(id)).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: [expect.objectContaining({ field, location: 'body' })] });
        answers.push(answerOf(error, id));
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect(lookups()).toBe(0);
    expect(written(model)).toEqual([]);
  });

  it('a null or numeric line is refused as invalid input too', async () => {
    for (const lines of [{ equipment: [null] }, { materials: [12345] }, { equipment: [true] }]) {
      await expect(create(lines)).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    }
    expect(written(model)).toEqual([]);
  });

  it('an equipment line names its equipmentId, else its id — as the approval reads it', async () => {
    // { equipmentId: own, id: 'row-1' } names the own equipment: accepted, stored as sent.
    const equipment = [{ equipmentId: OWN_EQUIPMENT, id: 'row-1', name: 'crane', hours: 2 }, { name: 'site equipment', hours: 1 }];
    await create({ equipment });
    expect(written(model).at(-1).equipmentJson).toEqual(equipment);
    expect(mockPrisma.equipment.findMany).toHaveBeenLastCalledWith({ where: { projectId: PROJECT, id: { in: [OWN_EQUIPMENT] } }, select: { id: true } });
    // Without an equipmentId the id is the equipment, and checked: 'row-1', another company's and a nowhere id are refused alike.
    const answers = [];
    for (const id of ['row-1', FOREIGN_EQUIPMENT, NOWHERE]) {
      for (const lines of [{ equipment: [{ id, hours: 1 }] }, { equipment: [{ equipmentId: '', id, hours: 1 }] }]) {
        const error = await create(lines).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 400, code: 'EQUIPMENT_USAGE_LINK_INVALID', details: { missingEquipmentIds: [id] } });
        answers.push(answerOf(error, id));
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect(written(model)).toHaveLength(1);
  });

  it('the lines the clients send are accepted as sent', async () => {
    const lines = {
      manpower: [{ trade: 'crew', workers: 6, hours: 8 }],
      equipment: [{ equipmentId: OWN_EQUIPMENT, name: 'crane', hours: 3 }, { name: 'Pump', hours: 6 }],
      materials: [{ materialId: OWN_MATERIAL, name: 'cement', qty: 2, unit: 'bag' }, { name: 'Concrete', qty: 35, unit: 'm3' }],
    };
    await create(lines);
    expect(written(model).at(-1)).toEqual(expect.objectContaining({ equipmentJson: lines.equipment, materialsJson: lines.materials }));
  });

  it('keeps the UAT runner\'s photo: its fileUrl is its url, its fileName its filename, its sizeBytes its size, its description kept', async () => {
    const uat = { fileName: 'uat-evidence-r1.jpg', fileUrl: 'https://example.com/uat-evidence.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, description: 'Synthetic UAT evidence reference' };
    for (const send of [create, update]) {
      await send({ photos: [uat] });
      expect(written(model).at(-1).photosJson).toEqual([
        { key: null, url: uat.fileUrl, filename: uat.fileName, originalName: null, mimeType: 'image/jpeg', size: 1024, storage: null, caption: null, takenAt: null, uploadedBy: null, uploadedAt: null, description: uat.description },
      ]);
    }
    // A downloadUrl is the link when there is no url or fileUrl.
    await create({ photos: [{ downloadUrl: 'https://example.com/b.jpg', fileName: 'b.jpg' }] });
    expect(written(model).at(-1).photosJson).toEqual([expect.objectContaining({ url: 'https://example.com/b.jpg', filename: 'b.jpg' })]);
    // The upload answer keeps its own url and key, its uploader read from the document.
    const answer = { documentId: OWN_DOC, key: OWN_DOC, storageKey: OWN_DOC, url: upload(PROJECT, OWN_DOC), fileUrl: upload(PROJECT, OWN_DOC), downloadUrl: upload(PROJECT, OWN_DOC), filename: 'a.png', fileName: 'a.png', mimeType: 'image/png', size: 70, sizeBytes: 70, uploadedBy: 'someone' };
    mockPrisma.projectDocument.findMany.mockImplementationOnce(async () => [{ id: OWN_DOC, storageKey: OWN_DOC }]);
    await create({ photos: [answer] });
    expect(written(model).at(-1).photosJson).toEqual([expect.objectContaining({ key: OWN_DOC, url: upload(PROJECT, OWN_DOC), filename: 'a.png', size: 70, uploadedBy: UPLOADER })]);
  });

  it('checks a photo\'s fileUrl as a link: another company\'s document is refused exactly as one that exists nowhere', async () => {
    const answers = [];
    for (const id of [FOREIGN_DOC, NOWHERE]) {
      for (const field of ['fileUrl', 'downloadUrl']) {
        const error = await create({ photos: [{ [field]: upload(PROJECT, id), fileName: 'x.jpg' }] }).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE', details: { missing: [id] } });
        answers.push(answerOf(error, id));
      }
    }
    expect(new Set(answers).size).toBe(1);
    // A bare id as the link, and a description that is not one value, are invalid input.
    for (const photo of [{ fileUrl: FOREIGN_DOC }, { fileUrl: 'https://example.com/a.jpg', description: { id: FOREIGN_DOC } }, { fileUrl: 'https://example.com/a.jpg', description: FOREIGN_DOC }]) {
      await expect(create({ photos: [photo] })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    }
    expect(written(model)).toEqual([]);
  });
});
