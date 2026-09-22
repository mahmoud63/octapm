/**
 * Two-factor sign-in through key rotations, over real HTTP.
 *
 * Every step is a fresh API process with a different key environment, the way
 * a redeploy with new secrets would be. What must hold:
 *   - rotating JWT_SECRET does not touch MFA (the seed key is its own);
 *   - moving MFA_SECRET_KEY from K1 to K2 with K1 as MFA_SECRET_KEY_PREVIOUS
 *     keeps sign-in working and re-seals the stored seed under K2;
 *   - once re-sealed, PREVIOUS can be removed;
 *   - under a key that opens nothing, the TOTP check fails cleanly (401, not
 *     a 500) and a backup code still gets the person in.
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { totp } = require("../../utils/totp");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const K1 = `mfa-k1-${crypto.randomBytes(24).toString("hex")}`;
const K2 = `mfa-k2-${crypto.randomBytes(24).toString("hex")}`;
const WRONG = `mfa-wrong-${crypto.randomBytes(24).toString("hex")}`;
const J1 = process.env.JWT_SECRET;
const J2 = `jwt-rotated-${crypto.randomBytes(24).toString("hex")}`;

// Opens a stored seed with one specific key, exactly as the service seals it.
const opensWith = (sealed, key) => {
  const [, iv, tag, payload] = String(sealed).split(".");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", crypto.createHash("sha256").update(key).digest(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
};

liveDescribe("MFA through key rotations", () => {
  let live;
  let api;
  let secret;
  let backupCodes;

  const withApi = async (env, run) => {
    api = await startApi(env);
    try {
      return await run(api);
    } finally {
      await api.stop();
      api = null;
    }
  };

  const signIn = async (target, code) => {
    const first = await target.post("/api/v1/auth/login", { email: live.user.email, password: live.password });
    expect(first.status).toBe(200);
    expect(first.body.data.mfaRequired).toBe(true);
    return target.post("/api/v1/auth/mfa/verify", { mfaToken: first.body.data.mfaToken, code });
  };

  const storedSeed = async () =>
    (await prisma.user.findUnique({ where: { id: live.user.id }, select: { mfaSecretEnc: true } })).mfaSecretEnc;

  // The steps below sign in seconds apart, well inside one code's lifetime,
  // and a code is good once (mfa-totp-replay.live.test.js). This test is about
  // keys, so each step forgets the last accepted code first; that also keeps
  // the wrong-key refusal the key's doing rather than the replay rule's.
  const freshCode = async () => {
    await prisma.user.update({ where: { id: live.user.id }, data: { mfaLastTotpStep: null } });
    return totp(secret);
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
  });

  afterAll(async () => {
    if (api) await api.stop();
    if (live) await dropLiveOrg(prisma, live.org.id);
    await prisma.$disconnect();
  });

  it("enrols under K1", async () => {
    await withApi({ MFA_SECRET_KEY: K1, JWT_SECRET: J1 }, async (target) => {
      const auth = { authorization: `Bearer ${live.token}` };
      const setup = await target.post("/api/v1/auth/mfa/setup", undefined, auth);
      expect(setup.status).toBe(200);
      secret = setup.body.data.secret;
      const enabled = await target.post("/api/v1/auth/mfa/enable", { code: totp(secret) }, auth);
      expect(enabled.status).toBe(200);
      backupCodes = enabled.body.data.backupCodes;
    });
    expect(opensWith(await storedSeed(), K1)).toBe(secret);
  });

  it("survives a JWT_SECRET rotation", async () => {
    await withApi({ MFA_SECRET_KEY: K1, JWT_SECRET: J2 }, async (target) => {
      const verified = await signIn(target, await freshCode());
      expect(verified.status).toBe(200);
    });
  });

  it("moves from K1 to K2 with K1 as PREVIOUS, and re-seals the seed under K2", async () => {
    await withApi({ MFA_SECRET_KEY: K2, MFA_SECRET_KEY_PREVIOUS: K1 }, async (target) => {
      const verified = await signIn(target, await freshCode());
      expect(verified.status).toBe(200);
    });
    const sealed = await storedSeed();
    expect(opensWith(sealed, K2)).toBe(secret);
    expect(opensWith(sealed, K1)).toBeNull();
  });

  it("keeps working once PREVIOUS is removed", async () => {
    await withApi({ MFA_SECRET_KEY: K2 }, async (target) => {
      const verified = await signIn(target, await freshCode());
      expect(verified.status).toBe(200);
    });
  });

  it("under a key that opens nothing, refuses the code cleanly and still accepts a backup code", async () => {
    await withApi({ MFA_SECRET_KEY: WRONG }, async (target) => {
      const refused = await signIn(target, await freshCode());
      expect(refused.status).toBe(401);
      expect(refused.body.error.code).toBe("MFA_CODE_INVALID");
      const viaBackup = await signIn(target, backupCodes[0]);
      expect(viaBackup.status).toBe(200);
    });
  });
});
