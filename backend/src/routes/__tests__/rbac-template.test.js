const express = require("express");
const request = require("supertest");

jest.mock("../../config/db", () => ({ prisma: {} }));

const { requirePermission, requireCompanyAdmin, requireRoles, hasPermission } = require("../../middleware/rbac");
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

describe("Phase 21D — integrity (release challenge, tenth pass)", () => {
  const changeOrderApp = ({ user, template: tpl = null }) => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = user;
      req.projectAccess = { id: "p1", role: user.role, partyAccess: [], ...(tpl ? { template: tpl } : {}) };
      next();
    });
    const orders = express.Router({ mergeParams: true });
    orders.post("/", requireRoles("pm", "qs"), (_req, res) => res.status(201).json({ ok: true }));
    orders.patch("/:id", requireRoles("pm", "qs"), (_req, res) => res.json({ ok: true }));
    orders.delete("/:id", requireRoles("pm"), (_req, res) => res.json({ ok: true }));
    app.use("/projects/:projectId/change-orders", orders);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message, details: err.details } }));
    return app;
  };

  it("CX21-515: a role guard under a project asks the project's template first — a template that refuses change orders refuses their creation, edit and archive to a PM; one that grants them admits a role the list does not name; none, and the role list decides", async () => {
    const denied = changeOrderApp({ user: { id: "u1", role: "pm" }, template: template([{ module: "change_order", level: "read_only" }]) });
    const created = await request(denied).post("/projects/p1/change-orders").send({});
    expect([created.status, created.body.error?.details?.source]).toEqual([403, "template"]);
    expect((await request(denied).patch("/projects/p1/change-orders/co-1").send({})).status).toBe(403);
    expect((await request(denied).delete("/projects/p1/change-orders/co-1")).status).toBe(403);

    const granted = changeOrderApp({ user: { id: "u2", role: "site_engineer" }, template: template([{ module: "change_order", level: "admin" }]) });
    expect((await request(granted).post("/projects/p1/change-orders").send({})).status).toBe(201);

    const untemplated = changeOrderApp({ user: { id: "u3", role: "site_engineer" } });
    expect((await request(untemplated).post("/projects/p1/change-orders").send({})).status).toBe(403);
    const pm = changeOrderApp({ user: { id: "u4", role: "pm" } });
    expect((await request(pm).post("/projects/p1/change-orders").send({})).status).toBe(201);
  });
});
