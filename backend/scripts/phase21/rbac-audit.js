/**
 * Empirical RBAC audit: for every project-nested route prefix, a role that the
 * policy does NOT allow to create/delete sends an intentionally invalid body.
 * A present guard answers 403 before validation; a missing guard answers 400
 * (validation) or 404 (not found) — i.e. the request got through the door.
 */
const { probe } = require("./harness");
const ctx = require("./context.json");
const P = ctx.projectId;
const NIL = "00000000-0000-4000-8000-000000000000";
const PREFIXES = ["boq","budget-revisions","cash-flow","correspondence","defects","drawings","itp","long-lead","material-tests","sub-valuations","transmittals","weather-delays","weekly-reports","jobs","assignments","team","quality","submittals","ncr","safety","punch","rfi","meetings","tasks","photos","daily-logs","timesheets","locations","risks","commitments","pay-apps","ipc","eot","change-orders","direct-costs","purchase-orders","procurement/packages","cost/codes","budget/lines","forecast","lookaheads","site-diaries","daily-reports","specifications","form-templates","forms","bim","change-events","equipment","contract","activities","comments","custom-fields","inventory/items"];
(async () => {
  const out = [];
  for (const [label, who] of [["warehouse", ctx.people.warehouse], ["finance", ctx.people.finance]]) {
    for (const pre of PREFIXES) {
      const c = await probe(who, "POST", `/projects/${P}/${pre}`, {});
      const d = await probe(who, "DELETE", `/projects/${P}/${pre}/${NIL}`, {});
      const through = (s) => s !== 403 && s !== 401 && s !== 404 || false;
      const doorOpen = (c.status === 400 || c.status === 201 || c.status === 200) || (d.status === 400 || d.status === 200 || (d.status === 404 && /NOT_FOUND/.test(d.code) && !/ROUTE|Route/.test(d.message || "")));
      out.push({ role: label, prefix: pre, post: `${c.status} ${c.code}`, del: `${d.status} ${d.code}`, doorOpen });
    }
  }
  const open = out.filter((r) => r.doorOpen);
  console.log("prefix".padEnd(22), "role".padEnd(10), "POST {}".padEnd(28), "DELETE nil");
  for (const r of out) console.log(r.prefix.padEnd(22), r.role.padEnd(10), r.post.padEnd(28), r.del, r.doorOpen ? "  <-- UNGUARDED" : "");
  console.log(`\nunguarded (role got past the door): ${open.length} of ${out.length}`);
  require("fs").writeFileSync("rbac-audit.json", JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
