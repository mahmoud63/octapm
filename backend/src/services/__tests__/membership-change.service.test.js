jest.mock("../../config/db", () => ({ prisma: {} }));

const membershipService = require("../membership.service");

/**
 * D-ID-1 N1 (Codex diff review r2): a role edit read the membership active, a
 * suspension committed, and the edit then rewrote every field — the stale
 * `active` status included — silently reactivating the suspended person.
 * changeMembership now writes only the fields that changed, with a
 * conditional updateMany on the row exactly as it was read (role, isAdmin,
 * isOwner, status); a row that moved meanwhile answers 409 MEMBERSHIP_CHANGED
 * and nothing is written.
 */

const store = { memberships: [], audit: [] };
const matches = (row, where) =>
  Object.entries(where).every(([key, wanted]) => {
    if (wanted && typeof wanted === "object" && "not" in wanted) return row[key] !== wanted.not;
    return row[key] === wanted;
  });

const tx = {
  organizationMembership: {
    findFirst: jest.fn(async ({ where }) => {
      const row = store.memberships.find((membership) => matches(membership, where));
      return row ? { ...row } : null;
    }),
    count: jest.fn(async ({ where }) => store.memberships.filter((membership) => matches(membership, where)).length),
    updateMany: jest.fn(async ({ where, data }) => {
      let count = 0;
      store.memberships = store.memberships.map((membership) => (matches(membership, where) ? ((count += 1), { ...membership, ...data }) : membership));
      return { count };
    }),
    update: jest.fn(async () => {
      throw new Error("changeMembership must not write unconditionally");
    }),
  },
  authAuditEvent: { create: jest.fn(async ({ data }) => store.audit.push(data)) },
};
const realUpdateMany = tx.organizationMembership.updateMany.getMockImplementation();

// `landed` commits just before changeMembership's write: another request
// (a suspension, another admin's edit) changed the row after it was read.
const beforeWrite = (landed) => {
  tx.organizationMembership.updateMany.mockImplementationOnce(async (args) => {
    landed(store.memberships.find((membership) => membership.id === "m-target"));
    return realUpdateMany(args);
  });
};

const owner = { id: "u-owner", role: "pm", isOwner: true, isAdmin: true, membershipId: "m-owner" };
const target = () => store.memberships.find((membership) => membership.id === "m-target");
const change = (changes) => membershipService.changeMembership({ tx, orgId: "org-1", userId: "u-target", actor: owner, changes });

describe("changeMembership writes only what changed, onto the row as it was read (D-ID-1 N1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tx.organizationMembership.updateMany.mockImplementation(realUpdateMany);
    store.audit = [];
    store.memberships = [
      { id: "m-owner", orgId: "org-1", userId: "u-owner", role: "pm", kind: "member", isAdmin: true, isOwner: true, status: "active", joinedAt: new Date("2026-01-01"), leftAt: null },
      { id: "m-target", orgId: "org-1", userId: "u-target", role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "active", joinedAt: new Date("2026-02-01"), leftAt: null },
    ];
  });

  it("writes only the role, conditional on role, isAdmin, isOwner and status as read", async () => {
    const result = await change({ role: "pm", status: "active", isAdmin: false });
    expect(result.changed).toEqual(["role"]);
    expect(tx.organizationMembership.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.organizationMembership.updateMany).toHaveBeenCalledWith({
      where: { id: "m-target", role: "qs", isAdmin: false, isOwner: false, status: "active" },
      data: { role: "pm" },
    });
    expect(tx.organizationMembership.update).not.toHaveBeenCalled();
    expect(target()).toMatchObject({ role: "pm", status: "active" });
    expect(store.audit.map((row) => row.action)).toEqual(["membership.role_changed"]);
  });

  it("writes only the status (and its own dates) for a suspension, a departure and a reactivation", async () => {
    await change({ status: "suspended" });
    expect(tx.organizationMembership.updateMany).toHaveBeenLastCalledWith({
      where: { id: "m-target", role: "qs", isAdmin: false, isOwner: false, status: "active" },
      data: { status: "suspended" },
    });
    await change({ status: "active" });
    expect(tx.organizationMembership.updateMany).toHaveBeenLastCalledWith({
      where: { id: "m-target", role: "qs", isAdmin: false, isOwner: false, status: "suspended" },
      data: { status: "active", leftAt: null, joinedAt: new Date("2026-02-01") },
    });
    await change({ status: "left" });
    expect(tx.organizationMembership.updateMany).toHaveBeenLastCalledWith({
      where: { id: "m-target", role: "qs", isAdmin: false, isOwner: false, status: "active" },
      data: { status: "left", leftAt: expect.any(Date) },
    });
  });

  it("answers 409 MEMBERSHIP_CHANGED to a role edit when a suspension committed after the read, and the person stays suspended", async () => {
    beforeWrite((row) => { row.status = "suspended"; });
    await expect(change({ role: "pm", status: "active" })).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_CHANGED" });
    expect(target()).toMatchObject({ role: "qs", status: "suspended", isAdmin: false });
    expect(store.audit).toEqual([]);
  });

  it("answers 409 MEMBERSHIP_CHANGED when another admin changed the role meanwhile, and keeps their change", async () => {
    beforeWrite((row) => { row.role = "site_engineer"; });
    await expect(change({ role: "pm" })).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_CHANGED" });
    expect(target()).toMatchObject({ role: "site_engineer", status: "active" });
    expect(store.audit).toEqual([]);
  });

  it("answers 409 MEMBERSHIP_CHANGED to a suspension when administration was granted meanwhile, and writes nothing", async () => {
    beforeWrite((row) => { row.isAdmin = true; });
    await expect(change({ status: "suspended" })).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_CHANGED" });
    expect(target()).toMatchObject({ isAdmin: true, status: "active" });
  });

  it("writes nothing when nothing changed (a form re-sending the same values)", async () => {
    const result = await change({ role: "qs", status: "active", isAdmin: false, isOwner: false });
    expect(result.changed).toEqual([]);
    expect(tx.organizationMembership.updateMany).not.toHaveBeenCalled();
  });
});

// D-ID-1 round 4 (Codex diff review r3).
const seed = () => {
  jest.clearAllMocks();
  tx.organizationMembership.updateMany.mockImplementation(realUpdateMany);
  store.audit = [];
  store.memberships = [
    { id: "m-owner", orgId: "org-1", userId: "u-owner", role: "pm", kind: "member", isAdmin: true, isOwner: true, status: "active", joinedAt: new Date("2026-01-01"), leftAt: null },
    { id: "m-target", orgId: "org-1", userId: "u-target", role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "active", joinedAt: new Date("2026-02-01"), leftAt: null },
  ];
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

/**
 * The emergency switch (D-ID-1 Q10) was judged by user.service against the
 * membership it read before the (org, e-mail) lock. A revocation that
 * committed while the edit waited made an "unchanged" isCompanyAdmin: true a
 * fresh grant, written with the switch off. changeMembership now judges the
 * switch itself, against the row it reads (the caller's lock held): a role
 * change, a grant of administration or ownership, or a return to active is
 * refused; everything that narrows access still goes through.
 */
describe("changeMembership judges the emergency switch against the row it was given (D-ID-1 round 4)", () => {
  beforeEach(seed);

  const widening = [
    ["a role change", {}, { role: "pm" }],
    ["a grant of administration", {}, { isAdmin: true }],
    ["a grant of ownership to an administrator", { isAdmin: true }, { isOwner: true }],
    ["a return to active from suspended", { status: "suspended" }, { status: "active" }],
    ["a return to active from left", { status: "left", leftAt: new Date("2026-03-01") }, { status: "active" }],
  ];

  it.each(widening)("refuses %s (503 MEMBERSHIP_WRITES_SUSPENDED) while the switch is off, and writes nothing", async (_label, start, changes) => {
    Object.assign(target(), start);
    const before = { ...target() };
    await withSwitchOff(() => expect(change(changes)).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" }));
    expect(tx.organizationMembership.updateMany).not.toHaveBeenCalled();
    expect(target()).toEqual(before);
    expect(store.audit).toEqual([]);
  });

  it.each(widening)("lets %s through with the switch on (control)", async (_label, start, changes) => {
    Object.assign(target(), start);
    await change(changes);
    expect(tx.organizationMembership.updateMany).toHaveBeenCalledTimes(1);
    expect(target()).toMatchObject(changes);
  });

  it("judges the flag against the row: the administration the row has is no grant (it goes through with the switch off); the same flag against a row whose administration was revoked is one (503)", async () => {
    Object.assign(target(), { isAdmin: true });
    const kept = await withSwitchOff(() => change({ role: "qs", isAdmin: true }));
    expect(kept.changed).toEqual([]);
    expect(tx.organizationMembership.updateMany).not.toHaveBeenCalled();

    // A revocation committed before this caller's read (under its lock).
    target().isAdmin = false;
    await withSwitchOff(() => expect(change({ role: "qs", isAdmin: true })).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" }));
    expect(tx.organizationMembership.updateMany).not.toHaveBeenCalled();
    expect(target().isAdmin).toBe(false);
  });

  it.each([
    ["an administration revoked", { isAdmin: true }, { isAdmin: false }, { isAdmin: false }],
    ["an ownership removed while another owner stays", { isAdmin: true, isOwner: true }, { isOwner: false }, { isOwner: false, isAdmin: true }],
    ["a suspension", {}, { status: "suspended" }, { status: "suspended" }],
    ["a departure", {}, { status: "left" }, { status: "left" }],
  ])("lets narrowing through with the switch off: %s", async (_label, start, changes, after) => {
    Object.assign(target(), start);
    await withSwitchOff(() => change(changes));
    expect(tx.organizationMembership.updateMany).toHaveBeenCalledTimes(1);
    expect(target()).toMatchObject(after);
  });
});

/**
 * Two owners demoting (or suspending) each other at once each counted the
 * other as the remaining owner, and both wrote: the workspace was left with
 * none (Codex r3, pre-existing). An owner losing ownership or active status is
 * now decided under pg_advisory_xact_lock(hashtext('owners'), hashtext(orgId)),
 * taken before the other active owners are counted.
 */
describe("changeMembership removes owners one at a time per workspace (D-ID-1 round 4)", () => {
  const lockCalls = () => tx.$executeRaw.mock.calls.map(([strings, ...values]) => ({ sql: strings.join("?"), values }));

  beforeEach(() => {
    seed();
    Object.assign(target(), { isAdmin: true, isOwner: true });
    tx.$executeRaw = jest.fn(async () => 1);
  });
  afterEach(() => {
    delete tx.$executeRaw;
  });

  it.each([
    ["loses ownership", { isOwner: false }],
    ["is suspended", { status: "suspended" }],
    ["leaves", { status: "left" }],
  ])("takes the workspace's owners lock before counting the other owners when an owner %s", async (_label, changes) => {
    await change(changes);
    expect(lockCalls()).toEqual([{ sql: expect.stringMatching(/pg_advisory_xact_lock\(hashtext\('owners'\), hashtext\(\?\)\)/), values: ["org-1"] }]);
    expect(tx.organizationMembership.count).toHaveBeenCalledWith({ where: { orgId: "org-1", isOwner: true, status: "active", userId: { not: "u-target" } } });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.organizationMembership.count.mock.invocationCallOrder[0]);
    expect(tx.organizationMembership.updateMany).toHaveBeenCalledTimes(1);
  });

  it("takes no owners lock for a change that leaves ownership as it is (an owner's role, a non-owner's suspension)", async () => {
    await change({ role: "site_engineer" });
    expect(target()).toMatchObject({ role: "site_engineer", isOwner: true });
    Object.assign(target(), { isOwner: false, isAdmin: false });
    await change({ status: "suspended" });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.organizationMembership.count).not.toHaveBeenCalled();
  });

  it("answers 409 LAST_OWNER, and writes nothing, when the other owner was removed while this removal waited for the owners lock", async () => {
    tx.$executeRaw.mockImplementationOnce(async () => {
      // The concurrent removal of the other owner held the lock and committed.
      Object.assign(store.memberships.find((membership) => membership.id === "m-owner"), { isOwner: false });
      return 1;
    });
    await expect(change({ isOwner: false })).rejects.toMatchObject({ status: 409, code: "LAST_OWNER" });
    expect(tx.organizationMembership.updateMany).not.toHaveBeenCalled();
    expect(target()).toMatchObject({ isOwner: true, status: "active" });
    expect(store.audit).toEqual([]);
  });
});
