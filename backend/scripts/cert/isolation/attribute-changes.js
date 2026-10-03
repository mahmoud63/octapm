'use strict';

/**
 * Who changed what a fingerprint comparison reports, row by row.
 *
 * For every (company, table) a fingerprint diff names (request-noise tables
 * aside), the rows of that table created or updated inside the window, each
 * with the company it belongs to and every person column it carries
 * (createdBy, userId, actorId, …). A row is
 *   OWN       every person it names is a member of the company the row belongs to
 *   FOREIGN   it names a person who is not — another company's caller wrote it
 *   NO_ACTOR  it names nobody; shown with its company so it can be read
 * and the company a row belongs to is the one the fingerprint counted it in.
 *
 *   node scripts/cert/isolation/attribute-changes.js --diff=cert2b-before-reads--cert2b-after-reads \
 *        --from=2026-10-03T20:35:09Z --to=2026-10-03T20:44:31Z [--name=cert2b-reads-attribution]
 *
 * Read-only. Exit 0 when no row is FOREIGN, 2 otherwise.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const fs = require('fs');
const guard = require('../lib/cert-env');
const { MODELS, ownerSql, tableOf } = require('../lib/tenant-map');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const DIFF = arg('diff');
const FROM = arg('from');
const TO = arg('to');
const NAME = arg('name', `${DIFF}-attribution`);
if (!DIFF || !FROM || !TO) throw new Error('--diff, --from and --to are required');

// Columns that name the person who caused a row.
const PERSON = /^(createdBy|updatedBy|userId|actorId|requestedBy|authorId|uploadedBy|recordedBy|submittedBy|createdById|ownerUserId|recipientUserId|generatedBy|preparedBy)$/;

const main = async () => {
  const diff = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'fingerprints', `${DIFF}.diff.json`), 'utf8'));
  const pairs = diff.filter((d) => !d.noise);
  const tables = [...new Set(pairs.map((d) => d.table))];
  const db = await guard.connectCert();
  const orgs = (await db.query('select id::text as id, slug from "Organisation"')).rows;
  const codeOf = new Map(orgs.map((o) => [o.id, /^cert-(\d{3})-/.exec(o.slug || '')?.[1] || o.id.slice(0, 8)]));
  const members = new Set((await db.query('select "userId"::text as u, "orgId"::text as o from "OrganizationMembership"')).rows.map((r) => `${r.u}|${r.o}`));
  const emails = new Map((await db.query('select id::text as id, email from "User"')).rows.map((r) => [r.id, r.email]));

  const report = { diff: DIFF, from: FROM, to: TO, tables: {} };
  let foreign = 0;
  for (const table of tables) {
    const model = MODELS.find((m) => tableOf(m) === table || tableOf(m).toLowerCase() === table.replace(/_/g, '') || m.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() === table);
    if (!model) { report.tables[table] = { error: 'no model for this table' }; continue; }
    const col = (f) => `"${f.dbName || f.name}"`;
    const scalar = model.fields.filter((f) => f.kind === 'scalar');
    const idF = model.fields.find((f) => f.isId);
    const created = scalar.find((f) => f.name === 'createdAt');
    const updated = scalar.find((f) => f.name === 'updatedAt');
    const people = scalar.filter((f) => PERSON.test(f.name));
    const describe = scalar.filter((f) => /^(entityType|action|type|status|title|name|event|kind|channel|category|commitmentId|projectId)$/.test(f.name));
    if (!created && !updated) { report.tables[table] = { error: 'no createdAt/updatedAt column' }; continue; }
    const when = [created, updated].filter(Boolean).map((f) => `t.${col(f)} between $1 and $2`).join(' or ');
    const select = [idF, ...people, ...describe, created, updated].filter(Boolean).map((f) => `t.${col(f)} as "${f.name}"`).join(', ');
    const sql = `select o.org::text as org, ${select} from "${tableOf(model)}" t join (${ownerSql(model.name)}) o on o.id = t.${col(idF)}::text where ${when}`;
    const rows = (await db.query(sql, [FROM, TO])).rows;
    const entry = { model: model.name, personColumns: people.map((f) => f.name), rows: rows.length, byCompany: {}, verdicts: { OWN: 0, FOREIGN: 0, NO_ACTOR: 0 }, actors: {}, foreign: [], samples: [] };
    for (const row of rows) {
      const code = codeOf.get(row.org) || row.org;
      entry.byCompany[code] = (entry.byCompany[code] || 0) + 1;
      const named = people.map((f) => row[f.name]).filter(Boolean).map(String);
      let verdict = 'NO_ACTOR';
      if (named.length) verdict = named.every((u) => members.has(`${u}|${row.org}`)) ? 'OWN' : 'FOREIGN';
      entry.verdicts[verdict] += 1;
      for (const u of named) {
        const who = `${emails.get(u) || u}${members.has(`${u}|${row.org}`) ? '' : ' (NOT A MEMBER)'}`;
        entry.actors[who] = (entry.actors[who] || 0) + 1;
      }
      if (verdict === 'FOREIGN') { foreign += 1; if (entry.foreign.length < 20) entry.foreign.push({ company: code, ...row }); }
      if (entry.samples.length < 3) entry.samples.push({ company: code, ...row });
    }
    // keep the actor list short: the most frequent first
    entry.actors = Object.fromEntries(Object.entries(entry.actors).sort((a, b) => b[1] - a[1]).slice(0, 15));
    entry.actorCount = Object.keys(entry.actors).length;
    report.tables[table] = entry;
  }
  await db.end();
  report.foreignRows = foreign;
  const out = path.join(WORK, 'results', 'isolation', `${NAME}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  for (const [table, e] of Object.entries(report.tables)) {
    if (e.error) { console.log(`${table}: ${e.error}`); continue; }
    console.log(`${table}: ${e.rows} row(s) in ${Object.keys(e.byCompany).length} compan(ies); OWN ${e.verdicts.OWN}, FOREIGN ${e.verdicts.FOREIGN}, NO_ACTOR ${e.verdicts.NO_ACTOR}; person columns ${e.personColumns.join(',') || 'none'}`);
    for (const [who, n] of Object.entries(e.actors).slice(0, 5)) console.log(`    ${n}× ${who}`);
  }
  console.log(`\nrows naming a person outside the row's company: ${foreign}`);
  process.exitCode = foreign ? 2 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
