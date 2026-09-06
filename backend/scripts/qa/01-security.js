/**
 * P0 security scenarios: authentication, multi-tenancy, and the permission
 * matrix enforced server-side.
 *
 * Tenant isolation is tested the way an attacker would: a real second
 * organisation is registered, and its user is pointed straight at the first
 * organisation's record ids over the API. Hiding a button is not a control.
 */
const { prisma, http, login, actor } = require("./harness");
const { can, permissionPolicy } = require("../../src/config/permissions");

const SEED_PASSWORD = process.env.QA_SEED_PASSWORD || "DemoPassw0rd!";
const SEED_USERS = {
  pm: "pm@octapm.demo",
  planner: "planner@octapm.demo",
  qs: "qs@octapm.demo",
  cost: "cost@octapm.demo",
  procurement: "procurement@octapm.demo",
  warehouse: "warehouse@octapm.demo",
  site: "site@octapm.demo",
  finance: "finance@octapm.demo",
};

// The seed's persona keys mapped to the role ids the permission policy uses.
const ROLE_OF = {
  pm: "pm",
  planner: "planning_eng",
  qs: "qs",
  cost: "cost_controller",
  procurement: "procurement",
  warehouse: "warehouse",
  site: "site_engineer",
  finance: "finance",
};

// Probes checked against every role. Expectations are NOT hardcoded: each is
// read from the permission policy, so this asks the question that matters —
// does the API enforce exactly what the policy declares? Drift in either
// direction is a defect.
const MATRIX = [
  { module: "rfi", action: "read", method: "GET", path: (p) => `/projects/${p}/rfi` },
  {
    module: "rfi",
    action: "create",
    method: "POST",
    path: (p) => `/projects/${p}/rfi`,
    body: () => ({ subject: `Permission probe ${Date.now()}`, question: "probe", priority: "normal" }),
  },
  { module: "cost", action: "read", method: "GET", path: (p) => `/projects/${p}/cost` },
  { module: "schedule", action: "read", method: "GET", path: (p) => `/projects/${p}/activities` },
  { module: "punch", action: "read", method: "GET", path: (p) => `/projects/${p}/punch` },
  { module: "submittal", action: "read", method: "GET", path: (p) => `/projects/${p}/submittals` },
  { module: "change_order", action: "read", method: "GET", path: (p) => `/projects/${p}/change-orders` },
  { module: "commitment", action: "read", method: "GET", path: (p) => `/projects/${p}/commitments` },
  { module: "timesheet", action: "read", method: "GET", path: (p) => `/projects/${p}/timesheets` },
  { module: "safety", action: "read", method: "GET", path: (p) => `/projects/${p}/safety` },
  {
    module: "change_order",
    action: "create",
    method: "POST",
    path: (p) => `/projects/${p}/change-orders`,
    body: () => ({ description: `Permission probe ${Date.now()}`, category: "variation", value: 1000 }),
  },
];

async function register(orgName, name, email) {
  const response = await http("/auth/register", {
    method: "POST",
    body: { orgName, name, email, password: "Sep@rateOrg2026!" },
  });
  return {
    status: response.status,
    token: response.data?.tokens?.accessToken || null,
    user: response.data?.user || null,
    error: response.error,
  };
}

module.exports = async function security(runner) {
  const ctx = runner.context;

  // ─── Authentication ─────────────────────────────────────────────────────

  await runner.run(
    "S-AUTH-001",
    {
      module: "Auth",
      purpose: "A valid sign-in issues a session; bad credentials never do",
      role: "PM",
      preconditions: "Seeded demo organisation",
    },
    async (s) => {
      const good = await login(SEED_USERS.pm, SEED_PASSWORD);
      s.step("sign in with the correct password", `HTTP ${good.status}`);
      if (!good.token) return s.fail("api", `valid sign-in failed: HTTP ${good.status}`, { severity: "Blocker" });
      s.note("api", "valid credentials return an access token");
      ctx.pm = actor(good.token, "PM");
      ctx.pmUser = good.user;

      const wrongPassword = await login(SEED_USERS.pm, "not-the-password");
      s.step("sign in with a wrong password", `HTTP ${wrongPassword.status}`);
      if (wrongPassword.token) s.fail("permission", "a wrong password still issued a token", { severity: "Blocker" });
      else if (wrongPassword.status !== 401) s.gap("api", `wrong password returned ${wrongPassword.status}, expected 401`);
      else s.note("permission", "wrong password refused with 401");

      const unknown = await login("nobody@octapm.demo", SEED_PASSWORD);
      s.step("sign in as an unknown user", `HTTP ${unknown.status}`);
      if (unknown.token) s.fail("permission", "an unknown email was issued a token", { severity: "Blocker" });
      else s.note("permission", "unknown user refused");

      // The refusal must not distinguish "no such user" from "wrong password",
      // or the endpoint becomes a user-enumeration oracle.
      if (wrongPassword.status !== unknown.status) {
        s.fail(
          "permission",
          `user enumeration: wrong password returns ${wrongPassword.status} but unknown user returns ${unknown.status}`,
          { severity: "Major", fix: "Return an identical status and message for both." },
        );
      } else {
        s.note("permission", "wrong password and unknown user are indistinguishable");
      }
    },
  );

  await runner.run(
    "S-AUTH-002",
    {
      module: "Auth",
      purpose: "Requests without a valid bearer token are refused",
      role: "anonymous",
      preconditions: "S-AUTH-001",
    },
    async (s) => {
      const none = await http("/projects");
      s.step("call a protected endpoint with no token", `HTTP ${none.status}`);
      if (none.status !== 401) s.fail("permission", `no token returned ${none.status}, expected 401`, { severity: "Blocker" });
      else s.note("permission", "missing token refused with 401");

      const garbage = await http("/projects", { token: "not-a-jwt" });
      s.step("call with a malformed token", `HTTP ${garbage.status}`);
      if (garbage.status !== 401) s.fail("permission", `malformed token returned ${garbage.status}, expected 401`, { severity: "Critical" });
      else s.note("permission", "malformed token refused");

      // A token signed with the wrong key must not be accepted.
      const forged =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        Buffer.from(JSON.stringify({ id: "00000000-0000-4000-8000-000000000000", role: "pm" })).toString("base64url") +
        ".forged";
      const forgedResponse = await http("/projects", { token: forged });
      s.step("call with a forged token", `HTTP ${forgedResponse.status}`);
      if (forgedResponse.status !== 401) {
        s.fail("permission", `forged token returned ${forgedResponse.status}, expected 401`, { severity: "Blocker" });
      } else {
        s.note("permission", "forged signature refused");
      }
    },
  );

  // ─── Establish the tenant under test ────────────────────────────────────

  await runner.run(
    "S-PROJ-001",
    {
      module: "Projects",
      purpose: "The signed-in PM sees their organisation's project and its identifiers are sound",
      role: "PM",
      preconditions: "Seeded demo organisation",
    },
    async (s, context) => {
      const response = await context.pm.get("/projects");
      s.step("list projects", `HTTP ${response.status}`);
      const items = response.data?.items || [];
      if (!items.length) return s.fail("api", "the PM sees no projects", { severity: "Blocker" });

      const project = items.find((p) => p.name === "Riverside Tower") || items[0];
      context.projectId = project.id;
      context.orgId = context.pmUser.orgId;
      s.note("api", `${items.length} project(s) visible`);

      const row = await prisma.project.findUnique({ where: { id: project.id } });
      if (!row) return s.fail("database", "the listed project does not exist in the database", { severity: "Blocker" });
      if (row.orgId !== context.orgId) {
        s.fail("database", `project.orgId ${row.orgId} does not match the caller's org ${context.orgId}`, {
          severity: "Blocker",
        });
      } else {
        s.note("database", "project row is owned by the caller's organisation");
      }

      const detail = await context.pm.get(`/projects/${project.id}`);
      s.step("open the project", `HTTP ${detail.status}`);
      if (detail.status !== 200) s.fail("api", `project detail returned ${detail.status}`, { severity: "Critical" });
      else s.note("api", "project detail loads");
    },
  );

  // ─── Multi-tenancy ──────────────────────────────────────────────────────

  await runner.run(
    "S-TENANT-001",
    {
      module: "Multi-tenancy",
      purpose: "A user of another company cannot reach this company's project by id",
      role: "PM of a second organisation",
      preconditions: "S-PROJ-001",
    },
    async (s, context) => {
      const email = `intruder+${Date.now()}@othercorp.test`;
      const other = await register("Other Corp Contracting", "Intruder Admin", email);
      s.step("register a separate organisation", `HTTP ${other.status}`);
      if (!other.token) return s.fail("api", `could not register a second org: HTTP ${other.status}`, { severity: "Major" });

      context.intruder = actor(other.token, "other-org PM");
      context.intruderUser = other.user;
      if (other.user.orgId === context.orgId) {
        return s.fail("database", "registration reused the existing organisation instead of creating a new one", {
          severity: "Blocker",
        });
      }
      s.note("database", "the second organisation is distinct");

      // Straight at the other tenant's ids.
      const probes = [
        ["project detail", `/projects/${context.projectId}`],
        ["RFI register", `/projects/${context.projectId}/rfi`],
        ["budget", `/projects/${context.projectId}/cost`],
        ["activities", `/projects/${context.projectId}/activities`],
        ["BOQ", `/projects/${context.projectId}/boq`],
        ["team", `/projects/${context.projectId}/team`],
        ["audit trail", `/projects/${context.projectId}/audit`],
        ["attachments", `/projects/${context.projectId}/attachments?recordType=rfi`],
      ];

      let leaked = 0;
      for (const [label, path] of probes) {
        const response = await context.intruder.get(path);
        s.step(`cross-tenant GET ${label}`, `HTTP ${response.status}`);
        if (response.status === 200) {
          leaked += 1;
          s.fail("permission", `cross-tenant read succeeded: ${label} (${path})`, {
            severity: "Blocker",
            fix: "Scope the query by req.user.orgId before loading the record.",
          });
        }
      }
      if (!leaked) s.note("permission", `all ${probes.length} cross-tenant reads refused`);

      // And a cross-tenant write.
      const write = await context.intruder.post(`/projects/${context.projectId}/rfi`, {
        subject: "Cross-tenant write probe",
        question: "Should never be created",
        priority: "normal",
      });
      s.step("cross-tenant RFI create", `HTTP ${write.status}`);
      if (write.status === 200 || write.status === 201) {
        s.fail("permission", "a user from another organisation created an RFI in this project", { severity: "Blocker" });
      } else {
        s.note("permission", "cross-tenant write refused");
      }

      // Whatever the API said, nothing may have been written.
      const strays = await prisma.rfi.count({
        where: { projectId: context.projectId, subject: "Cross-tenant write probe" },
      });
      if (strays > 0) {
        s.fail("database", `${strays} cross-tenant RFI row(s) were persisted despite the API refusing`, {
          severity: "Blocker",
        });
      } else {
        s.note("database", "no cross-tenant row was written");
      }
    },
  );

  await runner.run(
    "S-TENANT-002",
    {
      module: "Multi-tenancy",
      purpose: "Global search does not reveal records the caller cannot open",
      role: "PM of a second organisation",
      preconditions: "S-TENANT-001",
    },
    async (s, context) => {
      if (!context.intruder) return s.gap("api", "skipped: no second organisation");

      const response = await context.intruder.get(`/search?q=${encodeURIComponent("Riverside")}`);
      s.step("search for the other tenant's project name", `HTTP ${response.status}`);
      if (response.status === 404) return s.gap("api", "no /search endpoint at this path");
      if (response.status !== 200) return s.gap("api", `search returned ${response.status}`);

      // Inspect the results only — the payload echoes the query string back,
      // so matching the whole body would flag itself.
      const items = response.data?.items || [];
      const groups = response.data?.groups || [];
      const found = JSON.stringify({ items, groups });

      if (found.includes(context.projectId)) {
        s.fail("permission", "search results leak another organisation's project id", { severity: "Blocker" });
      } else if (items.length || groups.length) {
        s.fail("permission", `search returned ${items.length} item(s) from another organisation`, {
          severity: "Critical",
        });
      } else {
        s.note("permission", "search returned no results from the other organisation");
        if (response.data?.meta?.authorizedProjectCount === 0) {
          s.note("permission", "authorizedProjectCount is 0 for the outsider");
        }
      }
    },
  );

  // ─── Role matrix, enforced server-side ──────────────────────────────────

  await runner.run(
    "S-PERM-001",
    {
      module: "Permissions",
      purpose: "Every role's RFI permissions are enforced by the API",
      role: "all eight roles",
      preconditions: "S-PROJ-001",
    },
    async (s, context) => {
      const tokens = {};
      for (const [key, email] of Object.entries(SEED_USERS)) {
        const session = await login(email, SEED_PASSWORD);
        if (!session.token) {
          s.fail("api", `could not sign in as ${key} (${email}): HTTP ${session.status}`, { severity: "Major" });
          continue;
        }
        tokens[key] = actor(session.token, key);
      }
      context.roleActors = tokens;
      s.note("api", `signed in as ${Object.keys(tokens).length}/8 roles`);

      const grid = [];
      for (const probe of MATRIX) {
        for (const [key, who] of Object.entries(tokens)) {
          const role = ROLE_OF[key];
          const path = probe.path(context.projectId);
          const response =
            probe.method === "GET" ? await who.get(path) : await who.post(path, probe.body());
          const allowed = response.status === 200 || response.status === 201;
          const policyAllows = can({ role, module: probe.module, action: probe.action });
          grid.push({
            module: probe.module,
            action: probe.action,
            role,
            status: response.status,
            allowed,
            policyAllows,
          });

          if (allowed && !policyAllows) {
            s.fail(
              "permission",
              `${role} did ${probe.module}.${probe.action} (HTTP ${response.status}) but the policy forbids it`,
              { severity: "Critical", fix: `Add requirePermission("${probe.module}", "${probe.action}") to the route.` },
            );
          }
          // A 403 where the policy allows is a genuine mismatch. Any other
          // non-200 (a 400 from a thin probe body, say) is not a permission
          // result and is left out of the verdict.
          if (!allowed && policyAllows && response.status === 403) {
            s.fail("permission", `${role} was refused ${probe.module}.${probe.action}, which the policy grants`, {
              severity: "Major",
              fix: `Check the route's requirePermission call against the ${probe.module} policy.`,
            });
          }
        }
      }
      context.permissionGrid = grid;

      const correctAllow = grid.filter((g) => g.allowed && g.policyAllows).length;
      const correctDeny = grid.filter((g) => !g.allowed && !g.policyAllows && g.status === 403).length;
      const inconclusive = grid.filter((g) => !g.allowed && g.status !== 403).length;
      s.note(
        "permission",
        `${grid.length} probes: ${correctAllow} correctly allowed, ${correctDeny} correctly refused with 403, ${inconclusive} inconclusive (non-403 rejection)`,
      );
    },
  );
};
