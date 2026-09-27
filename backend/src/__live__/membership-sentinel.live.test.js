const { PrismaClient } = require("@prisma/client");
const { createLiveMembership, createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe } = require("./helpers");
const { EPHEMERAL, captureState, checkInvariants, compareStates } = require("../../scripts/enterprise/membership-integrity");
const sentinelRun = require("./membership-sentinel.global");

/**
 * The membership integrity sentinel catches what the 2026-09-26 incident did.
 *
 * Every write here touches one throwaway organisation only: its identity is
 * proven (a LiveTest name) immediately before each write, each write names
 * one membership by its unique (orgId, userId) key — a missing id throws
 * instead of widening — and each test restores what it changed. The sentinel
 * is told to treat this organisation as durable (includeOrgIds), which is how
 * it sees changes a real run would only see on the demo or E2E organisations.
 */
liveDescribe("membership integrity sentinel", () => {
  const prisma = new PrismaClient();
  let live;
  let qs;
  let site;
  let store;
  const include = () => ({ includeOrgIds: [live.org.id] });

  const proveThrowaway = async () => {
    const org = await prisma.organisation.findUnique({ where: { id: live.org.id }, select: { name: true } });
    expect(org?.name).toMatch(EPHEMERAL);
  };
  const setMembership = async (userId, data) => {
    await proveThrowaway();
    expect(userId).toEqual(expect.any(String));
    return prisma.organizationMembership.update({ where: { orgId_userId: { orgId: live.org.id, userId } }, data });
  };
  const setUser = async (userId, data) => {
    await proveThrowaway();
    return prisma.user.update({ where: { id: userId }, data });
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    const person = (name, role) =>
      createLiveUser(prisma, { orgId: live.org.id, name, email: `sentinel-${role}-${live.org.id}@octapm-live.test`, role, isCompanyAdmin: false });
    qs = await person("Sentinel QS", "qs");
    site = await person("Sentinel Site", "site_engineer");
    store = await person("Sentinel Store", "warehouse");
  });

  afterAll(async () => {
    await dropLiveOrg(prisma, live?.org?.id);
    await prisma.$disconnect();
  });

  test("an unchanged organisation compares clean, and a changed role is named — that one row only", async () => {
    const before = await captureState(prisma);
    expect(compareStates(before, await captureState(prisma), include()).violations).toEqual([]);

    await setMembership(qs.id, { role: "pm" });
    const { violations, broad } = compareStates(before, await captureState(prisma), include());
    expect(violations).toEqual([
      expect.objectContaining({ check: "membership_changed", membershipId: qs.membership.id, changes: { role: { from: "qs", to: "pm" } } }),
    ]);
    expect(broad).toEqual([]);
    await setMembership(qs.id, { role: "qs" });
  });

  test("the incident's signature — several people turned PM at once — is reported as a broad change", async () => {
    const before = await captureState(prisma);
    for (const person of [qs, site, store]) await setMembership(person.id, { role: "pm" });
    const { violations, broad } = compareStates(before, await captureState(prisma), include());
    expect(violations.filter((v) => v.check === "membership_changed")).toHaveLength(3);
    expect(broad).toEqual([{ orgId: live.org.id, changed: 3 }]);
    await setMembership(qs.id, { role: "qs" });
    await setMembership(site.id, { role: "site_engineer" });
    await setMembership(store.id, { role: "warehouse" });
    expect(compareStates(before, await captureState(prisma), include()).violations).toEqual([]);
  });

  test("a new membership is expected; a removed one, and a person left with none, are not", async () => {
    const before = await captureState(prisma);
    const newcomer = await createLiveUser(prisma, { orgId: live.org.id, name: "Sentinel Newcomer", email: `sentinel-new-${live.org.id}@octapm-live.test`, role: "finance", isCompanyAdmin: false });
    const added = compareStates(before, await captureState(prisma), include());
    expect(added).toMatchObject({ violations: [], created: 1 });

    await proveThrowaway();
    await prisma.organizationMembership.delete({ where: { orgId_userId: { orgId: live.org.id, userId: store.id } } });
    const removed = compareStates(before, await captureState(prisma), include());
    expect(removed.violations.map((v) => v.check).sort()).toEqual(["membership_removed", "user_lost_every_membership"]);
    expect(checkInvariants(await captureState(prisma), include())).toEqual([
      expect.objectContaining({ check: "user_without_home_membership", userId: store.id }),
    ]);
    store.membership = await createLiveMembership(prisma, store);
    expect(newcomer.membership.role).toBe("finance");
  });

  test("invariants: an admin grant nobody made, an organisation without an owner, a home role that drifted", async () => {
    expect(checkInvariants(await captureState(prisma), include())).toEqual([]);

    await setMembership(qs.id, { role: "pm", isAdmin: true });
    await setUser(qs.id, { role: "pm" });
    expect(checkInvariants(await captureState(prisma), include())).toEqual([
      expect.objectContaining({ check: "admin_without_grant", membershipId: qs.membership.id, role: "pm" }),
    ]);
    await setMembership(qs.id, { role: "qs", isAdmin: false });
    await setUser(qs.id, { role: "qs" });

    await setMembership(live.user.id, { isOwner: false });
    expect(checkInvariants(await captureState(prisma), include()).map((v) => v.check)).toContain("organisation_without_owner");
    await setMembership(live.user.id, { isOwner: true });

    await setMembership(site.id, { role: "pm" });
    expect(checkInvariants(await captureState(prisma), include())).toEqual([
      expect.objectContaining({ check: "role_drift", membershipId: site.membership.id, userRole: "site_engineer", membershipRole: "pm" }),
    ]);
    await setMembership(site.id, { role: "site_engineer" });
    expect(checkInvariants(await captureState(prisma), include())).toEqual([]);
  });

  test("the live-run teardown fails a run that changed a durable organisation's people, and passes one that did not", async () => {
    const arm = async () => {
      globalThis.__membershipSentinel = { before: await captureState(prisma), standing: new Set(), includeOrgIds: [live.org.id] };
    };
    try {
      await arm();
      await setMembership(qs.id, { role: "warehouse" });
      await expect(sentinelRun.teardown()).rejects.toThrow(/membership_changed.*"from":"qs","to":"warehouse"/s);
      await setMembership(qs.id, { role: "qs" });

      await arm();
      await createLiveUser(prisma, { orgId: live.org.id, name: "Sentinel Late", email: `sentinel-late-${live.org.id}@octapm-live.test`, role: "qs", isCompanyAdmin: false });
      await expect(sentinelRun.teardown()).resolves.toBeUndefined();
    } finally {
      delete globalThis.__membershipSentinel;
    }
  });
});
