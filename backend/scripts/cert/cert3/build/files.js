'use strict';

/**
 * CERT-3 builders: the programme and bill files the plan names (§3.2, §3.3
 * "Generated files"), generated from the answer book so a file can never
 * drift from the figures the proofs assert.
 *
 *   const files = require('./files');          // or lib.files
 *   const f1 = files.F1();                      // a programme model (CPM worked out here)
 *   const xer = files.xer(f1, { filename: 'CERT3-087-SCH-F1.xer' });
 *   await s.upload('import.F1', 'planner', `${b.P}/import/xer`, xer, { expect: 201, get: null });
 *
 * A programme MODEL is the format-free network: activities with their hours,
 * percent and WBS, links with their type and lag in hours, and the CPM figures
 * and dates worked out from them with the answer book's own calculators
 * (answers/schedule.js rules: hours / 8 with Math.round, the forward and
 * backward pass, the exclusive working-day finish of HR-S7). Every writer
 * emits the same model in its own units, in the shape the product's import
 * parsers read (backend/src/parsers, services/boq/excel-parser.js):
 *
 *   xer(model | [models], { encoding })   P6 XER: ERMHDR, CALENDAR, PROJECT, PROJWBS,
 *                                         TASK (hours), TASKPRED (hours), %E; CRLF.
 *                                         encoding 'win1252' gives F5's bytes.
 *   p6xml(model)                          APIBusinessObjects > Project > WBS, Activity
 *                                         (hours), Relationship (hours).
 *   mspdi(model, { uid })                 Project > Tasks > Task: summary rows per WBS,
 *                                         Duration PTnH0M0S, TotalSlack and LinkLag in
 *                                         tenths of a minute (600 per hour); numeric UIDs
 *                                         (uid: 'code' puts the activity code in UID).
 *   scheduleXlsx(model, { calendar })     first sheet: activity_code, name, wbs_code,
 *                                         start, finish, duration_days (hours / 8, not
 *                                         rounded here), predecessors ("A100, X110 FS-2"),
 *                                         percent_complete, calendar (the calendar column).
 *   progressXer(pcts)                     a progress file (TASK rows with phys_complete_pct).
 *   boqWorkbook(rows, opts)               a bill: code, description, unit, quantity,
 *                                         rate, amount, mapping_rule, section; optional
 *                                         section heading rows; `omit: ['rate']` gives the
 *                                         MISSING_COLUMNS workbook.
 *
 * Programmes from the answer book (inputs of answers/schedule.js):
 *   F1()            the 14-activity stage-2 network, start 2026-01-05, TF hours = TF x 8,
 *                   M900 early start = early finish = 2026-04-28, A200 phys_complete_pct 40.
 *                   Refuses to load if its float or the M900 date differ from the book.
 *   F1b()           A110 160 h, A140 left out (the one retirement).
 *   F1withTail()    F1 + T900 (1,600 h FS after M900), the 087-SCH tail ending in 2027.
 *   F1float5()      F1 with every file float >= 5 days (the HR-S3 reproduction file).
 *   F2()            rounding: X100..X150 = 40/80/12/20/4/3 h, lags +16/-16/+12/-12 h,
 *                   X150 total float -80 h.
 *   F3()            A 80 h, SS +16 h, B 24 h (an SS predecessor that drives the finish),
 *                   written as P6 exports it: the late pass capped at the project finish,
 *                   A TF 0 h and LF 10 (= its EF), B TF 40 h (answers WP1.T3.file /
 *                   inputs.F3file). Refuses to load if it differs from the book.
 *   F4()            two PROJECT rows: F1 and a three-activity second project (B100..B120).
 *   F5()            F1 with French names written in Windows-1252 (use xer(F5(), { encoding: 'win1252' })).
 *   F6()            F1 with a second calendar id ('2') on A300 and A330.
 * Bills: boqRows.sch087() (087-SCH, S-001..S-008), boqRows.ev() (087-EV / 052 / 006,
 * E-001..E-005), boqRows.filler({ prefix, sections }) (deterministic padding rows).
 *
 * Every writer returns { filename, body, contentType, bytes, sha256, format, model? }:
 * pass it straight to lib's s.upload(...). files.save(file, dir) writes one to disk.
 * files.selfCheck() parses every generated file with the product's own parsers and
 * compares what they read with the model (pure; no database, no request).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const XLSX = require('@e965/xlsx');
const schedule = require('../answers/schedule');
const { rngFor } = require('../../lib/spec');

const RULES = schedule.rules;
const INPUTS = schedule.inputs;

// ── file objects ────────────────────────────────────────────────────────────
const sha256 = (body) => crypto.createHash('sha256').update(body).digest('hex');
const fileOf = (filename, body, contentType, extra = {}) => ({
  filename,
  body,
  contentType,
  bytes: Buffer.byteLength(body),
  sha256: sha256(body),
  ...extra,
});

/** Writes a generated file to `dir` (created when missing); returns its path. */
const save = (file, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, file.filename);
  fs.writeFileSync(target, file.body);
  return target;
};

// ── Windows-1252 (F5) ───────────────────────────────────────────────────────
/** The characters Windows-1252 places in 0x80-0x9F; the rest of 0x00-0xFF is Latin-1. */
const WIN1252_HIGH = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91],
  [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
  [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);
const encodeWin1252 = (text) => {
  const bytes = [];
  for (const char of String(text)) {
    const cp = char.codePointAt(0);
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
    else if (WIN1252_HIGH.has(cp)) bytes.push(WIN1252_HIGH.get(cp));
    else throw new Error(`files: U+${cp.toString(16).toUpperCase().padStart(4, '0')} (${char}) has no Windows-1252 byte`);
  }
  return Buffer.from(bytes);
};

// ── the programme model ─────────────────────────────────────────────────────
const DEFAULT_CALENDAR = { id: '1', name: 'Standard 5 Day Workweek' };

/**
 * A programme model from activities and links, with CPM worked out by the
 * answer book's calculators. `tasks`: [{ code, name, wbs (a key of `wbs`),
 * hours, pct = 0, calendarId? }]; `links`: [{ pred, succ, type = 'FS',
 * lagHours = 0 }]; `floatHours`: { code: hours } overrides the file's total
 * float (default TF x 8); `calendars`: [{ id, name }], the first is the
 * project's. `capLf`: the late pass as P6 itself writes it, LF never beyond
 * the project finish (answer book rules.cpm { capLf }; F3 uses it).
 */
function programme({ name, start = INPUTS.start, wbs, tasks, links = [], floatHours = {}, calendars = [DEFAULT_CALENDAR], projectId = 'CERT3', note = null, capLf = false }) {
  if (!wbs || !Object.keys(wbs).length) throw new Error(`programme ${name}: no WBS`);
  const codes = new Set();
  for (const t of tasks) {
    if (!t.code || codes.has(t.code)) throw new Error(`programme ${name}: activity code ${t.code} missing or repeated`);
    if (!wbs[t.wbs]) throw new Error(`programme ${name}: ${t.code} names WBS ${t.wbs}, which is not in ${Object.keys(wbs).join(', ')}`);
    if (!Number.isFinite(t.hours) || t.hours < 0) throw new Error(`programme ${name}: ${t.code} hours ${t.hours}`);
    codes.add(t.code);
  }
  for (const l of links) {
    if (!codes.has(l.pred) || !codes.has(l.succ)) throw new Error(`programme ${name}: link ${l.pred} -> ${l.succ} names an activity outside the programme`);
    if (!['FS', 'SS', 'FF', 'SF'].includes(l.type || 'FS')) throw new Error(`programme ${name}: link type ${l.type}`);
  }
  const calendarIds = new Set(calendars.map((c) => c.id));
  for (const t of tasks) if (t.calendarId && !calendarIds.has(t.calendarId)) throw new Error(`programme ${name}: ${t.code} names calendar ${t.calendarId}, not one of ${[...calendarIds].join(', ')}`);

  const result = RULES.cpm(
    tasks.map((t) => ({ id: t.code, d: RULES.hoursToDays(t.hours) })),
    links.map((l) => ({ p: l.pred, s: l.succ, t: l.type || 'FS', lag: RULES.lagHoursToDays(l.lagHours || 0) })),
    { capLf },
  );
  if (result.cycle) throw new Error(`programme ${name}: the links form a cycle`);
  const date = (offset) => RULES.workingDate(start, offset, 'five_day');
  const wbsList = Object.entries(wbs).map(([key, label], index) => ({ key, index, code: label, name: label }));
  const activities = tasks.map((t, index) => {
    const r = result.rows[t.code];
    return {
      index,
      code: t.code,
      name: t.name,
      wbs: t.wbs,
      hours: t.hours,
      days: RULES.hoursToDays(t.hours),
      pct: t.pct || 0,
      milestone: t.hours === 0,
      calendarId: t.calendarId || calendars[0].id,
      es: r.ES,
      ef: r.EF,
      ls: r.LS,
      lf: r.LF,
      tf: r.TF,
      critical: r.critical,
      tfHours: Object.prototype.hasOwnProperty.call(floatHours, t.code) ? floatHours[t.code] : r.TF * 8,
      dates: { es: date(r.ES), ef: date(r.EF), ls: date(r.LS), lf: date(r.LF) },
    };
  });
  return {
    name,
    projectId,
    start,
    calendars,
    wbs: wbsList,
    activities,
    links: links.map((l) => ({ pred: l.pred, succ: l.succ, type: l.type || 'FS', lagHours: l.lagHours || 0, lagDays: RULES.lagHoursToDays(l.lagHours || 0) })),
    end: result.end,
    finishDate: date(result.end),
    note,
  };
}

/** Answer-book rows [code, name, wbs, hours, FS predecessor, pct] as tasks and links. */
const fromRows = (rows) => ({
  tasks: rows.map(([code, name, wbs, hours, , pct]) => ({ code, name, wbs, hours, pct })),
  links: rows.filter((row) => row[4]).map(([code, , , , pred]) => ({ pred, succ: code, type: 'FS', lagHours: 0 })),
});

/** F1: the stage-2 network the answer book derives every WP-1 figure from (plan §3.2 087-SCH). */
function F1() {
  const { tasks, links } = fromRows(INPUTS.F1.tasks);
  const model = programme({ name: 'F1', wbs: INPUTS.wbs, tasks, links, note: 'plan §3.2 087-SCH: the 14-activity stage-2 network in hours; TF hours = TF x 8; M900 ES = EF; A200 phys_complete_pct 40' });
  // The file cannot drift from its answers: the float it writes and M900's date are the book's.
  for (const a of model.activities) {
    const expected = INPUTS.F1.totalFloatHours[a.code];
    if (a.tfHours !== expected) throw new Error(`files.F1: ${a.code} float ${a.tfHours} h, the answer book says ${expected} h`);
  }
  const m900 = model.activities.find((a) => a.code === 'M900');
  if (m900.dates.es !== INPUTS.F1.M900EarlyStartAndFinish || m900.dates.ef !== INPUTS.F1.M900EarlyStartAndFinish) {
    throw new Error(`files.F1: M900 ${m900.dates.es}/${m900.dates.ef}, the answer book says ${INPUTS.F1.M900EarlyStartAndFinish}`);
  }
  if (model.activities.find((a) => a.code === 'A200').pct !== 40) throw new Error('files.F1: A200 must carry phys_complete_pct 40');
  return model;
}

/** F1b: A110 160 h and A140 left out (supersede, mapping, one retirement, rollback). */
function F1b() {
  const { tasks, links } = fromRows(INPUTS.F1b.tasks);
  return programme({ name: 'F1b', wbs: INPUTS.wbs, tasks, links, note: INPUTS.F1b.note });
}

/** F1 plus the 087-SCH tail activity (answer book inputs.tail087SCH). */
function F1withTail() {
  const { tasks, links } = fromRows(INPUTS.F1.tasks);
  const tail = INPUTS.tail087SCH;
  tasks.push({ code: tail.code, name: tail.name, wbs: 'ARC', hours: tail.hourlyEquivalent, pct: 0 });
  links.push({ pred: tail.predecessor, succ: tail.code, type: tail.relationship, lagHours: tail.lagDays * 8 });
  const model = programme({ name: 'F1+tail', wbs: INPUTS.wbs, tasks, links, note: 'F1 with the 087-SCH tail (T900 after M900)' });
  const t900 = model.activities.find((a) => a.code === tail.code);
  if (t900.days !== tail.durationDays) throw new Error(`files.F1withTail: T900 ${t900.days} days, the book says ${tail.durationDays}`);
  return model;
}

/** F1 with every file float at least 5 days (the HR-S3 reproduction: max(TF, 5) x 8 hours). */
function F1float5() {
  const base = F1();
  const floatHours = Object.fromEntries(base.activities.map((a) => [a.code, Math.max(a.tf, 5) * 8]));
  const { tasks, links } = fromRows(INPUTS.F1.tasks);
  return programme({ name: 'F1-float5', wbs: INPUTS.wbs, tasks, links, floatHours, note: 'HR-S3 reproduction: every file float >= 5 days' });
}

/** F2: the rounding file (answer book inputs.F2.layout). */
function F2() {
  const f2 = INPUTS.F2;
  const codes = ['X100', 'X110', 'X120', 'X130', 'X140', 'X150'];
  if (f2.durationHours.length !== codes.length || f2.lagHours.length !== 4) throw new Error('files.F2: the answer book F2 layout changed');
  const tasks = codes.map((code, i) => ({ code, name: `Rounding ${f2.durationHours[i]} h`, wbs: 'IMP', hours: f2.durationHours[i] }));
  const links = f2.lagHours.map((lagHours, i) => ({ pred: codes[i], succ: codes[i + 1], type: 'FS', lagHours }));
  return programme({ name: 'F2', wbs: { IMP: 'CERT3 Import parity' }, tasks, links, floatHours: { X150: f2.totalFloatHours }, note: f2.layout });
}

/**
 * F3: a start-to-start predecessor that drives the finish (A 80 h, SS + 16 h,
 * then B 24 h), written as P6 exports it (builders' adjudication
 * 087-SCH/087-IMP item 5, R1-2): P6's late pass ends a path with no finish
 * successor at the project finish, so A's LF is capped at its own EF (10 d)
 * and its total_float_hr_cnt is 0 h; B keeps LF 10, TF 40 h. Durations, the
 * link and the early dates are the uncapped pass's. The figures are the
 * answer book's WP1.T3.file (inputs.F3file); the model refuses to load if it
 * differs from them. (The product's own CPM after activation does not cap:
 * A TF 5, LF 15 today, the HR-S1 observation in WP1.T3.A.)
 */
function F3() {
  const f3 = INPUTS.F3;
  const file = INPUTS.F3file;
  const model = programme({
    name: 'F3',
    wbs: { IMP: 'CERT3 SS network' },
    tasks: [{ code: 'A', name: 'SS driver A', wbs: 'IMP', hours: f3.A }, { code: 'B', name: 'SS follower B', wbs: 'IMP', hours: f3.B }],
    links: [{ pred: 'A', succ: 'B', type: f3.rel, lagHours: f3.lagHours }],
    capLf: file.capLf,
    note: 'plan §3.2 087-IMP F3, as P6 exports it: the late pass capped at the project finish (answers WP1.T3.file)',
  });
  // The file cannot drift from its answers: every figure it writes is the book's.
  if (model.end !== file.projectFinish || model.finishDate !== file.projectFinishDate) {
    throw new Error(`files.F3: project finish ${model.end} (${model.finishDate}), the answer book says ${file.projectFinish} (${file.projectFinishDate})`);
  }
  for (const a of model.activities) {
    const want = file.activities[a.code];
    if (!want) throw new Error(`files.F3: ${a.code} is not in the answer book's F3 file`);
    const got = {
      ES: a.es, EF: a.ef, LS: a.ls, LF: a.lf, TF: a.tf, totalFloatHours: a.tfHours, critical: a.critical,
      earlyStartDate: a.dates.es, earlyFinishDate: a.dates.ef, lateStartDate: a.dates.ls, lateFinishDate: a.dates.lf,
    };
    for (const [k, v] of Object.entries(want)) {
      if (got[k] !== v) throw new Error(`files.F3: ${a.code} ${k} ${got[k]}, the answer book (WP1.T3.file) says ${v}`);
    }
  }
  if (model.activities.length !== Object.keys(file.activities).length) throw new Error('files.F3: activity count differs from the answer book');
  return model;
}

/** F4: an XER with two PROJECT rows: F1 and a small second project (B100..B120). Pass the array to xer(). */
function F4() {
  const second = programme({
    name: 'F4-second',
    projectId: 'CERT3-SECOND',
    wbs: { OTH: '9 Second project' },
    tasks: [
      { code: 'B100', name: 'Second project mobilisation', wbs: 'OTH', hours: 16 },
      { code: 'B110', name: 'Second project works', wbs: 'OTH', hours: 40 },
      { code: 'B120', name: 'Second project handover', wbs: 'OTH', hours: 0 },
    ],
    links: [{ pred: 'B100', succ: 'B110' }, { pred: 'B110', succ: 'B120' }],
    note: 'plan §3.2 087-IMP F4: the second PROJECT of a two-project XER',
  });
  return [{ ...F1(), projectId: 'CERT3-FIRST' }, second];
}

/** The F5 names, written to the file in Windows-1252; the expected decoded names for the proof. */
const F5_NAMES = {
  A120: 'Béton de propreté',
  A130: 'Béton armé – niveau 1',
  A330: 'Peinture et décoration – finitions',
};
function F5() {
  const { tasks, links } = fromRows(INPUTS.F1.tasks);
  for (const t of tasks) if (F5_NAMES[t.code]) t.name = F5_NAMES[t.code];
  return programme({ name: 'F5', wbs: INPUTS.wbs, tasks, links, note: 'F1 with Windows-1252 names; write with xer(F5(), { encoding: "win1252" })' });
}

/** F6: F1 with a second calendar id on A300 and A330. */
function F6() {
  const { tasks, links } = fromRows(INPUTS.F1.tasks);
  for (const t of tasks) if (t.code === 'A300' || t.code === 'A330') t.calendarId = '2';
  return programme({
    name: 'F6',
    wbs: INPUTS.wbs,
    tasks,
    links,
    calendars: [DEFAULT_CALENDAR, { id: '2', name: '6 Day Night Shift' }],
    note: 'F1 with a second clndr_id on A300 and A330',
  });
}

// ── writers ─────────────────────────────────────────────────────────────────
const xmlEscape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const num = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));
const xerDate = (iso) => `${iso} 08:00`;
const isoTime = (iso) => `${iso}T08:00:00`;
const XER_REL = { FS: 'PR_FS', SS: 'PR_SS', FF: 'PR_FF', SF: 'PR_SF' };
const P6_REL = { FS: 'Finish to Start', SS: 'Start to Start', FF: 'Finish to Finish', SF: 'Start to Finish' };
const MSP_REL = { FF: 0, FS: 1, SF: 2, SS: 3 };

/** One XER file from one model or a list of models (F4: one PROJECT row each). */
function xer(models, { filename = null, encoding = 'utf8', exportDate = null } = {}) {
  const list = Array.isArray(models) ? models : [models];
  if (!list.length) throw new Error('files.xer: no programme');
  const row = (values) => `%R\t${values.map((v) => (v === null || v === undefined ? '' : String(v))).join('\t')}`;
  const lines = [['ERMHDR', '19.12', exportDate || list[0].start, 'Project', 'admin', 'CERT3', 'dbxDatabaseNoName', 'Project Management', 'USD'].join('\t')];

  const calendars = new Map();
  for (const m of list) for (const c of m.calendars) if (!calendars.has(c.id)) calendars.set(c.id, c);
  lines.push('%T\tCALENDAR', '%F\tclndr_id\tdefault_flag\tclndr_name\tproj_id\tclndr_type\tday_hr_cnt\tweek_hr_cnt');
  [...calendars.values()].forEach((c, i) => lines.push(row([c.id, i === 0 ? 'Y' : 'N', c.name, '', 'CA_Base', 8, 40])));

  lines.push('%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date\tclndr_id');
  list.forEach((m, p) => lines.push(row([4001 + p, m.projectId, xerDate(m.start), m.calendars[0].id])));

  lines.push('%T\tPROJWBS', '%F\twbs_id\tproj_id\tparent_wbs_id\tseq_num\tproj_node_flag\twbs_short_name\twbs_name');
  list.forEach((m, p) => m.wbs.forEach((w) => lines.push(row([(p + 1) * 100 + w.index + 1, 4001 + p, '', w.index + 1, 'N', w.code, w.name]))));

  lines.push(
    '%T\tTASK',
    '%F\ttask_id\tproj_id\twbs_id\tclndr_id\tphys_complete_pct\ttask_type\tstatus_code\ttask_code\ttask_name\tremain_drtn_hr_cnt\ttarget_drtn_hr_cnt\ttotal_float_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttarget_start_date\ttarget_end_date',
  );
  const taskIdOf = (p, code) => {
    const a = list[p].activities.find((x) => x.code === code);
    return (p + 1) * 1000 + a.index + 1;
  };
  list.forEach((m, p) => {
    const wbsId = new Map(m.wbs.map((w) => [w.key, (p + 1) * 100 + w.index + 1]));
    for (const a of m.activities) {
      lines.push(row([
        taskIdOf(p, a.code), 4001 + p, wbsId.get(a.wbs), a.calendarId, num(a.pct),
        a.milestone ? 'TT_FinMile' : 'TT_Task', a.pct >= 100 ? 'TK_Complete' : a.pct > 0 ? 'TK_Active' : 'TK_NotStart',
        a.code, a.name, num((a.hours * (100 - a.pct)) / 100), num(a.hours), num(a.tfHours),
        xerDate(a.dates.es), xerDate(a.dates.ef), xerDate(a.dates.ls), xerDate(a.dates.lf), xerDate(a.dates.es), xerDate(a.dates.ef),
      ]));
    }
  });

  lines.push('%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt');
  let predId = 0;
  list.forEach((m, p) => {
    for (const l of m.links) {
      predId += 1;
      lines.push(row([9000 + predId, taskIdOf(p, l.succ), taskIdOf(p, l.pred), 4001 + p, 4001 + p, XER_REL[l.type], num(l.lagHours)]));
    }
  });
  lines.push('%E', '');
  const text = lines.join('\r\n');
  const body = encoding === 'win1252' ? encodeWin1252(text) : encoding === 'utf8' ? text : (() => { throw new Error(`files.xer: encoding ${encoding}`); })();
  return fileOf(filename || `CERT3-${list.map((m) => m.name).join('+')}.xer`, body, 'application/octet-stream', { format: 'xer', encoding, model: list.length === 1 ? list[0] : list });
}

/** A progress XER: TASK rows of the F1 activities named in `pcts` with their phys_complete_pct (format xer). */
function progressXer(pcts = INPUTS.progressFile, { filename = 'CERT3-progress.xer', base = F1() } = {}) {
  const tasks = Object.entries(pcts).map(([code, pct]) => {
    const a = base.activities.find((x) => x.code === code);
    if (!a) throw new Error(`files.progressXer: ${code} is not an activity of ${base.name}`);
    return { code: a.code, name: a.name, wbs: a.wbs, hours: a.hours, pct };
  });
  const wbsKeys = new Set(tasks.map((t) => t.wbs));
  const wbs = Object.fromEntries(base.wbs.filter((w) => wbsKeys.has(w.key)).map((w) => [w.key, w.name]));
  // The dates and float of a progress file do not matter to the import; the base programme's are kept.
  const model = programme({ name: 'progress', wbs, tasks, links: [], note: 'progress import file' });
  for (const a of model.activities) {
    const b = base.activities.find((x) => x.code === a.code);
    Object.assign(a, { es: b.es, ef: b.ef, ls: b.ls, lf: b.lf, tf: b.tf, tfHours: b.tfHours, dates: b.dates });
  }
  return { ...xer(model, { filename }), progress: pcts };
}

/** One P6 XML (APIBusinessObjects) file. Hours throughout; PhysicalPercentComplete in percent, as the parser reads it. */
function p6xml(model, { filename = null } = {}) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<APIBusinessObjects xmlns="http://xmlns.oracle.com/Primavera/P6/V19.12/API/BusinessObjects">', '  <Project>'];
  out.push(`    <ObjectId>5001</ObjectId>`, `    <Id>${xmlEscape(model.projectId)}</Id>`, `    <Name>${xmlEscape(model.name)}</Name>`, `    <PlannedStartDate>${isoTime(model.start)}</PlannedStartDate>`);
  for (const w of model.wbs) out.push(`    <WBS><ObjectId>${101 + w.index}</ObjectId><Code>${xmlEscape(w.code)}</Code><Name>${xmlEscape(w.name)}</Name><SequenceNumber>${w.index + 1}</SequenceNumber></WBS>`);
  const wbsObject = new Map(model.wbs.map((w) => [w.key, 101 + w.index]));
  const objectOf = (code) => 1001 + model.activities.find((a) => a.code === code).index;
  for (const a of model.activities) {
    out.push(
      '    <Activity>'
        + `<ObjectId>${objectOf(a.code)}</ObjectId><Id>${xmlEscape(a.code)}</Id><Name>${xmlEscape(a.name)}</Name>`
        + `<WBSObjectId>${wbsObject.get(a.wbs)}</WBSObjectId><CalendarObjectId>${xmlEscape(a.calendarId)}</CalendarObjectId>`
        + `<Type>${a.milestone ? 'Finish Milestone' : 'Task Dependent'}</Type>`
        + `<PlannedDuration>${num(a.hours)}</PlannedDuration><RemainingDuration>${num((a.hours * (100 - a.pct)) / 100)}</RemainingDuration>`
        + `<PhysicalPercentComplete>${num(a.pct)}</PhysicalPercentComplete>`
        + `<EarlyStartDate>${isoTime(a.dates.es)}</EarlyStartDate><EarlyFinishDate>${isoTime(a.dates.ef)}</EarlyFinishDate>`
        + `<LateStartDate>${isoTime(a.dates.ls)}</LateStartDate><LateFinishDate>${isoTime(a.dates.lf)}</LateFinishDate>`
        + `<TotalFloat>${num(a.tfHours)}</TotalFloat>`
        + '</Activity>',
    );
  }
  model.links.forEach((l, i) => {
    out.push(`    <Relationship><ObjectId>${7001 + i}</ObjectId><PredecessorActivityObjectId>${objectOf(l.pred)}</PredecessorActivityObjectId><SuccessorActivityObjectId>${objectOf(l.succ)}</SuccessorActivityObjectId><Type>${P6_REL[l.type]}</Type><Lag>${num(l.lagHours)}</Lag></Relationship>`);
  });
  out.push('  </Project>', '</APIBusinessObjects>', '');
  return fileOf(filename || `CERT3-${model.name}.xml`, out.join('\n'), 'application/xml', { format: 'p6xml', model });
}

/** One MSPDI (Microsoft Project XML) file. */
function mspdi(model, { filename = null, uid = 'numeric' } = {}) {
  if (!['numeric', 'code'].includes(uid)) throw new Error(`files.mspdi: uid ${uid}`);
  const TENTHS_PER_HOUR = 600;
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<Project xmlns="http://schemas.microsoft.com/project">'];
  out.push(`  <Name>${xmlEscape(model.name)}</Name>`, `  <StartDate>${isoTime(model.start)}</StartDate>`, '  <MinutesPerDay>480</MinutesPerDay>', '  <MinutesPerWeek>2400</MinutesPerWeek>', '  <DaysPerMonth>20</DaysPerMonth>', '  <Tasks>');
  out.push(`    <Task><UID>0</UID><ID>0</ID><Name>${xmlEscape(model.name)}</Name><OutlineNumber>0</OutlineNumber><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>`);
  let serial = 0;
  const uidOf = new Map();
  for (const w of model.wbs) {
    serial += 1;
    out.push(`    <Task><UID>${serial}</UID><ID>${serial}</ID><Name>${xmlEscape(w.name)}</Name><WBS>${w.index + 1}</WBS><OutlineNumber>${w.index + 1}</OutlineNumber><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task>`);
  }
  const perWbs = new Map();
  const idOf = new Map();
  for (const a of model.activities) {
    serial += 1;
    uidOf.set(a.code, uid === 'code' ? a.code : String(serial));
    idOf.set(a.code, serial);
  }
  for (const a of model.activities) {
    const w = model.wbs.find((x) => x.key === a.wbs);
    const n = (perWbs.get(w.key) || 0) + 1;
    perWbs.set(w.key, n);
    const preds = model.links.filter((l) => l.succ === a.code).map((l) => `<PredecessorLink><PredecessorUID>${xmlEscape(uidOf.get(l.pred))}</PredecessorUID><Type>${MSP_REL[l.type]}</Type><CrossProject>0</CrossProject><LinkLag>${Math.round(l.lagHours * TENTHS_PER_HOUR)}</LinkLag><LagFormat>5</LagFormat></PredecessorLink>`).join('');
    out.push(
      `    <Task><UID>${xmlEscape(uidOf.get(a.code))}</UID><ID>${idOf.get(a.code)}</ID><Name>${xmlEscape(a.name)}</Name><WBS>${w.index + 1}.${n}</WBS><OutlineNumber>${w.index + 1}.${n}</OutlineNumber><OutlineLevel>2</OutlineLevel>`
        + `<Summary>0</Summary><Milestone>${a.milestone ? 1 : 0}</Milestone><Duration>PT${num(a.hours)}H0M0S</Duration><DurationFormat>7</DurationFormat>`
        + `<Start>${isoTime(a.dates.es)}</Start><Finish>${isoTime(a.dates.ef)}</Finish><PercentComplete>${num(a.pct)}</PercentComplete>`
        + `<TotalSlack>${Math.round(a.tfHours * TENTHS_PER_HOUR)}</TotalSlack>${preds}</Task>`,
    );
  }
  out.push('  </Tasks>', '</Project>', '');
  return fileOf(filename || `CERT3-${model.name}.mspdi.xml`, out.join('\n'), 'application/xml', { format: 'msp', uids: Object.fromEntries(uidOf), model });
}

const xlsxBuffer = (rows, sheetName) => {
  const book = XLSX.utils.book_new();
  book.Props = { Title: sheetName, Author: 'CERT3 builder', CreatedDate: new Date('2026-01-05T00:00:00Z') };
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName.slice(0, 31));
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true });
};

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The programme as a schedule workbook with a calendar column (POST /import/xlsx). Durations and lags in days = hours / 8. */
function scheduleXlsx(model, { filename = null, calendar = 'five_day', calendarColumn = true } = {}) {
  const header = ['activity_code', 'name', 'wbs_code', 'start', 'finish', 'duration_days', 'predecessors', 'percent_complete', ...(calendarColumn ? ['calendar'] : [])];
  const rows = [header];
  for (const a of model.activities) {
    const preds = model.links.filter((l) => l.succ === a.code).map((l) => {
      const lag = l.lagHours / 8;
      if (l.type === 'FS' && lag === 0) return l.pred;
      return `${l.pred} ${l.type}${lag < 0 ? '-' : '+'}${num(Math.abs(lag))}`;
    });
    const calendarCell = typeof calendar === 'function' ? calendar(a) : calendar;
    rows.push([a.code, a.name, model.wbs.find((w) => w.key === a.wbs).code, a.dates.es, a.dates.ef, a.hours / 8, preds.join(', '), a.pct, ...(calendarColumn ? [calendarCell] : [])]);
  }
  return fileOf(filename || `CERT3-${model.name}.xlsx`, xlsxBuffer(rows, 'Programme'), XLSX_TYPE, { format: 'xlsx', model });
}

// ── bills of quantities ─────────────────────────────────────────────────────
/** The answer book's mapping words to the workbook's mapping_rule column (excel-parser MAPPING_RULE_ALIASES). */
const MAPPING_RULE_CELL = { in_scope: 'required', required: 'required', optional: 'optional', not_applicable: 'not_applicable' };

const boqRow = (row) => ({
  code: row.code,
  description: row.description,
  quantity: row.quantity,
  unit: row.unit,
  rate: row.rate,
  mappingRule: row.mappingRule || null,
  section: row.section || null,
  allocations: row.allocations || [],
  ...(row.coveredAtBaselineBy ? { coveredAtBaselineBy: row.coveredAtBaselineBy } : {}),
});

const boqRows = {
  /** 087-SCH's bill (answer book inputs.boq087SCH): S-001..S-008 with allocations and mapping rules. */
  sch087: () => INPUTS.boq087SCH.map(boqRow),
  /** 087-EV's bill, also 052-SCH-EV's and 006-LITE's (inputs.ev087.boq): E-001..E-005, each allocated whole. */
  ev: () => INPUTS.ev087.boq.map(boqRow),
  /**
   * Deterministic padding rows: `sections` [{ name, count }], codes
   * `<prefix><section no>-<nnn>`, units, quantities and two-decimal rates
   * from a seeded source (the same call always gives the same rows).
   */
  filler: ({ prefix = 'F', sections, seed = 'cert3-boq-filler', mappingRule = 'required' }) => {
    const rng = rngFor(seed);
    const units = ['m3', 'm2', 't', 'nr', 'm', 'kg'];
    const rows = [];
    sections.forEach(({ name, count }, s) => {
      for (let i = 1; i <= count; i += 1) {
        rows.push(boqRow({
          code: `${prefix}${s + 1}-${String(i).padStart(3, '0')}`,
          description: `${name}: item ${i}`,
          unit: units[(s + i) % units.length],
          quantity: rng.int(1, 400) * 5,
          rate: rng.int(500, 50_000) / 100,
          mappingRule,
          section: name,
        }));
      }
    });
    return rows;
  },
};

/**
 * A bill workbook (POST /projects/:id/boq/upload). `rows` [{ code, description,
 * unit, quantity, rate, mappingRule?, section? }]. Options: title (a first row
 * above the header), sectionHeadings (a heading row before each section; the
 * parser skips rows with neither quantity nor rate), sectionColumn,
 * mappingRuleColumn, omit (column names left out, e.g. ['rate']).
 */
function boqWorkbook(rows, { filename = 'CERT3-boq.xlsx', title = null, sectionHeadings = true, sectionColumn = true, mappingRuleColumn = true, omit = [] } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('files.boqWorkbook: no rows');
  const codes = new Set();
  for (const r of rows) {
    if (!r.code || codes.has(r.code)) throw new Error(`files.boqWorkbook: code ${r.code} missing or repeated`);
    codes.add(r.code);
    if (r.mappingRule && !MAPPING_RULE_CELL[r.mappingRule]) throw new Error(`files.boqWorkbook: ${r.code} mapping rule ${r.mappingRule}`);
  }
  const columns = ['code', 'description', 'unit', 'quantity', 'rate', 'amount', ...(mappingRuleColumn ? ['mapping_rule'] : []), ...(sectionColumn ? ['section'] : [])].filter((c) => !omit.includes(c));
  const sheet = [];
  if (title) sheet.push([title]);
  sheet.push(columns);
  let section = null;
  let sectionNo = 0;
  for (const r of rows) {
    if (sectionHeadings && r.section && r.section !== section) {
      sectionNo += 1;
      section = r.section;
      sheet.push([`SECTION ${sectionNo}: ${r.section}`]);
    }
    const amount = Number((Number(r.quantity) * Number(r.rate)).toFixed(2));
    const cell = { code: r.code, description: r.description, unit: r.unit, quantity: r.quantity, rate: r.rate, amount, mapping_rule: r.mappingRule ? MAPPING_RULE_CELL[r.mappingRule] : '', section: r.section || '' };
    sheet.push(columns.map((c) => cell[c]));
  }
  const totalCents = rows.reduce((sum, r) => sum + Math.round(Number(r.quantity) * Number(r.rate) * 100), 0);
  return fileOf(filename, xlsxBuffer(sheet, 'BOQ'), XLSX_TYPE, { format: 'boq-xlsx', rows: rows.length, totalCents, columns, sections: [...new Set(rows.map((r) => r.section).filter(Boolean))] });
}

// ── self check against the product's parsers (pure: no database, no request) ─
/**
 * Parses each generated file with the product's own parser and compares what
 * it reads with the model: codes, hours -> days, links and lags, float, dates
 * (as working-day offsets would read them), names (F5 decoded as Windows-1252).
 * Returns [{ file, ok, detail }]. Loads backend/src/parsers and the BOQ excel
 * parser only; no database, no application.
 */
async function selfCheck() {
  /* eslint-disable global-require */
  const xerParser = require('../../../../src/parsers/xer-parser');
  const { parseP6Xml } = require('../../../../src/parsers/p6xml-parser');
  const msp = require('../../../../src/parsers/msp-parser');
  const { parseScheduleXlsx } = require('../../../../src/parsers/schedule-xlsx-parser');
  const boqParser = require('../../../../src/services/boq/excel-parser');
  /* eslint-enable global-require */
  const results = [];
  const record = (file, problems, extra = '') => results.push({ file, ok: problems.length === 0, detail: problems.length ? problems.slice(0, 8).join('; ') : `ok${extra ? ` (${extra})` : ''}` });
  const relKey = (p, s, t, lag) => `${p}>${s}:${t}${lag >= 0 ? '+' : ''}${lag}`;
  const modelLinks = (m) => m.links.map((l) => relKey(l.pred, l.succ, l.type, l.lagDays)).sort();

  const checkXer = (name, model, file, { decode = 'utf8' } = {}) => {
    const text = decode === 'win1252' ? file.body.toString('latin1').replace(/[\u0080-\u009f]/g, (c) => String.fromCodePoint([...WIN1252_HIGH].find(([, b]) => b === c.charCodeAt(0))?.[0] ?? c.charCodeAt(0))) : String(file.body);
    const tables = xerParser.parseXer(text);
    const { activities } = xerParser.extractActivities(tables);
    const rels = xerParser.extractRelationships(tables);
    const problems = [];
    const byCode = new Map(activities.map((a) => [a.p6ActivityId, a]));
    const byTask = new Map(activities.map((a) => [a.sourceTaskId, a.p6ActivityId]));
    for (const a of model.activities) {
      const got = byCode.get(a.code);
      if (!got) { problems.push(`${a.code} missing`); continue; }
      if (got.originalDuration !== a.days) problems.push(`${a.code} duration ${got.originalDuration} != ${a.days}`);
      if (got.totalFloat !== RULES.hoursToDays(a.tfHours)) problems.push(`${a.code} float ${got.totalFloat} != ${RULES.hoursToDays(a.tfHours)}`);
      if (got.physComplete !== a.pct) problems.push(`${a.code} pct ${got.physComplete} != ${a.pct}`);
      if (got.name !== a.name) problems.push(`${a.code} name ${JSON.stringify(got.name)} != ${JSON.stringify(a.name)}`);
      if (got.calendarId !== a.calendarId) problems.push(`${a.code} calendar ${got.calendarId} != ${a.calendarId}`);
    }
    const links = rels.map((r) => relKey(byTask.get(r.predTaskId), byTask.get(r.succTaskId), r.relType, r.lagDays)).sort();
    if (JSON.stringify(links) !== JSON.stringify(modelLinks(model))) problems.push(`links ${links.join(',')} != ${modelLinks(model).join(',')}`);
    record(name, problems, `${activities.length} activities, ${rels.length} links`);
  };

  const f1 = F1();
  checkXer('F1.xer', f1, xer(f1));
  checkXer('F1b.xer', F1b(), xer(F1b()));
  checkXer('F1withTail.xer', F1withTail(), xer(F1withTail()));
  checkXer('F1float5.xer', F1float5(), xer(F1float5()));
  checkXer('F2.xer', F2(), xer(F2()));
  checkXer('F3.xer', F3(), xer(F3()));
  checkXer('F5.xer (win1252)', F5(), xer(F5(), { encoding: 'win1252' }), { decode: 'win1252' });
  checkXer('F6.xer', F6(), xer(F6()));
  {
    const [first, second] = F4();
    const tables = xerParser.parseXer(String(xer([first, second]).body));
    const problems = [];
    if ((tables.PROJECT || []).length !== 2) problems.push(`PROJECT rows ${(tables.PROJECT || []).length}`);
    const n = xerParser.extractActivities(tables).activities.length;
    if (n !== first.activities.length + second.activities.length) problems.push(`activities ${n}`);
    record('F4.xer (two projects)', problems, `${n} activities over 2 PROJECT rows`);
  }
  {
    const file = progressXer();
    const { activities } = xerParser.extractActivities(xerParser.parseXer(String(file.body)));
    const got = Object.fromEntries(activities.map((a) => [a.p6ActivityId, a.physComplete]));
    record('progress.xer', JSON.stringify(got) === JSON.stringify(INPUTS.progressFile) ? [] : [`read ${JSON.stringify(got)}`], JSON.stringify(got));
  }
  {
    const strict = (bytes) => { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; } };
    const bytes = xer(F5(), { encoding: 'win1252' }).body;
    record('F5.xer is not UTF-8', strict(bytes) ? ['the Windows-1252 file decodes as valid UTF-8'] : [], 'a UTF-8 reader sees replacement characters');
  }

  {
    // F3 as P6 exports it, read back by the product's parsers against the answer book's
    // file figures (WP1.T3.file / inputs.F3file), not against the model alone: A file TF 0 h,
    // LF 10 (= its EF), B TF 40 h; the early dates and the SS +16 h link unchanged; one
    // staged critical row (import.service.js isCritical = round(file TF days) === 0).
    const want = INPUTS.F3file.activities;
    const pad = (n) => String(n).padStart(2, '0');
    // xer-parser parseMaybeDate reads 'YYYY-MM-DD 08:00' as a local time: compare the local day.
    const localDay = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null);
    const problems = [];
    const model = F3();
    const xerFile = xer(model);
    const tables = xerParser.parseXer(String(xerFile.body));
    const { activities } = xerParser.extractActivities(tables);
    for (const [code, w] of Object.entries(want)) {
      const raw = (tables.TASK || []).find((t) => t.task_code === code);
      if (!raw) { problems.push(`xer ${code} TASK row missing`); continue; }
      if (Number(raw.total_float_hr_cnt) !== w.totalFloatHours) problems.push(`xer ${code} total_float_hr_cnt ${raw.total_float_hr_cnt} != ${w.totalFloatHours}`);
      const got = activities.find((a) => a.p6ActivityId === code);
      if (got.totalFloat !== w.TF) problems.push(`xer ${code} float ${got.totalFloat} d != ${w.TF}`);
      for (const [field, key] of [['earlyStartDate', 'earlyStartDate'], ['earlyFinishDate', 'earlyFinishDate'], ['lateStartDate', 'lateStartDate'], ['lateFinishDate', 'lateFinishDate']]) {
        if (localDay(got[field]) !== w[key]) problems.push(`xer ${code} ${field} ${localDay(got[field])} != ${w[key]}`);
      }
    }
    const rel = xerParser.extractRelationships(tables);
    if (rel.length !== 1 || rel[0].relType !== INPUTS.F3.rel || rel[0].lagDays !== RULES.lagHoursToDays(INPUTS.F3.lagHours)) problems.push(`xer link ${JSON.stringify(rel)}`);
    const stagedCritical = activities.filter((a) => Math.round(Number(a.totalFloat) || 0) === 0).map((a) => a.p6ActivityId);
    if (JSON.stringify(stagedCritical) !== JSON.stringify(['A'])) problems.push(`staged critical ${JSON.stringify(stagedCritical)} != ["A"]`);
    const p6 = await parseP6Xml(String(p6xml(model).body));
    for (const [code, w] of Object.entries(want)) {
      const got = p6.activities.find((x) => x.p6ActivityId === code);
      if (!got) { problems.push(`p6xml ${code} missing`); continue; }
      if (got.totalFloatHours !== w.totalFloatHours) problems.push(`p6xml ${code} TotalFloat ${got.totalFloatHours} != ${w.totalFloatHours}`);
      if (String(got.lateStart).slice(0, 10) !== w.lateStartDate || String(got.lateFinish).slice(0, 10) !== w.lateFinishDate) problems.push(`p6xml ${code} late ${got.lateStart}/${got.lateFinish}`);
      if (String(got.earlyStart).slice(0, 10) !== w.earlyStartDate || String(got.earlyFinish).slice(0, 10) !== w.earlyFinishDate) problems.push(`p6xml ${code} early ${got.earlyStart}/${got.earlyFinish}`);
    }
    const mspFile = mspdi(model);
    const msp1 = await msp.parseMspXml(String(mspFile.body));
    for (const [code, w] of Object.entries(want)) {
      const got = msp1.tasks.find((t) => t.uid === mspFile.uids[code]);
      if (!got) { problems.push(`mspdi ${code} missing`); continue; }
      if (got.totalSlackMinutes !== w.totalFloatHours * 600) problems.push(`mspdi ${code} TotalSlack ${got.totalSlackMinutes} != ${w.totalFloatHours * 600}`);
    }
    record('F3 as P6 exports it (answers WP1.T3.file)', problems, `A TF ${want.A.totalFloatHours} h LF ${want.A.lateFinishDate}, B TF ${want.B.totalFloatHours} h; staged critical ${JSON.stringify(stagedCritical)}`);
  }

  for (const [name, model] of [['F1', f1], ['F2', F2()], ['F3', F3()]]) {
    const parsed = await parseP6Xml(String(p6xml(model).body));
    const problems = [];
    const byObject = new Map(parsed.activities.map((a) => [a.sourceActivityId, a.p6ActivityId]));
    for (const a of model.activities) {
      const got = parsed.activities.find((x) => x.p6ActivityId === a.code);
      if (!got) { problems.push(`${a.code} missing`); continue; }
      if (RULES.hoursToDays(got.plannedDurationHours) !== a.days) problems.push(`${a.code} duration`);
      if (RULES.hoursToDays(got.totalFloatHours) !== RULES.hoursToDays(a.tfHours)) problems.push(`${a.code} float`);
      if (got.physComplete !== a.pct) problems.push(`${a.code} pct ${got.physComplete}`);
    }
    const links = parsed.relationships.map((r) => relKey(byObject.get(r.predId), byObject.get(r.succId), r.type, r.lagDays)).sort();
    if (JSON.stringify(links) !== JSON.stringify(modelLinks(model))) problems.push(`links ${links.join(',')}`);
    if (parsed.wbsNodes.length !== model.wbs.length) problems.push(`wbs ${parsed.wbsNodes.length}`);
    record(`${name}.p6.xml`, problems, `${parsed.activities.length} activities, ${parsed.relationships.length} links`);
  }

  for (const [name, model] of [['F1', f1], ['F2', F2()], ['F3', F3()]]) {
    const file = mspdi(model);
    const parsed = await msp.parseMspXml(String(file.body));
    const work = parsed.tasks.filter((t) => !t.isSummary && t.uid !== '0' && t.name);
    const problems = [];
    const codeOfUid = Object.fromEntries(Object.entries(file.uids).map(([code, uid]) => [uid, code]));
    for (const a of model.activities) {
      const got = work.find((t) => t.uid === file.uids[a.code]);
      if (!got) { problems.push(`${a.code} missing`); continue; }
      if (msp.parseDurationDays(got.durationIso) !== a.days) problems.push(`${a.code} duration ${msp.parseDurationDays(got.durationIso)}`);
      if (msp.tenthsOfMinutesToDays(got.totalSlackMinutes) !== Math.round(a.tfHours / 8)) problems.push(`${a.code} slack`);
    }
    const links = work.flatMap((t) => t.predecessors.map((p) => relKey(codeOfUid[p.predUid], codeOfUid[t.uid], p.type, msp.parseLagDays(p.lagDurationIso)))).sort();
    // MSPDI lags are Math.round(tenths / 4800), the same as XER's Math.round(h / 8).
    if (JSON.stringify(links) !== JSON.stringify(modelLinks(model))) problems.push(`links ${links.join(',')}`);
    if (work.length !== model.activities.length) problems.push(`work tasks ${work.length}`);
    record(`${name}.mspdi.xml`, problems, `${work.length} work tasks`);
  }

  for (const [name, model] of [['F1', f1], ['F3', F3()]]) {
    const file = scheduleXlsx(model);
    const parsed = parseScheduleXlsx(file.body);
    const problems = [];
    for (const a of model.activities) {
      const got = parsed.activities.find((x) => x.p6ActivityId === a.code);
      if (!got) { problems.push(`${a.code} missing`); continue; }
      if (got.originalDuration !== Math.round(a.hours / 8)) problems.push(`${a.code} duration ${got.originalDuration}`);
      if (got.calendarId !== 'five_day') problems.push(`${a.code} calendar ${got.calendarId}`);
    }
    const links = parsed.relationships.map((r) => relKey(r.predTaskId, r.succTaskId, r.relType, r.lagDays)).sort();
    if (JSON.stringify(links) !== JSON.stringify(modelLinks(model))) problems.push(`links ${links.join(',')}`);
    if (parsed.issues.length) problems.push(`issues ${parsed.issues.map((i) => i.code).join(',')}`);
    record(`${name}.xlsx`, problems, `${parsed.activities.length} activities, calendar column ${parsed.columns.calendar !== undefined}`);
  }

  for (const [name, rows, opts] of [
    ['boq sch087', boqRows.sch087(), {}],
    ['boq ev', boqRows.ev(), {}],
    ['boq 130 rows', boqRows.filler({ prefix: 'C', sections: [{ name: 'Substructure', count: 50 }, { name: 'Superstructure', count: 50 }, { name: 'Finishes', count: 30 }] }), { title: 'CERT3 bill' }],
  ]) {
    const file = boqWorkbook(rows, opts);
    const parsed = boqParser.parseWorkbookRows(XLSX.read(file.body, { type: 'buffer' }));
    const verdict = boqParser.validateBoqRows(parsed);
    const problems = [];
    if (!verdict.valid) problems.push(`invalid: ${JSON.stringify(verdict.errors.slice(0, 3))}`);
    if (parsed.length !== rows.length) problems.push(`rows ${parsed.length} != ${rows.length}`);
    const cents = parsed.reduce((s, r) => s + Math.round(Number(r.quantity) * Number(r.rate) * 100), 0);
    if (cents !== file.totalCents) problems.push(`total ${cents} != ${file.totalCents}`);
    for (const r of rows) {
      const got = parsed.find((p) => p.code === r.code);
      if (r.mappingRule && got?.mappingRule !== MAPPING_RULE_CELL[r.mappingRule]) problems.push(`${r.code} mapping ${got?.mappingRule}`);
    }
    record(name, problems, `${parsed.length} rows, ${(file.totalCents / 100).toFixed(2)}`);
  }
  {
    let code = null;
    try {
      boqParser.parseWorkbookRows(XLSX.read(boqWorkbook(boqRows.ev(), { omit: ['rate'] }).body, { type: 'buffer' }));
    } catch (error) {
      code = `${error.status} ${error.code} ${error.details?.errors?.[0]?.code}`;
    }
    record('boq without rate', code === '400 BOQ_VALIDATION_FAILED MISSING_COLUMNS' ? [] : [`answered ${code}`], code);
  }
  return results;
}

module.exports = {
  F5_NAMES,
  MAPPING_RULE_CELL,
  F1,
  F1b,
  F1float5,
  F1withTail,
  F2,
  F3,
  F4,
  F5,
  F6,
  boqRows,
  boqWorkbook,
  encodeWin1252,
  mspdi,
  p6xml,
  programme,
  progressXer,
  save,
  scheduleXlsx,
  selfCheck,
  xer,
};
