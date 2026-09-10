/**
 * The two reference generators Phase 20.5's audit missed.
 *
 * That audit grepped for `count + 1` and `_max: { number }` and moved 34 call
 * sites onto the atomic counter. Both of these were already past `count + 1`
 * — they read `MAX(...) + 1` — but they are written in raw SQL, so neither
 * pattern matched and neither was found. `MAX + 1` is gap-safe and
 * race-unsafe: two callers read the same maximum, both compute the same
 * reference, and the second loses on the unique index with an HTTP 500. The
 * goods-receipt generator said so in its own docstring: "the unique index
 * remains the real guarantee — this only stops it firing in ordinary use."
 *
 *   goods receipt   DeliveryReceipt.receiptNumber   GRN-00001
 *   purchase order  ProcurementOrder.ref            PO-00001
 *
 * Runs against the real database. Whether a statement is atomic is a question
 * about PostgreSQL, not about JavaScript, and a mock would only restate the
 * assumption being tested (Phase 20.6).
 */

jest.unmock("../../config/db");
jest.setTimeout(30_000);

const { prisma } = require("../../config/db");
const { nextReceiptNumber } = require("../goods-receipt.service");
const { nextOrderRef } = require("../procurement.service");

/** 20, not 50: 20 proves distinctness and leaves the local pool room to breathe. */
const RACERS = 20;

const numberOf = (ref) => Number(String(ref).split("-")[1]);

describe("the raw-SQL reference generators are safe under concurrency", () => {
  let project;

  beforeAll(async () => {
    project = await prisma.project.findFirst({
      where: { name: "Riverside Tower" },
      select: { id: true },
    });
  });

  afterAll(async () => {
    // After the assertions, so nothing forces a reconnect mid-teardown
    // (OCTA-QA-POOL-112).
    await prisma.$disconnect();
  });

  it("has the seeded project to work against", () => {
    expect(project?.id).toBeTruthy();
  });

  describe.each([
    ["goods receipt", "GRN", () => nextReceiptNumber(prisma, project.id)],
    ["purchase order", "PO", () => nextOrderRef(prisma, project.id)],
  ])("%s", (_label, prefix, issue) => {
    it("gives every one of twenty simultaneous callers a different reference", async () => {
      const refs = await Promise.all(Array.from({ length: RACERS }, issue));

      expect(refs).toHaveLength(RACERS);
      expect(new Set(refs).size).toBe(RACERS);
      for (const ref of refs) {
        expect(ref).toMatch(new RegExp(`^${prefix}-\\d{5}$`));
      }
    });

    it("issues a contiguous run, so nothing is skipped or repeated", async () => {
      const refs = await Promise.all(Array.from({ length: RACERS }, issue));
      const numbers = refs.map(numberOf).sort((a, b) => a - b);

      expect(numbers[numbers.length - 1] - numbers[0]).toBe(RACERS - 1);
    });

    it("issues a reference no row already holds", async () => {
      const ref = await issue();
      const table = prefix === "GRN" ? "deliveryReceipt" : "procurementOrder";
      const column = prefix === "GRN" ? "receiptNumber" : "ref";

      const clash = await prisma[table].findFirst({
        where: { projectId: project.id, [column]: ref },
        select: { id: true },
      });

      expect(clash).toBeNull();
    });

    it("never goes backwards over a reference already issued", async () => {
      const first = numberOf(await issue());
      const second = numberOf(await issue());

      expect(second).toBeGreaterThan(first);
    });
  });
});
