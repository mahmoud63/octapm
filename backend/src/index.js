const { createServer } = require('http');
const { Server } = require('socket.io');
const { createApp } = require('./app');
const { createSocketCorsOptions, validateProductionEnv } = require('./config/security');
const { startBillingScheduler } = require('./jobs/billing-scheduler');
const { startNotificationScheduler } = require('./jobs/notification-scheduler');
const { startDailyLogScheduler } = require('./jobs/daily-log-scheduler');
const { attachRealtime } = require('./realtime/socket');
const { registerAutoSubscriptions } = require('./services/comment.service');
const { startJobWorker, stopJobWorker } = require('./jobs/worker');

validateProductionEnv();

const app = createApp();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: createSocketCorsOptions(),
});

app.set('io', io);
attachRealtime(io);
// Record creators and assignees follow their records (comment notifications).
registerAutoSubscriptions();

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`PMcopilots API running on port ${PORT}`);
});

startBillingScheduler();
startNotificationScheduler();
// Daily log weather feed and evening distribution (OCTA-FLD-DAILY-022).
startDailyLogScheduler();
// Durable job worker (BOQ AI, schedule generation). Set JOB_WORKER_ENABLED=false
// on API instances when running dedicated workers via `npm run worker`.
startJobWorker();

const shutdown = async (signal) => {
  console.log(`[api] ${signal} received; finishing active jobs`);
  try {
    await stopJobWorker();
  } finally {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  }
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, httpServer, io };
