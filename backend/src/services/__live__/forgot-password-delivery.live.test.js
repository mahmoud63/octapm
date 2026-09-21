/**
 * Forgot-password when the email provider is down.
 *
 * The answer must be the same neutral 200 {sent:true} for a registered and an
 * unknown address; a 5xx for real accounts alone would tell a stranger which
 * emails are registered. The failure is not lost: it is written to the auth
 * audit trail. The provider here is a fake webhook on 127.0.0.1 that answers
 * every message with a 500.
 */
const http = require("http");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

liveDescribe("forgot-password with a failing email provider", () => {
  let live;
  let api;
  let provider;
  const received = [];

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    provider = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        received.push(JSON.parse(body || "{}"));
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "provider down" }));
      });
    });
    await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
    api = await startApi({ EMAIL_WEBHOOK_URL: `http://127.0.0.1:${provider.address().port}/send` });
  });

  afterAll(async () => {
    if (api) await api.stop();
    if (provider) await new Promise((resolve) => provider.close(resolve));
    if (live) await dropLiveOrg(prisma, live.org.id);
    await prisma.$disconnect();
  });

  it("answers 200 {sent:true}, and records the failed delivery", async () => {
    const response = await api.post("/api/v1/auth/forgot-password", { email: live.user.email });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { sent: true } });

    // The provider really was asked, and really refused.
    expect(received).toHaveLength(1);
    expect(received[0].to).toBe(live.user.email);

    const failure = await prisma.authAuditEvent.findFirst({
      where: { userId: live.user.id, action: "password_reset_delivery_failed" },
    });
    expect(failure).not.toBeNull();
    expect(failure.metadataJson).toMatchObject({ code: "EMAIL_DELIVERY_FAILED", status: 500 });
  });

  it("answers an unknown address exactly the same way", async () => {
    const response = await api.post("/api/v1/auth/forgot-password", { email: `nobody-${Date.now()}@octapm-live.test` });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { sent: true } });
  });
});
