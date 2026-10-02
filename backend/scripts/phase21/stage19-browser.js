/**
 * Phase 21C · stage 19 — the browser: every persona, and record-level deep links.
 *
 * Drives the real React app headlessly (playwright-core) against the Phase 21
 * project. For each of the eight personas: sign in through the real form,
 * record where they land, what the sidebar offers, what the project's module
 * strip offers, and what one page of their own looks like — with the console
 * and network errors that page produced. A "you can act" (the button is
 * there) is written down separately from "you are responsible" (the product's
 * own waiting-on-you signal).
 *
 * Then, as the PM, every deep link the earlier stages recorded is opened and
 * classified: RECORD OPENED (the record's own reference is on screen),
 * MODULE HOME ONLY (the module rendered, the record did not), or FAILED.
 *
 * Nothing here mutates the project. Output: persona-browser.json.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/Users/mabde29/OneDrive - Louisiana State University/Constech/octapm-main/octapm-main/.claude/worktrees/procore-competitive-benchmark-6bd1b6/node_modules/playwright-core");
const { GET } = require("./harness");

const CONTEXT = process.env.P21_CONTEXT || path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const BASE = "http://localhost:5173";
const PASSWORD = "DemoPassw0rd!";

const PERSONAS = {
  pm: { email: "pm@octapm.demo", label: "Project Manager", page: `/projects/${P}/commercial` },
  planner: { email: "planner@octapm.demo", label: "Planning Engineer", page: `/projects/${P}/schedule` },
  qs: { email: "qs@octapm.demo", label: "Quantity Surveyor", page: `/projects/${P}/commercial/change-orders` },
  cost: { email: "cost@octapm.demo", label: "Cost Controller", page: `/projects/${P}/cost` },
  procurement: { email: "procurement@octapm.demo", label: "Procurement Manager", page: `/projects/${P}/procurement/purchase-orders` },
  warehouse: { email: "warehouse@octapm.demo", label: "Storeman", page: `/inventory` },
  site: { email: "site@octapm.demo", label: "Site Engineer", page: `/projects/${P}/site-reporting` },
  finance: { email: "finance@octapm.demo", label: "Finance", page: `/projects/${P}/commercial/ipc` },
};

// Mirror of backend/src/utils/record-links.js for the types recorded here.
const WORKSPACE = {
  rfi: ["doc-control", "rfi"], submittal: ["doc-control", "submittals"], drawing: ["doc-control", "drawings"], transmittal: ["doc-control", "transmittals"], correspondence: ["doc-control", "correspondence"],
  ncr: ["quality", "ncr"], itp: ["quality", "itp"], defect: ["quality", "defects"], punch_item: ["quality", "defects"], observation: ["quality", "observations"], safety_incident: ["quality", "safety"],
  daily_log: ["site-reporting", null], timesheet: ["site-reporting", null], weather_delay: ["commercial", "weather"],
  change_order: ["commercial", "change-orders"], ipc: ["commercial", "ipc"], commitment: ["commercial", "commitments"], sub_pay_app: ["commercial", "pay-apps"], bid_package: ["commercial", "bids"],
  procurement_order: ["procurement", "purchase-orders"], procurement_package: ["schedule", "longLead"], delivery_receipt: ["schedule", "longLead"], direct_cost: ["cost", "direct-costs"],
  meeting: ["meetings", null], task: null, location: ["locations", null], activity: ["activities", null],
};
const pathFor = (recordType, recordId) => {
  if (recordType === "task") return `/tasks?recordId=${encodeURIComponent(recordId)}`;
  const [mod, child] = WORKSPACE[recordType] || [null, null];
  const base = mod ? `/projects/${P}/${mod}${child ? `/${child}` : ""}` : `/projects/${P}`;
  return `${base}?recordId=${encodeURIComponent(recordId)}&source=${encodeURIComponent(recordType)}`;
};

async function signIn(page, email) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  const emailBox = page.getByPlaceholder("name@example.com");
  await emailBox.waitFor({ state: "visible", timeout: 30_000 });
  await emailBox.click();
  await emailBox.fill(email);
  const pw = page.locator('input[type="password"]').first();
  await pw.click();
  await pw.fill(PASSWORD);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/auth/login") && r.request().method() === "POST", { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  if (response.status() !== 200) throw new Error(`sign-in ${email}: HTTP ${response.status()}`);
  await page.waitForTimeout(2500);
}

async function signOut(page) {
  await page.evaluate(async () => {
    await fetch("http://localhost:5000/api/v1/auth/logout", { method: "POST", credentials: "include" });
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage may be unavailable */ }
  });
}

const bodyText = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();

async function main() {
  const out = { ranAt: new Date().toISOString(), project: { id: P, name: ctx.projectName }, personas: {}, deepLinks: [] };
  const browser = await chromium.launch({ headless: true });

  // ── personas ─────────────────────────────────────────────────────────────
  for (const [key, who] of Object.entries(PERSONAS)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
    page.on("response", (r) => { if (r.status() >= 400 && !/sso\/lookup|favicon/.test(r.url())) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:5000/api/v1", "")}`); });
    const rec = { label: who.label, email: who.email };
    try {
      await signIn(page, who.email);
      rec.landingUrl = page.url().replace(BASE, "");
      const landing = await bodyText(page);
      rec.landingText = landing.slice(0, 220);
      rec.sidebar = await page.locator("nav a, aside a").evaluateAll((els) => [...new Set(els.map((e) => e.textContent.trim()).filter(Boolean))].slice(0, 20));
      // "Waiting on you" / "Needs you" is the product's own responsibility signal.
      rec.responsibilitySignal = (landing.match(/(waiting on you|needs you)[^.]{0,80}/i) || [null])[0];

      // The project's module strip, as this persona sees it.
      await page.goto(`${BASE}/projects/${P}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3500);
      rec.projectTabs = await page.locator("main button, main [role=tab]").evaluateAll((els) => [...new Set(els.map((e) => e.textContent.trim()).filter((t) => t && t.length < 24))].slice(0, 24));
      rec.projectText = (await bodyText(page)).slice(0, 200);

      // One page of their own.
      consoleErrors.length = 0; failedRequests.length = 0;
      await page.goto(`${BASE}${who.page}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      const own = await bodyText(page);
      rec.ownPage = { url: who.page, text: own.slice(0, 260), forbiddenText: /forbidden|no permission|not authori[sz]ed|access denied/i.test(own), consoleErrors: consoleErrors.slice(0, 5), failedRequests: [...new Set(failedRequests)].slice(0, 8) };
      // A control that looks available: primary buttons on the page.
      rec.ownPage.visibleActions = await page.locator("main button:visible").evaluateAll((els) => [...new Set(els.map((e) => e.textContent.trim()).filter((t) => t && t.length > 2 && t.length < 30))].slice(0, 16));

      // Users / Company: shown in the sidebar for everyone; what happens when opened.
      consoleErrors.length = 0; failedRequests.length = 0;
      await page.goto(`${BASE}/users`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const users = await bodyText(page);
      rec.usersPage = { text: users.slice(0, 140), failedRequests: [...new Set(failedRequests)].slice(0, 4) };
      await signOut(page);
    } catch (error) {
      rec.error = String(error && error.message ? error.message : error).slice(0, 300);
    }
    out.personas[key] = rec;
    console.log(`persona ${key.padEnd(12)} land=${rec.landingUrl || "?"} tabs=${(rec.projectTabs || []).length} own=${rec.ownPage ? (rec.ownPage.forbiddenText ? "FORBIDDEN-TEXT" : "ok") : "-"} errors=${rec.ownPage ? rec.ownPage.failedRequests.length : "-"} ${rec.error ? "ERROR " + rec.error : ""}`);
    await context.close();
  }

  // ── deep links, as the PM ────────────────────────────────────────────────
  const links = { ...(ctx.deepLinks || {}) };
  links.change_order = { recordType: "change_order", recordId: ctx.changeOrderId, ref: null };
  links.procurement_order = { recordType: "procurement_order", recordId: ctx.purchaseOrders.A, ref: `PO-${ctx.stamp}-A` };
  links.commitment = { recordType: "commitment", recordId: ctx.commitmentId, ref: null };
  links.sub_pay_app = { recordType: "sub_pay_app", recordId: ctx.payAppId, ref: null };
  links.bid_package = { recordType: "bid_package", recordId: ctx.bidPackageId, ref: "BP-001" };
  links.procurement_package = { recordType: "procurement_package", recordId: ctx.rfqPackageId, ref: null };
  links.direct_cost = { recordType: "direct_cost", recordId: ctx.directCostId, ref: null };
  links.timesheet = { recordType: "timesheet", recordId: ctx.timesheetId, ref: null };
  links.location = { recordType: "location", recordId: ctx.locationId, ref: "Foundation zone, grid A-D" };
  // The second ITP: whichever of the two the register lists first, one of them is not the default row.
  if (ctx.quality?.itpIds?.itp2) links.itp2 = { recordType: "itp", recordId: ctx.quality.itpIds.itp2, ref: "ITP-002" };
  // The long-lead item bought under the RFQ package carries the package number; that is the reference to look for.
  try {
    const ll = await GET(ctx.people.pm, `/projects/${P}/long-lead`);
    const items = ll.items || ll.rows || (Array.isArray(ll) ? ll : []);
    const bought = items.find((i) => i.procurementPackage && i.procurementPackage.id === ctx.rfqPackageId);
    if (bought) links.procurement_package.ref = bought.procurementPackage.packageNumber || bought.item || null;
  } catch (e) { links.procurement_package.refError = `${e.status} ${e.code}`; }
  // Fill in the references the product gave these records.
  const fill = async (key, path_, pick) => { try { const d = await GET(ctx.people.pm, path_); links[key].ref = pick(d) || links[key].ref; } catch (e) { links[key].refError = `${e.status} ${e.code}`; } };
  await fill("change_order", `/projects/${P}/change-orders?limit=100`, (d) => (d.orders || []).find((o) => o.id === ctx.changeOrderId)?.ref);
  await fill("commitment", `/projects/${P}/commitments/${ctx.commitmentId}`, (d) => d.ref || d.number);
  await fill("sub_pay_app", `/projects/${P}/pay-apps/${ctx.payAppId}`, (d) => d.ref || d.number);
  await fill("procurement_package", `/projects/${P}/procurement/packages/${ctx.rfqPackageId}`, (d) => d.ref || d.number || d.name);
  await fill("direct_cost", `/projects/${P}/direct-costs/${ctx.directCostId}`, (d) => d.ref);
  await fill("timesheet", `/projects/${P}/timesheets/${ctx.timesheetId}`, (d) => d.ref || d.number || String(d.date || "").slice(0, 10));
  const ipc = await GET(ctx.people.pm, `/projects/${P}/ipc`).catch((e) => ({ error: `${e.status} ${e.code}` }));
  const period = (ipc.periods || ipc.items || ipc.rows || (Array.isArray(ipc) ? ipc : []))[0];
  if (period) links.ipc = { recordType: "ipc", recordId: period.id, ref: period.ref || period.number || period.periodNumber || null };
  // A weather delay has no reference number; its description is what the register shows.
  if (links.weather_delay?.recordId) { try { const wds = await GET(ctx.people.pm, `/projects/${P}/weather-delays`); const wd = (wds.rows || wds.items || wds).find((d) => d.id === links.weather_delay.recordId); if (wd) links.weather_delay.ref = wd.description; } catch (e) { links.weather_delay.refError = `${e.status} ${e.code}`; } }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, PERSONAS.pm.email);
  for (const [key, link] of Object.entries(links)) {
    if (!link.recordId) { out.deepLinks.push({ key, verdict: "NO ID", link }); continue; }
    const url = pathFor(link.recordType, link.recordId);
    const failed = [];
    const onResponse = (r) => { if (r.status() >= 400 && !/sso\/lookup|favicon/.test(r.url())) failed.push(`${r.status()} ${r.url().replace("http://localhost:5000/api/v1", "")}`); };
    page.on("response", onResponse);
    let verdict, evidence = "";
    try {
      await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4500);
      const text = await bodyText(page);
      const dialog = await page.locator("[role=dialog], [data-state=open][role=dialog], aside[data-state=open]").count();
      const refOnScreen = link.ref ? text.includes(String(link.ref)) : false;
      const refInDialog = link.ref && dialog ? (await page.locator("[role=dialog]").first().innerText().catch(() => "")).includes(String(link.ref)) : false;
      // A register may open the record inline: the deep-linked row is selected and expanded (P21-011 fix).
      const selectedRow = page.locator('[data-selected="true"]').first();
      const rowCount = await page.locator("[data-selected]").count();
      // A register selects its first row by default; a selected sole row proves nothing about the link.
      const refInSelectedRow = link.ref && rowCount > 1 && (await selectedRow.count()) ? (await selectedRow.innerText().catch(() => "")).includes(String(link.ref)) : false;
      const soleRowSelected = link.ref && rowCount === 1 && (await selectedRow.count()) ? (await selectedRow.innerText().catch(() => "")).includes(String(link.ref)) : false;
      const moduleRendered = !/not found|404|something went wrong/i.test(text.slice(0, 400)) && text.length > 200;
      // Shapes that are not a list row: the daily log opens a day, the IPC workbook a period,
      // the change-order register narrows to the named order and selects it.
      const dayOpen = link.recordType === "daily_log" && (await page.locator('input[type="date"]').first().inputValue().catch(() => "")) === String(link.recordId);
      const periodOpen = link.recordType === "ipc" && (await page.getByTestId("uat-ipc-period-select").getAttribute("data-period-id").catch(() => null)) === String(link.recordId);
      const narrowed = link.recordType === "change_order" && /Showing the selected dashboard record/.test(text) && soleRowSelected;
      if (refInDialog || (refOnScreen && dialog) || refInSelectedRow) verdict = refInSelectedRow && !dialog ? "RECORD OPENED (inline, selected row)" : "RECORD OPENED";
      else if (dayOpen) verdict = "RECORD OPENED (the day is open)";
      else if (periodOpen) verdict = "RECORD OPENED (the period is shown)";
      else if (narrowed) verdict = "RECORD OPENED (register narrowed to it, selected)";
      else if (soleRowSelected) verdict = "RECORD ON SCREEN (sole row, selected by default)";
      else if (refOnScreen) verdict = "RECORD ON SCREEN (list row, no detail opened)";
      else if (moduleRendered) verdict = "MODULE HOME ONLY";
      else verdict = "FAILED";
      evidence = `${dialog ? "dialog" : "no dialog"}${refInSelectedRow ? "; selected row" : ""}; ref ${link.ref ? (refOnScreen ? "visible" : "NOT visible") : "unknown"}; ${text.slice(0, 90)}`;
    } catch (error) {
      verdict = "FAILED";
      evidence = String(error.message).slice(0, 160);
    }
    page.off("response", onResponse);
    out.deepLinks.push({ key, recordType: link.recordType, recordId: link.recordId, ref: link.ref, url, verdict, evidence, failedRequests: [...new Set(failed)].slice(0, 4) });
    console.log(`deep link ${key.padEnd(18)} ${verdict.padEnd(44)} ${link.ref ?? "-"}`);
  }
  await context.close();
  await browser.close();
  fs.writeFileSync(path.join(__dirname, "persona-browser.json"), JSON.stringify(out, null, 2));
  console.log(`\nwritten persona-browser.json — ${Object.keys(out.personas).length} personas, ${out.deepLinks.length} deep links`);
}

main().catch((error) => { console.error("STAGE 19 ABORTED", error); process.exit(2); });
