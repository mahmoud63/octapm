const request = require('supertest');

const projectId = '11111111-1111-4111-8111-111111111111';
const otherProjectId = '22222222-2222-4222-8222-222222222222';

const mockPrisma = {
  project: {
    findFirst: jest.fn(),
  },
};

const mockProjectService = {
  listProjects: jest.fn(),
  getProjectById: jest.fn(),
  createProject: jest.fn(),
  updateProject: jest.fn(),
  deleteProject: jest.fn(),
  commercialTermsReadableIds: jest.fn(),
};

const mockScheduleService = {
  getProjectSchedule: jest.fn(),
  approveRevision: jest.fn(),
};

const mockDocControlService = {
  approveDocumentRevision: jest.fn(),
  getDocControlDashboard: jest.fn(),
  getRevisionDownloadFile: jest.fn(),
  getRevisionPreviewFile: jest.fn(),
  listDocumentRegister: jest.fn(),
  submitDocumentRevisionForReview: jest.fn(),
  supersedeDocumentRevision: jest.fn(),
  uploadDocumentRevision: jest.fn(),
};

const mockSubscriptionService = {
  ensureSubscription: jest.fn(),
  isExpired: jest.fn(),
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
const fakeAuthenticate = (req, _res, next) => {
  req.user = {
    id: req.get('x-user-id') || 'site-1',
    orgId: req.get('x-org-id') || 'org-1',
    role: req.get('x-role') || 'site_engineer',
    email: 'site@example.com',
    name: 'Site Engineer',
  };
  next();
};
jest.mock('../../middleware/auth', () => ({
  authenticate: fakeAuthenticate,
  // The org-level gate app.js mounts: authenticates the same way here.
  requireOrganizationMembership: () => fakeAuthenticate,
  // The MFA routes' SSO-session guard (D-ID-1 Q2); not exercised here.
  requireCredentialSession: (_req, _res, next) => next(),
}));
jest.mock('../../services/project.service', () => mockProjectService);
jest.mock('../../services/schedule.service', () => mockScheduleService);
jest.mock('../../services/doc-control.service', () => mockDocControlService);
jest.mock('../../services/subscription.service', () => mockSubscriptionService);

const { createApp } = require('../../app');

function projectRecord(id = projectId, overrides = {}) {
  return { id, orgId: 'org-1', ...overrides };
}

function mockProjectAccess({
  assigned = true,
  exists = true,
  assignmentRole = null,
  party = false,
  partyRole = 'consultant',
} = {}) {
  mockPrisma.project.findFirst.mockImplementation(({ where }) => {
    const isMembershipCheck = Boolean(where.OR);
    if (isMembershipCheck) {
      if (!assigned && !party) return Promise.resolve(null);

      return Promise.resolve(
        projectRecord(where.id, {
          assignments: assigned
            ? assignmentRole
              ? [{ role: assignmentRole }]
              : [{ role: 'site_engineer' }]
            : [],
          parties: party
            ? [
                {
                  id: '33333333-3333-4333-8333-333333333331',
                  companyId: '33333333-3333-4333-8333-333333333332',
                  role: partyRole,
                  accessLevel: 'reviewer',
                  permissionProfile: `default_${partyRole}`,
                  company: {
                    id: '33333333-3333-4333-8333-333333333332',
                    name: 'Consultant Co',
                    status: 'active',
                  },
                  members: [{ id: 'member-1', role: 'member', status: 'active' }],
                },
              ]
            : [],
        }),
      );
    }
    return Promise.resolve(exists ? projectRecord(where.id) : null);
  });
}

describe('project object authorization', () => {
  let app;
  let errorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSubscriptionService.ensureSubscription.mockResolvedValue({
      id: 'sub-1',
      orgId: 'org-1',
      plan: 'enterprise',
      status: 'active',
    });
    mockSubscriptionService.isExpired.mockReturnValue(false);
    mockProjectService.listProjects.mockResolvedValue({
      items: [],
      pagination: { limit: 20, nextCursor: null },
    });
    mockProjectService.getProjectById.mockResolvedValue({
      id: projectId,
      orgId: 'org-1',
      name: 'Assigned Tower',
    });
    mockScheduleService.getProjectSchedule.mockResolvedValue({
      revision: null,
      activities: [],
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('passes the authenticated user context to project listing', async () => {
    const res = await request(app)
      .get('/api/v1/projects')
      .set('x-user-id', 'site-1')
      .set('x-role', 'site_engineer');

    expect(res.status).toBe(200);
    expect(mockProjectService.listProjects).toHaveBeenCalledWith({
      orgId: 'org-1',
      userId: 'site-1',
      role: 'site_engineer',
      query: {},
      commercialAccessForProjects: expect.any(Function),
    });
    // Certification L25 / R28: each row's commercial terms are decided on
    // that project, as its own routes decide ipc:read — the whole page at
    // once, by the service's batched rule, for the person asking.
    const { commercialAccessForProjects } = mockProjectService.listProjects.mock.calls[0][0];
    mockProjectService.commercialTermsReadableIds.mockResolvedValueOnce(new Set());
    await expect(commercialAccessForProjects([projectId, otherProjectId])).resolves.toEqual(new Set());
    expect(mockProjectService.commercialTermsReadableIds).toHaveBeenCalledWith({
      req: expect.objectContaining({ user: expect.objectContaining({ id: 'site-1', role: 'site_engineer' }) }),
      projectIds: [projectId, otherProjectId],
    });
  });

  it('allows an assigned project user to get a project', async () => {
    mockProjectAccess({ assigned: true });

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set('x-user-id', 'site-1')
      .set('x-role', 'site_engineer');

    expect(res.status).toBe(200);
    expect(mockProjectService.getProjectById).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId,
      userId: 'site-1',
      role: 'site_engineer',
      commercialAccessFor: expect.any(Function),
    });
    const { commercialAccessFor } = mockProjectService.getProjectById.mock.calls[0][0];
    await expect(commercialAccessFor(projectId)).resolves.toBe(false);
  });

  it('certification L25: the project record states its commercial terms to an ipc reader, not to a party guest', async () => {
    mockProjectAccess({ assigned: true, assignmentRole: 'qs' });
    const asQs = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set('x-user-id', 'qs-1')
      .set('x-role', 'qs');
    expect(asQs.status).toBe(200);
    await expect(mockProjectService.getProjectById.mock.calls[0][0].commercialAccessFor(projectId)).resolves.toBe(true);

    mockProjectAccess({ assigned: false, party: true, partyRole: 'subcontractor' });
    const asGuest = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set('x-user-id', 'guest-1')
      .set('x-role', 'site_engineer');
    expect(asGuest.status).toBe(200);
    await expect(mockProjectService.getProjectById.mock.calls[1][0].commercialAccessFor(projectId)).resolves.toBe(false);
  });

  it('returns 403 when a project user gets an unassigned project', async () => {
    mockProjectAccess({ assigned: false, exists: true });

    const res = await request(app)
      .get(`/api/v1/projects/${otherProjectId}`)
      .set('x-user-id', 'site-1')
      .set('x-role', 'site_engineer');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'PROJECT_ACCESS_DENIED',
        message: 'You are not assigned to this project',
        // Every error carries the request id (M0 contract).
        requestId: expect.any(String),
      },
    });
    expect(mockProjectService.getProjectById).not.toHaveBeenCalled();
  });

  it('blocks nested project routes before module services run', async () => {
    mockProjectAccess({ assigned: false, exists: true });

    const res = await request(app)
      .get(`/api/v1/projects/${otherProjectId}/schedule`)
      .set('x-user-id', 'site-1')
      .set('x-role', 'site_engineer');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROJECT_ACCESS_DENIED');
    expect(mockScheduleService.getProjectSchedule).not.toHaveBeenCalled();
  });

  it('allows an active project-party member to access the project route', async () => {
    mockProjectAccess({ assigned: false, party: true });

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/schedule`)
      .set('x-user-id', 'consultant-1')
      .set('x-role', 'finance');

    expect(res.status).toBe(200);
    expect(mockScheduleService.getProjectSchedule).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId,
    });
  });

  it('blocks approval calls for an unassigned project before services run', async () => {
    mockProjectAccess({ assigned: false, exists: true });

    const res = await request(app)
      .post(
        `/api/v1/projects/${otherProjectId}/schedule/revisions/33333333-3333-4333-8333-333333333333/approve`,
      )
      .set('x-user-id', 'site-1')
      .set('x-role', 'site_engineer')
      .send({ comment: 'Trying to approve another project' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROJECT_ACCESS_DENIED');
    expect(mockScheduleService.approveRevision).not.toHaveBeenCalled();
  });

  it('blocks document revision downloads for an unassigned project before services run', async () => {
    mockProjectAccess({ assigned: false, exists: true });

    const res = await request(app)
      .get(
        `/api/v1/projects/${otherProjectId}/doc-control/revisions/33333333-3333-4333-8333-333333333333/download`,
      )
      .set('x-user-id', 'site-1')
      .set('x-role', 'site_engineer');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROJECT_ACCESS_DENIED');
    expect(mockDocControlService.getRevisionDownloadFile).not.toHaveBeenCalled();
  });

  it('blocks document revision previews for an unassigned project before services run', async () => {
    mockProjectAccess({ assigned: false, exists: true });

    const res = await request(app)
      .get(
        `/api/v1/projects/${otherProjectId}/doc-control/revisions/33333333-3333-4333-8333-333333333333/preview`,
      )
      .set('x-user-id', 'site-1')
      .set('x-role', 'site_engineer');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROJECT_ACCESS_DENIED');
    expect(mockDocControlService.getRevisionPreviewFile).not.toHaveBeenCalled();
  });

  it('blocks document revision uploads for an unassigned project before services run', async () => {
    mockProjectAccess({ assigned: false, exists: true });

    const res = await request(app)
      .post(
        `/api/v1/projects/${otherProjectId}/doc-control/rfi/66666666-6666-4666-8666-666666666666/revisions`,
      )
      .set('x-user-id', 'site-1')
      .set('x-role', 'site_engineer')
      .send({
        revision: 'A',
        projectDocumentId: '33333333-3333-4333-8333-333333333333',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROJECT_ACCESS_DENIED');
    expect(mockDocControlService.uploadDocumentRevision).not.toHaveBeenCalled();
  });

  it('allows a project-assigned PM to approve within that project', async () => {
    mockProjectAccess({ assigned: true, assignmentRole: 'Project Manager' });
    mockScheduleService.approveRevision.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'approved',
    });

    const res = await request(app)
      .post(
        `/api/v1/projects/${projectId}/schedule/revisions/33333333-3333-4333-8333-333333333333/approve`,
      )
      .set('x-user-id', 'site-1')
      .set('x-role', 'site_engineer')
      .send({ comment: 'Approved on Project A' });

    expect(res.status).toBe(200);
    expect(mockScheduleService.approveRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        userId: 'site-1',
        userRole: 'pm',
      }),
    );
  });

  it('allows PM users to access org projects without assignment rows', async () => {
    mockProjectAccess({ assigned: false, exists: true });

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/schedule`)
      .set('x-user-id', 'pm-1')
      .set('x-role', 'pm');

    expect(res.status).toBe(200);
    expect(mockScheduleService.getProjectSchedule).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId,
    });
  });
});
