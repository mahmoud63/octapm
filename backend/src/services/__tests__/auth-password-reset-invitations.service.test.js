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
  ssoTicket: {
    updateMany: jest.fn(),
  },
  // Owner decision Q-KEY: a credential event revokes the API keys the person created.
  apiClient: {
    findMany: jest.fn(async () => []),
    updateMany: jest.fn(async () => ({ count: 0 })),
  },
  authAuditEvent: {
    create: jest.fn(),
    createMany: jest.fn(async ({ data }) => ({ count: data.length })),
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
    // The e-mail is handed off after the answer (D-ID-1 Q7).
    await authService.flushPasswordResetDeliveries();

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
    await authService.flushPasswordResetDeliveries();

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

  // Owner decision D-ID-1 Q7: every address takes the same path — one
  // transaction writing the audit line — so neither the answer nor its timing
  // says whether the address has an account.
  it("keeps forgot-password responses neutral for unknown emails", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      authService.requestPasswordReset({ email: "missing@example.com" }),
    ).resolves.toEqual({ sent: true });
    await authService.flushPasswordResetDeliveries();

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "password_reset_requested_unknown",
          email: "missing@example.com",
        }),
      }),
    );
  });

  it("treats an inactive account like an unknown one: audited in the transaction, no token, no e-mail", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, status: "inactive", org: { id: "org-1" } });

    await expect(authService.requestPasswordReset({ email: "pm@example.com" })).resolves.toEqual({ sent: true });
    await authService.flushPasswordResetDeliveries();

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "password_reset_requested_inactive", userId: activeUser.id }) }),
    );
  });

  it("answers before the mail provider does: the e-mail is handed off, not awaited", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, org: { id: "org-1" } });
    let deliver;
    mockSendEmail.mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));

    await expect(authService.requestPasswordReset({ email: "pm@example.com" })).resolves.toEqual({ sent: true });
    // The provider has not answered yet; the request already has.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    let flushed = false;
    const flushing = authService.flushPasswordResetDeliveries().then(() => { flushed = true; });
    await Promise.resolve();
    expect(flushed).toBe(false);
    deliver({ delivered: true });
    await flushing;
    expect(flushed).toBe(true);
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
    ).resolves.toEqual({ reset: true, endedSessionsOf: activeUser.id });
    // endedSessionsOf names the identity whose live sockets the route drops
    // (Codex D-ID-1 diff review #2); the route strips it from the answer.

    // A completed reset is a credential event (D-ID-1 Q6): the epoch moves,
    // so every token minted before it is refused everywhere.
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: activeUser.id },
      data: { passwordHash: expect.any(String), credentialEpoch: { increment: 1 } },
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
    // A pre-reset SSO ticket cannot be exchanged afterwards (Codex D-ID-1 diff
    // review #3): every unused ticket of the identity is marked used.
    expect(mockTx.ssoTicket.updateMany).toHaveBeenCalledWith({
      where: { userId: activeUser.id, usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  // Owner decision Q-KEY: a completed reset revokes every active API key the
  // person created, in every workspace, each audited with the reason.
  it("revokes the API keys the person created when a reset completes, and audits each", async () => {
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
    mockTx.apiClient.updateMany.mockResolvedValueOnce({ count: 2 });
    // Read back by this event's instant: a key revoked by hand meanwhile is not among them.
    mockTx.apiClient.findMany.mockResolvedValueOnce([
      { id: "key-1", orgId: activeUser.orgId, name: "ERP" },
      { id: "key-2", orgId: "org-elsewhere", name: "BI" },
    ]);

    await authService.resetPassword({ token: "raw-token", password: "Password1" });

    expect(mockTx.apiClient.updateMany).toHaveBeenCalledWith({
      where: { createdBy: activeUser.id, status: "active" },
      data: { status: "revoked", revokedAt: expect.any(Date) },
    });
    const instant = mockTx.apiClient.updateMany.mock.calls[0][0].data.revokedAt;
    expect(mockTx.apiClient.findMany).toHaveBeenCalledWith({
      where: { createdBy: activeUser.id, status: "revoked", revokedAt: instant },
      select: { id: true, orgId: true, name: true },
    });
    // One statement for the audit rows, whatever the number of keys (review M1).
    expect(mockTx.authAuditEvent.createMany).toHaveBeenCalledTimes(1);
    expect(mockTx.authAuditEvent.createMany).toHaveBeenCalledWith({
      data: [
        { orgId: activeUser.orgId, userId: activeUser.id, actorId: null, entityType: "api_client", entityId: "key-1", action: "api_key_revoked", metadataJson: { reason: "password_reset", name: "ERP" } },
        { orgId: "org-elsewhere", userId: activeUser.id, actorId: null, entityType: "api_client", entityId: "key-2", action: "api_key_revoked", metadataJson: { reason: "password_reset", name: "BI" } },
      ],
    });
  });

  it("reads and audits no key when the reset revoked none", async () => {
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
    await authService.resetPassword({ token: "raw-token", password: "Password1" });
    expect(mockTx.apiClient.updateMany).toHaveBeenCalledTimes(1);
    expect(mockTx.apiClient.findMany).not.toHaveBeenCalled();
    expect(mockTx.authAuditEvent.createMany).not.toHaveBeenCalled();
  });

  // Codex D-ID-1 diff review (LOW, reset expiry judged at request start): the
  // claim's expiry bound is taken when the claim is made, after the new
  // password is hashed, not when the request began.
  it("judges the link's expiry at the claim, after the password is hashed", async () => {
    let readAt = null;
    mockPrisma.passwordResetToken.findUnique.mockImplementation(async () => {
      readAt = Date.now();
      return {
        id: "reset-1",
        userId: activeUser.id,
        orgId: activeUser.orgId,
        email: activeUser.email,
        usedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        user: activeUser,
      };
    });
    let transactionAt = null;
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      transactionAt = Date.now();
      return callback(mockTx);
    });
    mockTx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

    await authService.resetPassword({ token: "raw-token", password: "Password1" });

    const claim = mockTx.passwordResetToken.updateMany.mock.calls[0][0];
    // Hashing at cost 12 takes well over a millisecond: a bound taken at the
    // start of the request would fall before the transaction began.
    expect(transactionAt - readAt).toBeGreaterThan(0);
    expect(claim.where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(transactionAt);
    mockPrisma.passwordResetToken.findUnique.mockReset();
  });

  it("writes nothing past the claim when the link expired between the read and the claim", async () => {
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
    // The conditional claim (expiresAt > now, judged at the claim) finds no row.
    mockTx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      authService.resetPassword({ token: "raw-token", password: "Password1" }),
    ).rejects.toMatchObject({ status: 400, code: "PASSWORD_RESET_TOKEN_INVALID" });

    expect(mockTx.user.update).not.toHaveBeenCalled();
    expect(mockTx.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(mockTx.ssoTicket.updateMany).not.toHaveBeenCalled();
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

  // Codex D-ID-1 diff review r2 #1: a new identity's acceptance passed no epoch,
  // so issuance adopted whatever the row said by then — a reset landing between
  // the acceptance and the issuance got a session at the new epoch. The
  // session is now held at the epoch the acceptance itself wrote.
  it("issues a new identity's session held at the epoch its acceptance wrote, and answers signInRequired when a reset moved it before the issuance", async () => {
    const created = { ...activeUser, id: "new-user-1", email: pendingInvitation.email, role: pendingInvitation.role, credentialEpoch: 0 };
    mockPrisma.invitationToken.findUnique.mockResolvedValue(pendingInvitation);
    // No identity at acceptance; by the issuance a reset has moved the row to epoch 1.
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ ...created, credentialEpoch: 1 });
    mockTx.user.create.mockResolvedValue(created);
    mockTx.invitationToken.update.mockResolvedValue({});
    mockTx.projectAssignment.upsert.mockResolvedValue({});
    const holds = [];
    mockTx.$queryRaw = jest.fn(async (strings, ...values) => {
      holds.push({ sql: strings.join("?"), values });
      return values[0] === "new-user-1" && values[1] === 1 ? [{ id: "new-user-1" }] : [];
    });
    let result;
    try {
      result = await authService.acceptInvitation({ token: "invite-token", name: "New User", password: "Password1" });
    } finally {
      delete mockTx.$queryRaw;
    }
    expect(holds).toEqual([{ sql: expect.stringMatching(/FROM "User" WHERE "id" = \? AND "credentialEpoch" = \? AND "status" = 'active' FOR NO KEY UPDATE$/), values: ["new-user-1", 0] }]);
    expect(result).toEqual({ accepted: true, signInRequired: true, orgId: "org-1", reason: expect.objectContaining({ code: "SESSION_REVOKED" }) });
    expect(result.tokens).toBeUndefined();
    expect(mockTx.refreshSession.create).not.toHaveBeenCalled();
    // The acceptance itself stands.
    expect(mockTx.invitationToken.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ acceptedById: "new-user-1" }) }));
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

  // Codex D-ID-1 diff review #1 and #4: an existing identity's acceptance takes
  // the identity lock (the one a home close or factor reset takes), then holds
  // the identity at the epoch of the session that proved it, before the link
  // is claimed. A reset since that session was minted voids the proof.
  describe("an existing identity's acceptance under the identity lock and its session's epoch", () => {
    const existing = { ...activeUser, id: "existing-1", orgId: "other-org", email: pendingInvitation.email, credentialEpoch: 2 };
    let order;
    beforeEach(() => {
      order = [];
      mockPrisma.invitationToken.findUnique.mockResolvedValue(pendingInvitation);
      mockPrisma.user.findUnique.mockResolvedValue(existing);
      mockTx.invitationToken.update.mockResolvedValue({});
      mockTx.projectAssignment.upsert.mockResolvedValue({});
      mockTx.$executeRaw = jest.fn(async (strings, ...values) => {
        order.push({ kind: "lock", sql: strings.join("?"), values });
        return 1;
      });
      mockTx.invitationToken.updateMany.mockImplementation(async () => {
        order.push({ kind: "claim" });
        return { count: 1 };
      });
    });
    afterEach(() => {
      delete mockTx.$executeRaw;
      delete mockTx.$queryRaw;
      delete mockPrisma.organizationMembership;
    });

    it("answers SESSION_REVOKED when a reset moved the epoch since the session was minted, and claims nothing", async () => {
      mockTx.$queryRaw = jest.fn(async (strings, ...values) => {
        order.push({ kind: "hold", sql: strings.join("?"), values });
        return []; // the row is at epoch 3 now
      });
      await expect(
        authService.acceptInvitation({ token: "invite-token", identityUserId: "existing-1", identityEpoch: 2 }),
      ).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
      expect(order.map((entry) => entry.kind)).toEqual(["lock", "lock", "hold"]);
      // (org, e-mail) first, then the identity.
      expect(order[0].values).toEqual([pendingInvitation.orgId, pendingInvitation.email]);
      expect(order[1].sql).toMatch(/pg_advisory_xact_lock\(hashtext\('identity'\), hashtext\(\?\)\)/);
      expect(order[1].values).toEqual(["existing-1"]);
      // FOR NO KEY UPDATE since D-ID-1 R1 (FOR SHARE upgraded to an update deadlocked).
      expect(order[2].sql).toMatch(/FROM "User" WHERE "id" = \? AND "credentialEpoch" = \? AND "status" = 'active' FOR NO KEY UPDATE$/);
      expect(order[2].values).toEqual(["existing-1", 2]);
      expect(mockTx.invitationToken.updateMany).not.toHaveBeenCalled();
      expect(mockTx.invitationToken.update).not.toHaveBeenCalled();
      expect(mockTx.projectAssignment.upsert).not.toHaveBeenCalled();
      expect(mockTx.refreshSession.create).not.toHaveBeenCalled();
    });

    it("accepts at the session's epoch and issues the workspace session held at that same epoch", async () => {
      mockTx.$queryRaw = jest.fn(async (strings, ...values) => {
        order.push({ kind: "hold", sql: strings.join("?"), values });
        return values[0] === "existing-1" && values[1] === 2 ? [{ id: "existing-1" }] : [];
      });
      mockPrisma.organizationMembership = {
        findFirst: jest.fn().mockResolvedValue({ id: "m-1", orgId: "org-1", userId: "existing-1", status: "active", role: "site_engineer", kind: "member", isAdmin: false, isOwner: false }),
        findMany: jest.fn().mockResolvedValue([]),
      };
      const result = await authService.acceptInvitation({ token: "invite-token", identityUserId: "existing-1", identityEpoch: 2 });
      expect(result.user).toMatchObject({ id: "existing-1", orgId: "org-1" });
      expect(require("jsonwebtoken").decode(result.tokens.accessToken)).toMatchObject({ sub: "existing-1", cep: 2 });
      // Lock, lock, hold, claim — then the issuance's own hold, at the same epoch.
      expect(order.map((entry) => entry.kind)).toEqual(["lock", "lock", "hold", "claim", "hold"]);
      expect(order.filter((entry) => entry.kind === "hold").map((entry) => entry.values)).toEqual([["existing-1", 2], ["existing-1", 2]]);
      expect(mockTx.refreshSession.create).toHaveBeenCalledTimes(1);
    });
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

    // Home reopens it only when the person left (D-ID-1 Q3): their membership here is `left`.
    mockPrisma.user.findUnique.mockResolvedValue({ ...closed, orgId: "org-1" });
    mockPrisma.organizationMembership = {
      findFirst: jest.fn().mockResolvedValue({ id: "m-closed", orgId: "org-1", userId: "closed-1", status: "left", role: "site_engineer", kind: "member", isAdmin: false, isOwner: false }),
      findMany: jest.fn().mockResolvedValue([]),
    };
    mockTx.user.update.mockImplementation(async ({ data }) => ({ ...closed, orgId: "org-1", ...data }));
    mockTx.invitationToken.update.mockResolvedValue({});
    mockTx.projectAssignment.upsert.mockResolvedValue({});
    try {
      await expect(authService.acceptInvitation({ token: "invite-token", name: "Closed" })).rejects.toMatchObject({ code: "INVITATION_PASSWORD_REQUIRED" });
      // Home reopens it with a new password; the link itself mints no session
      // (the account signs in afterwards, with its second factor if it has one).
      const reopened = await authService.acceptInvitation({ token: "invite-token", name: "Closed", password: "Password1" });
      expect(reopened).toMatchObject({ accepted: true, signInRequired: true, orgId: "org-1" });
      expect(reopened.tokens).toBeUndefined();
    } finally {
      delete mockPrisma.organizationMembership;
    }
    expect(mockTx.refreshSession.create).not.toHaveBeenCalled();
    // Reopening with a password its holder chooses is a credential event (D-ID-1 Q6).
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "active", passwordHash: expect.any(String), credentialEpoch: { increment: 1 } }) }),
    );
    expect(mockTx.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: "closed-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  // Owner decision D-ID-1 Q3: a suspension is undone only by the workspace's Activate.
  it.each([
    ["an active identity suspended here", { status: "active" }, { status: "suspended" }],
    ["a closed account homed here and suspended rather than left", { status: "inactive" }, { status: "suspended" }],
    ["a closed account homed here before memberships", { status: "inactive" }, null],
  ])("no link brings back %s (400 INVITATION_TOKEN_INVALID), and nothing is written", async (_label, userState, membershipState) => {
    const person = { ...activeUser, id: "person-1", orgId: "org-1", email: pendingInvitation.email, ...userState };
    mockPrisma.invitationToken.findUnique.mockResolvedValue(pendingInvitation);
    mockPrisma.user.findUnique.mockResolvedValue(person);
    mockPrisma.organizationMembership = {
      findFirst: jest.fn().mockResolvedValue(membershipState ? { id: "m-person", orgId: "org-1", userId: "person-1", role: "qs", kind: "member", isAdmin: false, isOwner: false, ...membershipState } : null),
      findMany: jest.fn().mockResolvedValue([]),
    };
    try {
      await expect(
        authService.acceptInvitation({ token: "invite-token", name: "Person", password: "Password1", identityUserId: "person-1" }),
      ).rejects.toMatchObject({ status: 400, code: "INVITATION_TOKEN_INVALID" });
    } finally {
      delete mockPrisma.organizationMembership;
    }
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockTx.invitationToken.updateMany).not.toHaveBeenCalled();
    expect(mockTx.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "invitation_accept_rejected", metadataJson: { reason: "INVITATION_TOKEN_INVALID" } }) }),
    );
  });

  // Owner decision D-ID-1 Q12: another company's SSO session proves who the
  // person is, never the inviting workspace's own access policy.
  it("accepts with a session another company's single sign-on issued, and answers signInRequired with no session", async () => {
    const existing = { ...activeUser, id: "existing-1", orgId: "other-org", email: pendingInvitation.email };
    mockPrisma.invitationToken.findUnique.mockResolvedValue(pendingInvitation);
    mockPrisma.user.findUnique.mockResolvedValue(existing);
    mockTx.invitationToken.update.mockResolvedValue({});
    mockTx.projectAssignment.upsert.mockResolvedValue({});

    const result = await authService.acceptInvitation({ token: "invite-token", identityUserId: "existing-1", identitySsoOrgId: "other-org" });

    expect(result).toEqual({ accepted: true, signInRequired: true, orgId: "org-1", reason: expect.objectContaining({ code: "SSO_SESSION_BOUND" }) });
    expect(result.tokens).toBeUndefined();
    expect(mockTx.refreshSession.create).not.toHaveBeenCalled();
    // The link is used: the acceptance stands.
    expect(mockTx.invitationToken.updateMany).toHaveBeenCalledTimes(1);
    expect(mockTx.invitationToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acceptedById: "existing-1" }) }),
    );
    // Not the identity's home: nothing on the User row is written.
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  it("refuses acceptance while the emergency membership switch is off, before the link is read (D-ID-1 Q10)", async () => {
    const previous = process.env.AUTH_MEMBERSHIP_WRITE;
    process.env.AUTH_MEMBERSHIP_WRITE = "false";
    try {
      await expect(
        authService.acceptInvitation({ token: "invite-token", name: "New User", password: "Password1" }),
      ).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" });
    } finally {
      if (previous === undefined) delete process.env.AUTH_MEMBERSHIP_WRITE;
      else process.env.AUTH_MEMBERSHIP_WRITE = previous;
    }
    expect(mockPrisma.invitationToken.findUnique).not.toHaveBeenCalled();
  });

  it("answers INVITATION_SIGN_IN_REQUIRED when two workspaces' links for one new address are accepted at once", async () => {
    mockPrisma.invitationToken.findUnique.mockResolvedValue(pendingInvitation);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockTx.user.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), { code: "P2002", meta: { target: ["email"] } }));
    await expect(
      authService.acceptInvitation({ token: "invite-token", name: "New User", password: "Password1" }),
    ).rejects.toMatchObject({ status: 401, code: "INVITATION_SIGN_IN_REQUIRED" });
  });

  // D-ID-1 N3 (pre-existing; Codex r2 bootstrap sweep): a reissue could count no
  // used link, a reset completing the first link could then commit, and the
  // reissue still revoke only unused links and mint a usable second one for an
  // administrator who has set a password. The administrator's link rows are now
  // locked (SELECT … FOR UPDATE) before the used ones are counted.
  // This is the evidence for N3: the bootstrap path needs an empty database
  // (exactly one organisation and one user) and cannot run live against the
  // certification database.
  describe("bootstrap link reissue locks the administrator's links before judging 'never set a password' (D-ID-1 N3)", () => {
    const admin = { id: "admin-1", orgId: "org-1", name: "First Admin", email: "admin@example.com", phone: null, role: "pm", status: "active", isCompanyAdmin: true, lastLogin: null };
    let links;
    let order;
    beforeEach(() => {
      order = [];
      links = [{ id: "link-1", userId: "admin-1", usedAt: null, revokedAt: null }];
      mockTx.$executeRaw = jest.fn(async (strings, ...values) => {
        order.push({ kind: "bootstrap-lock", sql: strings.join("?"), values });
        return 1;
      });
      mockTx.$queryRaw = jest.fn(async (strings, ...values) => {
        order.push({ kind: "links-lock", sql: strings.join("?"), values });
        return links.filter((link) => link.userId === values[0]).map(({ id }) => ({ id }));
      });
      mockTx.organisation = { count: jest.fn(async () => 1) };
      mockTx.user.count = jest.fn(async () => 1);
      mockTx.user.findUnique = jest.fn(async ({ where }) => (where.email === admin.email ? { ...admin } : null));
      mockTx.passwordResetToken.count = jest.fn(async ({ where }) => {
        order.push({ kind: "count-used", where });
        return links.filter((link) => link.userId === where.userId && link.usedAt !== null).length;
      });
      mockTx.passwordResetToken.updateMany.mockImplementation(async ({ where, data }) => {
        const hit = links.filter((link) => link.userId === where.userId && link.usedAt === null && link.revokedAt === null);
        hit.forEach((link) => Object.assign(link, data));
        return { count: hit.length };
      });
    });
    afterEach(() => {
      delete mockTx.$executeRaw;
      delete mockTx.$queryRaw;
      delete mockTx.organisation;
      delete mockTx.user.count;
      delete mockTx.user.findUnique;
      delete mockTx.passwordResetToken.count;
      mockTx.passwordResetToken.updateMany.mockReset();
    });

    it("takes the bootstrap lock, then locks the administrator's link rows FOR UPDATE, and only then counts the used ones", async () => {
      const result = await authService.reissueBootstrapLink({ email: "Admin@Example.com" });
      expect(result.setPasswordUrl).toEqual(expect.stringContaining("https://app.example.com/reset-password?token="));
      expect(order.map((entry) => entry.kind)).toEqual(["bootstrap-lock", "links-lock", "count-used"]);
      expect(order[1].sql).toMatch(/^SELECT "id" FROM "PasswordResetToken" WHERE "userId" = \? FOR UPDATE$/);
      expect(order[1].values).toEqual(["admin-1"]);
      expect(order[2].where).toEqual({ userId: "admin-1", usedAt: { not: null } });
      expect(mockTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mockTx.passwordResetToken.count.mock.invocationCallOrder[0]);
      // The first link is revoked; one new link is issued.
      expect(links[0]).toMatchObject({ usedAt: null, revokedAt: expect.any(Date) });
      expect(mockTx.passwordResetToken.create).toHaveBeenCalledTimes(1);
    });

    it("refuses (409 BOOTSTRAP_NOT_EMPTY), and issues no link, when a reset completing the first link commits while the reissue waits for the link rows", async () => {
      // The reset holds link-1's row (its claim); it sets the password and
      // commits, and only then does the reissue's FOR UPDATE return.
      mockTx.$queryRaw.mockImplementationOnce(async (strings, ...values) => {
        order.push({ kind: "links-lock", sql: strings.join("?"), values });
        links[0].usedAt = new Date();
        return links.map(({ id }) => ({ id }));
      });
      await expect(authService.reissueBootstrapLink({ email: "admin@example.com" })).rejects.toMatchObject({ status: 409, code: "BOOTSTRAP_NOT_EMPTY" });
      expect(mockTx.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mockTx.passwordResetToken.updateMany).not.toHaveBeenCalled();
      expect(mockTx.authAuditEvent.create).not.toHaveBeenCalled();
      expect(links[0]).toMatchObject({ usedAt: expect.any(Date), revokedAt: null });
    });
  });
});
