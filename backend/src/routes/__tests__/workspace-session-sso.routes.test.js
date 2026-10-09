/**
 * Certification finding L10: the workspace-switch route reads the SSO binding
 * from the presented token and hands it to the service, which refuses to
 * open any other workspace with it. A token without the binding is passed
 * through as before.
 *
 * Owner decision D-ID-1 Q6: a token minted before the identity's last
 * credential event is refused here too (401 SESSION_REVOKED), so an old
 * bearer cannot be turned into a fresh session.
 */

const mockIssue = jest.fn();
// The route reads the identity's credential epoch (D-ID-1 Q6).
const mockPrisma = { user: { findUnique: jest.fn() } };
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../../services/auth.service", () => ({ issueWorkspaceSession: (...args) => mockIssue(...args) }));
jest.mock("../../services/workspace-link.service", () => ({ resolveProjectWorkspace: jest.fn() }));

const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { register } = require("../workspaces");
const { errorHandler } = require("../../middleware/error-handler");

const SECRET = "workspace-session-test-secret";
const app = () => {
  const application = express();
  application.use(express.json());
  const router = express.Router();
  register(router, { sendSession: (_req, res, result) => res.json({ success: true, data: result }), getRequestContext: () => ({}) });
  application.use("/auth", router);
  application.use(errorHandler);
  return application;
};
const token = (claims) => jwt.sign({ sub: "user-1", orgId: "org-a", type: "access", ...claims }, SECRET, { expiresIn: "5m" });
const ORG_B = "2b6f7c1e-1d0a-4e8b-9a6e-3c1f0b7d9e21";

describe("POST /auth/workspaces/:orgId/session — the SSO binding", () => {
  const saved = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = saved;
  });
  beforeEach(() => {
    mockIssue.mockReset();
    mockIssue.mockResolvedValue({ user: { id: "user-1" }, tokens: { accessToken: "new" }, workspace: {}, memberships: [] });
    mockPrisma.user.findUnique.mockReset();
    mockPrisma.user.findUnique.mockResolvedValue({ credentialEpoch: 0 });
  });

  it("passes the token's sso claim to the service", async () => {
    await request(app())
      .post(`/auth/workspaces/${ORG_B}/session`)
      .set("authorization", `Bearer ${token({ sso: "org-a" })}`)
      .send({})
      .expect(200);
    expect(mockIssue).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", orgId: ORG_B, ssoOrgId: "org-a" }), expect.anything());
  });

  it("passes ssoOrgId: null for a token without the binding (an ordinary password session)", async () => {
    await request(app())
      .post(`/auth/workspaces/${ORG_B}/session`)
      .set("authorization", `Bearer ${token({})}`)
      .send({})
      .expect(200);
    expect(mockIssue).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", orgId: ORG_B, ssoOrgId: null }), expect.anything());
  });

  it("surfaces the service's refusal when the SSO session is bound elsewhere", async () => {
    const { HttpError } = require("../../utils/http-error");
    mockIssue.mockRejectedValue(new HttpError(403, "SSO_SESSION_BOUND", "bound"));
    const res = await request(app())
      .post(`/auth/workspaces/${ORG_B}/session`)
      .set("authorization", `Bearer ${token({ sso: "org-a" })}`)
      .send({})
      .expect(403);
    expect(res.body.error.code).toBe("SSO_SESSION_BOUND");
  });

  it("refuses a token minted before the identity's last credential event, without minting anything", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ credentialEpoch: 1 });
    const res = await request(app())
      .post(`/auth/workspaces/${ORG_B}/session`)
      .set("authorization", `Bearer ${token({ cep: 0 })}`)
      .send({})
      .expect(401);
    expect(res.body.error.code).toBe("SESSION_REVOKED");
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: "user-1" }, select: { credentialEpoch: true } });
    expect(mockIssue).not.toHaveBeenCalled();
  });

  // Codex D-ID-1 diff review #1: the issuance is held at the epoch the token
  // proved, not at whatever the identity's row says by the time it runs.
  it("hands the token's own epoch to the service as expectedEpoch (0 for a token minted before epochs)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ credentialEpoch: 4 });
    await request(app())
      .post(`/auth/workspaces/${ORG_B}/session`)
      .set("authorization", `Bearer ${token({ cep: 4 })}`)
      .send({})
      .expect(200);
    expect(mockIssue).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "user-1", orgId: ORG_B, expectedEpoch: 4 }), expect.anything());

    mockPrisma.user.findUnique.mockResolvedValue({ credentialEpoch: 0 });
    await request(app())
      .post(`/auth/workspaces/${ORG_B}/session`)
      .set("authorization", `Bearer ${token({})}`)
      .send({})
      .expect(200);
    expect(mockIssue).toHaveBeenLastCalledWith(expect.objectContaining({ expectedEpoch: 0 }), expect.anything());
  });

  it("honours a token at the current epoch, and refuses one whose identity is gone", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ credentialEpoch: 4 });
    await request(app())
      .post(`/auth/workspaces/${ORG_B}/session`)
      .set("authorization", `Bearer ${token({ cep: 4 })}`)
      .send({})
      .expect(200);
    expect(mockIssue).toHaveBeenCalledTimes(1);

    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .post(`/auth/workspaces/${ORG_B}/session`)
      .set("authorization", `Bearer ${token({ cep: 4 })}`)
      .send({})
      .expect(401);
    expect(res.body.error.code).toBe("SESSION_REVOKED");
    expect(mockIssue).toHaveBeenCalledTimes(1);
  });
});
