/**
 * Authorization sweep.
 *
 * The OpenAPI document declares, for every operation, which roles may call it
 * (`x-permissions.roles` — the validator refuses an undocumented one). This
 * suite takes that declaration at its word and probes each project-scoped GET
 * with a role the document says must be refused.
 *
 * A 200 here means the route has no permission guard: the contract published to
 * the mobile team says one thing and the server does another. That is how a
 * warehouse account ends up reading the commercial change-order register.
 */
const { login, actor } = require("./harness");
const { openApiSpec } = require("../../src/openapi/spec");

const SEED_PASSWORD = process.env.QA_SEED_PASSWORD || "DemoPassw0rd!";
const PERSONAS = {
  pm: "pm@octapm.demo",
  planning_eng: "planner@octapm.demo",
  qs: "qs@octapm.demo",
  cost_controller: "cost@octapm.demo",
  procurement: "procurement@octapm.demo",
  warehouse: "warehouse@octapm.demo",
  site_engineer: "site@octapm.demo",
  finance: "finance@octapm.demo",
};
const ALL_ROLES = Object.keys(PERSONAS);

/** Only GETs with no path parameter beyond projectId — list endpoints. */
const isProjectList = (path) => /^\/projects\/\{projectId\}\/[a-z-]+$/.test(path);

module.exports = async function authorizationSweep(runner) {
  await runner.run(
    "S-PERM-002",
    {
      module: "Permissions",
      purpose: "Every documented project list endpoint refuses the roles its own contract excludes",
      role: "all eight roles",
      preconditions: "S-PROJ-001",
    },
    async (s, context) => {
      if (!context.projectId) return s.gap("api", "skipped: no project in context");

      const who = {};
      for (const [role, email] of Object.entries(PERSONAS)) {
        const session = await login(email, SEED_PASSWORD);
        if (session.token) who[role] = actor(session.token, role);
      }
      if (Object.keys(who).length < ALL_ROLES.length) {
        s.gap("api", `only ${Object.keys(who).length}/${ALL_ROLES.length} roles could sign in`);
      }

      // Endpoints worth probing: those documented as restricted.
      const targets = [];
      for (const [path, methods] of Object.entries(openApiSpec.paths || {})) {
        if (!isProjectList(path)) continue;
        const op = methods.get;
        const roles = op?.["x-permissions"]?.roles;
        if (!Array.isArray(roles) || roles.length === 0) continue;
        const denied = ALL_ROLES.filter((r) => !roles.includes(r));
        if (denied.length === 0) continue; // open to every role by design
        targets.push({ path, allowed: roles, denied, operationId: op.operationId });
      }
      s.note("api", `${targets.length} project list endpoints are documented as role-restricted`);

      const unguarded = [];
      const overGuarded = [];
      let probes = 0;

      for (const target of targets) {
        const url = target.path.replace("{projectId}", context.projectId);

        // One denied role reaching 200 is enough to prove the guard is missing.
        for (const role of target.denied) {
          if (!who[role]) continue;
          probes += 1;
          const response = await who[role].get(url);
          if (response.status === 200) {
            unguarded.push({ path: target.path, role, operationId: target.operationId, allowed: target.allowed });
            break;
          }
        }

        // And a role the contract allows must not be refused.
        const allowedRole = target.allowed.find((r) => who[r]);
        if (allowedRole) {
          probes += 1;
          const response = await who[allowedRole].get(url);
          if (response.status === 403) {
            overGuarded.push({ path: target.path, role: allowedRole, operationId: target.operationId });
          }
        }
      }

      s.step("probe restricted endpoints with an excluded role", `${probes} requests`);
      context.unguardedEndpoints = unguarded;

      for (const miss of unguarded) {
        s.fail(
          "permission",
          `${miss.path} has no read guard: ${miss.role} got 200 though the contract allows only [${miss.allowed.join(", ")}]`,
          {
            severity: "Critical",
            fix: `Add requirePermission("<module>", "read") to the GET handler behind ${miss.operationId}.`,
          },
        );
      }
      for (const over of overGuarded) {
        s.fail("permission", `${over.path} refuses ${over.role}, which its own contract allows`, {
          severity: "Major",
        });
      }

      if (!unguarded.length && !overGuarded.length) {
        s.note("permission", `all ${targets.length} restricted endpoints enforce their documented roles`);
      } else {
        s.note(
          "permission",
          `${targets.length - unguarded.length}/${targets.length} restricted endpoints enforce their contract`,
        );
      }
    },
  );
};
