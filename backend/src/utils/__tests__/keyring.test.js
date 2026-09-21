const { keyring } = require("../keyring");
const secretBox = require("../secret-box");

describe("keyring", () => {
  const spec = { primary: "MFA_SECRET_KEY", previous: "MFA_SECRET_KEY_PREVIOUS", legacy: ["INTEGRATION_SECRET_KEY", "JWT_SECRET"] };

  it("seals with the primary and opens with primary, previous, then legacy", () => {
    const env = { NODE_ENV: "development", MFA_SECRET_KEY: "k2", MFA_SECRET_KEY_PREVIOUS: "k1", INTEGRATION_SECRET_KEY: "int", JWT_SECRET: "jwt" };
    expect(keyring({ ...spec, env })).toEqual({ write: "k2", read: ["k2", "k1", "int", "jwt"] });
  });

  it("falls back to the legacy chain outside production, exactly as the key used to be derived", () => {
    expect(keyring({ ...spec, env: { NODE_ENV: "development", JWT_SECRET: "jwt" } })).toEqual({ write: "jwt", read: ["jwt"] });
    expect(keyring({ ...spec, env: { NODE_ENV: "test", INTEGRATION_SECRET_KEY: "int", JWT_SECRET: "jwt" } }).write).toBe("int");
  });

  it("never derives a key from a legacy secret in production", () => {
    const env = { NODE_ENV: "production", MFA_SECRET_KEY_PREVIOUS: "k1", INTEGRATION_SECRET_KEY: "int", JWT_SECRET: "jwt" };
    expect(keyring({ ...spec, env })).toEqual({ write: null, read: ["k1"] });
  });

  it("drops blanks and duplicates", () => {
    const env = { NODE_ENV: "development", MFA_SECRET_KEY: "same", MFA_SECRET_KEY_PREVIOUS: "same", INTEGRATION_SECRET_KEY: "  ", JWT_SECRET: "jwt" };
    expect(keyring({ ...spec, env }).read).toEqual(["same", "jwt"]);
  });
});

describe("secret-box through a key rotation", () => {
  it("opens a box sealed under the old key while it is PREVIOUS, and seals new boxes with the new one", () => {
    const sealed = secretBox.encrypt({ accessToken: "at" }, { INTEGRATION_SECRET_KEY: "old-key" });
    const rotated = { INTEGRATION_SECRET_KEY: "new-key", INTEGRATION_SECRET_KEY_PREVIOUS: "old-key" };
    expect(secretBox.decrypt(sealed, rotated)).toEqual({ accessToken: "at" });

    const resealed = secretBox.encrypt({ accessToken: "at" }, rotated);
    expect(secretBox.decrypt(resealed, { INTEGRATION_SECRET_KEY: "new-key" })).toEqual({ accessToken: "at" });
  });

  it("refuses a box no configured key opens, with a clear error rather than a crypto failure", () => {
    const sealed = secretBox.encrypt({ accessToken: "at" }, { INTEGRATION_SECRET_KEY: "old-key" });
    expect(() => secretBox.decrypt(sealed, { INTEGRATION_SECRET_KEY: "new-key" })).toThrow(
      expect.objectContaining({ code: "INTEGRATION_SECRET_CORRUPT" }),
    );
  });

  it("has no fallback to JWT_SECRET in any environment", () => {
    expect(secretBox.isConfigured({ NODE_ENV: "development", JWT_SECRET: "jwt" })).toBe(false);
  });
});
