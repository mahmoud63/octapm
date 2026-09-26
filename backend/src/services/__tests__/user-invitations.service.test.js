const mockTx = {
  invitationToken: {
    create: jest.fn(),
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
});
