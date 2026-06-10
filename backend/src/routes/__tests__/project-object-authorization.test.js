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
};

const mockScheduleService = {
  getProjectSchedule: jest.fn(),
};

const mockSubscriptionService = {
  ensureSubscription: jest.fn(),
  isExpired: jest.fn(),
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: req.get('x-user-id') || 'site-1',
      orgId: req.get('x-org-id') || 'org-1',
      role: req.get('x-role') || 'site_engineer',
      email: 'site@example.com',
      name: 'Site Engineer',
    };
    next();
  },
}));
jest.mock('../../services/project.service', () => mockProjectService);
jest.mock('../../services/schedule.service', () => mockScheduleService);
jest.mock('../../services/subscription.service', () => mockSubscriptionService);

const { createApp } = require('../../app');

function projectRecord(id = projectId) {
  return { id, orgId: 'org-1' };
}

function mockProjectAccess({ assigned = true, exists = true } = {}) {
  mockPrisma.project.findFirst.mockImplementation(({ where }) => {
    const isMembershipCheck = Boolean(where.assignments);
    if (isMembershipCheck) {
      return Promise.resolve(assigned ? projectRecord(where.id) : null);
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
    });
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
