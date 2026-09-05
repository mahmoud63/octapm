const express = require("express");
const request = require("supertest");

jest.mock("../../config/db", () => ({ prisma: {} }));

const { requirePermission, requireCompanyAdmin, hasPermission } = require("../../middleware/rbac");
const { compileTemplate } = require("../../services/permission-template.service");

const buildApp = ({ user, projectAccess }) => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    if (projectAccess) req.projectAccess = projectAccess;
    next();
  });
  app.get("/read", requirePermission("schedule", "read"), (_req, res) => res.json({ ok: true }));
  app.get("/update", requirePermission("schedule", "update"), (_req, res) =>
    res.json({ ok: true }),
  );
  app.get(
    "/approve",
    requirePermission("schedule", "approve", { transition: "revision.approve" }),
    (_req, res) => res.json({ ok: true }),
  );
  app.get("/users", requirePermission("user_management", "delete"), (_req, res) =>
    res.json({ ok: true }),
  );
  app.get("/admin", requireCompanyAdmin, (_req, res) => res.json({ ok: true }));
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || "INTERNAL_ERROR", message: err.message, details: err.details },
    }),
  );
  return app;
};

const template = (tools, grants = []) =>
  compileTemplate({
    id: "tpl-1",
    name: "Custom",
    kind: "internal",
    baseRole: "site_engineer",
    tools,
    grants: grants.map((key) => ({ key })),
  });

describe("requirePermission with permission templates", () => {
  it("falls back to the static policy when no template is attached", async () => {
    const app = buildApp({
      user: { id: "u1", role: "site_engineer" },
      projectAccess: { id: "p1", role: "planning_eng", partyAccess: [] },
    });
    await request(app).get("/update").expect(200);
    await request(app).get("/approve").expect(403);
  });

  it("a template decides even when the role would allow the action", async () => {
    const app = buildApp({
      user: { id: "u1", role: "pm" },
      projectAccess: {
        id: "p1",
        role: "pm",
        partyAccess: [],
        template: template([{ module: "schedule", level: "read_only" }]),
      },
    });
    await request(app).get("/read").expect(200);
    const denied = await request(app).get("/update");
    expect(denied.status).toBe(403);
    expect(denied.body.error.details).toEqual(
      expect.objectContaining({ module: "schedule", action: "update", source: "template" }),
    );
  });

  it("admin level and grants unlock actions the role would not have", async () => {
    const adminApp = buildApp({
      user: { id: "u1", role: "site_engineer" },
      projectAccess: {
        id: "p1",
        role: "site_engineer",
        partyAccess: [],
        template: template([{ module: "schedule", level: "admin" }]),
      },
    });
    await request(adminApp).get("/approve").expect(200);

    const grantApp = buildApp({
      user: { id: "u1", role: "site_engineer" },
      projectAccess: {
        id: "p1",
        role: "site_engineer",
        partyAccess: [],
        template: template([], ["schedule|transition:revision.approve"]),
      },
    });
    await request(grantApp).get("/approve").expect(200);
    await request(grantApp).get("/update").expect(403);
  });

  it("company admins are admin on the company administration modules only", async () => {
    const app = buildApp({
      user: { id: "u1", role: "warehouse", isCompanyAdmin: true },
      projectAccess: {
        id: "p1",
        role: "warehouse",
        partyAccess: [],
        template: template([{ module: "schedule", level: "none" }]),
      },
    });
    await request(app).get("/users").expect(200);
    await request(app).get("/admin").expect(200);
    await request(app).get("/read").expect(403);

    const plain = buildApp({ user: { id: "u2", role: "warehouse" } });
    await request(plain).get("/admin").expect(403);
    await request(plain).get("/users").expect(403);
    const pm = buildApp({ user: { id: "u3", role: "pm" } });
    await request(pm).get("/admin").expect(200);
  });

  it("exposes hasPermission for in-handler checks", () => {
    const req = {
      user: { id: "u1", role: "site_engineer" },
      projectAccess: {
        role: "site_engineer",
        partyAccess: [],
        template: template([{ module: "cost", level: "read_only" }]),
      },
    };
    expect(hasPermission(req, "cost", "read")).toBe(true);
    expect(hasPermission(req, "cost", "create")).toBe(false);
    expect(hasPermission({}, "cost", "read")).toBe(false);
  });
});
