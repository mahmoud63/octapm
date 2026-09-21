/**
 * The self-service registration switch, on real HTTP servers.
 *
 *   development, nothing set            → open   (201)
 *   development, PUBLIC_REGISTRATION=false → closed (403 REGISTRATION_CLOSED)
 *   production, nothing set             → closed (403)
 *   production, PUBLIC_REGISTRATION=true  → open   (201)
 *
 * GET /api/v1/config/public, unauthenticated, reports the same answer. Every
 * organisation this creates is named `LiveTest <uuid>` and deleted afterwards.
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

// What the production app needs to construct itself; the full boot check in
// index.js is not what this test is about, so it runs a bare createApp().
const PRODUCTION = {
  NODE_ENV: "production",
  CORS_ALLOWED_ORIGINS: "https://app.octapm-live.test",
  REQUEST_LOG_FORMAT: "off",
  // The API is reached through the load balancer alone: no CloudFront secret
  // (the local backend/.env carries one, which the child would inherit).
  CLOUDFRONT_SHARED_SECRET: "",
};

liveDescribe("self-service registration switch", () => {
  const createdOrgIds = [];

  afterAll(async () => {
    for (const orgId of createdOrgIds) await dropLiveOrg(prisma, orgId);
    await prisma.$disconnect();
  });

  const tryRegister = async (api) => {
    const tag = crypto.randomUUID();
    const orgsBefore = await prisma.organisation.count();
    const response = await api.post("/api/v1/auth/register", {
      orgName: `LiveTest ${tag}`,
      name: "Live Registrant",
      email: `live-register-${tag}@octapm-live.test`,
      password: "Live-Register-Pass1!",
    });
    if (response.status === 201) createdOrgIds.push(response.body.data.organisation.id);
    const created = await prisma.organisation.count({ where: { name: `LiveTest ${tag}` } });
    return { response, created, orgsBefore };
  };

  const scenario = async (env, options, expected) => {
    const api = await startApi(env, options);
    try {
      const config = await api.get("/api/v1/config/public");
      expect(config.status).toBe(200);
      expect(config.body).toEqual({ success: true, data: { registration: expected } });

      const { response, created } = await tryRegister(api);
      if (expected === "open") {
        expect(response.status).toBe(201);
        expect(created).toBe(1);
      } else {
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ success: false, error: { code: "REGISTRATION_CLOSED" } });
        expect(created).toBe(0);
      }
    } finally {
      await api.stop();
    }
  };

  it("is open in development with nothing set", async () => {
    await scenario({}, {}, "open");
  });

  it("is closed in development when PUBLIC_REGISTRATION=false", async () => {
    await scenario({ PUBLIC_REGISTRATION: "false" }, {}, "closed");
  });

  it("is closed in production with nothing set", async () => {
    await scenario(PRODUCTION, { appOnly: true }, "closed");
  });

  it("is open in production when PUBLIC_REGISTRATION=true", async () => {
    await scenario({ ...PRODUCTION, PUBLIC_REGISTRATION: "true" }, { appOnly: true }, "open");
  });
});
