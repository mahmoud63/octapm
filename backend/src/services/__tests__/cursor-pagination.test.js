/**
 * Paging through a list must return every row exactly once.
 *
 * It did not. `nextCursor` was set to the look-ahead row — the extra one
 * fetched by `take: take + 1` to decide whether another page exists — and the
 * next page then asked for `cursor: { id: thatRow }, skip: 1`, which steps
 * *over* it. Prisma's cursor is inclusive, so the two conventions are
 * incompatible: either hand back the last row you returned and skip it, or
 * hand back the look-ahead row and do not. Mixing them loses exactly one row
 * per page boundary, and loses it silently — the row is returned by no page,
 * and every page still looks well-formed (OCTA-API-PAGING-110).
 *
 * On the seeded workspace that meant one project of twenty-three was
 * unreachable, and a dashboard reconciliation test that had passed for as long
 * as the count stayed inside a single page finally disagreed with the KPI. The
 * KPI was right.
 *
 * Two things this test learned the hard way about testing itself:
 *
 *   - It must page a list that is actually longer than a page. The first
 *     version took `organisation.findFirst()`, which returns a fixture org
 *     holding two projects, so every case fell through a `total <= pageSize`
 *     early return and passed while the bug was reintroduced.
 *   - So a fixture too small to exercise a page boundary is a **failure**, not
 *     a skip. A silent skip is how the original bug survived.
 */

jest.unmock("../../config/db");
jest.setTimeout(30_000);

const { prisma } = require("../../config/db");
const projectService = require("../project.service");
const userService = require("../user.service");

/**
 * Page sizes are derived from the fixture at run time. A fixed list breaks the
 * moment the workspace is cleaned up: archiving accumulated test projects took
 * the active list to four, and sizes of 5 and 20 then straddled no boundary at
 * all. What must never be silently skipped is the *check*, so a fixture with
 * nothing to page is still a failure.
 */
const pageSizesFor = (total) => [...new Set([1, 2, Math.floor(total / 2)])]
  .filter((size) => size >= 1 && size < total)
  .sort((a, b) => a - b);

/** Walks a paginated list to exhaustion and reports every id it saw. */
const walk = async (fetchPage, pageSize) => {
  const seen = [];
  let cursor = null;

  for (let guard = 0; guard < 500; guard += 1) {
    const page = await fetchPage({ limit: pageSize, cursor });
    const items = page.items ?? [];
    seen.push(...items.map((row) => row.id));
    const next = page.pagination?.nextCursor ?? null;
    if (!next || items.length === 0) return seen;
    // A cursor that does not advance would spin forever.
    expect(next).not.toBe(cursor);
    cursor = next;
  }

  throw new Error("pagination did not terminate");
};

/** The org with the most rows, because a two-row org proves nothing. */
const busiestOrg = async () => {
  const orgs = await prisma.organisation.findMany({
    select: { id: true, name: true, _count: { select: { projects: true } } },
  });
  return orgs.sort((a, b) => b._count.projects - a._count.projects)[0];
};

describe("cursor pagination returns every row exactly once", () => {

  // Release the pool. Jest runs these files in one process, and a real-database
  // suite that walks away from its connections leaves them idle for every suite
  // that follows — measured at 53 idle connections part-way through a full run,
  // which is how a report test that takes 1.8s alone began exceeding a five
  // second timeout (OCTA-QA-POOL-112).
  afterAll(async () => {
    await prisma.$disconnect();
  });
  let org;

  beforeAll(async () => {
    org = await busiestOrg();
  });

  it("has a workspace big enough to have page boundaries", () => {
    expect(org?.id).toBeTruthy();
    // Two rows is the minimum that can straddle a boundary at all.
    expect(org._count.projects).toBeGreaterThan(1);
  });

  describe("projects", () => {
    const listPage = ({ limit, cursor }) =>
      projectService.listProjects({
        orgId: org.id,
        userId: null,
        role: "pm",
        isCompanyAdmin: true,
        // Archived projects included on purpose: this is a test about paging,
        // not about archiving, and the active list is deliberately kept small.
        query: { limit, includeArchived: true, ...(cursor ? { cursor } : {}) },
      });

    it("loses nothing at any page size the fixture can exercise", async () => {
      // The truth comes from the database, not from a page. `limit` is capped
      // at 100, so using a single call as the baseline quietly under-counts an
      // org with more than that — and the walk then looks like it invented
      // rows.
      const total = await prisma.project.count({ where: { orgId: org.id } });
      const sizes = pageSizesFor(total);
      // If there is no boundary to cross, this test proves nothing — say so
      // rather than passing.
      expect(sizes.length).toBeGreaterThan(0);

      for (const pageSize of sizes) {
        const walked = await walk(listPage, pageSize);
        const unique = new Set(walked);

        expect(walked.length).toBe(unique.size); // no row returned twice
        expect(unique.size).toBe(total); // every row reached, none skipped
      }
    });
  });

  describe("users", () => {
    const listPage = ({ limit, cursor }) =>
      userService.listUsers({
        orgId: org.id,
        query: { limit, ...(cursor ? { cursor } : {}) },
      });

    it("loses nothing across page boundaries", async () => {
      const everything = await listPage({ limit: 100, cursor: null });
      const expected = new Set(everything.items.map((row) => row.id));
      const pageSize = 2;
      expect(expected.size).toBeGreaterThan(pageSize);

      const walked = await walk(listPage, pageSize);
      const unique = new Set(walked);

      expect(walked.length).toBe(unique.size);
      expect([...expected].filter((id) => !unique.has(id))).toEqual([]);
      expect(unique.size).toBe(expected.size);
    });
  });
});
