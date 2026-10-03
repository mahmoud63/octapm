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
        source: 'approval',
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
      source: 'approval',
      cursor: null,
      limit: 10,
      order: 'asc',
      viewer: expect.objectContaining({ userId: 'user-1', partyIds: null, companyIds: null }),
    });
  });

  it("hands the service the reader: the module reads of the caller's role (certification L43)", async () => {
    const readsOf = async (role) => {
      mockAuditService.listEvents.mockClear();
      const res = await request(buildApp()).get('/projects/project-1/audit').set('x-role', role);
      expect(res.status).toBe(200);
      const { viewer } = mockAuditService.listEvents.mock.calls[0][0];
      return (moduleName) => viewer.canRead(moduleName);
    };
    const site = await readsOf('site_engineer');
    expect(site('rfi')).toBe(true);
    expect(site('change_order')).toBe(false);
    expect(site('ipc')).toBe(false);
    expect(site('commitment')).toBe(false);
    const pm = await readsOf('pm');
    expect(pm('change_order')).toBe(true);
    expect(pm('ipc')).toBe(true);
  });

  it('blocks roles outside the audit read policy', async () => {
    const res = await request(buildApp())
      .get('/projects/project-1/audit')
      .set('x-role', 'external_viewer');

    expect(res.status).toBe(403);
    expect(mockAuditService.listEvents).not.toHaveBeenCalled();
  });
});
