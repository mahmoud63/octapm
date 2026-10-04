#!/usr/bin/env node
/**
 * A production-like DISPOSABLE copy of a database, for migration preflights
 * (docs/qa/OCTAPM_MIGRATION_PREFLIGHT.md step 4) when no pg_dump is installed.
 *
 *   node scripts/db/clone-to-throwaway.js --source-url <url> --target <octapm_preflight_*> \
 *        --migrations-upto <folder name> [--drop]
 *
 * 1. Creates the target database (name must start with `octapm_preflight_`) on the source's cluster.
 * 2. Applies the repository's migrations UP TO AND INCLUDING `--migrations-upto` with `prisma migrate deploy`
 *    from a staged copy (later migrations are not staged), so the target has the source's schema version.
 *    It refuses unless the source's applied migration list equals the staged list exactly.
 * 3. Copies every row of every public table from one REPEATABLE READ, READ ONLY snapshot of the source
 *    (`row_to_json` → `json_populate_recordset`, generated columns left to be recomputed), with
 *    `session_replication_role = replica` on the target so foreign keys and triggers do not re-fire on rows
 *    that already satisfied them at the source. Sequences are set to the copied maxima.
 * 4. Verifies every table's row count equals the source's.
 *
 * The source is only ever read. `--drop` drops a target created by this script instead (same name rule).
 * Exit 0 = clone verified; 1 = error; 2 = a count mismatch.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const backend = path.resolve(__dirname, "..", "..");
const nodeModules = [path.join(backend, "node_modules"), path.join(backend, "..", "node_modules")].find((p) => fs.existsSync(path.join(p, "pg")));
const { Client } = require(path.join(nodeModules, "pg"));
const prismaCli = path.join(nodeModules, "prisma", "build", "index.js");

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const sourceUrl = opt("source-url");
const target = opt("target");
const upto = opt("migrations-upto");
if (!sourceUrl || !target || !/^octapm_preflight_[a-z0-9_]+$/.test(target)) {
  console.error("usage: --source-url <url> --target octapm_preflight_<name> --migrations-upto <folder> [--drop]");
  process.exit(1);
}
const urlFor = (name) => {
  const u = new URL(sourceUrl);
  u.pathname = `/${name}`;
  u.searchParams.delete("connection_limit");
  return u.toString();
};
const source = new URL(sourceUrl).pathname.slice(1);
if (source === target) throw new Error("refusing: target equals source");

const admin = async (fn) => {
  const c = new Client({ connectionString: urlFor("postgres") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

const main = async () => {
  if (args.includes("--drop")) {
    await admin((c) => c.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`));
    console.log(`dropped ${target}`);
    return;
  }
  if (!upto) throw new Error("--migrations-upto is required");
  const migrationsDir = path.join(backend, "prisma", "migrations");
  const staged = fs.readdirSync(migrationsDir).filter((n) => /^\d{14}_/.test(n)).sort().filter((n) => n <= upto);
  if (!staged.includes(upto)) throw new Error(`no migration folder ${upto}`);

  const src = new Client({ connectionString: sourceUrl, application_name: "clone-to-throwaway (read-only)" });
  await src.connect();
  await src.query("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  const applied = (await src.query(`select migration_name from "_prisma_migrations" where rolled_back_at is null and finished_at is not null order by 1`)).rows.map((r) => r.migration_name);
  if (JSON.stringify(applied) !== JSON.stringify(staged)) {
    throw new Error(`source migrations (${applied.length}, last ${applied.at(-1)}) differ from staged (${staged.length}, last ${staged.at(-1)})`);
  }

  await admin(async (c) => {
    const exists = await c.query("select 1 from pg_database where datname = $1", [target]);
    if (exists.rowCount) throw new Error(`${target} already exists`);
    await c.query(`CREATE DATABASE "${target}" ENCODING 'UTF8' TEMPLATE template0`);
  });
  console.log(`created ${target}`);

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "clone-stage-"));
  fs.mkdirSync(path.join(stage, "migrations"));
  fs.copyFileSync(path.join(backend, "prisma", "schema.prisma"), path.join(stage, "schema.prisma"));
  fs.copyFileSync(path.join(migrationsDir, "migration_lock.toml"), path.join(stage, "migrations", "migration_lock.toml"));
  for (const name of staged) fs.cpSync(path.join(migrationsDir, name), path.join(stage, "migrations", name), { recursive: true });
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", path.join(stage, "schema.prisma")], {
    env: { ...process.env, DATABASE_URL: urlFor(target) },
    stdio: "pipe",
  });
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`migrated ${target} to ${upto} (${staged.length} migrations)`);

  const dst = new Client({ connectionString: urlFor(target) });
  await dst.connect();
  await dst.query("SET session_replication_role = replica");
  const tables = (await src.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> '_prisma_migrations' order by 1`)).rows.map((r) => r.table_name);
  const mismatches = [];
  let total = 0;
  for (const table of tables) {
    const cols = (await dst.query(
      `select a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by a.attnum`,
      [table],
    )).rows.map((r) => `"${r.attname}"`);
    const list = cols.join(", ");
    await src.query(`DECLARE cur NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS j FROM "${table}" t`);
    let copied = 0;
    for (;;) {
      const batch = (await src.query("FETCH 2000 FROM cur")).rows;
      if (!batch.length) break;
      await dst.query(
        `INSERT INTO "${table}" (${list}) SELECT ${list} FROM json_populate_recordset(null::"${table}", $1::json)`,
        [`[${batch.map((r) => r.j).join(",")}]`],
      );
      copied += batch.length;
    }
    await src.query("CLOSE cur");
    const srcCount = Number((await src.query(`select count(*) n from "${table}"`)).rows[0].n);
    const dstCount = Number((await dst.query(`select count(*) n from "${table}"`)).rows[0].n);
    if (srcCount !== dstCount || copied !== srcCount) mismatches.push({ table, srcCount, dstCount, copied });
    total += dstCount;
  }
  // Sequences owned by columns follow the copied maxima.
  const seqs = (await dst.query(
    `select s.relname seq, t.relname tbl, a.attname col from pg_class s join pg_depend d on d.objid = s.oid
     join pg_class t on t.oid = d.refobjid join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
     where s.relkind = 'S'`,
  )).rows;
  for (const s of seqs) {
    await dst.query(`select setval('"${s.seq}"', greatest(1, coalesce((select max("${s.col}") from "${s.tbl}"), 0)))`);
  }
  await dst.query("SET session_replication_role = origin");
  await dst.query("ANALYZE");
  await dst.end();
  await src.query("ROLLBACK");
  await src.end();
  console.log(`copied ${tables.length} tables, ${total} rows; ${seqs.length} sequences set; mismatches: ${mismatches.length}`);
  if (mismatches.length) {
    console.table(mismatches);
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
