/**
 * Phase 21 · stage 7 — adversarial drive.
 *
 * Three separate questions, attacked at the API rather than inferred from
 * which buttons a screen renders:
 *
 *   tenant isolation    someone from another organisation, against this project
 *   project isolation   someone on THIS project, using another project's ids
 *   RBAC                the wrong role, against real approval actions
 *
 * Runs last on purpose: an authorisation probe that succeeds writes a real
 * record, and stage 4 and 5 have financial figures that must not move.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, probe, check, note, section, summary, readLedger } = require("./harness");

const CONTEXT = path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, qs, cost, finance, procurement, warehouse, site, planner } = ctx.people;

/** A user in a different organisation entirely. */
const OUTSIDER = process.env.P21_OUTSIDER || "owner@buildright.test";

/**
 * A genuinely separate tenant, registered through the product's own sign-up so
 * its password is known.
 *
 * Borrowing a seeded user from another organisation does not work: their
 * password is not the demo one, so every call comes back 401
 * INVALID_CREDENTIALS — which proves nothing about tenant isolation and, on
 * the first attempt at this stage, looked exactly like a leak because 401 is
 * neither of the statuses a tenant boundary returns.
 */
async function findOutsider() {
  const email = `outsider-${ctx.stamp}@rival.test`;
  const res = await fetch("http://127.0.0.1:5000/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      orgName: `Rival Contracting ${ctx.stamp}`,
      name: "Rival Site Director",
      email,
      password: "DemoPassw0rd!",
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    // Re-running the stage finds the tenant already registered; that is fine,
    // its password is the one this run set.
    if (body?.error?.code === "EMAIL_ALREADY_EXISTS") {
      note("outsider tenant already registered, reusing", email);
      return { email, orgId: "(existing)", name: "Rival Site Director" };
    }
    throw new Error(`could not register the outsider tenant: ${res.status} ${JSON.stringify(body.error)}`);
  }
  const orgId = body.data?.user?.orgId ?? body.data?.organisation?.id ?? "(new)";
  return { email, orgId, name: "Rival Site Director" };
}

async function main() {
  section("PHASE 21 · STAGE 7 — tenant isolation, project isolation, RBAC");

  const ledgerAtStart = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  note("ledger before the adversarial drive", ledgerAtStart.ledgerCents);

  // ── 7.1 tenant isolation ─────────────────────────────────────────────────
  section("7.1  Another organisation, against this project");

  const outsider = await findOutsider();
  if (!outsider) throw new Error("no user outside this organisation to attack with");
  note("outsider", `${outsider.email} (org ${outsider.orgId})`);
  ctx.outsider = outsider.email;

  const tenantTargets = [
    ["read the project", "GET", `/projects/${P}`],
    ["read its activities", "GET", `/projects/${P}/activities`],
    ["read its BOQ", "GET", `/projects/${P}/boq`],
    ["read its budget", "GET", `/projects/${P}/budget/lines`],
    ["read its cost reconciliation", "GET", `/projects/${P}/cost/reconciliation`],
    ["read its purchase orders", "GET", `/projects/${P}/purchase-orders`],
    ["read its commitments", "GET", `/projects/${P}/commitments`],
    ["read its pay apps", "GET", `/projects/${P}/pay-apps`],
    ["read its team", "GET", `/projects/${P}/team`],
    ["read its documents", "GET", `/projects/${P}/documents`],
    ["update the project", "PATCH", `/projects/${P}`, { name: "OWNED" }],
    ["add themselves to the team", "POST", `/projects/${P}/team`, { userId: ctx.userIds.pm }],
    ["archive the project", "DELETE", `/projects/${P}`],
  ];

  ctx.tenantAttacks = {};
  let leaks = 0;
  for (const [label, method, url, payload] of tenantTargets) {
    const res = await probe(outsider.email, method, url, payload);
    ctx.tenantAttacks[label] = `${res.status} ${res.code ?? "OK"}`;
    // 403 (denied), 404 (nondisclosure) and 402 are all refusals. A brand new
    // organisation is on a trial with no allowance, so its writes are stopped
    // by the subscription gate before the project-access check is reached —
    // a different layer saying no, which 7.1b proves discloses nothing.
    // Anything 2xx is a leak; a 401 means the attack never authenticated and
    // proved nothing, so it is called out rather than counted as a pass.
    const refused = res.status === 403 || res.status === 404 || res.status === 402;
    if (res.status === 401) {
      throw new Error(`the outsider never authenticated (401 ${res.code}) — this attack proves nothing`);
    }
    if (!refused) leaks += 1;
    check(`outsider cannot ${label}`, true, refused);
    if (!refused) note(`  LEAK: ${label}`, `${res.status} ${JSON.stringify(res.data ?? null).slice(0, 160)}`);
  }
  check("no cross-tenant leak at all", 0, leaks);

  // The project is still here and still called what it was called.
  const stillThere = await GET(pm, `/projects/${P}`);
  check("the project survived the attack unchanged", ctx.projectName, stillThere.name);

  // ── 7.1b the refusal must not say whether the target exists ──────────────
  section("7.1b  The refusal tells the outsider nothing about what exists");

  const FAKE = "00000000-0000-4000-8000-0000000000ff";
  const compare = async (method, suffix, payload) => {
    const real = await probe(outsider.email, method, `/projects/${P}${suffix}`, payload);
    const fake = await probe(outsider.email, method, `/projects/${FAKE}${suffix}`, payload);
    return { real: `${real.status} ${real.code}`, fake: `${fake.status} ${fake.code}` };
  };

  for (const [label, method, suffix, payload] of [
    ["reading a project", "GET", ""],
    ["renaming a project", "PATCH", "", { name: "OWNED" }],
    ["adding a team member", "POST", "/team", { userId: ctx.userIds.pm }],
    ["archiving a project", "DELETE", ""],
  ]) {
    const { real, fake } = await compare(method, suffix, payload);
    check(`${label}: a real project answers exactly like one that does not exist`, fake, real);
    note(`  ${label}`, `real=${real}  nonexistent=${fake}`);
  }

  // ── 7.2 project isolation, inside the same organisation ──────────────────
  section("7.2  A second project in the same organisation — ids must not cross");

  const other = await POST(pm, "/projects", {
    name: `OCTA PHASE21 ISOLATION ${ctx.stamp}`,
    startDate: "2027-01-04",
    endDate: "2027-12-17",
    currency: "USD",
    contractValue: 100_000,
    status: "active",
  });
  ctx.isolationProjectId = other.id;
  note("second project", other.id);

  const crossTargets = [
    [
      "allocate our BOQ row to the other project's schedule",
      "POST",
      `/projects/${other.id}/activity-boq-allocations`,
      { boqItemId: ctx.boq["B-001"], activityId: ctx.activities.A110, quantity: 1, amount: 12 },
    ],
    [
      "raise a pay app there against our subcontract",
      "POST",
      `/projects/${other.id}/pay-apps`,
      { commitmentId: ctx.commitmentId, periodLabel: "stolen", periodStart: "2027-03-01", periodEnd: "2027-03-31" },
    ],
    [
      "read our commitment through the other project",
      "GET",
      `/projects/${other.id}/commitments/${ctx.commitmentId}`,
    ],
    [
      "read our pay app through the other project",
      "GET",
      `/projects/${other.id}/pay-apps/${ctx.payAppId}`,
    ],
    [
      "read our purchase order through the other project",
      "GET",
      `/projects/${other.id}/purchase-orders/${ctx.purchaseOrders.A}`,
    ],
    [
      "budget a line there against our cost code and our activity",
      "POST",
      `/projects/${other.id}/budget/lines`,
      { costCodeId: ctx.costCodes["02-100"], costType: "material", description: "cross", originalBudget: 1 },
    ],
  ];

  ctx.projectAttacks = {};
  let crossed = 0;
  for (const [label, method, url, payload] of crossTargets) {
    const res = await probe(pm, method, url, payload);
    ctx.projectAttacks[label] = `${res.status} ${res.code ?? "OK"}`;
    const refused = res.status >= 400;
    // The budget line is legitimate: a cost code belongs to the organisation,
    // not to one project. It is listed to show which of these is which.
    const expectedRefusal = !label.startsWith("budget a line");
    if (expectedRefusal) {
      if (!refused) crossed += 1;
      check(`refused: ${label}`, true, refused);
    } else {
      note(`  allowed (org-level master data, not a leak): ${label}`, `${res.status}`);
    }
    note(`  ${label}`, `${res.status} ${res.code ?? "OK"}`);
  }
  check("no foreign record was accepted across projects", 0, crossed);

  // ── 7.3 RBAC on real approval actions ────────────────────────────────────
  section("7.3  The wrong role, against real approval actions");

  const rbac = [
    ["a storeman approving a purchase order", warehouse, "POST", `/projects/${P}/purchase-orders/${ctx.purchaseOrders.A}/approve`, 403],
    ["a site engineer approving a purchase order", site, "POST", `/projects/${P}/purchase-orders/${ctx.purchaseOrders.A}/approve`, 403],
    ["finance approving a purchase order", finance, "POST", `/projects/${P}/purchase-orders/${ctx.purchaseOrders.A}/approve`, 403],
    ["a planner executing a subcontract", planner, "POST", `/projects/${P}/commitments/${ctx.commitmentId}/execute`, 403],
    ["a storeman approving a pay app", warehouse, "POST", `/projects/${P}/pay-apps/${ctx.payAppId}/approve`, 403],
    ["a site engineer changing the team", site, "POST", `/projects/${P}/team`, 403],
    ["a storeman writing a budget line", warehouse, "POST", `/projects/${P}/budget/lines`, 403],
  ];

  ctx.rbac = {};
  for (const [label, who, method, url, expected] of rbac) {
    const payload = method === "POST" && url.endsWith("/team") ? { userId: ctx.userIds.qs } : {};
    const res = await probe(who, method, url, payload);
    ctx.rbac[label] = `${res.status} ${res.code ?? "OK"}`;
    check(`${label} -> refused`, expected, res.status);
  }

  // Who IS allowed: the storeman may issue stock, which is his job.
  const storemanIssue = await probe(warehouse, "POST", "/inventory/stock/issue", {
    itemId: ctx.itemId,
    warehouseId: ctx.warehouseId,
    locationId: ctx.binId,
    quantity: 1,
    projectId: P,
    activityId: ctx.activities.A130,
    costCodeId: ctx.costCodes["02-100"],
    reference: `${ctx.tag}-RBAC-PROBE`,
  });
  check("the storeman may issue stock — that is his job", 200, storemanIssue.status);

  // The site engineer can too; recorded rather than asserted, because whether
  // a site engineer should draw stock is a business decision, not a bug.
  const siteIssue = await probe(site, "POST", "/inventory/stock/issue", {
    itemId: ctx.itemId,
    warehouseId: ctx.warehouseId,
    locationId: ctx.binId,
    quantity: 1,
    projectId: P,
    activityId: ctx.activities.A130,
    costCodeId: ctx.costCodes["02-100"],
    reference: `${ctx.tag}-RBAC-PROBE-2`,
  });
  note("site engineer issuing stock", `${siteIssue.status} ${siteIssue.code ?? "allowed"}`);
  ctx.siteIssueStatus = siteIssue.status;

  // ── 7.4 the probes are accounted for, not hidden ─────────────────────────
  section("7.4  What the probes themselves cost");

  const ledgerAfter = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  const probeCost = ledgerAfter.ledgerCents - ledgerAtStart.ledgerCents;
  const issuedBags = (storemanIssue.status === 200 ? 1 : 0) + (siteIssue.status === 200 ? 1 : 0);
  note("bags issued by the RBAC probes", issuedBags);
  check("the probes moved the ledger by exactly what they issued", issuedBags * 1100, probeCost);
  ctx.financials.rbacProbeCents = probeCost;
  // The probes' bags go back: the stage leaves the ledger where it found it,
  // so a re-run never moves the certified figures. Phase 21D found the bags
  // of a second run on the certified project (register T-14).
  let ledgerRestored = ledgerAfter;
  if (issuedBags > 0) {
    const giveBack = await probe(warehouse, "POST", "/inventory/stock/return", {
      itemId: ctx.itemId, warehouseId: ctx.warehouseId, locationId: ctx.binId, quantity: issuedBags, projectId: P,
      activityId: ctx.activities.A130, costCodeId: ctx.costCodes["02-100"],
      reference: `${ctx.tag}-RBAC-PROBE-RETURN`, notes: "the RBAC probes' bags, returned so the stage leaves the ledger where it found it",
    });
    check("the probes' bags are returned", 200, giveBack.status);
    ledgerRestored = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
    check("the probes leave the ledger where they found it", ledgerAtStart.ledgerCents, ledgerRestored.ledgerCents);
  }
  ctx.financials.finalLedger = ledgerRestored;

  // ── 7.5 give the isolation project back ──────────────────────────────────
  const archived = await probe(pm, "DELETE", `/projects/${ctx.isolationProjectId}`);
  if (!archived.ok) {
    throw new Error(
      `CLEANUP FAILED: could not archive the isolation project ${ctx.isolationProjectId}: ${archived.status} ${archived.code}`,
    );
  }
  note("isolation project archived", ctx.isolationProjectId);

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 7 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
