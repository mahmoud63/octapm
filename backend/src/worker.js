require('dotenv').config();

/**
 * Dedicated worker process.
 *
 *   npm run worker --workspace=backend
 *
 * Runs the durable job worker (unless JOB_WORKER_ENABLED=false) and competes
 * for scheduler leadership (unless SCHEDULERS_ENABLED=false). In production
 * the API tasks turn both off and this service does the background work.
 * Several worker processes can run at once: job claims use SKIP LOCKED, and
 * only the leader runs the schedulers.
 */
const { validateProductionEnv } = require('./config/security');

validateProductionEnv();

const { Server } = require('socket.io');
const { prisma } = require('./config/db');
const { startSchedulerLeadership, stopSchedulerLeadership } = require('./jobs/schedulers');
const { startJobWorker, stopJobWorker } = require('./jobs/worker');
const { createRealtimeAdapter } = require('./realtime/adapter');
const { subscribeBroadcasts } = require('./realtime/socket');
const { registerAutoSubscriptions } = require('./services/comment.service');
const { registerWebhookSubscriber } = require('./services/webhook.service');
const { installGracefulShutdown, waitForEventBus } = require('./utils/graceful-shutdown');
const { registerExceptionNotifier } = require('./services/exception.service');

// Job handlers publish domain events here (progress, audit, notifications).
// Their side effects — webhook deliveries, record follows — run in the
// process that published, exactly once, so this process registers them too.
registerWebhookSubscriber();
registerAutoSubscriptions();
// PC-7b: exception evaluation jobs run here too; a newly opened critical
// exception tells the project's PM and QS (off with EXCEPTIONS_ENGINE_ENABLED=false).
registerExceptionNotifier();

// People waiting on those events are connected to the API tasks. A socket.io
// server with no HTTP listener, bound to the same cluster adapter, relays
// them there. In development (in-memory adapter) there is nobody to reach.
const realtimeAdapter = createRealtimeAdapter();
let io = null;
let stopBroadcasts = null;
if (realtimeAdapter) {
  io = new Server({ adapter: realtimeAdapter.adapter });
  stopBroadcasts = subscribeBroadcasts(io);
}

// Nothing else is guaranteed to hold the event loop open while the queue is
// empty (every timer in the job worker and scheduler is unref'd), and a
// worker that quietly exits 0 looks to ECS like a job well done.
const keepAlive = setInterval(() => {}, 60_000);

const exitWith = (code, message) => {
  console.error(message);
  clearInterval(keepAlive);
  process.exit(code);
};

const worker = startJobWorker({
  concurrency: Number.parseInt(process.env.JOB_WORKER_CONCURRENCY || '4', 10),
  strictStart: true,
});
const leadership = startSchedulerLeadership();

if (!worker && !leadership) {
  exitWith(1, '[worker] JOB_WORKER_ENABLED=false and SCHEDULERS_ENABLED=false; nothing to run');
}

worker?.ready.catch((error) => {
  exitWith(1, `[worker] the job worker could not start (${error?.message || error}); exiting so the service restarts it`);
});

installGracefulShutdown({
  label: 'worker',
  drain: async ({ deadline }) => {
    await stopSchedulerLeadership();
    const jobs = await stopJobWorker({ deadline });
    if (!jobs.drained) throw new Error(`${jobs.pending} job(s) still running at the deadline`);
    // Let the last job events reach the API tasks before the adapter goes.
    await waitForEventBus();
    stopBroadcasts?.();
    if (io) await io.of('/').adapter.close();
    await realtimeAdapter?.close();
    await prisma.$disconnect();
    clearInterval(keepAlive);
  },
});
