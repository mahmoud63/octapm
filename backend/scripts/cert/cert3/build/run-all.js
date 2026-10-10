'use strict';

/**
 * CERT-3 deep population: runs the builders in plan order (OCTAPM_CERT3_PLAN.md
 * §3.2, §3.3 step 5), each as its own process, against the certification API.
 *
 *   087 (D1): 087-SCH, 087-IMP, 087-EV, 087-COM, 087-COM-B, 087-COM-C, 087-FLD,
 *             087-EXC, 087-HLT, 087-OTH, then 087-EXTRAS (the "Also in 087"
 *             list: permission templates, the party guest on 087-EXC, the QS
 *             with commercial notifications off, report definitions)
 *   052 (D2): 052-SCH-EV, 052-COM, 052-FLD
 *   006 (D3): 006-LITE
 *
 * A builder is build/<code in lower case>.js and calls lib.main('<code>', ...)
 * (lib.js). It exits 0 (built), 2 (incomplete: BLOCKED steps, each with its
 * register or HR id) or 1 (failed or setup error). The run goes on after a 2
 * and stops at the first 1 — or at a builder file that is not on disk: a run
 * that skips what it cannot find proves nothing. Every builder is resumable
 * (state in C:\Temp\octapm-cert\state\cert3\<code>.json), so after a stop the
 * same command resumes where it stopped, without duplicates.
 *
 * NOT here: the C087R proving lifecycle (WP-0 E7, scripts/cert/run-certified-
 * lifecycle.js with P21_STAMP=C087R) has its own runner and state.
 *
 * ── HOW TO LAUNCH (plan §3.3: after the restore of cert2c, the API start and
 *    the D-ID-1 proof; detached, with the watchdog) ─────────────────────────
 *
 * First launch after a restore (moves every listed build's old state aside
 * before the first builder runs, so no builder resumes a pre-restore state):
 *
 *   powershell -NoProfile -File C:\Temp\octapm-cert\start-detached.ps1 -Name cert3-build `
 *     -Script scripts/cert/run-with-watchdog.js -ScriptArgs "scripts/cert/cert3/build/run-all.js --fresh"
 *
 * Resume after a stop (never --fresh: it would throw the progress away):
 *
 *   powershell -NoProfile -File C:\Temp\octapm-cert\start-detached.ps1 -Name cert3-build -Append `
 *     -Script scripts/cert/run-with-watchdog.js -ScriptArgs "scripts/cert/cert3/build/run-all.js"
 *
 * start-detached.ps1 starts the process through WMI (it outlives the shell),
 * clears DATABASE_URL, runs from backend/, writes C:\Temp\octapm-cert\logs\
 * cert3-build.log and the PID to C:\Temp\octapm-cert\cert3-build.pid.
 * run-with-watchdog.js probes GET :5190/api/health/ready every 20 s, replaces a
 * dead API (start-api.ps1; the dead log is kept, the event goes to
 * logs\watchdog.jsonl) and runs this script with CERT_RETRY_AFTER_RESTART=1,
 * which every builder inherits: lib/api.js re-sends a request that got no
 * answer only once a new API is up, so nothing is made twice.
 *
 * Watch: Get-Content C:\Temp\octapm-cert\logs\cert3-build.log -Tail 40 -Wait
 *   per builder:  C:\Temp\octapm-cert\logs\cert3-build\<code>.log
 *   results:      C:\Temp\octapm-cert\results\cert3\build-<code>.json and build-summary.json
 *
 * Options: --fresh (above); --only=087-SCH,087-IMP; --from=087-COM; --list.
 * Debugging one builder is not done here: run it alone through the proof lock,
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-sch.js
 * (in process, one writer at a time). This runner refuses CERT_INPROCESS=1:
 * a whole build outlasts the proof lock's 45-minute abandonment rule. It runs
 * the BUILDS list only: never _smoke.js (the lib's self-test) nor a debug
 * harness (those live in C:\Temp\octapm-cert\scratch\build-debug, G9).
 *
 * Findings (lib b.finding, adjudication G2): every builder's persisted findings
 * are copied into build-summary.json (builds[].findings) and printed under the
 * builder in the closing table, beside its BLOCKED steps.
 *
 * Secrets (adjudication G8): each builder redacts its own output (lib.main
 * hooks stdout/stderr); this runner redacts again, line by line, everything it
 * tees into its logs and its own output, and the summary file, with the same
 * rules as lib.js (REDACTIONS below; keep the two in step).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const BACKEND = path.join(__dirname, '..', '..', '..', '..');
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STATE_DIR = path.join(WORK, 'state', 'cert3');
const RESULT_DIR = path.join(WORK, 'results', 'cert3');
const LOG_DIR = path.join(WORK, 'logs', 'cert3-build');
const LOCK = path.join(STATE_DIR, 'run-all.lock');

/** Plan order (§3.2; §7 row 2). The file is the code in lower case. */
const BUILDS = [
  { code: '087-SCH', company: '087', serves: 'WP-1, WP-2' },
  { code: '087-IMP', company: '087', serves: 'WP-1 import parity' },
  { code: '087-EV', company: '087', serves: 'WP-3' },
  { code: '087-COM', company: '087', serves: 'WP-4, WP-5, WP-6, WP-7 claims' },
  { code: '087-COM-B', company: '087', serves: 'WP-4, WP-5' },
  { code: '087-COM-C', company: '087', serves: 'WP-4 certify gate' },
  { code: '087-FLD', company: '087', serves: 'WP-7 weather, WP-8' },
  { code: '087-EXC', company: '087', serves: 'WP-9 controls' },
  { code: '087-HLT', company: '087', serves: 'WP-9 health' },
  { code: '087-OTH', company: '087', serves: 'WP-9 notifications' },
  { code: '087-EXTRAS', company: '087', serves: 'templates, party guest, opt-out, report definitions' },
  { code: '052-SCH-EV', company: '052', serves: 'WP-2, WP-3 (D2)' },
  { code: '052-COM', company: '052', serves: 'WP-4, WP-5 (D2)' },
  { code: '052-FLD', company: '052', serves: 'WP-7, WP-8 (D2)' },
  { code: '006-LITE', company: '006', serves: 'reduced lane (D3)' },
].map((b) => ({ ...b, file: `${b.code.toLowerCase()}.js` }));

// ── secrets never printed (G8): the rules of lib.js redact(), kept in step ──
const REDACTED = '<redacted>';
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const opaqueToken = (value) => value.length >= 32 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && !UUID_TEXT.test(value);
const keepUuid = (all, head, value) => (UUID_TEXT.test(value) ? all : `${head}${REDACTED}`);
const REDACTIONS = [
  [/(\/(?:rfqs?|bids?)\/)([A-Za-z0-9_~-]{12,})/gi, keepUuid],
  [/(\/(?:accept-invite|accept-invitation|invitations\/accept|invite|reset-password|password-reset|reset|verify-email|magic-link|sso\/complete)\/)([A-Za-z0-9_~.%-]{8,})/gi, keepUuid],
  [/([?&#;](?:[A-Za-z_]*token|ticket|code_verifier|verifier|nonce|sig|signature|secret|otp|api_?key|password)=)([^&#\s"'<>\\]+)/gi, `$1${REDACTED}`],
  [/(["']?[A-Za-z_]*(?:token|secret|password|ticket)["']?\s*[:=]\s*["']?)([^"'\s,;&}\]]{8,})/gi, (all, head, value) => (value === REDACTED || value === '(withheld)' ? all : `${head}${REDACTED}`)],
  [/([/=])([A-Za-z0-9_-]{32,})(?![A-Za-z0-9_-])/g, (all, head, value) => (opaqueToken(value) ? `${head}${REDACTED}` : all)],
  [/whsec_[A-Za-z0-9_-]{8,}/g, REDACTED],
  // harness.scrub's two: API keys and JWTs
  [/octapm_[A-Za-z0-9_-]{8,}/g, '(withheld)'],
  [/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '(withheld)'],
];
const redact = (value) => {
  if (value === null || value === undefined) return value;
  let text = String(value);
  // lib.js scrubs API keys and JWTs first; here they are the last two rules, which give the same text.
  for (const [pattern, replacement] of [...REDACTIONS.slice(-2), ...REDACTIONS.slice(0, -2)]) text = text.replace(pattern, replacement);
  const password = process.env.CERT_PASSWORD;
  if (password && password.length >= 6 && text.includes(password)) text = text.split(password).join(REDACTED);
  return text;
};
const redactDeep = (value, depth = 0) => {
  if (typeof value === 'string') return redact(value);
  if (depth > 40 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, depth + 1)]));
};

/** A writer that redacts whole lines (a token cut across two chunks is still caught); end() flushes the rest. */
const lineRedactor = (write) => {
  let pending = '';
  const decoder = new StringDecoder('utf8'); // a character split across two chunks stays whole
  return {
    push(chunk) {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      const cut = pending.lastIndexOf('\n');
      if (cut < 0) {
        if (pending.length > 64 * 1024) { // a very long line: written as it is, redacted
          write(redact(pending));
          pending = '';
        }
        return;
      }
      write(redact(pending.slice(0, cut + 1)));
      pending = pending.slice(cut + 1);
    },
    end() {
      pending += decoder.end();
      if (pending) write(redact(pending));
      pending = '';
    },
  };
};

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? null;
const flag = (name) => process.argv.includes(`--${name}`);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const say = (text) => console.log(redact(`[run-all ${new Date().toISOString()}] ${text}`));

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const takeLock = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = fs.openSync(LOCK, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      fs.closeSync(fd);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder = null;
      try {
        holder = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      } catch {
        /* unreadable: abandoned */
      }
      if (holder?.pid && alive(holder.pid)) throw new Error(`${LOCK} is held by PID ${holder.pid} (since ${holder.at}): a build is already running`);
      fs.rmSync(LOCK, { force: true });
    }
  }
  throw new Error(`could not take ${LOCK}`);
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** Runs one builder, its output to this log and to logs/cert3-build/<code>.log; resolves to its exit code. */
const runBuilder = (build) =>
  new Promise((resolve) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const log = fs.createWriteStream(path.join(LOG_DIR, `${build.code}.log`), { flags: 'a' });
    log.write(`\n===== ${new Date().toISOString()} ${build.code} (PID ${process.pid} run-all) =====\n`);
    const child = spawn(process.execPath, [path.join(__dirname, build.file)], { cwd: BACKEND, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    // Redacted again here, whole lines at a time (G8): the builder's own hook is the first line of defence.
    const tees = [];
    const tee = (stream, out) => {
      const lines = lineRedactor((text) => {
        out.write(text);
        log.write(text);
      });
      tees.push(lines);
      stream.on('data', (chunk) => lines.push(chunk));
    };
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on('error', (error) => {
      for (const t of tees) t.end();
      log.end(redact(`spawn failed: ${error.message}\n`));
      resolve(1);
    });
    child.on('close', (code, signal) => {
      for (const t of tees) t.end();
      log.end(`===== exit ${code}${signal ? ` (signal ${signal})` : ''} =====\n`);
      resolve(code === null ? 1 : code);
    });
  });

const main = async () => {
  if (flag('list')) {
    for (const b of BUILDS) console.log(`${b.code.padEnd(11)} ${b.file.padEnd(15)} ${fs.existsSync(path.join(__dirname, b.file)) ? 'on disk ' : 'MISSING '} ${b.serves}`);
    return 0;
  }
  if (process.env.CERT_INPROCESS === '1') {
    console.error('run-all.js does not run in process: a whole build outlasts the proof lock. Run it detached with the watchdog (see the header); debug one builder through run-locked.js.');
    return 1;
  }
  if (!process.env.CERT_PASSWORD) {
    // The builders load backend/.env themselves; this only checks that it is there.
    require('dotenv').config({ path: path.join(BACKEND, '.env') }); // eslint-disable-line global-require
    if (!process.env.CERT_PASSWORD) {
      console.error('CERT_PASSWORD is not set (backend/.env).');
      return 1;
    }
  }

  let list = BUILDS;
  const only = arg('only');
  const from = arg('from');
  if (only) {
    const wanted = only.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    const unknown = wanted.filter((c) => !BUILDS.some((b) => b.code === c));
    if (unknown.length) {
      console.error(`--only names builds that are not in the plan list: ${unknown.join(', ')}`);
      return 1;
    }
    list = BUILDS.filter((b) => wanted.includes(b.code));
  }
  if (from) {
    const at = list.findIndex((b) => b.code === from.toUpperCase());
    if (at < 0) {
      console.error(`--from=${from} is not in the list`);
      return 1;
    }
    list = list.slice(at);
  }

  takeLock();
  const started = new Date();
  const summary = { startedAt: started.toISOString(), api: process.env.CERT_API_BASE || 'http://localhost:5190', retryAfterRestart: process.env.CERT_RETRY_AFTER_RESTART === '1', fresh: flag('fresh'), builds: [] };
  try {
    say(`${list.length} build(s): ${list.map((b) => b.code).join(', ')}${flag('fresh') ? ' (fresh)' : ''}; API ${summary.api}; watchdog retry ${summary.retryAfterRestart ? 'on' : 'off'}`);

    if (flag('fresh')) {
      // Every listed build's state goes aside BEFORE the first builder runs: a
      // resumed launch (no --fresh) must never find a pre-restore state of a
      // builder this launch had not reached yet.
      for (const b of list) {
        const file = path.join(STATE_DIR, `${b.code}.json`);
        if (fs.existsSync(file)) {
          const target = path.join(STATE_DIR, `${b.code}.prev-${stamp()}.json`);
          fs.renameSync(file, target);
          say(`${b.code}: previous state moved to ${target}`);
        }
      }
    }

    let stopped = null;
    for (const b of list) {
      const t0 = Date.now();
      if (!fs.existsSync(path.join(__dirname, b.file))) {
        say(`${b.code}: ${b.file} is not on disk; the population cannot be built without it. Stopping.`);
        summary.builds.push({ code: b.code, exit: 1, verdict: 'MISSING', seconds: 0 });
        stopped = b.code;
        break;
      }
      say(`${b.code}: starting ${b.file} (${b.serves})`);
      const exit = await runBuilder(b);
      const result = readJson(path.join(RESULT_DIR, `build-${b.code}.json`));
      const fresh = result && Date.parse(result.finishedAt) >= t0 - 1000;
      const row = {
        code: b.code,
        exit,
        verdict: fresh ? result.verdict : exit === 0 ? 'BUILT (no result file)' : 'FAILED (no result file)',
        seconds: Math.round((Date.now() - t0) / 1000),
        steps: fresh ? {
          done: result.steps.filter((s) => s.status === 'done').length,
          resumed: result.steps.filter((s) => s.status === 'resumed').length,
          blocked: result.steps.filter((s) => s.status === 'blocked').length,
        } : null,
        blocked: fresh ? result.blocked.map((x) => `${x.name} ${x.ref}${x.via ? ` (via ${x.via})` : ''}`) : [],
        // G2: persisted findings (every run's, from the builder's state), as the builder's results carry them.
        findings: fresh && Array.isArray(result.findings) ? result.findings.map((f) => `${f.ref}${f.step ? ` (${f.step}${f.stepStatus && f.stepStatus !== 'done' ? `, step ${f.stepStatus}` : ''})` : ''}: ${String(f.text).slice(0, 600)}`) : [],
        notes: fresh && Array.isArray(result.notes) ? result.notes.length : 0,
        failure: fresh && result.failure ? `${result.failure.step ? `${result.failure.step}: ` : ''}${String(result.failure.message).slice(0, 400)}` : null,
        projectId: fresh ? result.projectId : null,
      };
      // A builder that exits 0 or 2 without writing its result file did not go through lib.main.
      if ((exit === 0 || exit === 2) && !fresh) row.exit = 1;
      summary.builds.push(row);
      say(`${b.code}: exit ${row.exit} ${row.verdict} in ${row.seconds} s${row.blocked.length ? `; BLOCKED ${row.blocked.join('; ')}` : ''}${row.findings.length ? `; ${row.findings.length} finding(s)` : ''}${row.failure ? `; ${row.failure}` : ''}`);
      if (row.exit !== 0 && row.exit !== 2) {
        stopped = b.code;
        say(`stopping at ${b.code} (exit ${row.exit}); fix it and launch again without --fresh to resume`);
        break;
      }
    }

    summary.finishedAt = new Date().toISOString();
    summary.stoppedAt = stopped;
    summary.notRun = stopped ? list.slice(list.findIndex((b) => b.code === stopped) + 1).map((b) => b.code) : [];
    const failed = summary.builds.some((r) => r.exit !== 0 && r.exit !== 2);
    const incomplete = summary.builds.some((r) => r.exit === 2);
    summary.exitCode = failed ? 1 : incomplete ? 2 : 0;
    summary.verdict = failed ? 'FAILED' : incomplete ? 'INCOMPLETE' : 'BUILT';
    summary.findings = summary.builds.reduce((n, r) => n + (r.findings || []).length, 0);
    fs.mkdirSync(RESULT_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULT_DIR, 'build-summary.json'), JSON.stringify(redactDeep(summary), null, 1));

    const print = (text) => console.log(redact(text));
    print('\n──────── CERT-3 deep population ────────');
    for (const r of summary.builds) {
      const steps = r.steps ? `steps ${r.steps.done} done, ${r.steps.resumed} resumed, ${r.steps.blocked} blocked` : '';
      print(`${r.code.padEnd(11)} exit ${r.exit}  ${String(r.verdict).padEnd(11)} ${String(r.seconds).padStart(5)} s  ${steps}${r.findings?.length ? `, ${r.findings.length} finding(s)` : ''}`);
      for (const x of r.blocked || []) print(`${' '.repeat(13)}BLOCKED ${x}`);
      for (const f of r.findings || []) print(`${' '.repeat(13)}FINDING ${f}`);
      if (r.failure) print(`${' '.repeat(13)}${r.failure}`);
    }
    if (summary.notRun.length) print(`not run: ${summary.notRun.join(', ')}`);
    print(`${summary.verdict}, exit ${summary.exitCode}; ${summary.findings} finding(s); ${path.join(RESULT_DIR, 'build-summary.json')}`);
    return summary.exitCode;
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
};

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(redact(String(error?.stack || error)));
      process.exit(1);
    });
}

module.exports = { BUILDS, redact, redactDeep, lineRedactor };
