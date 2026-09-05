const logger = console;

/**
 * Hourly poll of accounting systems for bill payment status
 * (OCTA-INT-API-026). One `accounting.poll` job per organisation with a
 * connected provider. Disable with ACCOUNTING_SCHEDULER_ENABLED=false.
 */
const INTERVAL_MS = Number(process.env.ACCOUNTING_POLL_INTERVAL_MS || 60 * 60_000);

let timer = null;

const runPollTick = async () => {
  try {
    const result = await require("../services/accounting.service").queuePollJobs();
    if (result.queued) logger.log(`[accounting-scheduler] queued ${result.queued} payment poll${result.queued === 1 ? "" : "s"}`);
    return result;
  } catch (error) {
    logger.error("[accounting-scheduler] tick failed", error?.message || error);
    return { queued: 0, error: error?.message || String(error) };
  }
};

const startAccountingScheduler = () => {
  if (timer || process.env.ACCOUNTING_SCHEDULER_ENABLED === "false" || process.env.NODE_ENV === "test") return null;
  timer = setInterval(runPollTick, INTERVAL_MS);
  timer.unref?.();
  setTimeout(runPollTick, 90_000).unref?.();
  return timer;
};

const stopAccountingScheduler = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { startAccountingScheduler, stopAccountingScheduler, runPollTick };
