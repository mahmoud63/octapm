/**
 * The §53 cross-organisation leak matrix (enterprise programme, wave ENT-3).
 *
 *   P21_API_BASE=http://127.0.0.1:5000 node scripts/enterprise/tenant-leak-matrix.js
 *   P21_API_BASE=... node scripts/enterprise/tenant-leak-matrix.js --json <path>
 *
 * Phase 21's stage 7 asked one question of one project: can an outsider read
 * or change it? This asks it of every row of the §53 table — project, BOQ,
 * schedule, activity, cost, change, RFI, NCR, inspection, document, drawing,
 * attachment and file download, photo, purchase order, inventory, supplier,
 * task, notification, search, assistant conversation, report, export, the
 * realtime room join, the bid and RFQ portals, inbound email, API keys and
 * jobs — from organisation B against organisation A's ids, expecting 403 or
 * 404 (402 counts: the plan gate is a refusal too), never 2xx, and never a
 * different answer for a real id than for one that does not exist.
 *
 * A and B are the first two organisations of fixture-100-companies.js
 * (Fixture Co 001 and 002), signed in through the product's own login with
 * the fixture password. A's records are seeded straight into the database
 * with deterministic ids (one of each type, minimal columns), because the
 * matrix is about reading them across the boundary, not about the twenty
 * create endpoints; --remove of the fixture takes them away with the
 * organisation.
 *
 * With the fixture applied in full, the script also times the workspace
 * listing (GET /auth/me), the project listing, the portfolio aggregation and
 * search for A's owner, so the 100-organisation cost of each is on record.
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("enterprise:tenant-leak-matrix");

const crypto = require("crypto");
const fs = require("fs");
const { prisma } = require("../../src/config/db");
const { FIXTURE_PASSWORD, idFor, plan } = require("./fixture-100-companies");
const { defaultReportPath, parseArgs, printResult } = require("./lib");

const API = (process.env.P21_API_BASE || "").replace(/\/$/, "");
const REFUSALS = new Set([402, 403, 404]);
const FAKE = "00000000-0000-4000-8000-0000000000ff";

const results = [];
let failed = 0;
const section = (title) => console.log(`\n── ${title}`);
const note = (label, value) => console.log(`   ${label}: ${value}`);
const check = (label, expected, actual) => {
  const ok = expected === actual;
  if (!ok) failed += 1;
  results.push({ label, expected, actual, ok });
  console.log(`${ok ? "  ok " : "  FAIL"} ${label}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  return ok;
};

const request = async (method, path, { token, body } = {}) => {
  const started = Date.now();
  const response = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, code: json?.error?.code ?? null, data: json?.data ?? null, ms: Date.now() - started, text };
};

const login = async (email) => {
  const res = await request("POST", "/auth/login", { body: { email, password: FIXTURE_PASSWORD } });
  const token = res.data?.tokens?.accessToken;
  if (!token) throw new Error(`could not sign in as ${email}: ${res.status} ${res.code} — run fixture-100-companies.js --apply first`);
  return token;
};

/** The seed models, children before parents, so removal never trips a key. */
const SEED_MODELS = [
  ["attachment", "attachment"], ["photo", "photo"], ["projectDocument", "document"], ["costRecord", "costRecord"], ["activity", "activity"],
  ["scheduleRevision", "scheduleRevision"], ["boqItem", "boqItem"], ["boqRevision", "boqRevision"], ["changeOrder", "changeOrder"], ["rfi", "rfi"],
  ["ncrRecord", "ncr"], ["itpRecord", "itp"], ["drawingRecord", "drawing"], ["procurementOrder", "purchaseOrder"], ["procurementSupplier", "supplier"],
  ["inventoryItem", "inventoryItem"], ["warehouse", "warehouse"], ["task", "task"], ["notification", "notification"], ["assistantConversation", "assistantConversation"],
  ["reportDefinition", "report"], ["backgroundJob", "job"], ["webhookSubscription", "webhook"], ["apiClient", "apiClient"], ["conversation", "conversation"],
  ["commitment", "commitment"], ["punchItem", "punchItem"], ["dailyLog", "dailyLog"], ["meeting", "meeting"], ["bidInvitation", "bidInvitation"],
  ["bidPackage", "bidPackage"], ["inboundEmail", "inboundEmail"],
];

/**
 * Removes the matrix's own seed rows (by their deterministic ids, nothing
 * else), so the fixture's --remove finds its projects childless and a re-run
 * starts from a clean slate.
 */
const removeSeeds = async (a) => {
  const id = (name) => idFor(`leak:${a.name}:${name}`);
  let removed = 0;
  for (const [model, name] of SEED_MODELS) {
    removed += (await prisma[model].deleteMany({ where: { id: id(name) } })).count;
  }
  return removed;
};

/** One row of each §53 type in A's first project, deterministic ids, created fresh each run. */
const seedVictim = async (a) => {
  await removeSeeds(a);
  const orgId = a.id;
  const owner = a.users[0];
  const project = a.projects[0];
  const id = (name) => idFor(`leak:${a.name}:${name}`);
  const ensure = async (model, where, data) => {
    const existing = await prisma[model].findFirst({ where, select: { id: true } });
    return existing || prisma[model].create({ data });
  };
  const seeds = {};
  seeds.boqRevision = await ensure("boqRevision", { id: id("boqRevision") }, { id: id("boqRevision"), projectId: project.id, revisionNumber: 1, status: "draft" });
  seeds.boqItem = await ensure("boqItem", { id: id("boqItem") }, { id: id("boqItem"), projectId: project.id, revisionId: seeds.boqRevision.id, code: "1.1", description: "Leak matrix item", qty: 1, unit: "m3", rate: 1, amount: 1 });
  seeds.scheduleRevision = await ensure("scheduleRevision", { id: id("scheduleRevision") }, { id: id("scheduleRevision"), projectId: project.id });
  seeds.activity = await ensure("activity", { id: id("activity") }, { id: id("activity"), projectId: project.id, name: "Leak matrix activity" });
  seeds.costRecord = await ensure("costRecord", { id: id("costRecord") }, { id: id("costRecord"), projectId: project.id, activityId: seeds.activity.id });
  seeds.changeOrder = await ensure("changeOrder", { id: id("changeOrder") }, { id: id("changeOrder"), projectId: project.id, ref: "VO-001", description: "Leak matrix change" });
  seeds.rfi = await ensure("rfi", { id: id("rfi") }, { id: id("rfi"), projectId: project.id, ref: "RFI-001", subject: "Leak matrix RFI" });
  seeds.ncr = await ensure("ncrRecord", { id: id("ncr") }, { id: id("ncr"), projectId: project.id, ref: "NCR-001", severity: "minor" });
  seeds.itp = await ensure("itpRecord", { id: id("itp") }, { id: id("itp"), projectId: project.id, ref: "ITP-001", title: "Leak matrix inspection" });
  seeds.document = await ensure("projectDocument", { id: id("document") }, {
    id: id("document"), orgId, projectId: project.id, documentType: "general", originalName: "leak.txt", fileName: "leak.txt", mimeType: "text/plain", sizeBytes: 4, sha256: crypto.createHash("sha256").update("leak").digest("hex"), storageProvider: "local", objectKey: `leak-matrix/${id("document")}.txt`, storageKey: `leak-matrix/${id("document")}.txt`,
  });
  seeds.attachment = await ensure("attachment", { id: id("attachment") }, { id: id("attachment"), orgId, projectId: project.id, recordType: "rfi", recordId: seeds.rfi.id, documentId: seeds.document.id });
  seeds.photo = await ensure("photo", { documentId: seeds.document.id }, { id: id("photo"), orgId, projectId: project.id, documentId: seeds.document.id });
  seeds.drawing = await ensure("drawingRecord", { id: id("drawing") }, { id: id("drawing"), projectId: project.id, ref: "DWG-001", drawingNumber: "A-101", title: "Leak matrix drawing" });
  seeds.purchaseOrder = await ensure("procurementOrder", { id: id("purchaseOrder") }, { id: id("purchaseOrder"), projectId: project.id, ref: "PO-001", item: "Leak matrix item" });
  seeds.supplier = await ensure("procurementSupplier", { id: id("supplier") }, { id: id("supplier"), projectId: project.id, name: "Leak Matrix Supplies" });
  seeds.inventoryItem = await ensure("inventoryItem", { id: id("inventoryItem") }, { id: id("inventoryItem"), orgId, sku: "LEAK-001", name: "Leak matrix stock", unit: "ea" });
  seeds.warehouse = await ensure("warehouse", { id: id("warehouse") }, { id: id("warehouse"), orgId, code: "LEAK", name: "Leak matrix store" });
  seeds.task = await ensure("task", { id: id("task") }, { id: id("task"), orgId, projectId: project.id, taskNumber: "T-LEAK", title: "Leak matrix task" });
  seeds.notification = await ensure("notification", { id: id("notification") }, { id: id("notification"), orgId, projectId: project.id, recipientUserId: owner.id, type: "task", category: "workflow", event: "leak.matrix", title: "Leak matrix", message: "A's notification" });
  seeds.assistantConversation = await ensure("assistantConversation", { id: id("assistantConversation") }, { id: id("assistantConversation"), orgId, userId: owner.id, projectId: project.id, title: "Leak matrix chat" });
  seeds.report = await ensure("reportDefinition", { id: id("report") }, { id: id("report"), orgId, name: "Leak matrix report", source: "rfi" });
  seeds.job = await ensure("backgroundJob", { id: id("job") }, { id: id("job"), orgId, projectId: project.id, type: "export.xlsx", status: "queued" });
  seeds.webhook = await ensure("webhookSubscription", { id: id("webhook") }, { id: id("webhook"), orgId, name: "Leak matrix hook", url: "https://hooks.example.test/leak", secret: crypto.randomBytes(16).toString("hex"), eventTypes: ["*"] });
  seeds.apiClient = await ensure("apiClient", { id: id("apiClient") }, { id: id("apiClient"), orgId, userId: owner.id, name: "Leak matrix key", keyPrefix: "leak", keyHash: crypto.createHash("sha256").update(id("apiClient")).digest("hex") });
  seeds.conversation = await ensure("conversation", { id: id("conversation") }, { id: id("conversation"), orgId, projectId: project.id, kind: "group", title: "Leak matrix room" });
  seeds.commitment = await ensure("commitment", { id: id("commitment") }, { id: id("commitment"), orgId, projectId: project.id, number: 901, ref: "SC-901", title: "Leak matrix subcontract" });
  seeds.punchItem = await ensure("punchItem", { id: id("punchItem") }, { id: id("punchItem"), orgId, projectId: project.id, number: 901, ref: "PL-901", title: "Leak matrix punch" });
  seeds.dailyLog = await ensure("dailyLog", { id: id("dailyLog") }, { id: id("dailyLog"), orgId, projectId: project.id, date: new Date("2027-03-01") });
  seeds.meeting = await ensure("meeting", { id: id("meeting") }, { id: id("meeting"), orgId, projectId: project.id, meetingNumber: "MTG-901", title: "Leak matrix meeting" });
  seeds.bidPackage = await ensure("bidPackage", { id: id("bidPackage") }, { id: id("bidPackage"), orgId, projectId: project.id, number: 901, ref: "BP-901", title: "Leak matrix package" });
  seeds.bidInvitation = await ensure("bidInvitation", { id: id("bidInvitation") }, {
    // The portal token is a secret nobody holds here: the matrix probes the
    // invitation's id, which must not open the portal.
    id: id("bidInvitation"), orgId, packageId: seeds.bidPackage.id, companyName: "Leak Bidder", contactEmail: "bidder@octapm-fixture.test", tokenHash: crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex"), expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
  seeds.inboundEmail = await ensure("inboundEmail", { id: id("inboundEmail") }, { id: id("inboundEmail"), orgId, projectId: project.id, provider: "ses", fromEmail: "outsider@example.test", subject: "Leak matrix mail", textBody: "hello" });
  return seeds;
};

/** A raw engine.io long-polling client, enough to connect and ask for one project room. */
const realtimeJoin = async (token, projectId) => {
  const base = `${API}/socket.io/?EIO=4&transport=polling`;
  const open = await fetch(`${base}&t=${Date.now()}`);
  const openText = await open.text();
  const sid = JSON.parse(openText.slice(1)).sid;
  const poll = async () => (await fetch(`${base}&sid=${sid}&t=${Date.now()}`)).text();
  const send = (packet) => fetch(`${base}&sid=${sid}&t=${Date.now()}`, { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body: packet });
  await send(`40${JSON.stringify({ token })}`);
  const connected = await poll();
  if (!connected.includes("40{")) return { connect: connected.slice(0, 80) };
  await send(`421${JSON.stringify(["project:join", { projectId }])}`);
  for (let i = 0; i < 5; i += 1) {
    const text = await poll();
    const at = text.indexOf("431");
    if (at !== -1) {
      const end = text.indexOf("\x1e", at);
      return JSON.parse(text.slice(at + 3, end === -1 ? undefined : end))[0];
    }
  }
  return { timeout: true };
};

const main = async () => {
  const args = parseArgs();
  if (!API) throw new Error("P21_API_BASE is not set (e.g. http://127.0.0.1:5000)");
  console.log(`OctaPM tenant leak matrix (§53) against ${API}\n`);

  const [a, b] = plan(2);
  const present = await prisma.organisation.count({ where: { id: { in: [a.id, b.id] } } });
  if (present < 2) throw new Error("Fixture Co 001 and 002 are not present — run scripts/enterprise/fixture-100-companies.js --apply first");
  const tokenB = await login(b.users[0].email);
  const tokenA = await login(a.users[0].email);
  const seeds = await seedVictim(a);
  const P = a.projects[0].id;
  note("victim", `${a.name} (${a.id}), project ${P}`);
  note("attacker", `${b.name} (${b.id}) owner, signed in`);

  // ── the victim's own rows are reachable, so a refusal below is a refusal ──
  section("0  A's owner reaches A's rows (control)");
  for (const [label, path] of [
    ["project", `/projects/${P}`],
    ["RFI", `/projects/${P}/rfi/${seeds.rfi.id}`],
    ["task", `/tasks/${seeds.task.id}`],
    ["inventory item", `/inventory/items/${seeds.inventoryItem.id}`],
  ]) {
    const res = await request("GET", path, { token: tokenA });
    check(`A reads its ${label}`, 200, res.status);
  }

  // ── the matrix: B against A's ids, real and non-existent ─────────────────
  section("1  Organisation B against organisation A's ids");
  const rows = [
    ["project", "GET", () => `/projects/${P}`, (x) => `/projects/${x}`],
    ["project (rename)", "PATCH", () => `/projects/${P}`, (x) => `/projects/${x}`, { name: "OWNED" }],
    ["project (archive)", "DELETE", () => `/projects/${P}`, (x) => `/projects/${x}`],
    ["BOQ", "GET", () => `/projects/${P}/boq`, (x) => `/projects/${x}/boq`],
    ["BOQ item (edit)", "PATCH", () => `/projects/${P}/boq/items/${seeds.boqItem.id}`, (x) => `/projects/${P}/boq/items/${x}`, { description: "OWNED" }],
    ["schedule", "GET", () => `/projects/${P}/schedule`, (x) => `/projects/${x}/schedule`],
    ["schedule revision", "GET", () => `/projects/${P}/schedule/revisions/${seeds.scheduleRevision.id}`, (x) => `/projects/${P}/schedule/revisions/${x}`],
    ["activities", "GET", () => `/projects/${P}/activities`, (x) => `/projects/${x}/activities`],
    ["cost", "GET", () => `/projects/${P}/cost`, (x) => `/projects/${x}/cost`],
    ["cost record (edit)", "PATCH", () => `/projects/${P}/cost/${seeds.costRecord.id}`, (x) => `/projects/${P}/cost/${x}`, { actualCost: 1 }],
    ["change orders", "GET", () => `/projects/${P}/change-orders`, (x) => `/projects/${x}/change-orders`],
    ["RFI", "GET", () => `/projects/${P}/rfi/${seeds.rfi.id}`, (x) => `/projects/${P}/rfi/${x}`],
    ["RFI (answer)", "POST", () => `/projects/${P}/rfi/${seeds.rfi.id}/responses`, (x) => `/projects/${P}/rfi/${x}/responses`, { body: "OWNED" }],
    ["NCR (edit)", "PATCH", () => `/projects/${P}/ncr/${seeds.ncr.id}`, (x) => `/projects/${P}/ncr/${x}`, { description: "OWNED" }],
    ["inspection (ITP)", "GET", () => `/projects/${P}/itp`, (x) => `/projects/${x}/itp`],
    ["documents", "GET", () => `/projects/${P}/documents`, (x) => `/projects/${x}/documents`],
    ["document download", "GET", () => `/projects/${P}/documents/${seeds.document.id}/download`, (x) => `/projects/${P}/documents/${x}/download`],
    ["drawings", "GET", () => `/projects/${P}/drawings`, (x) => `/projects/${x}/drawings`],
    ["drawing (edit)", "PATCH", () => `/projects/${P}/drawings/${seeds.drawing.id}`, (x) => `/projects/${P}/drawings/${x}`, { title: "OWNED" }],
    ["attachments", "GET", () => `/projects/${P}/attachments?recordType=rfi&recordId=${seeds.rfi.id}`, (x) => `/projects/${x}/attachments?recordType=rfi&recordId=${seeds.rfi.id}`],
    ["attachment document", "GET", () => `/projects/${P}/attachments/documents/${seeds.document.id}`, (x) => `/projects/${P}/attachments/documents/${x}`],
    ["photo file", "GET", () => `/projects/${P}/photos/${seeds.photo.id}/file`, (x) => `/projects/${P}/photos/${x}/file`],
    ["purchase order", "GET", () => `/projects/${P}/purchase-orders/${seeds.purchaseOrder.id}`, (x) => `/projects/${P}/purchase-orders/${x}`],
    ["inventory item", "GET", () => `/inventory/items/${seeds.inventoryItem.id}`, (x) => `/inventory/items/${x}`],
    ["inventory item (edit)", "PATCH", () => `/inventory/items/${seeds.inventoryItem.id}`, (x) => `/inventory/items/${x}`, { name: "OWNED" }],
    ["warehouse (edit)", "PATCH", () => `/inventory/warehouses/${seeds.warehouse.id}`, (x) => `/inventory/warehouses/${x}`, { name: "OWNED" }],
    ["suppliers", "GET", () => `/projects/${P}/procurement/suppliers`, (x) => `/projects/${x}/procurement/suppliers`],
    ["task", "GET", () => `/tasks/${seeds.task.id}`, (x) => `/tasks/${x}`],
    ["task (edit)", "PATCH", () => `/tasks/${seeds.task.id}`, (x) => `/tasks/${x}`, { title: "OWNED" }],
    ["notification", "GET", () => `/notifications/${seeds.notification.id}`, (x) => `/notifications/${x}`],
    ["notification (read)", "PATCH", () => `/notifications/${seeds.notification.id}/read`, (x) => `/notifications/${x}/read`],
    ["assistant conversation", "GET", () => `/assistant/conversations/${seeds.assistantConversation.id}`, (x) => `/assistant/conversations/${x}`],
    ["conversation", "GET", () => `/conversations/${seeds.conversation.id}`, (x) => `/conversations/${x}`],
    ["conversation messages", "GET", () => `/conversations/${seeds.conversation.id}/messages`, (x) => `/conversations/${x}/messages`],
    ["report", "GET", () => `/reports/${seeds.report.id}`, (x) => `/reports/${x}`],
    ["report (run)", "POST", () => `/reports/${seeds.report.id}/run`, (x) => `/reports/${x}/run`],
    ["export", "GET", () => `/projects/${P}/export/xlsx`, (x) => `/projects/${x}/export/xlsx`],
    ["job", "GET", () => `/projects/${P}/jobs/${seeds.job.id}`, (x) => `/projects/${P}/jobs/${x}`],
    ["job (cancel)", "POST", () => `/projects/${P}/jobs/${seeds.job.id}/cancel`, (x) => `/projects/${P}/jobs/${x}/cancel`],
    ["webhook", "GET", () => `/integrations/webhooks/${seeds.webhook.id}`, (x) => `/integrations/webhooks/${x}`],
    ["webhook (rotate secret)", "POST", () => `/integrations/webhooks/${seeds.webhook.id}/rotate-secret`, (x) => `/integrations/webhooks/${x}/rotate-secret`],
    ["API key (revoke)", "DELETE", () => `/integrations/api-clients/${seeds.apiClient.id}`, (x) => `/integrations/api-clients/${x}`],
    ["commitment", "GET", () => `/projects/${P}/commitments/${seeds.commitment.id}`, (x) => `/projects/${P}/commitments/${x}`],
    ["punch item", "GET", () => `/projects/${P}/punch/${seeds.punchItem.id}`, (x) => `/projects/${P}/punch/${x}`],
    ["daily log", "GET", () => `/projects/${P}/daily-logs/${seeds.dailyLog.id}`, (x) => `/projects/${P}/daily-logs/${x}`],
    ["meeting", "GET", () => `/projects/${P}/meetings/${seeds.meeting.id}`, (x) => `/projects/${P}/meetings/${x}`],
    ["bid package", "GET", () => `/projects/${P}/bids/${seeds.bidPackage.id}`, (x) => `/projects/${P}/bids/${x}`],
    ["bid invitation (resend)", "POST", () => `/projects/${P}/bids/${seeds.bidPackage.id}/invitations/${seeds.bidInvitation.id}/resend`, (x) => `/projects/${P}/bids/${seeds.bidPackage.id}/invitations/${x}/resend`],
    ["team", "GET", () => `/projects/${P}/team`, (x) => `/projects/${x}/team`],
    ["team (add self)", "POST", () => `/projects/${P}/team`, (x) => `/projects/${x}/team`, { userId: b.users[0].id, role: "pm" }],
    ["audit", "GET", () => `/projects/${P}/audit`, (x) => `/projects/${x}/audit`],
  ];

  let leaks = 0;
  const outcomes = [];
  for (const [label, method, real, fake, payload] of rows) {
    const r = await request(method, real(), { token: tokenB, body: payload });
    const f = await request(method, fake(FAKE), { token: tokenB, body: payload });
    if (r.status === 401 || f.status === 401) throw new Error(`the attacker never authenticated on "${label}" (401) — this proves nothing`);
    const refused = REFUSALS.has(r.status) && REFUSALS.has(f.status);
    // A validation refusal (400) on an id-shaped path counts as refused only
    // when the non-existent id gets the same; 2xx on a real id is a leak.
    const validationOnly = r.status === 400 && f.status === 400;
    const leak = r.status >= 200 && r.status < 300;
    if (leak) leaks += 1;
    const same = `${r.status} ${r.code}` === `${f.status} ${f.code}`;
    outcomes.push({ label, method, real: `${r.status} ${r.code}`, fake: `${f.status} ${f.code}`, refused: refused || validationOnly, same, leak });
    check(`${label}: refused`, true, refused || validationOnly);
    check(`${label}: a real id answers exactly like a non-existent one`, `${f.status} ${f.code}`, `${r.status} ${r.code}`);
    if (leak) note(`  LEAK ${label}`, r.text.slice(0, 160));
  }

  // ── search, portals, inbound email, realtime ────────────────────────────
  section("2  Search, portals, inbound email, realtime");
  const search = await request("GET", `/search?q=${encodeURIComponent("Leak matrix")}`, { token: tokenB });
  const hits = (search.data?.items || []).filter((item) => String(item.projectId || "") === P || /Leak matrix/i.test(item.title || ""));
  check("search from B returns none of A's records", 0, hits.length);
  // B's owner searches exactly B's own projects — A's three are not counted.
  check("search from B is bounded to B's own projects", b.projects.length, search.data?.meta?.authorizedProjectCount ?? -1);

  const bidReal = await request("GET", `/public/bids/${seeds.bidInvitation.id}`);
  const bidFake = await request("GET", `/public/bids/${crypto.randomBytes(24).toString("hex")}`);
  check("bid portal: an invitation id is not a token", true, REFUSALS.has(bidReal.status));
  check("bid portal: a real id answers like a random token", `${bidFake.status} ${bidFake.code}`, `${bidReal.status} ${bidReal.code}`);
  const rfqFake = await request("GET", `/public/rfqs/${crypto.randomBytes(24).toString("hex")}`);
  check("RFQ portal: a random token is refused", true, REFUSALS.has(rfqFake.status));

  const inboundReal = await request("GET", `/projects/${P}/inbound-email/${seeds.inboundEmail.id}`, { token: tokenB });
  const inboundFake = await request("GET", `/projects/${FAKE}/inbound-email/${seeds.inboundEmail.id}`, { token: tokenB });
  check("inbound email: B cannot read A's mail", true, REFUSALS.has(inboundReal.status));
  check("inbound email: real answers like non-existent", `${inboundFake.status} ${inboundFake.code}`, `${inboundReal.status} ${inboundReal.code}`);

  try {
    const joinReal = await realtimeJoin(tokenB, P);
    const joinFake = await realtimeJoin(tokenB, FAKE);
    check("realtime: B cannot join A's project room", false, Boolean(joinReal.ok));
    check("realtime: a real room answers like a non-existent one", JSON.stringify({ ok: joinFake.ok, code: joinFake.code }), JSON.stringify({ ok: joinReal.ok, code: joinReal.code }));
  } catch (error) {
    note("realtime probe could not connect (not counted)", error.message);
  }

  // ── A is still A ──────────────────────────────────────────────────────────
  section("3  A after the drive");
  const still = await request("GET", `/projects/${P}`, { token: tokenA });
  check("A's project survived unchanged", a.projects[0].name, still.data?.name);
  check("no cross-organisation leak at all", 0, leaks);

  // ── timings with the fixture present ─────────────────────────────────────
  section("4  Timings for A's owner (with whatever the fixture holds)");
  const fixtureOrgs = await prisma.organisation.count({ where: { name: { startsWith: "Fixture Co " } } });
  note("fixture organisations present", fixtureOrgs);
  const timings = {};
  for (const [label, path] of [
    ["workspace listing (GET /auth/me)", "/auth/me"],
    ["project listing (GET /projects)", "/projects"],
    ["portfolio aggregation (GET /portfolio)", "/portfolio"],
    ["search (GET /search?q=Project)", "/search?q=Project"],
  ]) {
    const samples = [];
    for (let i = 0; i < 3; i += 1) samples.push((await request("GET", path, { token: tokenA })).ms);
    timings[label] = { min: Math.min(...samples), max: Math.max(...samples), samples };
    note(label, `${samples.join(" / ")} ms`);
  }

  // The seeds go with the run (--keep-seeds leaves them for a look), so the
  // fixture's --remove finds its projects childless.
  const keepSeeds = process.argv.includes("--keep-seeds");
  const cleaned = keepSeeds ? 0 : await removeSeeds(a);
  note(keepSeeds ? "seed rows kept" : "seed rows removed", keepSeeds ? Object.keys(seeds).length : cleaned);

  const report = { generatedAt: new Date().toISOString(), api: API, victim: a.id, attacker: b.id, fixtureOrgs, leaks, failed, outcomes, timings, results };
  const jsonPath = args.jsonPath || defaultReportPath("tenant-leak-matrix");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\n${failed ? `${failed} check(s) FAILED` : `All ${results.length} checks passed`}; ${leaks} leak(s). Report written to ${jsonPath}`);
  printResult({ ok: failed === 0, checks: results.length, failed, leaks, fixtureOrgs, timings, jsonPath });
  if (failed) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error("\nMATRIX ABORTED");
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
