/**
 * Regression: GET /reports must return `sources` as an array.
 *
 * listSources is async, and listDefinitions returned it without awaiting. JSON
 * serialised the pending Promise as `{}`, so the report builder called .find()
 * on an object and the whole Reports page died in an error boundary. No unit
 * test caught it because nothing asserted the shape of this field.
 */
const service = require("../report-builder.service");

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
