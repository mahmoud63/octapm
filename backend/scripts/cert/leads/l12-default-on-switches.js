'use strict';

/**
 * L12 — which background switches are ON when their environment variable is
 * missing.
 *
 * A configuration lead, verified by READING: this script starts no server,
 * loads no product module and opens no database connection. It reads the
 * source files, lifts each switch's own expression out of them, and evaluates
 * that expression in an empty sandbox against a set of environments (missing,
 * empty, "false", "FALSE", " false ", "0", "off", "true"). So the table is
 * what the product's code answers, not a paraphrase of it.
 *
 *   node scripts/cert/leads/l12-default-on-switches.js          judges the working tree
 *   node scripts/cert/leads/l12-default-on-switches.js --head   judges the last commit (git show HEAD:…, read-only)
 *
 * Judging the working tree, it also prints the last commit's answers beside
 * it when git can be reached, so a fix that is not committed yet is visible
 * as one.
 *
 * exit 0 = a process that is told nothing runs no worker and no scheduler (or
 *          the production boot check demands an explicit answer);
 * exit 2 = a process that is told nothing becomes a job worker and a scheduler
 *          leader candidate.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const LEAD = 'L12';
const BACKEND = path.join(__dirname, '..', '..', '..');
const SRC = path.join(BACKEND, 'src');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const gitShow = (rev, rel) => {
  for (const exe of ['git', 'C:\\Program Files\\Git\\cmd\\git.exe']) {
    try {
      return execFileSync(exe, ['show', `${rev}:backend/src/${rel}`], { cwd: BACKEND, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      if (error.code !== 'ENOENT') return null; // git ran; the file is not in that commit
    }
  }
  return undefined; // git cannot be reached
};
const headName = () => {
  for (const exe of ['git', 'C:\\Program Files\\Git\\cmd\\git.exe']) {
    try {
      return execFileSync(exe, ['rev-parse', '--short', 'HEAD'], { cwd: BACKEND, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      /* try the next */
    }
  }
  return null;
};

/** A source tree to read from: the files on disk, or a commit. */
const treeOf = (rev) => ({
  label: rev ? `commit ${headName() || rev}` : 'working tree',
  read: (rel) => {
    if (!rev) {
      const file = path.join(SRC, rel);
      // A checkout on Windows may carry CRLF; the commit has LF.
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    }
    const text = gitShow(rev, rel);
    return typeof text === 'string' ? text.replace(/\r\n/g, '\n') : text;
  },
});

/** The first `if (...)` on one line that names the switch: the condition under which the thing does NOT start. */
const offWhen = (name) => new RegExp(`if \\(([^\\n]*${name}[^\\n]*)\\) (?:\\{|return null;)`);

/**
 * kind 'offWhen'  — the captured expression is the condition under which the
 *                   thing does NOT start;
 * kind 'onWhen'   — the captured text is an arrow function answering "on?".
 */
const SWITCHES = [
  {
    name: 'JOB_WORKER_ENABLED',
    file: 'jobs/worker.js',
    find: offWhen('JOB_WORKER_ENABLED'),
    kind: 'offWhen',
    what: 'the in-process job worker (API: index.js startJobWorker(); worker.js too)',
    atStart:
      "recoverStaleJobs() — every company's running jobs with a stale heartbeat are failed or re-queued (BackgroundJob); then claims and RUNS queued jobs of every type and every company (AI schedule/BOQ runs, webhook HTTP deliveries, report PDFs and their emails, accounting syncs), 2 at a time; hourly prune deletes expired finished jobs.",
  },
  {
    name: 'SCHEDULERS_ENABLED',
    file: 'jobs/schedulers.js',
    find: /const schedulersEnabled = ([\s\S]+?);\n/,
    kind: 'onWhen',
    what: 'scheduler leadership (index.js startSchedulerLeadership(); worker.js too)',
    atStart:
      'opens one extra database connection and takes pg_try_advisory_lock(918273, hashtext(key)); the winner starts all seven schedulers below plus a 15-minute prune that deletes expired RateLimitBucket and AuthThrottle rows.',
  },
  {
    name: 'BILLING_SCHEDULER_ENABLED',
    file: 'jobs/billing-scheduler.js',
    find: offWhen('BILLING_SCHEDULER_ENABLED'),
    kind: 'offWhen',
    immediate: /function startBillingScheduler\(\) \{[\s\S]*?\n\s*runBillingChecks\(\)\.catch[\s\S]*?setInterval/,
    what: 'billing scheduler (leader only)',
    atStart:
      'AT ONCE, every company: Subscription.status trialing -> expired where the trial has ended; trial reminder emails (claims reminderDay5SentAt / reminderDay7SentAt); canceled -> expired past the period end (subscription.updateMany). Then daily.',
  },
  {
    name: 'NOTIFICATION_SCHEDULER_ENABLED',
    file: 'jobs/notification-scheduler.js',
    find: offWhen('NOTIFICATION_SCHEDULER_ENABLED'),
    kind: 'offWhen',
    immediate: /function startNotificationScheduler\(\) \{[\s\S]*?runNotificationChecks\(\)\.catch[\s\S]*?runDailyDueScan\(\)\.catch[\s\S]*?setInterval/,
    what: 'notification scheduler (leader only)',
    atStart:
      'AT ONCE: sends up to 100 pending notification emails and 200 pushes (NotificationDeliveryAttempt rows change); and the due-date scan of EVERY organisation writes Notification + NotificationDeliveryAttempt rows. Then hourly / daily.',
  },
  {
    name: 'DAILY_LOG_SCHEDULER_ENABLED',
    file: 'jobs/daily-log-scheduler.js',
    find: offWhen('DAILY_LOG_SCHEDULER_ENABLED'),
    kind: 'offWhen',
    immediate: /safe\("weather", runWeatherTick\)\(\);\s*\n\s*safe\("distribution", runDistributionTick\)\(\);/,
    what: 'daily-log scheduler (leader only)',
    atStart:
      'AT ONCE: one daily_log.weather BackgroundJob per company that has an active project with coordinates (when the weather feed is on); daily_log.distribute jobs for projects whose send time passed (DailyLog.autoDistributeQueuedFor). Then every 30 / 10 minutes.',
  },
  {
    name: 'REPORT_SCHEDULER_ENABLED',
    file: 'jobs/report-scheduler.js',
    find: offWhen('REPORT_SCHEDULER_ENABLED'),
    kind: 'offWhen',
    immediate: /safe\("schedules", runScheduleTick\)\(\);\s*\n\s*safe\("portfolio", runPortfolioTick\)\(\);/,
    what: 'report scheduler (leader only)',
    atStart:
      'AT ONCE: due ReportSchedule rows advance nextRunAt, a ReportRun is created and a report.render job queued; one portfolio.refresh BackgroundJob per company with an active project. Then every 5 minutes / hourly.',
  },
  {
    name: 'WORKFLOW_SCHEDULER_ENABLED',
    file: 'jobs/workflow-scheduler.js',
    find: offWhen('WORKFLOW_SCHEDULER_ENABLED'),
    kind: 'offWhen',
    immediate: /const safe = \(\) => runEscalationTick\(\)[^\n]*\n\s*safe\(\);/,
    what: 'workflow SLA scheduler (leader only)',
    atStart:
      'AT ONCE, every company: overdue workflow steps get escalatedAt, WorkflowInstance.escalationLevel + 1, a workflow event and notifications to the assignee and the escalation roles. Then hourly.',
  },
  {
    name: 'ACCOUNTING_SCHEDULER_ENABLED',
    file: 'jobs/accounting-scheduler.js',
    find: offWhen('ACCOUNTING_SCHEDULER_ENABLED'),
    kind: 'offWhen',
    what: 'accounting poll scheduler (leader only)',
    atStart:
      'nothing at start; after 90 s, then hourly: one accounting.poll job per company with a connected accounting system (the job records sub-contractor payments found in the accounting system).',
  },
  {
    name: 'EXCEPTIONS_ENGINE_ENABLED',
    file: 'services/exception-engine.service.js',
    find: /const engineEnabled = ([^\n]+);\n/,
    kind: 'onWhen',
    what: 'the exception engine (event trigger, nightly tick, job handler, notifier)',
    atStart: 'when on: every relevant record event queues an exceptions.evaluate job for its project; nothing at start.',
  },
  {
    name: 'EXCEPTIONS_SCHEDULER_ENABLED',
    file: 'jobs/exception-scheduler.js',
    find: /const schedulerEnabled = ([^\n]+);\n/,
    kind: 'onWhen',
    what: 'the nightly exception tick (leader only; also needs the engine on)',
    atStart: 'nothing at start; once a night one exceptions.evaluate job per active project of every company — only when the engine is on.',
  },
  {
    name: 'WEATHER_FEED_ENABLED',
    file: 'services/weather-feed.service.js',
    find: /const isEnabled = ([^\n]+);\n/,
    kind: 'onWhen',
    what: 'the weather feed (calls Open-Meteo from daily_log.weather jobs)',
    atStart: 'gates the weather tick of the daily-log scheduler.',
  },
  {
    name: 'EXPO_PUSH_ENABLED',
    file: 'services/push.service.js',
    find: /const expoEnabled = ([^\n]+);\n/,
    kind: 'onWhen',
    what: 'Expo push (sends to exp.host)',
    atStart: 'no timer of its own: 750 ms after any notification is created, pending pushes are sent.',
  },
];

const VARIANTS = [
  ['missing', undefined],
  ['""', ''],
  ['"false"', 'false'],
  ['"FALSE"', 'FALSE'],
  ['" false "', ' false '],
  ['"0"', '0'],
  ['"off"', 'off'],
  ['"true"', 'true'],
];

const DATA_SCHEDULERS = ['BILLING_SCHEDULER_ENABLED', 'NOTIFICATION_SCHEDULER_ENABLED', 'DAILY_LOG_SCHEDULER_ENABLED', 'REPORT_SCHEDULER_ENABLED', 'WORKFLOW_SCHEDULER_ENABLED', 'ACCOUNTING_SCHEDULER_ENABLED'];

/** Reads one tree and answers every switch from that tree's own code. */
const survey = (tree) => {
  // A shared helper the switches may call (config/switches.js, when the tree has one).
  const switchesJs = tree.read('config/switches.js');
  const helper = switchesJs ? /const isSwitchOn = ([^\n]+);\n/.exec(switchesJs) : null;

  const evaluate = (entry, expression, value) => {
    const env = { NODE_ENV: 'production' };
    if (value !== undefined) env[entry.name] = value;
    const sandbox = { process: { env }, env, timer: null, timers: null, String, Number, Boolean };
    const prelude = helper ? `const isSwitchOn = ${helper[1]};\n` : '';
    const source = entry.kind === 'onWhen' ? `${prelude}(${expression})(process.env)` : `${prelude}(${expression})`;
    const answer = vm.runInNewContext(source, sandbox, { timeout: 1000 });
    return entry.kind === 'onWhen' ? Boolean(answer) : !answer;
  };

  const rows = [];
  const notFound = [];
  let unreachable = false;
  for (const entry of SWITCHES) {
    const text = tree.read(entry.file);
    if (text === undefined) unreachable = true;
    const match = text ? entry.find.exec(text) : null;
    if (!match) {
      notFound.push(entry);
      continue;
    }
    const expression = match[1].trim();
    const line = lineOf(text, match.index + match[0].indexOf(match[1]));
    let answers;
    try {
      answers = Object.fromEntries(VARIANTS.map(([label, value]) => [label, evaluate(entry, expression, value)]));
    } catch (error) {
      notFound.push({ ...entry, error: `${expression} could not be evaluated: ${error.message}` });
      continue;
    }
    rows.push({ ...entry, expression, line, answers, immediate: entry.immediate ? entry.immediate.test(text) : null });
  }

  const indexJs = tree.read('index.js') || '';
  const workerJs = tree.read('worker.js') || '';
  const securityJs = tree.read('config/security.js') || '';
  const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
  const bootRule = SWITCHES.map((entry) => entry.name).filter((name) => securityJs.includes(name));
  return {
    tree,
    rows,
    notFound,
    unreachable,
    byName,
    helper: helper ? helper[1] : null,
    bootRule,
    roleDemanded: bootRule.includes('JOB_WORKER_ENABLED') && bootRule.includes('SCHEDULERS_ENABLED'),
    entry: {
      'index.js calls startSchedulerLeadership() unconditionally': /^startSchedulerLeadership\(\);/m.test(indexJs),
      'index.js calls startJobWorker() unconditionally': /^startJobWorker\(\);/m.test(indexJs),
      'worker.js calls both': /startJobWorker\(/.test(workerJs) && /startSchedulerLeadership\(/.test(workerJs),
    },
    workerOn: byName.JOB_WORKER_ENABLED?.answers.missing,
    leaderOn: byName.SCHEDULERS_ENABLED?.answers.missing,
    engineOn: byName.EXCEPTIONS_ENGINE_ENABLED?.answers.missing,
    schedulersOn: DATA_SCHEDULERS.filter((name) => byName[name]?.answers.missing),
    located: !['JOB_WORKER_ENABLED', 'SCHEDULERS_ENABLED'].some((name) => !byName[name]),
  };
};

const print = (view) => {
  console.log(`L12 — background switches in the ${view.tree.label}, as the product's own expressions answer (NODE_ENV=production in the sandbox)\n`);
  if (view.helper) console.log(`config/switches.js: isSwitchOn = ${view.helper}\n`);
  for (const row of view.rows) {
    console.log(`${row.name}  —  ${row.what}`);
    console.log(`  where:      backend/src/${row.file}:${row.line}`);
    console.log(`  expression: ${row.kind === 'offWhen' ? 'does NOT start when  ' : 'on when  '}${row.expression.replace(/\s+/g, ' ')}`);
    console.log(`  answers:    ${VARIANTS.map(([label]) => `${label} -> ${row.answers[label] ? 'ON' : 'off'}`).join('   ')}`);
    if (row.immediate !== null) console.log(`  acts at start (the first tick is called before the timer is set): ${row.immediate ? 'yes' : 'not found in the source'}`);
    console.log(`  what it does: ${row.atStart}\n`);
  }
  for (const entry of view.notFound) console.log(`${entry.name}: ${entry.error || `the expression was NOT FOUND in backend/src/${entry.file} — the code changed; read it again.`}\n`);

  console.log('Entry points and the production boot check');
  for (const [label, value] of Object.entries(view.entry)) console.log(`  ${label}: ${value}`);
  console.log(`  config/security.js (validateProductionEnv) names these switches: ${view.bootRule.length ? view.bootRule.join(', ') : 'none — a production task that says nothing about its role boots without complaint'}`);

  const on = view.rows.filter((row) => row.answers.missing).map((row) => row.name);
  const off = view.rows.filter((row) => !row.answers.missing).map((row) => row.name);
  const loose = view.rows
    .filter((row) => row.answers['"FALSE"'] || row.answers['" false "'])
    .map((row) => `${row.name}${row.answers['"FALSE"'] ? ' ("FALSE" leaves it on)' : ''}${row.answers['" false "'] ? ' (" false " leaves it on)' : ''}`);
  console.log(`\nON when the variable is missing:  ${on.join(', ') || 'none'}`);
  console.log(`OFF when the variable is missing: ${off.join(', ') || 'none'}`);
  console.log(`Not switched off by a mis-typed false: ${loose.join('; ') || 'none'}`);
  console.log(`"0" and "off" leave these ON: ${view.rows.filter((row) => row.answers['"0"'] && row.answers['"off"']).map((row) => row.name).join(', ') || 'none'}`);
};

const judgeHead = process.argv.includes('--head');
const view = survey(treeOf(judgeHead ? 'HEAD' : null));
print(view);

// The other tree, in one line each, for comparison.
if (!judgeHead) {
  const head = survey(treeOf('HEAD'));
  if (head.unreachable) {
    console.log('\n(git could not be reached: the last commit is not shown beside the working tree)');
  } else {
    console.log(`\nThe same question asked of ${head.tree.label} (what is committed):`);
    for (const row of head.rows) {
      const now = view.byName[row.name];
      const changed = now && now.answers.missing !== row.answers.missing;
      console.log(`  ${row.name.padEnd(31)} missing -> ${row.answers.missing ? 'ON ' : 'off'}   working tree: ${now ? (now.answers.missing ? 'ON ' : 'off') : '?  '}${changed ? '   <- changed, NOT committed' : ''}`);
    }
    if (head.workerOn || head.leaderOn) {
      console.log(`  => in ${head.tree.label} a process that is told nothing is ${[head.workerOn ? 'a job worker' : null, head.leaderOn ? 'a scheduler-leader candidate' : null].filter(Boolean).join(' and ')} and runs ${head.schedulersOn.length} of 6 data-writing schedulers; exception engine ${head.engineOn ? 'ON' : 'off'}.`);
    }
  }
}

console.log('');
if (!view.located) {
  process.exitCode = 1;
  console.log(`VERDICT ${LEAD}: NOT_REPRODUCED — the worker or leadership switch could not be located in the ${view.tree.label} (the code changed, or git could not be reached): read it again before trusting this.`);
} else if ((view.workerOn || view.leaderOn) && !view.roleDemanded) {
  process.exitCode = 2;
  if (view.engineOn) {
    console.log(`VERDICT ${LEAD}: CONFIRMED — in the ${view.tree.label}, with no variables set a process is a job worker, a scheduler-leader candidate, runs ${view.schedulersOn.length} schedulers and the exception engine, and the production boot check asks for none of them.`);
  } else {
    console.log(`VERDICT ${LEAD}: PARTLY_CONFIRMED — in the ${view.tree.label}, with no variables set a process is a job worker (${view.workerOn ? 'ON' : 'off'}), a scheduler-leader candidate (${view.leaderOn ? 'ON' : 'off'}) and runs ${view.schedulersOn.length} of 6 data-writing schedulers (billing, notification, daily-log, report and workflow act at once on every company), and the production boot check asks for none of them; the exception engine, however, is OFF unless EXCEPTIONS_ENGINE_ENABLED is exactly "true".`);
  }
} else {
  process.exitCode = 0;
  console.log(`VERDICT ${LEAD}: NOT_REPRODUCED — in the ${view.tree.label} a process that is told nothing starts no worker and no scheduler leadership${view.roleDemanded ? ' (the production boot check demands an explicit answer)' : ''}; run with --head to judge what is committed.`);
}
