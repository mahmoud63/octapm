'use strict';

/**
 * Writes docs/certification/OCTAPM_100_COMPANY_MATRIX.md from what is
 * actually in the certification database, set beside what the specification
 * says should be there.
 *
 *   node scripts/cert/matrix-report.js
 *
 * Read-only on the database (one read-only transaction).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const guard = require('./lib/cert-env');
const { buildPopulation, summarise } = require('./lib/spec');
const { buildIndex } = require('./isolation/index-ids');

const OUT = path.join(__dirname, '..', '..', '..', 'docs', 'certification', 'OCTAPM_100_COMPANY_MATRIX.md');

const main = async () => {
  const population = buildPopulation();
  const spec = summarise(population);
  const db = await guard.connectCert();
  let facts;
  try {
    await db.query('begin transaction isolation level repeatable read read only');
    const one = async (sql) => (await db.query(sql)).rows;
    const orgs = await one(`
      select o.id::text as id, o.slug, o.name, o."defaultCurrency" as currency, o."defaultTimezone" as timezone,
             s.plan, s.status, s.seats, s."billingCycle" as cycle,
             (select count(*)::int from "OrganizationMembership" m where m."orgId" = o.id) as memberships,
             (select count(*)::int from "OrganizationMembership" m where m."orgId" = o.id and m.status = 'active') as active,
             (select count(*)::int from "OrganizationMembership" m where m."orgId" = o.id and m.status <> 'active') as inactive,
             (select count(distinct m.role)::int from "OrganizationMembership" m where m."orgId" = o.id) as roles,
             (select count(*)::int from "OrganizationMembership" m where m."orgId" = o.id and m."isAdmin") as admins,
             (select count(*)::int from "Project" p where p."orgId" = o.id) as projects,
             (select count(*)::int from "Project" p where p."orgId" = o.id and p."archivedAt" is not null) as archived,
             (select count(*)::int from "Project" p where p."orgId" = o.id and p.timezone is null) as "noZone",
             (select count(distinct p.currency)::int from "Project" p where p."orgId" = o.id) as currencies
        from "Organisation" o left join "Subscription" s on s."orgId" = o.id
       where o.kind <> 'personal' order by o.slug`);
    const statuses = await one(`select p.status, (p."archivedAt" is not null) as archived, count(*)::int as n from "Project" p group by 1, 2 order by 1, 2`);
    const membershipStates = await one(`select status, kind, count(*)::int as n from "OrganizationMembership" group by 1, 2 order by 1, 2`);
    const multi = await one(`
      select u.email, count(*)::int as companies, count(distinct m.role)::int as roles,
             string_agg(substring(o.slug from 6 for 3) || ':' || m.role || case when m."isAdmin" then '*' else '' end || case when m.status <> 'active' then ' (' || m.status || ')' else '' end, ', ' order by o.slug) as places
        from "OrganizationMembership" m join "User" u on u.id = m."userId" join "Organisation" o on o.id = m."orgId"
       group by u.email having count(*) > 1 order by count(*) desc, u.email`);
    const totals = (await one(`select (select count(*)::int from "User") as users, (select count(*)::int from "OrganizationMembership") as memberships, (select count(*)::int from "Project") as projects, (select count(*)::int from "ProjectAssignment") as assignments, (select count(*)::int from "Invoice") as invoices, (select count(*)::int from "PaymentMethod") as cards`))[0];
    const built = await buildIndex(db);
    await db.query('rollback');
    facts = { orgs, statuses, membershipStates, multi, totals, coverage: built.coverage, ids: Object.keys(built.index).length, index: built.index };
  } finally {
    await db.end();
  }

  // Rows per company, from the index.
  const rowsByCompany = {};
  const typesByCompany = {};
  for (const [code, type] of Object.values(facts.index)) {
    rowsByCompany[code] = (rowsByCompany[code] || 0) + 1;
    (typesByCompany[code] = typesByCompany[code] || new Set()).add(type);
  }
  const byCode = new Map(population.companies.map((c) => [c.code, c]));
  const tally = (list, key) => list.reduce((acc, item) => ({ ...acc, [key(item)]: (acc[key(item)] || 0) + 1 }), {});
  const spread = (object) => Object.entries(object).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  const sizeRows = ['small', 'medium', 'large'].map((size) => {
    const mine = facts.orgs.filter((o) => byCode.get(/^cert-(\d{3})-/.exec(o.slug)[1])?.size === size);
    const range = (key) => `${Math.min(...mine.map((o) => o[key]))}–${Math.max(...mine.map((o) => o[key]))}`;
    return `| ${size} | ${mine.length} | ${range('memberships')} | ${range('projects')} | ${range('roles')} | ${spread(tally(mine, (o) => o.plan))} |`;
  });

  const populated = Object.entries(facts.coverage).filter(([, c]) => c.rows > 0).sort((a, b) => b[1].companies - a[1].companies || b[1].rows - a[1].rows);
  const empty = Object.entries(facts.coverage).filter(([, c]) => c.rows === 0).map(([t]) => t);

  const lines = [];
  const add = (text = '') => lines.push(text);
  add('# OctaPM certification — the hundred-company matrix');
  add();
  add(`Generated ${new Date().toISOString()} by \`backend/scripts/cert/matrix-report.js\` from the certification database`);
  add('(`octapm_cert`), read in one read-only transaction. The specification the population was built from is');
  add('`backend/scripts/cert/lib/spec.js`; where the database differs from it, this document says so.');
  add();
  add('## Totals');
  add();
  add('| | Specification | Database |');
  add('|---|---|---|');
  add(`| Companies | ${spec.companies} | ${facts.orgs.length} |`);
  add(`| People | ${spec.people + spec.peopleInSeveralCompanies} | ${facts.totals.users} |`);
  add(`| Memberships | ${spec.memberships} | ${facts.totals.memberships} |`);
  add(`| Projects | ${spec.projects} | ${facts.totals.projects} |`);
  add(`| Project team assignments | — | ${facts.totals.assignments} |`);
  add(`| Rows that belong to a company (all tables) | — | ${facts.ids} |`);
  add(`| Tables with rows | — | ${populated.length} of ${Object.keys(facts.coverage).length} that belong to a company |`);
  add();
  add('## By size');
  add();
  add('| Size | Companies | People per company | Projects per company | Roles in use per company | Plans |');
  add('|---|---|---|---|---|---|');
  sizeRows.forEach((row) => add(row));
  add();
  add('## How the companies differ');
  add();
  add(`- **Currency** (${Object.keys(tally(facts.orgs, (o) => o.currency)).length}): ${spread(tally(facts.orgs, (o) => o.currency))}.`);
  add(`- **Time zone** (${Object.keys(tally(facts.orgs, (o) => o.timezone || '(none chosen)')).length}): ${spread(tally(facts.orgs, (o) => o.timezone || '(none chosen)'))}.`);
  add(`- **Plan and billing state**: ${spread(tally(facts.orgs, (o) => `${o.plan}/${o.status}`))}.`);
  add(`- **Seats**: ${spread(tally(facts.orgs, (o) => `${o.seats} seats`))}. Companies with more active people than seats: ${facts.orgs.filter((o) => o.active > o.seats).length}.`);
  add(`- **Project state**: ${facts.statuses.map((s) => `${s.status}${s.archived ? ' (archived)' : ''} ${s.n}`).join(', ')}.`);
  add(`- **Projects without their own time zone** (they fall back to the company's, then UTC): ${facts.orgs.reduce((n, o) => n + o.noZone, 0)}.`);
  add(`- **Membership state**: ${facts.membershipStates.map((s) => `${s.kind}/${s.status} ${s.n}`).join(', ')}.`);
  add(`- **Owner is not a PM** in ${spec.ownersWhoAreNotPm} companies; company administration is held by non-PM people in some and withheld from some PMs (see the specification's tests).`);
  add();
  add('## People who belong to several companies');
  add();
  add('A role in one company must grant nothing in another. `*` marks company administration.');
  add();
  add('| Person | Companies | Distinct roles | Where (company:role) |');
  add('|---|---|---|---|');
  facts.multi.forEach((m) => add(`| ${m.email} | ${m.companies} | ${m.roles} | ${m.places} |`));
  add();
  add('## The hundred companies');
  add();
  add('| Code | Company | Size | People (active / not) | Roles | Admins | Plan / state / seats | Currency | Time zone | Projects (archived) | Rows | Record types |');
  add('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const o of facts.orgs) {
    const code = /^cert-(\d{3})-/.exec(o.slug)[1];
    add(`| ${code} | ${o.name.replace(/ \(CERT-\d{3}\)$/, '')} | ${byCode.get(code)?.size} | ${o.active} / ${o.inactive} | ${o.roles} | ${o.admins} | ${o.plan} / ${o.status} / ${o.seats} | ${o.currency} | ${o.timezone || '—'} | ${o.projects} (${o.archived}) | ${rowsByCompany[code] || 0} | ${typesByCompany[code]?.size || 0} |`);
  }
  add();
  add('## Record types and how many companies hold them');
  add();
  add('Every table that belongs to a company, with its rows and the number of companies that have at least one row in it.');
  add('This is the ground the isolation tests stand on: a record type a company has no row of cannot be attacked in that company.');
  add();
  add('| Record type | Rows | Companies |');
  add('|---|---|---|');
  populated.forEach(([type, c]) => add(`| ${type} | ${c.rows} | ${c.companies} |`));
  add();
  add(`**Tables with no row in any company (${empty.length}):** ${empty.join(', ') || 'none'}.`);
  add();
  fs.writeFileSync(OUT, `${lines.join('\n')}\n`);
  console.log(`wrote ${OUT}: ${facts.orgs.length} companies, ${populated.length} populated tables, ${empty.length} empty`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
