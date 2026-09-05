require('dotenv').config();

/**
 * Dedicated job worker process.
 *
 *   npm run worker --workspace=backend
 *
 * Use this (and set JOB_WORKER_ENABLED=false on the API instances) when AI
 * generation load should not share CPU with request handling. Multiple worker
 * processes can run at once; claims use SKIP LOCKED so they never collide.
 */
const { startJobWorker, stopJobWorker } = require('./jobs/worker');

const worker = startJobWorker({
  concurrency: Number.parseInt(process.env.JOB_WORKER_CONCURRENCY || '4', 10),
});

if (!worker) {
  console.error('[worker] JOB_WORKER_ENABLED=false; nothing to run');
  process.exit(1);
}

const shutdown = async (signal) => {
  console.log(`[worker] ${signal} received, finishing active jobs...`);
  await stopJobWorker();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
