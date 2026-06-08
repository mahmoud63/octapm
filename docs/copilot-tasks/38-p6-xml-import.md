# Task 38 — P6 XML Import (FR-202)

## Gap Covered
- Parse Primavera P6 XML files: Activity, Relationship, WBS elements
- Import into DB same as XER import

## BRD Refs
- FR-202: P6 XML file import with activities, WBS, and relationships

## DB Schema Changes
None — uses fields added in Task 37 (p6ActivityId, wbsCode, originalDuration, remainingDuration, physComplete).
Ensure migration from Task 37 has been run first.

## Backend Changes

### New file: `backend/src/parsers/p6xml-parser.js`

```js
const { DOMParser } = require('@xmldom/xmldom');

/**
 * Parse a Primavera P6 XML export file.
 * P6 XML schema: root <APIBusinessObjects> containing <Project> with nested
 * <Activity>, <Relationship>, <WBS> elements.
 */
function parseP6Xml(content) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');

  const get = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
  const getAll = (el, tag) => Array.from(el.getElementsByTagName(tag));

  const projectEl = doc.getElementsByTagName('Project')[0];
  if (!projectEl) throw new Error('No <Project> element found in P6 XML');

  // Parse activities
  const activities = getAll(projectEl, 'Activity').map(a => ({
    p6ActivityId: get(a, 'Id'),
    name: get(a, 'Name'),
    wbsId: get(a, 'WBSObjectId'),
    plannedDurationHours: parseFloat(get(a, 'PlannedDuration') || '0'),
    remainingDurationHours: parseFloat(get(a, 'RemainingDuration') || '0'),
    physComplete: parseFloat(get(a, 'PhysicalPercentComplete') || '0'),
    plannedStart: get(a, 'PlannedStartDate') || null,
    plannedFinish: get(a, 'PlannedFinishDate') || null,
    earlyStart: get(a, 'EarlyStartDate') || null,
    earlyFinish: get(a, 'EarlyFinishDate') || null,
    lateStart: get(a, 'LateStartDate') || null,
    lateFinish: get(a, 'LateFinishDate') || null,
    totalFloat: parseFloat(get(a, 'TotalFloat') || '0'),
    status: get(a, 'Status'), // Not Started, In Progress, Completed
  }));

  // Parse relationships
  const relationships = getAll(projectEl, 'Relationship').map(r => ({
    succId: get(r, 'SuccessorActivityObjectId') || get(r, 'SuccessorActivityId'),
    predId: get(r, 'PredecessorActivityObjectId') || get(r, 'PredecessorActivityId'),
    type: get(r, 'Type'), // Finish to Start, Start to Start, Finish to Finish
    lagHours: parseFloat(get(r, 'Lag') || '0'),
  }));

  // Parse WBS
  const wbsNodes = getAll(doc, 'WBS').map(w => ({
    objectId: get(w, 'ObjectId'),
    parentObjectId: get(w, 'ParentObjectId') || null,
    name: get(w, 'Name'),
    code: get(w, 'Code'),
  }));

  return { activities, relationships, wbsNodes };
}

function hoursToDays(hours) {
  return isNaN(hours) ? 0 : Math.round(hours / 8);
}

function mapP6Status(p6Status) {
  if (p6Status === 'Completed') return 'complete';
  if (p6Status === 'In Progress') return 'in_progress';
  return 'to_do';
}

function mapRelType(type) {
  const map = {
    'Finish to Start': 'FS',
    'Start to Start': 'SS',
    'Finish to Finish': 'FF',
    'Start to Finish': 'SF',
  };
  return map[type] ?? 'FS';
}

module.exports = { parseP6Xml, hoursToDays, mapP6Status, mapRelType };
```

Install dependency: `npm install @xmldom/xmldom --workspace=backend`

### File: `backend/src/services/import.service.js`
Add `importP6Xml` function alongside existing `importXer`:

```js
const { parseP6Xml, hoursToDays, mapP6Status, mapRelType } = require('../parsers/p6xml-parser');

async function importP6Xml({ projectId, orgId, xmlContent, replaceExisting = false }) {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const { activities, relationships, wbsNodes } = parseP6Xml(xmlContent);

  if (activities.length === 0) {
    throw new HttpError(400, 'PARSE_ERROR', 'No activities found in P6 XML');
  }

  const p6ToDb = {};

  await prisma.$transaction(async (tx) => {
    if (replaceExisting) {
      await tx.activity.deleteMany({ where: { projectId } });
    }

    const existing = await tx.activity.count({ where: { projectId } });

    for (let i = 0; i < activities.length; i++) {
      const act = activities[i];
      const activityId = `A${String(existing + i + 1).padStart(4, '0')}`;

      const created = await tx.activity.create({
        data: {
          projectId,
          activityId,
          name: act.name,
          p6ActivityId: act.p6ActivityId,
          wbsCode: act.wbsId,
          duration: hoursToDays(act.plannedDurationHours) || 1,
          originalDuration: hoursToDays(act.plannedDurationHours),
          remainingDuration: hoursToDays(act.remainingDurationHours),
          physComplete: act.physComplete,
          percentComplete: act.physComplete,
          earlyStart: act.earlyStart ? new Date(act.earlyStart) : null,
          earlyFinish: act.earlyFinish ? new Date(act.earlyFinish) : null,
          lateStart: act.lateStart ? new Date(act.lateStart) : null,
          lateFinish: act.lateFinish ? new Date(act.lateFinish) : null,
          totalFloat: hoursToDays(act.totalFloat),
          isCritical: hoursToDays(act.totalFloat) === 0,
          status: mapP6Status(act.status),
        },
      });

      p6ToDb[act.p6ActivityId] = created.id;
    }

    // Wire predecessors
    for (const rel of relationships) {
      const succDbId = p6ToDb[rel.succId];
      const predDbId = p6ToDb[rel.predId];
      if (!succDbId || !predDbId) continue;

      const existing = await tx.activity.findUnique({ where: { id: succDbId }, select: { predecessors: true } });
      const predStr = `${predDbId}:${mapRelType(rel.type)}:${hoursToDays(rel.lagHours)}`;
      const updated = existing.predecessors ? `${existing.predecessors},${predStr}` : predStr;

      await tx.activity.update({ where: { id: succDbId }, data: { predecessors: updated } });
    }

    await tx.scheduleRevision.create({
      data: {
        projectId,
        revisionNumber: (await tx.scheduleRevision.count({ where: { projectId } })) + 1,
        label: `P6 XML Import — ${new Date().toLocaleDateString()}`,
        snapshotJson: JSON.stringify({ source: 'p6xml', activityCount: activities.length }),
        generatedBy: 'import',
      },
    });
  });

  return { imported: activities.length, wbsNodes: wbsNodes.length };
}

module.exports = { importXer, importP6Xml };
```

### File: `backend/src/routes/import.js`
Add route for P6 XML alongside existing XER route:

```js
const { importXer, importP6Xml } = require('../services/import.service');

// POST /projects/:projectId/import/p6xml
router.post('/p6xml', requireRoles('pm', 'planning_eng'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new Error('No file uploaded');

  const xmlContent = req.file.buffer.toString('utf-8');
  const replaceExisting = req.body.replaceExisting === 'true';

  const result = await importP6Xml({
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
Extend to support both XER and P6 XML via a format selector:

```tsx
// Add format state
const [format, setFormat] = useState<'xer' | 'p6xml'>('xer')

// Change accept and endpoint based on format
const accept = format === 'xer' ? '.xer' : '.xml'
const endpoint = `/projects/${projectId}/import/${format}`

// Show format selector radio buttons at top of dialog
<div className='flex gap-4 text-sm'>
  <label className='flex items-center gap-2 cursor-pointer'>
    <input type='radio' value='xer' checked={format === 'xer'} onChange={() => setFormat('xer')} />
    P6 XER
  </label>
  <label className='flex items-center gap-2 cursor-pointer'>
    <input type='radio' value='p6xml' checked={format === 'p6xml'} onChange={() => setFormat('p6xml')} />
    P6 XML
  </label>
</div>
```

## Acceptance Criteria
- [ ] P6 XML parser reads Activity, Relationship, WBS elements
- [ ] Durations converted from hours to working days (÷ 8)
- [ ] Relationship types mapped: "Finish to Start" → FS, etc.
- [ ] physComplete imported as percentComplete
- [ ] isCritical = true when totalFloat = 0
- [ ] Schedule revision created after import
- [ ] Frontend dialog supports both XER and P6 XML format selection
- [ ] @xmldom/xmldom installed as backend dependency
