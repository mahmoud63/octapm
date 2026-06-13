const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 'user-1',
      orgId: 'org-1',
      role: req.get('x-role') || 'pm',
    };
    next();
  },
}));

const mockActivityService = {
  listActivities: jest.fn(),
  createActivity: jest.fn(),
  getActivityById: jest.fn(),
  updateActivity: jest.fn(),
  deleteActivity: jest.fn(),
  updateProgress: jest.fn(),
  bulkUpdateProgress: jest.fn(),
};

const mockProgressService = {
  listProgressSubmissions: jest.fn(),
  getProgressMethod: jest.fn(),
  upsertProgressMethod: jest.fn(),
  approveProgressSubmission: jest.fn(),
  rejectProgressSubmission: jest.fn(),
};

jest.mock('../../services/activity.service', () => mockActivityService);
jest.mock('../../services/progress.service', () => mockProgressService);

const activitiesRouter = require('../activities');

const ids = {
  engineer: '11111111-1111-4111-8111-111111111111',
  predecessor: '22222222-2222-4222-8222-222222222222',
  project: '33333333-3333-4333-8333-333333333333',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/projects/:projectId/activities', activitiesRouter);
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

describe('activity dependency route validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts structured predecessor relationship type and lag/lead input', async () => {
    mockActivityService.createActivity.mockResolvedValue({
      id: 'activity-1',
      name: 'Pour slab',
      dependencies: [
        {
          predecessorId: ids.predecessor,
          relationshipType: 'SS',
          lagDays: -1,
        },
      ],
    });

    const res = await request(buildApp())
      .post(`/projects/${ids.project}/activities`)
      .send({
        name: 'Pour slab',
        activityCode: 'ACT-200',
        duration: 2,
        engineerIds: [ids.engineer],
        dependencies: [
          {
            predecessorId: ids.predecessor,
            relationshipType: 'SS',
            lagDays: -1,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(mockActivityService.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: ids.project,
        payload: expect.objectContaining({
          dependencies: [
            expect.objectContaining({
              predecessorId: ids.predecessor,
              relationshipType: 'SS',
              lagDays: -1,
            }),
          ],
          activityCode: 'ACT-200',
        }),
      }),
    );
  });

  it('rejects unsupported relationship types before persistence', async () => {
    const res = await request(buildApp())
      .post(`/projects/${ids.project}/activities`)
      .send({
        name: 'Pour slab',
        duration: 2,
        engineerIds: [ids.engineer],
        dependencies: [
          {
            predecessorId: ids.predecessor,
            relationshipType: 'XX',
            lagDays: 0,
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
      }),
    );
    expect(mockActivityService.createActivity).not.toHaveBeenCalled();
  });
});
