/**
 * Schedule workbook parser (PC-2).
 *
 * Reads a programme from an Excel sheet into the same intermediate shape the
 * XER and MSPDI parsers hand to import.service — activities keyed by code,
 * relationships between codes, a WBS node list — so the staged revision,
 * activation mapping and readiness checks are shared with the other formats.
 *
 * Column contract (first sheet; the header row is found within the first ten
 * rows; names are matched case-insensitively and the aliases below apply):
 *
 *   activity_code     required   unique within the file; becomes the activity code
 *   name              required
 *   wbs_code          optional   dotted path such as 1.2.3 — every prefix becomes a WBS node
 *   start             optional   Excel date, ISO date, or D/M/YYYY
 *   finish            optional   as above
 *   duration_days     optional   working days; derived from start/finish (calendar days) when absent
 *   predecessors      optional   "A100, A110FS+2, A120 SS -1" — code, optional type, optional lag in days
 *   percent_complete  optional   0-100
 *   calendar          optional   kept as the raw calendar id; mapping to a project calendar is a later step
 *
 * Total float is computed here with a plain critical-path pass over the
 * relationships (working days, no calendar), the way XER and MSPDI files
 * carry their own float, so a staged revision can say which activities are
 * critical before it is activated.
 *
 * Row problems that make the file unusable (missing code or name, duplicate
 * codes, unparseable duration) are thrown together as one 400. Problems the
 * import can live with (an unknown predecessor, a derived duration) come back
 * as `issues` so a dry run can list them.
 */
const XLSX = require('@e965/xlsx');
const { HttpError } = require('../utils/http-error');

const REQUIRED_COLUMNS = ['activity_code', 'name'];
const KNOWN_COLUMNS = [
  'activity_code',
  'name',
  'wbs_code',
  'start',
  'finish',
  'duration_days',
  'predecessors',
  'percent_complete',
  'calendar',
];

const HEADER_ALIASES = {
  'activity code': 'activity_code',
  'activity id': 'activity_code',
  'activity_id': 'activity_code',
  'task code': 'activity_code',
  'task id': 'activity_code',
  code: 'activity_code',
  id: 'activity_code',
  'activity name': 'name',
  'task name': 'name',
  activity: 'name',
  task: 'name',
  description: 'name',
  wbs: 'wbs_code',
  'wbs code': 'wbs_code',
  'wbs path': 'wbs_code',
  'start date': 'start',
  'early start': 'start',
  'planned start': 'start',
  'finish date': 'finish',
  'end date': 'finish',
  end: 'finish',
  'early finish': 'finish',
  'planned finish': 'finish',
  duration: 'duration_days',
  'duration (days)': 'duration_days',
  'duration days': 'duration_days',
  'original duration': 'duration_days',
  days: 'duration_days',
  predecessor: 'predecessors',
  preds: 'predecessors',
  pred: 'predecessors',
  'predecessor codes': 'predecessors',
  'percent complete': 'percent_complete',
  '% complete': 'percent_complete',
  'pct complete': 'percent_complete',
  progress: 'percent_complete',
  'calendar id': 'calendar',
  clndr: 'calendar',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const normalizeHeader = (header) =>
  String(header ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

const trimOrNull = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

/**
 * A cell as a date, or null. Excel keeps dates as serial numbers unless the
 * reader is asked for Date objects (it is), text may still be ISO or the
 * day-first form common on printed programmes.
 */
function parseCellDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0));
  }
  const text = String(value).trim();
  if (!text) return null;
  const dayFirst = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dayFirst) {
    const [, day, month, year] = dayFirst;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePercent(value) {
  if (value === null || value === undefined || value === '') return 0;
  let number = Number(String(value).replace('%', '').trim());
  if (!Number.isFinite(number)) return 0;
  // A cell formatted as a percentage reads as a fraction.
  if (number > 0 && number <= 1 && !String(value).includes('%')) number *= 100;
  return Math.max(0, Math.min(100, number));
}

const REL_TYPES = new Set(['FS', 'SS', 'FF', 'SF']);
const PRED_TOKEN =
  /^(\S+?)\s*(?:[:\s]?(FS|SS|FF|SF))?\s*(?:([+-])\s*(\d+(?:\.\d+)?)\s*(?:wd|d|days?)?)?$/i;

/**
 * "A100, A110FS+2, A120 SS -1" → one relationship per token. A token that is
 * exactly an activity code is a plain finish-to-start link, even when the
 * code happens to end in letters that look like a relationship type.
 */
function parsePredecessors(text, knownCodes) {
  const tokens = String(text ?? '')
    .split(/[,;\n]/)
    .map((token) => token.trim())
    .filter(Boolean);
  const relationships = [];
  const unknown = [];

  for (const token of tokens) {
    if (knownCodes.has(token)) {
      relationships.push({ predCode: token, relType: 'FS', lagDays: 0 });
      continue;
    }
    const match = token.match(PRED_TOKEN);
    if (!match) {
      unknown.push(token);
      continue;
    }
    const [, code, type, sign, lag] = match;
    if (!knownCodes.has(code)) {
      unknown.push(token);
      continue;
    }
    const relType = String(type || 'FS').toUpperCase();
    const lagDays = lag ? Math.round(Number(lag)) * (sign === '-' ? -1 : 1) : 0;
    relationships.push({
      predCode: code,
      relType: REL_TYPES.has(relType) ? relType : 'FS',
      lagDays,
    });
  }

  return { relationships, unknown };
}

/** Every prefix of a dotted WBS path is a node; "1.2.3" yields 1, 1.2 and 1.2.3. */
function buildWbsNodes(paths) {
  const nodes = new Map();
  for (const path of paths) {
    const parts = String(path).split('.').map((part) => part.trim()).filter(Boolean);
    let parent = null;
    let code = '';
    for (const part of parts) {
      code = code ? `${code}.${part}` : part;
      if (!nodes.has(code)) {
        nodes.set(code, {
          wbsId: code,
          parentWbsId: parent,
          name: code,
          code,
          seqNum: nodes.size + 1,
        });
      }
      parent = code;
    }
  }
  return [...nodes.values()];
}

/**
 * Early/late pass in working days over the four relationship types with lags.
 * Returns total float per code, or null for every activity when the logic
 * loops (a cycle has no schedule).
 */
function computeTotalFloat(activities, relationships) {
  const byCode = new Map(activities.map((activity) => [activity.code, activity]));
  const successors = new Map(activities.map((activity) => [activity.code, []]));
  const indegree = new Map(activities.map((activity) => [activity.code, 0]));
  for (const rel of relationships) {
    successors.get(rel.predCode).push(rel);
    indegree.set(rel.succCode, indegree.get(rel.succCode) + 1);
  }

  const order = [];
  const queue = activities.filter((activity) => indegree.get(activity.code) === 0).map((activity) => activity.code);
  while (queue.length) {
    const code = queue.shift();
    order.push(code);
    for (const rel of successors.get(code)) {
      indegree.set(rel.succCode, indegree.get(rel.succCode) - 1);
      if (indegree.get(rel.succCode) === 0) queue.push(rel.succCode);
    }
  }
  if (order.length !== activities.length) return { floats: null, cyclic: true };

  const es = new Map();
  const ef = new Map();
  for (const code of order) {
    const duration = byCode.get(code).duration;
    let start = 0;
    for (const rel of relationships) {
      if (rel.succCode !== code) continue;
      const predStart = es.get(rel.predCode);
      const predFinish = ef.get(rel.predCode);
      const candidate =
        rel.relType === 'SS'
          ? predStart + rel.lagDays
          : rel.relType === 'FF'
            ? predFinish + rel.lagDays - duration
            : rel.relType === 'SF'
              ? predStart + rel.lagDays - duration
              : predFinish + rel.lagDays;
      start = Math.max(start, candidate);
    }
    es.set(code, start);
    ef.set(code, start + duration);
  }

  const projectFinish = Math.max(0, ...ef.values());
  const lf = new Map();
  const ls = new Map();
  for (const code of [...order].reverse()) {
    const duration = byCode.get(code).duration;
    let finish = projectFinish;
    for (const rel of successors.get(code)) {
      const succStart = ls.get(rel.succCode);
      const succFinish = lf.get(rel.succCode);
      const candidate =
        rel.relType === 'SS'
          ? succStart - rel.lagDays + duration
          : rel.relType === 'FF'
            ? succFinish - rel.lagDays
            : rel.relType === 'SF'
              ? succFinish - rel.lagDays + duration
              : succStart - rel.lagDays;
      finish = Math.min(finish, candidate);
    }
    lf.set(code, finish);
    ls.set(code, finish - duration);
  }

  const floats = new Map();
  for (const code of order) floats.set(code, lf.get(code) - ef.get(code));
  return { floats, cyclic: false };
}

function readRows(input) {
  const options = { cellDates: true };
  let workbook;
  try {
    if (Buffer.isBuffer(input)) workbook = XLSX.read(input, { type: 'buffer', ...options });
    else if (typeof input === 'string') workbook = XLSX.readFile(input, options);
    else if (input?.path) workbook = XLSX.readFile(input.path, options);
    else if (Buffer.isBuffer(input?.buffer)) workbook = XLSX.read(input.buffer, { type: 'buffer', ...options });
    else throw new HttpError(400, 'NO_FILE', 'No file uploaded');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'PARSE_ERROR', `Schedule workbook could not be read: ${error.message}`);
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new HttpError(400, 'PARSE_ERROR', 'Schedule workbook has no sheets');
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(10, rows.length); i += 1) {
    const map = {};
    rows[i].forEach((cell, index) => {
      const header = normalizeHeader(cell);
      const canonical = HEADER_ALIASES[header] || header.replace(/\s+/g, '_');
      if (KNOWN_COLUMNS.includes(canonical) && map[canonical] === undefined) map[canonical] = index;
    });
    if (REQUIRED_COLUMNS.every((column) => map[column] !== undefined)) {
      return { headerRowIndex: i, columns: map };
    }
  }
  throw new HttpError(
    400,
    'SCHEDULE_VALIDATION_FAILED',
    `Schedule workbook needs the columns ${REQUIRED_COLUMNS.join(', ')} (with wbs_code, start, finish, duration_days, predecessors optional)`,
    { errors: [{ code: 'MISSING_COLUMNS', message: `Columns not found: ${REQUIRED_COLUMNS.join(', ')}` }] },
  );
}

function parseScheduleXlsx(input) {
  const rows = readRows(input);
  const { headerRowIndex, columns } = findHeader(rows);
  const cell = (row, column) => (columns[column] === undefined ? '' : row[columns[column]]);

  const errors = [];
  const issues = [];
  const staged = [];
  const seen = new Map();

  rows.slice(headerRowIndex + 1).forEach((row, offset) => {
    const rowNumber = headerRowIndex + offset + 2;
    const code = trimOrNull(cell(row, 'activity_code'));
    const name = trimOrNull(cell(row, 'name'));
    if (!code && !name) return; // blank line

    if (!code) errors.push({ row: rowNumber, field: 'activity_code', message: 'Activity code is required' });
    if (!name) errors.push({ row: rowNumber, field: 'name', message: 'Activity name is required' });
    if (code && seen.has(code)) {
      errors.push({ row: rowNumber, field: 'activity_code', message: `Duplicate activity code "${code}" - also on row ${seen.get(code)}` });
    } else if (code) {
      seen.set(code, rowNumber);
    }

    const start = parseCellDate(cell(row, 'start'));
    const finish = parseCellDate(cell(row, 'finish'));
    const rawDuration = cell(row, 'duration_days');
    let duration = null;
    if (rawDuration !== '' && rawDuration !== null && rawDuration !== undefined) {
      const number = Number(rawDuration);
      if (!Number.isFinite(number) || number < 0) {
        errors.push({ row: rowNumber, field: 'duration_days', message: 'Duration must be a number of days, zero or more' });
      } else {
        duration = Math.round(number);
      }
    } else if (start && finish) {
      duration = Math.max(0, Math.round((finish.getTime() - start.getTime()) / MS_PER_DAY));
      issues.push({ row: rowNumber, field: 'duration_days', code: 'DURATION_DERIVED', message: `Duration of "${code}" taken from its dates (${duration} calendar days)` });
    } else {
      duration = 0;
      issues.push({ row: rowNumber, field: 'duration_days', code: 'DURATION_MISSING', message: `"${code}" has no duration and no dates; imported as a milestone` });
    }
    if (start && finish && finish < start) {
      errors.push({ row: rowNumber, field: 'finish', message: 'Finish is before start' });
    }

    staged.push({
      rowNumber,
      code,
      name,
      wbsCode: trimOrNull(cell(row, 'wbs_code')),
      calendarId: trimOrNull(cell(row, 'calendar')),
      duration,
      start,
      finish,
      physComplete: parsePercent(cell(row, 'percent_complete')),
      predecessorText: trimOrNull(cell(row, 'predecessors')),
    });
  });

  if (!staged.length) {
    throw new HttpError(400, 'PARSE_ERROR', 'No activities found in schedule workbook');
  }
  if (errors.length) {
    throw new HttpError(400, 'SCHEDULE_VALIDATION_FAILED', 'Schedule workbook contains validation errors', {
      errors: errors.slice(0, 200),
      errorCount: errors.length,
      truncated: errors.length > 200,
    });
  }

  const knownCodes = new Set(staged.map((activity) => activity.code));
  const relationships = [];
  for (const activity of staged) {
    if (!activity.predecessorText) continue;
    const parsed = parsePredecessors(activity.predecessorText, knownCodes);
    for (const rel of parsed.relationships) {
      if (rel.predCode === activity.code) {
        issues.push({ row: activity.rowNumber, field: 'predecessors', code: 'SELF_PREDECESSOR', message: `"${activity.code}" names itself as a predecessor; the link is ignored` });
        continue;
      }
      relationships.push({ succCode: activity.code, ...rel });
    }
    for (const token of parsed.unknown) {
      issues.push({ row: activity.rowNumber, field: 'predecessors', code: 'UNKNOWN_PREDECESSOR', message: `Predecessor "${token}" of "${activity.code}" is not an activity in this file; the link is ignored` });
    }
  }

  const { floats, cyclic } = computeTotalFloat(staged, relationships);
  if (cyclic) {
    issues.push({ row: null, field: 'predecessors', code: 'LOGIC_LOOP', message: 'The predecessors form a loop; float cannot be calculated until it is broken' });
  }

  const activities = staged.map((activity) => ({
    sourceTaskId: activity.code,
    p6ActivityId: activity.code,
    name: activity.name,
    wbsCode: activity.wbsCode,
    calendarId: activity.calendarId,
    originalDuration: activity.duration,
    remainingDuration: Math.round(activity.duration * (1 - activity.physComplete / 100)),
    physComplete: activity.physComplete,
    earlyStartDate: activity.start,
    earlyFinishDate: activity.finish,
    lateStartDate: null,
    lateFinishDate: null,
    totalFloat: floats ? floats.get(activity.code) : null,
  }));

  const calendarIds = [...new Set(staged.map((activity) => activity.calendarId).filter(Boolean))];

  return {
    activities,
    relationships: relationships.map((rel) => ({
      succTaskId: rel.succCode,
      predTaskId: rel.predCode,
      relType: rel.relType,
      lagDays: rel.lagDays,
    })),
    wbsNodes: buildWbsNodes(staged.map((activity) => activity.wbsCode).filter(Boolean)),
    calendars: calendarIds.map((calendarId) => ({ calendarId, name: calendarId })),
    issues,
    columns,
  };
}

module.exports = {
  HEADER_ALIASES,
  KNOWN_COLUMNS,
  REQUIRED_COLUMNS,
  parseScheduleXlsx,
  parsePredecessors,
  parseCellDate,
  computeTotalFloat,
  buildWbsNodes,
};
