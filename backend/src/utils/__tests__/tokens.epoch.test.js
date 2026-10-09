/**
 * The credential epoch (owner decision D-ID-1 Q6): every token an identity
 * holds carries it as `cep`, and a token minted before the stored epoch moved
 * (a completed reset, an identity closed, an admin second-factor reset, a
 * closed account reopened) is refused wherever it is presented. A token with
 * no claim counts as epoch 0, so tokens minted before the epoch existed keep
 * working until the first such event.
 */
const jwt = require("jsonwebtoken");
const {
  createAccessToken,
  createIdentityToken,
  createRefreshToken,
  epochClaim,
  tokenEpoch,
  tokenEpochCurrent,
} = require("../tokens");

describe("credential epoch", () => {
  const saved = {};
  beforeAll(() => {
    for (const name of ["JWT_SECRET", "JWT_REFRESH_SECRET"]) saved[name] = process.env[name];
    process.env.JWT_SECRET = "tokens-epoch-test-access-secret";
    process.env.JWT_REFRESH_SECRET = "tokens-epoch-test-refresh-secret";
  });
  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  describe("epochClaim", () => {
    it("carries the identity's integer epoch", () => {
      expect(epochClaim({ credentialEpoch: 3 })).toEqual({ cep: 3 });
      expect(epochClaim({ credentialEpoch: 0 })).toEqual({ cep: 0 });
    });

    it.each([undefined, null, "2", 1.5, Number.NaN])("counts a missing or non-integer epoch (%p) as 0", (credentialEpoch) => {
      expect(epochClaim({ credentialEpoch })).toEqual({ cep: 0 });
    });

    it("counts no user at all as 0", () => {
      expect(epochClaim(undefined)).toEqual({ cep: 0 });
    });
  });

  describe("tokenEpoch / tokenEpochCurrent", () => {
    it("reads the claim, and counts a token without one as epoch 0", () => {
      expect(tokenEpoch({ cep: 4 })).toBe(4);
      expect(tokenEpoch({})).toBe(0);
      expect(tokenEpoch({ cep: "4" })).toBe(0);
      expect(tokenEpoch(null)).toBe(0);
    });

    it("is current only when the token's epoch equals the stored one", () => {
      expect(tokenEpochCurrent({ cep: 2 }, { credentialEpoch: 2 })).toBe(true);
      expect(tokenEpochCurrent({ cep: 1 }, { credentialEpoch: 2 })).toBe(false);
      // A token from the future (a stored epoch rolled back) is not current either.
      expect(tokenEpochCurrent({ cep: 3 }, { credentialEpoch: 2 })).toBe(false);
    });

    it("keeps tokens minted before the epoch existed working until the first credential event", () => {
      expect(tokenEpochCurrent({}, { credentialEpoch: 0 })).toBe(true);
      expect(tokenEpochCurrent({}, {})).toBe(true);
      expect(tokenEpochCurrent({}, { credentialEpoch: 1 })).toBe(false);
    });
  });

  describe("every token an identity holds carries `cep`", () => {
    const principal = { id: "user-1", orgId: "org-1", role: "pm", email: "pm@example.test", name: "Pat", credentialEpoch: 5 };

    it("the access token", () => {
      expect(jwt.decode(createAccessToken(principal))).toMatchObject({ sub: "user-1", type: "access", cep: 5 });
    });

    it("the refresh token", () => {
      expect(jwt.decode(createRefreshToken(principal, "session-1"))).toMatchObject({ sub: "user-1", type: "refresh", cep: 5 });
    });

    it("the identity token", () => {
      expect(jwt.decode(createIdentityToken(principal))).toMatchObject({ sub: "user-1", type: "identity", cep: 5 });
    });

    it("epoch 0 for a principal minted from a row without the column", () => {
      const legacy = { ...principal };
      delete legacy.credentialEpoch;
      expect(jwt.decode(createAccessToken(legacy)).cep).toBe(0);
    });
  });
});
