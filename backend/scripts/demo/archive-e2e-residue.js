#!/usr/bin/env node
/**
 * Archive automated-test residue out of client-facing views (Phase 22A).
 *
 * The Phase 22 audit found the demo organisation's workspace inflated by
 * records the Playwright suites leave behind: hundreds of projects named
 * "Spine UI mtsrgot5", "Attack A mu0a…", "GREENFIELD REGRESSION MU0A…",
 * inventory items named "Aggregate DUPA …" or auto-numbered "PO-6829dd9e"
 * from goods receipts against test orders, site stores "GR-MTYQU5Y241I",
 * companies "Beta Facades mtyservm", and Riverside purchase orders such as
 * "Awarded cladding mu258mok". None of it is a client's data.
 *
 * What this does — deterministically, by explicit marker, never by guess:
 *   - projects whose name is an e2e fixture name plus a run token → archived
 *   - inventory items that carry an e2e token, belong to a residue project,
 *     or were auto-created by a goods receipt against a residue order → archived
 *   - warehouses that carry a run token or belong to a residue project → archived
 *   - companies a suite or a greenfield run named: referenced by nothing → deleted;
 *     still named by a record → inactive; named on the certified project → untouched
 *   - cost codes a greenfield run created, budgeted on no protected project → archived
 *   - Riverside procurement orders made by a suite: never received → cancelled;
 *     received or partly received → closed (their deliveries and stock stay)
 *
 * What it never touches:
 *   - the certified Phase 21 project (0ce999f2…) and anything on it
 *   - the Riverside Tower fixture project itself, its seeded orders
 *     (PO-0001, PO-0002), and its fixture stores (Central Warehouse,
 *     Riverside Site Store)
 *   - any delivery, stock movement or ledger line — history is never edited
 *   - anything that matches no marker (listed as UNKNOWN for a person)
 *
 * Archiving, deactivating and cancelling are status changes, reversible, and
 * post nothing to the cost ledger; stock balances and transactions stay as
 * history. The script is a dry run unless --apply is given; it prints its
 * classification either way and fails loudly on anything unexpected (a
 * protected id inside a change set).
 *
 *   node scripts/demo/archive-e2e-residue.js            # classify only
 *   node scripts/demo/archive-e2e-residue.js --apply    # archive / cancel / set inactive
 *   node scripts/demo/archive-e2e-residue.js --apply --delete   # also remove residue companies nothing references
 *
 * Durable fix (documented in OCTAPM_PHASE22A_IMPLEMENTATION_REPORT.md): the
 * suites that create records inside the demo organisation should create
 * them in a dedicated e2e organisation, as the isolation suites already do.
 */
const fs = require("fs");
const path = require("path");
const { prisma } = require("../../src/config/db");

const APPLY = process.argv.includes("--apply");
const DELETE = process.argv.includes("--delete"); // remove residue companies nothing references; without it they are set inactive
const CERTIFIED_PROJECT = "0ce999f2-b175-432b-8551-20182b4fc990"; // OCTA PHASE21 GREENFIELD 20260910093852 — certified
const RIVERSIDE = "95c188f3-bd97-4d28-b466-17aa354ee24a"; // the original Riverside Tower fixture — archived in Phase 22B, its history kept
const PROTECTED_PROJECT_IDS = new Set([CERTIFIED_PROJECT, RIVERSIDE]);
// The live demo project is the organisation's active "Riverside Tower", reseeded clean in
// Phase 22B once the suites had their own organisation; it is found by name so a reseed
// never has to edit this file.
const LIVE_DEMO_PROJECT_NAME = "Riverside Tower";
const FIXTURE_WAREHOUSE_PREFIXES = ["c893a7bb", "a2f2b16c"]; // Central Warehouse, Riverside Site Store
const SEEDED_ORDER_REFS = new Set(["PO-0001", "PO-0002"]);

// A Playwright run token is the run's timestamp in base 36 ("mtyr4wck",
// "mu0a1b2c"): eight or more characters from m, then t or u. One carrying a
// digit is a marker on its own, so plain words such as "mutation" or
// "multiple" never match; one without a digit ("mtyservm") counts only beside
// a word the suites themselves use ("Beta Facades mtyservm").
const STRONG_TOKEN = /\bm[tu](?=[a-z0-9]{6,}\b)[a-z0-9]*\d[a-z0-9]*\b/i;
const WEAK_TOKEN = /\bm[tu][a-z0-9]{6,}\b/i;
const SUITE_WORDS = /\b(Beta Facades|Gamma Cladding|Awarded cladding|Spine UI|Attack [AB]|Greenfield|Persona drive|Team drive|Company yard|Smoke test|Permission probe)\b/i;
const RUN_TOKEN = { test: (text) => STRONG_TOKEN.test(text) || (WEAK_TOKEN.test(text) && SUITE_WORDS.test(text)) };
// an order whose item is its own reference was typed by a suite, never by a buyer
const isSelfNamedOrder = (order) => Boolean(order.ref) && order.item === order.ref;
const FIXTURE_PROJECT = new RegExp(
  "^(Spine UI|Greenfield UI|Greenfield bill|Greenfield|BOQ spine|Planning spine|Import spine|Other project|Receipt paths|Delivery spine|Long lead spine|Long lead other|Quote spine|Attack [AB]|Race|Persona drive|Team drive|Team spec|Alpha|Beta|Guard|Perm|Isolation Test) m[tu][a-z0-9]{6,}$",
  "i",
);
const REGRESSION_PROJECT = /^GREENFIELD REGRESSION [A-Z0-9]{9,12}$/;
const PHASE21_ISOLATION = /^OCTA PHASE21 ISOLATION \d{14}$/;
const PHASE21_GREENFIELD = /^OCTA PHASE21 GREENFIELD \d{14}$/; // earlier certification runs — archived unless protected
const ITEM_TOKEN = /(DUPA|\bE2E\b|\bCX\d*\b)/i;
const AUTO_SKU = /^PO-[0-9a-f]{8}$/; // goods-receipt.service numbers an item after its order line when the line has no code
// 21-procurement-lifecycle.spec.ts types its own reference: "PO-" + five base-36 characters, always for this item.
const isSpec21Order = (order) => /^PO-[a-z0-9]{5}$/.test(order.ref || "") && order.item === "Rebar B500B, 16mm";
const isSuiteOrder = (order, line) => RUN_TOKEN.test(orderText(order, line)) || isSpec21Order(order) || isSelfNamedOrder(order);
const orderText = (order, line) => `${order.ref || ""} ${order.item || ""} ${order.supplier || ""} ${line?.description || ""}`;

// ── companies (Phase 22B) ──
// Phase 21 greenfield runs prefix their parties with the run stamp; the suites name
// theirs after a trade plus a token ("Meridian Piling jpt1e", "Adversary mts7vxmy").
const GREENFIELD_RUN_COMPANY = /^P21-\d{14}\s/;
const SUITE_COMPANY = /^(Adversary|Meridian Piling|Alpha Cladding|Beta Facades|Gamma Cladding|Attack Supply|Receipt Supply|Delivery Supply|Switchgear Co|Spine Civils|Planning Civils)\s[a-z0-9]{5,}$/i;
const E2E_COMPANY = /^E2E\s[a-z0-9]{4,}\s/i; // "E2E sz4xvn Concrete" — the isolation suites, before they had their own organisation
const isResidueCompany = (name) => RUN_TOKEN.test(name || "") || GREENFIELD_RUN_COMPANY.test(name || "") || SUITE_COMPANY.test(name || "") || E2E_COMPANY.test(name || "");
const SCALAR_TYPES = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "Decimal", "BigInt", "Bytes"]);
// The Company model's list relations, read from the schema so a relation added later
// is counted before a delete rather than cascaded away by one.
const companyListRelations = () => {
  const schema = fs.readFileSync(path.join(__dirname, "../../prisma/schema.prisma"), "utf8");
  const block = schema.slice(schema.indexOf("model Company {"));
  const body = block.slice(0, block.indexOf("\n}"));
  return body
    .split("\n")
    .map((line) => line.trim().match(/^(\w+)\s+(\w+)\[\]/))
    .filter((match) => match && !SCALAR_TYPES.has(match[2]))
    .map((match) => match[1]);
};
// the companies a project's records name: its parties, and the vendors and client of its commercial records
const companiesOnProject = async (projectId) => {
  const ids = new Set();
  for (const row of await prisma.projectParty.findMany({ where: { projectId }, select: { companyId: true } })) ids.add(row.companyId);
  for (const row of await prisma.commitment.findMany({ where: { projectId }, select: { vendorCompanyId: true } })) if (row.vendorCompanyId) ids.add(row.vendorCompanyId);
  for (const row of await prisma.rfq.findMany({ where: { projectId }, select: { vendorCompanyId: true } })) if (row.vendorCompanyId) ids.add(row.vendorCompanyId);
  for (const row of await prisma.directCost.findMany({ where: { projectId }, select: { vendorCompanyId: true } })) if (row.vendorCompanyId) ids.add(row.vendorCompanyId);
  for (const row of await prisma.primeContract.findMany({ where: { projectId }, select: { clientCompanyId: true } })) if (row.clientCompanyId) ids.add(row.clientCompanyId);
  return ids;
};
const GREENFIELD_COST_CODE = /^GF-[A-Z0-9]{6,}$/i;

const classifyProject = (project) => {
  if (PROTECTED_PROJECT_IDS.has(project.id)) return "CERTIFIED / FIXTURE";
  const name = project.name || "";
  if (FIXTURE_PROJECT.test(name) || REGRESSION_PROJECT.test(name) || PHASE21_ISOLATION.test(name) || PHASE21_GREENFIELD.test(name)) return "TEST RESIDUE";
  return "UNKNOWN";
};

const refuseProtected = (rows, what) => {
  const hit = rows.find((row) => PROTECTED_PROJECT_IDS.has(row.id) || row.projectId === CERTIFIED_PROJECT);
  if (hit) throw new Error(`a protected record is in the ${what} change set (${hit.id}) — refusing`);
};

const main = async () => {
  const orgs = await prisma.organisation.findMany({ select: { id: true, name: true } });
  // the client-facing organisation is the one the certified project belongs to; the
  // dedicated E2E organisation is recreated on every run and is never touched here
  const certified = await prisma.project.findUnique({ where: { id: CERTIFIED_PROJECT }, select: { orgId: true } });
  const demoOrg = certified ? orgs.find((org) => org.id === certified.orgId) : null;
  if (!demoOrg) throw new Error("the certified project's organisation was not found — refusing to guess");
  console.log(`organisation: ${demoOrg.name} (${demoOrg.id}); mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  const liveDemo = await prisma.project.findFirst({ where: { orgId: demoOrg.id, name: LIVE_DEMO_PROJECT_NAME, status: "active" }, select: { id: true } });
  if (liveDemo) PROTECTED_PROJECT_IDS.add(liveDemo.id);
  console.log(`protected: certified ${CERTIFIED_PROJECT.slice(0, 8)}, original fixture ${RIVERSIDE.slice(0, 8)}${liveDemo ? `, live demo ${liveDemo.id.slice(0, 8)}` : ""}`);

  // ── projects ──
  const projects = await prisma.project.findMany({ where: { orgId: demoOrg.id }, select: { id: true, name: true, status: true } });
  const tally = { "CERTIFIED / FIXTURE": 0, "TEST RESIDUE": 0, UNKNOWN: 0 };
  const residueProjectIds = new Set();
  const projectsToArchive = [];
  const unknownProjects = [];
  for (const project of projects) {
    const kind = classifyProject(project);
    tally[kind] += 1;
    if (kind === "TEST RESIDUE") {
      residueProjectIds.add(project.id);
      if (project.status !== "archived") projectsToArchive.push(project);
    }
    if (kind === "UNKNOWN") unknownProjects.push(project);
  }
  console.log(`projects: ${projects.length} — certified/fixture ${tally["CERTIFIED / FIXTURE"]}, test residue ${tally["TEST RESIDUE"]} (${projectsToArchive.length} still active), unknown ${tally.UNKNOWN}`);
  for (const project of unknownProjects) console.log(`  UNKNOWN (left alone): ${project.status.padEnd(8)} ${project.name}`);
  refuseProtected(projectsToArchive, "project");

  // ── inventory items ──
  const items = await prisma.inventoryItem.findMany({ where: { orgId: demoOrg.id, status: "active" }, select: { id: true, name: true, sku: true, projectId: true } });
  const itemsToArchive = [];
  const itemReasons = { token: 0, residueProject: 0, receiptOfResidueOrder: 0 };
  const untraced = [];
  for (const item of items) {
    if (item.projectId === CERTIFIED_PROJECT) continue; // never
    const text = `${item.name} ${item.sku || ""}`;
    if (ITEM_TOKEN.test(text) || RUN_TOKEN.test(text)) {
      itemsToArchive.push(item);
      itemReasons.token += 1;
      continue;
    }
    if (item.projectId && residueProjectIds.has(item.projectId)) {
      itemsToArchive.push(item);
      itemReasons.residueProject += 1;
      continue;
    }
    if (AUTO_SKU.test(item.sku || "")) {
      const line = await prisma.procurementPoLine.findFirst({
        where: { id: { startsWith: item.sku.slice(3) } },
        select: { description: true, order: { select: { ref: true, item: true, supplier: true, projectId: true } } },
      });
      const order = line?.order;
      const residueOrder = order && order.projectId !== CERTIFIED_PROJECT && (isSuiteOrder(order, line) || residueProjectIds.has(order.projectId));
      if (residueOrder) {
        itemsToArchive.push(item);
        itemReasons.receiptOfResidueOrder += 1;
        continue;
      }
      untraced.push(`${item.sku} ${item.name}${order ? ` (order ${order.ref} on ${order.projectId.slice(0, 8)})` : " (no order line)"}`);
    }
  }
  console.log(`inventory items: ${items.length} active — ${itemsToArchive.length} residue (token ${itemReasons.token}, residue project ${itemReasons.residueProject}, receipt of a residue order ${itemReasons.receiptOfResidueOrder}); ${untraced.length} auto-numbered items left alone`);
  for (const line of untraced.slice(0, 20)) console.log(`  UNKNOWN (left alone): ${line}`);
  refuseProtected(itemsToArchive, "inventory item");

  // ── quality records the suites left on the fixture project ──
  // Scheduled inspections and punch items named by a suite ("Scenario inspection
  // 061038", "E2E deep link punch MU0A8F3D") are voided: void is each record's
  // own withdrawn state, the row and its history stay, and the quality
  // dashboard no longer counts them. Only rows that carry a marker; never the
  // certified project.
  const inspections = await prisma.formInstance.findMany({
    where: { projectId: RIVERSIDE, status: { in: ["scheduled", "in_progress"] } },
    select: { id: true, title: true },
  });
  const inspectionsToVoid = inspections.filter((row) => /^Scenario inspection \d+$/.test(row.title || "") || RUN_TOKEN.test(row.title || "") || ITEM_TOKEN.test(row.title || ""));
  const punchItems = await prisma.punchItem.findMany({
    where: { projectId: RIVERSIDE, status: { in: ["draft", "open", "ready_for_review", "in_dispute"] } },
    select: { id: true, title: true },
  });
  const punchToVoid = punchItems.filter((row) => RUN_TOKEN.test(row.title || "") || ITEM_TOKEN.test(row.title || ""));
  console.log(`Riverside open inspections: ${inspections.length} — ${inspectionsToVoid.length} made by a suite; open punch items: ${punchItems.length} — ${punchToVoid.length} made by a suite`);

  // ── warehouses ──
  const warehouses = await prisma.warehouse.findMany({ where: { orgId: demoOrg.id, status: "active" }, select: { id: true, code: true, name: true, projectId: true } });
  const warehousesToArchive = warehouses.filter((warehouse) => {
    if (FIXTURE_WAREHOUSE_PREFIXES.some((prefix) => warehouse.id.startsWith(prefix))) return false;
    if (warehouse.projectId === CERTIFIED_PROJECT) return false;
    return RUN_TOKEN.test(`${warehouse.code} ${warehouse.name}`) || (warehouse.projectId && residueProjectIds.has(warehouse.projectId));
  });
  console.log(`warehouses: ${warehouses.length} active — ${warehousesToArchive.length} carry a run token or serve a residue project`);
  refuseProtected(warehousesToArchive, "warehouse");

  // ── companies (directory) ──
  // A residue company nothing references any more is deleted: no record loses a
  // link, and the directory a client opens stops listing "Adversary mts7vxmy"
  // between real firms. One a record still names is set inactive instead — history
  // keeps its link, pickers stop offering it. A company any record of the certified
  // project names is never touched.
  const companyRelations = companyListRelations();
  const certifiedCompanyIds = await companiesOnProject(CERTIFIED_PROJECT);
  const companies = await prisma.company.findMany({
    where: { orgId: demoOrg.id },
    select: {
      id: true,
      name: true,
      status: true,
      prequalification: { select: { id: true } },
      _count: { select: Object.fromEntries(companyRelations.map((name) => [name, true])) },
    },
  });
  const residueCompanies = companies.filter((company) => isResidueCompany(company.name) && !certifiedCompanyIds.has(company.id));
  const isReferenced = (company) => Boolean(company.prequalification) || companyRelations.some((name) => company._count[name] > 0);
  const unreferenced = residueCompanies.filter((company) => !isReferenced(company));
  const companiesToDelete = DELETE ? unreferenced : [];
  const companiesToDeactivate = residueCompanies.filter((company) => (DELETE ? isReferenced(company) : true) && company.status === "active");
  console.log(
    `companies: ${companies.length} in the directory — ${residueCompanies.length} are test residue: ${unreferenced.length} referenced by nothing (${DELETE ? "deleted" : "set inactive; pass --delete to remove them"}), ${residueCompanies.length - unreferenced.length} still named by a record (set inactive); ${certifiedCompanyIds.size} named on the certified project are left alone`,
  );

  // ── cost codes ──
  // a greenfield run creates its own code ("GF-MTSFGHYV — Greenfield works"); one no
  // protected project budgets against is archived (its lines keep the link)
  const costCodes = await prisma.costCode.findMany({
    where: { orgId: demoOrg.id, status: "active" },
    select: { id: true, code: true, name: true, budgetLines: { select: { projectId: true } } },
  });
  const costCodesToArchive = costCodes.filter(
    (code) => (GREENFIELD_COST_CODE.test(code.code) || RUN_TOKEN.test(`${code.code} ${code.name}`)) && !code.budgetLines.some((line) => PROTECTED_PROJECT_IDS.has(line.projectId)),
  );
  console.log(`cost codes: ${costCodes.length} active — ${costCodesToArchive.length} made by a greenfield run and budgeted on no protected project`);

  // ── Riverside residue orders (never anything that received) ──
  const orders = await prisma.procurementOrder.findMany({
    where: { projectId: RIVERSIDE, status: { in: ["draft", "planned", "issued", "acknowledged"] } },
    select: { id: true, ref: true, item: true, supplier: true, status: true },
  });
  const ordersToCancel = orders.filter((order) => !SEEDED_ORDER_REFS.has(order.ref) && isSuiteOrder(order));
  console.log(`Riverside open orders: ${orders.length} — ${ordersToCancel.length} made by a suite (draft/planned/issued/acknowledged only)`);

  // Received suite orders keep their deliveries and stock movements, but they crowd the
  // Match tab's 100-order window (promised date, then reference) until the seeded orders
  // fall out of it. Closing them is the order's own terminal state; nothing is deleted.
  const receivedOrders = await prisma.procurementOrder.findMany({
    where: { projectId: RIVERSIDE, status: { in: ["received", "partial"] } },
    select: { id: true, ref: true, item: true, supplier: true, status: true },
  });
  const ordersToClose = receivedOrders.filter((order) => !SEEDED_ORDER_REFS.has(order.ref) && isSuiteOrder(order));
  console.log(`Riverside received/partial orders: ${receivedOrders.length} — ${ordersToClose.length} made by a suite (closed, deliveries kept)`);

  const nothing = !projectsToArchive.length && !itemsToArchive.length && !warehousesToArchive.length && !companiesToDeactivate.length && !companiesToDelete.length && !costCodesToArchive.length && !ordersToCancel.length && !ordersToClose.length && !inspectionsToVoid.length && !punchToVoid.length;
  if (nothing) {
    console.log("nothing to do");
    await prisma.$disconnect();
    return;
  }
  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to make the changes listed above.");
    await prisma.$disconnect();
    return;
  }

  const stamp = new Date();
  const archivedProjects = await prisma.project.updateMany({ where: { id: { in: projectsToArchive.map((row) => row.id) } }, data: { status: "archived", archivedAt: stamp } });
  // projects archived by status alone (earlier passes) stay out of the portfolio and workspace scope too
  const stamped = await prisma.project.updateMany({ where: { orgId: demoOrg.id, status: "archived", archivedAt: null }, data: { archivedAt: stamp } });
  if (stamped.count) console.log(`stamped archivedAt on ${stamped.count} project(s) archived by status alone`);
  const archivedItems = await prisma.inventoryItem.updateMany({ where: { id: { in: itemsToArchive.map((row) => row.id) } }, data: { status: "archived" } });
  const archivedWarehouses = await prisma.warehouse.updateMany({ where: { id: { in: warehousesToArchive.map((row) => row.id) } }, data: { status: "archived", archivedAt: stamp } });
  const inactiveCompanies = await prisma.company.updateMany({ where: { id: { in: companiesToDeactivate.map((row) => row.id) } }, data: { status: "inactive" } });
  let deletedCompanies = 0;
  for (const company of companiesToDelete) {
    try {
      await prisma.company.delete({ where: { id: company.id } });
      deletedCompanies += 1;
    } catch (error) {
      if (error.code !== "P2003") throw error; // something names it after all: keep it, inactive
      await prisma.company.update({ where: { id: company.id }, data: { status: "inactive" } });
    }
  }
  const archivedCostCodes = await prisma.costCode.updateMany({ where: { id: { in: costCodesToArchive.map((row) => row.id) } }, data: { status: "archived" } });
  const cancelled = await prisma.procurementOrder.updateMany({
    where: { id: { in: ordersToCancel.map((row) => row.id) } },
    data: { status: "cancelled", cancelledAt: stamp, cancelReason: "Automated-test residue archived (Phase 22A)" },
  });
  const closed = await prisma.procurementOrder.updateMany({
    where: { id: { in: ordersToClose.map((row) => row.id) } },
    data: { status: "closed", closedAt: stamp },
  });
  const voidedInspections = await prisma.formInstance.updateMany({ where: { id: { in: inspectionsToVoid.map((row) => row.id) } }, data: { status: "void" } });
  const voidedPunch = await prisma.punchItem.updateMany({ where: { id: { in: punchToVoid.map((row) => row.id) } }, data: { status: "void" } });
  console.log(`APPLIED — projects archived ${archivedProjects.count}, items archived ${archivedItems.count}, warehouses archived ${archivedWarehouses.count}, companies set inactive ${inactiveCompanies.count}, companies deleted ${deletedCompanies}, cost codes archived ${archivedCostCodes.count}, Riverside residue orders cancelled ${cancelled.count}, received residue orders closed ${closed.count}, inspections voided ${voidedInspections.count}, punch items voided ${voidedPunch.count}`);
  await prisma.$disconnect();
};

main().catch(async (error) => {
  console.error(`FAILED: ${error.message}`);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
