const { createServer } = require('http');
const { Server } = require('socket.io');
const { createApp } = require('./app');
const { prisma } = require('./config/db');
const { createSocketCorsOptions, validateProductionEnv } = require('./config/security');
const { startSchedulerLeadership, stopSchedulerLeadership } = require('./jobs/schedulers');
const { createRealtimeAdapter } = require('./realtime/adapter');
const { attachRealtime } = require('./realtime/socket');
const { registerAutoSubscriptions } = require('./services/comment.service');
const { registerWebhookSubscriber } = require('./services/webhook.service');
const { registerExceptionTriggers } = require('./events/exception-triggers');
const { startJobWorker, stopJobWorker } = require('./jobs/worker');
const { describeSwitches } = require('./config/switches');
const { installGracefulShutdown, waitForEventBus } = require('./utils/graceful-shutdown');
const { registerExceptionNotifier } = require('./services/exception.service');

validateProductionEnv();

const readPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const app = createApp();
app.locals.draining = false;
const httpServer = createServer(app);

// The load balancer keeps idle connections open for 60 s; Node's default of
// 5 s would close them first and the balancer would forward a request onto a
// socket that is already gone (a sporadic 502). Stay longer than it does.
httpServer.keepAliveTimeout = readPositiveInt(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 65_000);
httpServer.headersTimeout = httpServer.keepAliveTimeout + 1000;

// With several API tasks the adapter carries room broadcasts and
// disconnectSockets to every task; in development it is null (in-memory).
const realtimeAdapter = createRealtimeAdapter();
const io = new Server(httpServer, {
  cors: createSocketCorsOptions(),
  ...(realtimeAdapter ? { adapter: realtimeAdapter.adapter } : {}),
});

app.set('io', io);
attachRealtime(io);
// Side-effect subscribers run in the process that published the event, once.
// Record creators and assignees follow their records (comment notifications).
registerAutoSubscriptions();
registerWebhookSubscriber();
// Project exceptions (PC-7b): a relevant event asks for a debounced evaluation
// job of its project; only with EXCEPTIONS_ENGINE_ENABLED=true (default off).
registerExceptionTriggers();

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`PMcopilots API running on port ${PORT}`);
});

// Billing, notifications, daily logs, reports, workflow SLAs and accounting
// polls — run by whichever process holds scheduler leadership. Production
// API tasks leave SCHEDULERS_ENABLED unset (off) and leave them to the worker.
startSchedulerLeadership();
// PC-7b: an exception evaluation (a job run here) that opens a critical
// exception tells the project's PM and QS, once; only with
// EXCEPTIONS_ENGINE_ENABLED=true (exception.service registerExceptionNotifier).
registerExceptionNotifier();
// What this process will and will not do on its own, in its first log lines (C0-2).
console.log(`[switches] ${describeSwitches()}`);
// Durable job worker (BOQ AI, schedule generation); runs only with JOB_WORKER_ENABLED=true. Leave it unset
// on API instances when running dedicated workers via `npm run worker`.
startJobWorker();

installGracefulShutdown({
  label: 'api',
  drain: async ({ deadline }) => {
    // /api/health (the load balancer's check) and /api/health/ready answer
    // 503 from here on, so the balancer stops routing new requests here.
    app.locals.draining = true;
    // Leadership first: a successor can start the schedulers during our drain.
    await stopSchedulerLeadership();

    // Idle keep-alive connections go now; a request in flight finishes, and
    // two seconds before the deadline every connection left is cut.
    const cutAll = setTimeout(() => httpServer.closeAllConnections(), Math.max(0, deadline - Date.now() - 2000));
    const [, jobs] = await Promise.all([
      (async () => {
        // No new connections; resolves once every connection has ended.
        const httpClosed = new Promise((resolve) => httpServer.close(() => resolve()));
        httpServer.closeIdleConnections();
        // Upgraded WebSockets are not HTTP connections the server can close:
        // socket.io closes them (the clients reconnect to another task, with
        // their usual back-off) along with the adapter's LISTEN client. Its
        // own attempt to close the already-closing HTTP server is a no-op.
        await io.close();
        await httpClosed;
      })(),
      stopJobWorker({ deadline }),
    ]);
    clearTimeout(cutAll);
    if (!jobs.drained) throw new Error(`${jobs.pending} job(s) still running at the deadline`);

    // The bus publishes a request's event 150 ms after the request ends, and
    // that publish goes out through the adapter's pool. Waiting it out first
    // means a request that finished just before SIGTERM still reaches the
    // clients on the other tasks; closing the pool first would drop it.
    await waitForEventBus();
    await realtimeAdapter?.close();
    // Usage/error counts still buffered for the platform console (best effort).
    await require('./services/platform/telemetry.service').drain().catch(() => null);
    await prisma.$disconnect();
  },
});

module.exports = { app, httpServer, io };
