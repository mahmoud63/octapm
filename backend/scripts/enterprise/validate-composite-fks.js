/**
 * M7 — the pre-flight for the tenant constraints (enterprise wave ENT-3).
 *
 *   node scripts/enterprise/validate-composite-fks.js                     # every table
 *   node scripts/enterprise/validate-composite-fks.js --tables Task,Meeting
 *   node scripts/enterprise/validate-composite-fks.js --org <id> --json <path>
 *
 * Read-only. Before a composite foreign key `(projectId, orgId) →
 * Project(id, orgId)` is added to a table, this script counts the rows the
 * constraint would refuse: a row whose project sits in another organisation
 * (a mismatch) or whose project no longer exists (an orphan). It does the
 * same for the org-side keys of the relation-less tables (rows whose orgId
 * names no organisation), for the master keys `(costCodeId, orgId) →
 * CostCode(id, orgId)`, and for the membership keys `(orgId, userId) →
 * OrganizationMembership(orgId, userId)` on ProjectAssignment and
 * ProjectUserPermission.
 *
 * Any non-zero count is a §134 stop for that table: the process exits 1 and
 * the batch that holds the table must not be applied. The script never
 * "fixes" a row — who owns a mismatched row is a product decision, not a
 * migration's.
 *
 * The table list is read from the database, not hard-coded: every table
 * carrying both a projectId and an orgId column is checked, except the four
 * event/log tables that keep rows of deleted organisations by design
 * (architecture doc §4: BackgroundJob, OutboundEvent, AuditEvent,
 * RecordHistorySnapshot) and AuthAuditEvent, whose orgId is nullable by
 * design. Those five are reported by sweep-orphan-tenant-rows.js instead.
 */
const fs = require("fs");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../src/config/db");
const { defaultReportPath, parseArgs, printHeader, printResult } = require("./lib");

/** No FK on the org side, ever (architecture doc §4); AuthAuditEvent is nullable by design. */
const NEVER = ["BackgroundJob", "OutboundEvent", "AuditEvent", "RecordHistorySnapshot", "AuthAuditEvent"];

/**
 * Org-side keys added by this wave: the tables that carried an orgId with no
 * key behind it — ten without a project column, eight relation-less
 * project tables, and ApprovalWorkflowEvent (project key only) — plus the
 * two PC-6 tables born with both keys (migration 20261005050000) and the
 * PC-7b ProjectException (migration 20261005060000). A table the database
 * does not have yet is reported as pending, not counted.
 */
const ORG_ONLY = [
  "Signature",
  "DailyLogManpower",
  "DailyLogEquipment",
  "DailyLogDelivery",
  "DailyLogVisitor",
  "DailyLogDelay",
  "DailyLogNote",
  "DailyLogQuantity",
  "QuantityProgressEntry",
  "ProjectException",
  "RfiResponse",
  "ApprovalWorkflowEvent",
  "NotificationDeliveryAttempt",
  "BidPackageLine",
  "BidAddendum",
  "BidInvitation",
  "BidQuestion",
  "Bid",
  "BidLine",
  "AssistantMessage",
  "PrequalCriterion",
  "EvaluationCriterion",
];

/** Project rows that name an organisation cost code (ProjectException: PC-7b, born with the key; pending until applied). */
const COST_CODE_TABLES = ["BudgetLine", "ProjectCostCode", "CommitmentSovLine", "TimeEntry", "ChangeEventLine", "DirectCostLine", "ProjectException"];

const rows = (sql) => prisma.$queryRaw(sql);
const count = async (sql) => Number((await rows(sql))[0].count);
const ident = (name) => Prisma.raw(`"${String(name).replace(/"/g, '""')}"`);

/** Every table with both tenant columns, in name order. */
const dualColumnTables = async () => {
  const found = await rows(Prisma.sql`
    SELECT c.table_name AS name
    FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.column_name IN ('projectId', 'orgId')
    GROUP BY c.table_name HAVING count(DISTINCT c.column_name) = 2
    ORDER BY c.table_name`);
  return found.map((row) => row.name).filter((name) => !NEVER.includes(name) && !name.startsWith("_"));
};

const checks = {
  /** (projectId, orgId) → Project(id, orgId): a project in another org, or no project at all. */
  async project(table, { orgId }) {
    const t = ident(table);
    const scope = orgId ? Prisma.sql`AND t."orgId" = ${orgId}` : Prisma.empty;
    const total = await count(Prisma.sql`SELECT count(*)::int AS count FROM ${t} t WHERE t."projectId" IS NOT NULL ${scope}`);
    const mismatched = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM ${t} t JOIN "Project" p ON p."id" = t."projectId"
      WHERE p."orgId" <> t."orgId" ${scope}`);
    const orphaned = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM ${t} t LEFT JOIN "Project" p ON p."id" = t."projectId"
      WHERE t."projectId" IS NOT NULL AND p."id" IS NULL ${scope}`);
    return { table, key: "(projectId, orgId) → Project", total, mismatched, orphaned };
  },

  /** orgId → Organisation(id): rows of an organisation that no longer exists. */
  async organisation(table, { orgId }) {
    const t = ident(table);
    const scope = orgId ? Prisma.sql`AND t."orgId" = ${orgId}` : Prisma.empty;
    const total = await count(Prisma.sql`SELECT count(*)::int AS count FROM ${t} t WHERE true ${scope}`);
    const orphaned = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM ${t} t LEFT JOIN "Organisation" o ON o."id" = t."orgId"
      WHERE o."id" IS NULL ${scope}`);
    return { table, key: "orgId → Organisation", total, mismatched: 0, orphaned };
  },

  /** (costCodeId, orgId) → CostCode(id, orgId): a cost code of another organisation, or none. */
  async costCode(table, { orgId }) {
    const t = ident(table);
    const scope = orgId ? Prisma.sql`AND t."orgId" = ${orgId}` : Prisma.empty;
    const total = await count(Prisma.sql`SELECT count(*)::int AS count FROM ${t} t WHERE t."costCodeId" IS NOT NULL ${scope}`);
    const mismatched = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM ${t} t JOIN "CostCode" c ON c."id" = t."costCodeId"
      WHERE c."orgId" <> t."orgId" ${scope}`);
    const orphaned = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM ${t} t LEFT JOIN "CostCode" c ON c."id" = t."costCodeId"
      WHERE t."costCodeId" IS NOT NULL AND c."id" IS NULL ${scope}`);
    return { table, key: "(costCodeId, orgId) → CostCode", total, mismatched, orphaned };
  },

  /**
   * (orgId, userId) → OrganizationMembership: the §50 row
   * assignments_have_membership, read here through the project's organisation
   * because ProjectAssignment.orgId may still be NULL on rows written before
   * M7 fills it.
   */
  async assignmentMembership(_table, { orgId }) {
    const scope = orgId ? Prisma.sql`AND p."orgId" = ${orgId}` : Prisma.empty;
    const total = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM "ProjectAssignment" pa JOIN "Project" p ON p."id" = pa."projectId" WHERE true ${scope}`);
    const mismatched = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM "ProjectAssignment" pa JOIN "Project" p ON p."id" = pa."projectId"
      LEFT JOIN "OrganizationMembership" m ON m."orgId" = p."orgId" AND m."userId" = pa."userId"
      WHERE m."id" IS NULL ${scope}`);
    const unfilled = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM "ProjectAssignment" pa JOIN "Project" p ON p."id" = pa."projectId"
      WHERE pa."orgId" IS NULL ${scope}`);
    return { table: "ProjectAssignment", key: "(orgId, userId) → OrganizationMembership", total, mismatched, orphaned: 0, note: `${unfilled} with orgId still NULL (filled by the migration)` };
  },

  async permissionMembership(_table, { orgId }) {
    const scope = orgId ? Prisma.sql`AND x."orgId" = ${orgId}` : Prisma.empty;
    const total = await count(Prisma.sql`SELECT count(*)::int AS count FROM "ProjectUserPermission" x WHERE true ${scope}`);
    const mismatched = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM "ProjectUserPermission" x
      LEFT JOIN "OrganizationMembership" m ON m."orgId" = x."orgId" AND m."userId" = x."userId"
      WHERE m."id" IS NULL ${scope}`);
    return { table: "ProjectUserPermission", key: "(orgId, userId) → OrganizationMembership", total, mismatched, orphaned: 0 };
  },
};

const main = async () => {
  const args = parseArgs();
  const argv = process.argv.slice(2);
  const tablesFlag = argv.indexOf("--tables");
  const only = tablesFlag === -1 ? null : new Set(String(argv[tablesFlag + 1] || "").split(",").map((s) => s.trim()).filter(Boolean));
  printHeader("OctaPM composite foreign key pre-flight (M7)", { apply: false, orgId: args.orgId });
  if (args.apply) console.log("(--apply is not a thing here: this script only reads)\n");

  const context = { orgId: args.orgId };
  const results = [];
  const wanted = (table) => !only || only.has(table);

  for (const table of await dualColumnTables()) {
    if (wanted(table)) results.push(await checks.project(table, context));
  }
  const present = new Set((await rows(Prisma.sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()`)).map((row) => row.name));
  for (const table of ORG_ONLY) {
    if (!wanted(table)) continue;
    if (!present.has(table)) { console.log(`pending ${table}: not in this database yet (its migration is not applied); skipped`); continue; }
    results.push(await checks.organisation(table, context));
  }
  for (const table of COST_CODE_TABLES) {
    if (!wanted(table)) continue;
    if (!present.has(table)) { console.log(`pending ${table}: not in this database yet (its migration is not applied); cost-code key skipped`); continue; }
    results.push(await checks.costCode(table, context));
  }
  if (wanted("ProjectAssignment")) results.push(await checks.assignmentMembership(null, context));
  if (wanted("ProjectUserPermission")) results.push(await checks.permissionMembership(null, context));

  const width = Math.max(...results.map((item) => item.table.length));
  for (const item of results) {
    const bad = item.mismatched + item.orphaned;
    console.log(
      `${bad ? "STOP " : "ok   "}${item.table.padEnd(width)}  ${item.key.padEnd(44)} rows ${String(item.total).padStart(8)}  mismatched ${String(item.mismatched).padStart(6)}  orphaned ${String(item.orphaned).padStart(6)}${item.note ? `  (${item.note})` : ""}`,
    );
  }

  const stops = results.filter((item) => item.mismatched + item.orphaned > 0);
  const report = { generatedAt: new Date().toISOString(), orgId: args.orgId, ok: stops.length === 0, stops: stops.map((item) => item.table), rows: results };
  const jsonPath = args.jsonPath || defaultReportPath("composite-fk-preflight");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\n${stops.length ? `${stops.length} table(s) STOP — do not apply their batch` : `No mismatches across ${results.length} checks`}. Report written to ${jsonPath}`);

  printResult({ ok: report.ok, checks: results.length, stops: report.stops, jsonPath });
  if (stops.length) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
