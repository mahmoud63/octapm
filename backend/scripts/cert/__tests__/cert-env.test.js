'use strict';

const {
  CertGuardError,
  certDatabaseUrl,
  expectedEnvironmentId,
  assertCertEnvironment,
  assertCertOrganisation,
} = require('../lib/cert-env');

const ID = 'fdae416f-e309-49bd-a1fb-0040d8b19f63';
const GOOD_URL = 'postgresql://postgres:secret@localhost:55433/octapm_cert?schema=public';

/** A stand-in for a connected client: answers each guard query from `state`. */
const database = (state) => async (sql, params = []) => {
  if (/current_database\(\)/.test(sql)) return [{ database: state.database }];
  if (/to_regclass/.test(sql)) return [{ found: state.markerTable ? params[0] : null }];
  if (/from cert_meta\.environment/.test(sql)) return state.markers;
  if (/from "User"/.test(sql)) return [{ n: state.foreignUsers }];
  if (/from "Organisation"/.test(sql)) return [{ n: state.foreignOrganisations }];
  throw new Error(`unexpected query: ${sql}`);
};

const certification = () => ({
  database: 'octapm_cert',
  markerTable: true,
  markers: [{ id: ID, kind: 'octapm-certification-disposable' }],
  foreignUsers: 0,
  foreignOrganisations: 0,
});

const rule = async (run) => {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(CertGuardError);
    return error.rule;
  }
  return 'accepted';
};

describe('the certification database address', () => {
  test('an unset CERT_DATABASE_URL is a refusal, never a fall back to DATABASE_URL', async () => {
    const env = { DATABASE_URL: 'postgresql://postgres:x@localhost:55432/octapm_verify' };
    expect(await rule(() => certDatabaseUrl(env))).toBe('url-missing');
    expect(await rule(() => certDatabaseUrl({ ...env, CERT_DATABASE_URL: '' }))).toBe('url-missing');
    expect(await rule(() => certDatabaseUrl({ ...env, CERT_DATABASE_URL: '   ' }))).toBe('url-missing');
    expect(await rule(() => certDatabaseUrl({ ...env, CERT_DATABASE_URL: undefined }))).toBe('url-missing');
  });

  test('any database but octapm_cert is refused', async () => {
    for (const name of ['octapm_verify', 'octapm', 'postgres', 'octapm_cert2', 'octapm_cert_old', 'OCTAPM_CERT', '']) {
      const url = `postgresql://postgres:x@localhost:55433/${name}`;
      expect(await rule(() => certDatabaseUrl({ CERT_DATABASE_URL: url }))).toBe('database-name');
    }
  });

  test('something that is not a PostgreSQL address is refused', async () => {
    expect(await rule(() => certDatabaseUrl({ CERT_DATABASE_URL: 'octapm_cert' }))).toBe('url-invalid');
    expect(await rule(() => certDatabaseUrl({ CERT_DATABASE_URL: 'mysql://root@localhost/octapm_cert' }))).toBe('url-invalid');
  });

  test('the certification address is accepted as given', () => {
    expect(certDatabaseUrl({ CERT_DATABASE_URL: GOOD_URL })).toBe(GOOD_URL);
  });

  test('the environment id must be named', async () => {
    expect(await rule(() => expectedEnvironmentId({}))).toBe('environment-id-missing');
    expect(await rule(() => expectedEnvironmentId({ CERT_ENVIRONMENT_ID: 'yes' }))).toBe('environment-id-missing');
    expect(expectedEnvironmentId({ CERT_ENVIRONMENT_ID: ID.toUpperCase() })).toBe(ID);
  });
});

describe('the connected database', () => {
  const env = { CERT_DATABASE_URL: GOOD_URL, CERT_ENVIRONMENT_ID: ID };

  test('the certification database is accepted', async () => {
    expect(await assertCertEnvironment(database(certification()), { env, destructive: true })).toEqual({
      database: 'octapm_cert',
      environmentId: ID,
    });
  });

  test('a server that answers with another database name is refused, whatever the address said', async () => {
    const state = { ...certification(), database: 'octapm_verify' };
    expect(await rule(() => assertCertEnvironment(database(state), { env }))).toBe('database-name');
  });

  test('a database without the marker table is refused', async () => {
    const state = { ...certification(), markerTable: false };
    expect(await rule(() => assertCertEnvironment(database(state), { env }))).toBe('marker-missing');
  });

  test('no marker row, or more than one, is refused', async () => {
    expect(await rule(() => assertCertEnvironment(database({ ...certification(), markers: [] }), { env }))).toBe('marker-missing');
    const two = [
      { id: ID, kind: 'octapm-certification-disposable' },
      { id: ID, kind: 'octapm-certification-disposable' },
    ];
    expect(await rule(() => assertCertEnvironment(database({ ...certification(), markers: two }), { env }))).toBe('marker-missing');
  });

  test('a marker of another kind, or with another id, is refused', async () => {
    const kind = [{ id: ID, kind: 'production' }];
    expect(await rule(() => assertCertEnvironment(database({ ...certification(), markers: kind }), { env }))).toBe('marker-kind');
    const other = [{ id: '00000000-0000-4000-8000-000000000000', kind: 'octapm-certification-disposable' }];
    expect(await rule(() => assertCertEnvironment(database({ ...certification(), markers: other }), { env }))).toBe('marker-mismatch');
  });

  test('a run that does not name the environment id is refused before the database is asked anything', async () => {
    const asked = jest.fn(database(certification()));
    expect(await rule(() => assertCertEnvironment(asked, { env: { CERT_DATABASE_URL: GOOD_URL } }))).toBe('environment-id-missing');
    expect(asked).not.toHaveBeenCalled();
  });

  test('before anything destructive, one user or company that is not a certification one is a refusal', async () => {
    const user = { ...certification(), foreignUsers: 1 };
    expect(await rule(() => assertCertEnvironment(database(user), { env, destructive: true }))).toBe('foreign-user');
    const company = { ...certification(), foreignOrganisations: 1 };
    expect(await rule(() => assertCertEnvironment(database(company), { env, destructive: true }))).toBe('foreign-organisation');
    // A read does not need the population to be clean; a reset does.
    expect(await rule(() => assertCertEnvironment(database(user), { env }))).toBe('accepted');
  });
});

describe('one organisation', () => {
  const company = { id: 'b1e0…', slug: 'cert-007-harbour-civil', name: 'Harbour Civil Works (CERT-007)' };

  test('a certification company is accepted', () => {
    expect(assertCertOrganisation(company)).toBe(company);
  });

  test('a missing organisation or a missing id is refused', async () => {
    expect(await rule(() => assertCertOrganisation(undefined))).toBe('organisation-missing');
    expect(await rule(() => assertCertOrganisation(null))).toBe('organisation-missing');
    expect(await rule(() => assertCertOrganisation({ ...company, id: undefined }))).toBe('organisation-missing');
    expect(await rule(() => assertCertOrganisation({ ...company, id: '' }))).toBe('organisation-missing');
  });

  test('an organisation without the certification slug and name is refused', async () => {
    for (const slug of [null, undefined, '', 'acme', 'octapm-demo', 'octapm-e2e', 'cert', 'cert-7-x', 'xcert-007-x', 'CERT-007-x']) {
      expect(await rule(() => assertCertOrganisation({ ...company, slug }))).toBe('organisation-not-certification');
    }
    for (const name of [null, '', 'Harbour Civil Works', 'OctaPM Demo', '(CERT-007) Harbour', 'Harbour (CERT-7)']) {
      expect(await rule(() => assertCertOrganisation({ ...company, name }))).toBe('organisation-not-certification');
    }
  });
});
