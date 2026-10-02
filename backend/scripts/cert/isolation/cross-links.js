'use strict';

/**
 * The cross-company reference scan: no row that belongs to one company may
 * name a row that belongs to another.
 *
 *   node scripts/cert/isolation/cross-links.js take <name>      # writes <work>/state/cross-links/<name>.json
 *   node scripts/cert/isolation/cross-links.js compare <before> <after>
 *
 * It does not rely on declared foreign keys: every column of every owned row
 * is read as text, every identifier found in it is looked up in the whole
 * database's id index, and a reference whose target belongs to a different
 * company is reported — so a "soft" reference kept in a plain string or JSON
 * column (recordId, assignee ids, distribution lists) is caught too.
 *
 * People are the one thing companies legitimately share: a person may belong
 * to several companies, so a reference to a user who is a member of the
 * referring company is not a cross-company link. A reference to a user who is
 * NOT a member of the referring company is reported.
 *
 * Read-only: one connection, one read-only transaction.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const fs = require('fs');
const guard = require('../lib/cert-env');
const { byName, idField, ownedModels, ownerSql, snake, tableOf } = require('../lib/tenant-map');
const { buildIndex } = require('./index-ids');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const DIR = path.join(WORK, 'state', 'cross-links');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Tables whose rows are about a person's own account across companies, not about a company's data. */
const PERSONAL = new Set(['refresh_session', 'auth_audit_event', 'user_setting', 'push_subscription', 'invitation_token']);

const scan = async (client) => {
  const { index, orgs } = await buildIndex(client);
  const codeOfOrg = new Map(orgs.map((o) => [o.id, o.code]));
  // Who is a member of which company.
  const members = new Map();
  for (const row of (await client.query('select "userId"::text as u, "orgId"::text as o from "OrganizationMembership"')).rows) {
    const set = members.get(row.u) || members.set(row.u, new Set()).get(row.u);
    set.add(codeOfOrg.get(row.o));
  }
  const links = [];
  for (const modelName of ownedModels()) {
    const type = snake(modelName);
    if (PERSONAL.has(type) || type === 'organisation' || type === 'user' || type === 'organization_membership') continue;
    const owner = ownerSql(modelName);
    const model = byName.get(modelName);
    const pk = idField(model);
    if (!owner || !pk) continue;
    const idColumn = `"${pk.dbName || pk.name}"`;
    let cursor = '';
    for (;;) {
      // Pages by id, so a large table is never held in memory at once.
      const rows = (
        await client.query(
          `select t.${idColumn}::text as id, o.org as org, to_jsonb(t)::text as body
             from "${tableOf(model)}" t join (${owner}) o on o.id = t.${idColumn}::text
            where t.${idColumn}::text > $1 order by t.${idColumn}::text limit 5000`,
          [cursor]
        )
      ).rows;
      if (!rows.length) break;
      cursor = rows[rows.length - 1].id;
      for (const row of rows) {
        const home = codeOfOrg.get(row.org);
        if (!home) continue;
        const seen = new Set();
        for (const found of row.body.match(UUID) || []) {
          if (found === row.id || seen.has(found)) continue;
          seen.add(found);
          const target = index[found];
          if (!target) continue;
          const [targetCode, targetType] = target;
          if (targetType === 'organisation') {
            if (targetCode !== home) links.push({ table: type, id: row.id, home, target: found, targetType, targetCode });
            continue;
          }
          if (targetType === 'user') {
            if (!members.get(found)?.has(home)) links.push({ table: type, id: row.id, home, target: found, targetType, targetCode, note: 'a person who is not a member of the referring company' });
            continue;
          }
          if (targetCode !== home) links.push({ table: type, id: row.id, home, target: found, targetType, targetCode });
        }
      }
      if (rows.length < 5000) break;
    }
  }
  return links;
};

const main = async () => {
  const [command, first, second] = process.argv.slice(2);
  fs.mkdirSync(DIR, { recursive: true });
  if (command === 'take') {
    const client = await guard.connectCert();
    try {
      await client.query('begin transaction isolation level repeatable read read only');
      const links = await scan(client);
      await client.query('rollback');
      fs.writeFileSync(path.join(DIR, `${first}.json`), JSON.stringify(links));
      const kinds = {};
      for (const link of links) kinds[`${link.table} -> ${link.targetType}`] = (kinds[`${link.table} -> ${link.targetType}`] || 0) + 1;
      console.log(`cross-company references "${first}": ${links.length}`);
      for (const [kind, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${kind}`);
      process.exitCode = 0;
    } finally {
      await client.end();
    }
    return;
  }
  if (command === 'compare') {
    const key = (l) => `${l.table}|${l.id}|${l.target}`;
    const before = new Set(JSON.parse(fs.readFileSync(path.join(DIR, `${first}.json`), 'utf8')).map(key));
    const fresh = JSON.parse(fs.readFileSync(path.join(DIR, `${second}.json`), 'utf8')).filter((l) => !before.has(key(l)));
    const kinds = {};
    for (const link of fresh) kinds[`${link.table} -> ${link.targetType}`] = (kinds[`${link.table} -> ${link.targetType}`] || 0) + 1;
    console.log(`new cross-company references: ${fresh.length}`);
    for (const [kind, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${kind}`);
    fs.writeFileSync(path.join(DIR, `${first}--${second}.new.json`), JSON.stringify(fresh, null, 1));
    process.exitCode = fresh.length ? 2 : 0;
    return;
  }
  console.log('usage: cross-links.js take <name> | compare <before> <after>');
  process.exitCode = 1;
};

module.exports = { scan };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
