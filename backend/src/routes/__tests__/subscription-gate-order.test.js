const request = require('supertest');

const mockProjectService = {
  createProject: jest.fn(),
};
const mockUserService = {
  createUser: jest.fn(),
};
const mockSubscriptionService = {
  ensureSubscription: jest.fn(),
  isExpired: jest.fn(),
  getCurrentSubscription: jest.fn(),
  getPlansForOrg: jest.fn(),
  listInvoices: jest.fn(),
  startTrialSetup: jest.fn(),
  confirmTrial: jest.fn(),
  subscribe: jest.fn(),
  cancelSubscription: jest.fn(),
  createEnterpriseLead: jest.fn(),
};

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 'user-1',
      orgId: 'org-1',
      role: 'pm',
      email: 'pm@example.com',
      name: 'Project Manager',
    };
    next();
  },
}));
jest.mock('../../services/project.service', () => mockProjectService);
jest.mock('../../services/user.service', () => mockUserService);
jest.mock('../../services/subscription.service', () => mockSubscriptionService);

const { createApp } = require('../../app');

describe('subscription gate route ordering', () => {
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
      status: 'expired',
    });
    mockSubscriptionService.isExpired.mockReturnValue(true);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('blocks authenticated project creation for expired organizations before persistence', async () => {
    mockProjectService.createProject.mockResolvedValue({
      id: 'project-1',
      name: 'Hospital Expansion',
    });

    const res = await request(app)
      .post('/api/v1/projects')
      .send({ name: 'Hospital Expansion' });

    expect(res.status).toBe(402);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Your trial or subscription has ended. Subscribe to continue.',
        // Every error carries the request id (M0 contract).
        requestId: expect.any(String),
      },
    });
    expect(mockSubscriptionService.ensureSubscription).toHaveBeenCalledWith('org-1');
    expect(mockProjectService.createProject).not.toHaveBeenCalled();
  });

  it('blocks authenticated user creation for expired organizations before persistence', async () => {
    mockUserService.createUser.mockResolvedValue({
      id: 'user-2',
      email: 'site.engineer@example.com',
    });

    const res = await request(app)
      .post('/api/v1/users')
      .send({
        name: 'Site Engineer',
        email: 'site.engineer@example.com',
        password: 'Password1',
        role: 'site_engineer',
      });

    expect(res.status).toBe(402);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Your trial or subscription has ended. Subscribe to continue.',
        // Every error carries the request id (M0 contract).
        requestId: expect.any(String),
      },
    });
    expect(mockSubscriptionService.ensureSubscription).toHaveBeenCalledWith('org-1');
    expect(mockUserService.createUser).not.toHaveBeenCalled();
  });

  it('allows authenticated project creation for organizations with active access', async () => {
    mockSubscriptionService.isExpired.mockReturnValue(false);
    mockProjectService.createProject.mockResolvedValue({
      id: 'project-1',
      name: 'Hospital Expansion',
    });

    const res = await request(app)
      .post('/api/v1/projects')
      .send({ name: 'Hospital Expansion' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: {
        id: 'project-1',
        name: 'Hospital Expansion',
      },
    });
    expect(mockSubscriptionService.ensureSubscription).toHaveBeenCalledWith('org-1');
    expect(mockProjectService.createProject).toHaveBeenCalledWith({
      orgId: 'org-1',
      userId: 'user-1',
      role: 'pm',
      payload: { name: 'Hospital Expansion' },
    });
  });

  it('allows authenticated user creation for organizations with active access', async () => {
    mockSubscriptionService.isExpired.mockReturnValue(false);
    mockUserService.createUser.mockResolvedValue({
      id: 'user-2',
      email: 'site.engineer@example.com',
    });

    const res = await request(app)
      .post('/api/v1/users')
      .send({
        name: 'Site Engineer',
        email: 'site.engineer@example.com',
        password: 'Password1',
        role: 'site_engineer',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: {
        id: 'user-2',
        email: 'site.engineer@example.com',
      },
    });
    expect(mockSubscriptionService.ensureSubscription).toHaveBeenCalledWith('org-1');
    expect(mockUserService.createUser).toHaveBeenCalledWith({
      orgId: 'org-1',
      payload: {
        name: 'Site Engineer',
        email: 'site.engineer@example.com',
        password: 'Password1',
        role: 'site_engineer',
      },
    });
  });
});
