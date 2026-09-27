/**
 * Live tests share one database with the running API, the demo and E2E
 * organisations and the certified project. Prisma drops a filter whose value
 * is `undefined`, so `updateMany({ where: { orgId: x.orgId, userId: y.id } })`
 * with a fixture that failed to load becomes "update every row in the table".
 * That happened on 2026-09-26: one test's update ran unscoped and gave every
 * membership in the database the PM role.
 *
 * Installed by enable-live.js before any test file loads, this wraps the
 * PrismaClient every live test and every in-process service constructs, and
 * refuses a bulk update or delete whose `where` is missing, empty, or made of
 * `undefined` values only. A scoped bulk write — any filter with a value —
 * runs as before; product code has no unscoped bulk write for it to refuse.
 */
const BULK_OPERATIONS = ["updateMany", "updateManyAndReturn", "deleteMany"];

const isUnscoped = (where) =>
  where === undefined ||
  where === null ||
  typeof where !== "object" ||
  Object.values(where).every((value) => value === undefined);

class UnscopedBulkWriteError extends Error {
  constructor(model, operation) {
    super(
      `Refused ${model}.${operation} with no filter: its \`where\` is empty or every value in it is undefined, ` +
        "so it would touch every row of the shared database. Check the fixture the filter values come from.",
    );
    this.name = "UnscopedBulkWriteError";
  }
}

const guardExtension = {
  name: "live-bulk-write-guard",
  query: {
    $allModels: Object.fromEntries(
      BULK_OPERATIONS.map((operation) => [
        operation,
        async ({ model, args, query }) => {
          if (isUnscoped(args?.where)) throw new UnscopedBulkWriteError(model, operation);
          return query(args);
        },
      ]),
    ),
  },
};

const installBulkWriteGuard = () => {
  const prismaModule = require("@prisma/client");
  const Original = prismaModule.PrismaClient;
  if (Original.bulkWriteGuarded) return;
  class GuardedPrismaClient extends Original {
    constructor(...args) {
      super(...args);
      // A constructor may return another object; the extended client keeps
      // $transaction, $queryRaw and $disconnect, and applies the guard inside
      // interactive transactions too.
      return this.$extends(guardExtension);
    }
  }
  GuardedPrismaClient.bulkWriteGuarded = true;
  prismaModule.PrismaClient = GuardedPrismaClient;
};

module.exports = { installBulkWriteGuard, isUnscoped, UnscopedBulkWriteError };
