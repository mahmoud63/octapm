/**
 * CERT-2 (group people-evidence-3): identifier fields of daily reports and
 * timesheets take one text. express-validator's isUUID() checks an array
 * element by element, so engineerId ["<id>"] reached the daily report's create
 * (500), crewId ["<id>"] the crew lookup (500), and a repeated query filter
 * (?status=a&status=b) Prisma as a list (500). Each is now a 400
 * VALIDATION_ERROR naming the field, before the service is called — the same
 * answer whoever's id it wraps; the id as one text passes. A daily report's
 * photo is an object or a link (a list in its place was dropped unseen), and
 * its uploader one text.
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

const mockDailyReports = {
  REPORT_STATUSES: ['draft', 'submitted', 'approved', 'rejected'],
  listDailyReports: jest.fn(async () => []),
  createDailyReport: jest.fn(async () => ({ id: 'report-1' })),
  updateDailyReport: jest.fn(async () => ({ id: 'report-1' })),
};
jest.mock('../../services/daily-report.service', () => mockDailyReports);
const mockTimesheets = {
  TIME_TYPES: ['regular', 'overtime', 'double'],
  STATUS: { DRAFT: 'draft', SUBMITTED: 'submitted', APPROVED: 'approved', REJECTED: 'rejected' },
  listTimesheets: jest.fn(async () => ({ items: [] })),
  createTimesheet: jest.fn(async () => ({ id: 'sheet-1' })),
};
jest.mock('../../services/timesheet.service', () => mockTimesheets);

const ID = '22222222-2222-4222-8222-222222222222';
const P = '33333333-3333-4333-8333-333333333333';
const R = '44444444-4444-4444-8444-444444444444';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/projects/:projectId/daily-reports', require('../daily-reports'));
  app.use('/projects/:projectId/timesheets', require('../timesheets'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message, details: err.details } }));
  return app;
};
const fieldsNamed = (res) => (res.body?.error?.code === 'VALIDATION_ERROR' ? (res.body.error.details || []).map((d) => d.field) : []);

describe('daily report and timesheet identifiers take one text (CERT-2 shapes)', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });
  beforeEach(() => jest.clearAllMocks());

  // [name, method, url, body(value), field]
  test.each([
    ['POST daily-reports engineerId', 'post', `/projects/${P}/daily-reports`, (v) => ({ activityId: ID, date: '2026-10-01', engineerId: v }), 'engineerId'],
    ['PATCH daily-reports/:id engineerId', 'patch', `/projects/${P}/daily-reports/${R}`, (v) => ({ engineerId: v }), 'engineerId'],
    ['POST daily-reports photos[].uploadedBy', 'post', `/projects/${P}/daily-reports`, (v) => ({ activityId: ID, date: '2026-10-01', photos: [{ url: 'https://example.test/a.jpg', uploadedBy: v }] }), 'photos[0].uploadedBy'],
    ['POST timesheets crewId', 'post', `/projects/${P}/timesheets`, (v) => ({ date: '2026-10-01', crewId: v }), 'crewId'],
  ])('%s: a list in place of the id is refused before the service, the id itself passes', async (_name, method, url, body, field) => {
    for (const shaped of [[ID], [[ID]], { id: ID }]) {
      const res = await request(app)[method](url).send(body(shaped));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(fieldsNamed(res)).toContain(field);
    }
    expect(mockDailyReports.createDailyReport).not.toHaveBeenCalled();
    expect(mockDailyReports.updateDailyReport).not.toHaveBeenCalled();
    expect(mockTimesheets.createTimesheet).not.toHaveBeenCalled();
    const plain = await request(app)[method](url).send(body(ID));
    expect(fieldsNamed(plain)).not.toContain(field);
  });

  it('a daily report photo is an object or a link: a list or a number in its place is refused', async () => {
    for (const photo of [[{ key: ID }], 12345, null]) {
      const res = await request(app).post(`/projects/${P}/daily-reports`).send({ activityId: ID, date: '2026-10-01', photos: [photo] });
      expect(res.status).toBe(400);
      expect(fieldsNamed(res)).toContain('photos[0]');
    }
    expect(mockDailyReports.createDailyReport).not.toHaveBeenCalled();
    const ok = await request(app).post(`/projects/${P}/daily-reports`).send({ activityId: ID, date: '2026-10-01', photos: ['https://example.test/a.jpg', { key: ID, uploadedBy: null }] });
    expect(ok.status).toBe(201);
  });

  it.each([
    ['daily-reports ?activityId twice', `/projects/${P}/daily-reports?activityId=${ID}&activityId=${R}`, 'activityId'],
    ['daily-reports ?status twice', `/projects/${P}/daily-reports?status=draft&status=submitted`, 'status'],
    ['daily-reports ?date twice', `/projects/${P}/daily-reports?date=2026-10-01&date=2026-10-02`, 'date'],
    ['timesheets ?crewId twice', `/projects/${P}/timesheets?crewId=${ID}&crewId=${R}`, 'crewId'],
    ['timesheets ?status twice', `/projects/${P}/timesheets?status=draft&status=approved`, 'status'],
    ['timesheets ?from twice', `/projects/${P}/timesheets?from=2026-10-01&from=2026-10-02`, 'from'],
  ])('%s: a repeated filter is refused before the service; one value passes', async (_name, url, field) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(400);
    expect(fieldsNamed(res)).toContain(field);
    expect(mockDailyReports.listDailyReports).not.toHaveBeenCalled();
    expect(mockTimesheets.listTimesheets).not.toHaveBeenCalled();
    const single = await request(app).get(url.split('&')[0]);
    expect(single.status).toBe(200);
  });
});
