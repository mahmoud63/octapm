/**
 * Phase 21C · stage 16 — quality on the Phase 21 project.
 *
 *   ITP-01  reinforcement inspection before pour (hold point)   → passed
 *   ITP-02  7-day cube test witness point                       → FAILED
 *   NCR-01  honeycombing on pad F3, MAJOR, raised by the site engineer,
 *           closed out with evidence, approved by the PM
 *   DEF-01  surface crack in blinding, minor, opened → in progress → closed
 *   MT-01   28-day cube test, pending → pass
 *   PL-01   punch item: opened, ready for review, closed by the PM only
 *   OBS-01  safety observation raised by the QS, closed by the PM
 *
 * The quality score is the product's stated rule
 *   100 − 20·majorNCR − 8·minorNCR − 15·failedITP
 * and is read from the quality dashboard before and after, not computed here
 * and trusted. Role boundaries are attacked at every step.
 *
 * Idempotent: every record is found by its deterministic title.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, PATCH, probe, check, note, section, summary, upload } = require("./harness");

const CONTEXT = process.env.P21_CONTEXT || path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, planner, qs, site, warehouse, finance } = ctx.people;
const save = () => fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
const rows = (x) => x?.rows || x?.items || x?.records || (Array.isArray(x) ? x : []);

const T = (k) => `${ctx.tag} ${k}`;
const TITLES = {
  itp1: T("ITP-01 Reinforcement inspection before pour, pads A-D"),
  itp2: T("ITP-02 7-day concrete cube test, pad pour 1"),
  ncr1: T("NCR-01 Honeycombing on pad footing F3, grid B"),
  def1: T("DEF-01 Surface crack in blinding, grid C"),
  mt1: T("MT-01 28-day concrete cube test, pad pour 1"),
  pl1: T("PL-01 Remove formwork debris from pad F2"),
  obs1: T("OBS-01 Unguarded excavation edge at grid A"),
};

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function findByTitle(who, prefix, title) {
  const list = await GET(who, `/projects/${P}/${prefix}?limit=100`);
  return rows(list).find((r) => r.title === title) ?? null;
}

async function score() {
  const d = await GET(qs, `/projects/${P}/quality/dashboard`);
  const m = d.metrics || d;
  return { score: Number(m.qualityScore), major: Number(m.majorNcrs), minor: Number(m.minorNcrs), failedItps: Number(m.failedItps) };
}

async function main() {
  section("PHASE 21C · STAGE 16 — quality");

  const before = await score();
  note("quality before", JSON.stringify(before));
  ctx.quality = ctx.quality || {};
  if (ctx.quality.scoreAtStart === undefined) ctx.quality.scoreAtStart = before.score;

  // ── 16.1 ITPs ─────────────────────────────────────────────────────────────
  section("16.1  Inspection & test plan — one hold point passed, one witness point failed");

  check("a storeman cannot raise an ITP", 403, (await probe(warehouse, "POST", `/projects/${P}/itp`, { title: "x" })).status);
  check("finance cannot raise an ITP", 403, (await probe(finance, "POST", `/projects/${P}/itp`, { title: "x" })).status);

  let itp1 = await findByTitle(qs, "itp", TITLES.itp1);
  if (!itp1) {
    itp1 = await POST(qs, `/projects/${P}/itp`, { title: TITLES.itp1, pointType: "hold", status: "pending", activityId: ctx.activities.A130, inspectionDate: "2027-02-03", dueDate: "2027-02-03", comment: "Hold point: no pour before sign-off" });
    note("ITP-01 raised", `${itp1.ref ?? itp1.id} ${itp1.pointType} ${itp1.status}`);
  }
  if (itp1.status !== "passed") {
    check("a storeman cannot record an inspection result", 403, (await probe(warehouse, "PATCH", `/projects/${P}/itp/${itp1.id}`, { status: "passed" })).status);
    itp1 = await PATCH(site, `/projects/${P}/itp/${itp1.id}`, { status: "passed", inspectionDate: "2027-02-03", comment: "Cover, spacing and laps checked against S-101 rev B" });
  }
  check("ITP-01 is a hold point", "hold", itp1.pointType);
  check("ITP-01 passed", "passed", itp1.status);

  let itp2 = await findByTitle(qs, "itp", TITLES.itp2);
  if (!itp2) {
    itp2 = await POST(qs, `/projects/${P}/itp`, { title: TITLES.itp2, pointType: "witness", status: "pending", activityId: ctx.activities.A130, inspectionDate: "2027-02-10", dueDate: "2027-02-10" });
    note("ITP-02 raised", `${itp2.ref ?? itp2.id} ${itp2.pointType} ${itp2.status}`);
  }
  if (itp2.status !== "failed") {
    itp2 = await PATCH(qs, `/projects/${P}/itp/${itp2.id}`, { status: "failed", inspectionDate: "2027-02-10", comment: "7-day strength 18.2 MPa against 21 MPa expected" });
  }
  check("ITP-02 failed", "failed", itp2.status);
  ctx.quality.itpIds = { itp1: itp1.id, itp2: itp2.id };
  save();

  const afterItp = await score();
  check("the failed ITP costs exactly 15: score = 100 − 20·major − 8·minor − 15·failed", 100 - 20 * afterItp.major - 8 * afterItp.minor - 15 * afterItp.failedItps, afterItp.score);
  check("the dashboard counts one failed ITP", 1, afterItp.failedItps);

  // ── 16.2 the NCR ─────────────────────────────────────────────────────────
  section("16.2  NCR-01 — major, raised by the site engineer, closed with evidence, approved by the PM");

  check("a storeman cannot raise an NCR", 403, (await probe(warehouse, "POST", `/projects/${P}/ncr`, { title: "x" })).status);
  // An NCR has no title in the product: its description is its identity here.
  const NCR_DESC = "Honeycombing over ~0.3 m² on the east face of pad footing F3; aggregate exposed to 40 mm depth.";
  const ncrRows = rows(await GET(site, `/projects/${P}/ncr?limit=100`)).filter((r) => r.description === NCR_DESC).sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)));
  // T-10: the first run of this stage looked NCRs up by a title the product does not
  // store, and the second run raised NCR-002 a second time, closed it out and had it
  // approved before the defect was seen. That record is approved history and stays.
  // It is named here so that a THIRD copy fails loudly.
  if (!ctx.quality.ncrDuplicateT10 && ncrRows.length === 2) ctx.quality.ncrDuplicateT10 = ncrRows[1].id; // recorded once, 2026-09-12
  const T10_DUPLICATE = ctx.quality.ncrDuplicateT10 || null;
  const strays = ncrRows.slice(1).filter((r) => r.id !== T10_DUPLICATE);
  if (strays.length) throw new Error(`unexpected duplicate NCR-01: ${strays.map((r) => r.ref).join(", ")}`);
  if (T10_DUPLICATE) note("  T-10 duplicate on record (approved history, kept)", `${ncrRows[1]?.ref} ${T10_DUPLICATE} status=${ncrRows[1]?.status}`);
  // One clean pass raises exactly ONE major NCR (NCR-01, below); the T-10 duplicate exists only
  // on the durable project that had this stage run twice. This used to be `ncrRows.length`,
  // counted BEFORE NCR-01 is raised — 2 on that project, but 0 on a first clean pass, where
  // the stage then expected a dashboard with no major NCR and a score that moved by 15, not 35.
  // Paper, clean pass: 100 − 20·1 major − 8·0 minor − 15·1 failed ITP = 65.
  const EXPECTED_MAJOR = 1 + (T10_DUPLICATE ? 1 : 0);
  let ncr = ncrRows[0] ?? null;
  if (!ncr) {
    ncr = await POST(site, `/projects/${P}/ncr`, {
      title: TITLES.ncr1,
      description: NCR_DESC,
      severity: "major",
      activityId: ctx.activities.A130,
      responsible: "Subcontractor site foreman",
      assigneeUserId: ctx.userIds.site,
      dueDate: "2027-02-12",
      comment: "Raised after strip of F3",
    });
    note("NCR-01 raised", `${ncr.ref ?? ncr.id} ${ncr.severity} ${ncr.status}`);
  } else {
    note("NCR-01 exists, reusing", `${ncr.ref ?? ncr.id} ${ncr.severity} ${ncr.status}`);
  }
  ctx.quality.ncrId = ncr.id;
  ctx.quality.ncrRef = ncr.ref ?? null;
  save();
  check("NCR-01 is major", "major", ncr.severity);
  check("NCR-01 is on the foundation activity", ctx.activities.A130, ncr.activityId);

  const afterNcr = await score();
  check(`the dashboard counts ${EXPECTED_MAJOR} major NCR(s) — NCR-01${T10_DUPLICATE ? " plus the named T-10 duplicate" : ""}`, EXPECTED_MAJOR, afterNcr.major);
  check("the quality score is exactly 100 − 20·major − 8·minor − 15·failed ITP", 100 - 20 * afterNcr.major - 8 * afterNcr.minor - 15 * afterNcr.failedItps, afterNcr.score);

  if (ncr.status === "open") {
    // Closeout needs evidence; without it the product must refuse.
    const bare = await probe(site, "POST", `/projects/${P}/ncr/${ncr.id}/close`, { closureComment: "Repaired", responsible: "Subcontractor site foreman", dueDate: "2027-02-12" });
    check("closeout without evidence is refused", true, bare.status === 400 && /EVIDENCE|REQUIRED/.test(String(bare.code)));
    note("  refusal", `${bare.status} ${bare.code}`);

    const photo = await upload(site, "POST", `/projects/${P}/attachments`, {
      field: "files", filename: `${ctx.tag}-ncr-01-repair.png`, contentType: "image/png", body: png,
      fields: { recordType: "ncr", recordId: ncr.id, caption: "F3 east face after repair mortar" },
    });
    const att = rows(photo)[0] || (photo.attachments || [])[0] || photo;
    const evidence = { documentId: att.documentId || att.id, fileName: att.fileName || `${ctx.tag}-ncr-01-repair.png`, storageKey: att.storageKey || att.key || att.documentId || att.id, fileUrl: att.fileUrl || att.url || null };
    const closed = await probe(site, "POST", `/projects/${P}/ncr/${ncr.id}/close`, {
      closureComment: "Loose material removed, face repaired with proprietary repair mortar, cured 7 days; inspected by the QS.",
      responsible: "Subcontractor site foreman",
      dueDate: "2027-02-12",
      attachmentRefs: [evidence],
    });
    note("  closeout submitted (site engineer)", `${closed.status} ${closed.code ?? "ok"}`);
    if (!closed.ok) throw new Error(`ncr close: ${closed.status} ${closed.code} ${closed.message}`);
    ncr = closed.data;
  }
  if (ncr.status === "submitted") {
    check("the site engineer cannot approve the closeout", 403, (await probe(site, "POST", `/projects/${P}/ncr/${ncr.id}/approve`, { comment: "x" })).status);
    check("the QS cannot approve the closeout either", 403, (await probe(qs, "POST", `/projects/${P}/ncr/${ncr.id}/approve`, { comment: "x" })).status);
    ncr = await POST(pm, `/projects/${P}/ncr/${ncr.id}/approve`, { comment: "Repair accepted" });
  }
  check("NCR-01 is closed", "closed", ncr.status);
  const afterClose = await score();
  note("  score after NCR closed", JSON.stringify(afterClose));
  // Recorded, not asserted: the rule counts NCRs raised, not NCRs open.
  ctx.quality.scoreAfterNcrClosed = afterClose.score;
  check("a closed major NCR still counts in the score (the product's stated rule)", afterNcr.score, afterClose.score);

  // ── 16.3 the defect ──────────────────────────────────────────────────────
  section("16.3  DEF-01 — minor defect, opened by the QS, worked by the site engineer, closed by the PM");

  let def = await findByTitle(qs, "defects", TITLES.def1);
  if (!def) {
    def = await POST(qs, `/projects/${P}/defects`, { title: TITLES.def1, severity: "minor", status: "open", activityId: ctx.activities.A130, targetCloseBy: "2027-02-08", dueDate: "2027-02-08", comment: "Hairline crack 1.2 m, blinding only" });
    note("DEF-01 raised", `${def.ref ?? def.id} ${def.severity} ${def.status}`);
  }
  check("finance cannot work a defect", 403, (await probe(finance, "PATCH", `/projects/${P}/defects/${def.id}`, { status: "in_progress" })).status);
  if (def.status === "open") def = await PATCH(site, `/projects/${P}/defects/${def.id}`, { status: "in_progress", comment: "Crack routed and filled" });
  check("DEF-01 in progress", true, ["in_progress", "closed"].includes(def.status));
  if (def.status === "in_progress") def = await PATCH(pm, `/projects/${P}/defects/${def.id}`, { status: "closed", comment: "Accepted" });
  check("DEF-01 closed", "closed", def.status);
  ctx.quality.defectId = def.id;

  // ── 16.4 the material test ───────────────────────────────────────────────
  section("16.4  MT-01 — 28-day cube test, pending then pass");

  let mt = await findByTitle(qs, "material-tests", TITLES.mt1).catch(() => null);
  if (!mt) {
    const list = await GET(qs, `/projects/${P}/material-tests?limit=100`);
    mt = rows(list).find((r) => r.testType === TITLES.mt1) ?? null;
  }
  if (!mt) {
    mt = await POST(qs, `/projects/${P}/material-tests`, { testType: TITLES.mt1, result: "pending", activityId: ctx.activities.A130, testDate: "2027-03-03", dueDate: "2027-03-03" });
    note("MT-01 raised", `${mt.ref ?? mt.id} ${mt.result}`);
  }
  check("a storeman cannot record a test result", 403, (await probe(warehouse, "PATCH", `/projects/${P}/material-tests/${mt.id}`, { result: "pass" })).status);
  if (mt.result !== "pass") mt = await PATCH(qs, `/projects/${P}/material-tests/${mt.id}`, { result: "pass", comment: "28-day 34.5 MPa ≥ 30 MPa" });
  check("MT-01 passed", "pass", mt.result);
  ctx.quality.materialTestId = mt.id;

  // ── 16.5 punch item and observation ─────────────────────────────────────
  section("16.5  Punch list — PL-01 closed by the PM only; OBS-01 a safety observation");

  const punchList = await GET(site, `/projects/${P}/punch?limit=200`);
  let pl = rows(punchList).find((r) => r.title === TITLES.pl1) ?? null;
  if (!pl) {
    pl = await POST(site, `/projects/${P}/punch`, {
      title: TITLES.pl1, kind: "punch", priority: "normal", description: "Timber offcuts and tie wire left in pad F2 excavation",
      activityId: ctx.activities.A130, locationId: ctx.locationId, trade: "Carpentry",
      assigneeCompanyId: ctx.companies.subcontractor.id, assigneeUserId: ctx.userIds.site, managerUserId: ctx.userIds.pm, finalApproverUserId: ctx.userIds.pm,
      dueDate: "2027-02-05", clientRequestId: `${ctx.tag}-PL-01`,
    });
    note("PL-01 raised", `${pl.ref} ${pl.status}`);
  }
  check("PL-01 is a punch item, not an observation", "punch", pl.kind);
  const step = async (action, who, body = {}) => probe(who, "POST", `/projects/${P}/punch/${pl.id}/transition`, { action, ...body });
  if (pl.status === "draft") { const r = await step("open", site); if (!r.ok) throw new Error(`open: ${r.status} ${r.code}`); pl = r.data; }
  if (pl.status === "open") { const r = await step("ready_for_review", site); if (!r.ok) throw new Error(`ready: ${r.status} ${r.code}`); pl = r.data; }
  if (pl.status === "ready_for_review") {
    check("the site engineer cannot close a punch item", 403, (await step("close", site)).status);
    check("reopening needs a reason", 400, (await step("reopen", pm)).status);
    const r = await step("close", pm, { reason: "Debris cleared, verified on walk-down" });
    if (!r.ok) throw new Error(`close: ${r.status} ${r.code}`);
    pl = r.data;
  }
  check("PL-01 is closed", "closed", pl.status);
  ctx.quality.punchId = pl.id;
  ctx.quality.punchRef = pl.ref;

  let obs = rows(await GET(qs, `/projects/${P}/punch?kind=observation&limit=200`)).find((r) => r.title === TITLES.obs1) ?? null;
  if (!obs) {
    obs = await POST(qs, `/projects/${P}/punch`, {
      title: TITLES.obs1, kind: "observation", observationType: "safety", hazard: "Fall into excavation", priority: "high",
      activityId: ctx.activities.A130, locationId: ctx.locationId, assigneeUserId: ctx.userIds.site, managerUserId: ctx.userIds.pm, dueDate: "2027-02-02", clientRequestId: `${ctx.tag}-OBS-01`,
    });
    note("OBS-01 raised", `${obs.ref} ${obs.status}`);
  }
  check("OBS-01 is an observation with its own numbering", true, obs.kind === "observation" && /^OBS/.test(String(obs.ref)));
  const ostep = async (action, who, body = {}) => probe(who, "POST", `/projects/${P}/punch/${obs.id}/transition`, { action, ...body });
  if (obs.status === "draft") { const r = await ostep("open", site); if (!r.ok) throw new Error(`obs open: ${r.status} ${r.code}`); obs = r.data; }
  if (obs.status === "open") { const r = await ostep("close", pm, { reason: "Edge protection installed" }); if (!r.ok) throw new Error(`obs close: ${r.status} ${r.code}`); obs = r.data; }
  check("OBS-01 is closed", "closed", obs.status);
  ctx.quality.observationId = obs.id;
  ctx.quality.observationRef = obs.ref;

  // ── 16.6 the dashboard and another tenant ────────────────────────────────
  const finalScore = await score();
  note("quality after", JSON.stringify(finalScore));
  check("the final score is 100 − 20·major − 8·minor − 15·failed ITP", 100 - 20 * finalScore.major - 8 * finalScore.minor - 15 * finalScore.failedItps, finalScore.score);
  check(`nothing but NCR-01${T10_DUPLICATE ? ", the T-10 duplicate" : ""} and the failed ITP moved the score (20 per major NCR + 15)`, EXPECTED_MAJOR * 20 + 15, ctx.quality.scoreAtStart - finalScore.score);
  ctx.quality.scoreFinal = finalScore.score;
  const out = await probe(ctx.outsider, "GET", `/projects/${P}/ncr/${ncr.id}`);
  check("another tenant cannot read the NCR", true, out.status === 403 || out.status === 404);

  ctx.deepLinks = Object.assign(ctx.deepLinks || {}, {
    ncr: { recordType: "ncr", recordId: ncr.id, ref: ncr.ref ?? TITLES.ncr1 },
    itp: { recordType: "itp", recordId: itp1.id, ref: itp1.ref ?? TITLES.itp1 },
    defect: { recordType: "defect", recordId: def.id, ref: def.ref ?? TITLES.def1 },
    punch_item: { recordType: "punch_item", recordId: pl.id, ref: pl.ref },
    observation: { recordType: "observation", recordId: obs.id, ref: obs.ref },
  });
  save();
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 16 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
