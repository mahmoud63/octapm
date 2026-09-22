/**
 * Login lockout shared by two API processes.
 *
 * Behind a load balancer consecutive attempts land on different tasks. With
 * the counts kept in each process's memory, an attacker spread over N tasks
 * gets N times the tries and a lock on one task is invisible on the others.
 * With AUTH_THROTTLE_STORE=postgres both processes read and write one count.
 *
 * Every request carries its own X-Forwarded-For address (the processes trust
 * one proxy hop), so the per-address row belongs to this test alone and is
 * deleted with the per-email row afterwards.
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe, sleep } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

liveDescribe("login lockout across API tasks", () => {
  let live;
  let apiA;
  let apiB;
  const testIp = `198.51.100.${crypto.randomInt(1, 255)}`;

  const login = (api, password) =>
    api.post("/api/v1/auth/login", { email: live.user.email, password }, { "x-forwarded-for": testIp });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    const env = { AUTH_THROTTLE_STORE: "postgres", TRUST_PROXY_HOPS: "1" };
    [apiA, apiB] = await Promise.all([startApi(env), startApi(env)]);
  });

  afterAll(async () => {
    await Promise.all([apiA?.stop(), apiB?.stop()]);
    if (live) {
      await prisma.authThrottle.deleteMany({
        where: { OR: [{ scope: "email", key: live.user.email.toLowerCase() }, { scope: "ip", key: testIp }] },
      });
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("counts failures on one task against sign-ins on the other, up to the lock", async () => {
    // Three failures on A put the email into its first 5-second backoff.
    for (let i = 0; i < 3; i += 1) {
      const response = await login(apiA, "not-the-password");
      expect(response.status).toBe(401);
    }

    // B sees A's backoff at once.
    const blockedOnB = await login(apiB, "not-the-password");
    expect(blockedOnB.status).toBe(429);
    expect(blockedOnB.body.error.code).toBe("LOGIN_BACKOFF");

    // After the backoff the fourth failure (on B) doubles it to ten seconds…
    await sleep(5_300);
    const fourth = await login(apiB, "not-the-password");
    expect(fourth.status).toBe(401);

    // …and the fifth (on B again, once that has run) locks the account.
    await sleep(10_300);
    const fifth = await login(apiB, "not-the-password");
    expect(fifth.status).toBe(401);

    // The right password on either task is now refused.
    const correctOnB = await login(apiB, live.password);
    expect(correctOnB.status).toBe(429);
    expect(correctOnB.body.error.code).toBe("LOGIN_TEMPORARILY_LOCKED");
    const correctOnA = await login(apiA, live.password);
    expect(correctOnA.status).toBe(429);

    const row = await prisma.authThrottle.findUnique({
      where: { scope_key: { scope: "email", key: live.user.email.toLowerCase() } },
    });
    expect(row.failures).toBe(5);
    expect(row.lockedUntil.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  }, 60_000);
});
