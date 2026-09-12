/**
 * Phase 21C · stage 14 — an RFI, the ball in court as it moves, and the
 * change it turns into.
 *
 *   raised by   the site engineer, on the foundation activity, at a location
 *   assigned to the planner (who must answer), managed by the PM
 *   answered    by the planner — ball moves back to the PM
 *   closed      by the PM — nobody holds the ball
 *   converted   into a draft change order of 4,500.00, linked both ways,
 *               then approved: Revised Budget must rise by exactly 4,500.00
 *               and the cost ledger must not move.
 *
 * Ball in court is asserted at every step as the product reports it
 * (ballInCourtUserId), and "can act" is checked against "is responsible":
 * the QS is on distribution and may read the RFI, but never holds the ball.
 *
 * Idempotent: RFI found by subject, location by code, change by description.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, PATCH, PUT, probe, cents, money, check, note, section, summary, readLedger, upload } = require("./harness");

const CONTEXT = path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, planner, qs, site, warehouse, cost } = ctx.people;

const SUBJECT = `${ctx.tag} RFI-01 Founding level at grid A-D against borehole BH-3`;
const CHANGE_VALUE = 4_500;
const CHANGE_DESCRIPTION = `${ctx.tag} From RFI-01: additional 150mm excavation to competent stratum at grid A-D`;

async function budgetRevised() {
  const b = await GET(cost, `/projects/${P}/budget/lines`);
  const lines = b.items || b.lines || [];
  return {
    revised: lines.reduce((s, l) => s + cents(l.revisedBudget ?? 0), 0),
    approvedChanges: lines.reduce((s, l) => s + cents(l.approvedChanges ?? 0), 0),
  };
}

async function main() {
  section("PHASE 21C · STAGE 14 — RFI, ball in court, and RFI → change");

  // ── 14.1 a real place on the project ─────────────────────────────────────
  const locs = await GET(site, `/projects/${P}/locations`);
  let location = (locs.items || locs).find((l) => l.code === `${ctx.stamp}-GRID-AD`) ?? null;
  if (!location) {
    location = await POST(pm, `/projects/${P}/locations`, {
      name: "Foundation zone, grid A-D",
      code: `${ctx.stamp}-GRID-AD`,
      kind: "zone",
      description: "Pad and strip foundations between grids A and D",
    });
  }
  ctx.locationId = location.id;
  check("a project location exists to anchor the RFI", true, Boolean(location.id));

  // ── 14.2 raise it ────────────────────────────────────────────────────────
  section("14.2  Raised by the site engineer, assigned to the planner, managed by the PM");

  const list = await GET(site, `/projects/${P}/rfi?limit=100&search=${encodeURIComponent("RFI-01 Founding level")}&includeArchived=true`);
  let rfi = (list.rows || list.items || list).find((r) => r.subject === SUBJECT) ?? null;
  if (rfi) {
    note("RFI exists, reusing", `${rfi.ref} status=${rfi.status}`);
  } else {
    rfi = await POST(site, `/projects/${P}/rfi`, {
      subject: SUBJECT,
      question:
        "Borehole BH-3 shows the competent stratum 150mm below the founding level on drawing S-101 at grid A-D. " +
        "Confirm whether the founding level is to be lowered to the stratum or the pad thickened.",
      priority: "high",
      discipline: "structural",
      managerUserId: ctx.userIds.pm,
      assigneeUserIds: [ctx.userIds.planner],
      distributionUserIds: [ctx.userIds.qs],
      locationId: location.id,
      activityId: ctx.activities.A130,
      activityLinks: [{ activityId: ctx.activities.A130, relationType: "impacted", scheduleImpactDays: 3, costImpact: CHANGE_VALUE }],
      costImpact: true,
      costImpactAmount: CHANGE_VALUE,
      scheduleImpactFlag: true,
      scheduleImpact: 3,
      raisedDate: "2027-01-12",
      responseRequiredBy: "2027-01-20",
    });
    note("RFI raised", `${rfi.ref} status=${rfi.status}`);
  }
  ctx.rfiId = rfi.id;
  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));

  let cur = await GET(site, `/projects/${P}/rfi/${rfi.id}`);
  check("the RFI is on the foundation activity", ctx.activities.A130, cur.activity?.id ?? cur.activityId);
  check("the RFI is at the foundation zone", location.id, cur.locationId);
  check("the planner is the assignee", true, (cur.assignees || []).some((a) => a.userId === ctx.userIds.planner));
  check("the QS is on distribution, not an assignee", true, (cur.distribution || []).some((d) => d.userId === ctx.userIds.qs) && !(cur.assignees || []).some((a) => a.userId === ctx.userIds.qs));
  check("it carries a 4,500.00 cost impact", cents(CHANGE_VALUE), cents(cur.costImpactAmount));
  ctx.rfiRef = cur.ref;

  // ── 14.3 submit — the ball goes to the assignee ──────────────────────────
  section("14.3  Submit — the ball is with the planner, and only the planner");

  if (cur.status === "draft") {
    const sub = await probe(site, "POST", `/projects/${P}/rfi/${rfi.id}/submit`, {});
    note("  submit", `${sub.status} ${sub.code ?? "ok"}`);
    if (!sub.ok && sub.status !== 409) throw new Error(`submit: ${sub.status} ${sub.code} ${sub.message}`);
    cur = await GET(site, `/projects/${P}/rfi/${rfi.id}`);
  }
  if (cur.status === "open") {
    check("status is open", "open", cur.status);
    check("ball in court: the planner", ctx.userIds.planner, cur.ballInCourtUserId);
    check("the QS can read it (distribution)", 200, (await probe(qs, "GET", `/projects/${P}/rfi/${rfi.id}`)).status);
    check("but the QS does not hold the ball", false, cur.ballInCourtUserId === ctx.userIds.qs);
    // Can act is not is responsible: a storeman can neither read nor answer.
    check("a storeman cannot answer an RFI", 403, (await probe(warehouse, "POST", `/projects/${P}/rfi/${rfi.id}/answer`, { response: "no" })).status);
    ctx.rfiBall = { afterSubmit: cur.ballInCourtUserId };
  } else {
    note("already past open", cur.status);
  }

  // ── 14.4 answer — the ball moves back to the manager ─────────────────────
  section("14.4  Answer by the planner — the ball returns to the PM");

  if (cur.status === "open") {
    const ans = await probe(planner, "POST", `/projects/${P}/rfi/${rfi.id}/answer`, {
      response:
        "Lower the founding level by 150mm at grid A-D to bear on the competent stratum; pad depth unchanged. " +
        "Additional excavation and blinding to be instructed as a variation.",
      answeredDate: "2027-01-18",
      activityLinks: [{ activityId: ctx.activities.A130, relationType: "impacted", scheduleImpactDays: 3, costImpact: CHANGE_VALUE }],
    });
    note("  answer", `${ans.status} ${ans.code ?? "ok"}`);
    if (!ans.ok && ans.status !== 409) throw new Error(`answer: ${ans.status} ${ans.code} ${ans.message}`);
    cur = await GET(site, `/projects/${P}/rfi/${rfi.id}`);
  }
  if (cur.status === "answered") {
    check("status is answered", "answered", cur.status);
    check("the official response is recorded", true, Boolean(cur.officialResponse || cur.response));
    check("ball in court moved off the planner", false, cur.ballInCourtUserId === ctx.userIds.planner);
    check("ball in court: the PM, to close it out", ctx.userIds.pm, cur.ballInCourtUserId);
    ctx.rfiBall = { ...(ctx.rfiBall || {}), afterAnswer: cur.ballInCourtUserId };
  }

  // ── 14.5 convert to a change, then close ─────────────────────────────────
  section("14.5  RFI → change — a draft variation created from the RFI and linked back");

  const register = await GET(qs, `/projects/${P}/change-orders?limit=200`);
  let change = (register.orders || []).find((c) => c.id === cur.changeOrderId) ?? (register.orders || []).find((c) => c.description === CHANGE_DESCRIPTION) ?? null;
  if (change) {
    note("change already created from this RFI, reusing", `${change.ref} status=${change.status} value=${change.value}`);
  } else {
    const converted = await POST(pm, `/projects/${P}/rfi/${rfi.id}/convert-to-change`, {
      description: CHANGE_DESCRIPTION,
      category: "client_instruction",
      value: CHANGE_VALUE,
    });
    change = converted.changeOrder || converted;
    note("change created from the RFI", `${change.ref} status=${change.status} value=${change.value}`);
    check("a converted change starts as a draft, not approved", "draft", change.status);
    ctx.rfiChangeCreatedAs = change.status;
    // Converting twice must be refused, not duplicated.
    const again = await probe(pm, "POST", `/projects/${P}/rfi/${rfi.id}/convert-to-change`, { description: CHANGE_DESCRIPTION, value: CHANGE_VALUE });
    check("converting the same RFI twice is refused (409 RFI_ALREADY_CONVERTED)", "409 RFI_ALREADY_CONVERTED", `${again.status} ${again.code}`);
    cur = await GET(site, `/projects/${P}/rfi/${rfi.id}`);
  }
  ctx.rfiChangeOrderId = change.id;
  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));

  check("the RFI points at the change it became", change.id, cur.changeOrderId);
  check("the change carries the RFI's 4,500.00", cents(CHANGE_VALUE), cents(change.value));
  check("the change is on the same activity", ctx.activities.A130, change.activityId);
  if (ctx.rfiChangeCreatedAs) check("(recorded on creation) the change started as a draft", "draft", ctx.rfiChangeCreatedAs);

  // Approve it with the same evidence a variation always needs (stage 8).
  const budgetBefore = await budgetRevised();
  const ledgerBefore = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  const fresh = (await GET(qs, `/projects/${P}/change-orders?limit=200`)).orders.find((c) => c.id === change.id);
  if (fresh.status === "approved") {
    note("already approved, not repeating", fresh.ref);
  } else {
    await PATCH(qs, `/projects/${P}/change-orders/${change.id}`, {
      budgetLineId: ctx.budgetLines["01-100"],
      scheduleImpactSummary: "Three working days on foundation excavation (A130), on the critical path; completion moves three days.",
      costImpactSummary: "4,500.00 for 150mm additional excavation and blinding at grid A-D, per the RFI-01 response.",
      activityLinks: [{ activityId: ctx.activities.A130, relationType: "impacted", scheduleImpactDays: 3, costImpact: CHANGE_VALUE }],
    });
    const memo = Buffer.from(`RFI ${cur.ref} response and instruction\n\n${cur.officialResponse?.body ?? cur.response ?? ""}\n`, "utf8");
    const attached = await upload(qs, "POST", `/projects/${P}/attachments`, {
      field: "files", filename: `${ctx.tag}-rfi-01-instruction.txt`, contentType: "text/plain", body: memo,
      fields: { recordType: "change_order", recordId: change.id, caption: `${cur.ref} instruction` },
    });
    const docId = (attached.items || attached.attachments || [])[0]?.documentId ?? (attached.items || [])[0]?.id;
    await PATCH(qs, `/projects/${P}/change-orders/${change.id}`, { documentIds: [docId] });
    for (const [step, who] of [["submit", qs], ["approve", pm]]) {
      const r = await probe(who, "POST", `/projects/${P}/change-orders/${change.id}/${step}`, { comment: `${ctx.tag} ${step} from ${cur.ref}` });
      note(`  ${step}`, `${r.status} ${r.code ?? "ok"}`);
      if (!r.ok && r.status !== 409) throw new Error(`change ${step}: ${r.status} ${r.code} ${r.message}`);
    }
    const budgetAfter = await budgetRevised();
    check("Revised Budget rose by exactly the RFI's 4,500.00", cents(CHANGE_VALUE), budgetAfter.revised - budgetBefore.revised);
    check("approved changes rose by exactly 4,500.00", cents(CHANGE_VALUE), budgetAfter.approvedChanges - budgetBefore.approvedChanges);
  }
  const ledgerAfter = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  check("approving the RFI's change is not a cost", ledgerBefore.ledgerCents, ledgerAfter.ledgerCents);

  // Close the RFI — nobody holds the ball afterwards.
  cur = await GET(site, `/projects/${P}/rfi/${rfi.id}`);
  if (cur.status !== "closed") {
    const cl = await probe(pm, "POST", `/projects/${P}/rfi/${rfi.id}/close`, { comment: `Instructed as ${change.ref}` });
    note("  close", `${cl.status} ${cl.code ?? "ok"}`);
    cur = await GET(site, `/projects/${P}/rfi/${rfi.id}`);
  }
  check("the RFI is closed", "closed", cur.status);
  check("nobody holds the ball on a closed RFI", null, cur.ballInCourtUserId ?? null);
  ctx.rfiBall = { ...(ctx.rfiBall || {}), afterClose: cur.ballInCourtUserId ?? null };

  // ── 14.6 the outsider ────────────────────────────────────────────────────
  if (ctx.outsider) {
    const out = await probe(ctx.outsider, "GET", `/projects/${P}/rfi/${rfi.id}`);
    check("another tenant cannot read the RFI", true, out.status === 403 || out.status === 404);
  }

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 14 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
