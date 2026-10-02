const { prisma } = require("../config/db");
const { isSwitchOn, offMessage } = require("../config/switches");

/**
 * Report automation (OCTA-RPT-BUILDER-023).
 *
 * Every five minutes, schedules whose time has come get a `report.render` job
 * (one run each, evaluated as the schedule's owner); every hour each
 * organisation with projects gets a `portfolio.refresh` job unless one is
 * already queued or running.
 */

const SCHEDULE_INTERVAL_MS = 5 * 60 * 1000;
const PORTFOLIO_INTERVAL_MS = 60 * 60 * 1000;

const jobService = () => require("./job.service");

async function runScheduleTick(now = new Date()) {
  const { JOB_TYPES, enqueueJob } = jobService();
  return require("../services/report-builder.service").queueDueSchedules({
    now,
    enqueue: ({ orgId, projectId, payload }) => enqueueJob({ orgId, projectId, type: JOB_TYPES.REPORT_RENDER, payload, maxAttempts: 2 }),
  });
}

async function runPortfolioTick(now = new Date()) {
  const { JOB_TYPES, JOB_STATUSES, enqueueJob } = jobService();
  const orgs = await prisma.project.findMany({ where: { status: "active", archivedAt: null }, select: { orgId: true }, distinct: ["orgId"] });
  let queued = 0;
  for (const { orgId } of orgs) {
    const pending = await prisma.backgroundJob.findFirst({ where: { orgId, type: JOB_TYPES.PORTFOLIO_REFRESH, status: { in: [JOB_STATUSES.QUEUED, JOB_STATUSES.RUNNING] } }, select: { id: true } });
    if (pending) continue;
    await enqueueJob({ orgId, type: JOB_TYPES.PORTFOLIO_REFRESH, payload: { trigger: "scheduler", at: now.toISOString() }, maxAttempts: 2 });
    queued += 1;
  }
  return { orgs: orgs.length, queued };
}

let timers = null;

function startReportScheduler() {
  if (timers) return timers;
  if (!isSwitchOn("REPORT_SCHEDULER_ENABLED")) {
    console.log(offMessage("report-scheduler", "REPORT_SCHEDULER_ENABLED"));
    return null;
  }
  const safe = (label, fn) => () => fn().catch((error) => console.error(`[report-scheduler] ${label}`, error));
  safe("schedules", runScheduleTick)();
  safe("portfolio", runPortfolioTick)();
  const scheduleTimer = setInterval(safe("schedules", runScheduleTick), SCHEDULE_INTERVAL_MS);
  const portfolioTimer = setInterval(safe("portfolio", runPortfolioTick), PORTFOLIO_INTERVAL_MS);
  scheduleTimer.unref?.();
  portfolioTimer.unref?.();
  timers = { scheduleTimer, portfolioTimer };
  return timers;
}

function stopReportScheduler() {
  if (!timers) return;
  clearInterval(timers.scheduleTimer);
  clearInterval(timers.portfolioTimer);
  timers = null;
}

module.exports = { runPortfolioTick, runScheduleTick, startReportScheduler, stopReportScheduler };
