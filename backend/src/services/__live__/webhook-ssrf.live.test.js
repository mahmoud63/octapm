/**
 * Webhooks reach public addresses only (SSRF). On AWS the API sits next to the
 * task's credentials endpoint (169.254.170.2), the instance metadata service
 * and every VPC host; a webhook URL is chosen by an organisation, so it must
 * never be able to point the server at them.
 *
 * Everything runs against the real local Postgres and real sockets. "Inside"
 * is a fake internal service on 127.0.0.1 that counts TCP connections: a
 * refused delivery must not even connect to it. Names under .octapm-live.test
 * answer from a fake DNS zone (dns.lookup, which the service resolves with)
 * so a hostname can resolve to a private address, or change its answer
 * between save and delivery, or between the check and the connection.
 *
 *   npm run test:live --workspace=backend -- src/services/__live__/webhook-ssrf.live.test.js
 */
const crypto = require("crypto");
const dns = require("dns");
const http = require("http");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const webhooks = require("../webhook.service");

// Nothing in this file publishes rfi events, so no fan-out ever queues a job
// that another process's worker (the developer's API on :5000) could claim.
const QUIET_EVENTS = ["rfi.status_changed"];
const SECRET = `whsec_${crypto.randomBytes(24).toString("base64url")}`;

// ---- fake DNS -------------------------------------------------------------
const ZONE = ".octapm-live.test";
const zone = new Map();
const asked = [];
const realLookup = dns.lookup.bind(dns);
const answer = (...addresses) => () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
const lookupsOf = (name) => asked.filter((entry) => entry === name).length;

// ---- receivers on 127.0.0.1 ----------------------------------------------
const startReceiver = async (respond) => {
  const receiver = { requests: [], connections: 0 };
  receiver.server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const request = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      receiver.requests.push(request);
      respond(req, res, request);
    });
  });
  receiver.server.on("connection", () => {
    receiver.connections += 1;
  });
  await new Promise((resolve) => receiver.server.listen(0, "127.0.0.1", resolve));
  receiver.port = receiver.server.address().port;
  return receiver;
};
const stopReceiver = (receiver) =>
  receiver &&
  new Promise((resolve) => {
    receiver.server.closeAllConnections?.();
    receiver.server.close(resolve);
  });

const ENV_KEYS = ["NODE_ENV", "WEBHOOK_ALLOW_HTTP"];

liveDescribe("webhooks reach public addresses only", () => {
  let live;
  let inside;
  let receiver;
  let redirector;
  let api;
  const savedEnv = {};
  const actor = () => ({ id: live.user.id });

  const setEnv = (values) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  /** The escape hatch off: what production and an ordinary developer machine run. */
  const strict = () => setEnv({ NODE_ENV: "test", WEBHOOK_ALLOW_HTTP: undefined });
  /** WEBHOOK_ALLOW_HTTP=true outside production: a developer's own receiver. */
  const localHatch = () => setEnv({ NODE_ENV: "test", WEBHOOK_ALLOW_HTTP: "true" });

  const save = (url) => webhooks.createSubscription({ orgId: live.org.id, actor: actor(), payload: { name: "LiveTest webhook", url, eventTypes: QUIET_EVENTS } });
  const subscriptionCount = () => prisma.webhookSubscription.count({ where: { orgId: live.org.id } });
  /** A row as a subscription saved before this check existed, or before its DNS changed, would be. */
  const stored = (url) => prisma.webhookSubscription.create({ data: { orgId: live.org.id, name: "LiveTest stored webhook", url, secret: SECRET, eventTypes: QUIET_EVENTS } });
  const newDelivery = (subscription) =>
    prisma.webhookDelivery.create({ data: { orgId: live.org.id, subscriptionId: subscription.id, eventId: crypto.randomUUID(), eventType: "rfi.status_changed", payloadJson: { id: crypto.randomUUID(), type: "record.changed", event: "rfi.status_changed" } } });
  /** One attempt as the worker runs it: inside the job's organisation. */
  const run = async (deliveryId) => webhooks.runDeliveryJob({ orgId: live.org.id, payload: { deliveryId } }).then((result) => ({ result }), (error) => ({ error }));
  /** One delivery attempt through the real transport, and the row it left. */
  const attempt = async (subscription) => {
    const delivery = await newDelivery(subscription);
    const outcome = await run(delivery.id);
    return { ...outcome, row: await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } }) };
  };

  beforeAll(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    jest.spyOn(dns, "lookup").mockImplementation((hostname, options, callback) => {
      const name = String(hostname).toLowerCase();
      if (!name.endsWith(ZONE)) return realLookup(hostname, options, callback);
      asked.push(name);
      const respond = typeof options === "function" ? options : callback;
      const entry = zone.get(name);
      if (!entry) return process.nextTick(respond, Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND", hostname }));
      return process.nextTick(respond, null, entry());
    });
    zone.set(`vpc${ZONE}`, answer("10.0.0.8"));
    zone.set(`metadata${ZONE}`, answer("169.254.169.254"));
    zone.set(`creds${ZONE}`, answer("169.254.170.2"));
    zone.set(`cgnat${ZONE}`, answer("100.64.12.34"));
    zone.set(`ula${ZONE}`, answer("fd00:ec2::254"));
    zone.set(`mapped-private${ZONE}`, answer("::ffff:192.168.1.5"));
    zone.set(`split${ZONE}`, answer("192.0.2.10", "10.0.0.9"));
    zone.set(`partner${ZONE}`, answer("192.0.2.10", "2001:db8::10"));
    zone.set(`internal${ZONE}`, answer("127.0.0.1"));
    zone.set(`mapped-loopback${ZONE}`, answer("::ffff:127.0.0.1"));
    zone.set(`zero${ZONE}`, answer("0.0.0.0"));

    live = await createLiveOrg(prisma);
    inside = await startReceiver((req, res) => res.writeHead(200, { "content-type": "text/plain" }).end("you reached the inside"));
    receiver = await startReceiver((req, res) => res.writeHead(202, { "content-type": "application/json" }).end('{"queued":true}'));
    // /r?code=307&to=<url> redirects once; /loop redirects to itself forever.
    redirector = await startReceiver((req, res) => {
      if (req.url === "/loop") return res.writeHead(307, { location: "/loop" }).end();
      const query = new URL(req.url, "http://redirector").searchParams;
      return res.writeHead(Number(query.get("code")), { location: query.get("to") }).end();
    });
  });

  afterAll(async () => {
    if (api) await api.stop();
    await Promise.all([inside, receiver, redirector].map(stopReceiver));
    if (live) await dropLiveOrg(prisma, live.org.id);
    jest.restoreAllMocks();
    setEnv(savedEnv);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    strict();
    // Each test answers for its own connections to the inside.
    inside.connections = 0;
  });

  describe("when a subscription is saved", () => {
    it.each([
      ["https://127.0.0.1/hook", "127.0.0.1 is a loopback address (127.0.0.0/8)"],
      ["https://2130706433/hook", "127.0.0.1 is a loopback address"],
      ["https://10.0.0.8/hook", "10.0.0.8 is a private address (10.0.0.0/8)"],
      ["https://172.16.0.1/hook", "172.16.0.1 is a private address (172.16.0.0/12)"],
      ["https://172.31.255.254/hook", "172.31.255.254 is a private address (172.16.0.0/12)"],
      ["https://192.168.0.10/hook", "192.168.0.10 is a private address (192.168.0.0/16)"],
      ["https://169.254.169.254/latest/meta-data/iam/security-credentials/", "169.254.169.254 is a link-local address (169.254.0.0/16)"],
      ["https://169.254.170.2/v2/credentials/task", "169.254.170.2 is a link-local address (169.254.0.0/16)"],
      ["https://100.64.0.1/hook", "100.64.0.1 is a carrier-grade NAT address (100.64.0.0/10)"],
      ["https://100.127.255.254/hook", "100.127.255.254 is a carrier-grade NAT address"],
      ["https://0.0.0.0/hook", "0.0.0.0 is an unspecified"],
      ["https://[::1]/hook", "::1 is a loopback address (::1/128)"],
      ["https://[::]/hook", ":: is an unspecified address"],
      ["https://[fe80::1]/hook", "fe80::1 is a link-local address (fe80::/10)"],
      ["https://[fd00:ec2::254]/latest/meta-data/", "fd00:ec2::254 is a unique-local address (fc00::/7)"],
      ["https://[::ffff:127.0.0.1]/hook", "a loopback address (127.0.0.0/8) in IPv4-mapped form"],
      ["https://[::ffff:169.254.169.254]/latest/meta-data/", "a link-local address (169.254.0.0/16) in IPv4-mapped form"],
      ["https://[::ffff:a9fe:aa02]/v2/credentials/task", "a link-local address (169.254.0.0/16) in IPv4-mapped form"],
      ["https://[::ffff:10.0.0.8]/hook", "a private address (10.0.0.0/8) in IPv4-mapped form"],
      ["https://localhost/hook", "localhost resolves to"],
      [`https://vpc${ZONE}/hook`, `vpc${ZONE} resolves to 10.0.0.8, a private address (10.0.0.0/8)`],
      [`https://metadata${ZONE}/latest/meta-data/`, `metadata${ZONE} resolves to 169.254.169.254, a link-local address`],
      [`https://creds${ZONE}/v2/credentials/task`, `creds${ZONE} resolves to 169.254.170.2, a link-local address`],
      [`https://cgnat${ZONE}/hook`, `cgnat${ZONE} resolves to 100.64.12.34, a carrier-grade NAT address`],
      [`https://ula${ZONE}/hook`, `ula${ZONE} resolves to fd00:ec2::254, a unique-local address`],
      [`https://mapped-private${ZONE}/hook`, `mapped-private${ZONE} resolves to ::ffff:192.168.1.5, a private address (192.168.0.0/16) in IPv4-mapped form`],
      [`https://split${ZONE}/hook`, `split${ZONE} resolves to 10.0.0.9, a private address`],
    ])("refuses %s", async (url, reason) => {
      const before = await subscriptionCount();
      await expect(save(url)).rejects.toMatchObject({ status: 400, code: "WEBHOOK_TARGET_REFUSED", message: expect.stringContaining(reason) });
      expect(await subscriptionCount()).toBe(before);
    });

    it("keeps public addresses, including the ones just outside each refused range", async () => {
      for (const url of ["https://172.15.255.255/hook", "https://172.32.0.1/hook", "https://100.63.255.255/hook", "https://100.128.0.1/hook", "https://169.253.255.255/hook", "https://11.0.0.1/hook", "https://192.169.0.1/hook", `https://partner${ZONE}/hook`]) {
        await expect(save(url)).resolves.toMatchObject({ url, status: "active" });
      }
    });

    it("says so when the host does not resolve at all", async () => {
      await expect(save(`https://nowhere${ZONE}/hook`)).rejects.toMatchObject({ status: 400, code: "WEBHOOK_URL_UNRESOLVED", message: expect.stringContaining("ENOTFOUND") });
    });

    it("checks a changed URL, and a URL put back into service by re-enabling", async () => {
      const sub = await save(`https://partner${ZONE}/hook`);
      await expect(webhooks.updateSubscription({ orgId: live.org.id, actor: actor(), subscriptionId: sub.id, payload: { url: `https://metadata${ZONE}/latest/meta-data/` } })).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED" });
      expect((await prisma.webhookSubscription.findUnique({ where: { id: sub.id } })).url).toBe(`https://partner${ZONE}/hook`);

      const old = await prisma.webhookSubscription.update({ where: { id: (await stored(`https://vpc${ZONE}/hook`)).id }, data: { status: "paused" } });
      await expect(webhooks.updateSubscription({ orgId: live.org.id, actor: actor(), subscriptionId: old.id, payload: { status: "active" } })).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED" });
      expect((await prisma.webhookSubscription.findUnique({ where: { id: old.id } })).status).toBe("paused");
    });
  });

  describe("on every delivery", () => {
    it("refuses a stored subscription whose host resolves to loopback, records why, and never connects", async () => {
      const sub = await stored(`http://internal${ZONE}:${inside.port}/hook`);
      const delivery = await newDelivery(sub);
      const reason = `Refused: internal${ZONE} resolves to 127.0.0.1, a loopback address (127.0.0.0/8); webhooks are delivered to public internet addresses only`;

      // Recorded like any other failed delivery: retried, then dead.
      for (let round = 1; round <= 4; round += 1) {
        const { error } = await run(delivery.id);
        expect(error).toMatchObject({ retryable: true, code: "WEBHOOK_RETRY" });
        expect(await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({ attempt: round, status: "failed", error: reason, responseStatus: null });
      }
      const { error } = await run(delivery.id);
      expect(error).toMatchObject({ retryable: false, code: "WEBHOOK_DEAD" });
      expect(await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({ attempt: 5, status: "dead", error: reason });
      expect(await prisma.webhookSubscription.findUnique({ where: { id: sub.id } })).toMatchObject({ lastStatus: "dead", lastError: reason, failureCount: 1 });
      expect(inside.connections).toBe(0);
    });

    it.each([
      ["an IP literal", (port) => `http://127.0.0.1:${port}/hook`, "Refused: 127.0.0.1 is a loopback address"],
      ["IPv4-mapped loopback", (port) => `http://[::ffff:127.0.0.1]:${port}/hook`, "Refused: ::ffff:7f00:1 is a loopback address (127.0.0.0/8) in IPv4-mapped form"],
      ["a name answering IPv4-mapped loopback", (port) => `http://mapped-loopback${ZONE}:${port}/hook`, `Refused: mapped-loopback${ZONE} resolves to ::ffff:127.0.0.1, a loopback address (127.0.0.0/8) in IPv4-mapped form`],
      ["0.0.0.0", (port) => `http://0.0.0.0:${port}/hook`, "Refused: 0.0.0.0 is an unspecified"],
      ["a name answering 0.0.0.0", (port) => `http://zero${ZONE}:${port}/hook`, `Refused: zero${ZONE} resolves to 0.0.0.0`],
    ])("refuses %s, and the inside never hears a thing", async (label, urlFor, reason) => {
      const { error, row } = await attempt(await stored(urlFor(inside.port)));
      expect(error).toMatchObject({ retryable: true });
      expect(row).toMatchObject({ status: "failed", attempt: 1 });
      expect(row.error).toContain(reason);
      expect(inside.connections).toBe(0);
    });

    it("checks again at delivery: a name that was public when saved and is loopback now is refused", async () => {
      zone.set(`rebind${ZONE}`, answer("192.0.2.10"));
      const sub = await save(`http://rebind${ZONE}:${inside.port}/hook`);
      zone.set(`rebind${ZONE}`, answer("127.0.0.1"));
      const { row } = await attempt({ id: sub.id });
      expect(row.error).toContain(`Refused: rebind${ZONE} resolves to 127.0.0.1, a loopback address`);
      expect(inside.connections).toBe(0);
    });

    it("connects to the address it checked: a second, different DNS answer is never asked for", async () => {
      // Public for the first question, loopback for every one after it. A
      // check made on one lookup and a connection made on another would land
      // on the inside receiver.
      let calls = 0;
      zone.set(`flip${ZONE}`, () => {
        calls += 1;
        return answer(calls === 1 ? "192.0.2.10" : "127.0.0.1")();
      });
      const before = lookupsOf(`flip${ZONE}`);
      const { row } = await attempt(await stored(`http://flip${ZONE}:${inside.port}/hook`));
      expect(inside.connections).toBe(0);
      expect(lookupsOf(`flip${ZONE}`) - before).toBe(1);
      // The socket went to 192.0.2.10 (TEST-NET-1, routed nowhere), so the
      // attempt fails on the network, not on the check.
      expect(row.status).toBe("failed");
      expect(row.error).not.toMatch(/^Refused/);
    }, 30_000);
  });

  describe("with WEBHOOK_ALLOW_HTTP=true on a developer machine", () => {
    it("still delivers, signed, to a receiver on this machine", async () => {
      localHatch();
      const sub = await save(`http://127.0.0.1:${receiver.port}/hook`);
      const before = receiver.requests.length;
      const { result, row } = await attempt({ id: sub.id });
      expect(result).toMatchObject({ delivered: true, responseStatus: 202 });
      expect(row).toMatchObject({ status: "delivered", responseStatus: 202, responseBody: '{"queued":true}' });
      const [request] = receiver.requests.slice(before);
      expect(request).toMatchObject({ method: "POST", url: "/hook" });
      expect(request.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(request.body)).toMatchObject({ event: "rfi.status_changed", webhook: { subscriptionId: sub.id, deliveryId: row.id, attempt: 1 } });
      expect(webhooks.verifySignature({ secret: sub.secret, header: request.headers[webhooks.SIGNATURE_HEADER], body: request.body })).toBe(true);
    });

    it("lets loopback through and nothing else", async () => {
      localHatch();
      for (const url of [`http://vpc${ZONE}/hook`, "http://169.254.169.254/latest/meta-data/", `http://creds${ZONE}/v2/credentials/task`, "http://[fd00:ec2::254]/latest/meta-data/", `http://0.0.0.0:${inside.port}/hook`]) {
        await expect(save(url)).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED" });
      }
    });

    it("follows a 307 to an allowed address with the same signed POST", async () => {
      localHatch();
      const target = `http://127.0.0.1:${receiver.port}/after-redirect`;
      const sub = await stored(`http://127.0.0.1:${redirector.port}/r?code=307&to=${encodeURIComponent(target)}`);
      const [redirectsBefore, receivedBefore] = [redirector.requests.length, receiver.requests.length];
      const { row } = await attempt(sub);
      expect(row).toMatchObject({ status: "delivered", responseStatus: 202 });
      const [first] = redirector.requests.slice(redirectsBefore);
      const [second] = receiver.requests.slice(receivedBefore);
      expect(second).toMatchObject({ method: "POST", url: "/after-redirect", body: first.body });
      expect(second.headers[webhooks.SIGNATURE_HEADER]).toBe(first.headers[webhooks.SIGNATURE_HEADER]);
    });

    it.each([
      [307, (port) => `http://0.0.0.0:${port}/stolen`, (port) => `Refused: redirect to http://0.0.0.0:${port}/stolen: 0.0.0.0 is an unspecified`],
      [308, (port) => `http://zero${ZONE}:${port}/stolen`, (port) => `Refused: redirect to http://zero${ZONE}:${port}/stolen: zero${ZONE} resolves to 0.0.0.0`],
    ])("does not follow a %s to a refused address", async (code, targetFor, reasonFor) => {
      localHatch();
      const sub = await stored(`http://127.0.0.1:${redirector.port}/r?code=${code}&to=${encodeURIComponent(targetFor(inside.port))}`);
      const { row } = await attempt(sub);
      expect(row.status).toBe("failed");
      expect(row.error).toContain(reasonFor(inside.port));
      expect(inside.connections).toBe(0);
    });

    it("answers other redirects as they stand, and stops a redirect loop", async () => {
      localHatch();
      const before = receiver.requests.length;
      const moved = await attempt(await stored(`http://127.0.0.1:${redirector.port}/r?code=302&to=${encodeURIComponent(`http://127.0.0.1:${receiver.port}/hook`)}`));
      expect(moved.row).toMatchObject({ status: "failed", responseStatus: 302, error: "Endpoint answered 302 (only 307 and 308 redirects are followed)" });
      expect(receiver.requests.length).toBe(before);

      const hopsBefore = redirector.requests.length;
      const loop = await attempt(await stored(`http://127.0.0.1:${redirector.port}/loop`));
      expect(loop.row).toMatchObject({ status: "failed", error: "Gave up after 3 redirects" });
      expect(redirector.requests.length - hopsBefore).toBe(4);
    });
  });

  describe("under NODE_ENV=production", () => {
    it("never honours WEBHOOK_ALLOW_HTTP, at save or at delivery", async () => {
      setEnv({ NODE_ENV: "production", WEBHOOK_ALLOW_HTTP: "true" });
      await expect(save(`http://127.0.0.1:${receiver.port}/hook`)).rejects.toMatchObject({ code: "WEBHOOK_URL_INVALID" });
      await expect(save(`https://127.0.0.1:${receiver.port}/hook`)).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED" });
      await expect(save(`https://localhost:${receiver.port}/hook`)).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED" });

      const connectionsBefore = receiver.connections;
      const plain = await attempt(await stored(`http://127.0.0.1:${receiver.port}/hook`));
      expect(plain.row.error).toBe("Refused: webhooks must use https, not http; webhooks are delivered to public internet addresses only");
      const named = await attempt(await stored(`https://internal${ZONE}:${receiver.port}/hook`));
      expect(named.row.error).toContain(`Refused: internal${ZONE} resolves to 127.0.0.1, a loopback address`);
      expect(receiver.connections).toBe(connectionsBefore);
    });
  });

  describe("through the real API", () => {
    beforeAll(async () => {
      api = await startApi({ WEBHOOK_ALLOW_HTTP: "false" });
    }, 60_000);

    const call = (method, route, body) => api.request(method, `/api/v1/integrations${route}`, { body, headers: { authorization: `Bearer ${live.token}` } });

    it("answers 400 WEBHOOK_TARGET_REFUSED in the standard envelope, and saves nothing", async () => {
      const before = await subscriptionCount();
      for (const url of ["https://169.254.169.254/latest/meta-data/iam/security-credentials/", `https://localhost:${inside.port}/hook`, "https://[::ffff:a9fe:a9fe]/latest/meta-data/"]) {
        const response = await call("POST", "/webhooks", { name: "LiveTest via API", url, eventTypes: QUIET_EVENTS });
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ success: false, error: { code: "WEBHOOK_TARGET_REFUSED", message: expect.stringContaining("Webhooks can only be delivered to public internet addresses") } });
      }
      expect(await subscriptionCount()).toBe(before);
    });

    it("reports a refused test delivery from Send test, and the inside never hears it", async () => {
      const sub = await stored(`https://127.0.0.1:${inside.port}/hook`);
      const response = await call("POST", `/webhooks/${sub.id}/test`);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ ok: false, delivery: { status: "failed", eventType: "webhook.test" } });
      expect(response.body.data.delivery.error).toContain("Refused: 127.0.0.1 is a loopback address");
      expect(inside.connections).toBe(0);
    });
  });
});
