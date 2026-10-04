/**
 * CERT-2 (bodies-4): what a stock figure and a movement's date can be.
 *
 *   - occurredAt / expiryDate "x", {"not":"x"} or [] became an invalid date
 *     that failed at the write with a 500. Only a string that is a date (or a
 *     Date) is one; nothing is null.
 *   - A unit cost of 1e15 overflowed the item's Decimal(18,4) price columns
 *     (500); a quantity of 1e15 was stored; a movement's value is a
 *     Decimal(18,2). Each is a 400.
 */
const {
  QUANTITY_MAX,
  UNIT_COST_MAX,
  VALUE_LIMIT,
  assertQuantityBound,
  assertUnitCostBound,
  assertValueBound,
  movementDate,
} = require("../stock-figures");

describe("a movement's date (CERT-2)", () => {
  test.each([["x"], [{ not: "x" }], [[]], [["2026-10-01"]], [12345], [true], ["0000-01-01T00:00:00Z"], ["not a date"]])("%j is refused (400 INV_DATE_INVALID)", (value) => {
    expect(() => movementDate(value, "occurredAt")).toThrow(expect.objectContaining({ status: 400, code: "INV_DATE_INVALID" }));
  });

  test("a date string, an instant and a Date are dates; nothing is null", () => {
    expect(movementDate("2026-10-01", "expiryDate").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(movementDate("2026-10-01T08:30:00.000Z", "occurredAt").toISOString()).toBe("2026-10-01T08:30:00.000Z");
    const at = new Date("2026-10-02T00:00:00.000Z");
    expect(movementDate(at, "occurredAt")).toBe(at);
    for (const nothing of [undefined, null, ""]) expect(movementDate(nothing, "occurredAt")).toBeNull();
  });
});

describe("what a stock figure can be (CERT-2)", () => {
  test("the bounds are what the columns hold", () => {
    // Decimal(18,4): fourteen whole digits; a double keeps four decimals exactly up to eleven.
    expect(String(UNIT_COST_MAX)).toHaveLength(14);
    expect(String(QUANTITY_MAX)).toHaveLength(11);
    expect(QUANTITY_MAX * 10_000).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(VALUE_LIMIT).toBe(1e16);
  });

  test("a quantity of 1e15 is refused, either sign; the bound itself is not", () => {
    for (const value of [1e15, -1e15, QUANTITY_MAX + 1]) {
      expect(() => assertQuantityBound(value)).toThrow(expect.objectContaining({ status: 400, code: "INV_QUANTITY" }));
    }
    expect(assertQuantityBound(QUANTITY_MAX)).toBe(QUANTITY_MAX);
    expect(assertQuantityBound(-QUANTITY_MAX)).toBe(-QUANTITY_MAX);
  });

  test("a unit cost of 1e15 (or 1e14) is refused; the bound itself is not", () => {
    for (const value of [1e15, 1e14]) {
      expect(() => assertUnitCostBound(value)).toThrow(expect.objectContaining({ status: 400, code: "INV_NUMBER" }));
    }
    expect(assertUnitCostBound(UNIT_COST_MAX)).toBe(UNIT_COST_MAX);
  });

  test("a movement worth 10^16 or more is refused; just under is not", () => {
    expect(() => assertValueBound(1000, UNIT_COST_MAX)).toThrow(expect.objectContaining({ status: 400, code: "INV_VALUE_TOO_LARGE" }));
    expect(() => assertValueBound(-1e3, 1e13)).toThrow(expect.objectContaining({ code: "INV_VALUE_TOO_LARGE" }));
    expect(() => assertValueBound(99, 1e14)).not.toThrow();
    expect(() => assertValueBound(1e15, 0)).not.toThrow();
  });
});
