const mockCreateMany = { productEvent: jest.fn(), platformErrorEvent: jest.fn() };
jest.mock("../../../config/db", () => ({
  prisma: {
    productEvent: { createMany: (...a) => mockCreateMany.productEvent(...a) },
    platformErrorEvent: { createMany: (...a) => mockCreateMany.platformErrorEvent(...a) },
  },
}));

const telemetry = require("../telemetry.service");

const ORG = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EVENT = { eventName: "rfi.created", module: "rfi", action: "created" };

describe("telemetry service", () => {
  const saved = process.env.PLATFORM_TELEMETRY_ENABLED;
  let stderr;
  beforeEach(() => {
    process.env.PLATFORM_TELEMETRY_ENABLED = "true";
    telemetry.resetForTests();
    mockCreateMany.productEvent.mockReset().mockResolvedValue({ count: 0 });
    mockCreateMany.platformErrorEvent.mockReset().mockResolvedValue({ count: 0 });
    stderr = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stderr.mockRestore();
    telemetry.resetForTests();
  });
  afterAll(() => {
    process.env.PLATFORM_TELEMETRY_ENABLED = saved;
  });

  test("is off under jest unless enabled, and off anywhere when disabled", () => {
    expect(telemetry.isEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(telemetry.isEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(telemetry.isEnabled({ NODE_ENV: "production", PLATFORM_TELEMETRY_ENABLED: "false" })).toBe(false);
  });

  test("queues only rows with a tenant and a catalogue event, and keeps ids only", async () => {
    expect(telemetry.trackProductEvent({ orgId: null, event: EVENT })).toBe(false);
    expect(telemetry.trackProductEvent({ orgId: "not-a-uuid", event: EVENT })).toBe(false);
    expect(telemetry.trackProductEvent({ orgId: ORG, event: EVENT, projectId: "free text", platform: "toaster" })).toBe(true);
    expect(telemetry.trackClientEvent({ orgId: ORG, name: "salary.opened" })).toBe(false);
    expect(telemetry.trackClientEvent({ orgId: ORG, name: "boq.opened" })).toBe(true);
    await telemetry.drain();
    const rows = mockCreateMany.productEvent.mock.calls.flatMap(([arg]) => arg.data);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ orgId: ORG, projectId: null, platform: "web", source: "server", eventName: "rfi.created" });
    expect(rows[1]).toMatchObject({ eventName: "boq.opened", source: "client", action: "opened" });
  });

  test("error rows keep a code only when it looks like a code", async () => {
    telemetry.recordErrorEvent({ status: 500, code: "Error: connect ECONNREFUSED 10.0.0.1:5432", method: "get", routePattern: "/x" });
    telemetry.recordErrorEvent({ status: 404, code: "NOT_FOUND", method: "GET", routePattern: "/y" });
    expect(telemetry.recordErrorEvent({ status: 200, code: "OK" })).toBe(false);
    await telemetry.drain();
    const rows = mockCreateMany.platformErrorEvent.mock.calls.flatMap(([arg]) => arg.data);
    expect(rows.map((r) => r.code)).toEqual(["INTERNAL_ERROR", "NOT_FOUND"]);
    expect(rows[0].method).toBe("GET");
  });

  test("is bounded: beyond the buffer limit rows are dropped and counted", () => {
    for (let i = 0; i < telemetry.MAX_BUFFER + 5; i += 1) telemetry.trackProductEvent({ orgId: ORG, event: EVENT });
    expect(telemetry.stats().buffered.product).toBe(telemetry.MAX_BUFFER);
    expect(telemetry.stats().dropped).toBe(5);
  });

  test("a failed write is counted and logged, never thrown, and not retried", async () => {
    mockCreateMany.productEvent.mockRejectedValue(Object.assign(new Error("db down"), { code: "P1001" }));
    telemetry.trackProductEvent({ orgId: ORG, event: EVENT });
    await expect(telemetry.drain()).resolves.toBeUndefined();
    expect(telemetry.stats()).toMatchObject({ failedFlushes: 1, dropped: 1, lastFailureCode: "P1001" });
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("platform_telemetry_flush_failed"));
    expect(telemetry.stats().buffered.product).toBe(0);
  });
});
