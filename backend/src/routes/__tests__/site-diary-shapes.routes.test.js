/**
 * CERT-2 (group evidence-4): the shapes a site diary's photos and a site
 * record's equipment lines take at the route.
 *
 * A diary's photo is an object or a link, as a daily report's is (a list in
 * its place was dropped unseen), and its uploader one text; a line's .id —
 * read as its equipment by the daily report's approval — is one text, on both
 * records. Each other shape is a 400 VALIDATION_ERROR naming the field before
 * the service runs; the shapes the clients send pass.
 *
 * The routers are mounted with their services stubbed: only the routes' own
 * validation runs.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: '11111111-1111-4111-8111-111111111111', orgId: 'org-1', name: 'Tester', role: 'pm', isCompanyAdmin: true };
    next();
  },
}));

const mockDiaries = {
  DIARY_STATUSES: ['draft', 'submitted', 'approved', 'rejected'],
  createSiteDiary: jest.fn(async () => ({ id: 'diary-1' })),
  updateSiteDiary: jest.fn(async () => ({ id: 'diary-1' })),
};
jest.mock('../../services/site-diary.service', () => mockDiaries);
const mockDailyReports = {
  REPORT_STATUSES: ['draft', 'submitted', 'approved', 'rejected'],
  createDailyReport: jest.fn(async () => ({ id: 'report-1' })),
  updateDailyReport: jest.fn(async () => ({ id: 'report-1' })),
};
jest.mock('../../services/daily-report.service', () => mockDailyReports);

const ID = '22222222-2222-4222-8222-222222222222';
const P = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/projects/:projectId/site-diaries', require('../site-diaries'));
  app.use('/projects/:projectId/daily-reports', require('../daily-reports'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message, details: err.details } }));
  return app;
};
const fieldsNamed = (res) => (res.body?.error?.code === 'VALIDATION_ERROR' ? (res.body.error.details || []).map((d) => d.field) : []);

describe('site diary photos and site record lines take their shapes (CERT-2, evidence-4)', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['POST', 'post', `/projects/${P}/site-diaries`, { date: '2026-10-01' }],
    ['PATCH', 'patch', `/projects/${P}/site-diaries/${D}`, {}],
  ])('%s site-diaries: a photo that is a list, a number or null is refused before the service', async (_name, method, url, base) => {
    for (const photo of [[{ key: ID }], 12345, null]) {
      const res = await request(app)[method](url).send({ ...base, photos: [photo] });
      expect(res.status).toBe(400);
      expect(fieldsNamed(res)).toContain('photos[0]');
    }
    for (const uploadedBy of [[ID], { id: ID }]) {
      const res = await request(app)[method](url).send({ ...base, photos: [{ key: ID, uploadedBy }] });
      expect(res.status).toBe(400);
      expect(fieldsNamed(res)).toContain('photos[0].uploadedBy');
    }
    expect(mockDiaries.createSiteDiary).not.toHaveBeenCalled();
    expect(mockDiaries.updateSiteDiary).not.toHaveBeenCalled();
  });

  it('a site diary as the web client sends it passes: the upload answer as photos, picked equipment, typed materials', async () => {
    const upload = { documentId: ID, key: ID, storageKey: ID, url: `/api/v1/projects/${P}/site-reporting/uploads/${ID}`, fileUrl: `/api/v1/projects/${P}/site-reporting/uploads/${ID}`, downloadUrl: `/api/v1/projects/${P}/site-reporting/uploads/${ID}`, filename: 'a.png', fileName: 'a.png', originalName: 'IMG_1.png', mimeType: 'image/png', size: 70, sizeBytes: 70, storage: 'local', scanStatus: 'clean', retentionExpiresAt: null, uploadedBy: ID, uploadedAt: '2026-10-01T08:00:00.000Z' };
    const res = await request(app).post(`/projects/${P}/site-diaries`).send({
      date: '2026-10-01',
      shift: 'day',
      weather: 'Clear',
      weatherDetails: { summary: 'Clear' },
      workers: 12,
      visitors: '',
      workDone: 'Slab',
      issues: '',
      issueItems: [],
      instructions: '',
      manpower: [{ trade: 'crew', workers: 4, hours: 8 }],
      equipment: [{ equipmentId: ID, name: 'crane', hours: 2 }, { name: 'site equipment', hours: 1 }],
      materials: [{ name: 'material', qty: 2, unit: 'unit' }],
      photos: [upload, 'https://acc.autodesk.com/docs/files/projects/x'],
      notes: '',
      status: 'draft',
      clientRequestId: 'diary-1',
      clientCreatedAt: '2026-10-01T08:00:00.000Z',
      deviceId: 'web',
    });
    expect(res.status).toBe(201);
    expect(mockDiaries.createSiteDiary).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['site-diaries', `/projects/${P}/site-diaries`, { date: '2026-10-01' }, () => mockDiaries.createSiteDiary],
    ['daily-reports', `/projects/${P}/daily-reports`, { activityId: ID, date: '2026-10-01' }, () => mockDailyReports.createDailyReport],
  ])('POST %s: an equipment line\'s .id is one text', async (_name, url, base, service) => {
    for (const id of [[ID], { id: ID }, 12345]) {
      const res = await request(app).post(url).send({ ...base, equipment: [{ id, hours: 1 }] });
      expect(res.status).toBe(400);
      expect(fieldsNamed(res)).toContain('equipment[0].id');
    }
    expect(service()).not.toHaveBeenCalled();
    const ok = await request(app).post(url).send({ ...base, equipment: [{ id: ID, hours: 1 }] });
    expect(ok.status).toBe(201);
  });
});
