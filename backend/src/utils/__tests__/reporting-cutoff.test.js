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
  reportingDateOfStoredCutoff,
  reportingTimeZoneNote,
  resolveReportingCutoff,
  resolveReportingTimeZone,
  storedValueForReportingDate,
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
      timeZoneNote: null,
    });
    // An instant ("now") names the date it falls on in the zone.
    const now = new Date("2026-11-02T05:30:00.000Z");
    expect(resolveReportingCutoff({ value: now, timeZone: "America/Chicago", timeZoneSource: "project" }).localDate).toBe("2026-11-01");
    expect(() => resolveReportingCutoff({ value: "2026-02-30", timeZone: "UTC" })).toThrow(RangeError);
    expect(() => resolveReportingCutoff({ value: "not a date", timeZone: "UTC" })).toThrow(RangeError);
  });

  it("ends a date by that date's own offset: a CDT date and a CST date in the same zone end at different UTC hours", () => {
    // Not one fixed shift: 31 July (CDT, -05:00) and 31 January (CST, -06:00).
    expect(iso(endOfLocalDay("2026-07-31", "America/Chicago"))).toBe("2026-08-01T04:59:59.999Z");
    expect(iso(endOfLocalDay("2026-01-31", "America/Chicago"))).toBe("2026-02-01T05:59:59.999Z");
    expect(iso(endOfLocalDay("2026-07-31", "Pacific/Auckland"))).toBe("2026-07-31T11:59:59.999Z"); // NZST +12
    expect(iso(endOfLocalDay("2026-01-31", "Pacific/Auckland"))).toBe("2026-01-31T10:59:59.999Z"); // NZDT +13
  });

  it("says when the project had no zone of its own, naming the organisation default it used", () => {
    expect(reportingTimeZoneNote({ timeZone: "America/Chicago", timeZoneSource: "project" })).toBeNull();
    expect(reportingTimeZoneNote({ timeZone: "America/Chicago", timeZoneSource: "organisation" })).toBe(
      "Project timezone is not configured; the organisation default America/Chicago is being used",
    );
    expect(reportingTimeZoneNote({ timeZone: "UTC", timeZoneSource: "utc" })).toBe(
      "Project timezone is not configured; UTC is being used",
    );
    expect(resolveReportingCutoff({ value: "2026-11-01", timeZone: "UTC", timeZoneSource: "utc" }).timeZoneNote).toBe(
      "Project timezone is not configured; UTC is being used",
    );
    // An unknown project zone name falls to UTC and says so.
    expect(resolveReportingCutoff({ value: "2026-11-01", timeZone: "Mars/Olympus", timeZoneSource: "project" })).toMatchObject({
      timeZone: "UTC",
      timeZoneSource: "utc",
      timeZoneNote: "Project timezone is not configured; UTC is being used",
    });
  });

  it("reads a stored period's reporting date as the UTC calendar date of the stored value — legacy rows and new rows alike", () => {
    // Legacy rows: the base code stored the typed date's 23:59:59.999 in
    // the server's zone (America/Chicago) — 04:59:59.999Z in CDT and
    // 05:59:59.999Z in CST, both ON the typed date.
    expect(reportingDateOfStoredCutoff(new Date("2026-08-31T04:59:59.999Z"))).toBe("2026-08-31");
    expect(reportingDateOfStoredCutoff(new Date("2026-01-31T05:59:59.999Z"))).toBe("2026-01-31");
    // New rows: the date's last millisecond in UTC.
    expect(iso(storedValueForReportingDate("2026-08-31"))).toBe("2026-08-31T23:59:59.999Z");
    expect(reportingDateOfStoredCutoff(storedValueForReportingDate("2026-08-31"))).toBe("2026-08-31");
    expect(reportingDateOfStoredCutoff(storedValueForReportingDate("2026-12-31"))).toBe("2026-12-31");
    expect(() => storedValueForReportingDate("2026-02-30")).toThrow(RangeError);
    expect(() => reportingDateOfStoredCutoff(null)).toThrow(RangeError);
  });
});
