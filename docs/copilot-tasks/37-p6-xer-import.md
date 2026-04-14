# Task 37 — P6 XER Import (FR-201)

## Gap Covered
- Parse Primavera P6 XER files: TASK, TASKPRED, PROJWBS, CALENDAR tables
- Import activities, predecessors, WBS, durations into the DB

## BRD Refs
- FR-201: P6 XER file import with activities, WBS, relationships, and durations

## DB Schema Changes
None — uses existing `Activity` and `ScheduleRevision` models.

Add optional fields to `Activity` if not present:
```prisma
  p6ActivityId  String?   // original P6 activity_id (e.g. A1000)
  wbsCode       String?   // P6 WBS code
  calendarId    String?   // P6 calendar ref
  originalDuration Int?   // planned duration from P6 in working days
  remainingDuration Int?  // remaining duration from P6
  physComplete  Float?    // phys_complete_pct from P6 (0–100)
```

Run migration: `npx prisma migrate dev --name add_activity_p6_fields`

## Backend Changes

### New file: `backend/src/parsers/xer-parser.js`

```js
/**
 * Parse a Primavera P6 XER file into structured JS objects.
 * XER format: tab-delimited, sections start with %T <tablename>,
 * columns defined on %F line, rows on %R lines, section ends with %E.
 */
function parseXer(content) {
  const lines = content.split('\n');
  const tables = {};
  let currentTable = null;
  let currentFields = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('%T\t')) {
      currentTable = trimmed.slice(3).trim();
      tables[currentTable] = [];
      currentFields = [];
    } else if (trimmed.startsWith('%F\t')) {
      currentFields = trimmed.slice(3).split('\t');
    } else if (trimmed.startsWith('%R\t')) {
      const values = trimmed.slice(3).split('\t');
      const row = {};
      currentFields.forEach((f, i) => { row[f] = values[i] ?? ''; });
      if (currentTable) tables[currentTable].push(row);
    }
    // %E ends a table — no action needed
  }

  return tables;
}

/**
 * Convert XER duration (in hours) to working days.
 * P6 stores duration as float hours; divide by 8.
 */
function hoursToDays(hours) {
  const h = parseFloat(hours);
  return isNaN(h) ? 0 : Math.round(h / 8);
}

/**
 * Map a P6 relationship type code to our predecessor string format.
 * P6 codes: FS (finish-to-start), SS, FF, SF
 */
function mapRelType(relType) {
  const map = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };
  return map[relType] ?? 'FS';
}

/**
 * Extract activities from the TASK table.
 * Returns array of activity objects ready for DB insert.
 */
function extractActivities(tables) {
  const tasks = tables['TASK'] ?? [];
  return tasks.map(t => ({
    p6ActivityId: t.task_code,
    name: t.task_name,
    wbsCode: t.wbs_id,
    originalDuration: hoursToDays(t.target_drtn_hr_cnt),
    remainingDuration: hoursToDays(t.remain_drtn_hr_cnt),
    physComplete: parseFloat(t.phys_complete_pct) || 0,
    earlyStart: t.early_start_date ? new Date(t.early_start_date) : null,
    earlyFinish: t.early_end_date ? new Date(t.early_end_date) : null,
    lateStart: t.late_start_date ? new Date(t.late_start_date) : null,
    lateFinish: t.late_end_date ? new Date(t.late_end_date) : null,
    status: parseFloat(t.phys_complete_pct) === 100 ? 'complete'
      : parseFloat(t.phys_complete_pct) > 0 ? 'in_progress'
      : 'to_do',
    totalFloat: t.total_float_hr_cnt ? Math.round(parseFloat(t.total_float_hr_cnt) / 8) : 0,
  }));
}

/**
 * Extract predecessor relationships from TASKPRED table.
 * Returns map: { task_id → [{ predTaskId, relType, lagDays }] }
 */
function extractRelationships(tables) {
  const preds = tables['TASKPRED'] ?? [];
  const map = {};
  for (const p of preds) {
    if (!map[p.task_id]) map[p.task_id] = [];
    map[p.task_id].push({
      predTaskId: p.pred_task_id,
      relType: mapRelType(p.pred_type),
      lagDays: hoursToDays(p.lag_hr_cnt),
    });
  }
  return map;
}

/**
 * Extract WBS hierarchy from PROJWBS table.
 * Returns flat array: [{ wbs_id, parent_wbs_id, wbs_name, seq_num }]
 */
function extractWbs(tables) {
  const wbs = tables['PROJWBS'] ?? [];
  return wbs.map(w => ({
    wbsId: w.wbs_id,
    parentWbsId: w.parent_wbs_id || null,
    wbsName: w.wbs_name,
    seqNum: parseInt(w.seq_num) || 0,
  }));
}

module.exports = { parseXer, extractActivities, extractRelationships, extractWbs };
```

### New file: `backend/src/services/import.service.js`

```js
const prisma = require('../config/db');
const { parseXer, extractActivities, extractRelationships, extractWbs } = require('../parsers/xer-parser');
const { HttpError } = require('../utils/errors');

/**
 * Import a P6 XER file into the project.
 * Clears existing AI-generated activities first (if replaceExisting=true).
 */
async function importXer({ projectId, orgId, xerContent, replaceExisting = false }) {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const tables = parseXer(xerContent);
  const activities = extractActivities(tables);
  const relationships = extractRelationships(tables);
  const wbs = extractWbs(tables);

  if (activities.length === 0) {
    throw new HttpError(400, 'PARSE_ERROR', 'No activities found in XER file');
  }

  // Build a p6TaskId → activityId map as we insert
  const p6ToDb = {};

  await prisma.$transaction(async (tx) => {
    if (replaceExisting) {
      await tx.activity.deleteMany({ where: { projectId } });
    }

    // Generate sequential activityId codes
    const existing = await tx.activity.count({ where: { projectId } });

    // Insert activities
    for (let i = 0; i < activities.length; i++) {
      const act = activities[i];
      const activityId = `A${String(existing + i + 1).padStart(4, '0')}`;
      const duration = act.originalDuration || 1;

      const created = await tx.activity.create({
        data: {
          projectId,
          activityId,
          name: act.name,
          p6ActivityId: act.p6ActivityId,
          wbsCode: act.wbsCode,
          duration,
          originalDuration: act.originalDuration,
          remainingDuration: act.remainingDuration,
          physComplete: act.physComplete,
          earlyStart: act.earlyStart,
          earlyFinish: act.earlyFinish,
          lateStart: act.lateStart,
          lateFinish: act.lateFinish,
          totalFloat: act.totalFloat,
          status: act.status,
          isCritical: act.totalFloat === 0,
          percentComplete: act.physComplete,
        },
      });

      p6ToDb[act.p6ActivityId] = created.id;
    }

    // Update predecessors using resolved DB IDs
    for (const [p6TaskId, preds] of Object.entries(relationships)) {
      const dbId = p6ToDb[p6TaskId];
      if (!dbId) continue;

      const predecessorStr = preds
        .map(p => {
          const predDbId = p6ToDb[p.predTaskId];
          return predDbId ? `${predDbId}:${p.relType}:${p.lagDays}` : null;
        })
        .filter(Boolean)
        .join(',');

      if (predecessorStr) {
        await tx.activity.update({
          where: { id: dbId },
          data: { predecessors: predecessorStr },
        });
      }
    }

    // Create a schedule revision record
    await tx.scheduleRevision.create({
      data: {
        projectId,
        revisionNumber: (await tx.scheduleRevision.count({ where: { projectId } })) + 1,
        label: `P6 XER Import — ${new Date().toLocaleDateString()}`,
        snapshotJson: JSON.stringify({ source: 'xer', activityCount: activities.length, wbs }),
        generatedBy: 'import',
      },
    });
  });

  return {
    imported: activities.length,
    wbsNodes: wbs.length,
    message: `Imported ${activities.length} activities from P6 XER`,
  };
}

module.exports = { importXer };
```

### New file: `backend/src/routes/import.js`

```js
const { Router } = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { importXer } = require('../services/import.service');

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(authenticate);

// POST /projects/:projectId/import/xer
router.post('/xer', requireRoles('pm', 'planning_eng'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new Error('No file uploaded');

  const xerContent = req.file.buffer.toString('utf-8');
  const replaceExisting = req.body.replaceExisting === 'true';

  const result = await importXer({
    projectId: req.params.projectId,
    orgId: req.user.orgId,
    xerContent,
    replaceExisting,
  });

  return sendSuccess(res, result, 201);
}));

module.exports = router;
```

Add `multer` to backend dependencies: `npm install multer --workspace=backend`

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/import', require('./import'));`

## Frontend Changes

### New file: `frontend/src/features/schedule/components/import-xer-dialog.tsx`

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function ImportXerDialog({ projectId, open, onOpenChange }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [result, setResult] = useState<any>(null)
  const qc = useQueryClient()

  const importMutation = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('file', file!)
      form.append('replaceExisting', String(replaceExisting))
      return apiClient.post(`/projects/${projectId}/import/xer`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data.data)
    },
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['schedule', projectId] })
      qc.invalidateQueries({ queryKey: ['activities', projectId] })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Import P6 XER Schedule</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className='space-y-3'>
            <div className='rounded-lg bg-green-50 border border-green-200 p-4 text-center'>
              <p className='text-green-700 font-semibold'>Import Complete</p>
              <p className='text-2xl font-bold text-green-800 mt-1'>{result.imported} activities</p>
              <p className='text-sm text-green-600'>{result.wbsNodes} WBS nodes</p>
            </div>
            <Button className='w-full' onClick={() => { setResult(null); setFile(null); onOpenChange(false) }}>
              Close
            </Button>
          </div>
        ) : (
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>XER File</Label>
              <input
                type='file'
                accept='.xer'
                className='w-full text-sm'
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
              <p className='text-xs text-muted-foreground'>
                Export from Primavera P6: File → Export → Primavera PM (XER)
              </p>
            </div>

            <label className='flex items-center gap-2 text-sm cursor-pointer'>
              <input
                type='checkbox'
                checked={replaceExisting}
                onChange={e => setReplaceExisting(e.target.checked)}
              />
              Replace existing activities
            </label>

            {replaceExisting && (
              <p className='text-xs text-red-600 bg-red-50 p-2 rounded'>
                Warning: all existing activities and progress data will be deleted.
              </p>
            )}

            {importMutation.isError && (
              <p className='text-sm text-red-600'>
                Import failed: {(importMutation.error as any)?.response?.data?.error?.message ?? 'Unknown error'}
              </p>
            )}

            <div className='flex gap-2'>
              <Button variant='outline' className='flex-1' onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                className='flex-1'
                disabled={!file || importMutation.isPending}
                onClick={() => importMutation.mutate()}>
                {importMutation.isPending ? 'Importing…' : 'Import'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

Add "Import XER" button to the schedule dashboard toolbar that opens this dialog.

## Acceptance Criteria
- [ ] XER parser handles %T/%F/%R/%E format correctly
- [ ] Activities imported with name, duration, early/late dates, total float
- [ ] P6 durations converted from hours to working days (÷ 8)
- [ ] Predecessor relationships resolved using DB IDs
- [ ] WBS codes stored on activities
- [ ] physComplete imported as percentComplete
- [ ] isCritical = true when totalFloat = 0
- [ ] Schedule revision created after import
- [ ] replaceExisting=true deletes existing activities first
- [ ] Import result shows count of activities and WBS nodes
