/**
 * The API process behind a load balancer: idle connections outlive the
 * balancer's 60 s idle timeout, and SIGTERM drains sockets and HTTP and exits
 * 0 well inside ECS's stop window. One real src/index.js process, real
 * clients, the real local Postgres.
 *
 *   npm run test:live -- src/realtime/__live__/api-lifecycle.live.test.js
 */
const net = require("net");
const { io: connectSocket } = require("socket.io-client");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, freePort, liveDescribe, sleep, spawnNode, waitForHttp } = require("../../__live__/helpers");

/** Sends one HTTP/1.1 request on an open socket and resolves the raw response (headers and body). */
const request = (socket, path) =>
  new Promise((resolve, reject) => {
    let raw = "";
    const onData = (chunk) => {
      raw += chunk.toString();
      const headerEnd = raw.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const length = Number(/content-length:\s*(\d+)/i.exec(raw.slice(0, headerEnd))?.[1] || 0);
      if (Buffer.byteLength(raw.slice(headerEnd + 4)) < length) return;
      cleanup();
      resolve(raw);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error(`the server closed the connection (got ${raw.length} bytes)`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("close", onEnd);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("close", onEnd);
    socket.on("error", onError);
    socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n`);
  });

const openSocket = (port) =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => resolve(socket));
    socket.once("error", reject);
  });

liveDescribe("API process lifecycle", () => {
  let live;
  let api;
  let port;

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    port = await freePort();
    api = spawnNode("src/index.js", { env: { PORT: String(port), SHUTDOWN_TIMEOUT_MS: "6000" } });
    await api.waitForOutput(/running on port/);
    await waitForHttp(`http://127.0.0.1:${port}/api/health`);
  }, 60_000);

  afterAll(async () => {
    if (api) await api.kill();
    if (live) await dropLiveOrg(prisma, live.org.id);
    await prisma.$disconnect();
  });

  it("keeps an idle connection open longer than the load balancer's 60 s idle timeout", async () => {
    const socket = await openSocket(port);
    try {
      const first = await request(socket, "/api/health");
      expect(first).toMatch(/^HTTP\/1\.1 200/);
      expect(first).toMatch(/keep-alive: timeout=65/i);

      // Node's default would have closed it at 5 s.
      await sleep(6_000);
      const second = await request(socket, "/api/health");
      expect(second).toMatch(/^HTTP\/1\.1 200/);
    } finally {
      socket.destroy();
    }
  }, 20_000);

  it("on SIGTERM closes open sockets and idle connections, then exits 0 quickly", async () => {
    const client = connectSocket(`http://127.0.0.1:${port}`, { transports: ["websocket"], auth: { token: live.token }, reconnection: false });
    await new Promise((resolve, reject) => {
      client.once("realtime.ready", resolve);
      client.once("connect_error", reject);
    });
    const idle = await openSocket(port);
    expect(await request(idle, "/api/health")).toMatch(/^HTTP\/1\.1 200/);

    const disconnected = new Promise((resolve) => client.once("disconnect", (reason) => resolve({ reason, exitCode: api.child.exitCode })));
    const idleClosed = new Promise((resolve) => idle.once("close", resolve));
    const started = Date.now();
    await api.signal("SIGTERM");

    const { code, output } = await api.exited;
    const elapsed = Date.now() - started;
    const { reason } = await disconnected;
    await idleClosed;
    api = null;

    expect(code).toBe(0);
    expect(elapsed).toBeLessThan(3_000);
    // A transport close, not a server-side disconnect: socket.io clients
    // reconnect on their own after it — to another task.
    expect(reason).toBe("transport close");
    expect(output).toMatch(/\[api\] SIGTERM received; draining[\s\S]*\[api\] shutdown complete/);
  }, 20_000);
});
