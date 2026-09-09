/**
 * The action centre's model names have to be real.
 *
 * `purchaseOrder` was not: the model is `procurementOrder`. The lookup was
 * guarded with a skip-if-missing, so every buyer's orders were simply absent
 * from the one screen meant to list their work, and nothing failed
 * (OCTA-UX-ACTION-098).
 *
 * This runs against the real client rather than a mock, so it checks the
 * schema and not a second copy of the same guess.
 */

jest.unmock("../../config/db");

const { DERIVED_MODELS } = require("../record-assignment.service");
const { prisma } = require("../../config/db");

describe("the action centre's derived record models", () => {

  // Release the pool. Jest runs these files in one process, and a real-database
  // suite that walks away from its connections leaves them idle for every suite
  // that follows — measured at 53 idle connections part-way through a full run,
  // which is how a report test that takes 1.8s alone began exceeding a five
  // second timeout (OCTA-QA-POOL-112).
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it("names a Prisma model that exists, for every record type", () => {
    const missing = Object.entries(DERIVED_MODELS)
      .filter(([, config]) => typeof prisma[config.model]?.findMany !== "function")
      .map(([recordType, config]) => `${recordType} → ${config.model}`);
    expect(missing).toEqual([]);
  });

  it("selects fields the model actually has", async () => {
    const broken = [];
    for (const [recordType, config] of Object.entries(DERIVED_MODELS)) {
      try {
        await prisma[config.model].findMany({
          select: {
            id: true,
            ref: true,
            status: true,
            [config.titleField]: true,
            ...Object.fromEntries((config.extraFields || []).map((f) => [f, true])),
          },
          take: 1,
        });
      } catch (error) {
        broken.push(`${recordType} → ${config.model}: ${error.message.split("\n")[0]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
