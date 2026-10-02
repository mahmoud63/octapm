'use strict';

/**
 * The identity of the certification environment, and the guard every
 * certification script goes through before it writes or deletes anything.
 *
 * The certification population (a hundred test companies) lives in its own
 * database, `octapm_cert`, on its own Postgres cluster. It is disposable: it
 * is created, attacked, measured and reset by scripts. The durable databases —
 * the shared development database with the demonstration, UAT and E2E
 * organisations, and anything a customer will ever use — must never be
 * reachable from those scripts, whatever is or is not set in the environment.
 *
 * So the guard fails closed. A certification script:
 *
 *   - takes its database from CERT_DATABASE_URL and from nowhere else. It
 *     never falls back to DATABASE_URL, so an unset variable is a refusal,
 *     not a redirect to whatever the application happens to point at;
 *   - refuses unless the database in that address is named `octapm_cert`;
 *   - once connected, refuses unless the server says the same name, and the
 *     marker table `cert_meta.environment` holds exactly one row of kind
 *     `octapm-certification-disposable` whose id is the one in
 *     CERT_ENVIRONMENT_ID;
 *   - before anything destructive, refuses if the database holds a single
 *     user or organisation that does not carry the certification naming rule.
 *
 * Each refusal is a CertGuardError naming the rule that failed.
 */

const DATABASE_NAME = 'octapm_cert';
const MARKER_KIND = 'octapm-certification-disposable';
const MARKER_TABLE = 'cert_meta.environment';

/** Every certification user's address ends with this. */
const EMAIL_SUFFIX = '.octapm-cert.test';
/** Every certification company's slug starts with this, and its name ends with "(CERT-NNN)". */
const ORG_SLUG = /^cert-\d{3}-[a-z0-9-]+$/;
const ORG_NAME = /\(CERT-\d{3}\)$/;

class CertGuardError extends Error {
  constructor(rule, message) {
    super(`certification guard refused [${rule}]: ${message}`);
    this.name = 'CertGuardError';
    this.rule = rule;
  }
}

const refuse = (rule, message) => {
  throw new CertGuardError(rule, message);
};

/**
 * The certification database's address, or a refusal.
 *
 * Deliberately not `env.CERT_DATABASE_URL || env.DATABASE_URL`.
 */
function certDatabaseUrl(env = process.env) {
  const raw = env.CERT_DATABASE_URL;
  if (typeof raw !== 'string' || raw.trim() === '') {
    refuse('url-missing', 'CERT_DATABASE_URL is not set. Certification scripts never fall back to DATABASE_URL.');
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    refuse('url-invalid', 'CERT_DATABASE_URL is not a valid address.');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    refuse('url-invalid', 'CERT_DATABASE_URL is not a PostgreSQL address.');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (database !== DATABASE_NAME) {
    refuse('database-name', `the address names the database "${database}", not "${DATABASE_NAME}".`);
  }
  return raw;
}

/** The marker id this run expects, or a refusal. */
function expectedEnvironmentId(env = process.env) {
  const id = env.CERT_ENVIRONMENT_ID;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id.trim())) {
    refuse('environment-id-missing', 'CERT_ENVIRONMENT_ID is not set to the certification environment\'s marker id.');
  }
  return id.trim().toLowerCase();
}

/**
 * Proves a connected client is on the certification database.
 *
 * `query(sql, params)` must resolve to an array of rows. With
 * `destructive: true` it also proves the database holds nothing but
 * certification data, which is what a reset must know before it deletes.
 */
async function assertCertEnvironment(query, { env = process.env, destructive = false } = {}) {
  const expectedId = expectedEnvironmentId(env);

  const [where] = await query('select current_database() as database');
  if (!where || where.database !== DATABASE_NAME) {
    refuse('database-name', `connected to "${where && where.database}", not "${DATABASE_NAME}".`);
  }

  // Cast to text: Prisma's raw query cannot read a regclass column.
  const [table] = await query("select to_regclass($1)::text as found", [MARKER_TABLE]);
  if (!table || !table.found) {
    refuse('marker-missing', `${MARKER_TABLE} does not exist: this is not the certification environment.`);
  }
  const markers = await query(`select id::text as id, kind from ${MARKER_TABLE}`);
  if (markers.length !== 1) {
    refuse('marker-missing', `${MARKER_TABLE} holds ${markers.length} rows; exactly one is expected.`);
  }
  if (markers[0].kind !== MARKER_KIND) {
    refuse('marker-kind', `the marker is of kind "${markers[0].kind}".`);
  }
  if (markers[0].id.toLowerCase() !== expectedId) {
    refuse('marker-mismatch', 'the marker in the database is not the one in CERT_ENVIRONMENT_ID.');
  }

  if (destructive) {
    const strangers = await query(
      'select count(*)::int as n from "User" where email not like $1',
      ['%' + EMAIL_SUFFIX]
    );
    if (strangers[0].n > 0) {
      refuse('foreign-user', `${strangers[0].n} user(s) do not carry the certification address rule (*${EMAIL_SUFFIX}).`);
    }
    // A company that is not a certification company. Personal workspaces are
    // made by the product for each user, so they are judged by their users
    // (above), not by their slug.
    const foreign = await query(
      `select count(*)::int as n from "Organisation"
        where kind <> 'personal' and (slug is null or slug !~ $1 or name !~ $2)`,
      [ORG_SLUG.source, ORG_NAME.source]
    );
    if (foreign[0].n > 0) {
      refuse('foreign-organisation', `${foreign[0].n} company organisation(s) do not carry the certification naming rule.`);
    }
  }
  return { database: DATABASE_NAME, environmentId: expectedId };
}

/**
 * Proves one organisation is a certification company before a script resets
 * or deletes it. Refuses a missing id, a missing row and any organisation
 * that does not carry the naming rule.
 */
function assertCertOrganisation(organisation) {
  if (!organisation || typeof organisation !== 'object') {
    refuse('organisation-missing', 'no organisation was given.');
  }
  if (typeof organisation.id !== 'string' || organisation.id.trim() === '') {
    refuse('organisation-missing', 'the organisation has no id.');
  }
  if (typeof organisation.slug !== 'string' || !ORG_SLUG.test(organisation.slug)) {
    refuse('organisation-not-certification', `the organisation's slug "${organisation.slug}" is not a certification slug.`);
  }
  if (typeof organisation.name !== 'string' || !ORG_NAME.test(organisation.name)) {
    refuse('organisation-not-certification', 'the organisation\'s name does not end with a certification code.');
  }
  return organisation;
}

/** A pg client on the certification database, already proven. */
async function connectCert({ env = process.env, destructive = false } = {}) {
  const connectionString = certDatabaseUrl(env);
  expectedEnvironmentId(env);
  // eslint-disable-next-line global-require
  const { Client } = require('pg');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await assertCertEnvironment(async (sql, params) => (await client.query(sql, params)).rows, { env, destructive });
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
  return client;
}

/** A Prisma client on the certification database, already proven. Never the application's default. */
async function connectCertPrisma({ env = process.env, destructive = false } = {}) {
  const url = certDatabaseUrl(env);
  expectedEnvironmentId(env);
  // eslint-disable-next-line global-require
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await assertCertEnvironment((sql, params = []) => prisma.$queryRawUnsafe(sql, ...params), { env, destructive });
  } catch (error) {
    await prisma.$disconnect().catch(() => {});
    throw error;
  }
  return prisma;
}

module.exports = {
  DATABASE_NAME,
  MARKER_KIND,
  MARKER_TABLE,
  EMAIL_SUFFIX,
  ORG_SLUG,
  ORG_NAME,
  CertGuardError,
  certDatabaseUrl,
  expectedEnvironmentId,
  assertCertEnvironment,
  assertCertOrganisation,
  connectCert,
  connectCertPrisma,
};
