const express = require('express');
const request = require('supertest');

const mockCreateManualBoqItem = jest.fn();
const mockCreateActivity = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-1', orgId: 'org-1', role: 'pm' };
    next();
  },
}));

jest.mock('../../middleware/rbac', () => {
  const actual = jest.requireActual('../../middleware/rbac');
  return {
    ...actual,
    requireRoles: () => (_req, _res, next) => next(),
    requirePermission: () => (_req, _res, next) => next(),
  };
});

jest.mock('../../services/boq.service', () => ({
  generateBoqTemplate: jest.fn(),
  processBoqUpload: jest.fn(),
  getBoqJob: jest.fn(),
  getProjectBoq: jest.fn(),
  findShadowActivities: jest.fn(),
  updateBoqItem: jest.fn(),
  createManualBoqItem: mockCreateManualBoqItem,
  deleteBoqItem: jest.fn(),
  createActivity: mockCreateActivity,
  updateActivity: jest.fn(),
  deleteActivity: jest.fn(),
  runBoqActivityJob: jest.fn(),
}));

const boqRouter = require('../boq');

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ACTIVITY = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/projects/:projectId/boq', boqRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
    }),
  );
  return app;
};

const row = {
  code: '5.1',
  description: 'Concrete, grade 40',
  quantity: 100,
  unit: 'm3',
  rate: 300,
};

/**
 * Which activity a bill row belongs to (OCTA-BOQ-ACTIVITY-078).
 *
 * A row used to be forced to describe a new activity, so a project that already
 * had a programme grew a second one: zero-duration stubs holding the money
 * beside the real activities holding the logic. A row can now name an activity
 * that exists instead — by id, never by name, because names are not identifiers
 * and guessing is how the shadow schedule got built in the first place.
 */
describe('a BOQ row says which activity it belongs to', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateManualBoqItem.mockResolvedValue({ item: { id: ITEM }, financial: {} });
    mockCreateActivity.mockResolvedValue({ id: 'allocation-1' });
  });

  it('passes an existing activity through as a relationship', async () => {
    await request(buildApp())
      .post(`/projects/${PROJECT}/boq/items`)
      .send({ ...row, activityId: ACTIVITY })
      .expect(201);

    expect(mockCreateManualBoqItem).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ activityId: ACTIVITY }),
      expect.anything(),
    );
  });

  it('still accepts a name, for a project with no programme yet', async () => {
    await request(buildApp())
      .post(`/projects/${PROJECT}/boq/items`)
      .send({ ...row, activityName: 'Blockwork' })
      .expect(201);

    expect(mockCreateManualBoqItem).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ activityName: 'Blockwork' }),
      expect.anything(),
    );
  });

  it('accepts a row with no activity at all, to be split across several later', async () => {
    await request(buildApp())
      .post(`/projects/${PROJECT}/boq/items`)
      .send(row)
      .expect(201);
  });

  /**
   * Both together would leave it ambiguous which the caller meant, and the
   * wrong guess is the whole defect: a new activity minted beside the one they
   * had already chosen.
   */
  it('refuses a row that names an activity and describes a new one at once', async () => {
    const response = await request(buildApp())
      .post(`/projects/${PROJECT}/boq/items`)
      .send({ ...row, activityId: ACTIVITY, activityName: 'Blockwork' })
      .expect(400);

    expect(response.body.error.message).toMatch(/either/i);
    expect(mockCreateManualBoqItem).not.toHaveBeenCalled();
  });

  it('refuses an activityId that is not an id', async () => {
    await request(buildApp())
      .post(`/projects/${PROJECT}/boq/items`)
      .send({ ...row, activityId: 'Blockwork' })
      .expect(400);

    expect(mockCreateManualBoqItem).not.toHaveBeenCalled();
  });

  it('still requires the row itself to be complete', async () => {
    await request(buildApp())
      .post(`/projects/${PROJECT}/boq/items`)
      .send({ code: '5.1', activityId: ACTIVITY })
      .expect(400);
  });
});

describe('splitting one bill item across the programme', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateActivity.mockResolvedValue({ id: 'allocation-1' });
  });

  const share = { unit: 'm3', quantity: 400, rate: 300 };

  it('allocates a share to an activity that already exists', async () => {
    await request(buildApp())
      .post(`/projects/${PROJECT}/boq/items/${ITEM}/activities`)
      .send({ ...share, activityId: ACTIVITY })
      .expect(201);

    expect(mockCreateActivity).toHaveBeenCalledWith(
      PROJECT,
      ITEM,
      expect.objectContaining({ activityId: ACTIVITY }),
      expect.anything(),
    );
  });

  it('refuses a share that names neither an activity nor a new one', async () => {
    await request(buildApp())
      .post(`/projects/${PROJECT}/boq/items/${ITEM}/activities`)
      .send(share)
      .expect(400);

    expect(mockCreateActivity).not.toHaveBeenCalled();
  });

  it('refuses both at once here too', async () => {
    await request(buildApp())
      .post(`/projects/${PROJECT}/boq/items/${ITEM}/activities`)
      .send({ ...share, activityId: ACTIVITY, activityName: 'Blockwork' })
      .expect(400);

    expect(mockCreateActivity).not.toHaveBeenCalled();
  });
});
