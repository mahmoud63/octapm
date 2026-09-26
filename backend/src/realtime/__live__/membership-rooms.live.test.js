/**
 * Realtime rooms keyed by membership (ENT-5), against a real API process and
 * the real local Postgres: one identity with memberships in two LiveTest
 * workspaces, one socket per workspace, and the rules the multi-tenant
 * doc §3 states for them —
 *
 *   - a notification created in A reaches the A socket and not the B socket;
 *   - a membership change in A drops the A socket and B stays connected;
 *   - a deactivation in A (B remains) drops A's socket only;
 *   - a push payload built for A carries A's orgId, slug and membership id.
 *
 *   npm run test:live -- src/realtime/__live__/membership-rooms.live.test.js
 */
const crypto = require("crypto");
const { io: connectSocket } = require("socket.io-client");
const { prisma } = require("../../config/db");
const membershipService = require("../../services/membership.service");
const pushService = require("../../services/push.service");
const { allocateSlug } = require("../../utils/workspace-slug");
const {
  createLiveOrg,
  createLiveUser,
  dropLiveOrg,
  freePort,
  liveDescribe,
  mintAccessToken,
  sleep,
  spawnNode,
  waitForHttp,
} = require("../../__live__/helpers");

/** A socket that is ready, with the `realtime.ready` payload it was greeted with. */
const connect = (port, token) =>
  new Promise((resolve, reject) => {
    const socket = connectSocket(`http://127.0.0.1:${port}`, { transports: ["websocket"], reconnection: false, auth: { token } });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`no realtime.ready from :${port} within 8 s`));
    }, 8_000);
    socket.once("realtime.ready", (ready) => {
      clearTimeout(timer);
      socket.ready = ready;
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });

const nextEvent = (socket, predicate, timeoutMs = 5_000) =>
  new Promise((resolve, reject) => {
    const onEvent = (event) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      socket.off("domain.event", onEvent);
      resolve(event);
    };
    const timer = setTimeout(() => {
      socket.off("domain.event", onEvent);
      reject(new Error(`no matching domain.event within ${timeoutMs} ms`));
    }, timeoutMs);
    socket.on("domain.event", onEvent);
  });

/** Resolves with every matching event that arrives within the window — the way to assert that none does. */
const eventsWithin = (socket, predicate, windowMs) =>
  new Promise((resolve) => {
    const seen = [];
    const onEvent = (event) => {
      if (predicate(event)) seen.push(event);
    };
    socket.on("domain.event", onEvent);
    setTimeout(() => {
      socket.off("domain.event", onEvent);
      resolve(seen);
    }, windowMs);
  });

const disconnected = (socket, timeoutMs = 8_000) =>
  new Promise((resolve, reject) => {
    if (!socket.connected) return resolve("already");
    const timer = setTimeout(() => reject(new Error(`socket still connected after ${timeoutMs} ms`)), timeoutMs);
    socket.once("disconnect", (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
    return undefined;
  });

const joinProject = (socket, projectId) => new Promise((resolve) => socket.emit("project:join", { projectId }, resolve));

liveDescribe("realtime rooms keyed by membership (ENT-5)", () => {
  let a;
  let b;
  let person;
  let membershipA;
  let membershipB;
  let projectA;
  let projectB;
  let api;
  let port;
  const sockets = [];
  const track = (socket) => {
    sockets.push(socket);
    return socket;
  };

  const tokenFor = (org, membership) =>
    mintAccessToken({
      id: person.id,
      orgId: org.id,
      role: membership.role,
      email: person.email,
      name: person.name,
      isCompanyAdmin: Boolean(membership.isAdmin || membership.isOwner),
      membershipId: membership.id,
      isAdmin: membership.isAdmin,
      isOwner: membership.isOwner,
      kind: "member",
    });

  const call = (token, pathname, { method = "GET", body } = {}) =>
    fetch(`http://127.0.0.1:${port}/api/v1${pathname}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    a = await createLiveOrg(prisma);
    b = await createLiveOrg(prisma);
    for (const live of [a, b]) {
      const slug = await allocateSlug(prisma, live.org.name);
      live.org = await prisma.organisation.update({ where: { id: live.org.id }, data: { slug } });
    }
    // The person's home is A (their User row), and a membership makes them a
    // member of B as well — an administrator there, so B's projects are theirs.
    person = await createLiveUser(prisma, {
      orgId: a.org.id,
      name: "Live Two Workspaces",
      email: `live-two-${crypto.randomUUID()}@octapm-live.test`,
      role: "site_engineer",
    });
    membershipA = person.membership;
    membershipB = (
      await membershipService.ensureMembership({ tx: prisma, orgId: b.org.id, userId: person.id, role: "pm", isAdmin: true })
    ).membership;
    projectA = await prisma.project.create({ data: { orgId: a.org.id, name: "LiveTest rooms A" } });
    projectB = await prisma.project.create({ data: { orgId: b.org.id, name: "LiveTest rooms B" } });
    await prisma.projectAssignment.create({ data: { projectId: projectA.id, orgId: a.org.id, userId: person.id, role: "site_engineer" } });

    port = await freePort();
    api = spawnNode("src/index.js", { env: { PORT: String(port) } });
    await api.waitForOutput(/running on port/, 45_000);
    await waitForHttp(`http://127.0.0.1:${port}/api/health`);
  }, 120_000);

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    if (api) await api.kill();
    // B first: its membership row for the person (whose User row is A's) goes with B.
    if (b) await dropLiveOrg(prisma, b.org.id);
    if (a) await dropLiveOrg(prisma, a.org.id);
    await prisma.$disconnect();
  }, 60_000);

  let onA;
  let onB;

  it("one identity, two workspaces: each socket is greeted with the membership it is connected in", async () => {
    onA = track(await connect(port, tokenFor(a.org, membershipA)));
    onB = track(await connect(port, tokenFor(b.org, membershipB)));
    expect(onA.ready).toMatchObject({ userId: person.id, orgId: a.org.id, membershipId: membershipA.id });
    expect(onB.ready).toMatchObject({ userId: person.id, orgId: b.org.id, membershipId: membershipB.id });
  });

  it("a notification created in A reaches the A socket only; the B socket, the same person, hears nothing", async () => {
    const arrivalA = nextEvent(onA, (event) => event.type === "notification.created" && event.orgId === a.org.id);
    const heardOnB = eventsWithin(onB, (event) => event.type === "notification.created", 2_500);
    const response = await call(a.token, "/tasks", {
      method: "POST",
      body: { title: `Live rooms ${Date.now()}`, projectId: projectA.id, assigneeId: person.id },
    });
    expect(response.status).toBe(201);
    const event = await arrivalA;
    expect(event).toMatchObject({ type: "notification.created", orgId: a.org.id, entityType: "task" });
    expect(await heardOnB).toEqual([]);
  }, 20_000);

  it("a push payload built for A carries A's orgId, slug and the person's A membership; for B, B's", async () => {
    const notification = await prisma.notification.findFirst({ where: { orgId: a.org.id, recipientUserId: person.id }, orderBy: { createdAt: "desc" } });
    expect(notification).toBeTruthy();
    const forA = await pushService.buildPushPayload({ notification, userId: person.id });
    expect(forA).toMatchObject({ orgId: a.org.id, orgSlug: a.org.slug, membershipId: membershipA.id, entityType: "task", projectId: projectA.id });
    const forB = await pushService.buildPushPayload({ notification: { ...notification, orgId: b.org.id }, userId: person.id });
    expect(forB).toMatchObject({ orgId: b.org.id, orgSlug: b.org.slug, membershipId: membershipB.id });
    expect(forB.membershipId).not.toBe(forA.membershipId);
  });

  it("a membership change in A drops the A socket; B stays connected and still receives its project's events", async () => {
    expect(await joinProject(onB, projectB.id)).toMatchObject({ ok: true });
    const goneA = disconnected(onA);
    const changed = await call(a.token, `/users/${person.id}`, { method: "PATCH", body: { role: "quality_engineer" } });
    expect(changed.status).toBe(200);
    await goneA;
    expect(onA.connected).toBe(false);
    await sleep(1_000);
    expect(onB.connected).toBe(true);

    const arrivalB = nextEvent(onB, (event) => event.entityType === "location" && event.projectId === projectB.id);
    const location = await call(b.token, `/projects/${projectB.id}/locations`, { method: "POST", body: { name: `Level ${Date.now()}` } });
    expect(location.status).toBe(201);
    expect(await arrivalB).toMatchObject({ type: "record.changed", action: "created", orgId: b.org.id });
  }, 30_000);

  it("a deactivation in A, while B remains, drops only A's socket; the identity is not closed", async () => {
    const fresh = await prisma.organizationMembership.findUnique({ where: { id: membershipA.id } });
    onA = track(await connect(port, tokenFor(a.org, fresh)));
    expect(onA.ready).toMatchObject({ membershipId: membershipA.id });
    const goneA = disconnected(onA);
    const deactivated = await call(a.token, `/users/${person.id}/deactivate`, { method: "PATCH" });
    expect(deactivated.status).toBe(200);
    await goneA;
    await sleep(1_000);
    expect(onB.connected).toBe(true);
    const user = await prisma.user.findUnique({ where: { id: person.id }, select: { status: true } });
    expect(user.status).toBe("active");
    expect((await prisma.organizationMembership.findUnique({ where: { id: membershipA.id } })).status).toBe("suspended");
    expect((await prisma.organizationMembership.findUnique({ where: { id: membershipB.id } })).status).toBe("active");
  }, 30_000);
});
