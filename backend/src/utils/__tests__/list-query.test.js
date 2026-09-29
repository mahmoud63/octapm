const { cursorArgs, normalizeListQuery, toCursorPage } = require("../list-query");

/**
 * Paging across page boundaries returns every row exactly once. The rows
 * are paged the way Prisma pages them: the cursor row is included (the
 * cursor is inclusive) and skip steps over rows from there; take bounds the
 * page. listNotifications and every other cursor list read
 * take: limit + 1 and cursorArgs(cursor), then toCursorPage.
 */
const prismaPage = (all, { take, cursor, skip = 0 }) => {
  const start = cursor ? all.findIndex((row) => row.id === cursor.id) : 0;
  if (start < 0) return [];
  return all.slice(start + skip, start + skip + take);
};

const walk = (all, limit) => {
  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 1000; guard += 1) {
    const query = normalizeListQuery({ limit, cursor });
    const records = prismaPage(all, { take: query.limit + 1, ...cursorArgs(query.cursor) });
    const page = toCursorPage(records, query.limit);
    expect(page.rows.length).toBeLessThanOrEqual(query.limit);
    seen.push(...page.rows.map((row) => row.id));
    if (!page.pagination.nextCursor) return seen;
    expect(page.pagination.nextCursor).not.toBe(cursor);
    cursor = page.pagination.nextCursor;
  }
  throw new Error("pagination did not terminate");
};

describe("cursor pages", () => {
  const rows = (count) => Array.from({ length: count }, (_, index) => ({ id: `row-${String(index + 1).padStart(3, "0")}` }));

  it.each([1, 2, 3, 5, 7, 10, 11, 12])("return every row exactly once at page size %i", (limit) => {
    const all = rows(11);
    const seen = walk(all, limit);
    expect(seen).toEqual(all.map((row) => row.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("the next cursor is the last row returned, not the look-ahead row", () => {
    const page = toCursorPage(rows(6), 5);
    expect(page.rows.map((row) => row.id)).toEqual(["row-001", "row-002", "row-003", "row-004", "row-005"]);
    expect(page.pagination).toEqual({ limit: 5, nextCursor: "row-005" });
    // The last page has no next cursor.
    expect(toCursorPage(rows(3), 5).pagination).toEqual({ limit: 5, nextCursor: null });
    expect(toCursorPage(rows(5), 5).pagination).toEqual({ limit: 5, nextCursor: null });
  });

  it("the next page starts after the cursor row", () => {
    expect(cursorArgs("row-005")).toEqual({ cursor: { id: "row-005" }, skip: 1 });
    expect(cursorArgs(null)).toEqual({});
  });
});
