/**
 * The §50 membership validation report (membership doc §7 table).
 *
 *   node scripts/enterprise/validate-membership-backfill.js                # report
 *   node scripts/enterprise/validate-membership-backfill.js --apply        # report + the listed repairs
 *   node scripts/enterprise/validate-membership-backfill.js --org <id> --json <path>
 *
 * Every row of the table is computed live against the database, printed, and
 * written as JSON (to --json, or the OS temp folder). A row is `ok`, `info`
 * (listed for the operator), `warn` (a gap the later steps would trip on) or
 * `stop` — the §134 condition: a user without a membership, a role outside the
 * catalogue, an owner who is not an administrator, or a duplicate e-mail. The
 * process exits 1 when any row stops, so a pipeline halts on it.
 *
 * --apply performs exactly the repairs the table names and nothing else:
 * revoke the whole session family of a live refresh session whose
 * organisation the person no longer belongs to (every link of its rotation
 * chain, not just the mismatched one), revoke an API key whose owner has no
 * membership there, and give a party member without a membership a guest one.
 * Each is idempotent: the next dry run finds the row clean.
 *
 * Identity-level checks (duplicate e-mails, slug uniqueness) are always
 * global; --org narrows the organisation-level ones.
 */
require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("enterprise:validate-membership-backfill");

const fs = require("fs");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../src/config/db");
const { CATALOGUE_ROLES, GUEST_ROLE, MEMBERSHIP_KINDS } = require("../../src/services/membership.service");
const { DEFAULT_TEMPLATES } = require("../../src/services/permission-template.service");
const { defaultReportPath, parseArgs, printHeader, printResult } = require("./lib");

const MAX_LISTED = 25;

const rows = async (sql) => prisma.$queryRaw(sql);
const count = async (sql) => Number((await rows(sql))[0].count);
const orgFilter = (column, orgId) => (orgId ? Prisma.sql`AND ${column} = ${orgId}` : Prisma.empty);

const row = (check, expected, actual, status, details = [], note = null) => ({
  check,
  expected,
  actual,
  status,
  details: details.slice(0, MAX_LISTED),
  detailCount: details.length,
  ...(note ? { note } : {}),
});

const checks = {
  /** users == memberships (1:1): any user without a membership in their organisation → stop. */
  async users_have_membership({ orgId }) {
    const users = await count(Prisma.sql`SELECT count(*)::int AS count FROM "User" u WHERE true ${orgFilter(Prisma.sql`u."orgId"`, orgId)}`);
    const memberships = await count(
      Prisma.sql`SELECT count(*)::int AS count FROM "OrganizationMembership" m WHERE true ${orgFilter(Prisma.sql`m."orgId"`, orgId)}`,
    );
    const missing = await rows(Prisma.sql`
      SELECT u."id", u."email", u."orgId" FROM "User" u
      LEFT JOIN "OrganizationMembership" m ON m."orgId" = u."orgId" AND m."userId" = u."id"
      WHERE m."id" IS NULL ${orgFilter(Prisma.sql`u."orgId"`, orgId)} ORDER BY u."createdAt"`);
    return row("users_have_membership", `${users} == ${users}`, `${users} users, ${memberships} memberships, ${missing.length} without`, missing.length ? "stop" : "ok", missing);
  },

  /** every membership.role in the catalogue (guests: external_party) → stop, list. */
  async roles_in_catalogue({ orgId }) {
    const total = await count(
      Prisma.sql`SELECT count(*)::int AS count FROM "OrganizationMembership" m WHERE true ${orgFilter(Prisma.sql`m."orgId"`, orgId)}`,
    );
    const bad = await rows(Prisma.sql`
      SELECT m."id", m."orgId", m."userId", m."role", m."kind" FROM "OrganizationMembership" m
      WHERE NOT (
        (m."kind" = ${MEMBERSHIP_KINDS.MEMBER} AND m."role" IN (${Prisma.join(CATALOGUE_ROLES)}))
        OR (m."kind" = ${MEMBERSHIP_KINDS.GUEST} AND m."role" = ${GUEST_ROLE})
      ) ${orgFilter(Prisma.sql`m."orgId"`, orgId)}`);
    return row("roles_in_catalogue", `${total} of ${total}`, `${total - bad.length} of ${total}`, bad.length ? "stop" : "ok", bad);
  },

  /** every organisation has ≥ 1 active owner → list (expected 0 without). */
  async org_has_active_owner({ orgId }) {
    const orgs = await count(Prisma.sql`SELECT count(*)::int AS count FROM "Organisation" o WHERE true ${orgFilter(Prisma.sql`o."id"`, orgId)}`);
    const without = await rows(Prisma.sql`
      SELECT o."id", o."name" FROM "Organisation" o
      WHERE NOT EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."orgId" = o."id" AND m."isOwner" AND m."status" = 'active')
      ${orgFilter(Prisma.sql`o."id"`, orgId)} ORDER BY o."createdAt"`);
    return row("org_has_active_owner", `${orgs} of ${orgs}`, `${orgs - without.length} of ${orgs}`, without.length ? "warn" : "ok", without);
  },

  /** every organisation has ≥ 1 active admin; promotions the owner rule made are listed. */
  async org_has_active_admin({ orgId }) {
    const orgs = await count(Prisma.sql`SELECT count(*)::int AS count FROM "Organisation" o WHERE true ${orgFilter(Prisma.sql`o."id"`, orgId)}`);
    const without = await rows(Prisma.sql`
      SELECT o."id", o."name" FROM "Organisation" o
      WHERE NOT EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."orgId" = o."id" AND m."isAdmin" AND m."status" = 'active')
      ${orgFilter(Prisma.sql`o."id"`, orgId)} ORDER BY o."createdAt"`);
    const promoted = await rows(Prisma.sql`
      SELECT m."orgId", o."name" AS "orgName", m."userId", u."email", m."role" FROM "OrganizationMembership" m
      JOIN "User" u ON u."id" = m."userId" JOIN "Organisation" o ON o."id" = m."orgId"
      WHERE m."isAdmin" AND NOT u."isCompanyAdmin" AND u."orgId" = m."orgId" ${orgFilter(Prisma.sql`m."orgId"`, orgId)}`);
    const details = [...without.map((org) => ({ ...org, problem: "no active admin" })), ...promoted.map((item) => ({ ...item, promoted: true }))];
    return row("org_has_active_admin", `${orgs} of ${orgs}`, `${orgs - without.length} of ${orgs}; ${promoted.length} promoted`, without.length ? "warn" : "ok", details);
  },

  /** isOwner ⇒ isAdmin → stop. */
  async owner_implies_admin({ orgId }) {
    const bad = await rows(Prisma.sql`
      SELECT m."id", m."orgId", m."userId" FROM "OrganizationMembership" m
      WHERE m."isOwner" AND NOT m."isAdmin" ${orgFilter(Prisma.sql`m."orgId"`, orgId)}`);
    return row("owner_implies_admin", "all", bad.length ? `${bad.length} owner(s) not admin` : "all", bad.length ? "stop" : "ok", bad);
  },

  /**
   * live RefreshSession rows whose person has no membership in the session's
   * organisation → revoke the session family (membership doc §7). A rotated
   * chain (replacedBySessionId, both directions) is one sign-in; revoking the
   * mismatched link alone would leave its predecessor or successor usable, so
   * the whole family goes, whichever organisation each link names.
   */
  async refresh_sessions_match_membership({ orgId, apply }) {
    const mismatched = await rows(Prisma.sql`
      SELECT rs."id", rs."orgId", rs."userId" FROM "RefreshSession" rs
      LEFT JOIN "OrganizationMembership" m ON m."orgId" = rs."orgId" AND m."userId" = rs."userId"
      WHERE rs."revokedAt" IS NULL AND rs."expiresAt" > now() AND m."id" IS NULL ${orgFilter(Prisma.sql`rs."orgId"`, orgId)}`);
    let revoked = 0;
    if (apply && mismatched.length) {
      revoked = await prisma.$executeRaw(Prisma.sql`
        WITH RECURSIVE family AS (
          SELECT rs."id", rs."replacedBySessionId" FROM "RefreshSession" rs
          WHERE rs."id" IN (${Prisma.join(mismatched.map((item) => item.id))})
          UNION
          SELECT rs."id", rs."replacedBySessionId" FROM "RefreshSession" rs
          JOIN family f ON rs."id" = f."replacedBySessionId" OR rs."replacedBySessionId" = f."id"
        )
        UPDATE "RefreshSession" rs SET "revokedAt" = now(), "updatedAt" = now()
        FROM family f WHERE rs."id" = f."id" AND rs."revokedAt" IS NULL`);
    }
    return row("refresh_sessions_match_membership", "0 mismatches", `${mismatched.length} mismatches${apply ? `, ${revoked} revoked (families)` : ""}`, mismatched.length ? "warn" : "ok", mismatched);
  },

  /** ProjectAssignment.user has a membership in the project's organisation → list (would block the M7 FK). */
  async assignments_have_membership({ orgId }) {
    const total = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM "ProjectAssignment" pa JOIN "Project" p ON p."id" = pa."projectId"
      WHERE true ${orgFilter(Prisma.sql`p."orgId"`, orgId)}`);
    const missing = await rows(Prisma.sql`
      SELECT pa."id", pa."projectId", pa."userId", p."orgId" FROM "ProjectAssignment" pa
      JOIN "Project" p ON p."id" = pa."projectId"
      LEFT JOIN "OrganizationMembership" m ON m."orgId" = p."orgId" AND m."userId" = pa."userId"
      WHERE m."id" IS NULL ${orgFilter(Prisma.sql`p."orgId"`, orgId)}`);
    return row("assignments_have_membership", `${total} of ${total}`, `${total - missing.length} of ${total}`, missing.length ? "warn" : "ok", missing);
  },

  /** ProjectPartyMember.user has a membership in the party's project organisation → create a guest one. */
  async party_members_have_membership({ orgId, apply }) {
    const total = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM "ProjectPartyMember" pm
      JOIN "ProjectParty" pp ON pp."id" = pm."projectPartyId" JOIN "Project" p ON p."id" = pp."projectId"
      WHERE true ${orgFilter(Prisma.sql`p."orgId"`, orgId)}`);
    const missing = await rows(Prisma.sql`
      SELECT DISTINCT ON (p."orgId", pm."userId") pm."id", pm."userId", p."orgId", pm."acceptedAt", pm."createdAt"
      FROM "ProjectPartyMember" pm
      JOIN "ProjectParty" pp ON pp."id" = pm."projectPartyId" JOIN "Project" p ON p."id" = pp."projectId"
      LEFT JOIN "OrganizationMembership" m ON m."orgId" = p."orgId" AND m."userId" = pm."userId"
      WHERE m."id" IS NULL ${orgFilter(Prisma.sql`p."orgId"`, orgId)}
      ORDER BY p."orgId", pm."userId", pm."createdAt"`);
    let created = 0;
    if (apply && missing.length) {
      created = (await prisma.organizationMembership.createMany({
        data: missing.map((item) => ({
          orgId: item.orgId,
          userId: item.userId,
          role: GUEST_ROLE,
          kind: MEMBERSHIP_KINDS.GUEST,
          status: "active",
          joinedAt: item.acceptedAt ?? item.createdAt,
        })),
        skipDuplicates: true,
      })).count;
    }
    return row("party_members_have_membership", `${total} of ${total}`, `${total - missing.length} of ${total}${apply ? `, ${created} guest created` : ""}`, missing.length ? "warn" : "ok", missing);
  },

  /**
   * ApiClient owner has a membership in the key's organisation (every key,
   * revoked ones included — the M3 fill covers them all) → a key still active
   * without one is revoked, listed.
   */
  async api_clients_have_membership({ orgId, apply }) {
    const total = await count(Prisma.sql`
      SELECT count(*)::int AS count FROM "ApiClient" k WHERE true ${orgFilter(Prisma.sql`k."orgId"`, orgId)}`);
    const missing = await rows(Prisma.sql`
      SELECT k."id", k."name", k."orgId", k."userId", k."status" FROM "ApiClient" k
      LEFT JOIN "OrganizationMembership" m ON m."orgId" = k."orgId" AND m."userId" = k."userId"
      WHERE m."id" IS NULL ${orgFilter(Prisma.sql`k."orgId"`, orgId)}`);
    let revoked = 0;
    if (apply && missing.length) {
      revoked = (await prisma.apiClient.updateMany({
        where: { id: { in: missing.map((item) => item.id) }, status: "active" },
        data: { status: "revoked", revokedAt: new Date() },
      })).count;
    }
    return row("api_clients_have_membership", `${total} of ${total}`, `${total - missing.length} of ${total}${apply ? `, ${revoked} revoked` : ""}`, missing.length ? "warn" : "ok", missing);
  },

  /** duplicate e-mails, case-insensitive → stop (identity-level, always global). */
  async duplicate_emails() {
    const dupes = await rows(Prisma.sql`
      SELECT lower(u."email") AS "email", count(*)::int AS "count" FROM "User" u GROUP BY lower(u."email") HAVING count(*) > 1`);
    return row("duplicate_emails", "0", String(dupes.length), dupes.length ? "stop" : "ok", dupes);
  },

  /**
   * Organisation slugs: filled and distinct. Distinctness is held by the unique
   * index platform-wide; --org narrows the "filled" question to one
   * organisation so a scoped report does not depend on a tenant another
   * process is creating at the same moment.
   */
  async organisation_slugs_unique({ orgId }) {
    const orgs = await count(Prisma.sql`SELECT count(*)::int AS count FROM "Organisation" o WHERE true ${orgFilter(Prisma.sql`o."id"`, orgId)}`);
    const filled = await count(
      Prisma.sql`SELECT count(*)::int AS count FROM "Organisation" o WHERE o."slug" IS NOT NULL ${orgFilter(Prisma.sql`o."id"`, orgId)}`,
    );
    const distinct = await count(
      Prisma.sql`SELECT count(DISTINCT o."slug")::int AS count FROM "Organisation" o WHERE o."slug" IS NOT NULL ${orgFilter(Prisma.sql`o."id"`, orgId)}`,
    );
    const suffixed = await rows(Prisma.sql`
      SELECT o."id", o."name", o."slug" FROM "Organisation" o
      WHERE o."slug" ~ '-[0-9]+$' AND EXISTS (SELECT 1 FROM "Organisation" b WHERE b."slug" = regexp_replace(o."slug", '-[0-9]+$', ''))
      ${orgFilter(Prisma.sql`o."id"`, orgId)} ORDER BY o."slug"`);
    const status = filled < orgs ? "warn" : distinct === filled ? "ok" : "stop";
    return row("organisation_slugs_unique", `${orgs} distinct`, `${distinct} distinct, ${filled} of ${orgs} filled, ${suffixed.length} suffixed`, status, suffixed, filled < orgs ? "run backfill-tenant-columns.js --apply" : null);
  },

  /** Organisations without the system permission templates → info (reseed-system-templates.js). */
  async system_templates_present({ orgId }) {
    const names = DEFAULT_TEMPLATES.map((template) => template.name);
    const lacking = await rows(Prisma.sql`
      SELECT o."id", o."name", (SELECT count(*)::int FROM "PermissionTemplate" t WHERE t."orgId" = o."id" AND t."name" IN (${Prisma.join(names)})) AS "present"
      FROM "Organisation" o WHERE true ${orgFilter(Prisma.sql`o."id"`, orgId)} ORDER BY o."createdAt"`);
    const missing = lacking.filter((org) => org.present < names.length).map((org) => ({ ...org, expected: names.length }));
    return row("system_templates_present", `${names.length} per organisation`, `${missing.length} organisation(s) lacking`, missing.length ? "info" : "ok", missing);
  },
};

const main = async () => {
  const args = parseArgs();
  printHeader("OctaPM membership validation report (§50)", args);

  const results = [];
  for (const [name, run] of Object.entries(checks)) {
    results.push(await run({ orgId: args.orgId, apply: args.apply }));
  }

  const width = Math.max(...results.map((item) => item.check.length));
  for (const item of results) {
    console.log(`${item.status.toUpperCase().padEnd(5)} ${item.check.padEnd(width)}  expected ${item.expected.padEnd(22)} actual ${item.actual}`);
    if (item.note) console.log(`      ${item.note}`);
    // Listed even on an OK row: a promotion the owner rule made is worth reading.
    for (const detail of item.details) console.log(`      ${JSON.stringify(detail)}`);
    if (item.detailCount > item.details.length) console.log(`      … ${item.detailCount - item.details.length} more`);
  }

  const stops = results.filter((item) => item.status === "stop").length;
  const warnings = results.filter((item) => item.status === "warn").length;
  const report = {
    generatedAt: new Date().toISOString(),
    apply: args.apply,
    orgId: args.orgId,
    ok: stops === 0,
    stops,
    warnings,
    rows: results,
  };
  const jsonPath = args.jsonPath || defaultReportPath("membership-backfill-report");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\n${stops ? `${stops} STOP row(s)` : "No stop rows"}, ${warnings} warning(s). Report written to ${jsonPath}`);

  printResult({ ok: report.ok, stops, warnings, jsonPath, rows: results.map(({ check, status, actual }) => ({ check, status, actual })) });
  if (stops) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
