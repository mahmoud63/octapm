/**
 * The two raw queries `utils/reference-number` needs, for mocked Prisma.
 *
 * References are no longer counted; they are drawn from a counter row advanced
 * by a single atomic statement (OCTA-API-REFNUM-111). That is two raw queries —
 * a MAX to seed a scope the first time it is used, and the counter upsert — and
 * the hand-rolled fake tables in these suites implement neither.
 *
 * This is a behavioural double, not a SQL engine. It models the contract the
 * helper depends on: a scope starts at `highest + 1` and advances by one each
 * time. That is what the register fixtures assume when they expect the first
 * task to be TSK-0001.
 *
 * Deliberately **plain functions, not `jest.fn()`**: several of these suites
 * call `jest.resetAllMocks()` in `beforeEach`, which strips the implementation
 * out of a `jest.fn()` and would leave the helper reading `undefined` from a
 * counter that answered nothing.
 *
 *   const mockPrisma = { ...referenceCounterMock(), user: table(...) };
 *
 * Pass `highest` where the fixture pretends records already exist, so the next
 * reference continues from them:
 *
 *   ...referenceCounterMock({ highest: 2 })   // next is 003
 */
const referenceCounterMock = ({ highest = 0 } = {}) => {
  const counters = new Map();

  return {
    /** The seed query: the highest reference already issued under a prefix. */
    $queryRawUnsafe: async () => [{ highest }],

    /**
     * The counter upsert, called as a tagged template with (scope, seed).
     * First use takes the seed; later ones advance.
     */
    $queryRaw: async (_strings, ...values) => {
      const [scope, seed] = values;
      const next = counters.has(scope) ? counters.get(scope) + 1 : Number(seed) || 1;
      counters.set(scope, next);
      return [{ next }];
    },
  };
};

module.exports = { referenceCounterMock };
