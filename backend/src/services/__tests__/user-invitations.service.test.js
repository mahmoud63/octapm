const mockTx = {
  invitationToken: {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  authAuditEvent: {
    create: jest.fn(),
  },
  auditEvent: {
    create: jest.fn(),
  },
  recordHistorySnapshot: {
    create: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn(),
  organisation: {
    findUnique: jest.fn(),
  },
  project: {
    findFirst: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

const mockSendEmail = jest.fn();
const mockTemplates = {
  invitation: jest.fn(({ acceptUrl }) => ({
    subject: "Invitation",
    body: acceptUrl,
  })),
};

jest.mock("../../config/db", () => ({
  prisma: mockPrisma,
}));

jest.mock("../email.service", () => ({
  sendEmail: mockSendEmail,
  templates: mockTemplates,
}));

const userService = require("../user.service");

describe("user invitations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEB_APP_URL = "https://app.example.com";
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback(mockTx),
    );
    mockPrisma.organisation.findUnique.mockResolvedValue({
      id: "org-1",
      name: "Octa Builders",
    });
    mockPrisma.project.findFirst.mockResolvedValue({
      id: "project-1",
      name: "Tower A",
    });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockTx.invitationToken.findMany.mockResolvedValue([]);
    mockTx.invitationToken.updateMany.mockResolvedValue({ count: 0 });
    mockTx.invitationToken.create.mockImplementation(async ({ data }) => ({
      id: "invite-1",
      status: "pending",
      createdAt: new Date(),
      ...data,
    }));
    mockTx.auditEvent.create.mockImplementation(async ({ data }) => ({
      id: "audit-1",
      occurredAt: new Date(),
      createdAt: new Date(),
      ...data,
    }));
    mockSendEmail.mockResolvedValue({ delivered: true });
  });

  it("creates a hashed invitation token, audits it, and sends the accept link", async () => {
    const invitation = await userService.inviteUser({
      orgId: "org-1",
      actor: {
        id: "pm-1",
        name: "Project Manager",
        email: "pm@example.com",
        role: "pm",
      },
      payload: {
        email: "New.User@Example.com",
        role: "site_engineer",
        projectId: "project-1",
        note: "Welcome aboard",
      },
      context: { ipAddress: "127.0.0.1", userAgent: "Jest" },
    });

    expect(invitation).toEqual(
      expect.objectContaining({
        id: "invite-1",
        email: "new.user@example.com",
        role: "site_engineer",
        projectId: "project-1",
      }),
    );
    expect(mockTx.invitationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        invitedById: "pm-1",
      }),
    });
    expect(mockTemplates.invitation).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptUrl: expect.stringContaining(
          "https://app.example.com/accept-invite?token=",
        ),
        projectName: "Tower A",
      }),
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "new.user@example.com",
        metadata: expect.objectContaining({ invitationId: "invite-1" }),
      }),
    );
    expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "invitation_created",
          actorId: "pm-1",
        }),
      }),
    );
    expect(mockTx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "user_invitation",
          action: "created",
        }),
      }),
    );
  });

  // An identity that lives in another workspace may be invited (membership
  // doc §5): acceptance gives it a second membership. The refusal this test
  // used to assert (INVITATION_EMAIL_IN_OTHER_ORG) is retired.
  it("invites an email that already belongs to an identity in another organization", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "other-user",
      orgId: "other-org",
      email: "new.user@example.com",
      status: "active",
    });

    const invitation = await userService.inviteUser({
      orgId: "org-1",
      actor: { id: "pm-1", role: "pm" },
      payload: {
        email: "new.user@example.com",
        role: "site_engineer",
      },
    });

    expect(invitation).toMatchObject({ email: "new.user@example.com", role: "site_engineer", status: "pending" });
    expect(mockTx.invitationToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: "org-1", email: "new.user@example.com" }) }),
    );
    expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "invitation_created", userId: "other-user", metadataJson: expect.objectContaining({ existingUser: true }) }) }),
    );
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  // Owner decision L38: the answer is the invitation's alone, the same keys
  // whether or not the e-mail has an account; the project's history (read by
  // the inviting workspace) does not say which it was.
  it("answers the same for an e-mail with and without an account, and the project history does not tell", async () => {
    const invite = () => userService.inviteUser({ orgId: "org-1", actor: { id: "pm-1", role: "pm" }, payload: { email: "someone@example.com", role: "qs", projectId: "project-1" } });
    const missing = await invite();
    mockPrisma.user.findUnique.mockResolvedValue({ id: "other-user", orgId: "other-org", email: "someone@example.com", status: "active", name: "Real Name", phone: "+1 555 0100" });
    const existing = await invite();
    expect(Object.keys(existing).sort()).toEqual(Object.keys(missing).sort());
    expect(JSON.stringify(existing)).not.toMatch(/Real Name|555 0100|other-org|other-user|existing/);
    for (const call of mockTx.auditEvent.create.mock.calls) {
      expect(JSON.stringify(call[0].data)).not.toContain("existingUser");
    }
  });

  it("one pending invitation per e-mail: a new one revokes the previous and audits the revocation", async () => {
    mockTx.invitationToken.findMany.mockResolvedValue([{ id: "old-invite" }]);
    await userService.inviteUser({ orgId: "org-1", actor: { id: "pm-1", role: "pm" }, payload: { email: "someone@example.com", role: "qs" } });
    expect(mockTx.invitationToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["old-invite"] }, status: "pending" }), data: expect.objectContaining({ status: "revoked" }) }),
    );
    expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "invitation_revoked", entityId: "old-invite", metadataJson: expect.objectContaining({ reason: "superseded" }) }) }),
    );
  });

  it("POST /users with an existing identity's e-mail sends an invitation instead of attaching it, and tells nothing of the identity", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "other-user", orgId: "other-org", email: "someone@example.com", status: "inactive", name: "Real Name", phone: "+1 555 0100", lastLogin: new Date() });
    // A client that knows memberships, with no membership of this person here.
    mockPrisma.organizationMembership = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() };
    let result;
    try {
      result = await userService.createUser({ orgId: "org-1", actor: { id: "pm-1", role: "pm" }, payload: { email: "someone@example.com", name: "Typed Name", role: "qs", password: "Ignored1pass" } });
    } finally {
      const membershipModel = mockPrisma.organizationMembership;
      delete mockPrisma.organizationMembership;
      expect(membershipModel.create).not.toHaveBeenCalled();
      expect(membershipModel.update).not.toHaveBeenCalled();
    }
    expect(result).toMatchObject({ invited: true, email: "someone@example.com", role: "qs", status: "pending" });
    for (const key of ["name", "phone", "lastLogin", "existingIdentity", "orgId"]) expect(result).not.toHaveProperty(key);
    expect(mockTx.invitationToken.create).toHaveBeenCalledTimes(1);
    expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "invitation_created", metadataJson: expect.objectContaining({ via: "users.create" }) }) }),
    );
  });
});
