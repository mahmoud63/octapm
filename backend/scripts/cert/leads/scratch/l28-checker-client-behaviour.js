'use strict';

/**
 * L28, independent check — what the client that config/db.js builds does with
 * a bulk write whose filter is undefined throughout.
 *
 * NO DATABASE IS CONTACTED. The client is pointed, explicitly, at
 * 127.0.0.1:1 (nothing listens there), and the script stops unless that is
 * the URL config/db.js hands to Prisma. The statement itself is a no-op
 * (`count: { increment: 0 }` on the rate-limit counters) even if it could run.
 *
 *   plain    the client exactly as config/db.js builds it today
 *   guarded  the same module, after the live-test guard has patched
 *            PrismaClient (what the proposed fix amounts to)
 *
 * A guard refuses BEFORE the engine is asked to connect, so:
 *   UnscopedBulkWriteError            → the write was refused by a guard
 *   "Can't reach database server"     → nothing refused it; it went to the engine
 */

const path = require('path');

const DEAD = 'postgresql://nobody:nothing@127.0.0.1:1/none';
const mode = process.argv[2] === 'guarded' ? 'guarded' : 'plain';
const SRC = path.join(__dirname, '..', '..', '..', '..', 'src');

process.env.DATABASE_URL = DEAD;
process.env.DATABASE_CONNECTION_LIMIT = '1'; // makes config/db.js pass datasourceUrl explicitly
delete global.__prisma;

if (mode === 'guarded') require(path.join(SRC, '__live__', 'bulk-write-guard.js')).installBulkWriteGuard();

const { prisma, buildDatasourceUrl } = require(path.join(SRC, 'config', 'db.js'));

const main = async () => {
  const url = buildDatasourceUrl();
  if (typeof url !== 'string' || !url.startsWith(DEAD)) {
    console.log(`STOP: config/db.js would not use the dead URL (got ${url === undefined ? 'undefined' : 'another URL'}); nothing was sent.`);
    process.exitCode = 1;
    return;
  }
  console.log(`mode=${mode}  datasource=127.0.0.1:1 (nothing listens)`);
  const fixture = {}; // what a failed lookup leaves behind
  const cases = [
    ['rateLimitBucket.updateMany({ where: { key: fixture.key }, data: { count: { increment: 0 } } })', () => prisma.rateLimitBucket.updateMany({ where: { key: fixture.key }, data: { count: { increment: 0 } } })],
    ['rateLimitBucket.updateMany({ where: { key: fixture.key, count: 0 }, ... })  (one value undefined, one fixed)', () => prisma.rateLimitBucket.updateMany({ where: { key: fixture.key, count: 0 }, data: { count: { increment: 0 } } })],
  ];
  for (const [label, run] of cases) {
    let outcome;
    try {
      const result = await run();
      outcome = `RAN (count ${result?.count})`;
    } catch (error) {
      outcome = error.name === 'UnscopedBulkWriteError'
        ? 'REFUSED by the guard (UnscopedBulkWriteError) before the engine was reached'
        : /Can't reach database server|P1001/.test(`${error.message} ${error.errorCode || error.code || ''}`)
          ? `NOT refused: handed to the engine, which then could not connect (${error.name}${error.errorCode ? ` ${error.errorCode}` : ''})`
          : `other error: ${error.name}: ${String(error.message).split('\n').filter(Boolean).pop()}`;
    }
    console.log(`   ${label}\n      -> ${outcome}`);
  }
  await prisma.$disconnect().catch(() => {});
};

main().catch((error) => {
  console.log(`unexpected: ${error.name}: ${error.message}`);
  process.exitCode = 1;
});
