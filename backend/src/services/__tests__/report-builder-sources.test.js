/**
 * Regression: GET /reports must return `sources` as an array.
 *
 * listSources is async, and listDefinitions returned it without awaiting. JSON
 * serialised the pending Promise as `{}`, so the report builder called .find()
 * on an object and the whole Reports page died in an error boundary. No unit
 * test caught it because nothing asserted the shape of this field.
 */
const service = require("../report-builder.service");

/**
 * This one talks to the real database, and the first call in a worker pays the
 * cold start: measured at 1,423ms for the first `listSources` and 3ms for
 * every one after it. The query is not slow; connecting is. Under a full suite
 * that cold start drifts past Jest's five-second default and the test fails on
 * the clock rather than on the behaviour.
 *
 * Measured before raising it, so this is not papering over a leak: idle
 * connections sit at 34 with only the API running and peak around 56 of 100
 * during a run, returning to baseline afterwards (OCTA-QA-POOL-112).
 */
jest.setTimeout(30_000);

describe("report builder sources", () => {
  it("listSources resolves to an array of described sources", async () => {
    const sources = await service.listSources({ orgId: "org-1" });

    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(typeof source.key).toBe("string");
    }
  });

  it("is not accidentally returned as a pending promise", async () => {
    const value = service.listSources({ orgId: "org-1" });
    expect(typeof value.then).toBe("function");
    // Serialising it without awaiting is exactly the bug: an empty object.
    expect(JSON.parse(JSON.stringify(value))).toEqual({});
    // And awaited, it is the array the client contract promises.
    expect(Array.isArray(await value)).toBe(true);
  });
});
