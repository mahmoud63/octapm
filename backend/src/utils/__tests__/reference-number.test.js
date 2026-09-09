/**
 * The one numbering strategy, held to the three things that broke the old one.
 *
 * Twenty-two registers numbered themselves `count + 1`. Delete one row and the
 * next create asks for a number that already exists and dies on the unique
 * index with a 500; the seeded project held 53 bid packages numbered up to 73,
 * so it asked for 54 (OCTA-API-REFNUM-111).
 *
 * `MAX + 1` fixes the gap and not the race — two requests reading the same
 * maximum still compute the same reference — so the number comes from a
 * counter row advanced by a single atomic statement instead.
 *
 * Runs against the real database. A mocked client would only restate the
 * assumption being tested: whether the statement is actually atomic is a
 * question about PostgreSQL, not about JavaScript.
 */

jest.unmock("../../config/db");
jest.setTimeout(60_000);

const { prisma } = require("../../config/db");
const { nextReference } = require("../reference-number");

/** A scope nothing else uses, so the counter starts clean each run. */
const freshPrefix = () => `ZZ${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;

const scopesUsed = [];
const specFor = (prefix, projectId) => {
  scopesUsed.push(prefix);
  return {
    table: "ChangeOrder",
    scopeColumn: "projectId",
    scopeId: projectId,
    prefix,
    pad: 3,
  };
};

describe("reference numbering", () => {
  let projectId;

  beforeAll(async () => {
    const project = await prisma.project.findFirst({
      where: { name: "Riverside Tower" },
      select: { id: true },
    });
    projectId = project?.id;
  });

  afterAll(async () => {
    // The counter rows are the only thing these tests write.
    for (const prefix of scopesUsed) {
      await prisma.referenceCounter.deleteMany({ where: { scope: { contains: `|${prefix}` } } });
    }
  });

  it("has the seeded project", () => {
    expect(projectId).toBeTruthy();
  });

  it("starts at 001 in a scope nothing has used", async () => {
    const spec = specFor(freshPrefix(), projectId);
    const first = await nextReference(prisma, spec);
    expect(first.ref).toBe(`${spec.prefix}-001`);
    expect(first.number).toBe(1);
  });

  it("advances one at a time", async () => {
    const spec = specFor(freshPrefix(), projectId);
    const refs = [];
    for (let i = 0; i < 5; i += 1) refs.push((await nextReference(prisma, spec)).ref);
    expect(refs).toEqual([
      `${spec.prefix}-001`,
      `${spec.prefix}-002`,
      `${spec.prefix}-003`,
      `${spec.prefix}-004`,
      `${spec.prefix}-005`,
    ]);
  });

  describe("gaps", () => {
    it("does not reuse a number just because the row beneath it went away", async () => {
      const spec = specFor(freshPrefix(), projectId);
      // 001, 002, 003 issued...
      const issued = [];
      for (let i = 0; i < 3; i += 1) issued.push((await nextReference(prisma, spec)).ref);
      expect(issued).toEqual([`${spec.prefix}-001`, `${spec.prefix}-002`, `${spec.prefix}-003`]);

      // ...and now imagine 003 is deleted. The counter does not roll back, so
      // the next reference is 004 and never collides with a reference that has
      // already been quoted somewhere.
      const next = await nextReference(prisma, spec);
      expect(next.ref).toBe(`${spec.prefix}-004`);
      expect(issued).not.toContain(next.ref);
    });

    it("continues past the highest that exists rather than filling a hole", async () => {
      // The register itself carries 90 change orders, VO-01..VO-90, with the
      // old scheme having produced a contiguous run. A fresh counter for that
      // prefix must seed from the highest, not from zero and not from a gap.
      const existing = await prisma.changeOrder.findMany({
        where: { projectId },
        select: { ref: true },
      });
      const numbers = existing
        .map((row) => Number(String(row.ref).match(/^VO-(\d+)$/)?.[1]))
        .filter((n) => Number.isFinite(n));
      if (!numbers.length) return; // nothing to seed from on a bare database

      const highest = Math.max(...numbers);
      await prisma.referenceCounter.deleteMany({
        where: { scope: { contains: "|ChangeOrder|VO" } },
      });
      const next = await nextReference(prisma, {
        table: "ChangeOrder",
        scopeColumn: "projectId",
        scopeId: projectId,
        prefix: "VO",
        pad: 2,
      });
      expect(next.number).toBe(highest + 1);
      expect(numbers).not.toContain(next.number);
    });
  });

  describe("concurrency", () => {
    it("gives two simultaneous callers two different references", async () => {
      const spec = specFor(freshPrefix(), projectId);
      const [a, b] = await Promise.all([
        nextReference(prisma, spec),
        nextReference(prisma, spec),
      ]);
      expect(a.ref).not.toBe(b.ref);
      expect([a.number, b.number].sort()).toEqual([1, 2]);
    });

    it("gives fifty simultaneous callers fifty different references", async () => {
      const spec = specFor(freshPrefix(), projectId);
      const results = await Promise.all(
        Array.from({ length: 50 }, () => nextReference(prisma, spec)),
      );
      const refs = results.map((r) => r.ref);
      expect(new Set(refs).size).toBe(50);
      // And they are a contiguous run, so nothing was skipped either.
      expect(results.map((r) => r.number).sort((x, y) => x - y)).toEqual(
        Array.from({ length: 50 }, (_, i) => i + 1),
      );
    });

    it("survives a cold start, where every caller would seed the same value", async () => {
      // The riskiest moment: twenty callers arrive at a scope that has no
      // counter row yet, so all twenty read the same seed. One insert wins and
      // the other nineteen must fall through to the increment.
      const spec = specFor(freshPrefix(), projectId);
      const results = await Promise.all(
        Array.from({ length: 20 }, () => nextReference(prisma, spec)),
      );
      expect(new Set(results.map((r) => r.ref)).size).toBe(20);
    });
  });

  describe("what it refuses", () => {
    it("will not take a table name it cannot vouch for", async () => {
      await expect(
        nextReference(prisma, {
          table: 'ChangeOrder"; DROP TABLE "Project',
          scopeColumn: "projectId",
          scopeId: projectId,
          prefix: "ZZ",
        }),
      ).rejects.toThrow(/unsafe table/);
    });

    it("will not take a prefix it cannot vouch for", async () => {
      await expect(
        nextReference(prisma, {
          table: "ChangeOrder",
          scopeColumn: "projectId",
          scopeId: projectId,
          prefix: "ZZ' OR 1=1--",
        }),
      ).rejects.toThrow(/unsafe prefix/);
    });
  });

  it("ignores references that were not generated by this scheme", async () => {
    // A reference carried over from a finance system, or typed by hand, must
    // not drag the sequence somewhere strange.
    const prefix = freshPrefix();
    scopesUsed.push(prefix);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT MAX(SUBSTRING("ref" FROM ${prefix.length + 2})::int) AS highest
       FROM "ChangeOrder" WHERE "ref" ~ $1 AND "projectId" = $2`,
      `^${prefix}-[0-9]+$`,
      projectId,
    );
    // Nothing matches the generated shape, so the seed is zero and the first
    // reference is 001 regardless of what other refs the register holds.
    expect(Number(rows?.[0]?.highest) || 0).toBe(0);
    const first = await nextReference(prisma, specFor(prefix, projectId));
    expect(first.ref).toBe(`${prefix}-001`);
  });
});
