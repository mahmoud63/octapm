/**
 * OctaPM's canonical hosts (config/domains.js) and what they feed: link
 * building per audience, return-path safety, and the CORS allowlist.
 */
const domains = require("../domains");
const { getAllowedCorsOrigins, validateProductionEnv } = require("../security");

const PROD = {
  NODE_ENV: "production",
  PUBLIC_SITE_URL: "https://octapm.com",
  WEB_APP_URL: "https://app.octapm.com",
  PORTAL_URL: "https://portal.octapm.com",
  ADMIN_URL: "https://admin.octapm.com",
  MARKET_URL: "https://market.octapm.com",
  CORS_ALLOWED_ORIGINS: "https://app.octapm.com",
};

describe("canonical surface URLs", () => {
  it("names each surface's host", () => {
    expect(domains.surfaceUrl("public", PROD)).toBe("https://octapm.com");
    expect(domains.surfaceUrl("app", PROD)).toBe("https://app.octapm.com");
    expect(domains.surfaceUrl("portal", PROD)).toBe("https://portal.octapm.com");
    expect(domains.surfaceUrl("admin", PROD)).toBe("https://admin.octapm.com");
    expect(domains.surfaceUrl("market", PROD)).toBe("https://market.octapm.com");
  });

  it("falls back to the one application host when the portal and admin have none (local, single host)", () => {
    const local = { WEB_APP_URL: "http://localhost:5300" };
    expect(domains.surfaceUrl("portal", local)).toBe("http://localhost:5300");
    expect(domains.surfaceUrl("admin", local)).toBe("http://localhost:5300");
    expect(domains.surfaceUrl("public", local)).toBe("http://localhost:5300");
    expect(domains.surfaceUrl("market", local)).toBeNull();
    expect(domains.isSplitHosting(local)).toBe(false);
    expect(domains.isSplitHosting(PROD)).toBe(true);
  });

  it("keeps the older FRONTEND_URL / PUBLIC_APP_URL spellings for the app", () => {
    expect(domains.appUrl({ FRONTEND_URL: "https://a.example.com,https://b.example.com" })).toBe("https://a.example.com");
    expect(domains.appUrl({ PUBLIC_APP_URL: "https://c.example.com/" })).toBe("https://c.example.com");
    expect(domains.appUrl({})).toBe("http://localhost:5173");
  });
});

describe("links by audience", () => {
  it("sends a project-party (consultant) invitation to the portal and every other invitation to the app", () => {
    expect(domains.invitationSurface({ projectPartyId: "party-1" })).toBe("portal");
    expect(domains.invitationSurface({ projectPartyId: null })).toBe("app");
    expect(domains.invitationSurface({})).toBe("app");
    expect(domains.buildUrl(domains.invitationSurface({ projectPartyId: "p" }), "/accept-invite", { token: "t1" }, PROD)).toBe(
      "https://portal.octapm.com/accept-invite?token=t1",
    );
    expect(domains.buildUrl(domains.invitationSurface({}), "/accept-invite", { token: "t2" }, PROD)).toBe(
      "https://app.octapm.com/accept-invite?token=t2",
    );
  });

  it("builds only from an application path, never from an absolute or protocol-relative value", () => {
    expect(domains.buildUrl("app", "/o/acme/projects/p1/reviews", { recordId: "r1" }, PROD)).toBe(
      "https://app.octapm.com/o/acme/projects/p1/reviews?recordId=r1",
    );
    expect(() => domains.buildUrl("app", "https://evil.example.com/x", {}, PROD)).toThrow();
    expect(() => domains.buildUrl("app", "//evil.example.com/x", {}, PROD)).toThrow();
    expect(() => domains.buildUrl("app", "/\\evil.example.com", {}, PROD)).toThrow();
    expect(() => domains.buildUrl("market", "/", {}, {})).toThrow(/no configured URL/);
  });

  it("accepts only OctaPM's own surfaces as a return surface", () => {
    expect(domains.parseReturnSurface("portal")).toBe("portal");
    expect(domains.parseReturnSurface("admin")).toBe("admin");
    expect(domains.parseReturnSurface("market")).toBe("app");
    expect(domains.parseReturnSurface("https://evil.example.com")).toBe("app");
    expect(domains.parseReturnSurface(undefined)).toBe("app");
  });
});

describe("return paths (open-redirect protection)", () => {
  it.each([
    ["/o/acme/projects?x=1", "/o/acme/projects?x=1"],
    ["https://evil.example.com", null],
    ["//evil.example.com", null],
    ["/\\evil.example.com", null],
    ["/a\\b", null],
    ["javascript:alert(1)", null],
    ["/ok\r\nSet-Cookie: x", null],
    [null, null],
    [42, null],
  ])("%p → %p", (input, expected) => {
    expect(domains.safeReturnPath(input)).toBe(expected);
  });
});

describe("CORS for the canonical hosts", () => {
  it("allows the app, portal and admin origins exactly — never the market or the public site", () => {
    const origins = getAllowedCorsOrigins(PROD);
    expect(origins).toEqual(expect.arrayContaining(["https://app.octapm.com", "https://portal.octapm.com", "https://admin.octapm.com"]));
    expect(origins).not.toContain("https://market.octapm.com");
    expect(origins).not.toContain("https://octapm.com");
    expect(origins).not.toContain("https://evil.octapm.com");
  });

  it("leaves the development defaults alone when nothing new is configured", () => {
    expect(getAllowedCorsOrigins({ NODE_ENV: "development" })).toContain("http://localhost:5173");
  });

  it("production refuses a wildcard of the parent domain and a non-https surface URL", () => {
    let message = "";
    try {
      validateProductionEnv({ ...PROD, CORS_ALLOWED_ORIGINS: "https://*.octapm.com", PORTAL_URL: "http://portal.octapm.com" });
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/CORS origins must name exact hosts, not a wildcard/);
    expect(message).toMatch(/PORTAL_URL must use https in production/);
    expect(message).not.toMatch(/ADMIN_URL/);
  });
});
