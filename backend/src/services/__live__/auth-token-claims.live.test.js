/**
 * One-time tokens presented twice at the same moment, to two API processes.
 *
 * A refresh token, an SSO ticket and a password-reset link are each good for
 * exactly one use. Each used to be checked by a read and consumed by a later
 * update-by-id, so two requests that both passed the read both won — a retry
 * that lands on a second task forked the refresh-session family, one SSO
 * ticket made two sessions, one reset link set two passwords. Each is now
 * consumed by a conditional write that only one request can win.
 *
 * Twenty rounds each, because a race that only loses sometimes is exactly
 * the bug; every round must produce exactly one winner.
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const ROUNDS = 20;
const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const statuses = (responses) => responses.map((response) => response.status).sort();

liveDescribe("one-time tokens across API tasks", () => {
  let live;
  let apiA;
  let apiB;

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    [apiA, apiB] = await Promise.all([startApi(), startApi()]);
  });

  afterAll(async () => {
    await Promise.all([apiA?.stop(), apiB?.stop()]);
    if (live) await dropLiveOrg(prisma, live.org.id);
    await prisma.$disconnect();
  });

  it("rotates a refresh token for exactly one of two simultaneous refreshes", async () => {
    const { createAuthSessionPayload } = require("../auth.service");
    const outcomes = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const session = await createAuthSessionPayload(prisma, live.user, { client: "mobile" });
      const refresh = (api) =>
        api.post("/api/v1/auth/refresh", { refreshToken: session.refreshToken }, { "x-octapm-client": "mobile" });
      const responses = await Promise.all([refresh(apiA), refresh(apiB)]);
      outcomes.push({
        statuses: statuses(responses),
        loserCode: responses.find((response) => response.status !== 200)?.body?.error?.code || null,
      });
    }
    expect(outcomes.filter((outcome) => outcome.statuses.join() !== "200,401")).toEqual([]);
    expect(new Set(outcomes.map((outcome) => outcome.loserCode))).toEqual(new Set(["REFRESH_TOKEN_REUSED"]));
  }, 120_000);

  it("exchanges an SSO ticket for exactly one session", async () => {
    const outcomes = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const ticket = crypto.randomBytes(32).toString("base64url");
      await prisma.ssoTicket.create({
        data: {
          orgId: live.org.id,
          userId: live.user.id,
          tokenHash: sha256(ticket),
          expiresAt: new Date(Date.now() + 2 * 60_000),
        },
      });
      const complete = (api) => api.post("/api/v1/auth/sso/complete", { ticket });
      outcomes.push(statuses(await Promise.all([complete(apiA), complete(apiB)])).join());
    }
    expect(outcomes.filter((outcome) => outcome !== "200,401")).toEqual([]);
  }, 120_000);

  it("lets one password-reset link set exactly one password", async () => {
    // A user of its own: every completed reset revokes the user's sessions.
    const user = await prisma.user.create({
      data: {
        orgId: live.org.id,
        name: "Live Reset User",
        email: `live-reset-${crypto.randomUUID()}@octapm-live.test`,
        passwordHash: await bcrypt.hash(crypto.randomBytes(12).toString("hex"), 4),
        role: "site_engineer",
      },
    });
    const outcomes = [];
    for (let round = 0; round < 10; round += 1) {
      const token = crypto.randomBytes(32).toString("base64url");
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          orgId: live.org.id,
          email: user.email,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
      const reset = (api, password) => api.post("/api/v1/auth/reset-password", { token, password });
      const responses = await Promise.all([reset(apiA, `Round${round}-A-pass!`), reset(apiB, `Round${round}-B-pass!`)]);
      outcomes.push(statuses(responses).join());
    }
    expect(outcomes.filter((outcome) => outcome !== "200,400")).toEqual([]);
  }, 120_000);
});
