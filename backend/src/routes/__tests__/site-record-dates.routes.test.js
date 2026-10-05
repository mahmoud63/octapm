/**
 * CERT-2 (group evidence-lines-5): every date a daily report, a site diary or
 * a meeting takes in its body is one text a Date reads.
 *
 * isISO8601 alone checked a list element by element and a number by its
 * digits, so ["2026-10-01"] and 20261001 were stored (201); and it passes the
 * compact, week and ordinal forms ('20261001', '2026-W40', '2026-275') that
 * new Date() cannot read — a photo's takenAt and uploadedAt were stored in
 * them, the other dates refused only by the service. Every body date chain of
 * the three routers (create and update alike: 12 daily-report chains, 8 site
 * diary chains, 14 meeting chains) and their date filters now check with the
 * shared helper (utils/date-input), refuse each of them on its own field, and
 * pass what the clients send.
 *
 * And a site record's photo fields the service now reads (the UAT runner's
 * fileName, fileUrl, sizeBytes, description; the upload answer's downloadUrl)
 * each take one value of their type at the route.
 */
const express = require('express');
const request = require('supertest');
const validatorLib = require('validator');
const { dateInput } = require('../../utils/date-input');

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

// Body date chains (create and update) and query date filters of each router.
const ROUTERS = { 'daily-reports.js': { body: 12, query: 3 }, 'site-diaries.js': { body: 8, query: 3 }, 'meetings.js': { body: 14, query: 0 } };
const ID = '22222222-2222-4222-8222-222222222222';
const P = '33333333-3333-4333-8333-333333333333';

const bodyOf = (field, value) => {
  const parts = field.split('.');
  const root = {};
  let node = root;
  parts.forEach((part, i) => {
    const next = i === parts.length - 1 ? value : parts[i + 1] === '*' ? [] : {};
    if (part === '*') node.push(next);
    else node[part] = next;
    node = next;
  });
  return root;
};
const errorPath = (field) => field.replace(/\.\*/g, '[0]');

// A date chain: one that checks a date, with the shared helper (utils/date-input) or isISO8601 —
// so a chain that goes back to isISO8601 alone is found here, and fails.
const isDateCheck = (item) => item.validator === dateInput || item.validator === validatorLib.isISO8601;
const cases = [];
for (const [file, expected] of Object.entries(ROUTERS)) {
  const router = require(`../${file}`);
  const found = { body: [], query: [] };
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const route = `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`;
    for (const sub of layer.route.stack) {
      const context = sub.handle?.builder?.build();
      if (!context?.stack.some(isDateCheck)) continue;
      for (const location of ['body', 'query']) {
        if (!context.locations.includes(location)) continue;
        for (const field of context.fields) found[location].push([`${file} ${route} ${location} ${field}`, sub.handle, field, location]);
      }
    }
  }
  cases.push({ file, expected, found });
}
const allChains = cases.flatMap((c) => [...c.found.body, ...c.found.query]);

const refusedOn = async (chain, field, location, value) => {
  const req = location === 'body' ? { body: bodyOf(field, JSON.parse(JSON.stringify(value))) } : { query: { [field]: value } };
  const result = await chain.run(req);
  return result.array().some((error) => error.path === errorPath(field));
};

describe('site record and meeting dates are one readable text (CERT-2, evidence-lines-5)', () => {
  it.each(Object.entries(ROUTERS))('%s has its body date chains and query date filters', (file, expected) => {
    const found = cases.find((c) => c.file === file).found;
    expect({ body: found.body.length, query: found.query.length }).toEqual(expected);
  });

  test.each(allChains)('%s', async (_key, chain, field, location) => {
    const refused = location === 'body'
      ? [['2026-10-01'], [['2026-10-01']], 20261001, '20261001', '2026-W40', '2026-275', '20261001T080000Z', true, { date: '2026-10-01' }]
      : [['2026-10-01', '2026-10-02'], '20261001', '2026-W40', '2026-275'];
    for (const value of refused) {
      expect([JSON.stringify(value), await refusedOn(chain, field, location, value)]).toEqual([JSON.stringify(value), true]);
    }
    for (const value of ['2026-10-01', '2026-02-18T15:05:00.000Z', '2026-10-01T08:00:00+04:00']) {
      expect([value, await refusedOn(chain, field, location, value)]).toEqual([value, false]);
    }
  });
});

describe('a site record photo\'s link, name, size and description fields take one value (CERT-2, evidence-lines-5)', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/projects/:projectId/site-diaries', require('../site-diaries'));
    app.use('/projects/:projectId/daily-reports', require('../daily-reports'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message, details: err.details } }));
  });
  beforeEach(() => jest.clearAllMocks());
  const fieldsNamed = (res) => (res.body?.error?.code === 'VALIDATION_ERROR' ? (res.body.error.details || []).map((d) => d.field) : []);

  it.each([
    ['site-diaries', `/projects/${P}/site-diaries`, { date: '2026-10-01' }, () => mockDiaries.createSiteDiary],
    ['daily-reports', `/projects/${P}/daily-reports`, { activityId: ID, date: '2026-10-01' }, () => mockDailyReports.createDailyReport],
  ])('POST %s', async (_name, url, base, service) => {
    for (const [field, value] of [['fileUrl', [ID]], ['fileUrl', { url: ID }], ['downloadUrl', 12345], ['fileName', ['a.jpg']], ['sizeBytes', 'many'], ['sizeBytes', -1], ['description', { id: ID }], ['description', [ID]]]) {
      const res = await request(app).post(url).send({ ...base, photos: [{ fileUrl: 'https://example.com/a.jpg', [field]: value }] });
      expect([field, JSON.stringify(value), res.status]).toEqual([field, JSON.stringify(value), 400]);
      expect(fieldsNamed(res)).toContain(`photos[0].${field}`);
    }
    expect(service()).not.toHaveBeenCalled();
    // The UAT runner's photo and the upload answer pass, and reach the service as sent.
    const uat = { fileName: 'uat-evidence-r1.jpg', fileUrl: 'https://example.com/uat-evidence.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, description: 'Synthetic UAT evidence reference' };
    const answer = { documentId: ID, key: ID, storageKey: ID, url: `/api/v1/projects/${P}/site-reporting/uploads/${ID}`, fileUrl: `/api/v1/projects/${P}/site-reporting/uploads/${ID}`, downloadUrl: `/api/v1/projects/${P}/site-reporting/uploads/${ID}`, filename: 'a.png', fileName: 'a.png', originalName: 'IMG_1.png', mimeType: 'image/png', size: 70, sizeBytes: 70, storage: 'local', scanStatus: 'clean', retentionExpiresAt: null, uploadedBy: ID, uploadedAt: '2026-10-01T08:00:00.000Z' };
    const ok = await request(app).post(url).send({ ...base, clientCreatedAt: '2026-02-15T08:00:00.000Z', photos: [uat, answer] });
    expect(ok.status).toBe(201);
    expect(service().mock.calls[0][0].payload.photos).toEqual([uat, answer]);
  });
});
