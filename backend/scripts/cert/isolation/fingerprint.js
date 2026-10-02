'use strict';

/**
 * A fingerprint of every company's data, to prove that an attack changed
 * nothing — or to show exactly which company's which table it changed.
 *
 *   node scripts/cert/isolation/fingerprint.js take <name>           # writes <work>/state/fingerprints/<name>.json
 *   node scripts/cert/isolation/fingerprint.js compare <before> <after>
 *
 * For every table that belongs to a company, per company: the number of rows
 * and a hash of every row's whole content. Two fingerprints are equal for a
 * company and table only if no row was added, removed or changed in any
 * column. Read-only: one connection, one read-only transaction, so the
 * fingerprint is of a single instant.
 *
 * Tables that record that a request happened at all (sign-ins, sessions,
 * rate-limit counters, last-active stamps) change under any traffic and are
 * listed in NOISE with the reason; they are fingerprinted too and reported
 * separately, never silently dropped.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const fs = require('fs');
const guard = require('../lib/cert-env');
const { byName, ownedModels, ownerSql, snake, tableOf } = require('../lib/tenant-map');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const DIR = path.join(WORK, 'state', 'fingerprints');

/** Tables any request may touch, whoever makes it. Compared and reported, but not counted as a breach on their own. */
const NOISE = {
  refresh_session: 'a sign-in creates a session',
  auth_audit_event: 'a sign-in is audited',
  user: 'lastLogin is stamped at sign-in',
  organization_membership: 'lastActiveAt is stamped as a member acts',
  user_setting: 'client preferences',
};

const take = async (client) => {
  const orgs = (await client.query('select id::text as id, slug from "Organisation"')).rows;
  const codeOf = new Map(orgs.map((o) => [o.id, /^cert-(\d{3})-/.exec(o.slug || '')?.[1] || o.id.slice(0, 8)]));
  const out = {};
  for (const modelName of ownedModels()) {
    const owner = ownerSql(modelName);
    if (!owner) continue;
    const table = `"${tableOf(byName.get(modelName))}"`;
    const pk = byName.get(modelName).fields.find((f) => f.isId);
    const idColumn = `"${pk.dbName || pk.name}"`;
    // One hash per company: md5 over the ordered md5s of each row's full text.
    const sql = `
      select o.org as org, count(*)::int as rows,
             md5(string_agg(md5(t::text), '' order by t.${idColumn}::text)) as hash
        from ${table} t join (${owner}) o on o.id = t.${idColumn}::text
       group by o.org`;
    let rows;
    try {
      rows = (await client.query(sql)).rows;
    } catch (error) {
      out[snake(modelName)] = { error: error.message.split('\n')[0] };
      continue;
    }
    const perOrg = {};
    for (const row of rows) perOrg[row.org ? codeOf.get(row.org) || row.org : '(none)'] = [row.rows, row.hash];
    out[snake(modelName)] = perOrg;
  }
  return out;
};

const compare = (before, after) => {
  const changes = [];
  for (const table of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[table] || {};
    const b = after[table] || {};
    for (const org of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (org === 'error') continue;
      const [rowsA, hashA] = a[org] || [0, null];
      const [rowsB, hashB] = b[org] || [0, null];
      if (rowsA !== rowsB || hashA !== hashB) changes.push({ table, org, rowsBefore: rowsA, rowsAfter: rowsB, noise: NOISE[table] || null });
    }
  }
  return changes;
};

const main = async () => {
  const [command, first, second] = process.argv.slice(2);
  fs.mkdirSync(DIR, { recursive: true });
  if (command === 'take') {
    const client = await guard.connectCert();
    try {
      await client.query('begin transaction isolation level repeatable read read only');
      const print = await take(client);
      await client.query('rollback');
      fs.writeFileSync(path.join(DIR, `${first}.json`), JSON.stringify(print));
      const tables = Object.keys(print).length;
      const errors = Object.entries(print).filter(([, v]) => v.error);
      console.log(`fingerprint "${first}": ${tables} tables${errors.length ? `, ${errors.length} could not be read: ${errors.map(([t, v]) => `${t} (${v.error})`).join('; ')}` : ''}`);
    } finally {
      await client.end();
    }
    return;
  }
  if (command === 'compare') {
    const before = JSON.parse(fs.readFileSync(path.join(DIR, `${first}.json`), 'utf8'));
    const after = JSON.parse(fs.readFileSync(path.join(DIR, `${second}.json`), 'utf8'));
    const changes = compare(before, after);
    const real = changes.filter((c) => !c.noise);
    const noise = changes.filter((c) => c.noise);
    console.log(`changed (company, table) pairs: ${real.length}; in request-noise tables: ${noise.length}`);
    const byTable = {};
    for (const c of real) (byTable[c.table] = byTable[c.table] || []).push(`${c.org}:${c.rowsBefore}→${c.rowsAfter}`);
    for (const [table, list] of Object.entries(byTable)) console.log(`  ${table}: ${list.slice(0, 12).join(' ')}${list.length > 12 ? ` (+${list.length - 12})` : ''}`);
    const noiseTables = {};
    for (const c of noise) noiseTables[c.table] = (noiseTables[c.table] || 0) + 1;
    if (noise.length) console.log(`  noise: ${Object.entries(noiseTables).map(([t, n]) => `${t} ${n} (${NOISE[t]})`).join('; ')}`);
    fs.writeFileSync(path.join(DIR, `${first}--${second}.diff.json`), JSON.stringify(changes, null, 1));
    process.exitCode = real.length ? 2 : 0;
    return;
  }
  console.log('usage: fingerprint.js take <name> | compare <before> <after>');
  process.exitCode = 1;
};

module.exports = { NOISE, compare, take };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
