/**
 * CERT-2 (group trivial-7): the doors of five small defects.
 *
 *  1. A daily report's (and a site diary's) equipment line carries the web
 *     progress tab's whole day of equipment hours: 30 or 48 hours were refused
 *     (round 6 bounded a line at 24); a line now takes up to 744 (24 x 31).
 *  2. A line's own rate and rateType were stored unchecked (-500 posted a
 *     negative cost at approval, 1e30 failed the approval for ever): a rate is
 *     one figure 0..MONEY_FIGURE_MAX, a rateType 'hourly' or 'daily', and the
 *     line's own rate x its hours must be a cost the approval can write.
 *  3. A site diary's weatherJson (an alias of weatherDetails) took no figure
 *     checks: [5] was stored as 5, [] as 0, 1e300 as 1e300.
 *  4. A project's currency given as a number, a list, an object or a flag
 *     answered 500 (toUpperCase ran on it after the failed isString): 400.
 *  5. An activity's duration, day offsets, float and lag are at most 36,500
 *     days (they were taken up to INT4_MAX, and the dates worked out from them
 *     walked one day at a time).
 */
const express = require('express');
const request = require('supertest');
const { MONEY_FIGURE_MAX } = require('../../utils/figure-input');
const { SCHEDULE_DAYS_MAX } = require('../../utils/schedule-days');
const { EQUIPMENT_LINE_HOURS_MAX, lineCost } = require('../../utils/site-record-equipment');

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: '11111111-1111-4111-8111-111111111111', orgId: 'org-1', name: 'Tester', role: 'pm', isCompanyAdmin: true };
    next();
  },
}));
jest.mock('../../middleware/subscription-gate', () => ({
  subscriptionGate: (_req, _res, next) => next(),
  enforceProjectLimit: (_req, _res, next) => next(),
}));
jest.mock('../../middleware/project-access', () => ({
  requestForProject: async (req) => req,
  requireProjectAccess: () => (_req, _res, next) => next(),
}));
const mockProjects = {
  createProject: jest.fn(async ({ payload }) => ({ id: 'project-1', ...payload })),
  updateProject: jest.fn(async ({ payload }) => ({ id: 'project-1', ...payload })),
  commercialTermsReadableIds: jest.fn(async () => new Set()),
};
jest.mock('../../services/project.service', () => mockProjects);
jest.mock('../../services/project-setup-readiness.service', () => ({}));
jest.mock('../../services/workspace-dashboard.service', () => ({}));
jest.mock('../../services/task.service', () => ({}));
jest.mock('../../services/exception.service', () => ({}));
jest.mock('../exceptions', () => {
  const router = require('express').Router();
  router.registerSourceRaiseRoutes = () => {};
  return router;
});
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
const mockActivities = {
  createActivity: jest.fn(async () => ({ id: 'activity-1' })),
  updateActivity: jest.fn(async () => ({ id: 'activity-1' })),
};
jest.mock('../../services/activity.service', () => mockActivities);
jest.mock('../../services/progress.service', () => ({}));

const ID = '22222222-2222-4222-8222-222222222222';
const P = '33333333-3333-4333-8333-333333333333';
const ENGINEER = '44444444-4444-4444-8444-444444444444';

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/projects/:projectId/site-diaries', require('../site-diaries'));
  app.use('/projects/:projectId/daily-reports', require('../daily-reports'));
  app.use('/projects/:projectId/activities', require('../activities'));
  app.use('/projects', require('../projects'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message, details: err.details } }));
});
beforeEach(() => jest.clearAllMocks());

const refusedOn = (res, field) => res.status === 400 && res.body?.error?.code === 'VALIDATION_ERROR' && (res.body.error.details || []).some((d) => d.field === field);

describe('equipment lines of a daily report and a site diary (trivial-7 items 1 and 2)', () => {
  const report = (equipment) => request(app).post(`/projects/${P}/daily-reports`).send({ activityId: ID, date: '2026-10-01', pctProgress: 5, equipment });
  const reportPatch = (equipment) => request(app).patch(`/projects/${P}/daily-reports/${ID}`).send({ equipment });
  const diary = (equipment) => request(app).post(`/projects/${P}/site-diaries`).send({ date: '2026-10-01', status: 'draft', equipment });
  const diaryPatch = (equipment) => request(app).patch(`/projects/${P}/site-diaries/${ID}`).send({ equipment });
  const doors = [['POST daily report', report, 201], ['PATCH daily report', reportPatch, 200], ['POST site diary', diary, 201], ['PATCH site diary', diaryPatch, 200]];

  it('a line takes 744 hours, not 745', () => {
    expect(EQUIPMENT_LINE_HOURS_MAX).toBe(744);
  });

  it.each(doors)('%s: the web line of 30 and 48 hours is accepted; 745 is refused on the hours', async (_door, send, ok) => {
    for (const hours of [30, 48, 744]) expect([hours, (await send([{ name: 'site equipment', hours }])).status]).toEqual([hours, ok]);
    expect(refusedOn(await send([{ name: 'site equipment', hours: 745 }]), 'equipment[0].hours')).toBe(true);
  });

  it.each(doors)('%s: a rate below 0, past MONEY_FIGURE_MAX, not a number or not one value is refused on the rate; null is the equipment\'s', async (_door, send, ok) => {
    for (const rate of [-500, -0.01, 1e30, '1e400', 'twelve', [5], { v: 5 }, true]) {
      expect([JSON.stringify(rate), refusedOn(await send([{ equipmentId: ID, name: 'crane', hours: 2, rate }]), 'equipment[0].rate')]).toEqual([JSON.stringify(rate), true]);
    }
    for (const rate of [0, 12, 12.5, '12.50', null, MONEY_FIGURE_MAX]) {
      expect([JSON.stringify(rate), (await send([{ equipmentId: ID, name: 'crane', hours: rate === MONEY_FIGURE_MAX ? 1 : 2, rate }])).status]).toEqual([JSON.stringify(rate), ok]);
    }
  });

  it.each(doors)('%s: a rateType is hourly or daily (or null), one text', async (_door, send, ok) => {
    for (const rateType of ['weekly', 'Hourly', '', ['hourly'], 5]) {
      expect([JSON.stringify(rateType), refusedOn(await send([{ equipmentId: ID, name: 'crane', hours: 2, rate: 10, rateType }]), 'equipment[0].rateType')]).toEqual([JSON.stringify(rateType), true]);
    }
    for (const rateType of ['hourly', 'daily', null]) expect((await send([{ equipmentId: ID, name: 'crane', hours: 2, rate: 10, rateType }])).status).toBe(ok);
  });

  it.each(doors)('%s: the line\'s own rate x its hours must be a cost the approval can write (Decimal(18,2))', async (_door, send, ok) => {
    // 744 h at 1.3e13 is 9.672e15 (fits); at 1.4e13 it is 1.0416e16 (does not) — unless the rate is daily (per 8 h).
    expect((await send([{ name: 'site equipment', hours: 744, rate: 1.3e13 }])).status).toBe(ok);
    expect(refusedOn(await send([{ name: 'site equipment', hours: 744, rate: 1.4e13 }]), 'equipment[0].rate')).toBe(true);
    expect((await send([{ name: 'site equipment', hours: 744, rate: 1.4e13, rateType: 'daily' }])).status).toBe(ok);
    expect(refusedOn(await send([{ name: 'a', hours: 1, rate: 1 }, { name: 'b', hours: 2, rate: MONEY_FIGURE_MAX }]), 'equipment[1].rate')).toBe(true);
    // A rate with no hours to multiply costs nothing here.
    expect((await send([{ name: 'site equipment', rate: MONEY_FIGURE_MAX }])).status).toBe(ok);
  });

  it('lineCost prices a line as the approval does (equipment.service: hourly rate x hours, daily rate x hours / 8)', () => {
    expect(lineCost({ rate: 12, hours: 2, rateType: 'hourly' })).toBe(24);
    expect(lineCost({ rate: 80, hours: 4, rateType: 'daily' })).toBe(40);
    expect(lineCost({ rate: '12.505', hours: 1, rateType: 'hourly' })).toBe(12.51);
  });

  it('what is accepted reaches the service as numbers', async () => {
    await report([{ equipmentId: ID, name: 'crane', hours: '30', rate: '12.50', rateType: 'daily' }]);
    expect(mockDailyReports.createDailyReport.mock.calls[0][0].payload.equipment).toEqual([{ equipmentId: ID, name: 'crane', hours: 30, rate: 12.5, rateType: 'daily' }]);
  });
});

describe('a site diary\'s weatherJson takes the checks weatherDetails takes (trivial-7 item 3)', () => {
  const send = (method, weatherJson) => (method === 'POST'
    ? request(app).post(`/projects/${P}/site-diaries`).send({ date: '2026-10-01', status: 'draft', weatherJson })
    : request(app).patch(`/projects/${P}/site-diaries/${ID}`).send({ weatherJson }));

  it.each(['POST', 'PATCH'])('%s: a temperature or rainfall that is not one value, or out of range, is refused naming the field', async (method) => {
    for (const [field, value] of [['temperatureC', [5]], ['temperatureC', []], ['temperatureC', 1e300], ['temperatureC', 101], ['rainfallMm', 1e300], ['rainfallMm', -1], ['rainfallMm', [1, 1]]]) {
      expect([field, JSON.stringify(value), refusedOn(await send(method, { [field]: value }), `weatherJson.${field}`)]).toEqual([field, JSON.stringify(value), true]);
    }
    expect(refusedOn(await send(method, { delayImpact: 'maybe' }), 'weatherJson.delayImpact')).toBe(true);
    expect(refusedOn(await send(method, ['sunny']), 'weatherJson')).toBe(true);
    const res = await send(method, { summary: 'Clear', temperatureC: '22', rainfallMm: 3, delayImpact: false });
    expect(res.status).toBe(method === 'POST' ? 201 : 200);
    const call = (method === 'POST' ? mockDiaries.createSiteDiary : mockDiaries.updateSiteDiary).mock.calls[0][0];
    expect(call.payload.weatherJson).toEqual({ summary: 'Clear', temperatureC: 22, rainfallMm: 3, delayImpact: false });
  });
});

describe('a project\'s texts are one text before they are sanitized (trivial-7 item 4)', () => {
  const create = (body) => request(app).post('/projects').send({ name: 'Proof', ...body });
  const update = (body) => request(app).patch(`/projects/${ID}`).send(body);

  it.each([['POST', create], ['PATCH', update]])('%s: a currency that is not one text is refused 400 on currency (it was a 500)', async (_method, send) => {
    for (const currency of [5, ['usd'], { a: 1 }, true, 0]) {
      const res = await send({ currency });
      expect([JSON.stringify(currency), res.status, refusedOn(res, 'currency')]).toEqual([JSON.stringify(currency), 400, true]);
    }
  });

  it.each([['POST', create, mockProjects.createProject], ['PATCH', update, mockProjects.updateProject]])('%s: a currency of three letters is taken upper-cased; texts and choices keep their meaning', async (_method, send, service) => {
    const res = await send({ currency: 'usd', type: '  Road ', location: '', contractType: 'epc', projectCalendar: '', clientName: null });
    expect(res.status).toBeLessThan(300);
    expect(service.mock.calls[0][0].payload).toMatchObject({ currency: 'USD', type: 'Road', location: null, contractType: 'epc', projectCalendar: null, clientName: null });
    expect(refusedOn(await send({ currency: 'us' }), 'currency')).toBe(true);
  });

  it.each([['POST', create], ['PATCH', update]])('%s: a text field or a choice given as something else is refused naming it', async (_method, send) => {
    for (const [field, value] of [['type', 5], ['type', ['Road']], ['location', { a: 1 }], ['contractType', ['epc']], ['contractType', 5], ['projectCalendar', true]]) {
      const res = await send({ [field]: value });
      expect([field, JSON.stringify(value), res.status, refusedOn(res, field)]).toEqual([field, JSON.stringify(value), 400, true]);
    }
  });
});

describe('an activity\'s schedule figures are at most 36,500 days (trivial-7 item 5)', () => {
  const create = (body) => request(app).post(`/projects/${P}/activities`).send({ name: 'Proof', engineerIds: [ENGINEER], ...body });
  const update = (body) => request(app).patch(`/projects/${P}/activities/${ID}`).send(body);

  it('the bound is a hundred years of days', () => expect(SCHEDULE_DAYS_MAX).toBe(36_500));

  it.each([['POST', create], ['PATCH', update]])('%s: duration, early and late offsets and float up to 36,500 pass; 36,501 and INT4_MAX are refused naming the field', async (_method, send) => {
    for (const field of ['duration', 'earlyStart', 'earlyFinish', 'lateStart', 'lateFinish', 'totalFloat']) {
      expect([field, (await send({ [field]: 36_500 })).status < 300]).toEqual([field, true]);
      for (const value of [36_501, 1_000_000, 2_147_483_647, -1, [5]]) {
        expect([field, JSON.stringify(value), refusedOn(await send({ [field]: value }), field)]).toEqual([field, JSON.stringify(value), true]);
      }
    }
  });

  it.each([['POST', create], ['PATCH', update]])('%s: a dependency\'s lag is within 36,500 days either way, in the dependencies and in the predecessors text', async (_method, send) => {
    const dep = (lagDays) => ({ dependencies: [{ predecessorId: ID, relationshipType: 'FS', lagDays }] });
    for (const lag of [-36_500, -3, 0, 36_500]) expect([lag, (await send(dep(lag))).status < 300]).toEqual([lag, true]);
    for (const lag of [-36_501, 36_501, 2_147_483_647]) expect([lag, refusedOn(await send(dep(lag)), 'dependencies[0].lagDays')]).toEqual([lag, true]);
    for (const text of ['A1', 'A1 FS+2, A2 SS-1', 'A1 FS+36500', 'A1:FS:-36500']) expect([text, (await send({ predecessors: text })).status < 300]).toEqual([text, true]);
    for (const text of ['A1 FS+36501', 'A1 FS+2, A2 SS-999999999', 'A1:SS:40000']) expect([text, refusedOn(await send({ predecessors: text }), 'predecessors')]).toEqual([text, true]);
    expect(refusedOn(await send({ predecessors: ['A1 FS+2'] }), 'predecessors')).toBe(true);
  });
});
