'use strict';

/**
 * L12 — independent check (the checker's scratch script, not the lead's reproduction).
 *
 * The lead's script lifts each switch's expression out of the source with a
 * regular expression and evaluates that expression. This one does not trust
 * the lifting: it RUNS the product's own start functions (startJobWorker,
 * startSchedulerLeadership and, through it, the seven start*Scheduler
 * functions) as they are in the commit (default) or in the working tree
 * (--tree), with
 *   - a fake process.env (so nothing of this machine's environment leaks in),
 *   - every dependency except the files under test replaced by a recorder
 *     (no Prisma client, no database, no network, no server), and
 *   - fake timers (nothing keeps running).
 * It then prints which database/service calls each start function made
 * before any timer fired — that is, what the process does "at once".
 *
 * The scheduler leader is replaced by a stub that elects at once, which is
 * what the real one does in a lone process (it takes a free advisory lock).
 *
 *   node scripts/cert/leads/scratch/l12-check-behaviour.js          the last commit (git show HEAD:…, read-only)
 *   node scripts/cert/leads/scratch/l12-check-behaviour.js --tree   the working tree
 *
 * exit 2 = with an empty environment the process becomes a job worker or a
 * scheduler leader; exit 0 = it does neither.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND = path.join(__dirname, '..', '..', '..', '..');
const useTree = process.argv.includes('--tree');

const gitShow = (rel) => {
  for (const exe of ['git', 'C:\\Program Files\\Git\\cmd\\git.exe']) {
    try {
      return execFileSync(exe, ['show', `HEAD:backend/src/${rel}`], { cwd: BACKEND, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      if (error.code !== 'ENOENT') return null;
    }
  }
  throw new Error('git could not be reached');
};
const sourceCache = new Map();
const readSource = (rel) => {
  if (sourceCache.has(rel)) return sourceCache.get(rel);
  let text;
  if (useTree) {
    const file = path.join(BACKEND, 'src', rel);
    text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  } else {
    text = gitShow(rel);
  }
  sourceCache.set(rel, text);
  return text;
};

// The files that are really executed. Everything else is a recorder.
const REAL = new Set([
  'jobs/worker.js',
  'jobs/schedulers.js',
  'jobs/billing-scheduler.js',
  'jobs/notification-scheduler.js',
  'jobs/daily-log-scheduler.js',
  'jobs/report-scheduler.js',
  'jobs/workflow-scheduler.js',
  'jobs/accounting-scheduler.js',
  'jobs/exception-scheduler.js',
  'config/switches.js',
]);

const resultFor = (name) => {
  if (/claimNextJob$/.test(name)) return null;
  if (/findMany$/.test(name)) return [];
  if (/findFirst$/.test(name)) return null;
  return {};
};

const scenario = async (label, env) => {
  const calls = [];
  const logs = [];
  const timers = [];
  const cache = new Map();

  const recorder = (name) =>
    new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return recorder(`${name}.${String(prop)}`);
      },
      apply() {
        calls.push(name);
        return Promise.resolve(resultFor(name));
      },
    });

  const fakeProcess = Object.create(process);
  Object.defineProperty(fakeProcess, 'env', { value: env });
  const fakeConsole = {
    log: (...args) => logs.push(args.map(String).join(' ')),
    warn: (...args) => logs.push(`WARN ${args.map(String).join(' ')}`),
    error: (...args) => logs.push(`ERROR ${args.map((a) => (a && a.message) || String(a)).join(' ')}`),
  };
  const fakeTimer = (kind) => (fn, ms) => {
    const handle = { kind, ms, unref() {} };
    timers.push(handle);
    return handle;
  };

  // The engine's and the weather feed's own answers, executed from their own
  // source lines (the services are too large to load against recorders).
  const engineLine = /const engineEnabled = ([^\n]+);\r?\n/.exec(readSource('services/exception-engine.service.js') || '');
  const weatherLine = /const isEnabled = ([^\n]+);\r?\n/.exec(readSource('services/weather-feed.service.js') || '');

  let load = null;
  const switchesLoaded = () => (readSource('config/switches.js') ? load('config/switches.js') : {});
  const lifted = (line) => new Function('process', 'isSwitchOn', `return (${line});`)(fakeProcess, switchesLoaded().isSwitchOn);

  load = (rel) => {
    if (cache.has(rel)) return cache.get(rel).exports;
    const source = readSource(rel);
    if (source === null) throw new Error(`${rel} is not in this tree`);
    const module = { exports: {} };
    cache.set(rel, module);
    const dir = path.posix.dirname(rel);
    const localRequire = (id) => {
      if (id === 'os') return require('os');
      if (!id.startsWith('.')) return recorder(id);
      let target = path.posix.normalize(path.posix.join(dir, id));
      if (!target.endsWith('.js')) target += '.js';
      if (target === 'jobs/scheduler-leader.js') {
        return {
          leaderOptionsFromEnv: () => ({}),
          createSchedulerLeader: (options) => ({
            start() {
              calls.push('scheduler-leader.start  (stub: a lone process is elected at once)');
              options.onElected();
            },
            stop: async () => options.onDemoted && options.onDemoted(),
          }),
        };
      }
      if (target === 'services/exception-engine.service.js' && engineLine) return { engineEnabled: lifted(engineLine[1]) };
      if (target === 'services/weather-feed.service.js' && weatherLine) return { isEnabled: lifted(weatherLine[1]) };
      if (REAL.has(target) && readSource(target) !== null) return load(target);
      return recorder(target.replace(/\.js$/, ''));
    };
    const wrapper = new Function('exports', 'require', 'module', 'process', 'console', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', source);
    wrapper(module.exports, localRequire, module, fakeProcess, fakeConsole, fakeTimer('interval'), fakeTimer('timeout'), () => {}, () => {});
    return module.exports;
  };

  const worker = load('jobs/worker.js');
  const schedulers = load('jobs/schedulers.js');

  const startedWorker = worker.startJobWorker();
  if (startedWorker && startedWorker.ready) await startedWorker.ready;
  const afterWorker = calls.length;
  const leadership = schedulers.startSchedulerLeadership();
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));

  const unique = (list) => [...new Set(list)];
  console.log(`\n-- ${label}`);
  console.log(`   env given to the process: ${JSON.stringify(env)}`);
  console.log(`   startJobWorker() returned ${startedWorker ? 'a worker' : 'null'};  startSchedulerLeadership() returned ${leadership ? 'a leader' : 'null'}`);
  console.log('   what the process logged:');
  for (const line of logs) console.log(`     ${line}`);
  console.log(`   calls made by the job worker at start: ${unique(calls.slice(0, afterWorker)).join(', ') || '(none)'}`);
  console.log('   calls made by the schedulers before any timer fired:');
  for (const name of unique(calls.slice(afterWorker))) console.log(`     ${name}`);
  if (calls.length === afterWorker) console.log('     (none)');
  console.log(`   timers set: ${timers.length}  (${timers.map((t) => `${t.kind} ${t.ms} ms`).join('; ') || 'none'})`);
  return { worker: Boolean(startedWorker), leader: Boolean(leadership), calls: calls.length, timers: timers.length };
};

(async () => {
  console.log(`L12 independent check — the start functions of the ${useTree ? 'working tree' : 'last commit (HEAD)'}, run against recorders`);
  const names = ['JOB_WORKER_ENABLED', 'SCHEDULERS_ENABLED', 'BILLING_SCHEDULER_ENABLED', 'NOTIFICATION_SCHEDULER_ENABLED', 'DAILY_LOG_SCHEDULER_ENABLED', 'REPORT_SCHEDULER_ENABLED', 'WORKFLOW_SCHEDULER_ENABLED', 'ACCOUNTING_SCHEDULER_ENABLED', 'EXCEPTIONS_SCHEDULER_ENABLED', 'WEATHER_FEED_ENABLED', 'EXPO_PUSH_ENABLED'];
  const all = (value) => Object.fromEntries(names.map((name) => [name, value]));

  const silent = await scenario('A. a production process that is told nothing about its role', { NODE_ENV: 'production' });
  const off = await scenario('B. every switch "false"', { NODE_ENV: 'production', ...all('false') });
  const zero = await scenario('C. every switch "0" (another way an operator writes off)', { NODE_ENV: 'production', ...all('0') });
  const on = await scenario('D. every switch "true" (what a worker is meant to do)', { NODE_ENV: 'production', ...all('true') });
  const two = await scenario('E. only the two switches the image workflow gives the worker', { NODE_ENV: 'production', SCHEDULERS_ENABLED: 'true', JOB_WORKER_ENABLED: 'true' });

  console.log('\nSummary');
  for (const [label, r] of [['A told nothing', silent], ['B all "false"', off], ['C all "0"', zero], ['D all "true"', on], ['E the two main switches', two]]) {
    console.log(`  ${label.padEnd(26)} worker=${String(r.worker).padEnd(5)}  leader=${String(r.leader).padEnd(5)}  calls=${String(r.calls).padEnd(3)} timers=${r.timers}`);
  }
  const defect = silent.worker || silent.leader;
  process.exitCode = defect ? 2 : 0;
  console.log(
    `\nCHECK L12 (${useTree ? 'working tree' : 'HEAD'}): ${defect ? 'default-ON — a process told nothing started the job worker and/or led the schedulers' : 'default-OFF — a process told nothing started neither the job worker nor scheduler leadership'}`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
