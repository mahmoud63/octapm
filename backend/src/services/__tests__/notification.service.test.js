const now = new Date("2026-06-12T12:00:00.000Z");

const mockPrisma = {
  $transaction: jest.fn(),
  user: {
    findMany: jest.fn(),
  },
  project: {
    findMany: jest.fn(),
  },
  task: {
    findMany: jest.fn(),
  },
  rfi: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  notification: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  notificationPreference: {
    findMany: jest.fn(),
    createMany: jest.fn(),
    upsert: jest.fn(),
  },
  notificationDeliveryAttempt: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockSendEmail = jest.fn();

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../email.service", () => ({
  sendEmail: mockSendEmail,
}));

const notificationService = require("../notification.service");

const activeUser = {
  id: "user-1",
  orgId: "org-1",
  name: "Site Engineer",
  email: "site@example.com",
  role: "site_engineer",
};

const pmUser = {
  id: "pm-1",
  orgId: "org-1",
  name: "Project Manager",
  email: "pm@example.com",
  role: "pm",
};

describe("notification service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((callback) =>
      callback(mockPrisma),
    );
    mockPrisma.user.findMany.mockResolvedValue([activeUser]);
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.notificationPreference.findMany.mockResolvedValue([]);
    mockPrisma.notification.create.mockImplementation(async ({ data }) => ({
      id: `not-${mockPrisma.notification.create.mock.calls.length}`,
      ...data,
      createdAt: now,
      updatedAt: now,
    }));
    mockPrisma.notificationDeliveryAttempt.create.mockResolvedValue({});
    mockSendEmail.mockResolvedValue({ delivered: true, provider: "webhook" });
  });

  it("creates durable in-app notifications and queued email attempts by default", async () => {
    const result = await notificationService.createNotifications({
      orgId: "org-1",
      projectId: "project-1",
      recipientUserIds: ["user-1"],
      category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL,
      event: "workflow.submitted",
      title: "RFI needs approval",
      message: "RFI-001 needs approval.",
      entityType: "rfi",
      entityId: "rfi-1",
      dedupeKeyBase: "workflow:event-1",
    });

    expect(result.created).toBe(1);
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        projectId: "project-1",
        recipientUserId: "user-1",
        category: "approval",
        inAppVisible: true,
        dedupeKey: "workflow:event-1:user-1",
      }),
    });
    expect(mockPrisma.notificationDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationId: "not-1",
        orgId: "org-1",
        userId: "user-1",
        channel: "email",
        status: "pending",
      }),
    });
  });

  it("honors user email preferences while keeping in-app alerts visible", async () => {
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      {
        id: "pref-1",
        userId: "user-1",
        category: "approval",
        inAppEnabled: true,
        emailEnabled: false,
        digestEnabled: false,
        dueSoonDays: 3,
        updatedAt: now,
      },
    ]);

    await notificationService.createNotifications({
      orgId: "org-1",
      recipientUserIds: ["user-1"],
      category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL,
      event: "workflow.approved",
      title: "RFI approved",
      message: "RFI response approved.",
    });

    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ inAppVisible: true }),
    });
    expect(
      mockPrisma.notificationDeliveryAttempt.create,
    ).not.toHaveBeenCalled();
  });

  it("fans out submitted workflow events to project managers", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue({
      id: "rfi-1",
      projectId: "project-1",
      ref: "RFI-001",
      subject: "Confirm embed plates",
      status: "open",
      // Free-text refs are ignored (OCTA-DATA-REFS-004): only id columns
      // resolve recipients, so no user lookup happens for this value.
      raisedBy: "site@example.com",
      owner: "Project Manager",
    });
    mockPrisma.user.findMany
      .mockResolvedValueOnce([pmUser])
      .mockResolvedValueOnce([]);

    const result = await notificationService.createWorkflowNotifications({
      tx: mockPrisma,
      workflowEvent: {
        id: "event-1",
        orgId: "org-1",
        projectId: "project-1",
        recordType: "rfi",
        recordId: "rfi-1",
        workflowType: "rfi",
        action: "submitted",
        decision: "submitted",
        fromStatus: "open",
        toStatus: "open",
        actorId: "user-1",
        actorRole: "site_engineer",
        comment: "Ready for response",
        metadata: {},
      },
    });

    expect(result.recipients).toEqual(["pm-1"]);
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientUserId: "pm-1",
        category: "approval",
        title: "RFI RFI-001 needs approval",
        entityType: "rfi",
        entityId: "rfi-1",
      }),
    });
  });

  it("sends pending email attempts and records provider results", async () => {
    mockPrisma.notificationDeliveryAttempt.findMany.mockResolvedValue([
      {
        id: "attempt-1",
        notificationId: "not-1",
        orgId: "org-1",
        userId: "user-1",
        channel: "email",
        status: "pending",
        attemptNumber: 1,
        notification: {
          id: "not-1",
          orgId: "org-1",
          recipientUserId: "user-1",
          title: "Approval needed",
          message: "Please review the RFI.",
          category: "approval",
          event: "workflow.submitted",
          entityType: "rfi",
          entityId: "rfi-1",
          actionUrl: "/projects/project-1",
          recipient: activeUser,
        },
      },
    ]);

    const result = await notificationService.processPendingEmailDeliveries({
      now,
    });

    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0, processed: 1 });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "site@example.com",
        subject: "Approval needed",
        metadata: expect.objectContaining({ notificationId: "not-1" }),
      }),
    );
    expect(mockPrisma.notificationDeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: "attempt-1" },
      data: expect.objectContaining({
        status: "sent",
        provider: "webhook",
        sentAt: now,
      }),
    });
  });

  it("records failed email attempts and queues retry attempts", async () => {
    mockSendEmail.mockRejectedValueOnce(
      Object.assign(new Error("Provider unavailable"), {
        code: "EMAIL_DELIVERY_FAILED",
      }),
    );
    mockPrisma.notificationDeliveryAttempt.findMany.mockResolvedValue([
      {
        id: "attempt-1",
        notificationId: "not-1",
        orgId: "org-1",
        userId: "user-1",
        channel: "email",
        status: "pending",
        attemptNumber: 1,
        notification: {
          id: "not-1",
          orgId: "org-1",
          recipientUserId: "user-1",
          title: "Approval needed",
          message: "Please review the RFI.",
          category: "approval",
          event: "workflow.submitted",
          recipient: activeUser,
        },
      },
    ]);

    const result = await notificationService.processPendingEmailDeliveries({
      now,
    });

    expect(result.failed).toBe(1);
    expect(mockPrisma.notificationDeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: "attempt-1" },
      data: expect.objectContaining({
        status: "failed",
        errorCode: "EMAIL_DELIVERY_FAILED",
        errorMessage: "Provider unavailable",
      }),
    });
    expect(mockPrisma.notificationDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationId: "not-1",
        status: "pending",
        attemptNumber: 2,
      }),
    });
  });
});
