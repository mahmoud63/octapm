const { apiOrigin, apiUrl } = require("../api-url");

describe("api-url", () => {
  it("builds the same URL whether API_BASE_URL is the origin or the API root", () => {
    const bare = { API_BASE_URL: "https://api.example.test" };
    const mounted = { API_BASE_URL: "https://api.example.test/api/v1" };
    const trailing = { API_BASE_URL: "https://api.example.test/api/v1/" };

    for (const env of [bare, mounted, trailing]) {
      expect(apiOrigin(env)).toBe("https://api.example.test");
      expect(apiUrl("/auth/sso/callback", env)).toBe(
        "https://api.example.test/api/v1/auth/sso/callback",
      );
    }
  });

  it("accepts a path with or without its leading slash", () => {
    const env = { API_BASE_URL: "https://api.example.test" };
    expect(apiUrl("integrations/accounting/qbo/callback", env)).toBe(
      apiUrl("/integrations/accounting/qbo/callback", env),
    );
  });

  it("falls back to WEB_APP_URL, then to localhost", () => {
    expect(apiOrigin({ WEB_APP_URL: "https://app.example.test/" })).toBe(
      "https://app.example.test",
    );
    expect(apiOrigin({})).toBe("http://localhost:5000");
  });
});
