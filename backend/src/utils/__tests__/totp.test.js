const { base32Encode, base32Decode, generateSecret, hotp, totp, verifyTotp, otpauthUrl } = require("../totp");

// RFC 6238 appendix B vectors (SHA-1, secret "12345678901234567890"), 8 digits → the last 6 for the 6-digit form.
const SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("totp", () => {
  it("round-trips base32 and generates 32-character secrets", () => {
    expect(SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(SECRET).toString("ascii")).toBe("12345678901234567890");
    expect(base32Decode("gezd gnbv-gy3tqojq").toString("ascii")).toBe("1234567890");
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("matches the RFC 6238 test vectors", () => {
    expect(hotp(SECRET, 1, 8)).toBe("94287082");
    expect(totp(SECRET, { time: 59 * 1000 })).toBe("287082");
    expect(totp(SECRET, { time: 1111111109 * 1000 })).toBe("081804");
    expect(totp(SECRET, { time: 1234567890 * 1000 })).toBe("005924");
    expect(totp(SECRET, { time: 20000000000 * 1000 })).toBe("353130");
  });

  it("verifies within one step of drift, returns the step the code belongs to, and rejects malformed codes", () => {
    const time = 1111111109 * 1000;
    const step = Math.floor(1111111109 / 30);
    expect(verifyTotp(SECRET, "081804", { time })).toBe(step);
    expect(verifyTotp(SECRET, "081 804", { time })).toBe(step);
    // Thirty seconds later the same code still matches — as the step it was made for.
    expect(verifyTotp(SECRET, "081804", { time: time + 30 * 1000 })).toBe(step);
    expect(verifyTotp(SECRET, hotp(SECRET, step + 1), { time })).toBe(step + 1);
    expect(verifyTotp(SECRET, "081804", { time: time + 90 * 1000 })).toBeNull();
    expect(verifyTotp(SECRET, "000000", { time })).toBeNull();
    expect(verifyTotp(SECRET, "81804", { time })).toBeNull();
    expect(verifyTotp(SECRET, "", { time })).toBeNull();
    // Step 0 is a real step, not a miss — callers compare with null.
    expect(verifyTotp(SECRET, hotp(SECRET, 0), { time: 0, window: 0 })).toBe(0);
  });

  it("builds the otpauth URL authenticator apps scan", () => {
    expect(otpauthUrl({ issuer: "OctaPM", account: "pat@example.com", secret: SECRET })).toBe(`otpauth://totp/OctaPM:pat%40example.com?secret=${SECRET}&issuer=OctaPM&algorithm=SHA1&digits=6&period=30`);
  });
});
