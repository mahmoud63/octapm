// The e-mail's account is read under the invitation lock (D-ID-1 Q3), so the
// transaction and the client share one user model here.
const mockUser = {
  findUnique: jest.fn(),
};

const mockTx = {
  user: mockUser,
  // The (org, e-mail) advisory lock invitations, acceptances and suspensions take.
  $executeRaw: jest.fn(async () => 1),
  invitationToken: {
    create: jest.fn(),
    // A resend re-reads the link it replaces under that lock (Codex D-ID-1 diff review, LOW "resend raced acceptance").
    findFirst: jest.fn(),
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
  user: mockUser,
  invitationToken: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  authAuditEvent: {
    create: jest.fn(),
    findMany: jest.fn(),
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
    // Only a resend reads the link under the lock; anything else that did would find nothing.
    mockTx.invitationToken.findFirst.mockResolvedValue(null);
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

  // Owner decision D-ID-1: POST /users is the deprecated alias of the
  // invitation. It never makes an account, whatever the e-mail, and its answer
  // is the invitation's (data.id is the invitation id).
  it("POST /users (createUser) is an invitation for every e-mail and tells nothing of the identity", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "other-user", orgId: "other-org", email: "someone@example.com", status: "inactive", name: "Real Name", phone: "+1 555 0100", lastLogin: new Date() });
    // A client that knows memberships, with no membership of this person here.
    mockTx.organizationMembership = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() };
    mockTx.user.create = jest.fn();
    let result;
    try {
      result = await userService.createUser({ orgId: "org-1", actor: { id: "pm-1", role: "pm" }, payload: { email: "someone@example.com", name: "Typed Name", role: "qs" } });
    } finally {
      const membershipModel = mockTx.organizationMembership;
      delete mockTx.organizationMembership;
      expect(membershipModel.create).not.toHaveBeenCalled();
      expect(membershipModel.update).not.toHaveBeenCalled();
      expect(mockTx.user.create).not.toHaveBeenCalled();
      delete mockTx.user.create;
    }
    expect(result).toMatchObject({ id: "invite-1", invited: true, email: "someone@example.com", role: "qs", status: "pending" });
    for (const key of ["name", "phone", "lastLogin", "existingIdentity", "orgId"]) expect(result).not.toHaveProperty(key);
    expect(mockTx.invitationToken.create).toHaveBeenCalledTimes(1);
    expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "invitation_created", metadataJson: expect.objectContaining({ via: "users.create" }) }) }),
    );
  });

  it("POST /users answers exactly as POST /users/invitations for a brand-new e-mail", async () => {
    const viaAlias = await userService.createUser({ orgId: "org-1", actor: { id: "pm-1", role: "pm" }, payload: { email: "fresh@example.com", role: "qs" } });
    const viaInvite = await userService.inviteUser({ orgId: "org-1", actor: { id: "pm-1", role: "pm" }, payload: { email: "fresh@example.com", role: "qs" } });
    expect(Object.keys(viaAlias).sort()).toEqual(Object.keys(viaInvite).sort());
    expect(viaAlias).toMatchObject({ id: "invite-1", invited: true, status: "pending" });
  });

  describe("who is already part of the workspace (D-ID-1 Q3)", () => {
    const withMembership = (membership) => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "user-9", orgId: "org-1", status: "active" });
      mockTx.organizationMembership = { findFirst: jest.fn().mockResolvedValue(membership) };
    };
    afterEach(() => {
      delete mockTx.organizationMembership;
    });

    it("refuses a workspace invitation for an active member, but a project invitation still assigns them", async () => {
      withMembership({ id: "m-1", orgId: "org-1", userId: "user-9", status: "active", kind: "member", role: "qs" });
      await expect(
        userService.inviteUser({ orgId: "org-1", actor: { id: "pm-1" }, payload: { email: "member@example.com", role: "qs" } }),
      ).rejects.toMatchObject({ status: 409, code: "ALREADY_MEMBER" });
      expect(mockTx.invitationToken.create).not.toHaveBeenCalled();

      await expect(
        userService.inviteUser({ orgId: "org-1", actor: { id: "pm-1" }, payload: { email: "member@example.com", role: "qs", projectId: "project-1" } }),
      ).resolves.toMatchObject({ invited: true, projectId: "project-1" });
    });

    it("refuses every invitation, a project one included, for a suspended member: only Activate brings them back", async () => {
      withMembership({ id: "m-1", orgId: "org-1", userId: "user-9", status: "suspended", kind: "member", role: "qs" });
      for (const payload of [
        { email: "member@example.com", role: "qs" },
        { email: "member@example.com", role: "qs", projectId: "project-1" },
      ]) {
        await expect(userService.inviteUser({ orgId: "org-1", actor: { id: "pm-1" }, payload })).rejects.toMatchObject({
          status: 409,
          code: "ALREADY_MEMBER",
        });
      }
      expect(mockTx.invitationToken.create).not.toHaveBeenCalled();
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("refuses a closed account homed here before memberships, for every invitation", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: "user-9", orgId: "org-1", status: "inactive" });
      await expect(
        userService.inviteUser({ orgId: "org-1", actor: { id: "pm-1" }, payload: { email: "legacy@example.com", role: "qs", projectId: "project-1" } }),
      ).rejects.toMatchObject({ status: 409, code: "ALREADY_MEMBER" });
    });

    it("invites someone who left again", async () => {
      withMembership({ id: "m-1", orgId: "org-1", userId: "user-9", status: "left", kind: "member", role: "qs" });
      await expect(
        userService.inviteUser({ orgId: "org-1", actor: { id: "pm-1" }, payload: { email: "former@example.com", role: "qs" } }),
      ).resolves.toMatchObject({ invited: true, status: "pending" });
    });
  });

  it("an e-mail that cannot be sent leaves the invitation pending and answers 502 INVITATION_EMAIL_FAILED", async () => {
    mockSendEmail.mockRejectedValue(Object.assign(new Error("provider down"), { code: "EMAIL_DELIVERY_FAILED" }));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        userService.inviteUser({ orgId: "org-1", actor: { id: "pm-1", role: "pm" }, payload: { email: "someone@example.com", role: "qs" } }),
      ).rejects.toMatchObject({ status: 502, code: "INVITATION_EMAIL_FAILED", details: { invitationId: "invite-1" } });
    } finally {
      consoleError.mockRestore();
    }
    expect(mockTx.invitationToken.create).toHaveBeenCalledTimes(1);
    // Nothing revokes the invitation that was saved.
    expect(mockTx.invitationToken.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "invitation_delivery_failed", entityId: "invite-1" }) }),
    );
  });

  it("refuses to invite while the emergency membership switch is off, before anything is read (D-ID-1 Q10)", async () => {
    const previous = process.env.AUTH_MEMBERSHIP_WRITE;
    process.env.AUTH_MEMBERSHIP_WRITE = "false";
    try {
      await expect(
        userService.inviteUser({ orgId: "org-1", actor: { id: "pm-1" }, payload: { email: "someone@example.com", role: "qs" } }),
      ).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" });
    } finally {
      if (previous === undefined) delete process.env.AUTH_MEMBERSHIP_WRITE;
      else process.env.AUTH_MEMBERSHIP_WRITE = previous;
    }
    expect(mockPrisma.organisation.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  describe("pending invitations (D-ID-1 Q5)", () => {
    const stored = {
      id: "invite-7",
      orgId: "org-1",
      email: "someone@example.com",
      role: "qs",
      status: "pending",
      projectId: "project-1",
      companyId: "company-1",
      projectPartyId: null,
      invitedById: "pm-1",
      note: "Welcome",
      acceptedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      tokenHash: "secret-hash",
    };

    it("lists pending, unexpired invitations with their note and last delivery failure, and no token", async () => {
      const failedAt = new Date("2026-10-01T10:00:00Z");
      mockPrisma.invitationToken.findMany.mockResolvedValue([stored]);
      mockPrisma.authAuditEvent.findMany.mockResolvedValue([{ entityId: "invite-7", createdAt: failedAt }]);
      const result = await userService.listInvitations({ orgId: "org-1", query: {} });
      expect(mockPrisma.invitationToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: "org-1", status: "pending", acceptedAt: null, revokedAt: null, expiresAt: { gt: expect.any(Date) } }),
        }),
      );
      expect(result.pagination).toEqual({ limit: 50, nextCursor: null });
      expect(result.items).toEqual([expect.objectContaining({ id: "invite-7", note: "Welcome", lastDeliveryFailedAt: failedAt })]);
      expect(result.items[0]).not.toHaveProperty("tokenHash");
    });

    it("revokes a pending invitation once; a second revoke answers 409 INVITATION_NOT_PENDING", async () => {
      mockPrisma.invitationToken.findFirst.mockResolvedValue(stored);
      mockTx.invitationToken.updateMany.mockResolvedValueOnce({ count: 1 });
      await expect(
        userService.revokeInvitation({ orgId: "org-1", invitationId: "invite-7", actor: { id: "pm-1", role: "pm" } }),
      ).resolves.toEqual({ id: "invite-7", revoked: true });
      expect(mockTx.invitationToken.updateMany).toHaveBeenCalledWith({
        where: { id: "invite-7", orgId: "org-1", status: "pending", acceptedAt: null, revokedAt: null },
        data: { status: "revoked", revokedAt: expect.any(Date) },
      });
      expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "invitation_revoked", entityId: "invite-7" }) }),
      );

      mockTx.invitationToken.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        userService.revokeInvitation({ orgId: "org-1", invitationId: "invite-7", actor: { id: "pm-1" } }),
      ).rejects.toMatchObject({ status: 409, code: "INVITATION_NOT_PENDING" });
    });

    it("answers 404 INVITATION_NOT_FOUND for an invitation of another workspace", async () => {
      mockPrisma.invitationToken.findFirst.mockResolvedValue(null);
      await expect(
        userService.revokeInvitation({ orgId: "org-1", invitationId: "invite-x", actor: { id: "pm-1" } }),
      ).rejects.toMatchObject({ status: 404, code: "INVITATION_NOT_FOUND" });
      await expect(
        userService.resendInvitation({ orgId: "org-1", invitationId: "invite-x", actor: { id: "pm-1" } }),
      ).rejects.toMatchObject({ status: 404, code: "INVITATION_NOT_FOUND" });
      expect(mockPrisma.invitationToken.findFirst).toHaveBeenCalledWith({ where: { id: "invite-x", orgId: "org-1" } });
    });

    it("resends the stored offer, never a re-typed one, and replaces the earlier link", async () => {
      mockPrisma.invitationToken.findFirst.mockResolvedValue(stored);
      mockTx.invitationToken.findFirst.mockResolvedValue({ status: "pending", acceptedAt: null });
      mockPrisma.company = { findFirst: jest.fn().mockResolvedValue({ id: "company-1", name: "Sub Co" }) };
      mockTx.invitationToken.findMany.mockResolvedValue([{ id: "invite-7" }]);
      try {
        const result = await userService.resendInvitation({ orgId: "org-1", invitationId: "invite-7", actor: { id: "pm-1", role: "pm" } });
        expect(result).toMatchObject({ invited: true, status: "pending" });
      } finally {
        delete mockPrisma.company;
      }
      // The link being replaced is re-read under the (org, e-mail) lock, after it is taken.
      expect(mockTx.invitationToken.findFirst).toHaveBeenCalledWith({ where: { id: "invite-7", orgId: "org-1" }, select: { status: true, acceptedAt: true } });
      expect(mockTx.$executeRaw).toHaveBeenCalledWith(expect.anything(), "org-1", "someone@example.com");
      expect(mockTx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mockTx.invitationToken.findFirst.mock.invocationCallOrder[0]);
      expect(mockTx.invitationToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ email: "someone@example.com", role: "qs", projectId: "project-1", companyId: "company-1", projectPartyId: null, note: "Welcome" }),
      });
      expect(mockTx.invitationToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { in: ["invite-7"] } }), data: expect.objectContaining({ status: "revoked" }) }),
      );
      expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "invitation_created", metadataJson: expect.objectContaining({ via: "users.invitation_resend" }) }) }),
      );
    });

    it("does not resend an accepted invitation", async () => {
      mockPrisma.invitationToken.findFirst.mockResolvedValue({ ...stored, status: "accepted", acceptedAt: new Date() });
      await expect(
        userService.resendInvitation({ orgId: "org-1", invitationId: "invite-7", actor: { id: "pm-1" } }),
      ).rejects.toMatchObject({ status: 409, code: "INVITATION_NOT_PENDING" });
      expect(mockTx.invitationToken.create).not.toHaveBeenCalled();
    });

    // Codex D-ID-1 diff review (LOW, resend raced acceptance): the link was
    // pending when the resend read it, and accepted before the resend took the
    // (org, e-mail) lock. Judged again under the lock: nothing to send again.
    it.each([
      ["accepted meanwhile", { status: "accepted", acceptedAt: new Date() }],
      ["accepted meanwhile (stamped, status not yet read back)", { status: "pending", acceptedAt: new Date() }],
      ["gone meanwhile", null],
    ])("answers 409 INVITATION_NOT_PENDING when the link was %s, and writes and sends nothing", async (_label, underLock) => {
      mockPrisma.invitationToken.findFirst.mockResolvedValue(stored);
      mockTx.invitationToken.findFirst.mockResolvedValue(underLock);
      mockTx.invitationToken.findMany.mockResolvedValue([{ id: "invite-7" }]);
      mockPrisma.company = { findFirst: jest.fn().mockResolvedValue({ id: "company-1", name: "Sub Co" }) };
      try {
        await expect(
          userService.resendInvitation({ orgId: "org-1", invitationId: "invite-7", actor: { id: "pm-1", role: "pm" } }),
        ).rejects.toMatchObject({ status: 409, code: "INVITATION_NOT_PENDING" });
      } finally {
        delete mockPrisma.company;
      }
      expect(mockTx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mockTx.invitationToken.findFirst.mock.invocationCallOrder[0]);
      expect(mockTx.invitationToken.create).not.toHaveBeenCalled();
      expect(mockTx.invitationToken.updateMany).not.toHaveBeenCalled();
      expect(mockTx.authAuditEvent.create).not.toHaveBeenCalled();
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });
});
