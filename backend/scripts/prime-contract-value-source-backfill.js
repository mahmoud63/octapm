/**
 * Owner decisions 1 + 4 (2026-09-29) — classify where each existing client
 * contract's original value came from (PrimeContract.originalValueSource,
 * migration 20261005045000_prime_contract_original_value_source).
 *
 *   node scripts/prime-contract-value-source-backfill.js              # dry run: report only
 *   node scripts/prime-contract-value-source-backfill.js --apply
 *   node scripts/prime-contract-value-source-backfill.js --apply --out <file.json>
 *
 * The classification is not computed here. It was made by hand, read-only,
 * from each contract's creation path and its history (see PLAN): the audit
 * trail of the contract's creation and of every contract.manage edit, the
 * project row's own write history, the BOQ's audit trail and timestamps, and
 * the seed or driver script that built the project. It is never inferred from
 * the current amount matching the project value or the BOQ total — the
 * showcase project's bill equals its contract value by construction, so that
 * test would say nothing.
 *
 * The write is one transaction:
 *   - each planned row is locked by its primary key and must still carry the
 *     organisation, project, reference and original value the classification
 *     was made against, and a source that is NULL or already the planned one
 *     (a re-run is a no-op); anything else aborts before a row is written;
 *   - every column of every PrimeContract row in the table is snapshotted;
 *   - each row is written by `WHERE "id" = $1 AND "originalValueSource" IS
 *     NULL`, setting that one column and nothing else (raw SQL, so updatedAt
 *     does not move either);
 *   - the snapshot is taken again and every column other than
 *     originalValueSource — originalValue, approvedChangesValue,
 *     pendingChangesValue, revisedValue, advanceAmount, advancePaidAmount,
 *     advanceRecoveredAmount, every rate — must be byte-identical, or the
 *     transaction rolls back.
 *
 * A contract that is not in the plan is left NULL, which reads as
 * unestablished (the restrictive disclosure). Reversal: set the column back
 * to NULL on the planned ids.
 */
require("../src/utils/data-script-guard").exitUnlessDataScriptAllowed("prime-contract:value-source-backfill");

const fs = require("fs");
const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../src/config/db");

const SOURCES = ["project_value", "contract_entry", "boq_fallback", "unestablished"];

// ensureContract (services/prime-contract.service.js) is the only code that
// has ever created a PrimeContract on this branch; since 19815e6 it has set
// originalValue = num(project.contractValue) || the active BOQ total. So a
// contract is project_value when the project carried a non-zero value at the
// moment of creation, and boq_fallback when it did not. contract_entry needs
// a contract.manage event that changed originalValue (the audit trail does
// not record a PATCH that re-sent the same value, so it cannot be claimed
// from an event whose old and new value agree).
const PLAN = [
  {
    contractId: "29d409d9-998b-410e-ba68-9616c4470469",
    orgId: "6193440d-d272-469a-929a-45e323efc558",
    projectId: "95c188f3-bd97-4d28-b466-17aa354ee24a",
    ref: "RT-2026-014",
    originalValue: "9290000.00",
    source: "project_value",
    evidence:
      "Project created 2026-09-06 by prisma/seed.js with contractValue 9,290,000 and three BOQ rows " +
      "(1,281,000 + 3,408,000 + 3,038,000 = 7,727,000). Contract created 2026-09-07T14:28:33.094Z by " +
      "ensureContract inside the first PATCH; that PATCH's contract.manage event (14:28:33.114Z) records " +
      "oldSummary.originalValue 9,290,000 — the value ensureContract computed. The only BOQ audit events " +
      "before then (2026-09-06T16:34, B-200 and B-300) left every amount unchanged and no BOQ row was created " +
      "later, so the BOQ fallback would have produced 7,727,000, not 9,290,000: the project branch was taken. " +
      "None of the 346 contract.manage events changed originalValue.",
  },
  {
    contractId: "de2d970d-de00-4be3-aa6b-1101e6b35b72",
    orgId: "6193440d-d272-469a-929a-45e323efc558",
    projectId: "0ce999f2-b175-432b-8551-20182b4fc990",
    ref: "P21-20260910093852-C-001",
    originalValue: "2000000.00",
    source: "project_value",
    evidence:
      "Project created 2026-09-10T14:38:55.414Z by scripts/phase21/stage1-foundation.js with contractValue " +
      "2,000,000; the project row's updatedAt (14:38:55.436Z) predates the contract, so the value at creation " +
      "is the current 2,000,000. Contract created 2026-09-12T22:14:26.904Z by ensureContract on the first " +
      "GET in scripts/phase21/stage10-client.js, which asserted 'original value is the project's contract " +
      "value'. BOQ total 459,000 with every row last written 2026-09-10. None of the 15 contract.manage " +
      "events changed originalValue.",
  },
  {
    contractId: "7cf951d6-686b-4760-bbb4-a64ed8a73d67",
    orgId: "6193440d-d272-469a-929a-45e323efc558",
    projectId: "cb4f705c-03c9-4a4e-9963-8d2c44a1f348",
    ref: "RT-2026-014-2",
    originalValue: "9290000.00",
    source: "project_value",
    evidence:
      "Project created 2026-09-15T22:53:22.507Z by prisma/seed.js (Phase 22B clean Riverside) with " +
      "contractValue 9,290,000; the project row has never been written since (updatedAt = createdAt). " +
      "Contract created 2026-09-16T05:32:31.611Z by ensureContract on a first read, never edited (no " +
      "contract.manage event). BOQ total 7,727,000, every row last written 2026-09-15T22:53:22.630Z.",
  },
  {
    contractId: "3bcf70a9-d9fd-4f49-847f-66e23a6fecde",
    orgId: "6193440d-d272-469a-929a-45e323efc558",
    projectId: "4735659e-cfd0-464d-a0b2-21c4b23960fc",
    ref: "MBR-2025-014",
    originalValue: "46001550.00",
    source: "project_value",
    evidence:
      "Project created 2026-09-26T13:09:02.617Z by scripts/demo/seed-showcase-project.js (POST /projects " +
      "with contractValue CONTRACT_VALUE = 46,001,550); the project row was last written " +
      "2026-09-26T13:15:47.281Z, before the contract, so its value at creation was the current non-zero " +
      "46,001,550 and ensureContract's `num(project.contractValue) || boqTotal` never reached the BOQ. " +
      "The bill equals the contract value by the script's construction, so the amounts alone prove nothing " +
      "and were not used. Contract created 2026-09-27T15:38:50.762Z on a first read, never edited.",
  },
];

const parseArgs = () => {
  const argv = process.argv.slice(2);
  const outAt = argv.indexOf("--out");
  return { apply: argv.includes("--apply"), out: outAt >= 0 ? argv[outAt + 1] : null };
};

const MONEY_AND_RATES = [
  "originalValue",
  "approvedChangesValue",
  "pendingChangesValue",
  "revisedValue",
  "retentionRate",
  "retentionCapRate",
  "advanceRate",
  "advanceAmount",
  "advancePaidAmount",
  "advanceRecoveryRate",
  "advanceRecoveredAmount",
  "materialsOnSiteRate",
  "taxRate",
  "updatedAt",
];

// Every column of every contract, keyed by id. `rest` is the whole row but
// originalValueSource as Postgres renders it (jsonb keeps each numeric's own
// text, so 9290000.00 is compared as written, never through a float).
const snapshot = async (tx) => {
  const rows = await tx.$queryRaw(Prisma.sql`
    SELECT "id", "originalValueSource" AS "source",
           (to_jsonb(pc) - 'originalValueSource')::text AS "rest"
    FROM "PrimeContract" pc ORDER BY "id"`);
  return new Map(rows.map((r) => [r.id, r]));
};

const figures = (row) => {
  const all = JSON.parse(row.rest);
  return Object.fromEntries(MONEY_AND_RATES.map((key) => [key, all[key] ?? null]));
};

const digest = (map) =>
  crypto
    .createHash("sha256")
    .update([...map.values()].map((row) => `${row.id} ${row.rest}`).join("\n"))
    .digest("hex");

class Abort extends Error {}

const main = async () => {
  const args = parseArgs();
  console.log(`\nPrimeContract.originalValueSource backfill — ${args.apply ? "APPLY" : "dry run"}\n`);

  const column = await prisma.$queryRaw(Prisma.sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'PrimeContract' AND column_name = 'originalValueSource'`);
  if (!column.length) throw new Error("originalValueSource does not exist: apply the migration first");

  for (const row of PLAN) {
    if (!SOURCES.includes(row.source)) throw new Error(`${row.contractId}: unknown source ${row.source}`);
  }

  const evidence = { apply: args.apply, at: new Date().toISOString(), plan: [], unplanned: [] };

  const run = async (tx) => {
    const before = await snapshot(tx);
    for (const row of PLAN) {
      const [live] = await tx.$queryRaw(Prisma.sql`
        SELECT "id", "orgId", "projectId", "ref", "originalValue"::text AS "originalValue", "originalValueSource"
        FROM "PrimeContract" WHERE "id" = ${row.contractId} FOR UPDATE`);
      const problems = [];
      if (!live) problems.push("row not found");
      else {
        for (const key of ["orgId", "projectId", "ref", "originalValue"]) {
          if (live[key] !== row[key]) problems.push(`${key} is ${live[key]}, planned ${row[key]}`);
        }
        if (live.originalValueSource !== null && live.originalValueSource !== row.source) {
          problems.push(`source already ${live.originalValueSource}`);
        }
      }
      const entry = {
        contractId: row.contractId,
        projectId: row.projectId,
        ref: row.ref,
        originalValue: row.originalValue,
        currentSource: live ? live.originalValueSource : null,
        classification: row.source,
        evidence: row.evidence,
        problems,
      };
      evidence.plan.push(entry);
      console.log(`${row.ref.padEnd(26)} ${row.originalValue.padStart(14)}  ${String(entry.currentSource).padEnd(14)} → ${row.source}${problems.length ? `   REFUSED: ${problems.join("; ")}` : ""}`);
    }
    if (evidence.plan.some((e) => e.problems.length)) throw new Abort("a planned row no longer matches; nothing written");

    for (const id of before.keys()) {
      if (!PLAN.some((row) => row.contractId === id) && before.get(id).source === null) {
        evidence.unplanned.push(id);
      }
    }
    if (evidence.unplanned.length) {
      console.log(`\n${evidence.unplanned.length} contract(s) outside the plan stay NULL (read as unestablished): ${evidence.unplanned.join(", ")}`);
    }

    if (!args.apply) throw new Abort("dry run");

    for (const row of PLAN) {
      const written = await tx.$executeRaw(Prisma.sql`
        UPDATE "PrimeContract" SET "originalValueSource" = ${row.source}
        WHERE "id" = ${row.contractId} AND "originalValueSource" IS NULL`);
      const entry = evidence.plan.find((e) => e.contractId === row.contractId);
      entry.written = written;
      if (written > 1) throw new Error(`${row.contractId}: ${written} rows written`);
    }

    const after = await snapshot(tx);
    const changed = [];
    for (const [id, row] of before) {
      const next = after.get(id);
      if (!next || next.rest !== row.rest) changed.push(id);
    }
    if (after.size !== before.size) changed.push("row count");
    evidence.snapshot = {
      rows: before.size,
      beforeSha256: digest(before),
      afterSha256: digest(after),
      monetary: PLAN.map((row) => {
        const b = before.get(row.contractId);
        const a = after.get(row.contractId);
        return {
          contractId: row.contractId,
          before: figures(b),
          after: figures(a),
          sourceBefore: b.source,
          sourceAfter: a.source,
        };
      }),
    };
    if (changed.length) throw new Error(`columns other than originalValueSource changed on ${changed.join(", ")}; rolled back`);
    console.log(`\nsnapshot of ${before.size} contract row(s): every other column identical (sha256 ${evidence.snapshot.beforeSha256})`);
  };

  try {
    await prisma.$transaction(run, { timeout: 60_000 });
    evidence.committed = true;
    console.log("committed");
  } catch (error) {
    if (!(error instanceof Abort)) throw error;
    evidence.committed = false;
    console.log(`\nnot written: ${error.message}`);
    if (args.apply) process.exitCode = 1;
  }

  if (args.out) fs.writeFileSync(args.out, `${JSON.stringify(evidence, null, 2)}\n`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
