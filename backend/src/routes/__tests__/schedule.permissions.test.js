const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 'user-1',
      orgId: 'org-1',
      role: req.get('x-role') || 'site_engineer',
    };
    next();
  },
}));

const mockScheduleService = {
  getProjectSchedule: jest.fn(),
  listRevisions: jest.fn(),
  getRevision: jest.fn(),
  getScheduleReadiness: jest.fn(),
  submitRevisionForReview: jest.fn(),
  approveRevision: jest.fn(),
  rejectRevision: jest.fn(),
  lockBaseline: jest.fn(),
  startGenerateJob: jest.fn(),
  getJob: jest.fn(),
  getResourcePlan: jest.fn(),
};

jest.mock('../../services/schedule.service', () => mockScheduleService);

const scheduleRouter = require('../schedule');

const revisionId = '11111111-1111-4111-8111-111111111111';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/projects/:projectId/schedule', scheduleRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message,
      },
    }),
  );
  return app;
}

describe('schedule lifecycle route permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows planning engineers to submit a revision for review', async () => {
    mockScheduleService.submitRevisionForReview.mockResolvedValue({
      id: revisionId,
      status: 'under_review',
    });

    const res = await request(buildApp())
      .post(`/projects/project-1/schedule/revisions/${revisionId}/submit-review`)
      .set('x-role', 'planning_eng')
      .send({ comment: 'Ready' });

    expect(res.status).toBe(200);
    expect(mockScheduleService.submitRevisionForReview).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId,
        userId: 'user-1',
      }),
    );
  });

  it('blocks planning engineers from approving a revision', async () => {
    const res = await request(buildApp())
      .post(`/projects/project-1/schedule/revisions/${revisionId}/approve`)
      .set('x-role', 'planning_eng')
      .send({ comment: 'Approved' });

    expect(res.status).toBe(403);
    expect(mockScheduleService.approveRevision).not.toHaveBeenCalled();
  });

  it('allows PMs to approve a revision', async () => {
    mockScheduleService.approveRevision.mockResolvedValue({
      id: revisionId,
      status: 'approved',
    });

    const res = await request(buildApp())
      .post(`/projects/project-1/schedule/revisions/${revisionId}/approve`)
      .set('x-role', 'pm')
      .send({ comment: 'Approved' });

    expect(res.status).toBe(200);
    expect(mockScheduleService.approveRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        revisionId,
        userId: 'user-1',
      }),
    );
  });

  it('blocks planning engineers from baseline lock', async () => {
    const res = await request(buildApp())
      .post(`/projects/project-1/schedule/revisions/${revisionId}/baseline`)
      .set('x-role', 'planning_eng')
      .send({ comment: 'Baseline' });

    expect(res.status).toBe(403);
    expect(mockScheduleService.lockBaseline).not.toHaveBeenCalled();
  });
});
