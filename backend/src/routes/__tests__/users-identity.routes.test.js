/**
 * The user-management routes under owner decision D-ID-1:
 *   - adding a person is always an invitation, and a request that carries a
 *     password field at all — whatever its value — is refused before anything
 *     is looked up (USER_PASSWORD_NOT_ACCEPTED);
 *   - a person's sign-in e-mail is theirs: a PATCH carrying an email field is
 *     refused whatever its value (USER_EMAIL_IDENTITY_OWNED);
 *   - the admin password reset is gone; an administrator only asks OctaPM to
 *     send the self-service reset e-mail (202 { sent: true }, rate-limited).
 * The permission gates are covered by module-action-permissions.test.js; here
 * they pass, so what is asserted is the route's own contract.
 */
const mockUserService = {
  inviteUser: jest.fn(),
  listInvitations: jest.fn(),
  revokeInvitation: jest.fn(),
  resendInvitation: jest.fn(),
  getUserById: jest.fn(),
  updateUser: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
};
const mockDisconnectStanding = jest.fn();

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: "admin-1", orgId: "org-1", role: "pm", email: "admin@example.test", name: "Admin" };
    next();
  },
}));
jest.mock("../../middleware/rbac", () => ({ requirePermission: () => (_req, _res, next) => next() }));
jest.mock("../../middleware/subscription-gate", () => ({ subscriptionGate: (_req, _res, next) => next() }));
jest.mock("../../services/user.service", () => mockUserService);
jest.mock("../../realtime/socket", () => ({ disconnectStanding: (...args) => mockDisconnectStanding(...args) }));

const express = require("express");
const request = require("supertest");
const usersRouter = require("../users");
const { errorHandler } = require("../../middleware/error-handler");
const { resetRateLimitStores } = require("../../middleware/rate-limit");

const USER_ID = "3f0c9a52-6a1e-4c55-9d1b-2f7e8b9c0d11";
const OTHER_USER_ID = "3f0c9a52-6a1e-4c55-9d1b-2f7e8b9c0d12";
const INVITATION_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const app = () => {
  const application = express();
  application.use(express.json());
  application.use("/users", usersRouter);
  application.use(errorHandler);
  return application;
};

const invitation = { id: "invite-1", email: "new.person@example.test", role: "site_engineer", status: "pending", invited: true };

describe("user-management routes (D-ID-1)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await resetRateLimitStores();
    mockUserService.inviteUser.mockResolvedValue(invitation);
    mockUserService.getUserById.mockResolvedValue({ id: USER_ID, role: "qs", isCompanyAdmin: false, isOwner: false });
    mockUserService.updateUser.mockImplementation(async ({ payload }) => ({ id: USER_ID, role: "qs", isCompanyAdmin: false, isOwner: false, ...payload }));
    mockUserService.sendPasswordResetEmail.mockResolvedValue({ sent: true });
  });

  describe("refusing password fields when a person is added", () => {
    it.each([
      ["/users", "password", "Password1"],
      ["/users", "password", ""],
      ["/users", "password", null],
      ["/users", "password", false],
      ["/users", "password", 0],
      ["/users", "confirmPassword", "Password1"],
      ["/users", "confirmPassword", null],
      ["/users/invitations", "password", "Password1"],
      ["/users/invitations", "password", ""],
      ["/users/invitations", "confirmPassword", false],
    ])("POST %s with %s=%j answers 400 USER_PASSWORD_NOT_ACCEPTED and invites nobody", async (path, field, value) => {
      const res = await request(app())
        .post(path)
        .send({ email: "new.person@example.test", role: "site_engineer", [field]: value });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("USER_PASSWORD_NOT_ACCEPTED");
      expect(mockUserService.inviteUser).not.toHaveBeenCalled();
    });

    it("refuses the field before validation: a body with nothing else valid is told about the password first", async () => {
      const res = await request(app()).post("/users").send({ password: "x" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("USER_PASSWORD_NOT_ACCEPTED");
    });
  });

  describe("POST /users is the deprecated alias of POST /users/invitations", () => {
    it.each([
      ["/users", "users.create"],
      ["/users/invitations", "users.invite"],
    ])("POST %s invites with the same chain and answers 201 with the invitation", async (path, via) => {
      const res = await request(app())
        .post(path)
        .send({ name: "Typed Name", phone: "+1 555 0100", email: "New.Person@Example.test", role: "site_engineer" });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: invitation });
      expect(mockUserService.inviteUser).toHaveBeenCalledTimes(1);
      const call = mockUserService.inviteUser.mock.calls[0][0];
      expect(call).toMatchObject({ orgId: "org-1", actor: expect.objectContaining({ id: "admin-1" }), via });
      // Name and phone are the person's to set when they accept.
      expect(call.payload).not.toHaveProperty("name");
      expect(call.payload).not.toHaveProperty("phone");
      expect(call.payload).toMatchObject({ email: "new.person@example.test", role: "site_engineer" });
    });

    it("requires a role on the alias too", async () => {
      const res = await request(app()).post("/users").send({ name: "No Role", email: "new.person@example.test" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(mockUserService.inviteUser).not.toHaveBeenCalled();
    });
  });

  describe("pending invitations", () => {
    it("GET /users/invitations lists them (not taken for a user id)", async () => {
      mockUserService.listInvitations.mockResolvedValue({ items: [], pagination: { limit: 50, nextCursor: null } });
      const res = await request(app()).get("/users/invitations");
      expect(res.status).toBe(200);
      expect(mockUserService.listInvitations).toHaveBeenCalledWith({ orgId: "org-1", query: {} });
      expect(mockUserService.getUserById).not.toHaveBeenCalled();
    });

    it("DELETE revokes by invitation id, and refuses an id that is not a UUID", async () => {
      mockUserService.revokeInvitation.mockResolvedValue({ id: INVITATION_ID, revoked: true });
      const res = await request(app()).delete(`/users/invitations/${INVITATION_ID}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id: INVITATION_ID, revoked: true });
      expect(mockUserService.revokeInvitation).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", invitationId: INVITATION_ID }));

      const bad = await request(app()).delete("/users/invitations/not-a-uuid");
      expect(bad.status).toBe(400);
      expect(mockUserService.revokeInvitation).toHaveBeenCalledTimes(1);
    });

    it("POST .../resend answers 201 with the new invitation", async () => {
      mockUserService.resendInvitation.mockResolvedValue(invitation);
      const res = await request(app()).post(`/users/invitations/${INVITATION_ID}/resend`).send({});
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual(invitation);
      expect(mockUserService.resendInvitation).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", invitationId: INVITATION_ID }));
    });
  });

  describe("PATCH /users/:id refuses an email field", () => {
    it.each(["someone.else@example.test", "", null, false])("email=%j answers 400 USER_EMAIL_IDENTITY_OWNED and changes nothing", async (value) => {
      const res = await request(app()).patch(`/users/${USER_ID}`).send({ name: "Renamed", email: value });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("USER_EMAIL_IDENTITY_OWNED");
      expect(mockUserService.getUserById).not.toHaveBeenCalled();
      expect(mockUserService.updateUser).not.toHaveBeenCalled();
    });

    it("passes a body without email on to the service", async () => {
      const res = await request(app()).patch(`/users/${USER_ID}`).send({ name: "Renamed", phone: "+1 555 0101" });
      expect(res.status).toBe(200);
      expect(mockUserService.updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: "org-1", userId: USER_ID, payload: { name: "Renamed", phone: "+1 555 0101" } }),
      );
    });
  });

  describe("the administrator only asks for the reset e-mail", () => {
    it("the removed POST /users/:id/reset-password sets nothing", async () => {
      const res = await request(app()).post(`/users/${USER_ID}/reset-password`).send({ newPassword: "Password1" });
      expect(res.status).toBe(404);
      expect(mockUserService.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(mockUserService).not.toHaveProperty("resetPassword");
    });

    it("POST /users/:id/password-reset-email answers 202 { sent: true } without a body", async () => {
      const res = await request(app()).post(`/users/${USER_ID}/password-reset-email`);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ success: true, data: { sent: true } });
      expect(mockUserService.sendPasswordResetEmail).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: "org-1", userId: USER_ID, actor: expect.objectContaining({ id: "admin-1" }) }),
      );
      expect(mockUserService.sendPasswordResetEmail.mock.calls[0][0]).not.toHaveProperty("newPassword");
    });

    it("refuses an id that is not a UUID", async () => {
      const res = await request(app()).post("/users/not-a-uuid/password-reset-email");
      expect(res.status).toBe(400);
      expect(mockUserService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it("is rate-limited per person: the fourth request for the same person in the window answers 429", async () => {
      const application = app();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await request(application).post(`/users/${USER_ID}/password-reset-email`)).status).toBe(202);
      }
      const limited = await request(application).post(`/users/${USER_ID}/password-reset-email`);
      expect(limited.status).toBe(429);
      expect(mockUserService.sendPasswordResetEmail).toHaveBeenCalledTimes(3);
      // Another person is a different key.
      expect((await request(application).post(`/users/${OTHER_USER_ID}/password-reset-email`)).status).toBe(202);
    });
  });
});
