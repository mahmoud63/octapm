'use strict';

/**
 * Runs one certification script while watching the certification API, and
 * replaces the API when it stops reaching its database.
 *
 *   node scripts/cert/run-with-watchdog.js scripts/cert/load-records.js --concurrency=8
 *
 * Why: on a Windows workstation short of memory the API's database engine can
 * die (tokio I/O driver panic, OS error 1450 "Insufficient system resources")
 * while the process lives on. From then on every database request hangs for
 * ever. A long load would sit dead for hours, and a driver cut off half way
 * would leave half its records behind for the resumed run to duplicate.
 *
 * Every PROBE_MS the watchdog asks GET /api/health/ready (SELECT 1 behind a
 * 2 s timeout). After FAILURES_BEFORE_RESTART consecutive failures it:
 *   - keeps the dead API's log (api.log -> api-<time>.log), the evidence;
 *   - stops that process — only after checking that it is the one listening
 *     on the certification port and that it runs src/index.js;
 *   - starts a fresh API with C:/Temp/octapm-cert/start-api.ps1, which writes
 *     the new PID to C:/Temp/octapm-cert/api.pid;
 *   - records the event in logs/watchdog.jsonl.
 * The child runs with CERT_RETRY_AFTER_RESTART=1, so lib/api.js re-sends a
 * request that got no answer once the API has been replaced: the old process
 * is gone, so its unfinished transactions were rolled back with its
 * connections and the re-sent request cannot duplicate anything.
 *
 * The run ends when the child ends; its exit code is this script's.
 */

const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const PORT = Number(process.env.CERT_API_PORT || 5190);
const READY = `http://127.0.0.1:${PORT}/api/health/ready`;
const PID_FILE = path.join(WORK, 'api.pid');
const LOGS = path.join(WORK, 'logs');
const EVENTS = path.join(LOGS, 'watchdog.jsonl');
const START_API = path.join(WORK, 'start-api.ps1');
const PROBE_MS = Number(process.env.WATCHDOG_PROBE_MS || 20_000);
const FAILURES_BEFORE_RESTART = Number(process.env.WATCHDOG_FAILURES || 3);
const MAX_RESTARTS = Number(process.env.WATCHDOG_MAX_RESTARTS || 20);

const stamp = () => new Date().toISOString();
const say = (message) => console.error(`[watchdog ${stamp()}] ${message}`);
const record = (event) => fs.appendFileSync(EVENTS, `${JSON.stringify({ at: stamp(), ...event })}\n`);

const ready = async () => {
  try {
    const res = await fetch(READY, { signal: AbortSignal.timeout(5_000) });
    return res.status === 200;
  } catch {
    return false;
  }
};

const powershell = (command) =>
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 120_000 });

/** The PID listening on the certification port, and its command line. */
const listener = () => {
  const out = powershell(
    `$c = Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `if ($c) { $p = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $c.OwningProcess); "$($c.OwningProcess)|$($p.CommandLine)" }`,
  ).stdout.trim();
  if (!out) return null;
  const [pid, ...rest] = out.split('|');
  return { pid: Number(pid), commandLine: rest.join('|') };
};

const tail = (file, lines = 12) => {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
};

let restarts = 0;
const restartApi = async (reason) => {
  const old = listener();
  const recordedPid = fs.existsSync(PID_FILE) ? Number(fs.readFileSync(PID_FILE, 'utf8').trim()) : null;
  if (old && !/src[\\/]index\.js/.test(old.commandLine)) {
    say(`port ${PORT} is held by PID ${old.pid} which is not the certification API (${old.commandLine.slice(0, 120)}); not touching it`);
    record({ event: 'refused', reason: 'foreign listener', pid: old.pid });
    return false;
  }
  const apiLog = path.join(LOGS, 'api.log');
  const kept = path.join(LOGS, `api-${stamp().replace(/[:.]/g, '-')}.log`);
  const evidence = tail(apiLog, 40).split(/\r?\n/).filter((line) => /panick|1450|Insufficient system resources|FATAL|out of memory/i.test(line));
  if (old) {
    try {
      process.kill(old.pid);
    } catch (error) {
      say(`could not stop PID ${old.pid}: ${error.message}`);
    }
    for (let i = 0; i < 40 && listener(); i += 1) await new Promise((r) => setTimeout(r, 500));
  }
  try {
    fs.renameSync(apiLog, kept);
  } catch {
    /* no log to keep */
  }
  const started = spawnSync('powershell', ['-NoProfile', '-File', START_API, '-Name', 'api', '-Port', String(PORT)], { encoding: 'utf8', timeout: 120_000 });
  const fresh = listener();
  let up = false;
  for (let i = 0; i < 30 && !up; i += 1) {
    up = await ready();
    if (!up) await new Promise((r) => setTimeout(r, 2_000));
  }
  restarts += 1;
  record({ event: 'restart', reason, oldPid: old?.pid ?? null, recordedPid, newPid: fresh?.pid ?? null, ready: up, keptLog: kept, evidence, start: started.stdout.trim().slice(0, 300) });
  say(`API replaced (${reason}): PID ${old?.pid ?? '-'} -> ${fresh?.pid ?? '-'}, ready=${up}; dead log kept at ${kept}`);
  return up;
};

const main = async () => {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('usage: node scripts/cert/run-with-watchdog.js <script> [args...]');
    process.exit(64);
  }
  fs.mkdirSync(LOGS, { recursive: true });
  if (!(await ready())) {
    say('the API is not ready before the run; replacing it first');
    if (!(await restartApi('not ready at start'))) process.exit(1);
  }
  record({ event: 'start', command: args.join(' ') });

  const child = spawn(process.execPath, args, {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, CERT_RETRY_AFTER_RESTART: '1' },
    stdio: 'inherit',
  });

  let failures = 0;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      if (await ready()) {
        failures = 0;
      } else {
        failures += 1;
        say(`readiness failed (${failures}/${FAILURES_BEFORE_RESTART})`);
        if (failures >= FAILURES_BEFORE_RESTART) {
          if (restarts >= MAX_RESTARTS) {
            say(`${MAX_RESTARTS} restarts already; stopping the run`);
            record({ event: 'gave up', restarts });
            child.kill();
          } else {
            await restartApi(`${failures} consecutive readiness failures`);
          }
          failures = 0;
        }
      }
    } finally {
      busy = false;
    }
  }, PROBE_MS);

  child.on('exit', (code, signal) => {
    clearInterval(timer);
    record({ event: 'end', code, signal, restarts });
    say(`child ended (code ${code}${signal ? `, signal ${signal}` : ''}) after ${restarts} API restart(s)`);
    process.exit(code ?? 1);
  });
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
