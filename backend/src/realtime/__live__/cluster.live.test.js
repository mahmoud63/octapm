/**
 * Realtime across processes, the way AWS runs it: two real API processes
 * (src/index.js) and one real worker process (src/worker.js), all on the
 * Postgres adapter with one channel prefix, against the real local Postgres.
 * Clients are real socket.io clients; every event starts from a real HTTP
 * request or a real job.
 *
 *   npm run test:live -- src/realtime/__live__/cluster.live.test.js
 */
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { io: connectSocket } = require("socket.io-client");
const { prisma } = require("../../config/db");
const {
  createLiveOrg,
  dropLiveOrg,
  freePort,
  liveDescribe,
  mintAccessToken,
  sleep,
  spawnNode,
  uniqueTag,
  waitForHttp,
} = require("../../__live__/helpers");

const withPool = (url, limit) => {
  const parsed = new URL(url);
  parsed.searchParams.set("connection_limit", String(limit));
  return parsed.toString();
};

/** `options` replaces the defaults entirely, so a test can connect with exactly another client's options. */
const connect = (port, token, options = { transports: ["websocket"], reconnection: false }) =>
  new Promise((resolve, reject) => {
    const socket = connectSocket(`http://127.0.0.1:${port}`, { ...options, auth: { token } });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`no realtime.ready from :${port} within 8 s`));
    }, 8_000);
    socket.once("realtime.ready", () => {
      clearTimeout(timer);
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

const joinProject = (socket, projectId) =>
  new Promise((resolve) => socket.emit("project:join", { projectId }, resolve));

const waitFor = async (check, { timeoutMs = 10_000, intervalMs = 150, label = "condition" } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`${label} not met within ${timeoutMs} ms (last: ${JSON.stringify(last)})`);
};

/** An HTTP + WebSocket proxy that sends each request and each upgrade to the next target in turn — a load balancer with no stickiness. */
const createRoundRobinProxy = (ports) => {
  let turn = 0;
  const pick = () => ports[turn++ % ports.length];
  const server = http.createServer((req, res) => {
    const upstream = http.request(
      { host: "127.0.0.1", port: pick(), method: req.method, path: req.url, headers: req.headers, agent: false },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  server.on("upgrade", (req, socket, head) => {
    const upstream = net.connect(pick(), "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let index = 0; index < req.rawHeaders.length; index += 2) lines.push(`${req.rawHeaders[index]}: ${req.rawHeaders[index + 1]}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  return server;
};

/** The web client's own socket options, read from frontend/src/lib/realtime.ts so the test follows the source. */
const frontendSocketOptions = () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../../../frontend/src/lib/realtime.ts"), "utf8");
  const match = /export const REALTIME_SOCKET_OPTIONS[^=]*=\s*(\{[\s\S]*?\n\})/.exec(source);
  if (!match) throw new Error("REALTIME_SOCKET_OPTIONS not found in frontend/src/lib/realtime.ts");
  // eslint-disable-next-line no-new-func
  return new Function(`return (${match[1]});`)();
};

liveDescribe("realtime across API and worker processes", () => {
  const prefix = uniqueTag("rt");
  const liveJobType = `live.job.${crypto.randomUUID().slice(0, 8)}`;
  const listenQuery = `LISTEN "${prefix}#/"`;
  let live;
  let other;
  let project;
  let subscription;
  let hook;
  const hookBodies = [];
  let apiA;
  let apiB;
  let apiC;
  let worker;
  let portA;
  let portB;
  const sockets = [];

  const track = (socket) => {
    sockets.push(socket);
    return socket;
  };

  const listenPids = async () =>
    (
      await prisma.$queryRaw`SELECT pid FROM pg_stat_activity WHERE application_name = 'octapm-realtime' AND query = ${listenQuery}`
    ).map((row) => row.pid);

  const createJob = (data) =>
    prisma.backgroundJob.create({
      data: {
        orgId: live.org.id,
        type: liveJobType,
        status: "queued",
        requestedBy: live.user.id,
        expiresAt: new Date(Date.now() + 3_600_000),
        ...data,
      },
    });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await prisma.user.create({
      data: {
        orgId: live.org.id,
        name: "Live Test Site Engineer",
        email: `live-other-${crypto.randomUUID()}@octapm-live.test`,
        passwordHash: await bcrypt.hash(`Live-${crypto.randomUUID()}`, 4),
        role: "site_engineer",
      },
    });
    project = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest realtime project" } });

    hook = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        hookBodies.push(JSON.parse(body || "{}"));
        res.writeHead(200);
        res.end("ok");
      });
    });
    await new Promise((resolve) => hook.listen(0, "127.0.0.1", resolve));
    subscription = await prisma.webhookSubscription.create({
      data: {
        orgId: live.org.id,
        name: "LiveTest hook",
        url: `http://127.0.0.1:${hook.address().port}/hook`,
        secret: `whsec_${crypto.randomBytes(24).toString("base64url")}`,
        eventTypes: ["location.*", "background_job.*"],
      },
    });

    // The hook listens on 127.0.0.1, which webhooks reach only through the
    // local-development escape hatch — here and in every spawned process.
    process.env.WEBHOOK_ALLOW_HTTP = "true";
    shared = {
      REALTIME_ADAPTER: "postgres",
      REALTIME_CHANNEL_PREFIX: prefix,
      REALTIME_POOL_MAX: "2",
      DATABASE_URL: withPool(process.env.DATABASE_URL, 3),
      WEBHOOK_ALLOW_HTTP: "true",
    };
    [portA, portB] = [await freePort(), await freePort()];
    apiA = spawnNode("src/index.js", { env: { ...shared, PORT: String(portA) } });
    apiB = spawnNode("src/index.js", { env: { ...shared, PORT: String(portB) } });
    worker = spawnNode("src/jobs/__live__/fixtures/worker-with-live-handler.js", {
      env: {
        ...shared,
        JOB_WORKER_ENABLED: "true",
        JOB_WORKER_TYPES: liveJobType,
        LIVE_JOB_TYPE: liveJobType,
        JOB_POLL_INTERVAL_MS: "200",
        // Recovery at start must not touch anybody else's jobs in the shared database.
        JOB_STALE_MS: "315360000000",
      },
    });
    // Three processes booting at once on a busy machine can be slow.
    await Promise.all([
      apiA.waitForOutput(/running on port/, 45_000),
      apiB.waitForOutput(/running on port/, 45_000),
      worker.waitForOutput(/\[job-worker\] .* started/, 45_000),
    ]);
    await waitForHttp(`http://127.0.0.1:${portA}/api/health`);
    await waitForHttp(`http://127.0.0.1:${portB}/api/health`);
    // Give every process the chance to be listening on the channel before
    // anything is published. Not an assertion: a process that never listens
    // must fail the test that needs it, not this setup.
    await waitFor(async () => (await listenPids()).length === 3, { label: "three LISTEN connections" }).catch(() => {});
  }, 120_000);

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await Promise.all([apiA, apiB, apiC, worker].filter(Boolean).map((proc) => proc.kill()));
    hook?.close();
    if (live) {
      await prisma.backgroundJob.deleteMany({ where: { orgId: live.org.id } });
      await prisma.webhookDelivery.deleteMany({ where: { orgId: live.org.id } });
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  }, 60_000);

  const api = (port, pathname, { method = "GET", body } = {}) =>
    fetch(`http://127.0.0.1:${port}/api/v1${pathname}`, {
      method,
      headers: { authorization: `Bearer ${live.token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  let locationEvent;
  let shared;

  it("a record event raised by a request on A reaches a client connected to B", async () => {
    const onB = track(await connect(portB, live.token));
    expect(await joinProject(onB, project.id)).toMatchObject({ ok: true });

    const arrival = nextEvent(onB, (event) => event.entityType === "location" && event.projectId === project.id);
    const response = await api(portA, `/projects/${project.id}/locations`, { method: "POST", body: { name: `Level ${Date.now()}` } });
    expect(response.status).toBe(201);
    const created = (await response.json()).data;

    locationEvent = await arrival;
    expect(locationEvent).toMatchObject({ type: "record.changed", action: "created", entityId: created.id });
    // The record's figures stay behind; subscribers refetch what they may read.
    expect(locationEvent.payload.summary).toBeUndefined();
  });

  it("a role change made on A drops that person's socket on B, and nobody else's", async () => {
    const theirs = track(await connect(portB, mintAccessToken(other)));
    const mine = track(await connect(portB, live.token));
    const dropped = new Promise((resolve) => theirs.once("disconnect", resolve));

    const response = await api(portA, `/users/${other.id}`, { method: "PATCH", body: { role: "qs" } });
    expect(response.status).toBe(200);

    const reason = await Promise.race([dropped, sleep(4_000).then(() => "still connected after 4 s")]);
    expect(reason).toBe("io server disconnect");
    expect(mine.connected).toBe(true);
  });

  it("a job event raised in the worker reaches clients on both API processes", async () => {
    const onA = track(await connect(portA, live.token));
    const onB = track(await connect(portB, live.token));
    const job = await createJob({ payloadJson: { sleepMs: 0 } });
    const finished = (event) => event.type === "job.progress" && event.entityId === job.id && event.action === "succeeded";

    const [seenOnA, seenOnB] = await Promise.all([nextEvent(onA, finished, 10_000), nextEvent(onB, finished, 10_000)]);
    expect(seenOnA.payload.jobType).toBe(liveJobType);
    expect(seenOnB.payload.jobType).toBe(liveJobType);
    expect((await prisma.backgroundJob.findUnique({ where: { id: job.id } })).status).toBe("succeeded");
  });

  it("a request on A produces exactly one webhook delivery, however many processes hear the event", async () => {
    expect(locationEvent?.id).toBeTruthy();
    await sleep(1_500);
    const deliveries = await prisma.webhookDelivery.findMany({ where: { subscriptionId: subscription.id, eventId: locationEvent.id } });
    expect(deliveries).toHaveLength(1);
    const deliveryJobs = await prisma.backgroundJob.findMany({
      where: { orgId: live.org.id, type: "webhook.deliver", payloadJson: { path: ["deliveryId"], equals: deliveries[0].id } },
    });
    expect(deliveryJobs).toHaveLength(1);

    // Whichever worker delivers it (the developer's API on :5000 may claim the
    // job first), the endpoint hears about the event once.
    const heard = () => hookBodies.filter((body) => body.id === locationEvent.id).length;
    try {
      await waitFor(() => heard() >= 1, { timeoutMs: 8_000, label: "webhook POST" });
    } catch {
      await require("../../services/webhook.service").runDeliveryJob({ payload: { deliveryId: deliveries[0].id } });
    }
    await sleep(1_000);
    expect(heard()).toBe(1);
  }, 30_000);

  it("an event raised inside the worker gets its webhook delivery too, exactly once", async () => {
    const job = await createJob({ projectId: project.id, payloadJson: { sleepMs: 0 } });
    await waitFor(async () => (await prisma.backgroundJob.findUnique({ where: { id: job.id } })).status === "succeeded", { label: "job succeeded" });
    await sleep(1_500);
    const deliveries = await prisma.webhookDelivery.findMany({ where: { subscriptionId: subscription.id, eventType: "background_job.completed" } });
    expect(deliveries.filter((delivery) => delivery.payloadJson?.entity?.id === job.id)).toHaveLength(1);
  }, 30_000);

  it("a packet over NOTIFY's 8000-byte limit crosses through socket_io_attachments", async () => {
    const onB = track(await connect(portB, live.token));
    const [{ max }] = await prisma.$queryRaw`SELECT COALESCE(MAX(id), 0)::bigint AS max FROM socket_io_attachments`;
    const job = await createJob({ payloadJson: { sleepMs: 0, bigProgress: true } });

    const event = await nextEvent(onB, (candidate) => candidate.entityId === job.id && candidate.payload?.progress?.step === "big", 10_000);
    expect(event.payload.progress.detail.k29).toBe("29".padEnd(450, "x"));
    expect(Buffer.byteLength(JSON.stringify(event))).toBeGreaterThan(8_000);
    const [{ newer }] = await prisma.$queryRaw`SELECT COUNT(*)::int AS newer FROM socket_io_attachments WHERE id > ${max}`;
    expect(newer).toBeGreaterThan(0);
  }, 30_000);

  it("recovers when the LISTEN connections are cut", async () => {
    const before = await listenPids();
    expect(before).toHaveLength(3);
    for (const pid of before) await prisma.$queryRaw`SELECT pg_terminate_backend(${pid}::int)`;

    const after = await waitFor(
      async () => {
        const pids = await listenPids();
        return pids.length === 3 && pids.every((pid) => !before.includes(pid)) ? pids : null;
      },
      { timeoutMs: 12_000, label: "three new LISTEN connections" },
    );
    expect(after).toHaveLength(3);
    for (const proc of [apiA, apiB, worker]) expect(proc.child.exitCode).toBeNull();

    const onB = track(await connect(portB, live.token));
    expect(await joinProject(onB, project.id)).toMatchObject({ ok: true });
    const arrival = nextEvent(onB, (event) => event.entityType === "location" && event.projectId === project.id);
    const response = await api(portA, `/projects/${project.id}/locations`, { method: "POST", body: { name: `After ${Date.now()}` } });
    expect(response.status).toBe(201);
    await arrival;
  }, 40_000);

  it("the web client's socket options connect through a load balancer with no stickiness", async () => {
    const options = frontendSocketOptions();
    const proxy = createRoundRobinProxy([portA, portB]);
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    try {
      // The web client's options as they are, except that a failed first
      // attempt must fail the test rather than be retried until it lands.
      const socket = track(await connect(proxy.address().port, live.token, { ...options, reconnection: false }));
      expect(socket.connected).toBe(true);
      expect(socket.io.engine.transport.name).toBe("websocket");
    } finally {
      proxy.close();
    }
  });

  it("delivers the event of a request that finished just before SIGTERM", async () => {
    // A third API task that is about to be replaced in a rolling deploy.
    const portC = await freePort();
    apiC = spawnNode("src/index.js", { env: { ...shared, PORT: String(portC) } });
    await apiC.waitForOutput(/running on port/, 45_000);
    await waitForHttp(`http://127.0.0.1:${portC}/api/health`);

    const onB = track(await connect(portB, live.token));
    expect(await joinProject(onB, project.id)).toMatchObject({ ok: true });
    const arrival = nextEvent(onB, (event) => event.entityType === "location" && event.projectId === project.id, 8_000).then(
      (event) => event,
      () => null,
    );

    const response = await api(portC, `/projects/${project.id}/locations`, { method: "POST", body: { name: `Draining ${Date.now()}` } });
    expect(response.status).toBe(201);
    const created = (await response.json()).data;
    // The event is still waiting out the bus delay when the signal lands.
    await apiC.signal("SIGTERM");
    const { code } = await apiC.exited;
    expect(code).toBe(0);

    const event = await arrival;
    expect(event ? "received" : "lost").toBe("received");
    expect(event.entityId).toBe(created.id);
  }, 90_000);
});
