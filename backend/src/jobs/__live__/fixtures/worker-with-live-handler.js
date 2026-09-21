/**
 * The real worker process (src/worker.js) with one extra job handler, for
 * live tests. LIVE_JOB_TYPE names the type; it is not one of the product's
 * job types, so no other process (the developer's API on :5000 included) ever
 * claims such a job, and JOB_WORKER_TYPES keeps this process to it.
 *
 * The handler logs "[live-job] <id> started", optionally reports a progress
 * payload of about 14 KB (payload.bigProgress), then sleeps payload.sleepMs.
 * Only live tests start this file (through __live__/signal-bridge.js).
 */
const handlers = require("../../handlers");
const { registerJobHandler } = require("../../worker");

const type = process.env.LIVE_JOB_TYPE;
if (!type) {
  console.error("worker-with-live-handler: set LIVE_JOB_TYPE");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const liveHandler = async ({ job, payload, updateProgress }) => {
  console.log(`[live-job] ${job.id} started`);
  if (payload.bigProgress) {
    const big = {};
    for (let index = 0; index < 30; index += 1) big[`k${index}`] = `${index}`.padEnd(450, "x");
    await updateProgress({ step: "big", detail: big });
  }
  await sleep(Number(payload.sleepMs) || 0);
  return { slept: Number(payload.sleepMs) || 0 };
};

// The worker registers every product handler when it starts; this one joins them.
const registerProductHandlers = handlers.registerAllHandlers;
handlers.registerAllHandlers = (...args) => {
  const result = registerProductHandlers(...args);
  registerJobHandler(type, liveHandler);
  return result;
};

require("../../../worker");
