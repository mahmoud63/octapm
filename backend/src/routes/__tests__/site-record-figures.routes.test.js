/**
 * CERT-2 (group evidence-6): every figure a daily report, a site diary or a
 * meeting takes in its body is one value, and what is accepted can be
 * approved.
 *
 * isFloat and isInt check a list element by element and an empty list not at
 * all, so 44 figure chains of the three routers took [1,1], [5] and [] — the
 * services read them as 0, 5 and 0 and stored them (201). Each chain now
 * checks the figure is one value first (utils/figure-input scalarFigure, with
 * bail), on create and update alike. A manpower line's hours are a worker's
 * day (0-24, as a timesheet's are). An equipment line of 1e300 hours was
 * stored and its approval refused for ever (the cost overflows the ledger);
 * a line carries the web progress tab's whole day of equipment hours, so it
 * is bounded at 744 (24 x 31), not a day, and its own rate is 0 to
 * MONEY_FIGURE_MAX (CERT-2 trivial-7: the day's bound refused that form at 30
 * and 48 hours; a rate of -500 or 1e30 was stored). A site diary's
 * workers fit their INT4 column ('99999999999999999999' answered 500), and a
 * daily report's progress quantities fit what an approval records
 * (QUANTITY_MAX).
 */
const express = require('express');
const request = require('supertest');
const validatorLib = require('validator');
const { scalarFigure } = require('../../utils/figure-input');

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

const NUMERIC_CHECKS = new Set([validatorLib.isFloat, validatorLib.isInt, validatorLib.isNumeric, validatorLib.isDecimal]);
const NUMERIC_SANITIZERS = new Set([validatorLib.toInt, validatorLib.toFloat]);
// The figure chains each router's own payloads hold (create and update), moneyBody's among them.
// trivial-7 added equipment.*.rate to both (2 each) and the diary's weatherJson
// temperatureC and rainfallMm (4).
const ROUTERS = { 'daily-reports.js': 28, 'site-diaries.js': 24, 'meetings.js': 2 };
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
const refusedOn = async (chain, field, value) => (await chain.run({ body: bodyOf(field, JSON.parse(JSON.stringify(value))) })).array().some((error) => error.path === errorPath(field));

const chains = [];
const counted = {};
for (const file of Object.keys(ROUTERS)) {
  const router = require(`../${file}`);
  counted[file] = 0;
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const route = `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`;
    for (const sub of layer.route.stack) {
      const context = sub.handle?.builder?.build();
      if (!context || !context.locations.includes('body')) continue;
      if (!context.stack.some((item) => NUMERIC_CHECKS.has(item.validator) || NUMERIC_SANITIZERS.has(item.sanitizer))) continue;
      for (const field of context.fields) {
        counted[file] += 1;
        chains.push([`${file} ${route} ${field}`, sub.handle, field, context.stack]);
      }
    }
  }
}

describe('site record and meeting figures are one value (CERT-2, evidence-6)', () => {
  it.each(Object.entries(ROUTERS))('%s has its figure chains', (file, expected) => {
    expect(counted[file]).toBe(expected);
  });

  test.each(chains)('%s: a list is refused before the numeric check; one value passes', async (_key, chain, field, stack) => {
    const guard = stack.findIndex((item) => item.validator === scalarFigure);
    const numeric = stack.findIndex((item) => NUMERIC_CHECKS.has(item.validator) || NUMERIC_SANITIZERS.has(item.sanitizer));
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(numeric);
    for (const value of [[1, 1], [5], [], [[5]], { value: 5 }, true]) {
      expect([JSON.stringify(value), await refusedOn(chain, field, value)]).toEqual([JSON.stringify(value), true]);
    }
    for (const value of [1, '1', 0]) {
      expect([JSON.stringify(value), await refusedOn(chain, field, value)]).toEqual([JSON.stringify(value), false]);
    }
  });

  const chainOf = (file, method, field) => chains.find(([key]) => key.startsWith(`${file} ${method} `) && key.endsWith(` ${field}`));
  it.each([
    // trivial-7: one line is the web progress tab's whole day of equipment hours (30, 48 answered 400).
    ['daily-reports.js', 'equipment.*.hours', [0, 8, 24, '24', 24.5, 30, 48, 744], [744.5, 745, 1e15, 1e300, -1]],
    ['daily-reports.js', 'manpower.*.hours', [0, 8, 24], [24.5, 1e300, -1]],
    ['site-diaries.js', 'equipment.*.hours', [0, 8, 24, 30, 48, 744], [744.5, 1e300]],
    ['daily-reports.js', 'equipment.*.rate', [0, 12, 12.5, '12.50', 9999999999999998], [-500, -0.01, 1e30, '1e400', 1e17]],
    ['site-diaries.js', 'equipment.*.rate', [0, 12, '12.50', 9999999999999998], [-500, 1e30, '1e400']],
    ['site-diaries.js', 'weatherJson.temperatureC', [-100, 0, 45], [101, 1e308, '1e400']],
    ['site-diaries.js', 'weatherJson.rainfallMm', [0, 10000], [10001, -1, 1e300]],
    ['site-diaries.js', 'manpower.*.hours', [0, 8, 24], [24.5, 1e300]],
    ['site-diaries.js', 'workers', [0, 12, 2147483647], [2147483648, 3000000000, '99999999999999999999', -1, 1.5]],
    ['daily-reports.js', 'progress.quantityComplete', [0, 35, 99999999999], [100000000000, 1e300, -1]],
    ['daily-reports.js', 'progress.quantityPlanned', [0, 35, 99999999999], [100000000000, 1e300]],
    ['meetings.js', 'agendaItems.*.sortOrder', [0, 1, 10000], [10001, -1, 1.5]],
    // Every figure is finite and bounded, as on every other route (robustness-6's rules).
    ['daily-reports.js', 'weather.temperatureC', [-100, -12.5, 0, 22, 100], [100.5, -101, 1e20, '1e400']],
    ['site-diaries.js', 'weatherDetails.temperatureC', [-100, 0, 45], [101, 1e308]],
    ['daily-reports.js', 'weather.rainfallMm', [0, 12.5, 10000], [10000.5, -1, 1e20]],
    ['site-diaries.js', 'weatherDetails.rainfallMm', [0, 10000], [10001, 1e20]],
    ['daily-reports.js', 'materials.*.qty', [0, 35, 99999999999], [100000000000, 1e300]],
    ['site-diaries.js', 'materials.*.qty', [0, 35, 99999999999], [100000000000, 1e300]],
    ['daily-reports.js', 'manpower.*.workers', [0, 8, 2147483647], [2147483648, '99999999999999999999']],
    ['site-diaries.js', 'manpower.*.workers', [0, 8, 2147483647], [2147483648, '99999999999999999999']],
    ['daily-reports.js', 'photos.*.size', [0, 1024, 2147483647], [2147483648]],
    ['daily-reports.js', 'photos.*.sizeBytes', [0, 1024, 2147483647], [2147483648]],
    ['site-diaries.js', 'photos.*.size', [0, 1024, 2147483647], [2147483648]],
    ['site-diaries.js', 'photos.*.sizeBytes', [0, 1024, 2147483647], [2147483648]],
  ])('%s %s: within its range is accepted, beyond it refused (create and update)', async (file, field, accepted, refused) => {
    for (const method of ['POST', 'PATCH']) {
      const [, chain] = chainOf(file, method, field);
      for (const value of accepted) expect([method, value, await refusedOn(chain, field, value)]).toEqual([method, value, false]);
      for (const value of refused) expect([method, value, await refusedOn(chain, field, value)]).toEqual([method, value, true]);
    }
  });
});

describe('a meeting\'s addresses are one address (CERT-2, evidence-6)', () => {
  const router = require('../meetings.js');
  const emailChains = router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => layer.route.stack.map((sub) => [`${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`, sub.handle, sub.handle?.builder?.build()]))
    .filter(([, , context]) => context && context.fields.some((field) => /email/i.test(field)))
    .flatMap(([route, handle, context]) => context.fields.map((field) => [`${route} ${field}`, handle, field]));

  it('the attendee, action item owner and distribution recipient addresses of create, update and distribute are all checked', () => {
    expect(emailChains.map(([key]) => key).sort()).toEqual([
      'PATCH /:id actionItems.*.ownerEmail', 'PATCH /:id attendees.*.email',
      'POST / actionItems.*.ownerEmail', 'POST / attendees.*.email',
      'POST /:id/distribute recipients.*.email',
    ]);
  });

  test.each(emailChains)('%s: a list of addresses is refused (it was stored as "a,b"); one address passes', async (_key, chain, field) => {
    for (const value of [['a@example.test'], ['a@example.test', 'b@example.test'], { email: 'a@example.test' }, 5]) {
      expect([JSON.stringify(value), await refusedOn(chain, field, value)]).toEqual([JSON.stringify(value), true]);
    }
    for (const value of ['a@example.test', '', null]) {
      expect([JSON.stringify(value), await refusedOn(chain, field, value)]).toEqual([JSON.stringify(value), false]);
    }
  });
});

describe('what the clients send passes the three routers (CERT-2, evidence-6)', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/projects/:projectId/site-diaries', require('../site-diaries'));
    app.use('/projects/:projectId/daily-reports', require('../daily-reports'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message, details: err.details } }));
  });
  beforeEach(() => jest.clearAllMocks());

  it('the UAT runner\'s daily report (e2e/uat/run-uat-regression.mjs) and the web form\'s report and diary', async () => {
    const uat = await request(app).post(`/projects/${P}/daily-reports`).send({
      activityId: ID, date: '2026-02-15', shift: 'day', pctProgress: 80,
      weather: { summary: 'Clear', condition: 'clear', temperatureC: 22, delayImpact: false },
      manpower: [{ trade: 'Concrete', workers: 8, hours: 8 }], materials: [{ name: 'Concrete', qty: 35, unit: 'm3' }], equipment: [{ name: 'Pump', hours: 6 }],
      issues: [{ title: 'Access coordination', severity: 'low', status: 'closed' }],
      photos: [{ fileName: 'uat-evidence-r1.jpg', fileUrl: 'https://example.com/uat-evidence.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, description: 'Synthetic UAT evidence reference' }],
      notes: 'UAT daily report.', clientRequestId: 'uat-r1', clientCreatedAt: '2026-02-15T08:00:00.000Z', deviceId: 'uat-tablet-01', status: 'submitted',
    });
    expect(uat.status).toBe(201);
    expect(mockDailyReports.createDailyReport.mock.calls[0][0].payload).toMatchObject({ pctProgress: 80, manpower: [{ workers: 8, hours: 8 }], equipment: [{ hours: 6 }] });
    // site-reporting-dashboard.tsx: Number(...) of what was typed; an empty field is 0.
    const web = await request(app).post(`/projects/${P}/daily-reports`).send({
      activityId: ID, date: '2026-10-01', shift: 'day', pctProgress: 0, weather: { summary: 'Clear' },
      manpower: [{ trade: 'crew', workers: 6, hours: 8 }], equipment: [{ equipmentId: ID, name: 'crane', hours: 0 }], materials: [{ name: 'material', qty: 2, unit: 'unit' }],
      issues: [], photos: [], notes: 'web', status: 'submitted', progress: { method: 'percent', pctComplete: 10, evidence: { photos: [] } },
    });
    expect(web.status).toBe(201);
    const diary = await request(app).post(`/projects/${P}/site-diaries`).send({
      date: '2026-10-01', shift: 'day', weather: 'Clear', weatherDetails: { summary: 'Clear' }, workers: 0, visitors: '', workDone: 'slab', issues: '', issueItems: [], instructions: '',
      manpower: [{ trade: 'crew', workers: 4, hours: 8 }], equipment: [{ equipmentId: ID, name: 'crane', hours: 2 }], materials: [{ name: 'material', qty: 2, unit: 'unit' }], photos: [], notes: 'web diary', status: 'submitted',
    });
    expect(diary.status).toBe(201);
  });

  // frontend progress-tab.tsx createDailyReport: the day's equipment hours as one line, no client maximum (CERT-2 trivial-7).
  it.each([30, 48, 744])('the web progress tab\'s daily report with %s equipment hours on its one line passes', async (hours) => {
    const res = await request(app).post(`/projects/${P}/daily-reports`).send({
      activityId: ID, date: '2026-10-01', pctProgress: 5, manpower: [{ trade: 'crew', workers: 4, hours: 8 }],
      equipment: [{ name: 'site equipment', hours }], materials: [], photos: [], notes: 'web',
    });
    expect(res.status).toBe(201);
    expect(mockDailyReports.createDailyReport.mock.calls[0][0].payload.equipment).toEqual([{ name: 'site equipment', hours }]);
  });
});
