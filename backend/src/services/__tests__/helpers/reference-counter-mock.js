/**
 * The two raw queries `utils/reference-number` needs, for mocked Prisma.
 *
 * References are no longer counted; they are drawn from a counter row advanced
 * by a single atomic statement (OCTA-API-REFNUM-111). That is two raw queries —
 * a seed read the first time a scope is used, and the counter upsert — and the
 * hand-rolled fake tables in these suites implement neither.
 *
 * This is a behavioural double, not a SQL engine, and it is deliberately
 * transparent about where the seed comes from: for a register that keeps its
 * number in an integer column it **delegates to the suite's own `aggregate`
 * stub**, parsing the table and scope back out of the SQL. That matters,
 * because those fixtures say things like "pretend six punch items exist" and
 * then assert the seventh is numbered 007. Returning a flat zero here would
 * quietly rewrite what every one of those tests is about.
 *
 * Deliberately **plain functions, not `jest.fn()`**: several suites call
 * `jest.resetAllMocks()` in `beforeEach`, which strips the implementation out
 * of a `jest.fn()` and would leave the helper reading `undefined`.
 *
 *   const mockPrisma = { ...referenceCounterMock(), punchItem: { ... } };
 *
 * `highest` is the fallback for the text-reference family, whose suites have no
 * `aggregate` stub to delegate to.
 */

/** "PunchItem" -> "punchItem", the Prisma delegate name. */
const delegateFor = (table) => table.charAt(0).toLowerCase() + table.slice(1);

const referenceCounterMock = ({ highest = 0 } = {}) => {
  const counters = new Map();

  // The real counter persists for the life of the database; a test fixture
  // must not. Left to accumulate, the second test in a file starts from where
  // the first one finished and a suite that stubs "pretend six exist" then
  // asserts the seventh gets 009 instead. The helper registers its own reset
  // so no caller has to remember one.
  if (typeof beforeEach === "function") {
    beforeEach(() => counters.clear());
  }

  return {
    /**
     * The seed read. Two shapes reach here:
     *
     *   MAX(SUBSTRING("ref" FROM n)::int)  — the text-reference family, whose
     *     fixtures carry no generated references, so the seed is `highest`.
     *   MAX("number")::int                 — the integer-column family, which
     *     delegates to the suite's own aggregate stub so its fixture wins.
     */
    async $queryRawUnsafe(sql, ...params) {
      if (typeof sql !== "string" || sql.includes("SUBSTRING")) {
        return [{ highest }];
      }

      const table = sql.match(/FROM "([A-Za-z]+)"/)?.[1];
      const delegate = table ? this[delegateFor(table)] : null;
      if (!delegate?.aggregate) return [{ highest }];

      // Rebuild the `where` from the positional parameters, in the order the
      // helper emitted them, so the stub sees the call it expects.
      const columns = [...sql.matchAll(/"([A-Za-z]+)" = \$\d+/g)].map((m) => m[1]);
      const where = {};
      columns.forEach((column, index) => {
        where[column] = params[index];
      });

      const result = await delegate.aggregate({ where, _max: { number: true } });
      return [{ highest: result?._max?.number ?? 0 }];
    },

    /**
     * The counter upsert, called as a tagged template with (scope, seed).
     * First use takes the seed; later ones advance.
     */
    async $queryRaw(_strings, ...values) {
      const [scope, seed] = values;
      const next = counters.has(scope) ? counters.get(scope) + 1 : Number(seed) || 1;
      counters.set(scope, next);
      return [{ next }];
    },
  };
};

module.exports = { referenceCounterMock };
