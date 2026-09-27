/**
 * The EV reporting cutoff (owner decision D1): the end of the cutoff's
 * calendar date in the project's time zone, else the organisation's, else
 * UTC — computed without the server's own zone, correct across daylight
 * saving. Pure arithmetic over the platform's Intl data; the live suite
 * (pc-4-ev-cutoff.live.test.js) proves PV, EV and AC are selected with it.
 */
const {
  endOfLocalDay,
  localDateOf,
  resolveReportingCutoff,
  resolveReportingTimeZone,
} = require("../reporting-cutoff");

const iso = (date) => date.toISOString();

describe("reporting cutoff", () => {
  it("ends a date at local midnight, whatever the zone's offset", () => {
    expect(iso(endOfLocalDay("2026-03-10", "UTC"))).toBe("2026-03-10T23:59:59.999Z");
    expect(iso(endOfLocalDay("2026-03-10", "Asia/Tokyo"))).toBe("2026-03-10T14:59:59.999Z");
    expect(iso(endOfLocalDay("2026-07-15", "America/Chicago"))).toBe("2026-07-16T04:59:59.999Z");
    expect(iso(endOfLocalDay("2026-01-15", "America/Chicago"))).toBe("2026-01-16T05:59:59.999Z");
    expect(iso(endOfLocalDay("2026-07-15", "Asia/Kolkata"))).toBe("2026-07-15T18:29:59.999Z");
  });

  it("is correct on the days daylight saving begins and ends (America/Chicago)", () => {
    // 8 March 2026: clocks go 02:00 CST -> 03:00 CDT; the day ends in CDT.
    expect(iso(endOfLocalDay("2026-03-07", "America/Chicago"))).toBe("2026-03-08T05:59:59.999Z");
    expect(iso(endOfLocalDay("2026-03-08", "America/Chicago"))).toBe("2026-03-09T04:59:59.999Z");
    // 1 November 2026: clocks go 02:00 CDT -> 01:00 CST; the 25-hour day ends in CST.
    expect(iso(endOfLocalDay("2026-10-31", "America/Chicago"))).toBe("2026-11-01T04:59:59.999Z");
    expect(iso(endOfLocalDay("2026-11-01", "America/Chicago"))).toBe("2026-11-02T05:59:59.999Z");
  });

  it("finds the day's end where local midnight itself is skipped or repeated (America/Santiago)", () => {
    // 6 September 2026 starts at 01:00 (-03): 5 September ends at 04:00Z - 1 ms.
    expect(iso(endOfLocalDay("2026-09-05", "America/Santiago"))).toBe("2026-09-06T03:59:59.999Z");
    // 5 April 2026 00:00 (-03) falls back to 23:00 (-04) on the 4th: the 4th ends at the second 23:59:59.999.
    expect(iso(endOfLocalDay("2026-04-04", "America/Santiago"))).toBe("2026-04-05T03:59:59.999Z");
  });

  it("reads an instant's date in the zone", () => {
    expect(localDateOf(new Date("2026-11-02T05:30:00.000Z"), "America/Chicago")).toBe("2026-11-01");
    expect(localDateOf(new Date("2026-11-02T06:00:30.000Z"), "America/Chicago")).toBe("2026-11-02");
    expect(localDateOf(new Date("2026-03-10T15:00:00.000Z"), "Asia/Tokyo")).toBe("2026-03-11");
  });

  it("chooses the project's zone, then the organisation's, then UTC — passing over a name nobody knows", () => {
    expect(resolveReportingTimeZone({ project: { timezone: "America/Chicago" }, organisation: { defaultTimezone: "Asia/Tokyo" } })).toEqual({
      timeZone: "America/Chicago",
      source: "project",
    });
    expect(resolveReportingTimeZone({ project: { timezone: null }, organisation: { defaultTimezone: "Asia/Tokyo" } })).toEqual({
      timeZone: "Asia/Tokyo",
      source: "organisation",
    });
    expect(resolveReportingTimeZone({ project: { timezone: "Mars/Olympus" }, organisation: { defaultTimezone: "Asia/Tokyo" } })).toEqual({
      timeZone: "Asia/Tokyo",
      source: "organisation",
    });
    expect(resolveReportingTimeZone({ project: {}, organisation: null })).toEqual({ timeZone: "UTC", source: "utc" });
  });

  it("takes a calendar date as that date, and an instant as the date it falls on in the zone", () => {
    expect(resolveReportingCutoff({ value: "2026-11-01", timeZone: "America/Chicago", timeZoneSource: "project" })).toEqual({
      cutoffDate: new Date("2026-11-02T05:59:59.999Z"),
      localDate: "2026-11-01",
      timeZone: "America/Chicago",
      timeZoneSource: "project",
    });
    // A stored cutoff reads back as itself.
    const stored = new Date("2026-11-02T05:59:59.999Z");
    expect(resolveReportingCutoff({ value: stored, timeZone: "America/Chicago", timeZoneSource: "project" }).cutoffDate).toEqual(stored);
    expect(() => resolveReportingCutoff({ value: "2026-02-30", timeZone: "UTC" })).toThrow(RangeError);
    expect(() => resolveReportingCutoff({ value: "not a date", timeZone: "UTC" })).toThrow(RangeError);
  });
});
