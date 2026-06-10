function parseXer(content) {
  const lines = String(content || '').split(/\r?\n/);
  const tables = {};

  let currentTable = null;
  let currentFields = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('%T\t')) {
      currentTable = line.slice(3).trim().toUpperCase();
      tables[currentTable] = [];
      currentFields = [];
      continue;
    }

    if (line.startsWith('%F\t')) {
      currentFields = line
        .slice(3)
        .split('\t')
        .map((field) => field.trim());
      continue;
    }

    if (line.startsWith('%R\t') && currentTable) {
      const values = line.slice(3).split('\t');
      const row = {};
      for (let i = 0; i < currentFields.length; i += 1) {
        row[currentFields[i]] = values[i] ?? '';
      }
      tables[currentTable].push(row);
    }
  }

  return tables;
}

function hoursToDays(hours) {
  const n = Number.parseFloat(hours);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n / 8));
}

function lagHoursToDays(hours) {
  const n = Number.parseFloat(hours);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n / 8);
}

function parseMaybeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function mapRelType(relType) {
  const map = {
    PR_FS: 'FS',
    PR_SS: 'SS',
    PR_FF: 'FF',
    PR_SF: 'SF',
    FS: 'FS',
    SS: 'SS',
    FF: 'FF',
    SF: 'SF',
  };

  return (
    map[
      String(relType || '')
        .trim()
        .toUpperCase()
    ] || 'FS'
  );
}

function extractWbs(tables) {
  const rows = tables.PROJWBS || [];
  return rows.map((w) => ({
    wbsId: String(w.wbs_id || '').trim(),
    parentWbsId: String(w.parent_wbs_id || '').trim() || null,
    name: String(w.wbs_name || '').trim() || null,
    code:
      String(w.wbs_short_name || '').trim() ||
      String(w.wbs_name || '').trim() ||
      String(w.wbs_id || '').trim() ||
      null,
    seqNum: Number.parseInt(w.seq_num, 10) || 0,
  }));
}

function buildWbsCodeMap(wbsNodes) {
  const map = new Map();
  for (const node of wbsNodes) {
    if (node.wbsId) {
      map.set(node.wbsId, node.code || node.wbsId);
    }
  }
  return map;
}

function extractCalendars(tables) {
  const rows = tables.CALENDAR || [];
  return rows.map((c) => ({
    calendarId: String(c.clndr_id || '').trim(),
    name: String(c.clndr_name || '').trim() || null,
  }));
}

function extractActivities(tables) {
  const wbsNodes = extractWbs(tables);
  const wbsCodeMap = buildWbsCodeMap(wbsNodes);
  const tasks = tables.TASK || [];

  const activities = tasks.map((t) => {
    const p6ActivityId =
      String(t.task_code || '').trim() ||
      String(t.task_id || '').trim() ||
      null;
    const sourceTaskId = String(t.task_id || '').trim() || null;
    const physComplete = Number.parseFloat(t.phys_complete_pct);
    const pct = Number.isFinite(physComplete) ? physComplete : 0;

    return {
      sourceTaskId,
      p6ActivityId,
      name: String(t.task_name || '').trim() || 'Imported Activity',
      wbsCode:
        wbsCodeMap.get(String(t.wbs_id || '').trim()) ||
        String(t.wbs_id || '').trim() ||
        null,
      calendarId: String(t.clndr_id || '').trim() || null,
      originalDuration: hoursToDays(t.target_drtn_hr_cnt),
      remainingDuration: hoursToDays(t.remain_drtn_hr_cnt),
      physComplete: pct,
      earlyStartDate: parseMaybeDate(t.early_start_date),
      earlyFinishDate: parseMaybeDate(t.early_end_date),
      lateStartDate: parseMaybeDate(t.late_start_date),
      lateFinishDate: parseMaybeDate(t.late_end_date),
      totalFloat: hoursToDays(t.total_float_hr_cnt),
    };
  });

  return { activities, wbsNodes, calendars: extractCalendars(tables) };
}

function extractRelationships(tables) {
  const rows = tables.TASKPRED || [];

  return rows.map((p) => ({
    succTaskId: String(p.task_id || '').trim(),
    predTaskId: String(p.pred_task_id || '').trim(),
    relType: mapRelType(p.pred_type),
    lagDays: lagHoursToDays(p.lag_hr_cnt),
  }));
}

module.exports = {
  parseXer,
  extractActivities,
  extractRelationships,
  extractWbs,
  extractCalendars,
  hoursToDays,
  lagHoursToDays,
  mapRelType,
};
