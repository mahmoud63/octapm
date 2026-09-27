/**
 * The membership integrity sentinel around every live-test run
 * (jest.live.config.js globalSetup / globalTeardown).
 *
 * Before the first suite: the state of every durable organisation's
 * memberships, and the standing invariants. After the last: the invariants
 * again, and a comparison — a membership that existed before must keep its
 * role, kind, admin, owner and status. Suites create throwaway "LiveTest"
 * organisations and may add memberships; they may not change the demo, E2E,
 * UAT or any other durable organisation's people. When one does, the run fails
 * here, naming the rows, instead of two hours later (the 2026-09-26 incident).
 *
 * Invariant violations that already stand before the run are reported but do
 * not fail it — this run did not cause them; the checkpoints do fail on them.
 */
const path = require("path");

const loadEnv = () => {
  require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });
  process.env.DATABASE_URL = require("./helpers").withConnectionLimit(process.env.DATABASE_URL, 2);
};

const sentinel = () => require("../../scripts/enterprise/membership-integrity");

const withClient = async (work) => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    return await work(prisma);
  } finally {
    await prisma.$disconnect();
  }
};

const setup = async () => {
  loadEnv();
  const { captureState, checkInvariants } = sentinel();
  const before = await withClient(captureState);
  const standing = checkInvariants(before);
  if (standing.length) {
    console.warn(`\n[membership sentinel] ${standing.length} invariant violation(s) stand BEFORE this run (not caused by it):`);
    for (const v of standing) console.warn(`  ${JSON.stringify(v)}`);
  }
  globalThis.__membershipSentinel = { before, standing: new Set(standing.map((v) => JSON.stringify(v))) };
};

const teardown = async () => {
  const saved = globalThis.__membershipSentinel;
  if (!saved) return;
  const { captureState, checkInvariants, compareStates } = sentinel();
  const after = await withClient(captureState);
  // includeOrgIds lets the sentinel's own live test treat its throwaway
  // organisation as durable; a real run leaves it empty.
  const options = { includeOrgIds: saved.includeOrgIds || [] };
  const fresh = checkInvariants(after, options).filter((v) => !saved.standing.has(JSON.stringify(v)));
  const { violations, created, broad } = compareStates(saved.before, after, options);
  const all = [...violations, ...fresh];
  if (!all.length) {
    console.log(`\n[membership sentinel] PASS — durable memberships unchanged (${created} created by this run)`);
    return;
  }
  const lines = all.map((v) => `  ${JSON.stringify(v)}`).join("\n");
  const headline = broad.length ? `BROAD CHANGE in ${broad.map((b) => `${b.orgId} (${b.changed} rows)`).join(", ")} — ` : "";
  throw new Error(`[membership sentinel] ${headline}${all.length} unexpected change(s) to durable memberships during this live run:\n${lines}`);
};

module.exports = { setup, teardown };
