/**
 * A backup code is spent once, even by two sign-ins at the same moment.
 *
 * The ten codes live in one JSON column on the user. Spending one used to be a
 * read-modify-write — read the list, mark the code, write the whole list back —
 * so two sign-ins that both read before either wrote could both get in on one
 * code, and a sign-in spending a different code at the same time could write
 * back its older copy of the list and quietly un-spend the first. The write is
 * now a compare-and-set on the list as read, retried once on a lost race.
 *
 * The first test replays that interleaving exactly, through the real service
 * against the real database: a sign-in reads the user (resolveChallenge's
 * findUnique) and then spends a code, so two reads taken before either spend
 * are two concurrent sign-ins that both read before either wrote. The second
 * sends real concurrent requests to two API processes.
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { totp } = require("../../utils/totp");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const MFA_KEY = `mfa-backup-${crypto.randomBytes(24).toString("hex")}`;

liveDescribe("backup codes under concurrent sign-ins", () => {
  let live;
  let apiA;
  let apiB;
  let mfaService;
  let backupCodes;
  const testIp = `198.51.100.${crypto.randomInt(1, 255)}`;
  const headers = { "x-forwarded-for": testIp };

  // A lost race is a refused code, and refusals feed the sign-in lockout
  // (which has its own live test); clear its count before every sign-in.
  const forgiveFailures = () =>
    prisma.authThrottle.deleteMany({ where: { OR: [{ scope: "email", key: live.user.email.toLowerCase() }, { scope: "ip", key: testIp }] } });

  const readUser = () => prisma.user.findUnique({ where: { id: live.user.id } });
  const spentHashes = async () => (await readUser()).mfaBackupCodesJson.filter((row) => row.usedAt).map((row) => row.hash);
  const challenge = async (api) => {
    await forgiveFailures();
    const first = await api.post("/api/v1/auth/login", { email: live.user.email, password: live.password }, headers);
    expect(first.status).toBe(200);
    expect(first.body.data.mfaRequired).toBe(true);
    return first.body.data.mfaToken;
  };
  const verify = (api, mfaToken, code) => api.post("/api/v1/auth/mfa/verify", { mfaToken, code }, headers);

  beforeAll(async () => {
    // The service in this process and the two API processes share one seed key.
    process.env.MFA_SECRET_KEY = MFA_KEY;
    mfaService = require("../mfa.service");
    live = await createLiveOrg(prisma);
    const env = { MFA_SECRET_KEY: MFA_KEY, AUTH_THROTTLE_STORE: "postgres", TRUST_PROXY_HOPS: "1" };
    [apiA, apiB] = await Promise.all([startApi(env), startApi(env)]);
    const { secret } = await mfaService.beginEnrollment({ userId: live.user.id });
    ({ backupCodes } = await mfaService.enable({ userId: live.user.id, code: totp(secret) }));
    expect(backupCodes).toHaveLength(10);
  });

  afterAll(async () => {
    await Promise.all([apiA?.stop(), apiB?.stop()]);
    if (live) {
      await forgiveFailures();
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("two sign-ins that read the user before either writes: one code gets in once, and two different codes both stay spent", async () => {
    const [first, second, third] = backupCodes;
    // Each sign-in has its own copy of the user, and both copies were read
    // before either sign-in wrote anything.
    const twoReads = () => Promise.all([readUser(), readUser()]);

    const [readA, readB] = await twoReads();
    expect(await mfaService.verifyCode({ user: readA, code: first })).toBe(true);
    expect(await mfaService.verifyCode({ user: readB, code: first })).toBe(false);
    expect(await spentHashes()).toEqual([mfaService.hashCode(first)]);

    // Two different codes: the second loses the compare-and-set, reads again,
    // finds its own code unspent and gets in — without writing back its older
    // list, in which the other code was still unspent.
    const [readC, readD] = await twoReads();
    expect(await mfaService.verifyCode({ user: readC, code: second })).toBe(true);
    expect(await mfaService.verifyCode({ user: readD, code: third })).toBe(true);
    expect((await spentHashes()).sort()).toEqual([first, second, third].map(mfaService.hashCode).sort());
    for (const code of [first, second, third]) {
      expect(await mfaService.verifyCode({ user: await readUser(), code })).toBe(false);
    }
    expect((await mfaService.status({ userId: live.user.id })).backupCodesRemaining).toBe(7);
  });

  it("over HTTP, the same code sent to two tasks at once gets in once; two different codes at once both get in and both stay spent", async () => {
    // Three rounds: a round that happens not to interleave would prove nothing on its own.
    for (const code of backupCodes.slice(3, 6)) {
      const tokenA = await challenge(apiA);
      const tokenB = await challenge(apiB);
      const race = await Promise.all([verify(apiA, tokenA, code), verify(apiB, tokenB, code)]);
      expect(race.map((response) => response.status).sort()).toEqual([200, 401]);
      expect(race.find((response) => response.status === 401).body.error.code).toBe("MFA_CODE_INVALID");
    }
    expect((await spentHashes()).length).toBe(6);

    const [left, right] = backupCodes.slice(6, 8);
    const tokenA = await challenge(apiA);
    const tokenB = await challenge(apiB);
    const pair = await Promise.all([verify(apiA, tokenA, left), verify(apiB, tokenB, right)]);
    expect(pair.map((response) => response.status)).toEqual([200, 200]);
    expect((await spentHashes()).sort()).toEqual(backupCodes.slice(0, 8).map(mfaService.hashCode).sort());
    expect((await mfaService.status({ userId: live.user.id })).backupCodesRemaining).toBe(2);
  });
});
