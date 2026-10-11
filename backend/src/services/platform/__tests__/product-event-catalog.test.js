const {
  CLIENT_EVENTS,
  SERVER_EVENT_RULES,
  matchServerEvent,
  moduleOfPath,
  normalisePath,
} = require("../product-event-catalog");

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("product-event catalogue", () => {
  test("normalisePath replaces ids, dates, numbers and free text with :id", () => {
    expect(normalisePath(`/api/v1/projects/${ID}/rfi/${ID}/close?x=secret`)).toBe("/projects/:id/rfi/:id/close");
    expect(normalisePath(`/api/v1/projects/${ID}/daily-logs/2026-10-04/submit`)).toBe("/projects/:id/daily-logs/:id/submit");
    expect(normalisePath("/api/v1/reports/123/export.pdf")).toBe("/reports/:id/export.pdf");
    expect(normalisePath("/api/v1/search/Mr%20Smith's%20invoice")).toBe("/search/:id");
    expect(normalisePath("/api/v1/x/%E0%A4%A")).toBe("/:id/:id");
  });

  test("normalisePath keeps only words of the documented routes (pre-merge review CX-2)", () => {
    expect(normalisePath("/api/v1/projects/confidential-client/rfi")).toBe("/projects/:id/rfi");
    expect(normalisePath("/api/v1/projects/abc/rfi/Acme-Tower-Phase2/close")).toBe("/projects/:id/rfi/:id/close");
    expect(normalisePath("/api/v1/platform-admin/companies/secret-name")).toBe("/platform-admin/companies/:id");
    // A parameter value that is itself a route word (`xer`, as in /import/xer) is kept: route vocabulary, never customer text.
    expect(normalisePath("/api/v1/projects/abc/export/schedule/xer")).toBe("/projects/:id/export/schedule/xer");
    expect(normalisePath("/api/v1/projects/abc/export/schedule/acme-format")).toBe("/projects/:id/export/schedule/:id");
  });

  test("moduleOfPath names the API area", () => {
    expect(moduleOfPath("/projects/:id/rfi/:id")).toBe("rfi");
    expect(moduleOfPath("/projects")).toBe("projects");
    expect(moduleOfPath("/inventory/stock/issue")).toBe("inventory");
    expect(moduleOfPath("/")).toBeNull();
  });

  test.each([
    ["POST", "/projects", "project.created"],
    ["POST", "/projects/:id/boq/upload", "boq.imported"],
    ["POST", "/projects/:id/import/xer", "schedule.imported"],
    ["POST", "/projects/:id/schedule/revisions/:id/baseline", "schedule.baseline_locked"],
    ["POST", "/projects/:id/rfi", "rfi.created"],
    ["POST", "/projects/:id/rfi/:id/close", "rfi.closed"],
    ["POST", "/projects/:id/activities/:id/progress-submissions/:id/approve", "progress.approved"],
    ["POST", "/inventory/goods-receipt", "inventory.received"],
    ["GET", "/projects/:id/export/xlsx", "report.generated"],
    ["GET", "/projects/:id/export/schedule/xer", "report.generated"],
    ["GET", "/projects/:id/punch/export.csv", "report.generated"],
    ["GET", "/reports/:id/export.pdf", "report.generated"],
    ["GET", "/search", "search.executed"],
  ])("%s %s → %s", (method, path, eventName) => {
    expect(matchServerEvent(method, path)?.eventName).toBe(eventName);
  });

  test.each([
    ["GET", "/projects/:id/rfi"],
    ["PATCH", "/projects/:id/rfi/:id"],
    ["GET", "/integrations/accounting/export"],
    ["GET", "/projects/:id/accounting/export"],
    ["POST", "/projects/:id/rfi/:id/comments"],
  ])("%s %s is not a product event", (method, path) => {
    expect(matchServerEvent(method, path)).toBeNull();
  });

  test("every catalogue word satisfies the database CHECKs", () => {
    const name = /^[a-z][a-z_]*(\.[a-z][a-z_]*){1,3}$/;
    const word = /^[a-z][a-z_]*$/;
    for (const rule of SERVER_EVENT_RULES) {
      expect(rule.eventName).toMatch(name);
      expect(rule.module).toMatch(word);
      expect(rule.action).toMatch(word);
    }
    for (const [eventName, entry] of Object.entries(CLIENT_EVENTS)) {
      expect(eventName).toMatch(name);
      expect(entry.module).toMatch(word);
    }
  });
});
