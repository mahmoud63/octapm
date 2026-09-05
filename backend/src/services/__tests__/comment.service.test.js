const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  rfi: { findFirst: jest.fn() },
  ncrRecord: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  comment: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  recordSubscription: {
    upsert: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockNotifications = {
  NOTIFICATION_CATEGORIES: { MENTION: "mention", COMMENT: "comment" },
  createNotifications: jest.fn(async () => ({ created: 0, recipients: [] })),
};
const mockAssertProjectAccess = jest.fn();
const mockBus = {
  EVENT_TYPES: { RECORD_CHANGED: "record.changed" },
  buildRecordEvent: jest.fn((event) => ({ type: "record.changed", ...event })),
  recordOutboundEvent: jest.fn(async () => null),
  publish: jest.fn(),
  subscribe: jest.fn(() => jest.fn()),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../project-authorization.service", () => ({
  assertProjectAccess: (...args) => mockAssertProjectAccess(...args),
}));
jest.mock("../attachment.service", () => ({
  RECORD_TYPE_MODULES: { rfi: "rfi", ncr: "ncr", ipc: "ipc", project: "project_parties" },
}));
jest.mock("../../events/bus", () => mockBus);

const { HttpError } = require("../../utils/http-error");
const service = require("../comment.service");

const ORG = "org-1";
const PROJECT = "project-1";
const AUTHOR = { id: "user-author", name: "Amal", canModerate: false };
const PM = { id: "user-pm", name: "Priya", canModerate: true };
const MENTIONED = "user-mentioned";
const FOLLOWER = "user-follower";
const RFI_ID = "rfi-1";
const COMMENT_ID = "33333333-3333-4333-8333-333333333333";

const storedComment = (overrides = {}) => ({
  id: COMMENT_ID,
  orgId: ORG,
  projectId: PROJECT,
  recordType: "rfi",
  recordId: RFI_ID,
  parentId: null,
  authorId: AUTHOR.id,
  body: "Please confirm the rebar spacing @Bilal",
  editedAt: null,
  deletedAt: null,
  createdAt: new Date("2026-09-05T10:00:00Z"),
  updatedAt: new Date("2026-09-05T10:00:00Z"),
  author: { id: AUTHOR.id, name: "Amal", email: "amal@example.com" },
  mentions: [{ userId: MENTIONED, user: { id: MENTIONED, name: "Bilal", email: null } }],
  ...overrides,
});

describe("comment service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, name: "Tower" });
    mockPrisma.rfi.findFirst.mockResolvedValue({
      id: RFI_ID,
      ref: "RFI-012",
      subject: "Rebar spacing",
      ownerUserId: FOLLOWER,
      ballInCourtUserId: MENTIONED,
    });
    mockPrisma.user.findMany.mockResolvedValue([
      { id: MENTIONED, name: "Bilal", email: null, role: "site_engineer", isCompanyAdmin: false },
    ]);
    mockAssertProjectAccess.mockResolvedValue({ id: PROJECT });
    mockPrisma.comment.create.mockImplementation(({ data }) =>
      Promise.resolve(
        storedComment({
          body: data.body,
          parentId: data.parentId,
          mentions: (data.mentions?.create || []).map((row) => ({
            userId: row.userId,
            user: { id: row.userId, name: "Bilal", email: null },
          })),
        }),
      ),
    );
    mockPrisma.recordSubscription.upsert.mockImplementation(({ create }) =>
      Promise.resolve({ ...create, id: `sub-${create.userId}` }),
    );
    mockPrisma.recordSubscription.findMany.mockResolvedValue([
      { userId: FOLLOWER, user: { id: FOLLOWER, name: "Farah", status: "active" } },
      { userId: MENTIONED, user: { id: MENTIONED, name: "Bilal", status: "active" } },
      { userId: AUTHOR.id, user: { id: AUTHOR.id, name: "Amal", status: "active" } },
    ]);
  });

  describe("createComment", () => {
    it("stores the comment with mentions, subscribes author and mentioned users, and notifies", async () => {
      const result = await service.createComment({
        orgId: ORG,
        projectId: PROJECT,
        recordType: "rfi",
        recordId: RFI_ID,
        body: "  Please confirm the rebar spacing @Bilal  ",
        mentionUserIds: [MENTIONED, MENTIONED],
        actor: AUTHOR,
      });

      expect(mockPrisma.rfi.findFirst).toHaveBeenCalledWith({
        where: { id: RFI_ID, projectId: PROJECT },
      });
      expect(mockPrisma.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            body: "Please confirm the rebar spacing @Bilal",
            authorId: AUTHOR.id,
            mentions: { create: [{ orgId: ORG, userId: MENTIONED }] },
          }),
        }),
      );

      const upserts = mockPrisma.recordSubscription.upsert.mock.calls.map(([args]) => args);
      expect(upserts.map((call) => [call.create.userId, call.create.reason])).toEqual([
        [AUTHOR.id, "commented"],
        [MENTIONED, "mentioned"],
      ]);
      // automatic follows never override an explicit unfollow
      expect(upserts.every((call) => Object.keys(call.update).length === 0)).toBe(true);

      const notifications = mockNotifications.createNotifications.mock.calls.map(([args]) => args);
      expect(notifications).toHaveLength(2);
      expect(notifications[0]).toEqual(
        expect.objectContaining({
          category: "mention",
          event: "comment.mentioned",
          recipientUserIds: [MENTIONED],
          title: "Amal mentioned you on RFI RFI-012 – Rebar spacing",
          actionUrl: `/projects/${PROJECT}/doc-control/rfi?recordId=${RFI_ID}`,
          dedupeKeyBase: `comment:${COMMENT_ID}:mention`,
        }),
      );
      // followers minus author and minus people already notified by mention
      expect(notifications[1]).toEqual(
        expect.objectContaining({
          category: "comment",
          event: "comment.created",
          recipientUserIds: [FOLLOWER],
          title: "New comment on RFI RFI-012 – Rebar spacing",
        }),
      );

      expect(mockBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "rfi", entityId: RFI_ID, action: "commented" }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: COMMENT_ID,
          body: "Please confirm the rebar spacing @Bilal",
          mentions: [{ userId: MENTIONED, name: "Bilal", email: null }],
          canEdit: true,
          canDelete: true,
        }),
      );
    });

    it("rejects records that are not on the project and unknown record types", async () => {
      mockPrisma.rfi.findFirst.mockResolvedValue(null);
      await expect(
        service.createComment({
          orgId: ORG,
          projectId: PROJECT,
          recordType: "rfi",
          recordId: "missing",
          body: "hello",
          actor: AUTHOR,
        }),
      ).rejects.toMatchObject({ status: 404, code: "COMMENT_RECORD_NOT_FOUND" });

      await expect(
        service.createComment({
          orgId: ORG,
          projectId: PROJECT,
          recordType: "invoice",
          recordId: "x",
          body: "hello",
          actor: AUTHOR,
        }),
      ).rejects.toMatchObject({ status: 400, code: "COMMENT_RECORD_TYPE_INVALID" });
    });

    it("refuses mentions of users who cannot see the project", async () => {
      mockAssertProjectAccess.mockRejectedValue(
        new HttpError(403, "PROJECT_ACCESS_DENIED", "denied"),
      );
      await expect(
        service.createComment({
          orgId: ORG,
          projectId: PROJECT,
          recordType: "rfi",
          recordId: RFI_ID,
          body: "hello",
          mentionUserIds: [MENTIONED],
          actor: AUTHOR,
        }),
      ).rejects.toMatchObject({ status: 400, code: "COMMENT_MENTION_NO_ACCESS" });
      expect(mockPrisma.comment.create).not.toHaveBeenCalled();

      mockAssertProjectAccess.mockResolvedValue({ id: PROJECT });
      mockPrisma.user.findMany.mockResolvedValue([]);
      await expect(
        service.createComment({
          orgId: ORG,
          projectId: PROJECT,
          recordType: "rfi",
          recordId: RFI_ID,
          body: "hello",
          mentionUserIds: ["user-from-other-org"],
          actor: AUTHOR,
        }),
      ).rejects.toMatchObject({ status: 400, code: "COMMENT_MENTION_INVALID" });
    });

    it("requires a non-empty body within the limit", async () => {
      await expect(
        service.createComment({
          orgId: ORG,
          projectId: PROJECT,
          recordType: "rfi",
          recordId: RFI_ID,
          body: "   ",
          actor: AUTHOR,
        }),
      ).rejects.toMatchObject({ code: "COMMENT_BODY_REQUIRED" });
      await expect(
        service.createComment({
          orgId: ORG,
          projectId: PROJECT,
          recordType: "rfi",
          recordId: RFI_ID,
          body: "x".repeat(service.MAX_BODY_LENGTH + 1),
          actor: AUTHOR,
        }),
      ).rejects.toMatchObject({ code: "COMMENT_BODY_TOO_LONG" });
    });
  });

  describe("updateComment / deleteComment", () => {
    it("lets only the author edit, and notifies newly mentioned users only", async () => {
      mockPrisma.comment.findFirst.mockResolvedValue(storedComment({ mentions: [] }));
      mockPrisma.comment.update.mockImplementation(({ data }) =>
        Promise.resolve(
          storedComment({
            body: data.body,
            editedAt: data.editedAt,
            mentions: [{ userId: MENTIONED, user: { id: MENTIONED, name: "Bilal" } }],
          }),
        ),
      );

      await expect(
        service.updateComment({
          orgId: ORG,
          projectId: PROJECT,
          commentId: COMMENT_ID,
          body: "changed",
          actor: PM,
        }),
      ).rejects.toMatchObject({ status: 403, code: "COMMENT_NOT_AUTHOR" });

      const updated = await service.updateComment({
        orgId: ORG,
        projectId: PROJECT,
        commentId: COMMENT_ID,
        body: "changed",
        mentionUserIds: [MENTIONED],
        actor: AUTHOR,
      });
      expect(mockPrisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            body: "changed",
            editedAt: expect.any(Date),
            mentions: { create: [{ orgId: ORG, userId: MENTIONED }] },
          }),
        }),
      );
      expect(mockNotifications.createNotifications).toHaveBeenCalledTimes(1);
      expect(mockNotifications.createNotifications.mock.calls[0][0]).toEqual(
        expect.objectContaining({ category: "mention", recipientUserIds: [MENTIONED] }),
      );
      expect(updated.editedAt).toBeTruthy();
    });

    it("soft-deletes for the author or a moderator, never for other users", async () => {
      mockPrisma.comment.findFirst.mockResolvedValue(storedComment());
      mockPrisma.comment.update.mockResolvedValue({});

      await expect(
        service.deleteComment({
          orgId: ORG,
          projectId: PROJECT,
          commentId: COMMENT_ID,
          actor: { id: "user-other", canModerate: false },
        }),
      ).rejects.toMatchObject({ status: 403, code: "COMMENT_DELETE_FORBIDDEN" });

      const result = await service.deleteComment({
        orgId: ORG,
        projectId: PROJECT,
        commentId: COMMENT_ID,
        actor: PM,
      });
      expect(result).toEqual({ deleted: true, id: COMMENT_ID });
      expect(mockPrisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date), deletedBy: PM.id }),
        }),
      );
      expect(mockBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ action: "comment_deleted" }),
      );
    });
  });

  describe("subscriptions", () => {
    it("follows and unfollows; unfollow mutes the row", async () => {
      mockPrisma.recordSubscription.upsert.mockResolvedValue({});
      mockPrisma.recordSubscription.findFirst.mockResolvedValue({
        id: "sub-1",
        orgId: ORG,
        projectId: PROJECT,
        recordType: "rfi",
        recordId: RFI_ID,
        userId: AUTHOR.id,
        reason: "manual",
        muted: true,
      });
      const subscriptionRow = (userId, status) => ({
        id: `sub-${userId}`,
        orgId: ORG,
        projectId: PROJECT,
        recordType: "rfi",
        recordId: RFI_ID,
        userId,
        reason: "assigned",
        muted: false,
        user: { id: userId, name: userId, status },
      });
      mockPrisma.recordSubscription.findMany.mockResolvedValue([
        subscriptionRow(FOLLOWER, "active"),
        subscriptionRow("gone", "inactive"),
      ]);

      const state = await service.setSubscription({
        orgId: ORG,
        projectId: PROJECT,
        recordType: "rfi",
        recordId: RFI_ID,
        userId: AUTHOR.id,
        follow: false,
      });
      expect(mockPrisma.recordSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ muted: true, reason: "manual" }),
          update: { muted: true },
        }),
      );
      expect(state.following).toBe(false);
      expect(state.count).toBe(1); // inactive users are not counted as followers
      expect(state.subscribers[0]).toEqual(
        expect.objectContaining({
          userId: FOLLOWER,
          path: `/projects/${PROJECT}/doc-control/rfi?recordId=${RFI_ID}`,
        }),
      );

      await service.setSubscription({
        orgId: ORG,
        projectId: PROJECT,
        recordType: "rfi",
        recordId: RFI_ID,
        userId: AUTHOR.id,
        follow: true,
      });
      expect(mockPrisma.recordSubscription.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({ update: { muted: false, reason: "manual" } }),
      );
    });

    it("auto-follows creators and referenced users from record events", async () => {
      const count = await service.handleRecordEvent({
        type: "record.changed",
        orgId: ORG,
        projectId: PROJECT,
        entityType: "rfi",
        entityId: RFI_ID,
        action: "created",
        actorId: AUTHOR.id,
      });
      expect(count).toBe(3);
      const upserts = mockPrisma.recordSubscription.upsert.mock.calls.map(([args]) => [
        args.create.userId,
        args.create.reason,
      ]);
      expect(upserts).toEqual([
        [AUTHOR.id, "created"],
        [FOLLOWER, "assigned"],
        [MENTIONED, "assigned"],
      ]);

      mockPrisma.recordSubscription.upsert.mockClear();
      expect(
        await service.handleRecordEvent({
          type: "record.changed",
          orgId: ORG,
          projectId: PROJECT,
          entityType: "invoice",
          entityId: "x",
          action: "created",
          actorId: AUTHOR.id,
        }),
      ).toBe(0);
      expect(
        await service.handleRecordEvent({
          type: "record.changed",
          orgId: ORG,
          projectId: PROJECT,
          entityType: "rfi",
          entityId: RFI_ID,
          action: "commented",
          actorId: AUTHOR.id,
        }),
      ).toBe(0);
      expect(mockPrisma.recordSubscription.upsert).not.toHaveBeenCalled();
    });
  });

  describe("listComments", () => {
    it("pages live comments and marks the viewer's own rows editable", async () => {
      mockPrisma.comment.findMany.mockResolvedValue([
        storedComment(),
        storedComment({ id: "c-2", authorId: PM.id, author: { id: PM.id, name: "Priya" } }),
      ]);
      const result = await service.listComments({
        orgId: ORG,
        projectId: PROJECT,
        recordType: "rfi",
        recordId: RFI_ID,
        viewer: AUTHOR,
        limit: 1,
      });
      expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: ORG, projectId: PROJECT, recordType: "rfi", recordId: RFI_ID, deletedAt: null },
          take: 2,
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(expect.objectContaining({ canEdit: true, canDelete: true }));
      expect(result.pagination.nextCursor).toBe(COMMENT_ID);
    });
  });
});
