/**
 * Graceful shutdown for the API and worker processes.
 *
 * ECS sends SIGTERM, waits stopTimeout, then SIGKILLs. The drain has to fit
 * inside that window, so it is bounded by SHUTDOWN_TIMEOUT_MS: whatever has
 * not finished by then is abandoned and the process exits 1 (a job still
 * running keeps its claim and is re-queued by stale-job recovery). A second
 * signal while draining changes nothing — ECS and Ctrl-C both like to repeat
 * themselves.
 */

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

const readPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const shutdownTimeoutMs = (env = process.env) =>
  readPositiveInt(env.SHUTDOWN_TIMEOUT_MS, DEFAULT_SHUTDOWN_TIMEOUT_MS);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `drain({ deadline, signal })` does the work and resolves when the process
 * may exit 0. Returns the handler (for tests) after registering it for
 * SIGTERM and SIGINT.
 */
const installGracefulShutdown = ({
  label,
  drain,
  timeoutMs = shutdownTimeoutMs(),
  logger = console,
  exit = (code) => process.exit(code),
  signals = ["SIGTERM", "SIGINT"],
}) => {
  let shutting = null;

  const shutdown = (signal) => {
    if (shutting) {
      logger.log(`[${label}] ${signal} received again; already shutting down`);
      return shutting;
    }
    const deadline = Date.now() + timeoutMs;
    logger.log(`[${label}] ${signal} received; draining (up to ${timeoutMs} ms)`);

    // The hard stop. It stays referenced on purpose: it is what guarantees the
    // process ends even when something in the drain never settles.
    const hardStop = setTimeout(() => {
      logger.error(`[${label}] shutdown did not finish within ${timeoutMs} ms; exiting 1`);
      exit(1);
    }, timeoutMs);

    shutting = (async () => {
      try {
        await drain({ deadline, signal });
        clearTimeout(hardStop);
        logger.log(`[${label}] shutdown complete`);
        exit(0);
      } catch (error) {
        clearTimeout(hardStop);
        logger.error(`[${label}] shutdown failed`, error?.message || error);
        exit(1);
      }
    })();
    return shutting;
  };

  for (const signal of signals) process.on(signal, () => shutdown(signal));
  return shutdown;
};

/**
 * Domain events are delivered after a short delay (events/bus.js) so clients
 * never refetch before a transaction commits. Waiting it out before the
 * database goes lets the last events reach their subscribers.
 */
const waitForEventBus = () => {
  const raw = Number.parseInt(process.env.REALTIME_EMIT_DELAY_MS || "", 10);
  const delay = Number.isFinite(raw) && raw >= 0 ? raw : 150;
  return sleep(delay + 50);
};

module.exports = {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  installGracefulShutdown,
  shutdownTimeoutMs,
  sleep,
  waitForEventBus,
};
