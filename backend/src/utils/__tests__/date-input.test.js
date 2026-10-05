const { body, query, validationResult } = require("express-validator");
const { dateInput, dateOnlyInput, isDateInput, isDateOnlyInput } = require("../date-input");

/**
 * CERT-2: isISO8601() let through the compact, week and ordinal forms that
 * JavaScript's Date cannot read ("20261001", "2026-W40", "2026-275") — a
 * service's new Date(value) was an Invalid Date and the write answered 500 —
 * and checked an array element by element. dateInput accepts one string in
 * the shapes the clients send, that Date reads as a valid instant.
 */
describe("date input (CERT-2)", () => {
  const ACCEPTED = [
    "2026-10-01",
    "2026-10-01T10:00:00.000Z", // toISOString()
    "2026-10-01T10:00:00Z",
    "2026-10-01T10:00", // datetime-local
    "2026-10-01T10:00:00",
    "2026-10-01T10:00:00.123456789Z",
    "2026-10-01T10:00:00+02:00",
    "2026-10-01T10:00:00-0530",
    "2026-10-01 10:00:00",
    "2026-10",
    "2026",
    "2024-02-29",
    "0001-01-01",
    "9999-12-31T23:59:59Z",
  ];
  const REFUSED = [
    "20261001", // compact
    "2026-W40", // week date
    "2026-W40-3",
    "2026-275", // ordinal
    "20261001T101010Z",
    "2026-10-01T10Z", // an hour alone
    "2026-10-01T10:00:00+02", // an hour-only offset Date cannot read
    "2026-10-01T10,5",
    "2026-02-30", // not a calendar date
    "2025-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-10-32",
    "2026-10-01T24:00:00Z",
    "2026-10-01T10:60:00Z",
    "2026-10-01T10:00:60Z",
    "0000-01-01", // the database holds no year 0
    "+002026-10-01",
    "-002026-10-01",
    "99999-10-01",
    "notadate",
    "",
    " 2026-10-01",
    "2026-10-01 ",
    "2026-10-01t10:00:00z",
  ];
  const NOT_STRINGS = [[], ["2026-10-01"], ["2026-10-01", "2026-10-02"], { not: "x" }, 20261001, 1.7e12, true, null, undefined];

  it.each(ACCEPTED)("accepts %j, which Date reads as a valid instant", (value) => {
    expect(isDateInput(value)).toBe(true);
    expect(Number.isNaN(new Date(value).getTime())).toBe(false);
    expect(dateInput(value)).toBe(true);
  });

  it.each(REFUSED)("refuses %j", (value) => {
    expect(isDateInput(value)).toBe(false);
    expect(() => dateInput(value)).toThrow("must be a date");
  });

  it.each(NOT_STRINGS.map((v) => [JSON.stringify(v) ?? "undefined", v]))("refuses a value that is not one string: %s", (_label, value) => {
    expect(isDateInput(value)).toBe(false);
    expect(() => dateInput(value)).toThrow();
  });

  /**
   * The year that counts is the instant's (UTC), not the written one: an
   * offset moves "9999-12-31T23:59:59-14:00" to 10000-01-01T13:59:59Z, which
   * the query engine cannot convert ("Could not convert argument value …
   * +010000-…", a 500 at the write and in a filter), and
   * "0001-01-01T00:00:00+14:00" to 0000-12-31T10:00:00Z, stored as a date
   * before the common era. Both edges, either side.
   */
  describe("the instant's year is 1..9999 (CERT-2)", () => {
    const INSIDE = [
      ["9999-12-31T23:59:59Z", 9999], // the last second, in UTC
      ["9999-12-31T23:59:59.999Z", 9999],
      ["9999-12-31T23:59:59+14:00", 9999], // 09:59:59Z on the last day
      ["9999-12-31T09:59:59-14:00", 9999], // 23:59:59Z exactly
      ["9999-12-31", 9999],
      ["0001-01-01T00:00:00Z", 1], // the first second, in UTC
      ["0001-01-01T00:00:00-14:00", 1], // 14:00Z on the first day
      ["0001-01-01T14:00:00+14:00", 1], // 00:00:00Z exactly
      ["0001-01-01", 1],
    ];
    const OUTSIDE = [
      ["9999-12-31T23:59:59-14:00", 10000],
      ["9999-12-31T23:00-0100", 10000],
      ["9999-12-31T23:59:59.999-00:01", 10000],
      ["9999-12-31 23:30:00-01:00", 10000],
      ["0001-01-01T00:00:00+14:00", 0],
      ["0001-01-01T00:00:00.000+00:01", 0],
      ["0001-01-01T13:59:59+14:00", 0], // one second before 0001-01-01T00:00:00Z
    ];

    it.each(INSIDE)("accepts %j, whose instant is in year %i", (value, year) => {
      expect(new Date(value).getUTCFullYear()).toBe(year);
      expect(isDateInput(value)).toBe(true);
      expect(dateInput(value)).toBe(true);
    });

    it.each(OUTSIDE)("refuses %j, whose instant is in year %i though the written year is in range", (value, year) => {
      expect(new Date(value).getUTCFullYear()).toBe(year);
      expect(isDateInput(value)).toBe(false);
      expect(() => dateInput(value)).toThrow("must be a date");
    });

    it("a date-time without a zone is judged the way the services read it, as local time", () => {
      for (const value of ["9999-12-31T23:59", "9999-12-31T00:00", "0001-01-01T00:00", "0001-01-01T23:59:59"]) {
        const year = new Date(value).getUTCFullYear();
        expect(isDateInput(value)).toBe(year >= 1 && year <= 9999);
      }
    });
  });

  it("dateOnlyInput takes a calendar day and nothing more", () => {
    expect(isDateOnlyInput("2026-10-01")).toBe(true);
    for (const value of ["2026-10-01T10:00:00Z", "2026-10", "2026-02-30", "20261001", ["2026-10-01"], "2026-13-45"]) {
      expect(isDateOnlyInput(value)).toBe(false);
      expect(() => dateOnlyInput(value)).toThrow("must be a date (YYYY-MM-DD)");
    }
  });

  describe("in an express-validator chain", () => {
    const run = async (chain, location, value) => {
      const req = { [location]: value === undefined ? {} : { at: value } };
      await chain.run(req);
      return validationResult(req).array();
    };

    it("a body chain refuses the forms isISO8601 let through, and arrays, naming the field", async () => {
      const chain = () => body("at").optional({ nullable: true }).custom(dateInput);
      for (const value of ["20261001", "2026-W40", "2026-275", [], ["2026-10-01"], { not: "x" }]) {
        const errors = await run(chain(), "body", value);
        expect(errors.map((e) => e.path)).toEqual(["at"]);
        expect(errors[0].msg).toBe("must be a date (YYYY-MM-DD or an ISO 8601 date-time)");
      }
      expect(await run(chain(), "body", "2026-10-01")).toEqual([]);
      expect(await run(chain(), "body", null)).toEqual([]);
      expect(await run(chain(), "body", undefined)).toEqual([]);
    });

    it("a query chain with falsy-optional skips an empty value and refuses a bad one", async () => {
      const chain = () => query("at").isString().optional({ values: "falsy" }).custom(dateInput);
      expect(await run(chain(), "query", "")).toEqual([]);
      expect(await run(chain(), "query", "2026-10-01T00:00:00Z")).toEqual([]);
      expect((await run(chain(), "query", "notadate")).length).toBeGreaterThan(0);
      expect((await run(chain(), "query", ["2026-10-01", "2026-10-02"])).length).toBeGreaterThan(0);
    });
  });
});
