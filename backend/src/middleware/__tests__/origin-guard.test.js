/**
 * Cross-site request protection on the cookie-bearing auth routes: a
 * browser request from a page that is not an OctaPM application is refused
 * before any handler runs; native clients and safe methods pass.
 */
const ORIGINAL = { ...process.env };

const run = (method, origin) => {
  jest.resetModules();
  const { requireApprovedOrigin } = require("../origin-guard");
  const req = { method, headers: origin === undefined ? {} : { origin } };
  let passed = null;
  requireApprovedOrigin(req, {}, (error) => {
    passed = error || true;
  });
  return passed;
};

describe("requireApprovedOrigin", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL, NODE_ENV: "test", CORS_ALLOWED_ORIGINS: "https://app.octapm.com", FRONTEND_URL: "", PORTAL_URL: "https://portal.octapm.com", ADMIN_URL: "https://admin.octapm.com" };
  });
  afterAll(() => {
    process.env = ORIGINAL;
  });

  it.each(["https://app.octapm.com", "https://portal.octapm.com", "https://admin.octapm.com"])("lets %s sign in, refresh and sign out", (origin) => {
    expect(run("POST", origin)).toBe(true);
  });

  it.each(["https://evil.example.com", "https://market.octapm.com", "https://octapm.com.evil.example", "null"])("refuses a POST from %s", (origin) => {
    const result = run("POST", origin);
    expect(result).toMatchObject({ status: 403, code: "ORIGIN_NOT_ALLOWED" });
  });

  it("lets a request with no Origin through (the mobile app, a server)", () => {
    expect(run("POST", undefined)).toBe(true);
  });

  it("does not stand in the way of GET (the SSO callback is a cross-site GET by design)", () => {
    expect(run("GET", "https://login.microsoftonline.com")).toBe(true);
  });
});
