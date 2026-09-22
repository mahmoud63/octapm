/**
 * One "API task" for the shared-state live tests (not a test itself).
 *
 * It serves the real Express app on PORT, exactly as src/index.js does, but
 * starts no scheduler and no job worker: at this commit src/index.js starts
 * every scheduler unconditionally, and those would work through other
 * organisations' rows in the shared development database. A test instead asks
 * this process over IPC to run one scheduler function, scoped by the test, the
 * way the scheduler would call it:
 *
 *   child.send({ id, call: "push", args: { userId } })  ->  { id, result }
 *
 * The push and email calls take the user they are scoped to and, optionally,
 * the batch's `now`.
 *
 * LIVE_HOLD_AFTER_READ_MS with LIVE_HOLD_MODELS (comma list of Prisma model
 * keys) makes each findMany on those models wait before returning. Two such
 * processes started together then both read the same rows before either
 * writes: the dual-leader window, made wide enough to hit every time.
 *
 * LIVE_HTTPS_TO_HTTP=1 sends https requests addressed to 127.0.0.1 over plain
 * http, so web-push (which only speaks https) can reach a fake push service
 * on this machine without a certificate.
 */
const http = require("http");
const https = require("https");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripePort = Number(process.env.LIVE_STRIPE_PORT || 0);
if (process.env.LIVE_HTTPS_TO_HTTP === "1" || stripePort) {
  const originalRequest = https.request;
  https.request = function request(options, callback) {
    if (options && typeof options === "object" && !(options instanceof URL)) {
      const host = options.hostname || options.host;
      if (host === "127.0.0.1" && process.env.LIVE_HTTPS_TO_HTTP === "1") {
        const plain = { ...options };
        delete plain.agent;
        return http.request(plain, callback);
      }
      // LIVE_STRIPE_PORT: the Stripe SDK's calls go to a fake Stripe here.
      if (host === "api.stripe.com" && stripePort) {
        const plain = { ...options, host: "127.0.0.1", hostname: "127.0.0.1", port: stripePort };
        delete plain.agent;
        const request = http.request(plain, callback);
        // The SDK writes its body on the TLS 'secureConnect' event; a plain
        // socket only says 'connect', so pass that on under the TLS name.
        request.on("socket", (socket) => socket.once("connect", () => socket.emit("secureConnect")));
        return request;
      }
    }
    return originalRequest.apply(this, arguments);
  };
}

const holdMs = Number(process.env.LIVE_HOLD_AFTER_READ_MS || 0);
const holdModels = String(process.env.LIVE_HOLD_MODELS || "").split(",").map((name) => name.trim()).filter(Boolean);
// LIVE_SCOPE_ORG_ID: scheduler scans that walk every organisation (projects,
// accounting connections) see only the test's own organisation, so a test
// never touches another organisation's rows in the shared database.
const scopeOrgId = String(process.env.LIVE_SCOPE_ORG_ID || "").trim();
const scopedModels = ["project", "accountingConnection"];
if ((holdMs > 0 && holdModels.length) || scopeOrgId) {
  // config/db.js hands out global.__prisma; installing the extended client
  // first means every service in this process reads through it.
  const { PrismaClient } = require("@prisma/client");
  const query = {};
  const held = async (args, run) => {
    const rows = await run(args);
    await sleep(holdMs);
    return rows;
  };
  for (const model of holdModels) {
    query[model] = {
      findMany: ({ args, query: run }) => held(args, run),
      findUnique: ({ args, query: run }) => held(args, run),
    };
  }
  if (scopeOrgId) {
    for (const model of scopedModels) {
      const previous = query[model]?.findMany;
      query[model] = {
        ...(query[model] || {}),
        findMany: ({ args, query: run }) => {
          const scoped = { ...args, where: { AND: [args?.where || {}, { orgId: scopeOrgId }] } };
          return previous ? previous({ args: scoped, query: run }) : run(scoped);
        },
      };
    }
  }
  global.__prisma = new PrismaClient().$extends({ query });
}

const { createApp } = require("../../app");

const noopEnqueue = async () => ({ id: "live-test-enqueue" });

// Report schedules and SLA escalation scan every organisation for rows due
// before `now`. A test scopes them by asking with a `now` in 2001, before any
// real row could be due; anything later is refused.
const pastOnly = (now) => {
  const at = new Date(now);
  if (!(at.getTime() < Date.UTC(2002, 0, 1))) throw new Error("scans across organisations take a `now` before 2002");
  return at;
};

// A batch's `now` may be passed in, as the scheduler's does: it is read once at
// the start of a batch and can be minutes old by the time a later row is sent.
const batchNow = (now) => (now === undefined ? new Date() : new Date(now));

const calls = {
  push: ({ userId, limit = 50, now }) => {
    if (!userId) throw new Error("push needs a userId");
    return require("../push.service").processPendingPushDeliveries({ userId, limit, now: batchNow(now) });
  },
  email: ({ userId, limit = 25, now }) => {
    if (!userId) throw new Error("email needs a userId");
    return require("../notification.service").processPendingEmailDeliveries({ userId, limit, now: batchNow(now) });
  },
  reportSchedules: ({ now }) =>
    require("../report-builder.service").queueDueSchedules({ now: pastOnly(now), enqueue: noopEnqueue }),
  escalation: ({ now }) =>
    require("../workflow-engine.service").runEscalationScan({ now: pastOnly(now) }),
  dailyLogDistribution: ({ now }) => {
    if (!scopeOrgId) throw new Error("dailyLogDistribution needs LIVE_SCOPE_ORG_ID");
    return require("../daily-log.service").queueScheduledDistributions({ now: new Date(now), enqueue: noopEnqueue });
  },
  accountingPoll: () => {
    // Walks every connected organisation: refuse to run unscoped.
    if (!scopeOrgId) throw new Error("accountingPoll needs LIVE_SCOPE_ORG_ID");
    return require("../accounting.service").queuePollJobs();
  },
};

process.on("message", async (message) => {
  if (!message || typeof message.call !== "string") return;
  const { id, call, args = {} } = message;
  try {
    if (!calls[call]) throw new Error(`unknown call ${call}`);
    const result = await calls[call](args);
    process.send({ id, result });
  } catch (error) {
    process.send({ id, error: error?.message || String(error) });
  }
});

const port = Number(process.env.PORT || 0);
const server = createApp().listen(port, "127.0.0.1", () => {
  console.log(`shared-state live node running on port ${server.address().port}`);
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
