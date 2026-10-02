const { prisma } = require("../config/db");
const { isSwitchOn, offMessage } = require("../config/switches");

/**
 * Daily log automation (OCTA-FLD-DAILY-022).
 *
 * Every half hour each organisation with projects on the weather feed gets one
 * `daily_log.weather` job (skipped while one is still queued or running);
 * every ten minutes projects whose local send time has passed get a
 * `daily_log.distribute` job for today's log. Both run through the durable
 * job queue so failures are visible and retried like any other background work.
 */

const WEATHER_INTERVAL_MS = 30 * 60 * 1000;
const DISTRIBUTION_INTERVAL_MS = 10 * 60 * 1000;

const jobService = () => require("./job.service");
const dailyLogService = () => require("../services/daily-log.service");

async function runWeatherTick(now = new Date()) {
  const { JOB_TYPES, JOB_STATUSES, enqueueJob } = jobService();
  if (!require("../services/weather-feed.service").isEnabled()) return { disabled: true, queued: 0 };
  const projects = await prisma.project.findMany({
    where: { status: "active", latitude: { not: null }, longitude: { not: null } },
    select: { orgId: true },
    distinct: ["orgId"],
  });
  let queued = 0;
  for (const { orgId } of projects) {
    const pending = await prisma.backgroundJob.findFirst({
      where: { orgId, type: JOB_TYPES.DAILY_LOG_WEATHER, status: { in: [JOB_STATUSES.QUEUED, JOB_STATUSES.RUNNING] } },
      select: { id: true },
    });
    if (pending) continue;
    await enqueueJob({ orgId, type: JOB_TYPES.DAILY_LOG_WEATHER, payload: { trigger: "scheduler", at: now.toISOString() }, maxAttempts: 2 });
    queued += 1;
  }
  return { orgs: projects.length, queued };
}

async function runDistributionTick(now = new Date()) {
  const { JOB_TYPES, enqueueJob } = jobService();
  return dailyLogService().queueScheduledDistributions({
    now,
    enqueue: ({ orgId, projectId, payload }) => enqueueJob({ orgId, projectId, type: JOB_TYPES.DAILY_LOG_DISTRIBUTE, payload, maxAttempts: 2 }),
  });
}

let timers = null;

function startDailyLogScheduler() {
  if (timers) return timers;
  if (!isSwitchOn("DAILY_LOG_SCHEDULER_ENABLED")) {
    console.log(offMessage("daily-log-scheduler", "DAILY_LOG_SCHEDULER_ENABLED"));
    return null;
  }
  const safe = (label, fn) => () => fn().catch((error) => console.error(`[daily-log-scheduler] ${label}`, error));
  safe("weather", runWeatherTick)();
  safe("distribution", runDistributionTick)();
  const weatherTimer = setInterval(safe("weather", runWeatherTick), WEATHER_INTERVAL_MS);
  const distributionTimer = setInterval(safe("distribution", runDistributionTick), DISTRIBUTION_INTERVAL_MS);
  weatherTimer.unref?.();
  distributionTimer.unref?.();
  timers = { weatherTimer, distributionTimer };
  return timers;
}

function stopDailyLogScheduler() {
  if (!timers) return;
  clearInterval(timers.weatherTimer);
  clearInterval(timers.distributionTimer);
  timers = null;
}

module.exports = { runDistributionTick, runWeatherTick, startDailyLogScheduler, stopDailyLogScheduler };
