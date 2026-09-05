const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: "user-1",
      orgId: "org-1",
      name: "Amal",
      role: req.get("x-role") || "site_engineer",
      isCompanyAdmin: req.get("x-company-admin") === "1",
    };
    next();
  },
}));

const mockService = {
  RECORD_TYPES: ["ncr", "rfi", "ipc"],
  MAX_BODY_LENGTH: 5000,
  MAX_MENTIONS: 20,
  moduleForRecordType: (recordType) => {
    const map = { ncr: "ncr", rfi: "rfi", ipc: "ipc" };
    if (!map[recordType]) {
      const { HttpError } = require("../../utils/http-error");
      throw new HttpError(400, "COMMENT_RECORD_TYPE_INVALID", "bad type");
    }
    return map[recordType];
  },
  listComments: jest.fn(),
  createComment: jest.fn(),
  getComment: jest.fn(),
  updateComment: jest.fn(),
  deleteComment: jest.fn(),
  getSubscriptionState: jest.fn(),
  setSubscription: jest.fn(),
  listMySubscriptions: jest.fn(),
};
jest.mock("../../services/comment.service", () => mockService);

const commentsRouter = require("../comments");
const subscriptionsRouter = require("../subscriptions");

const COMMENT_ID = "11111111-1111-4111-8111-111111111111";
const MENTION_ID = "22222222-2222-4222-8222-222222222222";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/projects/:projectId/comments", commentsRouter);
  app.use("/projects/:projectId/subscriptions", subscriptionsRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || "INTERNAL_ERROR", message: err.message },
    }),
  );
  return app;
};

describe("comment and subscription routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockService.listComments.mockResolvedValue({ items: [], pagination: { limit: 50, nextCursor: null } });
    mockService.createComment.mockResolvedValue({ id: COMMENT_ID });
    mockService.getComment.mockResolvedValue({ id: COMMENT_ID, recordType: "ncr", recordId: "ncr-1" });
    mockService.updateComment.mockResolvedValue({ id: COMMENT_ID, body: "edited" });
    mockService.deleteComment.mockResolvedValue({ deleted: true, id: COMMENT_ID });
    mockService.getSubscriptionState.mockResolvedValue({ following: false, subscribers: [], count: 0 });
    mockService.setSubscription.mockResolvedValue({ following: true, subscribers: [], count: 1 });
    mockService.listMySubscriptions.mockResolvedValue({ items: [] });
  });

  it("reads comments with the record module's read permission", async () => {
    const app = buildApp();
    const ok = await request(app)
      .get("/projects/project-1/comments?recordType=ncr&recordId=ncr-1&limit=10&order=desc")
      .set("x-role", "warehouse");
    expect(ok.status).toBe(200);
    expect(mockService.listComments).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        projectId: "project-1",
        recordType: "ncr",
        recordId: "ncr-1",
        limit: 10,
        order: "desc",
        viewer: expect.objectContaining({ id: "user-1", canModerate: false }),
      }),
    );

    // site engineers cannot read IPCs → cannot read their comments either
    const denied = await request(app)
      .get("/projects/project-1/comments?recordType=ipc&recordId=ipc-1")
      .set("x-role", "site_engineer");
    expect(denied.status).toBe(403);

    const bad = await request(app).get("/projects/project-1/comments?recordType=invoice&recordId=x");
    expect(bad.status).toBe(400);
  });

  it("creates a comment with validated mentions and passes the actor", async () => {
    const app = buildApp();
    const created = await request(app)
      .post("/projects/project-1/comments")
      .set("x-role", "site_engineer")
      .send({
        recordType: "ncr",
        recordId: "ncr-1",
        body: "Rework scheduled for Monday",
        mentionUserIds: [MENTION_ID],
      });
    expect(created.status).toBe(201);
    expect(mockService.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        recordType: "ncr",
        recordId: "ncr-1",
        body: "Rework scheduled for Monday",
        mentionUserIds: [MENTION_ID],
        actor: expect.objectContaining({ id: "user-1", name: "Amal" }),
      }),
    );

    const badMention = await request(app)
      .post("/projects/project-1/comments")
      .send({ recordType: "ncr", recordId: "ncr-1", body: "x", mentionUserIds: ["not-a-uuid"] });
    expect(badMention.status).toBe(400);

    const empty = await request(app)
      .post("/projects/project-1/comments")
      .send({ recordType: "ncr", recordId: "ncr-1", body: "   " });
    expect(empty.status).toBe(400);
    expect(mockService.createComment).toHaveBeenCalledTimes(1);
  });

  it("edits and removes through the service with moderator context", async () => {
    const app = buildApp();
    const edited = await request(app)
      .patch(`/projects/project-1/comments/${COMMENT_ID}`)
      .send({ body: "edited" });
    expect(edited.status).toBe(200);
    expect(mockService.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: COMMENT_ID, body: "edited" }),
    );

    const removed = await request(app)
      .delete(`/projects/project-1/comments/${COMMENT_ID}`)
      .set("x-role", "pm");
    expect(removed.status).toBe(200);
    expect(mockService.deleteComment).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: COMMENT_ID,
        actor: expect.objectContaining({ canModerate: true }),
      }),
    );

    const adminRemoved = await request(app)
      .delete(`/projects/project-1/comments/${COMMENT_ID}`)
      .set("x-role", "warehouse")
      .set("x-company-admin", "1");
    expect(adminRemoved.status).toBe(200);
    expect(mockService.deleteComment).toHaveBeenLastCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ canModerate: true }) }),
    );

    // the comment's own record module gates access, not the request body
    mockService.getComment.mockResolvedValue({ id: COMMENT_ID, recordType: "ipc", recordId: "ipc-1" });
    const denied = await request(app)
      .delete(`/projects/project-1/comments/${COMMENT_ID}`)
      .set("x-role", "site_engineer");
    expect(denied.status).toBe(403);
  });

  it("follows and unfollows records, and lists the caller's subscriptions", async () => {
    const app = buildApp();
    const state = await request(app)
      .get("/projects/project-1/subscriptions?recordType=rfi&recordId=rfi-1")
      .set("x-role", "site_engineer");
    expect(state.status).toBe(200);
    expect(mockService.getSubscriptionState).toHaveBeenCalledWith(
      expect.objectContaining({ recordType: "rfi", recordId: "rfi-1", userId: "user-1" }),
    );

    const follow = await request(app)
      .put("/projects/project-1/subscriptions")
      .send({ recordType: "rfi", recordId: "rfi-1", follow: "true" });
    expect(follow.status).toBe(200);
    expect(mockService.setSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ recordType: "rfi", recordId: "rfi-1", follow: true }),
    );

    const missingFlag = await request(app)
      .put("/projects/project-1/subscriptions")
      .send({ recordType: "rfi", recordId: "rfi-1" });
    expect(missingFlag.status).toBe(400);

    const mine = await request(app).get("/projects/project-1/subscriptions/mine?limit=5");
    expect(mine.status).toBe(200);
    expect(mockService.listMySubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", limit: 5 }),
    );
  });
});
