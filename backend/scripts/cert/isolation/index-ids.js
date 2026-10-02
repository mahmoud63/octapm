'use strict';

/**
 * The id index of the certification database: for every row of every table
 * that belongs to a company, which company and which table.
 *
 *   node scripts/cert/isolation/index-ids.js            # writes <work>/state/id-index.json and prints the coverage
 *
 * Read-only: one connection, one read-only transaction. The attack tools use
 * the index to recognise another company's identifiers in a response, to
 * pick a victim's identifier of the right kind for an attack, and to report
 * how much of the schema each company has rows in (the isolation matrix).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const fs = require('fs');
const guard = require('../lib/cert-env');
const { byName, columnOf, idField, ownedModels, ownerSql, routeOf, snake, tableOf, unownedModels } = require('../lib/tenant-map');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';

const buildIndex = async (client) => {
  const orgs = (await client.query('select id::text as id, slug, name from "Organisation"')).rows;
  const codeOf = new Map(orgs.map((o) => [o.id, /^cert-(\d{3})-/.exec(o.slug || '')?.[1] || `?${o.id.slice(0, 6)}`]));
  const index = {}; // id -> [code, type]
  const coverage = {}; // type -> { rows, companies, unowned }
  for (const model of ownedModels()) {
    const sql = ownerSql(model);
    if (!sql) continue;
    let rows;
    try {
      rows = (await client.query(sql)).rows;
    } catch (error) {
      coverage[snake(model)] = { rows: 0, companies: 0, error: error.message.split('\n')[0] };
      continue;
    }
    const type = snake(model);
    const seen = new Set();
    let unowned = 0;
    // The project a row belongs to, where the table says so itself.
    const projectOf = new Map();
    const definition = byName.get(model);
    if (model === 'Project') {
      for (const row of rows) projectOf.set(row.id, row.id);
    } else if (definition.fields.some((f) => f.name === 'projectId' && f.kind === 'scalar')) {
      const pk = idField(definition);
      const found = await client.query(`select "${pk.dbName || pk.name}"::text as id, "${columnOf(definition, 'projectId')}"::text as project from "${tableOf(definition)}"`);
      for (const row of found.rows) if (row.project) projectOf.set(row.id, row.project);
    }
    for (const row of rows) {
      const code = row.org ? codeOf.get(row.org) : null;
      if (!code) {
        unowned += 1;
        continue;
      }
      seen.add(code);
      if (row.id && row.id.length === 36) index[row.id] = projectOf.has(row.id) ? [code, type, projectOf.get(row.id)] : [code, type];
    }
    coverage[type] = { rows: rows.length, companies: seen.size, unowned, via: routeOf(model).kind };
  }
  return { orgs: orgs.map((o) => ({ id: o.id, code: codeOf.get(o.id), name: o.name })), index, coverage, unownedModels: unownedModels().map(snake) };
};

const main = async () => {
  const client = await guard.connectCert();
  try {
    await client.query('begin transaction read only');
    const built = await buildIndex(client);
    await client.query('rollback');
    fs.mkdirSync(path.join(WORK, 'state'), { recursive: true });
    fs.writeFileSync(path.join(WORK, 'state', 'id-index.json'), JSON.stringify(built));
    const types = Object.entries(built.coverage);
    const populated = types.filter(([, c]) => c.rows > 0);
    console.log(`ids indexed: ${Object.keys(built.index).length}`);
    console.log(`tables with a route to a company: ${types.length}; with rows: ${populated.length}; in all 100 companies: ${populated.filter(([, c]) => c.companies === 100).length}`);
    console.log(`tables with no route to a company (${built.unownedModels.length}): ${built.unownedModels.join(', ')}`);
    const errors = types.filter(([, c]) => c.error);
    if (errors.length) console.log(`errors: ${errors.map(([t, c]) => `${t}: ${c.error}`).join(' | ')}`);
    const orphans = populated.filter(([, c]) => c.unowned > 0);
    if (orphans.length) console.log(`rows with no owning company: ${orphans.map(([t, c]) => `${t} ${c.unowned}/${c.rows}`).join(', ')}`);
    if (process.argv.includes('--coverage')) {
      for (const [type, c] of populated.sort((a, b) => b[1].companies - a[1].companies)) console.log(`  ${type.padEnd(42)} rows ${String(c.rows).padStart(7)}  companies ${String(c.companies).padStart(3)}`);
      console.log(`empty: ${types.filter(([, c]) => c.rows === 0).map(([t]) => t).join(', ')}`);
    }
  } finally {
    await client.end();
  }
};

module.exports = { buildIndex };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
