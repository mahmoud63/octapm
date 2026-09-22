/**
 * Measures the Prisma pool config/db.js builds, against the real Postgres.
 *
 * PROBE_MODE=pids (default): PROBE_CONCURRENCY queries at once, each holding
 * its connection for PROBE_SLEEP_SECONDS, then prints how many distinct
 * server backends served them — the pool's real size.
 * PROBE_MODE=timeout: two queries sleeping PROBE_SLEEP_SECONDS each; with a
 * one-connection pool the second waits for a connection and should give up
 * after pool_timeout with P2024.
 *
 * Prints one line, `POOL_RESULT <json>`, and exits 0; a failure to even build
 * the client prints `POOL_ERROR <message>` and exits 1.
 */
const { prisma } = require("../../config/db");

const concurrency = Number(process.env.PROBE_CONCURRENCY || 6);
const sleepSeconds = Number(process.env.PROBE_SLEEP_SECONDS || 0.6);

const pidQuery = () =>
  prisma.$queryRawUnsafe(
    `select pg_backend_pid() as pid, (select 1 from pg_sleep(${sleepSeconds})) as slept`,
  );

const main = async () => {
  if (process.env.PROBE_MODE === "timeout") {
    // Each outcome is stamped with when it settled, so a fast P2024 can be
    // told apart from one that merely waited for the sleeping query.
    const started = Date.now();
    const settle = (promise) =>
      promise.then(
        () => ({ ok: true, atMs: Date.now() - started }),
        (error) => ({ ok: false, atMs: Date.now() - started, code: error.code || null, message: String(error.message || "").slice(0, 300) }),
      );
    const outcomes = await Promise.all([settle(pidQuery()), settle(pidQuery())]);
    return { outcomes };
  }

  const rows = await Promise.all(Array.from({ length: concurrency }, pidQuery));
  return { distinctPids: new Set(rows.map((row) => row[0].pid)).size };
};

main()
  .then(async (result) => {
    console.log(`POOL_RESULT ${JSON.stringify(result)}`);
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.log(`POOL_ERROR ${error.message}`);
    try {
      await prisma.$disconnect();
    } catch {
      // The client may never have been built.
    }
    process.exit(1);
  });
