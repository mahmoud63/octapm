const globalForPrisma = global;

// Pool settings a process may take from its environment. On AWS each ECS
// service sizes its own pool (the API and the worker want different numbers)
// without a second copy of the DATABASE_URL secret.
const POOL_SETTINGS = [
  { env: 'DATABASE_CONNECTION_LIMIT', param: 'connection_limit' },
  { env: 'DATABASE_POOL_TIMEOUT_SECONDS', param: 'pool_timeout' },
];

// Under jest a process that leaks or races a client should hit a small
// ceiling, not Prisma's default of cores × 2 + 1 connections each.
const TEST_CONNECTION_LIMIT = 3;

const queryOf = (url) => {
  const index = url.indexOf('?');
  return new URLSearchParams(index === -1 ? '' : url.slice(index + 1));
};

/**
 * A pool setting from the environment as a positive integer, null when unset.
 * Anything else throws: a typo here would otherwise leave the pool at Prisma's
 * default, which is exactly the size the setting exists to prevent.
 */
const readPoolSetting = (env, key) => {
  const raw = String(env[key] ?? '').trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`${key} must be a positive whole number (got "${env[key]}")`);
  }
  return Number(raw);
};

/**
 * The URL Prisma should connect with, or undefined to leave Prisma to read
 * DATABASE_URL itself exactly as it always has.
 *
 * DATABASE_CONNECTION_LIMIT and DATABASE_POOL_TIMEOUT_SECONDS are added as
 * connection_limit and pool_timeout, but a parameter already written into the
 * URL wins: whoever wrote it into the secret meant it. The rest of the URL is
 * kept byte for byte (a re-serialised URL can re-encode a password).
 */
const buildDatasourceUrl = (env = process.env) => {
  const url = String(env.DATABASE_URL ?? '').trim();
  if (!url) return undefined;

  const values = POOL_SETTINGS.map((setting) => [setting, readPoolSetting(env, setting.env)]);
  if (env.NODE_ENV === 'test' && values[0][1] === null) {
    values[0][1] = TEST_CONNECTION_LIMIT;
  }
  if (values.every(([, value]) => value === null)) return undefined;

  const present = queryOf(url);
  const additions = values
    .filter(([setting, value]) => value !== null && !present.has(setting.param))
    .map(([setting, value]) => `${setting.param}=${value}`);
  if (!additions.length) return url;

  return `${url}${url.includes('?') ? '&' : '?'}${additions.join('&')}`;
};

/**
 * Lazy-initialise PrismaClient so that merely *importing* this module does
 * not throw when `prisma generate` has not been run (e.g. the OpenAPI
 * validation CI step, which imports the full Express app tree but never
 * makes any database calls).
 */
const getPrismaClient = () => {
  if (!globalForPrisma.__prisma) {
    const { PrismaClient } = require('@prisma/client');
    const datasourceUrl = buildDatasourceUrl();
    // With no pool setting in play the client is built exactly as it always
    // was, so local development connects the way it did before.
    globalForPrisma.__prisma = datasourceUrl
      ? new PrismaClient({ datasourceUrl })
      : new PrismaClient();
  }
  return globalForPrisma.__prisma;
};

const prisma = new Proxy(
  {},
  {
    get(_target, prop) {
      return getPrismaClient()[prop];
    },
    has(_target, prop) {
      return prop in getPrismaClient();
    },
  },
);

module.exports = { prisma, buildDatasourceUrl, readPoolSetting };
