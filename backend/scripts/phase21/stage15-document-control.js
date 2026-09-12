/**
 * Phase 21C · stage 15 — document control on the Phase 21 project.
 *
 *   drawing        S-101 raised by the site engineer; rev A uploaded, reviewed,
 *                  approved by the PM; rev B the same and it becomes current;
 *                  rev C uploaded and left in review — and a storeman, who
 *                  only ever sees issued drawings, must NOT see rev C.
 *   submittal      the cement mill certificate: submitted, REJECTED by the PM,
 *                  resubmitted, reviewed by the QS, approved by the PM.
 *   transmittal    the formal issue of S-101 rev B to the client, acknowledged.
 *   correspondence the instruction letter that followed RFI-001, then closed.
 *   register       all of them, and RFI-001, on one register.
 *
 * Every step is driven by the persona whose job it is; the ones whose job it
 * is not are refused. Idempotent: each record is found by its deterministic
 * number / title, and the workflow resumes from whatever status it is in.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, PUT, PATCH, probe, check, note, section, summary, upload } = require("./harness");

const CONTEXT = path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, planner, qs, site, warehouse } = ctx.people;
const save = () => fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));

const DRAWING_NUMBER = `${ctx.tag}-S-101`;
const SUBMITTAL_TITLE = `${ctx.tag} SUB-01 Cement OPC 42.5N mill certificate`;
const TRANSMITTAL_SUBJECT = `${ctx.tag} TR-01 Issue of S-101 rev B for construction`;
const CORR_SUBJECT = `${ctx.tag} LTR-01 Instruction to lower founding level at grid A-D`;

const rows = (x) => x?.rows || x?.items || x?.records || x?.drawings || x?.submittals || x?.transmittals || x?.correspondence || (Array.isArray(x) ? x : []);

/** A small, valid PDF — enough for a file gate that reads the magic bytes. */
const pdf = (label) => {
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj\n4 0 obj<</Length ${label.length + 30}>>stream\nBT /F1 12 Tf 72 770 Td (${label}) Tj ET\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  return Buffer.from(body, "utf8");
};

async function findDrawing() {
  const list = await GET(site, `/projects/${P}/drawings?limit=100&search=${encodeURIComponent("S-101")}`);
  return rows(list).find((d) => d.drawingNumber === DRAWING_NUMBER) ?? null;
}

/**
 * Drawings have no single-record GET; the register row carries the record's
 * revisions as the viewer's role is allowed to see them.
 */
async function drawingRevision(who, drawingId, label) {
  const reg = await GET(who, `/projects/${P}/doc-control/register?recordType=drawing`);
  const d = rows(reg).find((r) => r.recordId === drawingId) ?? null;
  if (!d) throw new Error(`drawing ${drawingId} is not on the register for ${who.email || "viewer"}`);
  const all = d.revisions || [];
  return { drawing: d, rev: all.find((r) => r.revision === label) ?? null, all };
}

/** Upload → submit for review → (optionally) approve a drawing revision, resuming from its status. */
async function driveRevision(drawingId, label, { approve }) {
  let { rev } = await drawingRevision(pm, drawingId, label);
  if (!rev) {
    const uploaded = await upload(site, "POST", `/projects/${P}/doc-control/drawing/${drawingId}/revisions/upload`, {
      field: "file",
      filename: `S-101-rev${label}.pdf`,
      contentType: "application/pdf",
      body: pdf(`S-101 rev ${label}`),
      fields: { revision: label, title: `Foundation layout S-101 rev ${label}`, notes: `${ctx.tag} rev ${label}` },
    });
    rev = uploaded.revision || uploaded;
    note(`  rev ${label} uploaded`, `${rev.id} status=${rev.status}`);
    ({ rev } = await drawingRevision(pm, drawingId, label));
  } else {
    note(`  rev ${label} exists`, `status=${rev.status} latest=${rev.isLatest}`);
  }
  if (!/approved|superseded/i.test(String(rev.status)) && !/submitted|review/i.test(String(rev.status))) {
    const sr = await probe(site, "POST", `/projects/${P}/doc-control/revisions/${rev.id}/submit-review`, { comment: `Rev ${label} for review` });
    note(`  rev ${label} submit-review (site engineer)`, `${sr.status} ${sr.code ?? "ok"}`);
    if (!sr.ok && sr.status !== 409) throw new Error(`submit-review ${label}: ${sr.status} ${sr.code} ${sr.message}`);
    ({ rev } = await drawingRevision(pm, drawingId, label));
  }
  if (approve && !/approved|superseded/i.test(String(rev.status))) {
    // Approval is the PM's; the site engineer who raised it may not.
    const notMine = await probe(site, "POST", `/projects/${P}/doc-control/revisions/${rev.id}/approve`, { comment: "self-approve" });
    check(`rev ${label}: the site engineer cannot approve a drawing revision`, 403, notMine.status);
    const ap = await probe(pm, "POST", `/projects/${P}/doc-control/revisions/${rev.id}/approve`, { comment: `Rev ${label} approved for construction` });
    note(`  rev ${label} approve (PM)`, `${ap.status} ${ap.code ?? "ok"}`);
    if (!ap.ok && ap.status !== 409) throw new Error(`approve ${label}: ${ap.status} ${ap.code} ${ap.message}`);
    ({ rev } = await drawingRevision(pm, drawingId, label));
  }
  return rev;
}

async function main() {
  section("PHASE 21C · STAGE 15 — document control");

  // ── 15.1 drawing S-101 and its revisions ─────────────────────────────────
  section("15.1  Drawing S-101 — rev A approved, rev B supersedes it, rev C in review");

  let drawing = await findDrawing();
  if (!drawing) {
    drawing = await POST(site, `/projects/${P}/drawings`, {
      drawingNumber: DRAWING_NUMBER,
      title: "Foundation layout, grid A-D",
      status: "active",
      activityId: ctx.activities.A130,
      activityIds: [ctx.activities.A130],
      issueDate: "2027-01-05",
      comment: `${ctx.tag} raised for foundation works`,
    });
    note("drawing raised", `${drawing.drawingNumber} id=${drawing.id}`);
  } else {
    note("drawing exists, reusing", `${drawing.drawingNumber} id=${drawing.id}`);
  }
  ctx.drawingId = drawing.id;
  save();
  check("the drawing is on the foundation activity", true, (drawing.activityId === ctx.activities.A130) || (drawing.activityLinks || drawing.activities || []).some((a) => (a.activityId || a.id) === ctx.activities.A130));

  const revA = await driveRevision(drawing.id, "A", { approve: true });
  check("rev A is approved", true, /approved|current|issued/i.test(String(revA.status)) || Boolean(revA.approvedAt));
  ctx.drawingRevisionStatuses = { A: revA.status };

  const revB = await driveRevision(drawing.id, "B", { approve: true });
  check("rev B is approved", true, /approved|current|issued/i.test(String(revB.status)) || Boolean(revB.approvedAt));
  let { rev: revAAfterB, all } = await drawingRevision(pm, drawing.id, "A");
  check("rev B is the latest revision", true, Boolean(revB.isLatest));
  check("rev A is no longer the latest", false, Boolean(revAAfterB.isLatest));
  note("  rev A after B", `status=${revAAfterB.status} supersededAt=${revAAfterB.supersededAt ?? "-"}`);
  ctx.drawingRevisionStatuses.AafterB = revAAfterB.status;
  ctx.drawingRevisionStatuses.B = revB.status;

  const revC = await driveRevision(drawing.id, "C", { approve: false });
  note("  rev C left in review", `status=${revC.status}`);
  check("rev C is not approved", false, /approved/i.test(String(revC.status)));
  ctx.drawingRevisionStatuses.C = revC.status;

  // The storeman sees issued drawings only — never the one still in review.
  ({ all } = await drawingRevision(pm, drawing.id, "C"));
  const asStore = await drawingRevision(warehouse, drawing.id, "C");
  const storeLabels = asStore.all.map((r) => r.revision).sort().join(",");
  const pmLabels = all.map((r) => r.revision).sort().join(",");
  note("  revisions visible", `PM=[${pmLabels}] storeman=[${storeLabels}]`);
  check("the storeman does not see rev C (in review)", false, Boolean(asStore.rev));
  check("the storeman does see the current approved rev B", true, asStore.all.some((r) => r.revision === "B"));
  check("the PM sees every revision, A, B and C", true, ["A", "B", "C"].every((l) => all.some((r) => r.revision === l)));
  note("  the product also keeps the record's own opening revision", all.map((r) => `${r.revision}:${r.status}`).join(" "));
  // Whether a superseded revision is still visible to the field is a product choice — recorded, not asserted.
  note("  storeman sees superseded rev A?", String(asStore.all.some((r) => r.revision === "A")));
  ctx.drawingRevisionIds = Object.fromEntries(all.map((r) => [r.revision, r.id]));

  // Download of the current revision works and is a PDF.
  const { download } = require("./harness");
  const bytes = await download(pm, `/projects/${P}/doc-control/revisions/${ctx.drawingRevisionIds.B}/download`);
  check("rev B downloads as the PDF that was uploaded", "%PDF", bytes.subarray(0, 4).toString("utf8"));

  // ── 15.2 the submittal ───────────────────────────────────────────────────
  section("15.2  Submittal — rejected once, resubmitted, reviewed by the QS, approved by the PM");

  const subs = await GET(site, `/projects/${P}/submittals?limit=100&search=${encodeURIComponent("SUB-01")}`);
  let sub = rows(subs).find((s) => s.title === SUBMITTAL_TITLE) ?? null;
  if (!sub) {
    sub = await POST(site, `/projects/${P}/submittals`, {
      title: SUBMITTAL_TITLE,
      specRef: "03 30 00",
      discipline: "structural",
      activityId: ctx.activities.A130,
      managerUserId: ctx.userIds.pm,
      distributionUserIds: [ctx.userIds.qs],
      leadTimeWeeks: 2,
      reviewDays: 7,
      requiredOnSite: "2027-01-25",
      dueDate: "2027-01-18",
      revisions: [{ revision: "0", fileName: "mill-certificate-rev0.pdf", storageKey: `${ctx.tag}/mill-certificate-rev0.pdf`, title: "Mill certificate rev 0" }],
      comment: `${ctx.tag} cement mill certificate for approval`,
    });
    note("submittal raised", `${sub.ref ?? sub.id} status=${sub.status}`);
  } else {
    note("submittal exists, reusing", `${sub.ref ?? sub.id} status=${sub.status}`);
  }
  ctx.submittalId = sub.id;
  ctx.submittalRef = sub.ref ?? null;
  ctx.submittalTrail = ctx.submittalTrail || [];
  save();

  const trail = ctx.submittalTrail;
  let guard = 0;
  let s = await GET(site, `/projects/${P}/submittals/${sub.id}`);
  while (s.status !== "approved" && guard++ < 8) {
    let step;
    if (s.status === "pending" || s.status === "resubmit") {
      step = ["submit", site, {}];
    } else if (s.status === "rejected") {
      step = ["resubmit", site, { reason: "Rev 1 certificate for 42.5N attached" }];
    } else if (s.status === "under_review") {
      if (!trail.includes("reject")) {
        // A storeman may not decide a submittal.
        check("a storeman cannot approve a submittal", 403, (await probe(warehouse, "POST", `/projects/${P}/submittals/${sub.id}/approve`, { comment: "x" })).status);
        step = ["reject", pm, { reason: "Certificate supplied is for 32.5N; resubmit the 42.5N certificate" }];
      } else if (!trail.includes("review")) {
        step = ["review", qs, { comment: "Rev 1 certificate checked against BS EN 197-1; 42.5N confirmed" }];
      } else {
        step = ["approve", pm, { comment: "Approved — 42.5N certificate accepted" }];
      }
    } else {
      throw new Error(`unexpected submittal status ${s.status}`);
    }
    const [action, who, body] = step;
    const r = await probe(who, "POST", `/projects/${P}/submittals/${sub.id}/${action}`, body);
    note(`  ${action}`, `${r.status} ${r.code ?? "ok"}`);
    if (!r.ok) throw new Error(`submittal ${action}: ${r.status} ${r.code} ${r.message}`);
    trail.push(action);
    save();
    s = await GET(site, `/projects/${P}/submittals/${sub.id}`);
    note(`    → status`, s.status);
  }
  check("the submittal ends approved", "approved", s.status);
  // The product's own sequence is recorded; what is asserted is the shape of it.
  note("  workflow trail", trail.join(" → "));
  check("it was submitted, rejected, resubmitted, reviewed and approved — in that order", true,
    trail.indexOf("submit") === 0 && trail.indexOf("reject") > 0 && trail.indexOf("resubmit") > trail.indexOf("reject") && trail.indexOf("review") > trail.indexOf("resubmit") && trail[trail.length - 1] === "approve");
  check("the submittal is on the foundation activity", ctx.activities.A130, s.activityId ?? s.activity?.id);
  check("its revision 0 is on record", true, (s.revisions || []).some((r) => String(r.revision) === "0"));

  // ── 15.3 the transmittal ─────────────────────────────────────────────────
  section("15.3  Transmittal — S-101 rev B issued to the client and acknowledged");

  const trs = await GET(pm, `/projects/${P}/transmittals?limit=100&search=${encodeURIComponent("TR-01")}`);
  let tr = rows(trs).find((t) => t.subject === TRANSMITTAL_SUBJECT) ?? null;
  if (!tr) {
    tr = await POST(pm, `/projects/${P}/transmittals`, {
      subject: TRANSMITTAL_SUBJECT,
      sender: "OctaPM site office",
      recipient: ctx.companies.client.name,
      method: "email",
      status: "pending_ack",
      transmittedOn: "2027-01-21",
      activityIds: [ctx.activities.A130],
      comment: `${ctx.tag} S-101 rev B issued for construction`,
    });
    note("transmittal issued", `${tr.ref ?? tr.id} status=${tr.status}`);
  } else {
    note("transmittal exists, reusing", `${tr.ref ?? tr.id} status=${tr.status}`);
  }
  ctx.transmittalId = tr.id;
  save();
  if (tr.status !== "acknowledged") {
    const ack = await PATCH(pm, `/projects/${P}/transmittals/${tr.id}`, { status: "acknowledged", acknowledgedOn: "2027-01-22", comment: "Acknowledged by the client's document controller" });
    tr = ack;
  }
  check("the transmittal is acknowledged", "acknowledged", tr.status);
  check("a storeman cannot issue a transmittal", 403, (await probe(warehouse, "POST", `/projects/${P}/transmittals`, { subject: "x", sender: "a", recipient: "b" })).status);

  // ── 15.4 the correspondence ──────────────────────────────────────────────
  section("15.4  Correspondence — the instruction letter after RFI-001, then closed");

  const cors = await GET(pm, `/projects/${P}/correspondence?limit=100&search=${encodeURIComponent("LTR-01")}`);
  let letter = rows(cors).find((c) => c.subject === CORR_SUBJECT) ?? null;
  if (!letter) {
    letter = await POST(pm, `/projects/${P}/correspondence`, {
      direction: "outgoing",
      type: "letter",
      subject: CORR_SUBJECT,
      date: "2027-01-19",
      responseRequiredBy: "2027-01-26",
      status: "open",
      activityId: ctx.activities.A130,
      comment: `${ctx.tag} confirms the RFI-001 instruction as ${ctx.rfiRef || "RFI-001"}`,
    });
    note("letter issued", `${letter.ref ?? letter.id} status=${letter.status}`);
  } else {
    note("letter exists, reusing", `${letter.ref ?? letter.id} status=${letter.status}`);
  }
  ctx.correspondenceId = letter.id;
  save();
  // Updating correspondence is the PM's / planner's, not the site engineer's.
  check("a site engineer cannot update correspondence", 403, (await probe(site, "PATCH", `/projects/${P}/correspondence/${letter.id}`, { status: "closed" })).status);
  if (letter.status !== "closed") {
    letter = await PATCH(pm, `/projects/${P}/correspondence/${letter.id}`, { status: "closed", responseDate: "2027-01-24", comment: "Client confirmed the instruction in writing" });
  }
  check("the letter is closed", "closed", letter.status);

  // ── 15.5 one register ────────────────────────────────────────────────────
  section("15.5  The document register lists all of them, and RFI-001");

  const reg = await GET(qs, `/projects/${P}/doc-control/register?limit=100`);
  const entries = rows(reg);
  note("register keys", `${Object.keys(reg).join(",")} entries=${entries.length}`);
  const has = (type, id) => entries.some((e) => (e.recordType === type || e.type === type) && (e.recordId === id || e.id === id));
  check("register: the drawing", true, has("drawing", drawing.id));
  check("register: the submittal", true, has("submittal", sub.id));
  check("register: the transmittal", true, has("transmittal", tr.id));
  check("register: the letter", true, has("correspondence", letter.id));
  check("register: RFI-001", true, has("rfi", ctx.rfiId));

  const dash = await GET(qs, `/projects/${P}/doc-control/dashboard`);
  note("dashboard keys", Object.keys(dash).join(","));

  // ── 15.6 another tenant ──────────────────────────────────────────────────
  const out = await probe(ctx.outsider, "GET", `/projects/${P}/drawings/${drawing.id}`);
  check("another tenant cannot read the drawing", true, out.status === 403 || out.status === 404);

  ctx.deepLinks = Object.assign(ctx.deepLinks || {}, {
    drawing: { recordType: "drawing", recordId: drawing.id, ref: DRAWING_NUMBER },
    submittal: { recordType: "submittal", recordId: sub.id, ref: sub.ref ?? SUBMITTAL_TITLE },
    transmittal: { recordType: "transmittal", recordId: tr.id, ref: tr.ref ?? TRANSMITTAL_SUBJECT },
    correspondence: { recordType: "correspondence", recordId: letter.id, ref: letter.ref ?? CORR_SUBJECT },
    rfi: { recordType: "rfi", recordId: ctx.rfiId, ref: ctx.rfiRef },
  });
  save();
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 15 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
