const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: req.get('x-user-id') || 'actor-1',
      orgId: 'org-1',
      role: req.get('x-role') || 'site_engineer',
    };
    next();
  },
}));

const mockScheduleService = {
  approveRevision: jest.fn(),
  rejectRevision: jest.fn(),
};
const mockDailyReportService = {
  REPORT_STATUSES: ['draft', 'submitted', 'approved', 'rejected'],
  approveDailyReport: jest.fn(),
  rejectDailyReport: jest.fn(),
};
const mockRfiService = {
  approveRfi: jest.fn(),
  rejectRfi: jest.fn(),
};
const mockSubmittalService = {
  approveSubmittal: jest.fn(),
  rejectSubmittal: jest.fn(),
};
const mockAllocationService = {
  approveAllocation: jest.fn(),
  rejectAllocation: jest.fn(),
};

jest.mock('../../services/schedule.service', () => mockScheduleService);
jest.mock('../../services/daily-report.service', () => mockDailyReportService);
jest.mock('../../services/rfi.service', () => mockRfiService);
jest.mock('../../services/submittal.service', () => mockSubmittalService);
jest.mock(
  '../../services/activity-boq-allocation.service',
  () => mockAllocationService,
);

const scheduleRouter = require('../schedule');
const dailyReportsRouter = require('../daily-reports');
const rfiRouter = require('../rfi');
const submittalsRouter = require('../submittals');
const allocationsRouter = require('../activity-boq-allocations');

const ids = {
  project: '11111111-1111-4111-8111-111111111111',
  activity: '22222222-2222-4222-8222-222222222222',
  revision: '33333333-3333-4333-8333-333333333333',
  dailyReport: '44444444-4444-4444-8444-444444444444',
  rfi: '55555555-5555-4555-8555-555555555555',
  submittal: '66666666-6666-4666-8666-666666666666',
  boqItem: '77777777-7777-4777-8777-777777777777',
  allocation: '88888888-8888-4888-8888-888888888888',
};

const fixtures = {
  schedule: {
    id: ids.revision,
    activityId: ids.activity,
    status: 'under_review',
    label: 'Baseline Rev A',
  },
  dailyReport: {
    id: ids.dailyReport,
    activityId: ids.activity,
    status: 'submitted',
    date: '2026-06-12',
    pctProgress: 55,
  },
  rfi: {
    id: ids.rfi,
    activityId: ids.activity,
    status: 'answered',
    subject: 'Confirm embed detail',
  },
  submittal: {
    id: ids.submittal,
    activityId: ids.activity,
    status: 'under_review',
    title: 'Concrete mix design',
  },
  allocation: {
    id: ids.allocation,
    boqItemId: ids.boqItem,
    activityId: ids.activity,
    status: 'submitted',
    quantity: 12,
    amount: 24000,
  },
};

function buildApp({ projectRole } = {}) {
  const app = express();
  app.use(express.json());

  const attachProjectAccess = (req, _res, next) => {
    if (projectRole) {
      req.projectAccess = {
        id: req.params.projectId,
        role: projectRole,
      };
    }
    next();
  };

  app.use('/projects/:projectId/schedule', attachProjectAccess, scheduleRouter);
  app.use(
    '/projects/:projectId/daily-reports',
    attachProjectAccess,
    dailyReportsRouter,
  );
  app.use('/projects/:projectId/rfi', attachProjectAccess, rfiRouter);
  app.use(
    '/projects/:projectId/submittals',
    attachProjectAccess,
    submittalsRouter,
  );
  app.use(
    '/projects/:projectId/activity-boq-allocations',
    attachProjectAccess,
    allocationsRouter,
  );
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message,
        details: err.details,
      },
    }),
  );

  return app;
}

const approvalCases = [
  {
    name: 'schedule revision approve',
    path: `/projects/${ids.project}/schedule/revisions/${ids.revision}/approve`,
    body: { comment: 'CPM review accepted' },
    mock: mockScheduleService.approveRevision,
    response: { ...fixtures.schedule, status: 'approved' },
    expectedArgs: {
      revisionId: ids.revision,
      userRole: 'pm',
      comment: 'CPM review accepted',
    },
  },
  {
    name: 'schedule revision reject',
    path: `/projects/${ids.project}/schedule/revisions/${ids.revision}/reject`,
    body: { reason: 'Missing logic tie' },
    mock: mockScheduleService.rejectRevision,
    response: {
      ...fixtures.schedule,
      status: 'rejected',
      rejectionReason: 'Missing logic tie',
    },
    expectedArgs: {
      revisionId: ids.revision,
      userRole: 'pm',
      reason: 'Missing logic tie',
    },
  },
  {
    name: 'daily report approve',
    path: `/projects/${ids.project}/daily-reports/${ids.dailyReport}/approve`,
    body: {},
    mock: mockDailyReportService.approveDailyReport,
    response: { ...fixtures.dailyReport, status: 'approved' },
    expectedArgs: {
      reportId: ids.dailyReport,
      userRole: 'pm',
    },
  },
  {
    name: 'daily report reject',
    path: `/projects/${ids.project}/daily-reports/${ids.dailyReport}/reject`,
    body: { reason: 'Progress photos do not match reported workface' },
    mock: mockDailyReportService.rejectDailyReport,
    response: {
      ...fixtures.dailyReport,
      status: 'rejected',
      rejectionReason: 'Progress photos do not match reported workface',
    },
    expectedArgs: {
      reportId: ids.dailyReport,
      userRole: 'pm',
      reason: 'Progress photos do not match reported workface',
    },
  },
  {
    name: 'RFI approve',
    path: `/projects/${ids.project}/rfi/${ids.rfi}/approve`,
    body: { comment: 'Response accepted' },
    mock: mockRfiService.approveRfi,
    response: { ...fixtures.rfi, status: 'closed' },
    expectedArgs: {
      rfiId: ids.rfi,
      userRole: 'pm',
      comment: 'Response accepted',
    },
  },
  {
    name: 'RFI disapprove alias',
    path: `/projects/${ids.project}/rfi/${ids.rfi}/disapprove`,
    body: { reason: 'Consultant response is incomplete' },
    mock: mockRfiService.rejectRfi,
    response: {
      ...fixtures.rfi,
      status: 'open',
      rejectionReason: 'Consultant response is incomplete',
    },
    expectedArgs: {
      rfiId: ids.rfi,
      userRole: 'pm',
      reason: 'Consultant response is incomplete',
    },
  },
  {
    name: 'submittal approve',
    path: `/projects/${ids.project}/submittals/${ids.submittal}/approve`,
    body: { comment: 'Approved for construction' },
    mock: mockSubmittalService.approveSubmittal,
    response: { ...fixtures.submittal, status: 'approved' },
    expectedArgs: {
      submittalId: ids.submittal,
      userRole: 'pm',
      comment: 'Approved for construction',
    },
  },
  {
    name: 'submittal disapprove alias',
    path: `/projects/${ids.project}/submittals/${ids.submittal}/disapprove`,
    body: { reason: 'Revise material compliance sheet' },
    mock: mockSubmittalService.rejectSubmittal,
    response: {
      ...fixtures.submittal,
      status: 'rejected',
      rejectionReason: 'Revise material compliance sheet',
    },
    expectedArgs: {
      submittalId: ids.submittal,
      userRole: 'pm',
      reason: 'Revise material compliance sheet',
    },
  },
  {
    name: 'BOQ allocation approve',
    path: `/projects/${ids.project}/activity-boq-allocations/${ids.allocation}/approve`,
    body: {},
    mock: mockAllocationService.approveAllocation,
    response: { ...fixtures.allocation, status: 'approved' },
    expectedArgs: {
      allocationId: ids.allocation,
    },
  },
  {
    name: 'BOQ allocation reject',
    path: `/projects/${ids.project}/activity-boq-allocations/${ids.allocation}/reject`,
    body: { reason: 'Allocation quantity exceeds installed scope' },
    mock: mockAllocationService.rejectAllocation,
    response: {
      ...fixtures.allocation,
      status: 'rejected',
      rejectionReason: 'Allocation quantity exceeds installed scope',
    },
    expectedArgs: {
      allocationId: ids.allocation,
      reason: 'Allocation quantity exceeds installed scope',
    },
  },
];

const pmOnlyCases = approvalCases.filter(
  (approvalCase) => !approvalCase.name.startsWith('BOQ allocation'),
);
const allocationCases = approvalCases.filter((approvalCase) =>
  approvalCase.name.startsWith('BOQ allocation'),
);

describe('project manager approval flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(approvalCases)(
    'allows an org PM to perform $name',
    async ({ path, body, mock, response, expectedArgs }) => {
      mock.mockResolvedValue(response);

      const res = await request(buildApp())
        .post(path)
        .set('x-role', 'pm')
        .set('x-user-id', 'pm-1')
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: response });
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          projectId: ids.project,
          userId: 'pm-1',
          ...expectedArgs,
        }),
      );
    },
  );

  it.each(approvalCases)(
    'rejects a planning engineer attempting $name without PM assignment',
    async ({ path, body, mock, response }) => {
      mock.mockResolvedValue(response);

      const res = await request(buildApp())
        .post(path)
        .set('x-role', 'planning_eng')
        .set('x-user-id', 'planner-1')
        .send(body);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission for this action',
        },
      });
      expect(mock).not.toHaveBeenCalled();
    },
  );

  it.each(approvalCases)(
    'allows a project-assigned PM to perform $name with a non-PM org role',
    async ({ path, body, mock, response, expectedArgs }) => {
      mock.mockResolvedValue(response);

      const res = await request(buildApp({ projectRole: 'Project Manager' }))
        .post(path)
        .set('x-role', 'site_engineer')
        .set('x-user-id', 'assigned-pm-1')
        .send(body);

      expect(res.status).toBe(200);
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          projectId: ids.project,
          userId: 'assigned-pm-1',
          ...expectedArgs,
        }),
      );
    },
  );

  it.each(pmOnlyCases)(
    'blocks a QS project assignment from PM-only $name',
    async ({ path, body, mock, response }) => {
      mock.mockResolvedValue(response);

      const res = await request(buildApp({ projectRole: 'qs' }))
        .post(path)
        .set('x-role', 'site_engineer')
        .set('x-user-id', 'assigned-qs-1')
        .send(body);

      expect(res.status).toBe(403);
      expect(mock).not.toHaveBeenCalled();
    },
  );

  it.each(allocationCases)(
    'allows a QS project assignment to perform $name',
    async ({ path, body, mock, response, expectedArgs }) => {
      mock.mockResolvedValue(response);

      const res = await request(buildApp({ projectRole: 'qs' }))
        .post(path)
        .set('x-role', 'site_engineer')
        .set('x-user-id', 'assigned-qs-1')
        .send(body);

      expect(res.status).toBe(200);
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          projectId: ids.project,
          userId: 'assigned-qs-1',
          ...expectedArgs,
        }),
      );
    },
  );
});
