const express = require("express");
const request = require("supertest");
const { requestId } = require("../request-id");
const { errorHandler } = require("../error-handler");
const { HttpError } = require("../../utils/http-error");

function buildApp() {
  const app = express();
  app.use(requestId);
  app.get("/ok", (req, res) => res.json({ id: req.id }));
  app.get("/fail", () => {
    throw new HttpError(403, "FORBIDDEN", "Not allowed");
  });
  app.use(errorHandler);
  return app;
}

describe("request id", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  it("mints one when the client sends none, and returns it in the header", async () => {
    const res = await request(buildApp()).get("/ok");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.id).toBe(res.headers["x-request-id"]);
  });

  it("keeps a plain id the client offered, so its logs and ours line up", async () => {
    const res = await request(buildApp()).get("/ok").set("X-Request-Id", "m-abc123-def456");
    expect(res.headers["x-request-id"]).toBe("m-abc123-def456");
  });

  it("replaces anything that is not a plain token rather than echoing it", async () => {
    const res = await request(buildApp()).get("/ok").set("X-Request-Id", "<script>alert(1)</script>");
    expect(res.headers["x-request-id"]).not.toContain("<");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("writes the id into the error envelope", async () => {
    const res = await request(buildApp()).get("/fail").set("X-Request-Id", "ref-for-support-1");
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.error.requestId).toBe("ref-for-support-1");
    expect(res.headers["x-request-id"]).toBe("ref-for-support-1");
  });
});
