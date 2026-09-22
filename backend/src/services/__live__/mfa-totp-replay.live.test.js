/**
 * A TOTP code is good once — on one API task or across several.
 *
 * RFC 6238 §5.2: once a code has been accepted, the verifier must not accept
 * it again. The drift window keeps each code valid for about ninety seconds,
 * so without a record of the newest accepted step anyone who saw a code (over
 * a shoulder, on a shared screen, in a proxy log) could sign in with it again,
 * and with nothing shared between tasks, on any task. Two API processes on the
 * one database stand in for two ECS tasks behind the load balancer.
 *
 * Codes are made for explicit steps (`hotp(secret, step)`) so the test decides
 * which step each one belongs to instead of racing the clock.
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { hotp } = require("../../utils/totp");
const { createLiveOrg, dropLiveOrg, liveDescribe, sleep } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const MFA_KEY = `mfa-replay-${crypto.randomBytes(24).toString("hex")}`;
const STEP_MS = 30_000;
const currentStep = () => Math.floor(Date.now() / STEP_MS);

/** Waits for the start of a step when the current one has less than `needMs` left. */
const roomInStep = async (needMs) => {
  const left = STEP_MS - (Date.now() % STEP_MS);
  if (left < needMs) await sleep(left + 250);
};

liveDescribe("TOTP replay across API tasks", () => {
  let live;
  let apiA;
  let apiB;
  let secret;
  let baseStep;
  const testIp = `198.51.100.${crypto.randomInt(1, 255)}`;
  const headers = { "x-forwarded-for": testIp };
  const auth = () => ({ authorization: `Bearer ${live.token}`, ...headers });

  // Refusals are the point of this test, and five in a row lock the account.
  // The lockout has its own live test (auth-throttle); its count is cleared
  // before every sign-in so a refusal here is always the code check's.
  const forgiveFailures = () =>
    prisma.authThrottle.deleteMany({ where: { OR: [{ scope: "email", key: live.user.email.toLowerCase() }, { scope: "ip", key: testIp }] } });

  const challenge = async (api) => {
    await forgiveFailures();
    const first = await api.post("/api/v1/auth/login", { email: live.user.email, password: live.password }, headers);
    expect(first.status).toBe(200);
    expect(first.body.data.mfaRequired).toBe(true);
    return first.body.data.mfaToken;
  };
  const verify = (api, mfaToken, code) => api.post("/api/v1/auth/mfa/verify", { mfaToken, code }, headers);
  const signIn = async (api, code) => verify(api, await challenge(api), code);
  const refusal = (response) => ({ status: response.status, code: response.body?.error?.code, message: response.body?.error?.message });
  const stored = () => prisma.user.findUnique({ where: { id: live.user.id }, select: { mfaEnabled: true, mfaLastTotpStep: true } });

  /** Six digits that are no code of this secret anywhere near now. */
  const wrongCode = (step) => {
    const near = new Set([-2, -1, 0, 1, 2].map((drift) => hotp(secret, step + drift)));
    for (let value = 0; ; value += 1) {
      const code = String(value).padStart(6, "0");
      if (!near.has(code)) return code;
    }
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    const env = { MFA_SECRET_KEY: MFA_KEY, AUTH_THROTTLE_STORE: "postgres", TRUST_PROXY_HOPS: "1" };
    [apiA, apiB] = await Promise.all([startApi(env), startApi(env)]);
  });

  afterAll(async () => {
    await Promise.all([apiA?.stop(), apiB?.stop()]);
    if (live) {
      await forgiveFailures();
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("a code is good once: sent to two tasks at once it gets in once, replayed it is refused like a wrong code on either task and for any use, and the next code works", async () => {
    // Everything below must happen inside one step's drift window.
    await roomInStep(20_000);
    baseStep = currentStep();
    const step = baseStep;

    const setup = await apiA.post("/api/v1/auth/mfa/setup", undefined, auth());
    expect(setup.status).toBe(200);
    secret = setup.body.data.secret;
    // Enrol with the previous step's code: still inside the window, and it counts as used.
    const enabled = await apiA.post("/api/v1/auth/mfa/enable", { code: hotp(secret, step - 1) }, auth());
    expect(enabled.status).toBe(200);

    // The same code, at the same moment, on two tasks: exactly one gets in.
    const code = hotp(secret, step);
    const tokenA = await challenge(apiA);
    const tokenB = await challenge(apiB);
    const race = await Promise.all([verify(apiA, tokenA, code), verify(apiB, tokenB, code)]);
    expect(race.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(race.find((response) => response.status === 200).body.data.tokens.accessToken).toMatch(/^eyJ/);

    // Replayed afterwards, on either task, it is refused exactly as a wrong code is.
    const wrong = refusal(await signIn(apiA, wrongCode(step)));
    expect(wrong).toEqual({ status: 401, code: "MFA_CODE_INVALID", message: "That code is not valid" });
    expect(refusal(race.find((response) => response.status === 401))).toEqual(wrong);
    expect(refusal(await signIn(apiA, code))).toEqual(wrong);
    expect(refusal(await signIn(apiB, code))).toEqual(wrong);

    // Nor can the spent code regenerate backup codes or turn two-factor off.
    const regenerate = await apiA.post("/api/v1/auth/mfa/backup-codes", { code }, auth());
    expect(refusal(regenerate)).toEqual({ status: 400, code: "MFA_CODE_INVALID", message: "Enter a current code from your authenticator app" });
    const disable = await apiB.post("/api/v1/auth/mfa/disable", { password: live.password, code }, auth());
    expect(refusal(disable)).toEqual({ status: 400, code: "MFA_CODE_INVALID", message: "That code is not valid" });
    expect((await stored()).mfaEnabled).toBe(true);

    // The enrolment code is inside the window too, and already used.
    expect(refusal(await signIn(apiB, hotp(secret, step - 1)))).toEqual(wrong);

    // A code for a later step is new: replays are refused, not the person.
    const next = await signIn(apiB, hotp(secret, step + 1));
    expect(next.status).toBe(200);
    expect(await stored()).toEqual({ mfaEnabled: true, mfaLastTotpStep: step + 1 });
  });

  it("once every step in the window is used, the next step's code regenerates backup codes — once", async () => {
    expect(secret).toBeDefined();
    // Steps baseStep - 1 … baseStep + 1 are spent; baseStep + 2 is inside the
    // window from the moment the clock reaches baseStep + 1.
    while (currentStep() <= baseStep) await sleep(500);
    const fresh = hotp(secret, baseStep + 2);
    const regenerated = await apiB.post("/api/v1/auth/mfa/backup-codes", { code: fresh }, auth());
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.data.backupCodes).toHaveLength(10);
    const again = await apiA.post("/api/v1/auth/mfa/backup-codes", { code: fresh }, auth());
    expect(refusal(again)).toEqual({ status: 400, code: "MFA_CODE_INVALID", message: "Enter a current code from your authenticator app" });
    expect((await stored()).mfaLastTotpStep).toBe(baseStep + 2);
  }, 90_000);
});
