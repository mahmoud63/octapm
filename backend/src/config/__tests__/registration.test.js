/**
 * Whether self-service sign-up (POST /auth/register) is open. Owner decision
 * D-ID-1 Q8: closed in production whatever PUBLIC_REGISTRATION says, until
 * sign-up verifies the mailbox (D-REG-1); outside production open only where
 * NODE_ENV says development or test (lead L103), unless PUBLIC_REGISTRATION
 * decides otherwise.
 */
const {
  getPublicConfig,
  isPublicRegistrationOpen,
  registrationMisconfigured,
} = require("../registration");

describe("isPublicRegistrationOpen", () => {
  it.each([undefined, "", "true", "1", "TRUE", " true ", "false", "0", "yes"])(
    "is closed in production whatever PUBLIC_REGISTRATION=%j says",
    (setting) => {
      expect(isPublicRegistrationOpen({ NODE_ENV: "production", PUBLIC_REGISTRATION: setting })).toBe(false);
    },
  );

  it.each(["development", "test", " Development ", "TEST"])("is open by default where NODE_ENV=%j", (nodeEnv) => {
    expect(isPublicRegistrationOpen({ NODE_ENV: nodeEnv })).toBe(true);
  });

  it.each(["staging", "prod", "qa", "", undefined])(
    "is closed by default where NODE_ENV=%j (anything but development or test)",
    (nodeEnv) => {
      expect(isPublicRegistrationOpen({ NODE_ENV: nodeEnv })).toBe(false);
    },
  );

  it("PUBLIC_REGISTRATION=false closes it anywhere", () => {
    for (const nodeEnv of ["development", "test", "staging", undefined]) {
      expect(isPublicRegistrationOpen({ NODE_ENV: nodeEnv, PUBLIC_REGISTRATION: "false" })).toBe(false);
      expect(isPublicRegistrationOpen({ NODE_ENV: nodeEnv, PUBLIC_REGISTRATION: "0" })).toBe(false);
    }
  });

  it("PUBLIC_REGISTRATION=true keeps it open in development and test", () => {
    for (const nodeEnv of ["development", "test", " Development ", "TEST"]) {
      expect(isPublicRegistrationOpen({ NODE_ENV: nodeEnv, PUBLIC_REGISTRATION: "true" })).toBe(true);
      expect(isPublicRegistrationOpen({ NODE_ENV: nodeEnv, PUBLIC_REGISTRATION: "1" })).toBe(true);
      expect(isPublicRegistrationOpen({ NODE_ENV: nodeEnv, PUBLIC_REGISTRATION: " TRUE " })).toBe(true);
    }
  });

  // Codex D-ID-1 diff review #12: an unknown NODE_ENV (staging, a typo, unset on a
  // deployed host) or production is closed whatever PUBLIC_REGISTRATION says.
  it.each(["staging", "prod", "qa", "develop", "", undefined, "production", " Production "])(
    "PUBLIC_REGISTRATION=true cannot open it where NODE_ENV=%j",
    (nodeEnv) => {
      for (const setting of ["true", "1", "TRUE", " true "]) {
        expect(isPublicRegistrationOpen({ NODE_ENV: nodeEnv, PUBLIC_REGISTRATION: setting })).toBe(false);
      }
    },
  );

  it("an unrecognised PUBLIC_REGISTRATION value falls back to the environment's default", () => {
    expect(isPublicRegistrationOpen({ NODE_ENV: "development", PUBLIC_REGISTRATION: "maybe" })).toBe(true);
    expect(isPublicRegistrationOpen({ NODE_ENV: "staging", PUBLIC_REGISTRATION: "maybe" })).toBe(false);
  });
});

describe("registrationMisconfigured", () => {
  it.each(["true", "1", " TRUE "])("names the problem when production asks for PUBLIC_REGISTRATION=%j", (setting) => {
    expect(registrationMisconfigured({ NODE_ENV: "production", PUBLIC_REGISTRATION: setting })).toMatch(
      /PUBLIC_REGISTRATION=true is refused in production/,
    );
  });

  it.each([undefined, "", "false", "0"])("has nothing to say in production with PUBLIC_REGISTRATION=%j", (setting) => {
    expect(registrationMisconfigured({ NODE_ENV: "production", PUBLIC_REGISTRATION: setting })).toBeNull();
  });

  it("has nothing to say outside production, whatever is set", () => {
    for (const nodeEnv of ["development", "test", "staging", undefined]) {
      expect(registrationMisconfigured({ NODE_ENV: nodeEnv, PUBLIC_REGISTRATION: "true" })).toBeNull();
    }
  });
});

describe("getPublicConfig", () => {
  it("tells the web app only whether sign-up is open", () => {
    expect(getPublicConfig({ NODE_ENV: "production", PUBLIC_REGISTRATION: "true" })).toEqual({ registration: "closed" });
    expect(getPublicConfig({ NODE_ENV: "development" })).toEqual({ registration: "open" });
    expect(getPublicConfig({ NODE_ENV: "staging" })).toEqual({ registration: "closed" });
    expect(getPublicConfig({ NODE_ENV: "staging", PUBLIC_REGISTRATION: "true" })).toEqual({ registration: "closed" });
    expect(getPublicConfig({ PUBLIC_REGISTRATION: "true" })).toEqual({ registration: "closed" });
  });
});
