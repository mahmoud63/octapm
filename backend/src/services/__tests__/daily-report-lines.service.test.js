/**
 * CERT-2 (group evidence-4): what a daily report's lines name, and what an
 * edit re-checks.
 *
 * equipment[].equipmentId and materials[].materialId were stored in
 * equipmentJson / materialsJson as given on create and update — another
 * company's equipment or material, or one that exists nowhere — and served
 * back; equipment was checked only at approval, materials never. Each is now
 * this project's (equipment; an activity's material or the project's material
 * list), on create and when an update sends the lines: another company's and
 * a nowhere id get the approval's 400, before anything is written.
 *
 * An update re-checked the stored photos even when it sent none, so a report
 * whose photo had since changed (a site photo later cited by a change order is
 * no longer `available`) could not be edited at all. Only what the request
 * sends is checked now; what it leaves alone stays as stored.
 */
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  organizationMembership: { findMany: jest.fn(async () => []) },
  dailyReport: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  projectDocument: { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 0 })) },
  equipment: { findMany: jest.fn() },
  activityMaterial: { findMany: jest.fn() },
  materialMaster: { findMany: jest.fn() },
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
const OWN_EQUIPMENT = '0e900000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_EQUIPMENT = '0e900000-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWN_MATERIAL = '0a700000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LISTED_MATERIAL = '0a700000-dddd-4ddd-8ddd-dddddddddddd';
const FOREIGN_MATERIAL = '0a700000-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOWHERE = '0c0c0000-cccc-4ccc-8ccc-cccccccccccc';
const LINKED_DOC = '0d0c0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACC = `https://acc.autodesk.com/docs/files/projects/${NOWHERE}?folderUrn=urn:adsk.wipprod:fs.folder:co.abc`;

const STORED_PHOTOS = [
  { key: LINKED_DOC, url: null, filename: 'bay.png', originalName: null, mimeType: null, size: null, storage: null, caption: null, takenAt: null, uploadedBy: 'uploader-1', uploadedAt: null },
  { url: ACC },
];
const row = (data = {}) => ({
  id: 'report-1',
  projectId: PROJECT,
  activityId: 'activity-1',
  engineerId: 'member-1',
  date: new Date('2026-01-01T00:00:00.000Z'),
  status: 'draft',
  pctProgress: 0,
  photosJson: STORED_PHOTOS,
  equipmentJson: [{ equipmentId: OWN_EQUIPMENT, name: 'crane', hours: 2 }],
  materialsJson: [{ materialId: OWN_MATERIAL, name: 'cement', qty: 2, unit: 'bag' }],
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
    userId: 'member-1',
    userRole: 'site_engineer',
    payload: { activityId: 'activity-1', date: '2026-01-01', status: 'draft', ...payload },
  });
const update = (payload) =>
  dailyReportService.updateDailyReport({ orgId: 'org-1', projectId: PROJECT, reportId: 'report-1', userId: 'member-1', payload });
const sentWithout = (error, id) => JSON.stringify([error.status, error.code, error.message, JSON.stringify(error.details).split(id).join('<sent>')]);

describe('daily report lines and edits (CERT-2, evidence-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, orgId: 'org-1' });
    mockPrisma.activity.findFirst.mockResolvedValue({ id: 'activity-1', projectId: PROJECT, isActive: true });
    mockPrisma.equipment.findMany.mockImplementation(async ({ where }) => (where.projectId === PROJECT ? where.id.in.filter((id) => id === OWN_EQUIPMENT).map((id) => ({ id })) : []));
    mockPrisma.activityMaterial.findMany.mockImplementation(async ({ where }) => (where.projectId === PROJECT ? where.id.in.filter((id) => id === OWN_MATERIAL).map((id) => ({ id })) : []));
    mockPrisma.materialMaster.findMany.mockImplementation(async ({ where }) => (where.projectId === PROJECT ? where.id.in.filter((id) => id === LISTED_MATERIAL).map((id) => ({ id })) : []));
    // The stored site photo has since been cited by a change order: it is no longer `available`.
    mockPrisma.projectDocument.findMany.mockResolvedValue([]);
    mockPrisma.dailyReport.create.mockImplementation(async ({ data }) => row(data));
    mockPrisma.dailyReport.findFirst.mockImplementation(async ({ where }) => (where.clientRequestId ? null : row()));
    mockPrisma.dailyReport.update.mockImplementation(async ({ data }) => row(data));
  });

  it('stores lines naming this project\'s equipment and materials, and lines naming none, as sent', async () => {
    const equipment = [{ equipmentId: OWN_EQUIPMENT, name: 'crane', hours: 3 }, { id: OWN_EQUIPMENT, hours: 1 }, { name: 'site equipment', hours: 2 }];
    const materials = [{ materialId: OWN_MATERIAL, name: 'cement', qty: 4, unit: 'bag' }, { materialId: LISTED_MATERIAL, qty: 1 }, { name: 'Concrete', qty: 35, unit: 'm3' }];
    await create({ equipment, materials });
    expect(mockPrisma.dailyReport.create).toHaveBeenCalledWith({ data: expect.objectContaining({ equipmentJson: equipment, materialsJson: materials }) });
    expect(mockPrisma.equipment.findMany).toHaveBeenCalledWith({ where: { projectId: PROJECT, id: { in: [OWN_EQUIPMENT] } }, select: { id: true } });
  });

  it.each([
    ['equipment[].equipmentId', (id) => ({ equipment: [{ equipmentId: id, name: 'x', hours: 2 }] }), FOREIGN_EQUIPMENT, 'EQUIPMENT_USAGE_LINK_INVALID', 'Daily report equipment usage must reference project equipment'],
    ['equipment[].id (read by the approval too)', (id) => ({ equipment: [{ id, hours: 2 }] }), FOREIGN_EQUIPMENT, 'EQUIPMENT_USAGE_LINK_INVALID', 'Daily report equipment usage must reference project equipment'],
    ['equipment beside an own line', (id) => ({ equipment: [{ equipmentId: OWN_EQUIPMENT, hours: 1 }, { equipmentId: id, hours: 0 }] }), FOREIGN_EQUIPMENT, 'EQUIPMENT_USAGE_LINK_INVALID', 'Daily report equipment usage must reference project equipment'],
    ['materials[].materialId', (id) => ({ materials: [{ materialId: id, name: 'm', qty: 1 }] }), FOREIGN_MATERIAL, 'MATERIAL_LINK_INVALID', 'Daily report materials must reference materials of this project'],
  ])('refuses %s naming another company\'s record exactly as one that exists nowhere, on create and update, before anything is written', async (_label, lines, foreign, code, message) => {
    const answers = [];
    for (const id of [foreign, NOWHERE]) {
      for (const send of [create, update]) {
        const error = await send(lines(id)).catch((thrown) => thrown);
        expect(error).toMatchObject({ status: 400, code, message });
        answers.push(sentWithout(error, id));
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect(mockPrisma.dailyReport.create).not.toHaveBeenCalled();
    expect(mockPrisma.dailyReport.update).not.toHaveBeenCalled();
  });

  it('refuses a line reference that is not one text, whoever it wraps', async () => {
    for (const lines of [{ equipment: [{ equipmentId: [OWN_EQUIPMENT], hours: 1 }] }, { equipment: [{ id: { id: OWN_EQUIPMENT } }] }, { materials: [{ materialId: 12345 }] }]) {
      await expect(create(lines)).rejects.toMatchObject({ status: 400 });
    }
    expect(mockPrisma.dailyReport.create).not.toHaveBeenCalled();
  });

  it('an update that sends no lines leaves the stored ones unchecked; one that sends them has them checked', async () => {
    mockPrisma.dailyReport.findFirst.mockImplementation(async () => row({ equipmentJson: [{ equipmentId: NOWHERE, hours: 1 }], materialsJson: [{ materialId: NOWHERE }] }));
    await update({ notes: 'kept' });
    expect(mockPrisma.equipment.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.activityMaterial.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.dailyReport.update).toHaveBeenCalledTimes(1);
    await expect(update({ equipment: [{ equipmentId: FOREIGN_EQUIPMENT, hours: 1 }] })).rejects.toMatchObject({ code: 'EQUIPMENT_USAGE_LINK_INVALID' });
    await update({ materials: [{ materialId: OWN_MATERIAL }] });
    expect(mockPrisma.dailyReport.update).toHaveBeenCalledTimes(2);
  });

  it('an update that sends no photos edits a report whose stored photo no longer passes, and keeps the photos as stored', async () => {
    await update({ notes: 'edited without photos' });
    expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.dailyReport.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ notes: 'edited without photos', photosJson: STORED_PHOTOS }) }));
  });

  it('an update that sends photos has them checked', async () => {
    await expect(update({ photos: [{ key: LINKED_DOC }] })).rejects.toMatchObject({ status: 400, code: 'INVALID_SITE_PHOTO_REFERENCE' });
    await expect(update({ photos: [{ url: NOWHERE }] })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(mockPrisma.dailyReport.update).not.toHaveBeenCalled();
    await update({ photos: [{ url: ACC }] });
    expect(mockPrisma.dailyReport.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ photosJson: [expect.objectContaining({ url: ACC, key: null })] }) }));
  });
});
