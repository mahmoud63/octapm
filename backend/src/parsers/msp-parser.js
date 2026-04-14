const { parseStringPromise } = require('xml2js');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function text(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && typeof value._ === 'string') {
    return value._.trim();
  }
  return '';
}

function parseDurationDays(input) {
  const raw = String(input || '').trim();
  if (!raw) return 0;

  // Some MSP exports use numeric lag values in minutes.
  if (/^[-+]?\d+(?:\.\d+)?$/.test(raw)) {
    const minutes = Number.parseFloat(raw);
    if (!Number.isFinite(minutes)) return 0;
    return Math.round(minutes / 480);
  }

  // Supports PnDTnHnM and PTnH formats.
  const dayMatch = raw.match(/(\d+(?:\.\d+)?)D/i);
  const hourMatch = raw.match(/(\d+(?:\.\d+)?)H/i);
  const minuteMatch = raw.match(/(\d+(?:\.\d+)?)M/i);

  const days = Number.parseFloat(dayMatch?.[1] || '0');
  const hours = Number.parseFloat(hourMatch?.[1] || '0');
  const minutes = Number.parseFloat(minuteMatch?.[1] || '0');

  const total = days + hours / 8 + minutes / 480;
  if (!Number.isFinite(total)) return 0;
  return Math.max(0, Math.round(total));
}

function mapMspRelType(type) {
  const map = {
    0: 'FF',
    1: 'FS',
    2: 'SF',
    3: 'SS',
    ff: 'FF',
    fs: 'FS',
    sf: 'SF',
    ss: 'SS',
  };

  return (
    map[
      String(type || '')
        .trim()
        .toLowerCase()
    ] || 'FS'
  );
}

async function parseMspXml(content) {
  const parsed = await parseStringPromise(String(content || ''), {
    explicitArray: false,
    trim: true,
    mergeAttrs: true,
  });

  const rootProject = parsed.Project || parsed;
  const taskNodes = asArray(rootProject?.Tasks?.Task);

  const tasks = taskNodes.map((task) => ({
    uid: text(task.UID),
    id: text(task.ID),
    name: text(task.Name),
    isSummary: text(task.Summary) === '1',
    isMilestone: text(task.Milestone) === '1',
    durationIso: text(task.Duration),
    start: text(task.Start) || null,
    finish: text(task.Finish) || null,
    percentComplete: Number.parseFloat(text(task.PercentComplete) || '0'),
    totalSlackMinutes: Number.parseFloat(text(task.TotalSlack) || '0'),
    wbsCode: text(task.WBS) || null,
    outlineLevel: Number.parseInt(text(task.OutlineLevel) || '1', 10),
    predecessors: asArray(task.PredecessorLink).map((pred) => ({
      predUid: text(pred.PredecessorUID),
      type: mapMspRelType(text(pred.Type)),
      lagDurationIso: text(pred.LinkLag) || 'PT0H',
    })),
  }));

  return { tasks };
}

module.exports = {
  parseMspXml,
  parseDurationDays,
  mapMspRelType,
};
