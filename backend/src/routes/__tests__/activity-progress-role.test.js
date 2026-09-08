const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-1', orgId: 'org-1', role: req.get('x-role') || 'pm' };
    next();
  },
}));

jest.mock('../../middleware/rbac', () => {
  const actual = jest.requireActual('../../middleware/rbac');
  return { ...actual, requirePermission: () => (_req, _res, next) => next() };
});

const mockActivityService = {
  listActivities: jest.fn(),
  createActivity: jest.fn(),
  getActivityById: jest.fn(),
  updateActivity: jest.fn(),
  deleteActivity: jest.fn(),
  updateProgress: jest.fn(),
  bulkUpdateProgress: jest.fn(),
  getProgressMethod: jest.fn(),
  setProgressMethod: jest.fn(),
  listProgressSubmissions: jest.fn(),
  listActivityProgressSubmissions: jest.fn(),
  approveProgressSubmission: jest.fn(),
  rejectProgressSubmission: jest.fn(),
};

jest.mock('../../services/activity.service', () => mockActivityService);

const activitiesRouter = require('../activities');

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ACTIVITY = '33333333-3333-4333-8333-333333333333';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/projects/:projectId/activities', activitiesRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
    }),
  );
  return app;
};

/**
 * Who the caller is, on the way to the assignment check.
 *
 * `assertProgressSubmitAllowed` lets a PM or planning engineer record progress
 * on an activity they are not personally assigned to, and says so in the
 * refusal it raises. That override reads `userRole` — which this route did not
 * pass, so it arrived undefined and the override could never apply. The same
 * person doing the same thing through bulk-progress, which does pass it, was
 * allowed: two endpoints, one activity, opposite answers.
 */
describe('progress routes carry the caller’s role', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActivityService.updateProgress.mockResolvedValue({ id: 'submission-1' });
    mockActivityService.bulkUpdateProgress.mockResolvedValue({ updated: 1 });
  });

  it('tells the service who is submitting on a single activity', async () => {
    await request(buildApp())
      .post(`/projects/${PROJECT}/activities/${ACTIVITY}/progress`)
      .set('x-role', 'pm')
      .send({ pctComplete: 40, progressMethod: 'percent' })
      .expect(200);

    expect(mockActivityService.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', userRole: 'pm' }),
    );
  });

  it('passes the role it was given, not a default', async () => {
    await request(buildApp())
      .post(`/projects/${PROJECT}/activities/${ACTIVITY}/progress`)
      .set('x-role', 'site_eng')
      .send({ pctComplete: 40, progressMethod: 'percent' })
      .expect(200);

    expect(mockActivityService.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ userRole: 'site_eng' }),
    );
  });

  /**
   * The two routes do the same thing to the same records, so a person allowed
   * to use one must be allowed to use the other. They can only agree if both
   * hand the assignment check the same facts.
   */
  it('sends the same role through the single and bulk routes', async () => {
    const app = buildApp();
    await request(app)
      .post(`/projects/${PROJECT}/activities/${ACTIVITY}/progress`)
      .set('x-role', 'planning_eng')
      .send({ pctComplete: 40, progressMethod: 'percent' })
      .expect(200);
    await request(app)
      .post(`/projects/${PROJECT}/activities/bulk-progress`)
      .set('x-role', 'planning_eng')
      .send({ updates: [{ activityId: ACTIVITY, pctComplete: 40 }] })
      .expect(200);

    const single = mockActivityService.updateProgress.mock.calls[0][0];
    const bulk = mockActivityService.bulkUpdateProgress.mock.calls[0][0];
    expect(single.userRole).toBe(bulk.userRole);
    expect(single.userRole).toBe('planning_eng');
  });
});
