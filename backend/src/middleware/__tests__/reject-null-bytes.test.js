const express = require("express");
const request = require("supertest");
const { rejectNullBytes } = require("../reject-null-bytes");
const { errorHandler } = require("../error-handler");

/**
 * CERT-2: a NUL (U+0000) in any field reaches Postgres and answers 500
 * (22P05). The guard refuses the request with 400 VALIDATION_ERROR before any
 * route runs, whether the NUL is in the JSON body, a query parameter or the
 * path — and lets every clean request through.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(rejectNullBytes);
  app.all("/projects/:projectId/echo/:id", (req, res) => res.json({ ok: true, body: req.body, query: req.query, params: req.params }));
  app.use(errorHandler);
  return app;
}

describe("reject-null-bytes guard (CERT-2)", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  const refusedBody = (res) => res.status === 400 && res.body?.error?.code === "VALIDATION_ERROR";

  it("refuses a NUL in a top-level text body field", async () => {
    const res = await request(buildApp()).post("/projects/p1/echo/x").send({ subject: "a\u0000b" });
    expect(refusedBody(res)).toBe(true);
  });

  it("refuses a NUL nested in a JSON object or array body field", async () => {
    for (const body of [{ evidence: { note: "n\u0000ul" } }, { items: ["ok", "bad\u0000"] }, { nested: { a: { b: ["\u0000"] } } }, { "key\u0000": "v" }]) {
      const res = await request(buildApp()).post("/projects/p1/echo/x").send(body);
      expect(refusedBody(res)).toBe(true);
    }
  });

  it("refuses a NUL in a query parameter (raw %00 and nested array)", async () => {
    expect(refusedBody(await request(buildApp()).get("/projects/p1/echo/x?search=a%00b"))).toBe(true);
    expect(refusedBody(await request(buildApp()).get("/projects/p1/echo/x?activityId=a%00&activityId=b"))).toBe(true);
  });

  it("refuses a NUL in a path segment", async () => {
    expect(refusedBody(await request(buildApp()).get("/projects/p1/echo/%00"))).toBe(true);
  });

  it("lets a clean request through unchanged", async () => {
    const res = await request(buildApp()).post("/projects/p1/echo/abc?search=hello&n=3").send({ subject: "Clean subject", evidence: { note: "fine" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, body: { subject: "Clean subject" }, params: { id: "abc" } });
  });
});
