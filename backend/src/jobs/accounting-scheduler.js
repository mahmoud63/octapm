const { isSwitchOn, offMessage } = require("../config/switches");
const logger = console;

/**
 * Hourly poll of accounting systems for bill payment status
 * (OCTA-INT-API-026). One `accounting.poll` job per organisation with a
 * connected provider. Runs only with ACCOUNTING_SCHEDULER_ENABLED=true (default off).
 */
const INTERVAL_MS = Number(process.env.ACCOUNTING_POLL_INTERVAL_MS || 60 * 60_000);

let timer = null;
let kickoff = null;

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
  if (timer || process.env.NODE_ENV === "test") return null;
  if (!isSwitchOn("ACCOUNTING_SCHEDULER_ENABLED")) {
    logger.log(offMessage("accounting-scheduler", "ACCOUNTING_SCHEDULER_ENABLED"));
    return null;
  }
  timer = setInterval(runPollTick, INTERVAL_MS);
  timer.unref?.();
  // The first poll waits 90 s; its handle is kept so a stop before then cancels it too.
  kickoff = setTimeout(runPollTick, 90_000);
  kickoff.unref?.();
  return timer;
};

const stopAccountingScheduler = () => {
  if (timer) clearInterval(timer);
  if (kickoff) clearTimeout(kickoff);
  timer = null;
  kickoff = null;
};

module.exports = { startAccountingScheduler, stopAccountingScheduler, runPollTick };
