const mockTx = {
  user: {
    create: jest.fn(),
    update: jest.fn(),
  },
  passwordResetToken: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  invitationToken: {
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  projectAssignment: {
    upsert: jest.fn(),
  },
  refreshSession: {
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  authAuditEvent: {
    create: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn(),
  user: {
    findUnique: jest.fn(),
  },
  passwordResetToken: {
    findUnique: jest.fn(),
  },
  invitationToken: {
    findUnique: jest.fn(),
  },
  organisation: {
    findUnique: jest.fn(),
  },
  authAuditEvent: {
    create: jest.fn(),
  },
};

const mockSendEmail = jest.fn();
const mockTemplates = {
  passwordReset: jest.fn(({ resetUrl }) => ({
    subject: "Reset your password",
    body: resetUrl,
  })),
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

const authService = require("../auth.service");

const activeUser = {
  id: "user-1",
  orgId: "org-1",
  name: "Project Manager",
  email: "pm@example.com",
  phone: null,
  passwordHash: "old-hash",
  role: "pm",
  status: "active",
};

const pendingInvitation = {
  id: "invite-1",
  orgId: "org-1",
  projectId: "project-1",
  email: "new.user@example.com",
  role: "site_engineer",
  status: "pending",
  tokenHash: "hash",
  note: null,
  invitedById: "pm-1",
  acceptedById: null,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  acceptedAt: null,
  revokedAt: null,
  org: { id: "org-1", name: "Octa Builders" },
  project: { id: "project-1", name: "Tower A" },
};

describe("auth password reset and invitation tokens", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = "access-secret-with-at-least-32-characters";
    process.env.JWT_REFRESH_SECRET =
      "refresh-secret-with-at-least-32-characters";
    process.env.JWT_EXPIRY = "15m";
    process.env.JWT_REFRESH_EXPIRY = "7d";
    process.env.WEB_APP_URL = "https://app.example.com";
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback(mockTx),
    );
    mockTx.passwordResetToken.create.mockImplementation(async ({ data }) => ({
      id: "reset-1",
      ...data,
    }));
    mockTx.refreshSession.create.mockImplementation(async ({ data }) => data);
    mockSendEmail.mockResolvedValue({ delivered: true });
    // Acceptance claims the link with a conditional update (one row), lists
    // the e-mail's other pending links, and then issues the workspace session
    // as any is issued (the workspace's policy read from the organisation).
    mockTx.invitationToken.updateMany.mockResolvedValue({ count: 1 });
    mockTx.invitationToken.findMany.mockResolvedValue([]);
    mockPrisma.organisation.findUnique.mockResolvedValue({ id: "org-1", name: "Octa Builders", slug: "octa", kind: "company", status: "active", ssoEnabled: false, ssoRequired: false, ssoDomainsJson: [], mfaRequired: false });
  });

  it("stores only a hashed password reset token and sends a reset email", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      org: { id: "org-1", name: "Octa Builders" },
    });

    const result = await authService.requestPasswordReset(
      { email: "PM@EXAMPLE.COM" },
      { ipAddress: "127.0.0.1", userAgent: "Jest" },
    );

    expect(result).toEqual({ sent: true });

    const createCall = mockTx.passwordResetToken.create.mock.calls[0][0];
    expect(createCall.data.email).toBe("pm@example.com");
    expect(createCall.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mockTemplates.passwordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        resetUrl: expect.stringContaining(
          "https://app.example.com/reset-password?token=",
        ),
      }),
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "pm@example.com",
        metadata: expect.objectContaining({ tokenId: "reset-1" }),
      }),
    );
  });

  it("still answers {sent:true} when the email cannot be delivered, and records why", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      org: { id: "org-1", name: "Octa Builders" },
    });
    mockSendEmail.mockRejectedValue(
      Object.assign(new Error("rejected"), {
        code: "EMAIL_DELIVERY_FAILED",
        details: { status: 500 },
      }),
    );
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      authService.requestPasswordReset({ email: "pm@example.com" }),
    ).resolves.toEqual({ sent: true });

    expect(mockPrisma.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "password_reset_delivery_failed",
          userId: activeUser.id,
          metadataJson: { code: "EMAIL_DELIVERY_FAILED", status: 500 },
        }),
      }),
    );
    errorLog.mockRestore();
  });

  it("keeps forgot-password responses neutral for unknown emails", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      authService.requestPasswordReset({ email: "missing@example.com" }),
    ).resolves.toEqual({ sent: true });

    expect(mockTx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "password_reset_requested_unknown",
          email: "missing@example.com",
        }),
      }),
    );
  });

  it("rejects expired or reused reset tokens without updating the password", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      userId: activeUser.id,
      orgId: activeUser.orgId,
      email: activeUser.email,
      usedAt: new Date(),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      user: activeUser,
    });

    await expect(
      authService.resetPassword({
        token: "raw-token",
        password: "Password1",
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "PASSWORD_RESET_TOKEN_INVALID",
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "password_reset_rejected",
        }),
      }),
    );
  });

  it("uses a reset token once and revokes existing refresh sessions", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      userId: activeUser.id,
      orgId: activeUser.orgId,
      email: activeUser.email,
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      user: activeUser,
    });
    mockTx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      authService.resetPassword({
        token: "raw-token",
        password: "Password1",
      }),
    ).resolves.toEqual({ reset: true });

    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: activeUser.id },
      data: { passwordHash: expect.any(String) },
    });
    // Claimed by a conditional write, so two submissions of one link cannot
    // both set a password.
    expect(mockTx.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: "reset-1",
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { usedAt: expect.any(Date) },
    });
    expect(mockTx.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: activeUser.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("accepts an invitation by creating a user and assigning the project role", async () => {
    const created = {
      ...activeUser,
      id: "new-user-1",
      email: pendingInvitation.email,
      role: pendingInvitation.role,
    };
    mockPrisma.invitationToken.findUnique.mockResolvedValue(pendingInvitation);
    // No identity for the e-mail at acceptance; the new one when the session is issued.
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValue(created);
    mockTx.user.create.mockResolvedValue(created);
    mockTx.invitationToken.update.mockResolvedValue({});
    mockTx.projectAssignment.upsert.mockResolvedValue({});

    const result = await authService.acceptInvitation(
      {
        token: "invite-token",
        name: "New User",
        password: "Password1",
      },
      { ipAddress: "127.0.0.1", userAgent: "Jest" },
    );

    expect(result.user.email).toBe(pendingInvitation.email);
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(mockTx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: pendingInvitation.orgId,
        email: pendingInvitation.email,
        role: pendingInvitation.role,
        passwordHash: expect.any(String),
      }),
    });
    expect(mockTx.projectAssignment.upsert).toHaveBeenCalledWith({
      where: {
        projectId_userId: {
          projectId: pendingInvitation.projectId,
          userId: "new-user-1",
        },
      },
      create: {
        projectId: pendingInvitation.projectId,
        userId: "new-user-1",
        role: pendingInvitation.role,
        orgId: "org-1",
      },
      update: { role: pendingInvitation.role, orgId: "org-1" },
    });
    // Claimed only while still pending, unrevoked and unexpired; then stamped with who accepted.
    expect(mockTx.invitationToken.updateMany).toHaveBeenCalledWith({
      where: { id: pendingInvitation.id, status: "pending", acceptedAt: null, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { status: "accepted", acceptedAt: expect.any(Date) },
    });
    expect(mockTx.invitationToken.update).toHaveBeenCalledWith({
      where: { id: pendingInvitation.id },
      data: expect.objectContaining({ acceptedById: "new-user-1" }),
    });
  });

  it("writes nothing when the link was revoked, used or expired after it was read (the claim finds no pending row)", async () => {
    mockPrisma.invitationToken.findUnique.mockResolvedValue(pendingInvitation);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockTx.invitationToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      authService.acceptInvitation({ token: "invite-token", name: "New User", password: "Password1" }),
    ).rejects.toMatchObject({ code: "INVITATION_TOKEN_INVALID" });
    expect(mockTx.user.create).not.toHaveBeenCalled();
    expect(mockTx.projectAssignment.upsert).not.toHaveBeenCalled();
    expect(mockTx.invitationToken.update).not.toHaveBeenCalled();
  });

  it("needs the existing identity's own session: the link alone, a password (even the right one) and another identity's session are refused; nothing on the identity is written", async () => {
    const bcrypt = require("bcryptjs");
    const existing = {
      ...activeUser,
      id: "existing-1",
      orgId: "other-org",
      email: pendingInvitation.email,
      passwordHash: bcrypt.hashSync("Password1", 4),
    };
    mockPrisma.invitationToken.findUnique.mockResolvedValue(pendingInvitation);
    mockPrisma.user.findUnique.mockResolvedValue(existing);
    mockTx.invitationToken.update.mockResolvedValue({});
    mockTx.projectAssignment.upsert.mockResolvedValue({});

    const accept = (payload) => authService.acceptInvitation({ token: "invite-token", name: "Existing", ...payload });
    await expect(accept({})).rejects.toMatchObject({ code: "INVITATION_SIGN_IN_REQUIRED" });
    await expect(accept({ password: "Wrong-Passw0rd" })).rejects.toMatchObject({ code: "INVITATION_SIGN_IN_REQUIRED" });
    await expect(accept({ password: "Password1" })).rejects.toMatchObject({ code: "INVITATION_SIGN_IN_REQUIRED" });
    await expect(accept({ identityUserId: "somebody-else", password: "Password1" })).rejects.toMatchObject({ code: "INVITATION_SIGN_IN_REQUIRED" });
    // A session another company's single sign-on issued vouches for that company only (L10).
    await expect(accept({ identityUserId: "existing-1", identitySsoOrgId: "other-org" })).rejects.toMatchObject({ code: "SSO_SESSION_BOUND" });
    expect(mockTx.invitationToken.updateMany).not.toHaveBeenCalled();
    expect(mockTx.invitationToken.update).not.toHaveBeenCalled();
    expect(mockPrisma.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "invitation_accept_rejected", metadataJson: { reason: "INVITATION_SIGN_IN_REQUIRED" } }) }),
    );

    // The workspace session after acceptance is issued for the membership acceptance wrote.
    mockPrisma.organizationMembership = {
      findFirst: jest.fn().mockResolvedValue({ id: "m-1", orgId: "org-1", userId: "existing-1", status: "active", role: "site_engineer", kind: "member", isAdmin: false, isOwner: false }),
      findMany: jest.fn().mockResolvedValue([]),
    };
    let bySession;
    try {
      bySession = await accept({ identityUserId: "existing-1" });
    } finally {
      delete mockPrisma.organizationMembership;
    }
    expect(bySession.user).toMatchObject({ id: "existing-1", orgId: "org-1" });
    // Not the identity's home: nothing on the User row is written, the password least of all.
    expect(mockTx.user.update).not.toHaveBeenCalled();
    expect(mockTx.invitationToken.update).toHaveBeenCalledTimes(1);
  });

  it("does not reopen an identity its home workspace closed: another workspace's invitation is refused, home's reopens it with a new password", async () => {
    const closed = { ...activeUser, id: "closed-1", orgId: "other-org", email: pendingInvitation.email, status: "inactive" };
    mockPrisma.invitationToken.findUnique.mockResolvedValue(pendingInvitation);
    mockPrisma.user.findUnique.mockResolvedValue(closed);
    await expect(
      authService.acceptInvitation({ token: "invite-token", name: "Closed", password: "Password1" }),
    ).rejects.toMatchObject({ code: "USER_INACTIVE" });
    expect(mockTx.invitationToken.update).not.toHaveBeenCalled();
    expect(mockTx.refreshSession.create).not.toHaveBeenCalled();

    mockPrisma.user.findUnique.mockResolvedValue({ ...closed, orgId: "org-1" });
    mockTx.user.update.mockImplementation(async ({ data }) => ({ ...closed, orgId: "org-1", ...data }));
    mockTx.invitationToken.update.mockResolvedValue({});
    mockTx.projectAssignment.upsert.mockResolvedValue({});
    await expect(authService.acceptInvitation({ token: "invite-token", name: "Closed" })).rejects.toMatchObject({ code: "INVITATION_PASSWORD_REQUIRED" });
    // Home reopens it with a new password; the link itself mints no session
    // (the account signs in afterwards, with its second factor if it has one).
    const reopened = await authService.acceptInvitation({ token: "invite-token", name: "Closed", password: "Password1" });
    expect(reopened).toMatchObject({ accepted: true, signInRequired: true, orgId: "org-1" });
    expect(reopened.tokens).toBeUndefined();
    expect(mockTx.refreshSession.create).not.toHaveBeenCalled();
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "active", passwordHash: expect.any(String) }) }),
    );
  });
});
