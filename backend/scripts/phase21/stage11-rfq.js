/**
 * Phase 21C · stage 11 — a procurement need, priced by three suppliers,
 * compared, awarded, and turned into a purchase order.
 *
 *   need        B-003 high-tensile reinforcement, 60 t, left unallocated in
 *               stage 3 for exactly this — estimate 1,200.00/t = 72,000.00
 *   bidders     Gulf Steel (directory)      1,150.00/t  lead 35 days   69,000.00  lowest price
 *               Emirates Rebar (ad hoc)     1,240.00/t  lead 14 days   74,400.00  fastest
 *               Northern Steel (ad hoc)     1,190.00/t  lead 21 days   71,400.00  ex-works, excludes delivery
 *   award       Emirates Rebar — NOT the lowest price. The need date is what
 *               decides it, and the decision is written down.
 *   PO          raised from the award, numbered by the atomic counter, carrying
 *               the awarded supplier, quantity and rate without retyping.
 *
 * Bidders price through the public portal by personal token, which is also
 * the external-supplier persona. No email is sent locally, so the token is
 * taken from the invitation `resend` response — the product's own way of
 * re-issuing a link.
 *
 * Idempotent: the package is found by number, the bid package by its link to
 * it, a submitted bid is left alone (409 BID_ALREADY_SUBMITTED), an award is
 * not repeated, and the PO is found by package before one is raised.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, PATCH, probe, cents, money, check, note, section, summary, API } = require("./harness");

const CONTEXT = path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, procurement, site } = ctx.people;

const PKG_NUMBER = `PKG-${ctx.stamp}-REBAR`;
const QTY = 60;
const ESTIMATE_RATE = 1200;
const BIDDERS = [
  { key: "gulf", companyName: ctx.companies.supplier.name, vendorCompanyId: ctx.companies.supplier.id, contactName: "Rana Haddad", contactEmail: `gulf@${ctx.stamp}.octapm.test`, rate: 1150, leadTimeDays: 35, exclusions: null },
  { key: "emirates", companyName: `${ctx.tag} Emirates Rebar Trading`, contactName: "Yusuf Al Amin", contactEmail: `emirates@${ctx.stamp}.octapm.test`, rate: 1240, leadTimeDays: 14, exclusions: null },
  { key: "northern", companyName: `${ctx.tag} Northern Steel Mills`, contactName: "Ingrid Solberg", contactEmail: `northern@${ctx.stamp}.octapm.test`, rate: 1190, leadTimeDays: 21, exclusions: "Ex-works. Excludes delivery to site and offloading." },
];
const WINNER = "emirates";

/** The public portal is token-authenticated: no login, no bearer. */
async function portal(method, token, suffix, payload) {
  const res = await fetch(`${API}/public/bids/${token}${suffix}`, {
    method,
    headers: payload === undefined ? {} : { "content-type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, code: body?.error?.code ?? null, message: body?.error?.message ?? null, data: body?.data };
}

const tokenFrom = (portalUrl) => String(portalUrl || "").split("/bid/")[1] || null;

async function main() {
  section(`PHASE 21C · STAGE 11 — RFQ, quotes, comparison, award, PO   ${PKG_NUMBER}`);

  // ── 11.1 the need ────────────────────────────────────────────────────────
  section("11.1  Procurement need — the reinforcement B-003 left unallocated in stage 3");

  const packages = await GET(procurement, `/projects/${P}/procurement/packages`);
  let pkg = (packages.items || packages).find?.((p) => p.packageNumber === PKG_NUMBER) ?? null;
  if (pkg) {
    note("package exists, reusing", `${pkg.packageNumber} status=${pkg.status}`);
  } else {
    pkg = await POST(procurement, `/projects/${P}/procurement/packages`, {
      packageNumber: PKG_NUMBER,
      title: "High-tensile reinforcement — foundations",
      description: "60 t HT bar to BS 4449, cut and bent, for the foundation pour",
      activityId: ctx.activities.A130,
      status: "tendering",
      buyer: "Amina Bello",
      requiredOnSiteDate: "2027-02-10",
      requiredTiming: "activity_start",
      leadWeeks: 3,
      bufferDays: 5,
    });
    note("package created", `${pkg.packageNumber} ${pkg.id}`);
  }
  ctx.rfqPackageId = pkg.id;
  check("the need is tied to the foundation activity", ctx.activities.A130, pkg.activityId);

  // ── 11.2 ask suppliers to price it ───────────────────────────────────────
  section("11.2  Request quotes — a bid package, lines from the BOQ");

  const bidPackages = await GET(procurement, `/projects/${P}/bids`);
  const bpRows = bidPackages.items || bidPackages;
  let bp = bpRows.find((b) => b.procurementPackageId === pkg.id || (b.title || "").includes(PKG_NUMBER)) ?? null;
  if (bp) {
    note("bid package exists, reusing", `${bp.ref} status=${bp.status}`);
  } else {
    bp = await POST(procurement, `/projects/${P}/procurement/packages/${pkg.id}/quotes`, {
      title: `${PKG_NUMBER} reinforcement supply`,
      description: "Price 60 t of HT bar delivered to site, cut and bent to schedule",
      instructions: "Quote per tonne, delivered. State lead time from order.",
      dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      currency: "USD",
    });
    note("bid package created", `${bp.ref} status=${bp.status}`);
  }
  ctx.bidPackageId = bp.id;
  // Persist as soon as the ids are known: an abort later in the stage must not
  // lose them, or the next run has to rediscover records it already made.
  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));

  let full = await GET(procurement, `/projects/${P}/bids/${bp.id}`);
  if (!(full.lines || []).length) {
    await POST(procurement, `/projects/${P}/bids/${bp.id}/lines/from-boq`, { boqItemIds: [ctx.boq["B-003"]] });
    full = await GET(procurement, `/projects/${P}/bids/${bp.id}`);
  }
  const lines = full.lines || [];
  check("one line, from the BOQ", 1, lines.length);
  check("it is B-003 with the bill quantity — not retyped", QTY, Number(lines[0]?.qty));
  check("it carries the internal estimate from the BOQ rate", cents(ESTIMATE_RATE), cents(lines[0]?.estimateRate));
  const lineId = lines[0].id;
  note("line", `${lines[0].code ?? "B-003"} ${lines[0].description} ${lines[0].qty} ${lines[0].unit} est ${lines[0].estimateRate}`);

  // ── 11.2b a directory vendor must be prequalified before it can bid ──────
  section("11.2b Prequalification — the directory supplier cannot be invited until assessed");

  const vendorId = ctx.companies.supplier.id;
  let assessment = await GET(pm, `/company/vendors/${vendorId}/prequalification`);
  if (assessment.qualified) {
    note("already qualified, reusing", `${assessment.status} valid until ${String(assessment.validUntil).slice(0, 10)}`);
  } else {
    // The gate is real: the first run of this stage was refused
    // 409 PREQUAL_NOT_QUALIFIED at the invitation step.
    const SCORES = {
      financial_capacity: [4, "Audited accounts FY25, positive net assets"],
      safety_history: [5, "LTIFR 0.0 over 24 months"],
      experience: [4, "Three comparable rebar supply contracts in the last 5 years"],
      references: [4, "Two client references, both satisfactory"],
      insurance: [5, "Public liability 10m, product liability 5m", "2027-12-31"],
      licenses: [5, "Trade licence and ISO 9001 certificate on file", "2027-06-30"],
      manpower: [4, "Cut-and-bend yard with two shifts"],
      equipment: [4, "Owned cutting and bending plant, delivery fleet"],
      quality_history: [4, "No material rejections on referenced contracts"],
    };
    for (const c of assessment.criteria || []) {
      const [score, note_, expiresAt] = SCORES[c.key] ?? [3, "Assessed"];
      await PATCH(pm, `/company/vendors/${vendorId}/prequalification/criteria/${c.key}`, {
        score,
        note: note_,
        reference: `${ctx.tag}-PQ-${c.key}`,
        ...(expiresAt ? { expiresAt } : {}),
      });
    }
    const decided = await POST(pm, `/company/vendors/${vendorId}/prequalification/decision`, {
      status: "approved",
      validUntil: "2028-01-01",
      decisionNote: "Approved for reinforcement and cement supply up to the single-award limit.",
      singleAwardLimit: 250_000,
    });
    note("decision", `${decided.status} valid until ${String(decided.validUntil).slice(0, 10)} score=${decided.score}`);
    assessment = await GET(pm, `/company/vendors/${vendorId}/prequalification`);
  }
  check("the supplier is qualified", true, Boolean(assessment.qualified));
  check("every required criterion is scored", (assessment.criteria || []).filter((c) => c.required).length, (assessment.criteria || []).filter((c) => c.required && c.score !== null && c.score !== undefined).length);
  check("the approval carries a validity date", true, Boolean(assessment.validUntil));
  ctx.prequalification = { status: assessment.status, effectiveStatus: assessment.effectiveStatus, validUntil: assessment.validUntil, score: assessment.score };

  // A site engineer must not be able to qualify a vendor.
  const pqBySite = await probe(site, "POST", `/company/vendors/${vendorId}/prequalification/decision`, { status: "approved", validUntil: "2028-01-01" });
  check("a site engineer cannot decide a prequalification", 403, pqBySite.status);

  // ── 11.3 invite three bidders, open the package, get their portal links ──
  section("11.3  Bidders — one from the directory, two ad hoc; then open it");

  let invitations = full.invitations || (await GET(procurement, `/projects/${P}/bids/${bp.id}`)).invitations || [];
  const missing = BIDDERS.filter((b) => !invitations.some((i) => i.contactEmail === b.contactEmail));
  if (missing.length) {
    const created = await POST(procurement, `/projects/${P}/bids/${bp.id}/invitations`, {
      invitations: missing.map(({ companyName, vendorCompanyId, contactName, contactEmail }) => ({ companyName, ...(vendorCompanyId ? { vendorCompanyId } : {}), contactName, contactEmail })),
    });
    invitations = [...invitations, ...(created.items || [])];
  }
  check("three bidders invited", 3, BIDDERS.filter((b) => invitations.some((i) => i.contactEmail === b.contactEmail)).length);
  const gulfInv = invitations.find((i) => i.contactEmail === BIDDERS[0].contactEmail);
  check("the directory supplier is invited as itself, not retyped", ctx.companies.supplier.id, gulfInv?.vendorCompanyId);

  if (full.status === "draft") {
    const pub = await probe(procurement, "POST", `/projects/${P}/bids/${bp.id}/publish`, {});
    note("publish", `${pub.status} ${pub.code ?? "ok"}`);
    if (!pub.ok) throw new Error(`publish failed: ${pub.status} ${pub.code} ${pub.message}`);
  }
  full = await GET(procurement, `/projects/${P}/bids/${bp.id}`);
  check("the package is open for bids", true, ["open", "closed", "awarded"].includes(full.status));

  // Personal links: re-issued through the product's own resend, since no
  // email leaves this machine.
  const tokens = {};
  for (const b of BIDDERS) {
    const inv = (full.invitations || invitations).find((i) => i.contactEmail === b.contactEmail);
    const re = await probe(procurement, "POST", `/projects/${P}/bids/${bp.id}/invitations/${inv.id}/resend`, {});
    tokens[b.key] = tokenFrom(re.data?.portalUrl);
    note(`  link for ${b.key}`, tokens[b.key] ? "issued" : `${re.status} ${re.code ?? "no portalUrl in response"}`);
  }
  if (["open"].includes(full.status)) {
    check("every bidder has a portal link", 3, Object.values(tokens).filter(Boolean).length);
  }

  // ── 11.4 three quotes through the public portal ──────────────────────────
  section("11.4  Quotes — priced through the public portal, by token, no login");

  ctx.quotes = {};
  for (const b of BIDDERS) {
    const token = tokens[b.key];
    if (!token) {
      note(`  ${b.key}`, "no token (package no longer open) — bid must already be in");
      continue;
    }
    // The portal withholds internal ids on purpose: a bidder sees the package
    // by reference and title, their own invitation, and nobody else's.
    const view = await portal("GET", token, "");
    check(`  ${b.key} sees this package, by reference`, bp.ref, view.data?.package?.ref);
    check(`  ${b.key} sees only their own invitation`, b.contactEmail, view.data?.invitation?.contactEmail);
    check(`  ${b.key} is not shown the package's internal id`, undefined, view.data?.package?.id);
    check(`  ${b.key} is not shown the buyer's estimate`, undefined, (view.data?.package?.lines || [])[0]?.estimateRate);
    const saved = await portal("PUT", token, "/bid", {
      lines: [{ packageLineId: lineId, rate: b.rate, included: true, note: null }],
      leadTimeDays: b.leadTimeDays,
      validityDays: b.key === "northern" ? 15 : 30,
      exclusions: b.exclusions,
      inclusions: b.exclusions ? null : "Delivered to site, offloaded, cut and bent to schedule",
    });
    if (saved.code === "BID_ALREADY_SUBMITTED") {
      note(`  ${b.key}`, "already submitted — left alone");
      continue;
    }
    if (!saved.ok) throw new Error(`${b.key} could not save a bid: ${saved.status} ${saved.code} ${saved.message}`);
    const submitted = await portal("POST", token, "/bid/submit", { submittedBy: b.contactName });
    if (!submitted.ok && submitted.code !== "BID_ALREADY_SUBMITTED") {
      throw new Error(`${b.key} could not submit: ${submitted.status} ${submitted.code} ${submitted.message}`);
    }
    ctx.quotes[b.key] = { total: cents(saved.data?.total ?? b.rate * QTY), rate: b.rate, lead: b.leadTimeDays };
    check(`  ${b.key} total is ${money(cents(b.rate * QTY))}`, cents(b.rate * QTY), cents(saved.data?.total ?? 0));
  }

  // ── 11.5 the comparison ──────────────────────────────────────────────────
  section("11.5  Leveling — three bids, ranked, against the estimate");

  const lev = await GET(procurement, `/projects/${P}/bids/${bp.id}/leveling`);
  const bidders = lev.bidders || [];
  check("three bidders on the leveling grid", 3, bidders.length);
  check("the estimate total is the BOQ amount 72,000.00", cents(QTY * ESTIMATE_RATE), cents(lev.estimateTotal));
  const byName = new Map(bidders.map((b) => [b.companyName, b]));
  const gulf = byName.get(BIDDERS[0].companyName);
  const emirates = byName.get(BIDDERS[1].companyName);
  const northern = byName.get(BIDDERS[2].companyName);
  check("Gulf Steel is ranked 1 on price", 1, Number(gulf?.rank));
  check("Gulf's total is 69,000.00", cents(69_000), cents(gulf?.total));
  check("Emirates' total is 74,400.00", cents(74_400), cents(emirates?.total));
  check("Northern's total is 71,400.00", cents(71_400), cents(northern?.total));
  check("lead times are carried onto the grid", 14, Number(emirates?.leadTimeDays));
  // Read off the bid record itself, not inferred from the bidder being present.
  const bidRecords = await GET(procurement, `/projects/${P}/bids/${bp.id}/bids`);
  const northernBid = (bidRecords.items || bidRecords).find((b) => b.companyName === BIDDERS[2].companyName);
  check("Northern's exclusion reached the buyer, verbatim", BIDDERS[2].exclusions, northernBid?.exclusions);
  check("Northern's shorter validity reached the buyer", 15, Number(northernBid?.validityDays));
  ctx.leveling = bidders.map((b) => ({ company: b.companyName, total: cents(b.total), rank: b.rank, lead: b.leadTimeDays }));

  // ── 11.6 award — not the lowest price, and say why ───────────────────────
  section("11.6  Award — the need date decides, not the lowest price");

  const bids = await GET(procurement, `/projects/${P}/bids/${bp.id}/bids`);
  const bidRows = bids.items || bids;
  const winning = bidRows.find((b) => b.companyName === BIDDERS[1].companyName);
  if (!winning) throw new Error(`no submitted bid for ${BIDDERS[1].companyName}: ${bidRows.map((b) => b.companyName).join(", ")}`);

  if (full.awardedBidId || full.status === "awarded") {
    note("already awarded, not repeating", full.awardedBidId ?? full.status);
    check("the award went to Emirates Rebar", winning.id, full.awardedBidId ?? full.softAwardBidId);
  } else {
    // A soft award closes bidding and can only be made once; on a re-run the
    // package is already closed with the selection recorded, so go straight
    // to confirming it.
    if (full.softAwardBidId) {
      note("soft award already recorded, not repeating", full.softAwardBidId);
      check("the soft award is Emirates Rebar's bid", winning.id, full.softAwardBidId);
    } else {
      const soft = await POST(pm, `/projects/${P}/bids/${bp.id}/award`, { bidId: winning.id });
      check("soft award selects Emirates Rebar", winning.id, soft.softAwardBidId ?? soft.awardedBidId);
    }
    note("  decision", "Gulf is 5,400.00 cheaper but quotes 35 days; the foundation pour needs bar by 2027-02-10 and Emirates delivers in 14. Northern excludes delivery.");

    // Emirates Rebar is an ad-hoc bidder with no directory company and so no
    // prequalification. The product refuses to award to an unqualified vendor
    // unless a PM overrides with a written reason — anyone may quote, only a
    // vetted vendor is awarded. Prove the refusal first, then use the override
    // the product provides for exactly this. The reason is the decision trace.
    const blocked = await probe(pm, "POST", `/projects/${P}/bids/${bp.id}/award/confirm`, {});
    check("awarding an unqualified ad-hoc bidder is refused without an override", 409, blocked.status);
    check("  and the refusal names the gate", "PREQUAL_AWARD_BLOCKED", blocked.code);
    ctx.awardGate = { status: blocked.status, code: blocked.code, details: blocked.details };

    const DECISION =
      "Gulf Steel is cheapest (69,000.00) but quotes a 35-day lead, missing the 2027-02-10 foundation need date. " +
      "Emirates Rebar (74,400.00) delivers in 14 days. Northern (71,400.00) is ex-works and excludes delivery. " +
      "Emirates is not yet in the vendor directory; awarded on PM override pending onboarding and prequalification.";
    const confirm = await probe(pm, "POST", `/projects/${P}/bids/${bp.id}/award/confirm`, {
      prequalOverrideReason: DECISION,
      title: `${PKG_NUMBER} reinforcement supply`,
    });
    note("  confirm with override", `${confirm.status} ${confirm.code ?? "ok"}`);
    if (!confirm.ok && confirm.status !== 409) throw new Error(`award confirm failed: ${confirm.status} ${confirm.code} ${confirm.message}`);
    ctx.awardDecision = DECISION;
  }
  full = await GET(procurement, `/projects/${P}/bids/${bp.id}`);
  check("the package is awarded", "awarded", full.status);
  check("the awarded bid is Emirates Rebar's", winning.id, full.awardedBidId);
  const losers = (await GET(procurement, `/projects/${P}/bids/${bp.id}/bids`));
  const loserRows = (losers.items || losers).filter((b) => b.id !== winning.id);
  check("the other two are marked unsuccessful", 2, loserRows.filter((b) => b.status === "unsuccessful").length);

  // ── 11.7 the purchase order, raised from the award ───────────────────────
  section("11.7  Purchase order — from the award, numbered by the counter, nothing retyped");

  const orders = await GET(procurement, `/projects/${P}/procurement/purchase-orders`);
  const orderRows = orders.items || orders;
  let po = orderRows.find((o) => o.packageId === pkg.id) ?? null;
  if (po) {
    note("PO already raised for this package, reusing", po.ref);
  } else if (full.awardedCommitmentId) {
    note("award created a commitment", full.awardedCommitmentId);
  }
  if (!po) {
    const raised = await probe(procurement, "POST", `/projects/${P}/procurement/packages/${pkg.id}/order`, {
      requiredBy: "2027-02-10",
      leadWeeks: 2,
    });
    note("  raise order", `${raised.status} ${raised.code ?? "ok"}`);
    if (!raised.ok) throw new Error(`raising the PO failed: ${raised.status} ${raised.code} ${raised.message}`);
    po = raised.data;
  }
  ctx.rfqPurchaseOrderId = po.id;
  note("PO", `${po.ref} status=${po.status} supplier=${po.supplier ?? po.supplierId}`);

  check("the PO reference is counter-generated (PO-nnnnn)", true, /^PO-\d{5}$/.test(String(po.ref)));
  const detail = await GET(procurement, `/projects/${P}/purchase-orders/${po.id}`);
  const poLine = (detail.lines || [])[0] ?? {};
  check("the PO carries the awarded quantity", QTY, Number(poLine.orderedQty ?? poLine.qty));
  check("the PO carries the awarded rate, 1,240.00", cents(1240), cents(poLine.unitCost ?? poLine.rate));
  check("PO value is 60 x 1,240.00 = 74,400.00", cents(74_400), cents(detail.value ?? detail.total ?? poLine.amount ?? 0));
  check("the PO line points at the foundation activity", ctx.activities.A130, poLine.activityId ?? detail.activityId);
  const supplierName = detail.supplier ?? detail.supplierRef?.name ?? detail.supplierName ?? "";
  check("the supplier on the PO is the awarded bidder", true, String(supplierName).includes("Emirates Rebar"));

  // The package link is on the register row, not on the detail read — which
  // is why the find-by-package above works and why this reads the register.
  // (The detail's silence about its package is recorded as P3.)
  const register = await GET(procurement, `/projects/${P}/procurement/purchase-orders`);
  const registerRow = (register.items || register).find((o) => o.id === po.id);
  check("the PO register links it back to the procurement package", pkg.id, registerRow?.packageId);
  check("  and carries the package's own number", PKG_NUMBER, registerRow?.package?.packageNumber);
  ctx.rfqObservations = {
    poDetailExposesPackage: Boolean(detail.packageId),
    packageStatusAfterOrder: registerRow?.package?.status ?? null,
  };

  // ── 11.8 who may not ─────────────────────────────────────────────────────
  const bySite = await probe(site, "POST", `/projects/${P}/bids/${bp.id}/award`, { bidId: winning.id });
  check("a site engineer cannot award a bid package", 403, bySite.status);

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 11 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
