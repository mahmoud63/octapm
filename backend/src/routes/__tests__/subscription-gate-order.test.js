const request = require('supertest');

const mockProjectService = {
  createProject: jest.fn(),
};
// POST /users is the deprecated alias of the invitation (owner decision D-ID-1):
// both routes run userService.inviteUser.
const mockUserService = {
  inviteUser: jest.fn(),
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

const fakeAuthenticate = (req, _res, next) => {
  req.user = {
    id: 'user-1',
    orgId: 'org-1',
    role: 'pm',
    email: 'pm@example.com',
    name: 'Project Manager',
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

  it.each(['/api/v1/users', '/api/v1/users/invitations'])(
    'blocks adding a person (%s) for expired organizations before persistence',
    async (path) => {
      const res = await request(app)
        .post(path)
        .send({
          email: 'site.engineer@example.com',
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
      expect(mockUserService.inviteUser).not.toHaveBeenCalled();
    },
  );

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
      // L25: the route says, per project, whether this caller may see the commercial terms.
      commercialAccessFor: expect.any(Function),
    });
  });

  // Owner decision D-ID-1: POST /users is the deprecated alias of POST
  // /users/invitations — the same chain and the same 201 with the invitation
  // (data.id is the invitation's id). Name and phone are not passed on.
  it.each([
    ['/api/v1/users', 'users.create'],
    ['/api/v1/users/invitations', 'users.invite'],
  ])('allows adding a person (%s) for organizations with active access, as an invitation', async (path, via) => {
    mockSubscriptionService.isExpired.mockReturnValue(false);
    const invitation = {
      id: 'invite-2',
      email: 'site.engineer@example.com',
      role: 'site_engineer',
      status: 'pending',
      invited: true,
    };
    mockUserService.inviteUser.mockResolvedValue(invitation);

    const res = await request(app)
      .post(path)
      .send({
        name: 'Site Engineer',
        phone: '+1 555 0100',
        email: 'site.engineer@example.com',
        role: 'site_engineer',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: invitation });
    expect(mockSubscriptionService.ensureSubscription).toHaveBeenCalledWith('org-1');
    // The route also hands the service the actor and request context (ENT-2:
    // the membership audit trail names who added the person).
    expect(mockUserService.inviteUser).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        actor: expect.objectContaining({ id: 'user-1', orgId: 'org-1' }),
        payload: {
          email: 'site.engineer@example.com',
          role: 'site_engineer',
          projectId: undefined,
          companyId: undefined,
          projectPartyId: undefined,
          note: undefined,
        },
        via,
      }),
    );
  });

  it('refuses a password field on POST /users, whatever its value, before anything is looked up', async () => {
    mockSubscriptionService.isExpired.mockReturnValue(false);
    for (const password of ['Password1', '', null, false]) {
      const res = await request(app)
        .post('/api/v1/users')
        .send({ email: 'site.engineer@example.com', role: 'site_engineer', password });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('USER_PASSWORD_NOT_ACCEPTED');
    }
    expect(mockUserService.inviteUser).not.toHaveBeenCalled();
  });
});
