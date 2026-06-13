const express = require('express');
const request = require('supertest');
const { HttpError } = require('../../utils/http-error');

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

const mockAllocationService = {
  listAllocations: jest.fn(),
  createAllocation: jest.fn(),
  updateAllocation: jest.fn(),
  submitAllocation: jest.fn(),
  approveAllocation: jest.fn(),
  rejectAllocation: jest.fn(),
};

jest.mock(
  '../../services/activity-boq-allocation.service',
  () => mockAllocationService,
);

const allocationRouter = require('../activity-boq-allocations');

const ids = {
  project: '11111111-1111-4111-8111-111111111111',
  boqItem: '22222222-2222-4222-8222-222222222222',
  activity: '33333333-3333-4333-8333-333333333333',
};

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/projects/:projectId/activity-boq-allocations',
    allocationRouter,
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
};

describe('activity BOQ allocation routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a structured duplicate error for active BOQ/activity pairs', async () => {
    mockAllocationService.createAllocation.mockRejectedValue(
      new HttpError(
        400,
        'DUPLICATE_ACTIVE_ALLOCATION',
        'An active allocation already exists for this BOQ item and activity',
      ),
    );

    const res = await request(buildApp())
      .post(`/projects/${ids.project}/activity-boq-allocations`)
      .send({
        boqItemId: ids.boqItem,
        activityId: ids.activity,
        quantity: 1,
        amount: 100,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: 'DUPLICATE_ACTIVE_ALLOCATION',
      },
    });
    expect(mockAllocationService.createAllocation).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: ids.project,
      userId: 'user-1',
      payload: expect.objectContaining({
        boqItemId: ids.boqItem,
        activityId: ids.activity,
        quantity: 1,
        amount: 100,
      }),
    });
  });
});
