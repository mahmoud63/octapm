/**
 * PC-7b — the engine → notice bridge is registered by the entry points
 * (src/index.js, src/worker.js) wherever an evaluation job may run, once per
 * process, and stands down with EXCEPTIONS_ENGINE_ENABLED=false. Its effect
 * (one notice per PM / QS per opening) is proven live in
 * __live__/pc-7b-exceptions-api.live.test.js.
 */
const fs = require("fs");
const path = require("path");
const exceptionService = require("../exception.service");

const fakeEngine = () => {
  const listeners = [];
  return {
    listeners,
    registerEvaluationListener: (listener) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  };
};
const quiet = { log: () => {} };

describe("registerExceptionNotifier", () => {
  it("registers exactly one listener per process and unregisters it", () => {
    const engine = fakeEngine();
    const off = exceptionService.registerExceptionNotifier({ env: {}, engine, logger: quiet });
    expect(exceptionService.registerExceptionNotifier({ env: {}, engine, logger: quiet })).toBe(off);
    expect(engine.listeners).toEqual([exceptionService._evaluationListener]);
    off();
    expect(engine.listeners).toEqual([]);
  });

  it("stands down with EXCEPTIONS_ENGINE_ENABLED=false", () => {
    const engine = fakeEngine();
    const log = jest.fn();
    exceptionService.registerExceptionNotifier({ env: { EXCEPTIONS_ENGINE_ENABLED: " FALSE " }, engine, logger: { log } });
    expect(engine.listeners).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("disabled"));
  });

  it("a listener call without an opened or escalated row reads nothing", async () => {
    await expect(exceptionService._evaluationListener({ orgId: "o", projectId: "p", opened: [], escalated: [] })).resolves.toEqual({ notified: 0, exceptions: 0 });
  });

  it("both entry points register it", () => {
    for (const entry of ["index.js", "worker.js"]) {
      const source = fs.readFileSync(path.join(__dirname, "..", "..", entry), "utf8");
      expect([entry, /\nregisterExceptionNotifier\(\);/.test(source.replace(/\r\n/g, "\n"))]).toEqual([entry, true]);
    }
  });
});
