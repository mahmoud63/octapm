# Task 39 — MSP XML Import (FR-203)

## Gap Covered
- Parse Microsoft Project XML files: Task, UID, Duration (ISO 8601), PredecessorLink elements

## BRD Refs
- FR-203: MSP XML file import with tasks, durations, and predecessor links

## DB Schema Changes
None — uses existing Activity model with fields from Task 37.

## Backend Changes

### New file: `backend/src/parsers/msp-parser.js`

```js
const { DOMParser } = require('@xmldom/xmldom');

/**
 * Parse a Microsoft Project XML (.xml) export.
 * MSP XML schema: <Project> → <Tasks> → <Task> elements.
 * Durations are ISO 8601 period strings: PT8H = 1 day, P5DT0H = 5 days.
 */
function parseMspXml(content) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');

  const get = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
  const getAll = (parent, tag) => Array.from(parent.getElementsByTagName(tag));

  // Build UID → Task map first
  const taskEls = getAll(doc, 'Task');
  const uidMap = {};

  const tasks = taskEls.map(t => {
    const uid = get(t, 'UID');
    const obj = {
      uid,
      id: get(t, 'ID'),
      name: get(t, 'Name'),
      isSummary: get(t, 'Summary') === '1',
      isMilestone: get(t, 'Milestone') === '1',
      durationIso: get(t, 'Duration'),
      start: get(t, 'Start') || null,
      finish: get(t, 'Finish') || null,
      percentComplete: parseFloat(get(t, 'PercentComplete') || '0'),
      totalSlack: parseFloat(get(t, 'TotalSlack') || '0'),     // in minutes
      wbsCode: get(t, 'WBS'),
      outlineLevel: parseInt(get(t, 'OutlineLevel') || '1'),
      predecessors: getAll(t, 'PredecessorLink').map(p => ({
        predUid: get(p, 'PredecessorUID'),
        type: get(p, 'Type'),  // 0=FF, 1=FS, 2=SF, 3=SS
        lagDurationIso: get(p, 'LinkLag') || 'PT0H',
      })),
    };
    uidMap[uid] = obj;
    return obj;
  });

  return { tasks, uidMap };
}

/**
 * Parse ISO 8601 duration to working days.
 * Examples: PT8H → 1d, P5D → 5d, PT40H → 5d, P2DT4H → 2.5d (round to nearest)
 */
function parseDurationDays(iso) {
  if (!iso) return 0;
  // Match days and hours
  const days = iso.match(/(\d+(?:\.\d+)?)D/)?.[1] ?? '0';
  const hours = iso.match(/(\d+(?:\.\d+)?)H/)?.[1] ?? '0';
  return Math.round(parseFloat(days) + parseFloat(hours) / 8);
}

/**
 * Map MSP predecessor type code to FS/SS/FF/SF.
 * MSP: 0=FF, 1=FS, 2=SF, 3=SS
 */
function mapMspRelType(type) {
  const map = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };
  return map[type] ?? 'FS';
}

module.exports = { parseMspXml, parseDurationDays, mapMspRelType };
```

### File: `backend/src/services/import.service.js`
Add `importMsp` function:

```js
const { parseMspXml, parseDurationDays, mapMspRelType } = require('../parsers/msp-parser');

async function importMsp({ projectId, orgId, xmlContent, replaceExisting = false }) {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const { tasks } = parseMspXml(xmlContent);

  // Skip summary tasks (MSP uses them for grouping, not actual work)
  const workTasks = tasks.filter(t => !t.isSummary && t.name && t.uid !== '0');

  if (workTasks.length === 0) {
    throw new HttpError(400, 'PARSE_ERROR', 'No work tasks found in MSP XML');
  }

  const uidToDb = {};

  await prisma.$transaction(async (tx) => {
    if (replaceExisting) {
      await tx.activity.deleteMany({ where: { projectId } });
    }

    const existingCount = await tx.activity.count({ where: { projectId } });

    for (let i = 0; i < workTasks.length; i++) {
      const t = workTasks[i];
      const activityId = `A${String(existingCount + i + 1).padStart(4, '0')}`;
      const duration = parseDurationDays(t.durationIso) || 1;

      const created = await tx.activity.create({
        data: {
          projectId,
          activityId,
          name: t.name,
          p6ActivityId: t.uid,           // store MSP UID in p6ActivityId for traceability
          wbsCode: t.wbsCode,
          duration,
          originalDuration: duration,
          percentComplete: t.percentComplete,
          physComplete: t.percentComplete,
          earlyStart: t.start ? new Date(t.start) : null,
          earlyFinish: t.finish ? new Date(t.finish) : null,
          totalFloat: Math.round(t.totalSlack / 480), // MSP slack in minutes → days (480 min/day)
          isCritical: t.totalSlack === 0,
          status: t.percentComplete === 100 ? 'complete'
            : t.percentComplete > 0 ? 'in_progress'
            : 'to_do',
        },
      });

      uidToDb[t.uid] = created.id;
    }

    // Wire predecessors
    for (const t of workTasks) {
      const succDbId = uidToDb[t.uid];
      if (!succDbId || !t.predecessors.length) continue;

      const predParts = t.predecessors
        .map(p => {
          const predDbId = uidToDb[p.predUid];
          if (!predDbId) return null;
          const lag = parseDurationDays(p.lagDurationIso);
          return `${predDbId}:${mapMspRelType(p.type)}:${lag}`;
        })
        .filter(Boolean);

      if (predParts.length) {
        await tx.activity.update({
          where: { id: succDbId },
          data: { predecessors: predParts.join(',') },
        });
      }
    }

    await tx.scheduleRevision.create({
      data: {
        projectId,
        revisionNumber: (await tx.scheduleRevision.count({ where: { projectId } })) + 1,
        label: `MSP XML Import — ${new Date().toLocaleDateString()}`,
        snapshotJson: JSON.stringify({ source: 'msp', activityCount: workTasks.length }),
        generatedBy: 'import',
      },
    });
  });

  return { imported: workTasks.length };
}

module.exports = { importXer, importP6Xml, importMsp };
```

### File: `backend/src/routes/import.js`
Add MSP route:

```js
const { importXer, importP6Xml, importMsp } = require('../services/import.service');

// POST /projects/:projectId/import/msp
router.post('/msp', requireRoles('pm', 'planning_eng'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new Error('No file uploaded');

  const xmlContent = req.file.buffer.toString('utf-8');
  const replaceExisting = req.body.replaceExisting === 'true';

  const result = await importMsp({
    projectId: req.params.projectId,
    orgId: req.user.orgId,
    xmlContent,
    replaceExisting,
  });

  return sendSuccess(res, result, 201);
}));
```

## Frontend Changes

### File: `frontend/src/features/schedule/components/import-xer-dialog.tsx`
Extend format selector to include MSP XML:

```tsx
// Add msp to format type
const [format, setFormat] = useState<'xer' | 'p6xml' | 'msp'>('xer')

const FORMAT_CONFIG = {
  xer:   { label: 'P6 XER',   accept: '.xer',  endpoint: 'xer' },
  p6xml: { label: 'P6 XML',   accept: '.xml',  endpoint: 'p6xml' },
  msp:   { label: 'MSP XML',  accept: '.xml',  endpoint: 'msp' },
}

// Rename dialog title to "Import Schedule"
// Show all three radio options
// Use FORMAT_CONFIG[format].accept and endpoint dynamically
```

## Acceptance Criteria
- [ ] MSP XML parser reads Task elements (skips summary tasks)
- [ ] ISO 8601 durations parsed: P5D → 5d, PT8H → 1d, P2DT4H → 2.5d → round to 3d
- [ ] MSP predecessor type codes mapped: 0→FF, 1→FS, 2→SF, 3→SS
- [ ] Lag durations parsed from ISO 8601 LinkLag
- [ ] MSP slack in minutes converted to days (÷ 480)
- [ ] isCritical = true when totalSlack = 0
- [ ] Summary tasks skipped (isSummary = 1)
- [ ] Schedule revision created after import
- [ ] Frontend dialog supports XER / P6 XML / MSP XML selection
