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

const mockRfiService = {
  listRfis: jest.fn(),
  createRfi: jest.fn(),
  updateRfi: jest.fn(),
  deleteRfi: jest.fn(),
};
const mockSubmittalService = {
  listSubmittals: jest.fn(),
  createSubmittal: jest.fn(),
  updateSubmittal: jest.fn(),
  deleteSubmittal: jest.fn(),
};
const mockCostService = {
  getCostRecords: jest.fn(),
  getCostSummary: jest.fn(),
  getBurnRate: jest.fn(),
  addBurnRateEntry: jest.fn(),
  upsertCostRecord: jest.fn(),
  updateCostRecord: jest.fn(),
};

jest.mock('../../services/rfi.service', () => mockRfiService);
jest.mock('../../services/submittal.service', () => mockSubmittalService);
jest.mock('../../services/cost.service', () => mockCostService);

const rfiRouter = require('../rfi');
const submittalRouter = require('../submittals');
const costRouter = require('../cost');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/projects/:projectId/rfi', rfiRouter);
  app.use('/projects/:projectId/submittals', submittalRouter);
  app.use('/projects/:projectId/cost', costRouter);
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

describe('list API query contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRfiService.listRfis.mockResolvedValue({
      rows: [],
      summary: {},
      pagination: { limit: 25, nextCursor: null },
    });
    mockSubmittalService.listSubmittals.mockResolvedValue({
      rows: [],
      summary: {},
      pagination: { limit: 25, nextCursor: null },
    });
    mockCostService.getCostRecords.mockResolvedValue({
      rows: [],
      pagination: { limit: 25, nextCursor: null },
    });
  });

  it('validates and forwards RFI list pagination, filtering, sorting, and search', async () => {
    const res = await request(buildApp())
      .get('/projects/project-1/rfi')
      .query({
        limit: 10,
        cursor: '00000000-0000-4000-8000-000000000001',
        status: 'open',
        priority: 'urgent',
        search: 'pump',
        sortBy: 'dueDate',
        sortDir: 'asc',
      });

    expect(res.status).toBe(200);
    expect(mockRfiService.listRfis).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'project-1',
      query: expect.objectContaining({
        limit: 10,
        cursor: '00000000-0000-4000-8000-000000000001',
        status: 'open',
        priority: 'urgent',
        search: 'pump',
        sortBy: 'dueDate',
        sortDir: 'asc',
      }),
      projectAccess: undefined,
      viewerId: 'user-1',
    });
  });

  it('rejects invalid RFI list limits before hitting the service', async () => {
    const res = await request(buildApp())
      .get('/projects/project-1/rfi')
      .query({ limit: 101 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockRfiService.listRfis).not.toHaveBeenCalled();
  });

  it('validates and forwards submittal list filters and sort order', async () => {
    const res = await request(buildApp())
      .get('/projects/project-1/submittals')
      .query({
        limit: 20,
        status: 'under_review',
        search: 'concrete',
        sortBy: 'submittedOn',
        sortDir: 'desc',
      });

    expect(res.status).toBe(200);
    expect(mockSubmittalService.listSubmittals).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'project-1',
      query: expect.objectContaining({
        limit: 20,
        status: 'under_review',
        search: 'concrete',
        sortBy: 'submittedOn',
        sortDir: 'desc',
      }),
    });
  });

  it('validates and forwards cost list search, filters, and sorting', async () => {
    const res = await request(buildApp())
      .get('/projects/project-1/cost')
      .query({
        limit: 25,
        category: 'Structure',
        search: 'steel',
        sortBy: 'actual',
        sortDir: 'desc',
      });

    expect(res.status).toBe(200);
    expect(mockCostService.getCostRecords).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'project-1',
      query: expect.objectContaining({
        limit: 25,
        category: 'Structure',
        search: 'steel',
        sortBy: 'actual',
        sortDir: 'desc',
      }),
    });
  });

  it('rejects unsupported cost sort fields before hitting the service', async () => {
    const res = await request(buildApp())
      .get('/projects/project-1/cost')
      .query({ sortBy: 'passwordHash' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockCostService.getCostRecords).not.toHaveBeenCalled();
  });
});
