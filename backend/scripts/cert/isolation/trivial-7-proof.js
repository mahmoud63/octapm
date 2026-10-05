'use strict';

/**
 * The CERT-2 proof of group trivial-7 (the last fix round before the final
 * run): a legitimate web flow round 6 refused, and five small defects.
 *
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/trivial-7-proof.js [attacker=067] [victim=068]
 *   … [--only=<section regex, e.g. "^(1|2)">] [--no-fingerprint] [--no-timing]   (for mutation runs; a full run takes none)
 *
 * What each did before the fix (reproduced in process, company 067):
 *   1. daily-reports.js and site-diaries.js bounded an equipment line's hours
 *      at a day (0-24, round 6), but the web progress tab sends the day's
 *      equipment hours as ONE line ({ name: 'site equipment', hours }, no
 *      client maximum): 30 and 48 hours answered 400 (201 at f16c14f). A line
 *      now takes up to 744 hours (24 x 31; utils/site-record-equipment).
 *   2. A line's own rate and rateType were stored unchecked and preferred at
 *      approval to the equipment's (equipment.service: row.rate ?? rate): rate
 *      -500 was stored (201) and its approval posted a cost of -1,000.00; 1e30
 *      was stored and its approval answered 400 for ever (the cost cannot be
 *      written); rateType 'weekly' was stored. Now 400 naming the field.
 *   3. A site diary's weatherJson (read as weatherDetails when that is absent)
 *      took only isObject(): temperatureC [5] was stored as 5, [] as 0, 1e300
 *      as 1e300, rainfallMm 1e300 likewise (201). Now 400 naming the field.
 *   4. PATCH /projects/{id} with a currency that is not a text (5, ["usd"],
 *      {"a":1}, true, null) answered 500 'value.toUpperCase is not a function'
 *      (the sanitizer ran after the failed isString). Now 400 naming currency;
 *      a choice (contractType, projectCalendar) was sanitized before any check
 *      (['epc'] stored as 'epc') and now stops the same way.
 *   5. An activity's duration and day offsets were taken up to INT4_MAX and
 *      converted to dates one day at a time, on every read and four times per
 *      activity in a PATCH's critical-path pass: PATCH duration 1,000,000
 *      answered 500 after 8 s (transaction expired), 100,000 took 1 s, and
 *      past ~71 million days the conversion never ended. They are bounded at
 *      36,500 days (lags either way, the predecessors text's too), the
 *      conversion works in whole weeks and ends on any input, and a schedule
 *      import (XER, P6 XML, MSP XML, xlsx) refuses a duration, float or lag
 *      past the bound (400 SCHEDULE_FIGURE_OUT_OF_RANGE, nothing staged).
 *   6. GET /projects/{id}/health read a material's order lines without their
 *      order: a material on an order since cancelled kept that order's promise
 *      (and its "delivery after need" risk) in the supply-chain top risks.
 *   7. (bodies-4-proof.js: its expectation is updated and it is run on its own.)
 *
 * PERF: the legitimate requests the fixes touch — PATCH and GET of an
 * activity, the activity list, the project health, a web daily report, a
 * project PATCH — timed in process against the working tree and against the
 * baseline commit f16c14f (extracted read-only with git archive to
 * C:/Temp/trivial-7-head), alternately, twice each (trivial-7-timing.js): the
 * working tree's median within the baseline's x 1.25 + 30 ms.
 *
 * Every REFUSED check against company 068 is GATED on company 067's own
 * request on the same kind of record being accepted. No answer may be a 5xx
 * or carry anything of company 068, and 068's data must not change in any
 * table (state fingerprint). Re-runnable: every record is made fresh, every
 * request carries a fresh stamp. Exit 0 when every check holds, 2 otherwise.
 */

process.env.REQUEST_LOG_FORMAT = process.env.REQUEST_LOG_FORMAT || 'off';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const XLSX = require('@e965/xlsx');
const api = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const ATTACKER = positional[0] || '067';
const VICTIM = positional[1] || '068';
const ONLY = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7) || null;
const FINGERPRINT = !process.argv.includes('--no-fingerprint');
const TIMING = !process.argv.includes('--no-timing');
const GROUP = 'trivial-7';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `T7-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const BASELINE = process.env.CERT_TRIVIAL7_BASELINE || 'f16c14f';
const BASELINE_DIR = process.env.CERT_TRIVIAL7_BASELINE_DIR || 'C:/Temp/trivial-7-head';
const BACKEND = path.resolve(__dirname, '..', '..', '..');
const WORKTREE = path.resolve(BACKEND, '..');
const DAYS_MAX = 36_500;
const MONEY_FIGURE_MAX = 9999999999999998;

const results = [];
const answers = [];
let section = 'setup';
const check = (name, ok, detail = '') => {
  results.push({ section, name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n        ${detail}` : ''}`);
};
const firstLine = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
const said = (res) => `${res?.status} ${res?.body?.error?.code || ''} ${firstLine(res?.body?.error?.message).slice(0, 140)}${res?.body?.error?.code === 'VALIDATION_ERROR' && Array.isArray(res.body.error.details) ? ` [${res.body.error.details.map((d) => d.field).join(', ')}]` : ''}`.trim();
const ok2xx = (res) => Boolean(res) && res.status >= 200 && res.status < 300;
const is4xx = (res) => Boolean(res) && res.status >= 400 && res.status < 500;
const invalidInput = (res) => res?.status === 400 && res.body?.error?.code === 'VALIDATION_ERROR';
const fieldsNamed = (res) => (invalidInput(res) ? (res.body.error.details || []).map((d) => d.field) : []);
const refusedOn = (res, field) => invalidInput(res) && fieldsNamed(res).includes(field);
const gateNote = (gate) => (ok2xx(gate) ? '' : ` [NOT GATED: the own request answered ${gate ? said(gate) : 'nothing'}]`);
const nowhere = () => crypto.randomUUID();
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const msSince = (start) => Number(process.hrtime.bigint() - start) / 1e6;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
/** The same refusal, word for word: status, code and message. */
const sameAnswer = (a, b) => Boolean(a) && Boolean(b) && a.status === b.status && (a.body?.error?.code || '') === (b.body?.error?.code || '') && (a.body?.error?.message || '') === (b.body?.error?.message || '');

// The product's local e-mail transport writes to the console in process; keep it out of the output.
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) return;
  print(...args);
};

/** The baseline commit's backend, extracted read-only (git archive), with this checkout's node_modules. */
const ensureBaseline = () => {
  const marker = path.join(BASELINE_DIR, 'BASELINE');
  const sha = execFileSync('git', ['rev-parse', BASELINE], { cwd: WORKTREE, encoding: 'utf8' }).trim();
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === sha && fs.existsSync(path.join(BASELINE_DIR, 'backend', 'src', 'app.js'))) return { sha, made: false };
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  const tar = execFileSync('git', ['archive', '--format=tar', sha, 'backend/src', 'backend/scripts/cert/lib', 'backend/package.json', 'shared'], { cwd: WORKTREE, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', BASELINE_DIR], { input: tar });
  for (const [link, target] of [[path.join(BASELINE_DIR, 'node_modules'), path.join(WORKTREE, 'node_modules')], [path.join(BASELINE_DIR, 'backend', 'node_modules'), path.join(BACKEND, 'node_modules')]]) {
    if (!fs.existsSync(link)) fs.symlinkSync(fs.realpathSync(target), link, 'junction');
  }
  fs.writeFileSync(marker, `${sha}\n`);
  return { sha, made: true };
};

/** One child process timing the requests against one backend tree (trivial-7-timing.js). */
const timeTree = (tree, { long = '' } = {}) =>
  new Promise((resolve) => {
    const env = { ...process.env, CERT_INPROCESS: '1' };
    delete env.DATABASE_URL;
    const child = spawn(process.execPath, [path.join(__dirname, 'trivial-7-timing.js'), `--tree=${tree}`, '--reps=7', `--long=${long}`, `--attacker=${ATTACKER}`], { cwd: BACKEND, env });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => {
      const rows = out.split(/\r?\n/).filter((line) => line.startsWith('TIMING ')).map((line) => JSON.parse(line.slice(7)));
      resolve({ code, rows, tail: rows.some((r) => r.measure === 'done') ? '' : out.slice(-1500) });
    });
  });

/** A small P6 XER file: tasks [id, code, hours] in a chain, lags in hours. */
const xerFile = (tasks, lagHours = 0) => [
  'ERMHDR\t19.12',
  '%T\tPROJWBS',
  '%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num',
  `%R\tW1\t\t${STAMP}\tTrivial-7 proof ${STAMP}\t1`,
  '%T\tTASK',
  '%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct',
  ...tasks.map(([id, code, hours]) => `%R\t${id}\t${code}\t${code} ${STAMP}\tW1\t${hours}\t${hours}\t2026-01-05 08:00\t2026-01-09 17:00\t2026-01-05 08:00\t2026-01-09 17:00\t0\t0`),
  '%T\tTASKPRED',
  '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
  ...tasks.slice(1).map(([id], i) => `%R\tP${i + 1}\t${id}\t${tasks[i][0]}\tPR_FS\t${lagHours}`),
  '%E',
  '',
].join('\n');
const xlsxFile = (rows) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['activity_code', 'name', 'duration_days', 'predecessors'], ...rows]), 'Schedule');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
};

const main = async () => {
  console.log(`${GROUP} proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: a running API does not run the working tree\'s code'}${ONLY ? `, only /${ONLY}/` : ''}${FINGERPRINT ? '' : ', no fingerprint'}${TIMING ? '' : ', no timing'}\n`);
  const runs = () => !ONLY || new RegExp(ONLY).test(section);
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const atk = inventory(ATTACKER);
  const P = atk.projects[`${ATTACKER}-02`];
  const L = atk.projects[`${ATTACKER}-09`];
  const V = Object.values(inventory(VICTIM).projects).find((p) => p.depth === 'standard' && p.refs?.activities);
  if (!P || !L || !V) throw new Error(`company ${ATTACKER} needs its projects -02 and -09, company ${VICTIM} a standard project`);
  const PP = `/projects/${P.id}`;
  const LP = `/projects/${L.id}`;

  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0] || null;
  const val = async (sql, params = []) => {
    const row = await one(sql, params);
    return row ? Object.values(row)[0] : null;
  };
  const orgOf = async (code) => val('select id::text from "Organisation" where slug like $1', [`cert-${code}-%`]);
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  if (!attackerOrg || !victimOrg) throw new Error('both companies must exist in the certification database');

  const victimIds = [];
  const traces = [`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`];
  let victimTraces = new RegExp(traces.join('|'));
  const leakOf = (text, sent) => {
    if (victimTraces.test(text)) return (text.match(victimTraces) || [])[0];
    return victimIds.find((id) => text.includes(id) && !sent.includes(id)) || null;
  };
  const sessions = {};
  const who = (role, code = ATTACKER) => {
    const key = `${role}@${code}`;
    if (!sessions[key]) {
      const session = api.as(`${role}@c${code}.octapm-cert.test`);
      sessions[key] = async (method, route, body, options = {}) => {
        const res = await session.send(method, route, body, options);
        answers.push({ route: `${key} ${method} ${route}`, status: res.status, text: res.text || '', sent: `${route} ${JSON.stringify(body ?? null)}` });
        return res;
      };
    }
    return sessions[key];
  };
  const pm = who('pm');
  const planner = who('planner');
  const buyer = who('procurement');
  const vPm = who('pm', VICTIM);
  const must = async (send, method, route, body, what) => {
    const res = await send(method, route, body);
    if (!ok2xx(res)) throw new Error(`setup ${what}: ${said(res)} ${(res.text || '').slice(0, 300)}`);
    return res.body?.data;
  };

  // ── the ids, each proven by its owner ─────────────────────────────────────
  const userByEmail = async (email) => val('select id::text from "User" where email = $1', [email]);
  const siteEngineer = await userByEmail(`site@${attacker.domain}`);
  const projectOrg = async (id) => val('select "orgId"::text from "Project" where id = $1', [id]);
  check(`setup: projects ${P.id} (-02) and ${L.id} (-09) are company ${ATTACKER}'s, ${V.id} is company ${VICTIM}'s; site@ is ${siteEngineer}`, (await projectOrg(P.id)) === attackerOrg && (await projectOrg(L.id)) === attackerOrg && (await projectOrg(V.id)) === victimOrg && Boolean(siteEngineer));
  let victimEquipment = await val('select e.id::text from "Equipment" e join "Project" p on p.id = e."projectId" where p."orgId" = $1 order by e."createdAt" limit 1', [victimOrg]);
  if (!victimEquipment) victimEquipment = (await must(vPm, 'POST', `/projects/${V.id}/equipment`, { name: `T7 victim equipment ${STAMP}`, rateType: 'hourly', rate: 10 }, 'victim equipment')).id;
  const victimActivity = await val('select a.id::text from "Activity" a where a."projectId" = $1 and a."isActive" order by a."createdAt" limit 1', [V.id]);
  check(`setup: equipment ${victimEquipment} and activity ${victimActivity} are company ${VICTIM}'s`, (await val('select p."orgId"::text from "Equipment" e join "Project" p on p.id = e."projectId" where e.id = $1', [victimEquipment])) === victimOrg && (await val('select p."orgId"::text from "Activity" a join "Project" p on p.id = a."projectId" where a.id = $1', [victimActivity])) === victimOrg);
  victimIds.push(...[victimEquipment, victimActivity, V.id, victimOrg].filter(Boolean));
  victimTraces = new RegExp(traces.join('|'));

  const freshActivity = async (projectId, tag) => (await must(planner, 'POST', `/projects/${projectId}/activities`, { name: `${STAMP} ${tag}`, duration: 3, engineerIds: [siteEngineer] }, `activity ${tag}`)).id;
  let dateSalt = 0;
  const nextDate = () => {
    dateSalt += 1;
    return new Date(Date.UTC(2020, 0, 1) + ((parseInt(STAMP.slice(-4), 16) + dateSalt * 13) % 1800) * 86_400_000).toISOString().slice(0, 10);
  };
  let markerSeq = 0;
  const marker = () => `${STAMP} m${(markerSeq += 1)}`;
  const reportCount = async (m) => Number(await val('select count(*)::int from "DailyReport" where "projectId" = $1 and notes = $2', [P.id, m]));
  const diaryCount = async (m) => Number(await val('select count(*)::int from "SiteDiary" where "projectId" = $1 and notes = $2', [P.id, m]));
  const usageOf = async (reportId) => one('select hours, rate::text as rate, "rateType", "costAmount"::text as cost, "equipmentId"::text as equipment from "ActivityEquipmentUsage" where "dailyReportId" = $1', [reportId]);
  const reportLines = async (id) => (await one('select "equipmentJson" as e from "DailyReport" where id = $1', [id]))?.e;
  const diaryRow = async (id) => one('select "equipmentJson" as e, "weatherJson" as w from "SiteDiary" where id = $1', [id]);

  const snapshot = async () => {
    if (!FINGERPRINT) return null;
    await db.query('begin transaction isolation level repeatable read read only');
    const taken = await fingerprint.take(db);
    await db.query('rollback');
    return taken;
  };
  const before = await snapshot();
  let ownEquipment = null;
  const equipmentOwn = async () => {
    if (!ownEquipment) ownEquipment = (await must(pm, 'POST', `${PP}/equipment`, { name: `${STAMP} crane`, rateType: 'hourly', rate: 12 }, 'own equipment')).id;
    return ownEquipment;
  };

  // ══ 1. hours: the web progress tab's whole day on one line ═══════════════
  section = '1-hours';
  if (runs()) {
    console.log('\n── 1. an equipment line carries the web progress tab\'s day of hours ──');
    // frontend progress-tab.tsx createDailyReport, as it sends it.
    const web = (activityId, hours, m) => ({ activityId, date: nextDate(), pctProgress: 5, manpower: [{ trade: 'crew', workers: 3, hours: 8 }], equipment: [{ name: 'site equipment', hours }], materials: [], photos: [], notes: m });
    for (const hours of [30, 48]) {
      const a = await freshActivity(P.id, `web ${hours}`);
      const m = marker();
      const created = await pm('POST', `${PP}/daily-reports`, web(a, hours, m));
      const approved = created.body?.data?.id ? await pm('POST', `${PP}/daily-reports/${created.body.data.id}/approve`, {}) : null;
      const usage = created.body?.data?.id ? await usageOf(created.body.data.id) : null;
      check(`ALLOWED the web progress tab's daily report with ${hours} equipment hours on its one line is created (201; round 6: 400) and approved, its usage posted at ${hours} h`, created.status === 201 && ok2xx(approved) && approved.body?.data?.status === 'approved' && Number(usage?.hours) === hours && usage?.cost === '0.00', `${said(created)} | ${approved ? said(approved) : '-'} | ${JSON.stringify(usage)}`);
    }
    const eq = await equipmentOwn();
    const priced = await freshActivity(P.id, 'priced 48');
    const pricedReport = await pm('POST', `${PP}/daily-reports`, { activityId: priced, date: nextDate(), pctProgress: 5, equipment: [{ equipmentId: eq, name: 'crane', hours: 48 }], notes: marker() });
    const pricedApproved = pricedReport.body?.data?.id ? await pm('POST', `${PP}/daily-reports/${pricedReport.body.data.id}/approve`, {}) : null;
    const pricedUsage = pricedReport.body?.data?.id ? await usageOf(pricedReport.body.data.id) : null;
    check('ALLOWED 48 hours of the own equipment (12.00 an hour) on one line is approved and costed 576.00', pricedReport.status === 201 && ok2xx(pricedApproved) && pricedUsage?.cost === '576.00' && pricedUsage?.equipment === eq, `${said(pricedReport)} | ${pricedApproved ? said(pricedApproved) : '-'} | ${JSON.stringify(pricedUsage)}`);
    const draftActivity = await freshActivity(P.id, 'draft');
    const top = marker();
    const topRes = await pm('POST', `${PP}/daily-reports`, { activityId: draftActivity, date: nextDate(), status: 'draft', equipment: [{ name: 'site equipment', hours: 744 }], notes: top });
    const over = marker();
    const overRes = await pm('POST', `${PP}/daily-reports`, { activityId: draftActivity, date: nextDate(), status: 'draft', equipment: [{ name: 'site equipment', hours: 745 }], notes: over });
    check('ALLOWED 744 hours (24 x 31) on one line is stored (201)', topRes.status === 201 && (await reportCount(top)) === 1, said(topRes));
    check(`SHAPE 745 hours on one line is refused 400 VALIDATION_ERROR on equipment[0].hours, nothing stored${gateNote(topRes)}`, ok2xx(topRes) && refusedOn(overRes, 'equipment[0].hours') && (await reportCount(over)) === 0, said(overRes));
    const draftId = topRes.body?.data?.id;
    const patched = draftId ? await pm('PATCH', `${PP}/daily-reports/${draftId}`, { equipment: [{ name: 'site equipment', hours: 48 }] }) : { status: 0 };
    const patchedOver = draftId ? await pm('PATCH', `${PP}/daily-reports/${draftId}`, { equipment: [{ name: 'site equipment', hours: 745 }] }) : { status: 0 };
    const linesAfter = draftId ? await reportLines(draftId) : null;
    check('ALLOWED PATCH daily report equipment 48 hours (200), and 745 refused 400 on equipment[0].hours, the line left at 48', patched.status === 200 && refusedOn(patchedOver, 'equipment[0].hours') && linesAfter?.[0]?.hours === 48, `${said(patched)} | ${said(patchedOver)} | ${JSON.stringify(linesAfter)}`);
    const dm = marker();
    const diary = await pm('POST', `${PP}/site-diaries`, { date: nextDate(), status: 'draft', equipment: [{ name: 'site equipment', hours: 48 }], notes: dm });
    const dOver = marker();
    const diaryOver = await pm('POST', `${PP}/site-diaries`, { date: nextDate(), status: 'draft', equipment: [{ name: 'site equipment', hours: 745 }], notes: dOver });
    const diaryLines = diary.body?.data?.id ? (await diaryRow(diary.body.data.id))?.e : null;
    check('ALLOWED a site diary\'s equipment line of 48 hours is stored (201; round 6: 400)', diary.status === 201 && diaryLines?.[0]?.hours === 48, `${said(diary)} ${JSON.stringify(diaryLines)}`);
    check(`SHAPE a site diary's line of 745 hours is refused 400 on equipment[0].hours, nothing stored${gateNote(diary)}`, ok2xx(diary) && refusedOn(diaryOver, 'equipment[0].hours') && (await diaryCount(dOver)) === 0, said(diaryOver));
  }

  // ══ 2. a line's own rate and rateType ═════════════════════════════════════
  section = '2-rate';
  if (runs()) {
    console.log('\n── 2. a line\'s own rate is a figure 0 to MONEY_FIGURE_MAX, its rateType hourly or daily ──');
    const eq = await equipmentOwn();
    const approveLine = async (line, tag) => {
      const a = await freshActivity(P.id, tag);
      const created = await pm('POST', `${PP}/daily-reports`, { activityId: a, date: nextDate(), status: 'submitted', pctProgress: 5, equipment: [line], notes: marker() });
      const approved = created.body?.data?.id ? await pm('POST', `${PP}/daily-reports/${created.body.data.id}/approve`, {}) : null;
      return { created, approved, usage: created.body?.data?.id ? await usageOf(created.body.data.id) : null };
    };
    const own = await approveLine({ equipmentId: eq, name: 'crane', hours: 8, rate: 15 }, 'rate 15');
    check('ALLOWED a line priced at its own rate (15.00 an hour, 8 h, over the equipment\'s 12.00) is approved and costed 120.00', own.created.status === 201 && ok2xx(own.approved) && own.usage?.rate === '15.00' && own.usage?.cost === '120.00', `${said(own.created)} | ${own.approved ? said(own.approved) : '-'} | ${JSON.stringify(own.usage)}`);
    const daily = await approveLine({ equipmentId: eq, name: 'crane', hours: 4, rate: 80, rateType: 'daily' }, 'rate daily');
    check('ALLOWED a line at a daily rate of its own (80.00 a day, 4 h) is approved and costed 40.00', daily.created.status === 201 && ok2xx(daily.approved) && daily.usage?.rateType === 'daily' && daily.usage?.cost === '40.00', `${said(daily.created)} | ${daily.approved ? said(daily.approved) : '-'} | ${JSON.stringify(daily.usage)}`);
    const refusalActivity = await freshActivity(P.id, 'rate refusals');
    for (const [label, line, field] of [
      ['rate -500 (round 6: stored; its approval posted -1,000.00)', { rate: -500 }, 'equipment[0].rate'],
      ['rate 1e30 (round 6: stored; its approval refused for ever)', { rate: 1e30 }, 'equipment[0].rate'],
      ['rate "twelve"', { rate: 'twelve' }, 'equipment[0].rate'],
      [`rate ${MONEY_FIGURE_MAX} x 2 h (the cost cannot be written)`, { rate: MONEY_FIGURE_MAX }, 'equipment[0].rate'],
      ['rate 2e13 x 744 h (1.488e16, past Decimal(18,2))', { rate: 2e13, hours: 744 }, 'equipment[0].rate'],
      ['rateType "weekly" (round 6: stored)', { rate: 10, rateType: 'weekly' }, 'equipment[0].rateType'],
    ]) {
      const m = marker();
      const res = await pm('POST', `${PP}/daily-reports`, { activityId: refusalActivity, date: nextDate(), status: 'draft', equipment: [{ equipmentId: eq, name: 'crane', hours: 2, ...line }], notes: m });
      check(`SHAPE (POST daily report) ${label} is refused 400 VALIDATION_ERROR on ${field}, nothing stored${gateNote(own.created)}`, ok2xx(own.created) && refusedOn(res, field) && (await reportCount(m)) === 0, said(res));
    }
    const draft = await pm('POST', `${PP}/daily-reports`, { activityId: refusalActivity, date: nextDate(), status: 'draft', equipment: [{ equipmentId: eq, name: 'crane', hours: 2, rate: 15 }], notes: marker() });
    const draftId = draft.body?.data?.id;
    const patchBad = draftId ? await pm('PATCH', `${PP}/daily-reports/${draftId}`, { equipment: [{ equipmentId: eq, name: 'crane', hours: 2, rate: -500 }] }) : { status: 0 };
    const patchType = draftId ? await pm('PATCH', `${PP}/daily-reports/${draftId}`, { equipment: [{ equipmentId: eq, name: 'crane', hours: 2, rate: 15, rateType: 'weekly' }] }) : { status: 0 };
    const kept = draftId ? await reportLines(draftId) : null;
    check(`SHAPE (PATCH daily report) rate -500 and rateType "weekly" are refused 400 on the field, the line left at 15${gateNote(draft)}`, ok2xx(draft) && refusedOn(patchBad, 'equipment[0].rate') && refusedOn(patchType, 'equipment[0].rateType') && kept?.[0]?.rate === 15, `${said(patchBad)} | ${said(patchType)} | ${JSON.stringify(kept)}`);
    const dGate = await pm('POST', `${PP}/site-diaries`, { date: nextDate(), status: 'draft', equipment: [{ equipmentId: eq, name: 'crane', hours: 2, rate: 15, rateType: 'hourly' }], notes: marker() });
    const dLines = dGate.body?.data?.id ? (await diaryRow(dGate.body.data.id))?.e : null;
    check('ALLOWED a site diary\'s line at its own rate 15 (hourly) is stored as 15', dGate.status === 201 && dLines?.[0]?.rate === 15 && dLines?.[0]?.rateType === 'hourly', `${said(dGate)} ${JSON.stringify(dLines)}`);
    for (const [label, line, field] of [['rate -500', { rate: -500 }, 'equipment[0].rate'], ['rate 1e30', { rate: 1e30 }, 'equipment[0].rate'], ['rateType "weekly"', { rateType: 'weekly' }, 'equipment[0].rateType']]) {
      const m = marker();
      const res = await pm('POST', `${PP}/site-diaries`, { date: nextDate(), status: 'draft', equipment: [{ equipmentId: eq, name: 'crane', hours: 2, ...line }], notes: m });
      const patchRes = dGate.body?.data?.id ? await pm('PATCH', `${PP}/site-diaries/${dGate.body.data.id}`, { equipment: [{ equipmentId: eq, name: 'crane', hours: 2, ...line }] }) : { status: 0 };
      check(`SHAPE (POST and PATCH site diary) ${label} is refused 400 on ${field}, nothing stored or changed${gateNote(dGate)}`, ok2xx(dGate) && refusedOn(res, field) && refusedOn(patchRes, field) && (await diaryCount(m)) === 0, `${said(res)} | ${said(patchRes)}`);
    }
    const dAfter = dGate.body?.data?.id ? (await diaryRow(dGate.body.data.id))?.e : null;
    check('the site diary\'s line is still at rate 15 after the refused edits', dAfter?.[0]?.rate === 15, JSON.stringify(dAfter));
  }

  // ══ 3. a site diary's weatherJson ═════════════════════════════════════════
  section = '3-weather';
  if (runs()) {
    console.log('\n── 3. a site diary\'s weatherJson takes the figure checks weatherDetails takes ──');
    const gm = marker();
    const gate = await pm('POST', `${PP}/site-diaries`, { date: nextDate(), status: 'draft', weatherJson: { summary: 'Clear', temperatureC: 22, rainfallMm: 3 }, notes: gm });
    const stored = gate.body?.data?.id ? (await diaryRow(gate.body.data.id))?.w : null;
    check('ALLOWED a site diary with weatherJson { temperatureC 22, rainfallMm 3 } is stored with those figures', gate.status === 201 && stored?.temperatureC === 22 && stored?.rainfallMm === 3, `${said(gate)} ${JSON.stringify(stored)}`);
    for (const [label, weather, field] of [
      ['temperatureC [5] (round 6: stored as 5)', { temperatureC: [5] }, 'weatherJson.temperatureC'],
      ['temperatureC [] (round 6: stored as 0)', { temperatureC: [] }, 'weatherJson.temperatureC'],
      ['temperatureC 1e300 (round 6: stored)', { temperatureC: 1e300 }, 'weatherJson.temperatureC'],
      ['rainfallMm 1e300 (round 6: stored)', { rainfallMm: 1e300 }, 'weatherJson.rainfallMm'],
      ['rainfallMm -1', { rainfallMm: -1 }, 'weatherJson.rainfallMm'],
    ]) {
      const m = marker();
      const res = await pm('POST', `${PP}/site-diaries`, { date: nextDate(), status: 'draft', weatherJson: weather, notes: m });
      check(`SHAPE (POST site diary) weatherJson ${label} is refused 400 VALIDATION_ERROR on ${field}, nothing stored${gateNote(gate)}`, ok2xx(gate) && refusedOn(res, field) && (await diaryCount(m)) === 0, said(res));
    }
    const id = gate.body?.data?.id;
    const patchBad = id ? await pm('PATCH', `${PP}/site-diaries/${id}`, { weatherJson: { temperatureC: [5] } }) : { status: 0 };
    const unchanged = id ? (await diaryRow(id))?.w : null;
    const patchOk = id ? await pm('PATCH', `${PP}/site-diaries/${id}`, { weatherJson: { temperatureC: '30' } }) : { status: 0 };
    const changed = id ? (await diaryRow(id))?.w : null;
    check('PATCH site diary weatherJson { temperatureC [5] } is refused 400 on weatherJson.temperatureC, the weather unchanged; { temperatureC "30" } is stored as 30', refusedOn(patchBad, 'weatherJson.temperatureC') && unchanged?.temperatureC === 22 && patchOk.status === 200 && changed?.temperatureC === 30, `${said(patchBad)} ${JSON.stringify(unchanged)} | ${said(patchOk)} ${JSON.stringify(changed)}`);
    const details = await pm('POST', `${PP}/site-diaries`, { date: nextDate(), status: 'draft', weatherDetails: { temperatureC: 25 }, notes: marker() });
    check('ALLOWED weatherDetails (the web form\'s name) is taken as before', details.status === 201, said(details));
  }

  // ══ 4. a project's currency ═══════════════════════════════════════════════
  section = '4-currency';
  if (runs()) {
    console.log('\n── 4. a project\'s currency (and every sanitizing chain) is one text before it is sanitized ──');
    const projectRow = async (id) => one('select currency, "contractType", "projectCalendar", type, location, "updatedAt" from "Project" where id = $1', [id]);
    const beforeRow = await projectRow(P.id);
    const gate = await pm('PATCH', `/projects/${P.id}`, { currency: String(beforeRow?.currency || 'USD').toLowerCase() });
    const gateRow = await projectRow(P.id);
    check(`ALLOWED PATCH /projects/{id} currency "${String(beforeRow?.currency || 'USD').toLowerCase()}" is stored upper-cased (${gateRow?.currency})`, gate.status === 200 && gateRow?.currency === String(beforeRow?.currency || 'USD').toUpperCase(), said(gate));
    const refused = [];
    for (const value of [5, ['usd'], { a: 1 }, true, null]) refused.push([JSON.stringify(value), await pm('PATCH', `/projects/${P.id}`, { currency: value })]);
    const afterCurrency = await projectRow(P.id);
    check(`SHAPE PATCH /projects/{id} currency 5, ["usd"], {"a":1}, true, null (round 6 and f16c14f: 500 'value.toUpperCase is not a function') are each refused 400 VALIDATION_ERROR on currency, the project unchanged${gateNote(gate)}`,
      ok2xx(gate) && refused.every(([, r]) => refusedOn(r, 'currency')) && afterCurrency?.currency === gateRow?.currency && String(afterCurrency?.updatedAt) === String(gateRow?.updatedAt), refused.map(([v, r]) => `${v}: ${said(r)}`).join(' | '));
    const others = [];
    for (const [field, value] of [['contractType', ['epc']], ['contractType', 5], ['projectCalendar', true], ['type', 5], ['location', ['x']]]) others.push([`${field} ${JSON.stringify(value)}`, await pm('PATCH', `/projects/${P.id}`, { [field]: value }), field]);
    const afterOthers = await projectRow(P.id);
    check(`SHAPE PATCH /projects/{id} contractType ["epc"] (round 6: stored as "epc") and 5, projectCalendar true, type 5, location ["x"]: each 400 on the field, the project unchanged${gateNote(gate)}`,
      ok2xx(gate) && others.every(([, r, f]) => refusedOn(r, f)) && JSON.stringify({ ...afterOthers, updatedAt: null }) === JSON.stringify({ ...gateRow, updatedAt: null }), others.map(([l, r]) => `${l}: ${said(r)}`).join(' | '));
    const keep = await pm('PATCH', `/projects/${P.id}`, { contractType: beforeRow?.contractType ?? null, projectCalendar: beforeRow?.projectCalendar ?? null, type: beforeRow?.type ?? null });
    const keptRow = await projectRow(P.id);
    check('ALLOWED PATCH /projects/{id} with the project\'s own contractType, projectCalendar and type (texts, or null) is accepted, nothing changed', keep.status === 200 && keptRow?.contractType === beforeRow?.contractType && keptRow?.projectCalendar === beforeRow?.projectCalendar && keptRow?.type === beforeRow?.type, `${said(keep)} ${JSON.stringify(keptRow)}`);
    const projectsBefore = Number(await val('select count(*)::int from "Project" where "orgId" = $1', [attackerOrg]));
    const created = await pm('POST', '/projects', { name: `${STAMP} currency probe`, currency: 5 });
    const projectsAfter = Number(await val('select count(*)::int from "Project" where "orgId" = $1', [attackerOrg]));
    check('SHAPE POST /projects currency 5 is refused 400 on currency (it was a 500), no project created', refusedOn(created, 'currency') && projectsAfter === projectsBefore, `${said(created)} projects ${projectsBefore} -> ${projectsAfter}`);
  }

  // ══ 5. an activity's schedule figures, and a schedule file's ══════════════
  section = '5-schedule';
  if (runs()) {
    console.log(`\n── 5. an activity's duration, offsets, float and lags are at most ${DAYS_MAX} days; the conversion ends ──`);
    const a = await freshActivity(L.id, 'schedule');
    const other = await one('select id::text as id, coalesce("activityCode", "p6ActivityId", "wbsCode") as code from "Activity" where "projectId" = $1 and "isActive" and id <> $2 and coalesce("activityCode", "p6ActivityId", "wbsCode") is not null order by "createdAt" limit 1', [L.id, a]);
    const activityRow = async () => one('select duration, "earlyStart", "earlyFinish", "lateStart", "lateFinish", "totalFloat", predecessors from "Activity" where id = $1', [a]);
    // Warm the routes first (a section run on its own is the process's first activity read).
    await planner('PATCH', `${LP}/activities/${a}`, { duration: 4 });
    await planner('GET', `${LP}/activities/${a}`);
    let started = process.hrtime.bigint();
    const longest = await planner('PATCH', `${LP}/activities/${a}`, { duration: DAYS_MAX });
    const longestMs = msSince(started);
    started = process.hrtime.bigint();
    const read = await planner('GET', `${LP}/activities/${a}`);
    const readMs = msSince(started);
    check(`ALLOWED PATCH activity duration ${DAYS_MAX} (200, ${Math.round(longestMs)} ms) and its read (200, ${Math.round(readMs)} ms, late finish ${String(read.body?.data?.lateFinishDate).slice(0, 10)}) — each well under a second`, longest.status === 200 && read.status === 200 && longestMs < 1500 && readMs < 1000 && /^21\d\d-/.test(String(read.body?.data?.lateFinishDate || '')), `${said(longest)} ${Math.round(longestMs)} ms | ${said(read)} ${Math.round(readMs)} ms ${read.body?.data?.lateFinishDate}`);
    const before5 = await activityRow();
    const refused = [];
    for (const value of [DAYS_MAX + 1, 1_000_000, 2_147_483_647]) {
      started = process.hrtime.bigint();
      refused.push([`duration ${value}`, await planner('PATCH', `${LP}/activities/${a}`, { duration: value }), 'duration', msSince(started)]);
    }
    for (const field of ['earlyStart', 'earlyFinish', 'lateStart', 'lateFinish', 'totalFloat']) {
      started = process.hrtime.bigint();
      refused.push([`${field} ${DAYS_MAX + 1}`, await planner('PATCH', `${LP}/activities/${a}`, { [field]: DAYS_MAX + 1 }), field, msSince(started)]);
    }
    if (other) {
      for (const lag of [DAYS_MAX + 1, -(DAYS_MAX + 1)]) refused.push([`dependencies[0].lagDays ${lag}`, await planner('PATCH', `${LP}/activities/${a}`, { dependencies: [{ predecessorId: other.id, relationshipType: 'FS', lagDays: lag }] }), 'dependencies[0].lagDays', 0]);
      refused.push([`predecessors "${other.code} FS+${DAYS_MAX + 1}"`, await planner('PATCH', `${LP}/activities/${a}`, { predecessors: `${other.code} FS+${DAYS_MAX + 1}` }), 'predecessors', 0]);
    }
    const after5 = await activityRow();
    check(`SHAPE PATCH activity duration ${DAYS_MAX + 1}, 1,000,000 (f16c14f: 500 after 8 s) and INT4_MAX; earlyStart … totalFloat ${DAYS_MAX + 1}; a lag of ±${DAYS_MAX + 1} in the dependencies and in the predecessors text: each 400 on the field, at once, the activity unchanged${gateNote(longest)}`,
      ok2xx(longest) && Boolean(other) && refused.every(([, r, f, t]) => refusedOn(r, f) && t < 1000) && JSON.stringify(before5) === JSON.stringify(after5), refused.filter(([, r, f, t]) => !(refusedOn(r, f) && t < 1000)).map(([l, r, , t]) => `${l}: ${said(r)} ${Math.round(t)} ms`).join(' | ') || `${JSON.stringify(before5)} -> ${JSON.stringify(after5)}`);
    const lagOk = other ? await planner('PATCH', `${LP}/activities/${a}`, { dependencies: [{ predecessorId: other.id, relationshipType: 'FS', lagDays: -DAYS_MAX }] }) : { status: 0 };
    const textOk = other ? await planner('PATCH', `${LP}/activities/${a}`, { predecessors: `${other.code} FS+2` }) : { status: 0 };
    const cleared = await planner('PATCH', `${LP}/activities/${a}`, { dependencies: [], duration: 3 });
    check(`ALLOWED a lag of -${DAYS_MAX} (dependencies) and "${other?.code} FS+2" (predecessors text) are accepted (200); the activity is put back (3 days, no logic)`, lagOk.status === 200 && textOk.status === 200 && cleared.status === 200, `${said(lagOk)} | ${said(textOk)} | ${said(cleared)}`);
    const name = `${STAMP} too long`;
    const createdLong = await planner('POST', `${LP}/activities`, { name, duration: DAYS_MAX + 1, engineerIds: [siteEngineer] });
    check(`SHAPE POST activity duration ${DAYS_MAX + 1} is refused 400 on duration, nothing created`, refusedOn(createdLong, 'duration') && Number(await val('select count(*)::int from "Activity" where "projectId" = $1 and name = $2', [L.id, name])) === 0, said(createdLong));
    const gone = await planner('DELETE', `${LP}/activities/${a}`);
    check('the proof\'s activity is deleted again (200)', gone.status === 200, said(gone));

    // The conversion itself, in this process: it ends on any offset, at once.
    const cpm = require('../../../src/services/cpm.service');
    const monday = new Date('2026-01-05T00:00:00.000Z');
    started = process.hrtime.bigint();
    const ends = [71_000_000, 100_000_000, 2_147_483_647, -2_147_483_648, 1e300].map((n) => cpm.workingDayToDate(monday, n, { calendarId: 'five_day' }));
    const saturdayAtTheEnd = cpm.workingDayToDate(new Date(8.64e15), 1, { calendarId: 'five_day' });
    const endMs = msSince(started);
    check(`the conversion ends at once on any offset (71 million, 10^8, INT4 either way, 1e300; the walk at f16c14f never ended past ~71 million) — all no date, ${endMs.toFixed(2)} ms in all`, ends.every((d) => d === null) && saturdayAtTheEnd === null && endMs < 50, JSON.stringify({ ends, saturdayAtTheEnd, endMs }));
    check('the conversion keeps the walk\'s dates: 36,500 and 1,000,000 working days from Monday 2026-01-05 are 2165-12-02 and 5859-01-31 (as at f16c14f)',
      cpm.workingDayToDate(monday, 36_500, { calendarId: 'five_day' })?.toISOString().slice(0, 10) === '2165-12-02' && cpm.workingDayToDate(monday, 1_000_000, { calendarId: 'five_day' })?.toISOString().slice(0, 10) === '5859-01-31');
  }

  section = '5-import';
  if (runs()) {
    console.log('\n── 5. a schedule file\'s durations, float and lags are at most 36,500 days ──');
    const revisions = async () => Number(await val('select count(*)::int from "ScheduleRevision" where "projectId" = $1', [L.id]));
    const upload = (route, filename, body, contentType) => planner('POST', `${LP}/import/${route}`, undefined, { form: api.multipart({ field: 'file', filename, contentType, body }) });
    const r0 = await revisions();
    const okXer = await upload('xer', `${STAMP}-ok.xer`, xerFile([['T1', `${STAMP}-A1`, DAYS_MAX * 8], ['T2', `${STAMP}-A2`, 40]], 16), 'text/plain');
    const r1 = await revisions();
    check(`ALLOWED an XER of a ${DAYS_MAX}-day activity (${DAYS_MAX * 8} hours) and a 2-day lag is staged (201, one draft revision)`, okXer.status === 201 && okXer.body?.data?.staged === true && r1 === r0 + 1, `${said(okXer)} revisions ${r0} -> ${r1}`);
    const refusedFiles = [];
    for (const [label, content] of [
      [`a ${DAYS_MAX + 1}-day duration`, xerFile([['T1', `${STAMP}-B1`, (DAYS_MAX + 1) * 8], ['T2', `${STAMP}-B2`, 40]])],
      ['a lag of 37,500 days', xerFile([['T1', `${STAMP}-C1`, 40], ['T2', `${STAMP}-C2`, 40]], 300_000)],
      ['a duration of 10^9 days', xerFile([['T1', `${STAMP}-D1`, 8e9], ['T2', `${STAMP}-D2`, 40]])],
    ]) refusedFiles.push([label, await upload('xer', `${STAMP}-bad.xer`, content, 'text/plain')]);
    const r2 = await revisions();
    check(`SHAPE an XER with ${refusedFiles.map(([l]) => l).join(', ')}: each refused 400 SCHEDULE_FIGURE_OUT_OF_RANGE naming it, nothing staged${gateNote(okXer)}`,
      ok2xx(okXer) && refusedFiles.every(([, r]) => r.status === 400 && r.body?.error?.code === 'SCHEDULE_FIGURE_OUT_OF_RANGE' && (r.body.error.details?.problems || []).length >= 1) && r2 === r1, `${refusedFiles.map(([l, r]) => `${l}: ${said(r)} ${JSON.stringify(r.body?.error?.details?.problems || '')}`).join(' | ')} revisions ${r1} -> ${r2}`);
    const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const dry = (rows) => planner('POST', `${LP}/import/xlsx?dryRun=true`, undefined, { form: api.multipart({ field: 'file', filename: `${STAMP}.xlsx`, contentType: xlsxType, body: xlsxFile(rows) }) });
    const dryOk = await dry([['A1', 'Dig', DAYS_MAX, ''], ['A2', 'Pour', 5, `A1 FS+${DAYS_MAX}`]]);
    const dryLong = await dry([['A1', 'Dig', DAYS_MAX + 1, ''], ['A2', 'Pour', 5, '']]);
    const dryLag = await dry([['A1', 'Dig', 2, ''], ['A2', 'Pour', 5, 'A1 FS+40000']]);
    check(`ALLOWED an xlsx dry run of ${DAYS_MAX} days and a ${DAYS_MAX}-day lag (200, 2 activities, 1 dependency); SHAPE ${DAYS_MAX + 1} days and a 40,000-day lag: 400 SCHEDULE_FIGURE_OUT_OF_RANGE`,
      dryOk.status === 200 && dryOk.body?.data?.activityCount === 2 && dryOk.body?.data?.dependencyCount === 1 && dryLong.body?.error?.code === 'SCHEDULE_FIGURE_OUT_OF_RANGE' && dryLag.body?.error?.code === 'SCHEDULE_FIGURE_OUT_OF_RANGE', `${said(dryOk)} | ${said(dryLong)} | ${said(dryLag)}`);
  }

  // ══ 6. the project health's material risk ═════════════════════════════════
  section = '6-health';
  if (runs()) {
    console.log('\n── 6. a material on a cancelled order carries no promise in the project health ──');
    // A material needed in 400 days (no risk of its own: its order-by date is a year away), then
    // ordered on a line promised 55 days after that (delivery after need: critical, 55 days at risk),
    // then the order cancelled. The health's supply chain counts every row's risk; its top five may
    // be other rows', so the material is read through the counts — between the three reads, the
    // material's row is the only one that may change but the line's own (judged by the line's
    // status: reported apart, not this fix).
    const supplier = await must(buyer, 'POST', `${PP}/procurement/suppliers`, { name: `${STAMP} supplier`, status: 'approved' }, 'supplier');
    const activityId = await freshActivity(P.id, 'material');
    const need = day(400);
    const promised = day(455);
    const late = 55;
    const material = await must(pm, 'POST', `${PP}/activities/${activityId}/materials`, { name: `${STAMP} cable`, unit: 'PCS', qty: 3, requiredDate: need, leadWeeks: 0 }, 'material');
    const supplyOf = (res) => {
      let found = null;
      const visit = (node) => {
        if (found || !node || typeof node !== 'object') return;
        if (!Array.isArray(node) && 'criticalRisks' in node && 'daysAtRisk' in node && Array.isArray(node.topRisks)) found = node;
        else Object.values(node).forEach(visit);
      };
      visit(res.body);
      return found ? { critical: Number(found.criticalRisks), atRisk: Number(found.atRiskItems), days: Number(found.daysAtRisk), top: found.topRisks } : null;
    };
    const materialTop = (supply) => (supply?.top || []).filter((row) => row.id === material.id);
    const h0res = await pm('GET', `${PP}/health`);
    const h0 = supplyOf(h0res);
    const order = await buyer('POST', `${PP}/procurement/purchase-orders`, { supplierId: supplier.id, status: 'draft', currency: 'USD', item: `${STAMP} cable order`, requiredBy: need, notes: STAMP, lines: [{ lineNumber: 1, activityId, activityMaterialId: material.id, description: `${STAMP} cable`, unit: 'PCS', orderedQty: 3, unitCost: 2, requiredDate: need, promisedDate: promised }] });
    const h1res = await pm('GET', `${PP}/health`);
    const h1 = supplyOf(h1res);
    const cancelled = order.body?.data?.id ? await pm('POST', `${PP}/purchase-orders/${order.body.data.id}/cancel`, { reason: `${STAMP} proof` }) : { status: 0 };
    const h2res = await pm('GET', `${PP}/health`);
    const h2 = supplyOf(h2res);
    const shown = (h) => (h ? `critical ${h.critical}, days at risk ${h.days}` : 'no supply-chain section');
    const d1 = h0 && h1 ? { critical: h1.critical - h0.critical, days: h1.days - h0.days } : null;
    const d2 = h0 && h2 ? { critical: h2.critical - h0.critical, days: h2.days - h0.days } : null;
    // Live: the material reads its line's promise — one more critical row than its line alone, `late` more days.
    const liveGate = order.status === 201 && h0res.status === 200 && h1res.status === 200 && d1 && d1.critical >= 1 && d1.days >= late;
    check(`GATE: while the order is live, the health counts the material late on its line's promise (${promised}, need ${need}): ${shown(h0)} -> ${shown(h1)}`, liveGate, `${said(order)} | ${said(h1res)} ${JSON.stringify({ d1, top: materialTop(h1) })}`);
    check(`READ the order cancelled (200): the health (200) no longer counts the material late on the cancelled order's promise — one critical row and ${late} days at risk fewer than while it was live (${shown(h1)} -> ${shown(h2)}; f16c14f and round 6: unchanged), and no top risk of the material carries a delivery date${liveGate ? '' : ' [NOT GATED]'}`,
      liveGate && cancelled.status === 200 && h2res.status === 200 && d2 && d1.critical - d2.critical === 1 && d1.days - d2.days === late && materialTop(h2).every((row) => !row.expectedDeliveryDate), `${said(cancelled)} | ${said(h2res)} ${JSON.stringify({ d1, d2, top: materialTop(h2) })}`);
    const lineLeft = (h2?.top || []).concat(h1?.top || []).some((row) => row.source === 'po_line' && String(row.expectedDeliveryDate || '').startsWith(promised));
    if (d2 && d2.critical >= 1) console.log(`NOTE  the cancelled order's own line still counts as a critical supply-chain risk (${JSON.stringify(d2)}${lineLeft ? ', in the top risks' : ''}): health.js judges an order line by the line's own status, not its order's — reported as a new finding, not fixed here`);
    const register = await pm('GET', `${PP}/activities/${activityId}/materials`);
    const registered = (register.body?.data || []).find((row) => row.id === material.id);
    check('the material register agrees (procurement.service, the rule the health now shares): no expected delivery', register.status === 200 && registered && !registered.procurementRisk?.expectedDeliveryDate, `${said(register)} ${JSON.stringify(registered?.procurementRisk || null)}`);
  }

  // ══ refusals: company 068's records named by company 067 ══════════════════
  section = 'refusals';
  if (runs()) {
    console.log(`\n── refusals: company ${VICTIM}'s records, named by company ${ATTACKER} ──`);
    const eq = await equipmentOwn();
    const a = await freshActivity(P.id, 'refusals');
    const line = (equipmentId) => ({ activityId: a, date: nextDate(), status: 'draft', equipment: [{ equipmentId, name: 'crane', hours: 2, rate: 15 }], notes: marker() });
    const own = await pm('POST', `${PP}/daily-reports`, line(eq));
    const foreign = await pm('POST', `${PP}/daily-reports`, line(victimEquipment));
    const none = await pm('POST', `${PP}/daily-reports`, line(nowhere()));
    check(`REFUSED a priced line naming company ${VICTIM}'s equipment is answered as one naming equipment that exists nowhere${gateNote(own)}`, ok2xx(own) && is4xx(foreign) && sameAnswer(foreign, none), `${said(foreign)} | ${said(none)}`);
    const nowhereProject = nowhere();
    const ownCurrency = await pm('PATCH', `/projects/${P.id}`, { currency: 'usd' });
    for (const [label, foreignRes, noneRes] of [
      ['PATCH project currency "usd"', await pm('PATCH', `/projects/${V.id}`, { currency: 'usd' }), await pm('PATCH', `/projects/${nowhereProject}`, { currency: 'usd' })],
      ['PATCH project currency 5', await pm('PATCH', `/projects/${V.id}`, { currency: 5 }), await pm('PATCH', `/projects/${nowhereProject}`, { currency: 5 })],
      ['GET project health', await pm('GET', `/projects/${V.id}/health`), await pm('GET', `/projects/${nowhereProject}/health`)],
    ]) check(`REFUSED ${label} on company ${VICTIM}'s project is answered as on a project that exists nowhere${gateNote(ownCurrency)}`, ok2xx(ownCurrency) && is4xx(foreignRes) && sameAnswer(foreignRes, noneRes), `${said(foreignRes)} | ${said(noneRes)}`);
    const ownPatch = await planner('PATCH', `${PP}/activities/${a}`, { duration: 4 });
    for (const [label, body] of [['duration 3', { duration: 3 }], [`duration ${DAYS_MAX + 1}`, { duration: DAYS_MAX + 1 }]]) {
      const foreignRes = await planner('PATCH', `${PP}/activities/${victimActivity}`, body);
      const noneRes = await planner('PATCH', `${PP}/activities/${nowhere()}`, body);
      check(`REFUSED PATCH company ${VICTIM}'s activity ${label} is answered as an activity that exists nowhere${gateNote(ownPatch)}`, ok2xx(ownPatch) && is4xx(foreignRes) && sameAnswer(foreignRes, noneRes), `${said(foreignRes)} | ${said(noneRes)}`);
    }
    const xer = xerFile([['T1', `${STAMP}-V1`, 40], ['T2', `${STAMP}-V2`, 40]]);
    const importAt = (projectId) => planner('POST', `/projects/${projectId}/import/xer`, undefined, { form: api.multipart({ field: 'file', filename: `${STAMP}-v.xer`, contentType: 'text/plain', body: xer }) });
    const foreignImport = await importAt(V.id);
    const noneImport = await importAt(nowhereProject);
    check(`REFUSED an XER imported into company ${VICTIM}'s project is answered as into a project that exists nowhere`, is4xx(foreignImport) && sameAnswer(foreignImport, noneImport), `${said(foreignImport)} | ${said(noneImport)}`);
  }

  // ══ PERF: the working tree against f16c14f ════════════════════════════════
  section = 'perf';
  if (runs() && TIMING) {
    console.log(`\n── PERF: the legitimate requests against the baseline ${BASELINE} ──`);
    const baseline = ensureBaseline();
    console.log(`        baseline ${baseline.sha.slice(0, 12)} at ${BASELINE_DIR}${baseline.made ? ' (extracted now)' : ''}`);
    const headTree = path.join(BASELINE_DIR, 'backend');
    // Alternately, twice each; the long durations once each (the baseline's million days takes ~8 s).
    const head1 = await timeTree(headTree, { long: '100000,1000000' });
    const now1 = await timeTree(BACKEND, { long: '100000,1000000' });
    const head2 = await timeTree(headTree);
    const now2 = await timeTree(BACKEND);
    const runsOk = [head1, now1, head2, now2].every((r) => r.rows.some((row) => row.measure === 'done'));
    check('the four timing runs (baseline, working tree, baseline, working tree) completed', runsOk, [head1, now1, head2, now2].map((r) => r.tail).filter(Boolean).join(' || ').slice(0, 1500));
    const pick = (runsOf, measure, extra = () => true) => runsOf.map((r) => r.rows.find((row) => row.measure === measure && extra(row))).filter(Boolean);
    const best = (rows, key = 'ms') => (rows.length ? Math.min(...rows.map((row) => Number(row[key]))) : NaN);
    const within = (now, head) => Number.isFinite(now) && Number.isFinite(head) && now <= head * 1.25 + 30;
    const legit = [
      ['PATCH activity duration 10 (median of 7)', 'activity-patch', (row) => row.duration === 10, 'ms'],
      [`PATCH activity duration ${DAYS_MAX} (median of 7)`, 'activity-patch', (row) => row.duration === DAYS_MAX, 'ms'],
      ['GET activity at duration 10 (median of 7)', 'activity-patch', (row) => row.duration === 10, 'getMs'],
      ['GET activities of the project (median of 7)', 'activities-list', () => true, 'ms'],
      ['GET project health (median of 7)', 'health', () => true, 'ms'],
      ['POST daily report, web shape, 24 h (median of 7)', 'daily-report', () => true, 'ms'],
      ['PATCH project currency "usd" (median of 7)', 'project-patch', () => true, 'ms'],
    ];
    const table = [];
    for (const [label, measure, filter, key] of legit) {
      const head = best(pick([head1, head2], measure, filter), key);
      const now = best(pick([now1, now2], measure, filter), key);
      table.push(`${label}: f16c14f ${head} ms, now ${now} ms`);
      check(`TIMED ${label}: the working tree ${now} ms against f16c14f ${head} ms (within x1.25 + 30 ms)`, within(now, head), `${now} vs ${head}`);
    }
    const statusesOk = [...pick([head1, head2, now1, now2], 'activity-patch', (row) => row.duration === 10 || row.duration === DAYS_MAX), ...pick([head1, head2, now1, now2], 'health'), ...pick([head1, head2, now1, now2], 'project-patch')].every((row) => row.status === 200) && pick([head1, head2, now1, now2], 'daily-report').every((row) => row.status === 201);
    check('the timed legitimate requests answered alike on both trees (200, 201)', statusesOk);
    const headMillion = pick([head1], 'activity-patch', (row) => row.duration === 1_000_000)[0];
    const headHundred = pick([head1], 'activity-patch', (row) => row.duration === 100_000)[0];
    const nowMillion = pick([now1], 'activity-patch', (row) => row.duration === 1_000_000)[0];
    const nowHundred = pick([now1], 'activity-patch', (row) => row.duration === 100_000)[0];
    check(`REPRODUCED at f16c14f: PATCH duration 1,000,000 ${headMillion?.said} after ${headMillion?.ms} ms, 100,000 ${headHundred?.said} after ${headHundred?.ms} ms`, Boolean(headMillion) && (headMillion.status >= 500 || headMillion.ms > 4000) && Boolean(headHundred) && headHundred.ms > (nowHundred?.ms ?? Infinity), JSON.stringify({ headMillion, headHundred }));
    check(`FIXED: PATCH duration 1,000,000 and 100,000 are refused 400 on duration at once (${nowMillion?.ms} ms, ${nowHundred?.ms} ms)`, nowMillion?.status === 400 && nowMillion.field === 'duration' && nowMillion.ms < 500 && nowHundred?.status === 400 && nowHundred.ms < 500, JSON.stringify({ nowMillion, nowHundred }));
    const headConv = pick([head1, head2], 'conversion');
    const nowConv = pick([now1, now2], 'conversion');
    check(`TIMED the conversion: 36,500 working days ${best(headConv.map((r) => r.d36500))} ms at f16c14f, ${best(nowConv.map((r) => r.d36500))} ms now; a million ${best(headConv.map((r) => r.d1000000))} ms, now ${best(nowConv.map((r) => r.d1000000))} ms; a programme's offsets ${best(headConv, 'offsets0to119Each_us')} µs each, now ${best(nowConv, 'offsets0to119Each_us')} µs — the same dates`,
      headConv.length && nowConv.length && best(nowConv.map((r) => r.d36500)) <= 1 && best(nowConv.map((r) => r.d1000000)) <= 1 && best(nowConv, 'offsets0to119Each_us') <= best(headConv, 'offsets0to119Each_us') && headConv.every((r) => r.d36500.date === '2165-12-02' && r.d1000000.date === '5859-01-31') && nowConv.every((r) => r.d36500.date === '2165-12-02' && r.d1000000.date === '5859-01-31'), JSON.stringify({ headConv, nowConv }));
    const headThirty = pick([head1, head2], 'daily-report').map((row) => row.thirtyHours);
    const nowThirty = pick([now1, now2], 'daily-report').map((row) => row.thirtyHours);
    check(`the web daily report at 30 equipment hours: f16c14f ${headThirty.join(', ')}, now ${nowThirty.join(', ')} (round 6: 400)`, headThirty.every((s) => s.startsWith('201')) && nowThirty.length && nowThirty.every((s) => s.startsWith('201')));
    const headNumeric = pick([head1, head2], 'project-patch').map((row) => row.numericCurrency);
    const nowNumeric = pick([now1, now2], 'project-patch').map((row) => row.numericCurrency);
    check(`PATCH project currency 5: f16c14f ${headNumeric.join(', ')}, now ${nowNumeric.join(', ')}`, headNumeric.every((s) => s.startsWith('500')) && nowNumeric.length && nowNumeric.every((s) => s.startsWith('400 VALIDATION_ERROR')));
    console.log(`        ${table.join('\n        ')}`);
  }

  // ── after ────────────────────────────────────────────────────────────────
  section = 'after';
  console.log('\n── after ──');
  const attack = answers.filter((a) => !a.route.startsWith(`pm@${VICTIM}`));
  const leaked = attack.map((a) => [a, leakOf(a.text, a.sent)]).filter(([, l]) => l);
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids (beyond those it sent), names, addresses or canaries (${attack.length} answers)`, leaked.length === 0, leaked.slice(0, 6).map(([a, l]) => `${a.status} ${a.route} -> ${l}`).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check(`no answer is a server error (${answers.length} answers)`, errors.length === 0, errors.slice(0, 8).map((a) => `${a.status} ${a.route} ${firstLine(a.text).slice(0, 160)}`).join('\n        '));
  if (FINGERPRINT) {
    const after = await snapshot();
    const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
    check(`company ${VICTIM}'s data did not change (every table)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  }
  await db.end();

  const bySection = new Map();
  for (const r of results) {
    const entry = bySection.get(r.section) || { passed: 0, failed: 0 };
    entry[r.ok ? 'passed' : 'failed'] += 1;
    bySection.set(r.section, entry);
  }
  console.log('\nper section:');
  for (const [name, entry] of bySection) console.log(`  ${entry.failed ? 'FAIL' : 'ok  '}  ${name}: ${entry.passed} passed, ${entry.failed} failed`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
