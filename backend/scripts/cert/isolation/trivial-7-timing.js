'use strict';

/**
 * Timed requests for the trivial-7 proof (CERT-2), in process, against the
 * code of the backend tree named on the command line — the working tree, or a
 * snapshot of an earlier commit (the proof compares the two in one run).
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/trivial-7-timing.js --tree=<backend dir> [--reps=7] [--long=100000,1000000] [--attacker=067]
 *
 * Prints one line "TIMING {json}" per measure. Every record is made fresh,
 * through the API, by company 067's own planner, PM and buyer:
 *
 *   conversion        the tree's cpm.service workingDayToDate, five-day week:
 *                     2,000 offsets 0-119 (a programme's), and one each of
 *                     36,500 and 1,000,000 working days
 *   activity-patch    PATCH /projects/{L}/activities/{id} duration d on a
 *                     fresh activity of the light project 067-09 (five
 *                     activities: the PATCH's critical-path pass is the
 *                     project's): for 10 and 36,500 the median of --reps
 *                     PATCHes and of --reps GETs of it; each --long once; the
 *                     activity is put back to 3 days and deleted after
 *   activities-list   GET /projects/{L}/activities, median of --reps
 *   health            GET /projects/{P}/health on 067-02, median of --reps
 *   daily-report      POST /projects/{P}/daily-reports in the web progress
 *                     tab's shape, 24 equipment hours on its one line (draft),
 *                     median of --reps; and once at 30 hours (the status)
 *   project-patch     PATCH /projects/{P} { currency: 'usd' }, median of --reps
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const TREE = path.resolve(arg('tree', path.join(__dirname, '..', '..', '..')));
const REPS = Math.max(1, Number(arg('reps', '7')));
const LONG = String(arg('long', '') || '').split(',').filter(Boolean).map(Number);
const ATTACKER = arg('attacker', '067');
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `T7T-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
if (process.env.CERT_INPROCESS !== '1') throw new Error('trivial-7-timing runs in process only (CERT_INPROCESS=1)');
process.env.REQUEST_LOG_FORMAT = process.env.REQUEST_LOG_FORMAT || 'off';

// The certification environment is this checkout's (a snapshot of an earlier
// commit has no .env of its own); the tree's own client, in process, loads
// <tree>/src/app.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
// eslint-disable-next-line import/no-dynamic-require
const { as } = require(path.join(TREE, 'scripts', 'cert', 'lib', 'api.js'));

const print = console.log.bind(console);
console.log = (...args) => {
  if (String(args[0] || '').startsWith('[email:local]')) return;
  print(...args);
};
// The product's error log for an expected 500 at the baseline (an expired transaction) is noise here.
console.error = () => {};
const emit = (row) => print(`TIMING ${JSON.stringify({ tree: TREE, stamp: STAMP, ...row })}`);
const said = (res) => `${res?.status} ${res?.body?.error?.code || ''}`.trim();
const ms = (start) => Math.round((Number(process.hrtime.bigint() - start) / 1e6) * 10) / 10;
const timed = async (fn) => {
  const started = process.hrtime.bigint();
  const res = await fn();
  return { res, ms: ms(started) };
};
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const dayOf = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const main = async () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${ATTACKER}.json`), 'utf8'));
  const L = inventory.projects[`${ATTACKER}-09`];
  const P = inventory.projects[`${ATTACKER}-02`];
  if (!L || !P) throw new Error(`company ${ATTACKER} needs its projects -02 and -09`);
  const domain = `c${ATTACKER}.octapm-cert.test`;
  const planner = as(`planner@${domain}`);
  const pm = as(`pm@${domain}`);

  // Warm the code paths, the sign-ins and the pool.
  await planner.send('GET', `/projects/${L.id}/activities`);
  await pm.send('GET', `/projects/${P.id}/health`);
  // The site engineer, as the activities name their engineer (the proofs' own choice).
  const me = (await as(`site@${domain}`).send('GET', '/auth/me')).body?.data;
  const engineer = me?.id || me?.user?.id;
  if (!engineer) throw new Error('the site engineer of the company was not read');

  // The tree's own conversion, required after the first request: the request
  // set the certification database for the tree's client.
  // eslint-disable-next-line import/no-dynamic-require
  const cpm = require(path.join(TREE, 'src', 'services', 'cpm.service.js'));
  const monday = new Date('2026-01-05T00:00:00.000Z');
  const loopStart = process.hrtime.bigint();
  for (let i = 0; i < 2000; i += 1) cpm.workingDayToDate(monday, i % 120, { calendarId: 'five_day' });
  const loopMs = ms(loopStart);
  const one = (offset) => {
    const started = process.hrtime.bigint();
    const date = cpm.workingDayToDate(monday, offset, { calendarId: 'five_day' });
    return { ms: ms(started), date: date ? date.toISOString().slice(0, 10) : null };
  };
  emit({ measure: 'conversion', offsets0to119Each_us: Math.round((loopMs * 1000) / 2000), d36500: one(36_500), d1000000: one(1_000_000) });

  // An activity of the light project, its duration patched.
  const made = await planner.send('POST', `/projects/${L.id}/activities`, { name: `${STAMP} timing`, duration: 3, engineerIds: [engineer] });
  const activityId = made.body?.data?.id;
  if (!activityId) throw new Error(`timing activity: ${said(made)} ${JSON.stringify(made.body?.error || {})}`);
  // A programme's durations and the longest the routes take: --reps PATCHes each (alternating
  // d and d - 1, so every PATCH changes the activity), the median; then --reps reads at d.
  for (const duration of [10, 36_500]) {
    const patches = [];
    let last = null;
    for (let i = 0; i < REPS; i += 1) {
      const value = i % 2 ? duration - 1 : duration;
      const r = await timed(() => planner.send('PATCH', `/projects/${L.id}/activities/${activityId}`, { duration: value }));
      patches.push(r.ms);
      last = r.res;
    }
    if (REPS % 2 === 0) await planner.send('PATCH', `/projects/${L.id}/activities/${activityId}`, { duration });
    const reads = [];
    let read = null;
    for (let i = 0; i < REPS; i += 1) {
      const r = await timed(() => planner.send('GET', `/projects/${L.id}/activities/${activityId}`));
      reads.push(r.ms);
      read = r.res;
    }
    emit({ measure: 'activity-patch', duration, status: last.status, said: said(last), ms: median(patches), all: patches, getMs: median(reads), getAll: reads, getStatus: read.status, lateFinishDate: read.body?.data?.lateFinishDate || null });
  }
  // The long ones, once each (at the baseline a million days holds the PATCH for ~8 s).
  for (const duration of LONG) {
    const patch = await timed(() => planner.send('PATCH', `/projects/${L.id}/activities/${activityId}`, { duration }));
    const read = await timed(() => planner.send('GET', `/projects/${L.id}/activities/${activityId}`));
    emit({ measure: 'activity-patch', duration, status: patch.res.status, said: said(patch.res), ms: patch.ms, field: (patch.res.body?.error?.details || []).map((d) => d.field).join(','), getMs: read.ms, getStatus: read.res.status, lateFinishDate: read.res.body?.data?.lateFinishDate || null });
  }
  const back = await planner.send('PATCH', `/projects/${L.id}/activities/${activityId}`, { duration: 3 });
  const gone = await planner.send('DELETE', `/projects/${L.id}/activities/${activityId}`);
  emit({ measure: 'activity-cleanup', restored: said(back), deleted: said(gone) });

  const list = [];
  for (let i = 0; i < REPS; i += 1) list.push((await timed(() => planner.send('GET', `/projects/${L.id}/activities`))).ms);
  emit({ measure: 'activities-list', ms: median(list), all: list });

  const health = [];
  let healthStatus = null;
  for (let i = 0; i < REPS; i += 1) {
    const r = await timed(() => pm.send('GET', `/projects/${P.id}/health`));
    healthStatus = r.res.status;
    health.push(r.ms);
  }
  emit({ measure: 'health', ms: median(health), all: health, status: healthStatus });

  const reportActivity = (await planner.send('POST', `/projects/${P.id}/activities`, { name: `${STAMP} reports`, duration: 3, engineerIds: [engineer] })).body?.data?.id;
  const salt = parseInt(STAMP.slice(-4), 16);
  const reportDate = (i) => new Date(Date.UTC(2021, 0, 1) + ((salt + i * 11) % 1400) * 86_400_000).toISOString().slice(0, 10);
  const web = (hours, i) => ({ activityId: reportActivity, date: reportDate(i), pctProgress: 5, manpower: [{ trade: 'crew', workers: 2, hours: 8 }], equipment: [{ name: 'site equipment', hours }], materials: [], photos: [], notes: `${STAMP} web ${hours}`, status: 'draft' });
  const reports = [];
  let reportStatus = null;
  for (let i = 0; i < REPS; i += 1) {
    const r = await timed(() => pm.send('POST', `/projects/${P.id}/daily-reports`, web(24, i)));
    reportStatus = r.res.status;
    reports.push(r.ms);
  }
  const thirty = await pm.send('POST', `/projects/${P.id}/daily-reports`, web(30, REPS + 1));
  emit({ measure: 'daily-report', ms: median(reports), all: reports, status: reportStatus, thirtyHours: said(thirty) });

  const patches = [];
  let patchStatus = null;
  for (let i = 0; i < REPS; i += 1) {
    const r = await timed(() => pm.send('PATCH', `/projects/${P.id}`, { currency: 'usd' }));
    patchStatus = r.res.status;
    patches.push(r.ms);
  }
  const numeric = await pm.send('PATCH', `/projects/${P.id}`, { currency: 5 });
  emit({ measure: 'project-patch', ms: median(patches), all: patches, status: patchStatus, numericCurrency: said(numeric) });
  emit({ measure: 'done', due: dayOf(0) });
};

main()
  .then(() => setTimeout(() => process.exit(0), 300))
  .catch((error) => {
    print(`TIMING ${JSON.stringify({ tree: TREE, measure: 'error', message: String(error?.stack || error).slice(0, 1500) })}`);
    setTimeout(() => process.exit(1), 300);
  });
