/**
 * Shared kit for live tests: tests that drive real processes against the real
 * local Postgres instead of a mocked Prisma.
 *
 * A live test lives in `__live__/*.live.test.js` and runs only through
 *
 *   npm run test:live --workspace=backend -- <path>
 *
 * (jest.live.config.js), never in the default `npm test`. Each test makes its
 * own organisation named `LiveTest <uuid>` and deletes it afterwards, so it
 * never touches the demo organisation, the certified Phase 21 project or the
 * E2E organisation (which must keep exactly one project).
 *
 * Processes a test starts get a free port and their own scheduler lock key and
 * realtime channel prefix, so they cannot disturb the API on :5000, the mobile
 * web server on :8081, or each other.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const net = require("net");
const path = require("path");
const bcrypt = require("bcryptjs");

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const SIGNAL_BRIDGE = path.join(__dirname, "signal-bridge.js");

const isLive = () => process.env.RUN_LIVE_DB === "1";

/** `describe` when live tests are enabled, `describe.skip` otherwise. */
const liveDescribe = (...args) => (isLive() ? describe(...args) : describe.skip(...args));

/** A TCP port nothing is listening on right now. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A short unique suffix for lock keys, channel prefixes and names. */
const uniqueTag = (prefix = "live") => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * Starts `node <entry>` from the backend folder with the given environment.
 *
 * The child runs behind signal-bridge.js, which turns an IPC message into
 * `process.emit(signal)`: Windows cannot deliver a real SIGTERM, and a graceful
 * shutdown test has to exercise the same handler ECS will call.
 *
 *   const api = spawnNode("src/index.js", { env: { PORT: String(port) } });
 *   await api.waitForOutput(/running on port/);
 *   await api.signal("SIGTERM");
 *   const { code } = await api.exited;
 */
const spawnNode = (entry, { env = {}, args = [], cwd = BACKEND_ROOT } = {}) => {
  const child = spawn(process.execPath, [SIGNAL_BRIDGE, entry, ...args], {
    cwd,
    env: {
      ...process.env,
      // Defaults that keep a spawned process to itself; a test overrides any of them.
      NODE_ENV: "development",
      REQUEST_LOG_FORMAT: "off",
      SCHEDULERS_ENABLED: "false",
      JOB_WORKER_ENABLED: "false",
      SCHEDULER_LOCK_KEY: uniqueTag("lock"),
      REALTIME_CHANNEL_PREFIX: uniqueTag("rt"),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });

  let output = "";
  const waiters = [];
  const onData = (chunk) => {
    output += chunk.toString();
    for (const waiter of [...waiters]) {
      if (waiter.pattern.test(output)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(output);
      }
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  const exited = new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal, output }));
  });

  return {
    child,
    exited,
    output: () => output,
    waitForOutput(pattern, timeoutMs = 15_000) {
      if (pattern.test(output)) return Promise.resolve(output);
      return new Promise((resolve, reject) => {
        const waiter = { pattern, resolve };
        waiter.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`timed out after ${timeoutMs} ms waiting for ${pattern} in:\n${output.slice(-4000)}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    /** Delivers a signal through the bridge (graceful), as ECS would. */
    async signal(name = "SIGTERM") {
      if (child.connected) child.send({ signal: name });
    },
    /** Ends the process without ceremony, as a crash or SIGKILL would. */
    kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      return exited;
    },
  };
};

/**
 * Polls a URL until it answers with any HTTP status. Wait for the process's
 * "listening" line first (`waitForOutput`) — polling a port nobody has bound
 * yet is slow on Windows — and each attempt gives up after two seconds so one
 * stalled connection cannot eat the whole budget.
 */
const waitForHttp = async (url, { timeoutMs = 20_000, intervalMs = 150 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return response;
    } catch (error) {
      lastError = error;
      await sleep(intervalMs);
    }
  }
  throw new Error(`${url} did not answer within ${timeoutMs} ms (${lastError?.message || "no response"})`);
};

/** An access token for a user row, signed exactly as sign-in signs one. */
const mintAccessToken = (user) => require("../utils/tokens").createAccessToken(user);

/**
 * A throwaway organisation with an active subscription and one company
 * administrator. The password is random and returned so a test can sign in.
 */
const createLiveOrg = async (prisma, { role = "pm", isCompanyAdmin = true } = {}) => {
  const tag = crypto.randomUUID();
  const password = `Live-${crypto.randomBytes(12).toString("base64url")}!9a`;
  const org = await prisma.organisation.create({
    data: {
      name: `LiveTest ${tag}`,
      subscription: {
        create: {
          plan: "business",
          status: "active",
          seats: 25,
          currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        },
      },
    },
  });
  const user = await prisma.user.create({
    data: {
      orgId: org.id,
      name: "Live Test Admin",
      email: `live-${tag}@octapm-live.test`,
      passwordHash: await bcrypt.hash(password, 4),
      role,
      isCompanyAdmin,
    },
  });
  return { org, user, password, token: mintAccessToken(user) };
};

/**
 * Deletes a live organisation and everything that hangs off it. Most tables
 * cascade; a RESTRICT constraint is answered by clearing the table it names,
 * scoped to this organisation's rows, then retrying — the approach the E2E
 * reset uses. Refuses any organisation that is not a LiveTest one.
 */
const dropLiveOrg = async (prisma, orgId) => {
  if (!orgId) return;
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  if (!org) return;
  if (!/^LiveTest [0-9a-f-]{36}$/.test(org.name)) {
    throw new Error(`dropLiveOrg refuses "${org.name}": not a LiveTest organisation`);
  }

  const projectIds = (await prisma.project.findMany({ where: { orgId }, select: { id: true } })).map((row) => row.id);
  const userIds = (await prisma.user.findMany({ where: { orgId }, select: { id: true } })).map((row) => row.id);
  const modelKeyFor = (table) => {
    const key = table.charAt(0).toLowerCase() + table.slice(1);
    return prisma[key]?.deleteMany ? key : null;
  };
  const blockerOf = (error) => {
    const match = /constraint \\?"([A-Za-z0-9]+)_([A-Za-z0-9]+)_fkey\\?"/.exec(error.message);
    const modelKey = match ? modelKeyFor(match[1]) : null;
    return modelKey ? { modelKey, column: match[2] } : null;
  };
  const clearRows = async (modelKey, column, ids, depth = 0) => {
    if (!ids.length) return;
    if (depth > 8) throw new Error(`clearing ${modelKey} nests deeper than eight tables`);
    for (let round = 0; round < 30; round += 1) {
      try {
        await prisma[modelKey].deleteMany({ where: { [column]: { in: ids } } });
        return;
      } catch (error) {
        if (/Unknown argument/.test(error.message) && !column.endsWith("Id")) return clearRows(modelKey, `${column}Id`, ids, depth);
        const blocker = blockerOf(error);
        if (!blocker) throw error;
        const parentIds = (await prisma[modelKey].findMany({ where: { [column]: { in: ids } }, select: { id: true } })).map((row) => row.id);
        await clearRows(blocker.modelKey, blocker.column, parentIds, depth + 1);
      }
    }
    throw new Error(`could not clear ${modelKey}: still blocked after thirty rounds`);
  };
  const steps = [
    [() => prisma.project.deleteMany({ where: { orgId } }), projectIds],
    [() => prisma.user.deleteMany({ where: { orgId } }), userIds],
    [() => prisma.subscription.deleteMany({ where: { orgId } }), [orgId]],
    [() => prisma.organisation.delete({ where: { id: orgId } }), [orgId]],
  ];
  for (const [run, referencedIds] of steps) {
    for (let round = 0; round < 30; round += 1) {
      try {
        await run();
        break;
      } catch (error) {
        const blocker = blockerOf(error);
        if (!blocker || round === 29) throw error;
        await clearRows(blocker.modelKey, blocker.column, referencedIds);
      }
    }
  }
};

module.exports = {
  BACKEND_ROOT,
  createLiveOrg,
  dropLiveOrg,
  freePort,
  isLive,
  liveDescribe,
  mintAccessToken,
  sleep,
  spawnNode,
  uniqueTag,
  waitForHttp,
};
