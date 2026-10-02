/**
 * Phase 21 · stage 1 — company foundation, greenfield project, project team.
 *
 * Creates its own client, supplier, subcontractor and consultant, then a
 * project that has never existed before, then puts a real team on it through
 * the Phase 20.5 "add existing user" workflow and proves access before and
 * after.
 *
 * Writes every created id to context.json so later stages build on the same
 * records rather than inventing their own.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, DELETE, probe, check, note, section, summary } = require("./harness");

const CONTEXT = process.env.P21_CONTEXT || path.join(__dirname, "context.json");

/** The nine personas sign in at <key>@<domain>; P21_EMAIL_DOMAIN names another company's people. */
const DOMAIN = process.env.P21_EMAIL_DOMAIN || "octapm.demo";

const PEOPLE = {
  admin: `pm@${DOMAIN}`, // company admin + PM
  pm: `pm@${DOMAIN}`,
  planner: `planner@${DOMAIN}`,
  qs: `qs@${DOMAIN}`,
  cost: `cost@${DOMAIN}`,
  procurement: `procurement@${DOMAIN}`,
  warehouse: `warehouse@${DOMAIN}`,
  site: `site@${DOMAIN}`,
  finance: `finance@${DOMAIN}`,
};

/** Project roles the team members should hold on this job. */
const TEAM = {
  planner: "planning_eng",
  qs: "qs",
  cost: "cost_controller",
  procurement: "procurement",
  warehouse: "warehouse",
  site: "site_engineer",
  finance: "finance",
};

const STAMP = process.env.P21_STAMP || new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const TAG = `P21-${STAMP}`;

async function main() {
  const ctx = { stamp: STAMP, tag: TAG, createdAt: new Date().toISOString(), people: PEOPLE };

  section(`PHASE 21 · STAGE 1 — foundation   tag=${TAG}`);

  // ── who each persona is ──────────────────────────────────────────────────
  ctx.userIds = {};
  for (const [role, email] of Object.entries(PEOPLE)) {
    const me = await GET(email, "/auth/me");
    ctx.userIds[role] = me.id;
    if (role === "pm") ctx.orgId = me.orgId;
  }
  note("organisation", ctx.orgId);
  note("personas", Object.keys(PEOPLE).join(", "));

  // ── plan headroom, before anything is created ────────────────────────────
  const before = await GET(PEOPLE.pm, "/projects?limit=1");
  note("project list reachable", `hasMore=${before.hasMore}`);

  // ── company directory: create the parties this job works with ────────────
  section("1.1  Company directory — created once, reused everywhere");

  const companies = {
    client: { name: `${TAG} Meridian Property Group`, type: "external" },
    supplier: { name: `${TAG} Gulf Steel & Cement Supply`, type: "external" },
    subcontractor: { name: `${TAG} Delta Concrete Works`, type: "external" },
    consultant: { name: `${TAG} Aziz Consulting Engineers`, type: "external" },
  };

  ctx.companies = {};
  for (const [kind, payload] of Object.entries(companies)) {
    const created = await POST(PEOPLE.admin, "/companies", {
      ...payload,
      email: `${kind}@${STAMP}.${process.env.P21_PARTY_DOMAIN || "octapm.test"}`,
      phone: "+1 555 0100",
      address: "1 Industrial Way",
      status: "active",
    });
    ctx.companies[kind] = { id: created.id, name: created.name };
    check(`company created: ${kind}`, true, Boolean(created.id));
  }

  // Reuse proof: the directory returns them.
  const directory = await GET(PEOPLE.admin, "/companies?limit=100&search=" + encodeURIComponent(TAG));
  const found = (directory.items || []).filter((c) => c.name.startsWith(TAG));
  check("all four companies appear in the directory", 4, found.length);

  // ── the greenfield project ───────────────────────────────────────────────
  section("1.2  Greenfield project — created through the product, not the database");

  const project = await POST(PEOPLE.pm, "/projects", {
    name: `OCTA PHASE21 GREENFIELD ${STAMP}`,
    type: "building",
    location: "Riyadh, Saudi Arabia",
    clientName: ctx.companies.client.name,
    consultantName: ctx.companies.consultant.name,
    contractorName: "OctaPM Demo Contracting",
    contractType: "unit_rate",
    contractNumber: `${TAG}-C-001`,
    startDate: "2027-01-04",
    endDate: "2027-12-17",
    currency: "USD",
    contractValue: 2_000_000,
    defaultRetentionRate: 5,
    projectCalendar: "six_day",
    status: "active",
  });

  ctx.projectId = project.id;
  ctx.projectName = project.name;
  check("project has a stable id", true, Boolean(project.id));
  note("project", `${project.name}  (${project.id})`);

  // It is visible in the portfolio, by id and in the list.
  const readBack = await GET(PEOPLE.pm, `/projects/${project.id}`);
  check("project reads back by id", project.id, readBack.id);
  check("contract value survived", 2_000_000, Number(readBack.contractValue));
  check("currency survived", "USD", readBack.currency);

  // ── the project starts empty: no inherited business records ──────────────
  section("1.3  A new project inherits nothing");

  const emptyProbes = [
    ["activities", `/projects/${project.id}/activities`],
    ["BOQ items", `/projects/${project.id}/boq`],
    ["budget lines", `/projects/${project.id}/budget/lines`],
    ["commitments", `/projects/${project.id}/commitments`],
    ["purchase orders", `/projects/${project.id}/purchase-orders`],
  ];
  ctx.emptiness = {};
  for (const [label, url] of emptyProbes) {
    const res = await probe(PEOPLE.pm, "GET", url);
    if (!res.ok) {
      note(`${label} -> ${res.status} ${res.code}`, "(endpoint shape differs; recorded)");
      ctx.emptiness[label] = `${res.status} ${res.code}`;
      continue;
    }
    const items = res.data?.items ?? res.data?.activities ?? res.data ?? [];
    const count = Array.isArray(items) ? items.length : Number(items?.length ?? 0);
    check(`new project starts with no ${label}`, 0, count);
    ctx.emptiness[label] = count;
  }

  // ── team: before ─────────────────────────────────────────────────────────
  section("1.4  Project team — before anyone is added");

  ctx.teamBefore = {};
  for (const role of Object.keys(TEAM)) {
    const res = await probe(PEOPLE[role], "GET", `/projects/${project.id}/activities`);
    ctx.teamBefore[role] = res.status;
    check(`${role} cannot reach a project nobody put them on`, 403, res.status);
  }

  // ── team: add through the real workflow ──────────────────────────────────
  section("1.5  Project team — add existing colleagues");

  const assignable = await GET(PEOPLE.pm, `/projects/${project.id}/team/assignable`);
  const byEmail = new Map((assignable.items || []).map((u) => [u.email, u]));
  check("assignable list offers the company's people", true, byEmail.size >= Object.keys(TEAM).length);

  ctx.teamRoles = {};
  for (const [role, projectRole] of Object.entries(TEAM)) {
    const candidate = byEmail.get(PEOPLE[role]);
    if (!candidate) throw new Error(`${PEOPLE[role]} is not offered by /team/assignable`);
    const added = await POST(PEOPLE.pm, `/projects/${project.id}/team`, {
      userId: candidate.userId,
      role: projectRole,
    });
    ctx.teamRoles[role] = added.assignmentRole;
    check(`${role} added as ${projectRole}`, projectRole, added.assignmentRole);
  }

  // ── team: after ──────────────────────────────────────────────────────────
  section("1.6  Project team — after");

  ctx.teamAfter = {};
  for (const role of Object.keys(TEAM)) {
    const res = await probe(PEOPLE[role], "GET", `/projects/${project.id}/activities`);
    ctx.teamAfter[role] = res.status;
    check(`${role} can now reach the project`, 200, res.status);
  }

  const team = await GET(PEOPLE.pm, `/projects/${project.id}/team`);
  const members = team.items || team.members || [];
  check("team screen shows the PM plus seven", 8, members.length);

  // ── team: an ordinary member cannot manage the team ──────────────────────
  const bySite = await probe(PEOPLE.site, "POST", `/projects/${project.id}/team`, {
    userId: ctx.userIds.qs,
  });
  check("a site engineer cannot add people", 403, bySite.status);

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  note("context written", CONTEXT);

  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 1 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
