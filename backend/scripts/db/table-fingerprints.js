#!/usr/bin/env node
/**
 * Read-only fingerprint of every public table: row count and an md5 over every
 * row's full text (all columns), in a deterministic order.
 *
 *   node scripts/db/table-fingerprints.js --url <url> --out <file.json>
 *   node scripts/db/table-fingerprints.js --compare <before.json> <after.json> [--allow-new <Table> ...]
 *
 * Compare exits 2 when any table present in BEFORE differs in AFTER, or a table
 * appears in AFTER that is not named by --allow-new; 0 otherwise. Used by the
 * migration preflight to prove an additive migration changed no existing row.
 */
const fs = require("fs");
const path = require("path");

const backend = path.resolve(__dirname, "..", "..");
const nodeModules = [path.join(backend, "node_modules"), path.join(backend, "..", "node_modules")].find((p) => fs.existsSync(path.join(p, "pg")));
const { Client } = require(path.join(nodeModules, "pg"));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const fingerprint = async (url) => {
  const c = new Client({ connectionString: url, application_name: "table-fingerprints (read-only)" });
  await c.connect();
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  const tables = (await c.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> '_prisma_migrations' order by 1`)).rows.map((r) => r.table_name);
  const out = {};
  for (const table of tables) {
    const { rows: [r] } = await c.query(
      `select count(*)::int n, coalesce(md5(string_agg(t::text, E'\\n' order by t::text)), '') h from "${table}" t`,
    );
    out[table] = { rows: r.n, md5: r.h };
  }
  await c.query("ROLLBACK");
  await c.end();
  return out;
};

const main = async () => {
  if (args.includes("--compare")) {
    const i = args.indexOf("--compare");
    const before = JSON.parse(fs.readFileSync(args[i + 1], "utf8"));
    const after = JSON.parse(fs.readFileSync(args[i + 2], "utf8"));
    const allowNew = args.flatMap((a, j) => (a === "--allow-new" ? [args[j + 1]] : []));
    const changed = Object.keys(before).filter((t) => !after[t] || after[t].md5 !== before[t].md5 || after[t].rows !== before[t].rows);
    const added = Object.keys(after).filter((t) => !before[t]);
    const unexpected = added.filter((t) => !allowNew.includes(t));
    console.log(JSON.stringify({ tablesBefore: Object.keys(before).length, tablesAfter: Object.keys(after).length, rowsBefore: Object.values(before).reduce((s, t) => s + t.rows, 0), changed, added: added.map((t) => `${t} (${after[t].rows} rows)`), unexpected }, null, 1));
    process.exitCode = changed.length || unexpected.length ? 2 : 0;
    return;
  }
  const url = opt("url");
  const outFile = opt("out");
  if (!url || !outFile) throw new Error("usage: --url <url> --out <file> | --compare <before> <after>");
  const result = await fingerprint(url);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
  console.log(`${Object.keys(result).length} tables, ${Object.values(result).reduce((s, t) => s + t.rows, 0)} rows → ${outFile}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
