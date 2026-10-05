'use strict';

/**
 * A server-side copy of the certification database, so a clean baseline is a
 * copy back (seconds) instead of a regeneration (hours).
 *
 *   node scripts/cert/snapshot-db.js take <name>      # CREATE DATABASE octapm_cert_snap_<name> TEMPLATE octapm_cert
 *   node scripts/cert/snapshot-db.js restore <name>   # octapm_cert replaced by a copy of the snapshot
 *   node scripts/cert/snapshot-db.js list
 *
 * Only on the certification cluster: the address is CERT_DATABASE_URL, its
 * database must be octapm_cert, and nothing may be connected to the source of
 * the copy (stop the certification API first). The snapshot keeps the marker
 * row, so the guard accepts a restored database as the certification one.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { Client } = require('pg');

const raw = process.env.CERT_DATABASE_URL;
if (!raw) throw new Error('CERT_DATABASE_URL is not set');
const url = new URL(raw);
if (url.pathname !== '/octapm_cert') throw new Error(`refusing: the certification database must be octapm_cert, not ${url.pathname}`);
if (url.port === '55432' || url.port === '5432') throw new Error(`refusing: port ${url.port} is not the certification cluster`);
const maintenance = new URL(raw);
maintenance.pathname = '/postgres';

const [action, name] = process.argv.slice(2);
const SNAP = name ? `octapm_cert_snap_${name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}` : null;

const main = async () => {
  const db = new Client({ connectionString: maintenance.toString() });
  await db.connect();
  try {
    if (action === 'list') {
      const rows = (await db.query(`select datname, pg_size_pretty(pg_database_size(datname)) as size from pg_database where datname like 'octapm_cert%' order by datname`)).rows;
      for (const r of rows) console.log(`${r.datname}  ${r.size}`);
      return;
    }
    if (!SNAP) throw new Error('a snapshot name is required');
    const busy = async (database) => (await db.query('select count(*)::int as n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [database])).rows[0].n;
    if (action === 'take') {
      if (await busy('octapm_cert')) throw new Error('octapm_cert has open connections: stop the certification API first');
      await db.query(`drop database if exists "${SNAP}"`);
      const started = Date.now();
      await db.query(`create database "${SNAP}" template octapm_cert`);
      console.log(`snapshot ${SNAP} taken in ${Math.round((Date.now() - started) / 1000)} s`);
    } else if (action === 'restore') {
      const exists = (await db.query('select 1 from pg_database where datname = $1', [SNAP])).rowCount;
      if (!exists) throw new Error(`no snapshot ${SNAP}`);
      if (await busy('octapm_cert')) throw new Error('octapm_cert has open connections: stop the certification API first');
      await db.query('drop database octapm_cert');
      await db.query(`create database octapm_cert template "${SNAP}"`);
      console.log(`octapm_cert restored from ${SNAP}`);
    } else {
      throw new Error(`unknown action ${action}`);
    }
  } finally {
    await db.end();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
