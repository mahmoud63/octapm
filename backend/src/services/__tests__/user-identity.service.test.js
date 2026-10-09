/**
 * user.service under owner decision D-ID-1: the identity's e-mail is its own,
 * the administrator only asks OctaPM to send the self-service reset e-mail,
 * the emergency switch pauses only what widens access, and closing an
 * identity is a credential event guarded by its other workspaces.
 *
 * A mocked-Prisma suite: it pins the contract the service code states; the
 * live proof is the certification's, not this file's.
 */
const mockTx = {
  user: { updateMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  refreshSession: { updateMany: jest.fn() },
  invitationToken: { findMany: jest.fn(), updateMany: jest.fn() },
  projectAssignment: { deleteMany: jest.fn() },
  activityAssignment: { deleteMany: jest.fn() },
  authAuditEvent: { create: jest.fn() },
};
const mockPrisma = {
  $transaction: jest.fn(async (callback) => callback(mockTx)),
  user: { findFirst: jest.fn(), update: jest.fn() },
  authAuditEvent: { create: jest.fn() },
};
const mockRequestPasswordReset = jest.fn();
// The real helper, recorded: closing the identity is a credential event (Q-KEY).
const mockEndIdentitySessions = jest.fn((...args) => jest.requireActual("../auth.service").endIdentitySessions(...args));

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../email.service", () => ({ sendEmail: jest.fn(), templates: {} }));
jest.mock("../auth.service", () => ({
  requestPasswordReset: (...args) => mockRequestPasswordReset(...args),
  endIdentitySessions: (...args) => mockEndIdentitySessions(...args),
}));

const userService = require("../user.service");

const person = {
  id: "user-9",
  orgId: "org-1",
  name: "Sam",
  email: "sam@example.test",
  phone: null,
  role: "qs",
  isCompanyAdmin: false,
  status: "active",
  _count: { projectAssignments: 0 },
};

const withSwitchOff = async (fn) => {
  const previous = process.env.AUTH_MEMBERSHIP_WRITE;
  process.env.AUTH_MEMBERSHIP_WRITE = "false";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.AUTH_MEMBERSHIP_WRITE;
    else process.env.AUTH_MEMBERSHIP_WRITE = previous;
  }
};

describe("user.service identity rules (D-ID-1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue({ ...person });
    mockTx.user.updateMany.mockResolvedValue({ count: 1 });
    mockTx.user.findUnique.mockResolvedValue({ ...person, status: "inactive" });
    mockTx.user.update.mockImplementation(async ({ data }) => ({ ...person, ...data }));
    mockTx.refreshSession.updateMany.mockResolvedValue({ count: 1 });
    mockTx.invitationToken.findMany.mockResolvedValue([]);
    mockTx.invitationToken.updateMany.mockResolvedValue({ count: 0 });
    mockRequestPasswordReset.mockResolvedValue({ sent: true });
  });

  describe("updateUser", () => {
    it.each(["someone.else@example.test", "sam@example.test", "", null, undefined])(
      "refuses a payload carrying email=%j with 400 USER_EMAIL_IDENTITY_OWNED and writes nothing",
      async (email) => {
        await expect(
          userService.updateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" }, payload: { name: "Renamed", email } }),
        ).rejects.toMatchObject({ status: 400, code: "USER_EMAIL_IDENTITY_OWNED" });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it("refuses a role change while the emergency switch is off (D-ID-1 Q10)", async () => {
      await withSwitchOff(async () => {
        await expect(
          userService.updateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" }, payload: { role: "pm" } }),
        ).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" });
        await expect(
          userService.updateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" }, payload: { isCompanyAdmin: true } }),
        ).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" });
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    // Codex D-ID-1 diff review r2 N1: the role edit ran outside deactivation's
    // lock and rewrote the stale `active` status. It now changes standing in a
    // transaction under the (org, e-mail) lock deactivation takes, and
    // changeMembership reads the row after that lock and writes only the role.
    // Round 4 (Codex r3): the User row is re-read under that lock and the User
    // mirror is written in the same transaction, not after it.
    it("changes standing under the (org, e-mail) lock: a suspension that committed while it waited stays, and only the role is written", async () => {
      const row = { id: "m-9", orgId: "org-1", userId: "user-9", role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "active", joinedAt: new Date("2026-01-01") };
      mockPrisma.user.findFirst.mockResolvedValue({ ...person, memberships: [{ ...row }] });
      mockTx.user.findUnique.mockResolvedValue({ ...person });
      mockTx.$executeRaw = jest.fn(async () => {
        // The suspension held the lock; it commits, then the lock is granted.
        row.status = "suspended";
        return 1;
      });
      mockTx.organizationMembership = {
        findFirst: jest.fn(async () => ({ ...row })),
        updateMany: jest.fn(async ({ where, data }) => {
          const hit = Object.entries(where).every(([key, value]) => row[key] === value);
          if (hit) Object.assign(row, data);
          return { count: hit ? 1 : 0 };
        }),
      };
      try {
        await userService.updateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" }, payload: { role: "pm" } });
        const [strings, ...values] = mockTx.$executeRaw.mock.calls[0];
        expect(strings.join("?")).toMatch(/pg_advisory_xact_lock\(hashtext\(\?\), hashtext\(\?\)\)/);
        expect(values).toEqual(["org-1", "sam@example.test"]);
        expect(mockTx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mockTx.organizationMembership.findFirst.mock.invocationCallOrder[0]);
        expect(mockTx.organizationMembership.updateMany).toHaveBeenCalledWith({
          where: { id: "m-9", role: "qs", isAdmin: false, isOwner: false, status: "suspended" },
          data: { role: "pm" },
        });
        expect(row).toMatchObject({ role: "pm", status: "suspended" });
        // Round 4: the User row is read under the lock, and the mirror of the
        // membership (role, administration) is written through the locked
        // transaction after the membership change — never through the outer
        // client, after the lock is gone.
        expect(mockTx.user.findUnique).toHaveBeenCalledWith({ where: { id: "user-9" }, include: { _count: { select: { projectAssignments: true } } } });
        expect(mockTx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mockTx.user.findUnique.mock.invocationCallOrder[0]);
        expect(mockTx.user.update).toHaveBeenCalledTimes(1);
        expect(mockTx.user.update).toHaveBeenCalledWith({
          where: { id: "user-9" },
          data: { role: "pm", isCompanyAdmin: false },
          include: { _count: { select: { projectAssignments: true } } },
        });
        expect(mockTx.organizationMembership.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mockTx.user.update.mock.invocationCallOrder[0]);
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      } finally {
        delete mockTx.$executeRaw;
        delete mockTx.organizationMembership;
      }
    });

    // Codex D-ID-1 diff review r3 (round 4): the standing change is one
    // transaction under the (org, e-mail) lock — the User re-read, the
    // membership changed (or, without one, the User columns judged) against
    // what is there under the lock, and the User mirror written inside it.
    describe("one locked transaction for the whole standing change (D-ID-1 round 4)", () => {
      const withCount = { _count: { select: { projectAssignments: true } } };
      const owner = { id: "owner-1", role: "pm", isOwner: true, isAdmin: true, isCompanyAdmin: true, membershipId: "m-owner" };
      let inTransaction;
      let writes;
      let row;
      const membershipRows = (initial) => {
        row = { id: "m-9", orgId: "org-1", userId: "user-9", role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "active", joinedAt: new Date("2026-01-01"), ...initial };
        mockTx.organizationMembership = {
          findFirst: jest.fn(async () => ({ ...row })),
          updateMany: jest.fn(async ({ where, data }) => {
            const hit = Object.entries(where).every(([key, value]) => row[key] === value);
            if (hit) Object.assign(row, data);
            return { count: hit ? 1 : 0 };
          }),
          create: jest.fn(async () => {
            throw new Error("an existing membership must not be created again");
          }),
        };
      };
      // `landed` commits while the edit waits for the (org, e-mail) lock.
      const lockGranted = (landed = () => {}) => {
        mockTx.$executeRaw = jest.fn(async () => {
          landed();
          return 1;
        });
      };

      beforeEach(() => {
        inTransaction = false;
        writes = [];
        mockPrisma.$transaction.mockImplementation(async (callback) => {
          inTransaction = true;
          try {
            return await callback(mockTx);
          } finally {
            inTransaction = false;
          }
        });
        mockTx.user.update.mockImplementation(async ({ data }) => {
          writes.push({ data, inTransaction });
          return { ...person, ...data };
        });
      });
      afterEach(() => {
        mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockTx));
        delete mockTx.$executeRaw;
        delete mockTx.organizationMembership;
      });

      it("writes the User mirror (role, administration) with the name and phone inside the locked transaction, after the membership change, and nothing outside it", async () => {
        membershipRows();
        mockPrisma.user.findFirst.mockResolvedValue({ ...person, memberships: [{ ...row }] });
        mockTx.user.findUnique.mockResolvedValue({ ...person });
        lockGranted();
        const result = await userService.updateUser({
          orgId: "org-1",
          userId: "user-9",
          actor: { id: "admin-1", isCompanyAdmin: true },
          payload: { name: "Sam Renamed", phone: "+1 555 0100", role: "pm" },
        });
        expect(writes).toEqual([{ data: { name: "Sam Renamed", phone: "+1 555 0100", role: "pm", isCompanyAdmin: false }, inTransaction: true }]);
        expect(mockTx.user.update).toHaveBeenCalledWith({ where: { id: "user-9" }, data: expect.any(Object), include: withCount });
        const order = [
          mockTx.$executeRaw.mock.invocationCallOrder[0],
          mockTx.user.findUnique.mock.invocationCallOrder[0],
          mockTx.organizationMembership.updateMany.mock.invocationCallOrder[0],
          mockTx.user.update.mock.invocationCallOrder[0],
        ];
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(result).toMatchObject({ name: "Sam Renamed", role: "pm", isCompanyAdmin: false });
      });

      it("mirrors the membership as it is under the lock: an administration revoked while the edit waited is mirrored revoked, not as the snapshot had it", async () => {
        membershipRows({ isAdmin: true });
        mockPrisma.user.findFirst.mockResolvedValue({ ...person, isCompanyAdmin: true, memberships: [{ ...row }] });
        mockTx.user.findUnique.mockResolvedValue({ ...person, isCompanyAdmin: false });
        lockGranted(() => {
          row.isAdmin = false;
        });
        await userService.updateUser({ orgId: "org-1", userId: "user-9", actor: owner, payload: { role: "pm" } });
        expect(mockTx.organizationMembership.updateMany).toHaveBeenCalledWith({
          where: { id: "m-9", role: "qs", isAdmin: false, isOwner: false, status: "active" },
          data: { role: "pm" },
        });
        expect(writes).toEqual([{ data: { role: "pm", isCompanyAdmin: false }, inTransaction: true }]);
        expect(row).toMatchObject({ role: "pm", isAdmin: false });
      });

      // Codex r3 HIGH (adjudicated MEDIUM): request A read the person an
      // administrator and re-sent isCompanyAdmin: true (unchanged, so the
      // switch let it pass); B revoked administration under the lock; A then
      // granted it back with the switch off. The switch is now judged by
      // changeMembership against the row read under the lock.
      it("refuses (503), and writes nothing, an unchanged admin flag against a row whose administration was revoked while it waited, with the switch off", async () => {
        membershipRows({ isAdmin: true });
        mockPrisma.user.findFirst.mockResolvedValue({ ...person, isCompanyAdmin: true, memberships: [{ ...row }] });
        mockTx.user.findUnique.mockResolvedValue({ ...person, isCompanyAdmin: false });
        lockGranted(() => {
          row.isAdmin = false;
        });
        await withSwitchOff(() =>
          expect(
            userService.updateUser({ orgId: "org-1", userId: "user-9", actor: owner, payload: { isCompanyAdmin: true } }),
          ).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" }),
        );
        // It got past the fast (snapshot) check and was refused under the lock.
        expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
        expect(mockTx.organizationMembership.updateMany).not.toHaveBeenCalled();
        expect(mockTx.user.update).not.toHaveBeenCalled();
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(row.isAdmin).toBe(false);
        expect(mockTx.authAuditEvent.create).not.toHaveBeenCalled();
      });

      it("lets the same re-grant through with the switch on, and mirrors it inside the transaction", async () => {
        membershipRows({ isAdmin: true });
        mockPrisma.user.findFirst.mockResolvedValue({ ...person, isCompanyAdmin: true, memberships: [{ ...row }] });
        mockTx.user.findUnique.mockResolvedValue({ ...person, isCompanyAdmin: false });
        lockGranted(() => {
          row.isAdmin = false;
        });
        await userService.updateUser({ orgId: "org-1", userId: "user-9", actor: owner, payload: { isCompanyAdmin: true } });
        expect(mockTx.organizationMembership.updateMany).toHaveBeenCalledWith({
          where: { id: "m-9", role: "qs", isAdmin: false, isOwner: false, status: "active" },
          data: { isAdmin: true },
        });
        expect(writes).toEqual([{ data: { role: "qs", isCompanyAdmin: true }, inTransaction: true }]);
      });

      // No membership row (a client that knows none): the User columns are the
      // standing, judged as read under the lock — not as the snapshot had them.
      describe("the User-column branch", () => {
        it.each([
          ["an administration revoked while it waited (the re-sent flag is a grant)", { isCompanyAdmin: true }, { isCompanyAdmin: false }, { isCompanyAdmin: true }],
          ["a role narrowed while it waited (the re-sent role is a change)", { role: "pm" }, { role: "qs" }, { role: "pm" }],
        ])("refuses (503), and writes nothing, %s, with the switch off", async (_label, snapshot, locked, payload) => {
          mockPrisma.user.findFirst.mockResolvedValue({ ...person, ...snapshot });
          mockTx.user.findUnique.mockResolvedValue({ ...person, ...locked });
          lockGranted();
          await withSwitchOff(() =>
            expect(
              userService.updateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1", isCompanyAdmin: true }, payload }),
            ).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" }),
          );
          expect(mockTx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mockTx.user.findUnique.mock.invocationCallOrder[0]);
          expect(mockTx.user.update).not.toHaveBeenCalled();
          expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it("lets the same grant through with the switch on, writing the User columns inside the transaction", async () => {
          mockPrisma.user.findFirst.mockResolvedValue({ ...person, isCompanyAdmin: true });
          mockTx.user.findUnique.mockResolvedValue({ ...person, isCompanyAdmin: false });
          lockGranted();
          await userService.updateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1", isCompanyAdmin: true }, payload: { isCompanyAdmin: true } });
          expect(writes).toEqual([{ data: { isCompanyAdmin: true }, inTransaction: true }]);
          expect(mockPrisma.user.update).not.toHaveBeenCalled();
        });

        it("lets narrowing through with the switch off (administration revoked), inside the transaction", async () => {
          mockPrisma.user.findFirst.mockResolvedValue({ ...person, isCompanyAdmin: true });
          mockTx.user.findUnique.mockResolvedValue({ ...person, isCompanyAdmin: true });
          lockGranted();
          await withSwitchOff(() =>
            userService.updateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1", isCompanyAdmin: true }, payload: { isCompanyAdmin: false } }),
          );
          expect(writes).toEqual([{ data: { isCompanyAdmin: false }, inTransaction: true }]);
        });
      });
    });
  });

  describe("sendPasswordResetEmail (D-ID-1 Q4)", () => {
    it("asks for the ordinary self-service reset to the person's own address, audits it, and answers { sent: true }", async () => {
      const result = await userService.sendPasswordResetEmail({
        orgId: "org-1",
        userId: "user-9",
        actor: { id: "admin-1", role: "pm" },
        context: { ipAddress: "10.0.0.1", userAgent: "Jest" },
      });
      expect(result).toEqual({ sent: true });
      expect(mockRequestPasswordReset).toHaveBeenCalledWith({ email: "sam@example.test" }, expect.objectContaining({ ipAddress: "10.0.0.1" }));
      expect(mockPrisma.authAuditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: "password_reset_email_requested_by_admin", userId: "user-9", actorId: "admin-1", email: "sam@example.test" }),
        }),
      );
      // The administrator never sets a password.
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockTx.user.updateMany).not.toHaveBeenCalled();
    });

    it("answers the same { sent: true } for a closed account (requestPasswordReset sends it nothing)", async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...person, status: "inactive" });
      await expect(userService.sendPasswordResetEmail({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" } })).resolves.toEqual({ sent: true });
    });

    it("answers 404 for someone who is not part of this workspace, and asks for nothing", async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(
        userService.sendPasswordResetEmail({ orgId: "org-1", userId: "user-x", actor: { id: "admin-1" } }),
      ).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
      expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    });

    it("no longer offers an admin password reset", () => {
      expect(userService.resetPassword).toBeUndefined();
    });
  });

  describe("activateUser", () => {
    it("is paused while the emergency switch is off, before anything is read (D-ID-1 Q10)", async () => {
      await withSwitchOff(async () => {
        await expect(
          userService.activateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" } }),
        ).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" });
      });
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("deactivateUser", () => {
    it("closes a home identity in one guarded write that bumps the credential epoch, ends every session and revokes this workspace's pending links", async () => {
      mockTx.invitationToken.findMany.mockResolvedValue([{ id: "invite-1", projectId: "project-1" }]);
      mockTx.invitationToken.updateMany.mockResolvedValue({ count: 1 });

      await userService.deactivateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1", role: "pm" } });

      expect(mockTx.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: "user-9",
          orgId: "org-1",
          status: "active",
          memberships: { none: { orgId: { not: "org-1" }, status: { in: ["active", "suspended"] } } },
        },
        data: { status: "inactive", credentialEpoch: { increment: 1 } },
      });
      // The identity closed: every session of it ends, not only this workspace's,
      // through the one helper every credential event uses (Q-KEY: it also
      // revokes the API keys the person created), named as the close.
      expect(mockEndIdentitySessions).toHaveBeenCalledWith(mockTx, "user-9", expect.any(Date), { reason: "identity_closed", actorId: "admin-1" });
      expect(mockTx.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-9", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(mockTx.invitationToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: "org-1", email: "sam@example.test", status: "pending" }) }),
      );
      expect(mockTx.invitationToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { in: ["invite-1"] } }), data: expect.objectContaining({ status: "revoked" }) }),
      );
      expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "invitation_revoked", entityId: "invite-1", metadataJson: { reason: "member_suspended" } }) }),
      );
    });

    it("leaves an identity that is part of another workspace open, and ends only this workspace's sessions", async () => {
      // The guarded write finds the identity still present elsewhere.
      mockTx.user.updateMany.mockResolvedValue({ count: 0 });
      await userService.deactivateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" } });
      expect(mockTx.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-9", orgId: "org-1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(mockTx.user.findUnique).not.toHaveBeenCalled();
      // A suspension that leaves the identity open is not a credential event.
      expect(mockEndIdentitySessions).not.toHaveBeenCalled();
    });

    it("still suspends while the emergency switch is off: narrowing access is never paused", async () => {
      await withSwitchOff(() => userService.deactivateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" } }));
      expect(mockTx.user.updateMany).toHaveBeenCalledTimes(1);
    });

    // Codex D-ID-1 diff review #4 and #3: the identity lock comes before the
    // guarded close, and an unexchanged SSO ticket is spent with the sessions —
    // all of the identity's when it closed, this workspace's when it stays open.
    describe("under the identity lock, with SSO tickets", () => {
      beforeEach(() => {
        mockTx.$executeRaw = jest.fn(async () => 1);
        mockTx.ssoTicket = { updateMany: jest.fn(async () => ({ count: 1 })) };
      });
      afterEach(() => {
        delete mockTx.$executeRaw;
        delete mockTx.ssoTicket;
      });

      it("takes the identity lock after the (org, e-mail) lock and before the guarded close, and spends every ticket of a closed identity", async () => {
        await userService.deactivateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" } });
        const calls = mockTx.$executeRaw.mock.calls.map(([strings, ...values]) => ({ sql: strings.join("?"), values }));
        expect(calls).toHaveLength(2);
        expect(calls[0].values).toEqual(["org-1", "sam@example.test"]);
        expect(calls[1].sql).toMatch(/pg_advisory_xact_lock\(hashtext\('identity'\), hashtext\(\?\)\)/);
        expect(calls[1].values).toEqual(["user-9"]);
        expect(mockTx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(mockTx.user.updateMany.mock.invocationCallOrder[0]);
        expect(mockTx.ssoTicket.updateMany).toHaveBeenCalledWith({ where: { userId: "user-9", usedAt: null }, data: { usedAt: expect.any(Date) } });
      });

      it("spends only this workspace's tickets when the identity stays open elsewhere", async () => {
        mockTx.user.updateMany.mockResolvedValue({ count: 0 });
        await userService.deactivateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" } });
        expect(mockTx.ssoTicket.updateMany).toHaveBeenCalledWith({ where: { userId: "user-9", orgId: "org-1", usedAt: null }, data: { usedAt: expect.any(Date) } });
      });

      it("takes no identity lock for a person homed in another workspace (nothing identity-wide is written)", async () => {
        mockPrisma.user.findFirst.mockResolvedValue({ ...person, orgId: "org-2", memberships: [{ id: "m-9", orgId: "org-1", userId: "user-9", status: "active", role: "qs", kind: "member" }] });
        mockPrisma.organizationMembership = { findFirst: jest.fn() };
        const membershipService = require("../membership.service");
        const change = jest.spyOn(membershipService, "changeMembership").mockResolvedValue({ membership: { id: "m-9", orgId: "org-1", userId: "user-9", status: "suspended", role: "qs", kind: "member" } });
        try {
          await userService.deactivateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" } });
        } finally {
          change.mockRestore();
          delete mockPrisma.organizationMembership;
        }
        const sql = mockTx.$executeRaw.mock.calls.map(([strings]) => strings.join("?"));
        expect(sql.some((text) => /hashtext\('identity'\)/.test(text))).toBe(false);
        expect(mockTx.user.updateMany).not.toHaveBeenCalled();
      });
    });

    // Codex D-ID-1 diff review #5: an active person homed here with no
    // membership row here (seeded before memberships) who belongs to another
    // workspace. The identity stays open (the other workspace holds it); the
    // suspension here must still be written, as a SUSPENDED row from their
    // own User columns, or the User-column fallback keeps admitting them.
    it("writes a suspended membership from the User columns for a legacy home member another workspace holds, and ends only this workspace's sessions", async () => {
      mockTx.organizationMembership = {
        findFirst: jest.fn(),
        create: jest.fn(async ({ data }) => ({ id: "m-new", ...data })),
      };
      // The guarded close finds the identity present elsewhere.
      mockTx.user.updateMany.mockResolvedValue({ count: 0 });
      try {
        await userService.deactivateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1", role: "pm" } });
        expect(mockTx.organizationMembership.create).toHaveBeenCalledTimes(1);
        expect(mockTx.organizationMembership.create.mock.calls[0][0].data).toMatchObject({
          orgId: "org-1",
          userId: "user-9",
          role: "qs",
          kind: "member",
          isAdmin: false,
          isOwner: false,
          status: "suspended",
        });
      } finally {
        delete mockTx.organizationMembership;
      }
      expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "membership.suspended", orgId: "org-1" }) }),
      );
      expect(mockTx.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-9", orgId: "org-1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    // Codex D-ID-1 diff review r2 R2: deactivation judged "no membership here"
    // before the (org, e-mail) lock. A home invitation accepted while it waited
    // wrote the row; the stale null then inserted a second one, the unique
    // constraint aborted, and the suspension rolled back. It now reads the
    // membership again under the lock and acts on that read.
    describe("acts on the membership as read under the (org, e-mail) lock (D-ID-1 R2)", () => {
      let rows;
      beforeEach(() => {
        rows = [];
        mockTx.organizationMembership = {
          findFirst: jest.fn(async ({ where }) => {
            const row = rows.find((candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value));
            return row ? { ...row } : null;
          }),
          updateMany: jest.fn(async ({ where, data }) => {
            const hit = rows.filter((candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value));
            hit.forEach((row) => Object.assign(row, data));
            return { count: hit.length };
          }),
          create: jest.fn(async ({ data }) => {
            if (rows.some((row) => row.orgId === data.orgId && row.userId === data.userId)) {
              throw Object.assign(new Error("Unique constraint failed on the fields: (`orgId`,`userId`)"), { code: "P2002" });
            }
            const row = { id: "m-created", ...data };
            rows.push(row);
            return { ...row };
          }),
        };
      });
      afterEach(() => {
        delete mockTx.$executeRaw;
        delete mockTx.organizationMembership;
      });

      it("suspends the membership an acceptance wrote while it waited for the lock, instead of inserting a second row", async () => {
        // Read outside the lock: no membership here (a legacy home member).
        mockPrisma.user.findFirst.mockResolvedValue({ ...person });
        let granted = 0;
        mockTx.$executeRaw = jest.fn(async () => {
          // The home acceptance held the (org, e-mail) lock and commits its row.
          if ((granted += 1) === 1) rows.push({ id: "m-accepted", orgId: "org-1", userId: "user-9", role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "active", joinedAt: new Date("2026-03-01") });
          return 1;
        });
        await userService.deactivateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1", role: "pm" } });
        expect(mockTx.organizationMembership.create).not.toHaveBeenCalled();
        expect(mockTx.organizationMembership.updateMany).toHaveBeenCalledWith({
          where: { id: "m-accepted", role: "qs", isAdmin: false, isOwner: false, status: "active" },
          data: { status: "suspended" },
        });
        expect(rows).toEqual([expect.objectContaining({ id: "m-accepted", status: "suspended" })]);
        expect(mockTx.authAuditEvent.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ action: "membership.suspended", metadataJson: expect.objectContaining({ from: "active", to: "suspended" }) }) }),
        );
      });

      it("refuses (400 ALREADY_INACTIVE), and ends nothing, when the row it re-reads under the lock is no longer active", async () => {
        const stale = { id: "m-9", orgId: "org-1", userId: "user-9", role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "active" };
        mockPrisma.user.findFirst.mockResolvedValue({ ...person, memberships: [{ ...stale }] });
        rows.push({ ...stale });
        mockTx.$executeRaw = jest.fn(async () => {
          // Another suspension held the lock and committed.
          rows[0].status = "suspended";
          return 1;
        });
        await expect(userService.deactivateUser({ orgId: "org-1", userId: "user-9", actor: { id: "admin-1" } })).rejects.toMatchObject({ status: 400, code: "ALREADY_INACTIVE" });
        expect(mockTx.organizationMembership.updateMany).not.toHaveBeenCalled();
        expect(mockTx.organizationMembership.create).not.toHaveBeenCalled();
        expect(mockTx.user.updateMany).not.toHaveBeenCalled();
        expect(mockTx.refreshSession.updateMany).not.toHaveBeenCalled();
      });
    });
  });
});
