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

const mockAuditService = {
  listEvents: jest.fn(),
};

jest.mock('../../services/audit.service', () => mockAuditService);

const auditRouter = require('../audit');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/projects/:projectId/audit', auditRouter);
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

describe('audit route permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditService.listEvents.mockResolvedValue({
      events: [],
      nextCursor: null,
    });
  });

  it('allows project roles to read tenant-scoped audit history with filters', async () => {
    const res = await request(buildApp())
      .get('/projects/project-1/audit')
      .query({
        entityType: 'schedule_revision',
        entityId: 'revision-1',
        limit: 10,
        order: 'asc',
      })
      .set('x-role', 'site_engineer');

    expect(res.status).toBe(200);
    expect(mockAuditService.listEvents).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'project-1',
      entityType: 'schedule_revision',
      entityId: 'revision-1',
      action: null,
      cursor: null,
      limit: 10,
      order: 'asc',
    });
  });

  it('blocks roles outside the audit read policy', async () => {
    const res = await request(buildApp())
      .get('/projects/project-1/audit')
      .set('x-role', 'external_viewer');

    expect(res.status).toBe(403);
    expect(mockAuditService.listEvents).not.toHaveBeenCalled();
  });
});
