'use strict';

/**
 * Proves the certification guard against real databases, not fakes.
 *
 *   node scripts/cert/prove-guard.js
 *
 * Reads CERT_DATABASE_URL and CERT_ENVIRONMENT_ID from backend/.env (or the
 * shell). Optional: OTHER_DATABASE_URL, the address of a database that is NOT
 * the certification one (the shared development database) — it is opened
 * read-only, asked one question, and must be refused.
 *
 * Every case that needs "wrong" contents in the certification database makes
 * them inside a transaction that is rolled back, so the database is left as
 * it was. Nothing is written to any other database.
 *
 * Exit code 0 only when every case behaved as expected.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { Client } = require('pg');
const guard = require('./lib/cert-env');

const results = [];
const record = (name, expected, actual, note = '') => {
  const ok = expected === actual;
  results.push({ name, expected, actual, ok, note });
};

/** The rule a call was refused with, or "accepted". */
const ruleOf = async (fn) => {
  try {
    await fn();
    return 'accepted';
  } catch (error) {
    if (error instanceof guard.CertGuardError) return error.rule;
    return `error: ${error.message.split('\n')[0]}`;
  }
};

const main = async () => {
  const env = process.env;

  // ── the address, before any connection ─────────────────────────────────
  record('no CERT_DATABASE_URL at all', 'url-missing', await ruleOf(() => guard.certDatabaseUrl({})));
  record('CERT_DATABASE_URL empty', 'url-missing', await ruleOf(() => guard.certDatabaseUrl({ CERT_DATABASE_URL: '  ' })));
  record(
    'only DATABASE_URL is set (no fallback)',
    'url-missing',
    await ruleOf(() => guard.certDatabaseUrl({ DATABASE_URL: env.CERT_DATABASE_URL }))
  );
  record('CERT_DATABASE_URL is not an address', 'url-invalid', await ruleOf(() => guard.certDatabaseUrl({ CERT_DATABASE_URL: 'octapm_cert' })));
  if (env.OTHER_DATABASE_URL) {
    record(
      'CERT_DATABASE_URL set to the other (durable) database',
      'database-name',
      await ruleOf(() => guard.certDatabaseUrl({ CERT_DATABASE_URL: env.OTHER_DATABASE_URL }))
    );
    record(
      'connectCert with the other database\'s address',
      'database-name',
      await ruleOf(() => guard.connectCert({ env: { ...env, CERT_DATABASE_URL: env.OTHER_DATABASE_URL } }))
    );
  }
  record('no CERT_ENVIRONMENT_ID', 'environment-id-missing', await ruleOf(() => guard.connectCert({ env: { CERT_DATABASE_URL: env.CERT_DATABASE_URL } })));

  // ── a live connection to a database that is not the certification one ──
  if (env.OTHER_DATABASE_URL) {
    const other = new Client({ connectionString: env.OTHER_DATABASE_URL });
    await other.connect();
    try {
      await other.query('begin transaction read only');
      const query = async (sql, params) => (await other.query(sql, params)).rows;
      record('connected to the other database, plain check', 'database-name', await ruleOf(() => guard.assertCertEnvironment(query, { env })));
      record(
        'connected to the other database, destructive check',
        'database-name',
        await ruleOf(() => guard.assertCertEnvironment(query, { env, destructive: true }))
      );
      await other.query('rollback');
    } finally {
      await other.end();
    }
  } else {
    results.push({ name: 'the other (durable) database', expected: 'refused', actual: 'not run: OTHER_DATABASE_URL not given', ok: false, note: '' });
  }

  // ── the certification database itself ──────────────────────────────────
  const cert = new Client({ connectionString: guard.certDatabaseUrl(env) });
  await cert.connect();
  const query = async (sql, params) => (await cert.query(sql, params)).rows;
  const insideRollback = async (name, expected, change, options = {}) => {
    await cert.query('begin');
    try {
      await change();
      record(name, expected, await ruleOf(() => guard.assertCertEnvironment(query, { env, destructive: true, ...options })));
    } finally {
      await cert.query('rollback');
    }
  };
  try {
    record('the certification database, plain check', 'accepted', await ruleOf(() => guard.assertCertEnvironment(query, { env })));
    record('the certification database, destructive check', 'accepted', await ruleOf(() => guard.assertCertEnvironment(query, { env, destructive: true })));
    record(
      'the right database with a different CERT_ENVIRONMENT_ID',
      'marker-mismatch',
      await ruleOf(() => guard.assertCertEnvironment(query, { env: { ...env, CERT_ENVIRONMENT_ID: '00000000-0000-4000-8000-000000000000' } }))
    );

    await insideRollback('the marker row removed', 'marker-missing', () => cert.query(`delete from ${guard.MARKER_TABLE}`));
    await insideRollback('the marker table dropped', 'marker-missing', () => cert.query(`drop table ${guard.MARKER_TABLE}`));
    await insideRollback('a second marker row', 'marker-missing', () =>
      cert.query(`insert into ${guard.MARKER_TABLE} (id, kind) values (gen_random_uuid(), $1)`, [guard.MARKER_KIND])
    );
    // The table's own check constraint refuses another kind; it is lifted inside the
    // transaction so that the guard's rule is the one under test.
    await insideRollback('the marker of another kind', 'marker-kind', async () => {
      await cert.query(`alter table ${guard.MARKER_TABLE} drop constraint if exists environment_kind_check`);
      await cert.query(`update ${guard.MARKER_TABLE} set kind = 'something-else'`);
    });

    // A durable-looking company and a durable-looking person, made and rolled back.
    const orgId = '11111111-1111-4111-8111-111111111111';
    const makeOrg = (name, slug, kind = 'company') =>
      cert.query('insert into "Organisation" (id, name, slug, kind, "updatedAt") values ($1, $2, $3, $4, now())', [orgId, name, slug, kind]);
    await insideRollback('a company with a durable name and slug', 'foreign-organisation', () => makeOrg('OctaPM Demo Contracting', 'octapm-demo-contracting'));
    await insideRollback('a company with a certification slug but a plain name', 'foreign-organisation', () => makeOrg('Riverside Builders', 'cert-001-riverside'));
    await insideRollback('a company with a certification name but no slug', 'foreign-organisation', () => makeOrg('Riverside Builders (CERT-001)', null));
    await insideRollback('a company named for the E2E suite', 'foreign-organisation', () => makeOrg('OctaPM E2E', 'octapm-e2e'));
    await insideRollback('a person with a durable address', 'foreign-user', async () => {
      await makeOrg('Guard Proof Co (CERT-999)', 'cert-999-guard-proof');
      await cert.query('insert into "User" (id, "orgId", name, email, "passwordHash", role, "updatedAt") values (gen_random_uuid(), $1, $2, $3, $4, $5, now())', [
        orgId,
        'Durable Person',
        'pm@octapm.demo',
        'x',
        'pm',
      ]);
    });
    await insideRollback('a certification company and person (the rule itself)', 'accepted', async () => {
      await makeOrg('Guard Proof Co (CERT-999)', 'cert-999-guard-proof');
      await cert.query('insert into "User" (id, "orgId", name, email, "passwordHash", role, "updatedAt") values (gen_random_uuid(), $1, $2, $3, $4, $5, now())', [
        orgId,
        'Certification Person',
        'person@c999.octapm-cert.test',
        'x',
        'pm',
      ]);
    });

    // The transaction left nothing behind.
    const left = await query('select count(*)::int as n from "Organisation" where id = $1', [orgId]);
    record('nothing left behind by the proof', 0, left[0].n);
    const marker = await query(`select count(*)::int as n from ${guard.MARKER_TABLE}`);
    record('the marker is still exactly one row', 1, marker[0].n);
  } finally {
    await cert.end();
  }

  // ── one organisation, before a per-company reset ───────────────────────
  const org = (fields) => () => guard.assertCertOrganisation(fields);
  record('organisation: undefined', 'organisation-missing', await ruleOf(org(undefined)));
  record('organisation: no id', 'organisation-missing', await ruleOf(org({ slug: 'cert-001-a', name: 'A (CERT-001)' })));
  record('organisation: durable', 'organisation-not-certification', await ruleOf(org({ id: 'x', slug: 'octapm-demo-contracting', name: 'OctaPM Demo Contracting' })));
  record('organisation: certification', 'accepted', await ruleOf(org({ id: 'x', slug: 'cert-001-a', name: 'A (CERT-001)' })));

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: expected ${r.expected}, got ${r.actual}`);
  console.log(`\n${results.length - failed.length} of ${results.length} cases behaved as expected`);
  process.exitCode = failed.length ? 1 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
