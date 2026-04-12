---
name: p6-parser
description: Parse Primavera P6 XER files, P6 XML files, and Microsoft Project XML files for schedule import. Use when building or modifying the import module, CPM engine, or schedule reconstruction logic.
---

# P6 / MSP Schedule Import Skill

## Supported Formats

### 1. P6 XER Format
Tab-delimited text file with `%T` (table), `%F` (field), `%R` (row) records.

**Tables to extract:**
- `TASK` — activities (task_code, task_name, target_drtn_hr_cnt, early_start_date, early_end_date, late_start_date, late_end_date, total_float_hr_cnt, phys_complete_pct, target_work_qty, act_start_date, act_end_date)
- `TASKPRED` — predecessors (task_id, pred_task_id, pred_type: FS/SS/FF/SF, lag_hr_cnt)
- `PROJWBS` — WBS hierarchy (wbs_id, parent_wbs_id, wbs_name, wbs_short_name)
- `PROJECT` — project info (proj_id, proj_short_name, plan_start_date, plan_end_date)
- `CALENDAR` — working calendars (clndr_id, day_hr_cnt, clndr_data)

**Parsing logic:**
```js
function parseXER(text) {
  const lines = text.split('\n');
  const tables = {};
  let currentTable = null;
  let fields = [];

  for (const line of lines) {
    if (line.startsWith('%T')) {
      currentTable = line.split('\t')[1]?.trim();
      tables[currentTable] = [];
    } else if (line.startsWith('%F')) {
      fields = line.split('\t').slice(1).map(f => f.trim());
    } else if (line.startsWith('%R') && currentTable) {
      const values = line.split('\t').slice(1);
      const row = {};
      fields.forEach((f, i) => { row[f] = values[i]?.trim() || ''; });
      tables[currentTable].push(row);
    }
  }
  return tables;
}
```

### 2. P6 XML Format
XML with Activity, Relationship, WBS, Project elements. Uses ObjectId for cross-references.

**Key elements:**
- `<Activity>` — ObjectId, Id, Name, PlannedDuration, RemainingDuration, StartDate, FinishDate, Status
- `<Relationship>` — PredecessorActivityObjectId, SuccessorActivityObjectId, Type, Lag
- `<WBS>` — ObjectId, Name, Code, ParentObjectId

### 3. MS Project XML
XML with Task elements using UID-based references.

**Key elements:**
- `<Task>` — UID, Name, Duration (ISO 8601: PT8H0M0S = 1 day), Start, Finish, PercentComplete, Cost, OutlineNumber, WBS
- `<PredecessorLink>` — PredecessorUID, Type (0=FF, 1=FS, 2=SF, 3=SS), LinkLag (in tenths of minutes)

## Business Rules
1. **P6 XER durations in hours**: `target_drtn_hr_cnt / 8 = working days`
2. **MSP durations in ISO 8601**: parse PT{hours}H{minutes}M → hours / 8 = working days
3. **MSP lag in tenths of minutes**: `LinkLag / 4800 = working days` (480 mins/day × 10)
4. **Predecessor types**: FS (Finish-to-Start), SS (Start-to-Start), FF (Finish-to-Finish), SF (Start-to-Finish)
5. **Activities with Total Float = 0 are critical path**
6. **Activities with TF 1-5 days are near-critical**

## CPM Engine (Server-Side)

After parsing, run forward and backward pass:

```js
function calculateCPM(activities) {
  // Build adjacency list from predecessors
  const adj = buildAdjacencyList(activities);
  
  // Forward pass: ES, EF
  const sorted = topologicalSort(activities, adj);
  for (const act of sorted) {
    act.earlyStart = Math.max(0, ...getPredecessors(act).map(p => {
      if (p.type === 'FS') return p.pred.earlyFinish + p.lag;
      if (p.type === 'SS') return p.pred.earlyStart + p.lag;
      if (p.type === 'FF') return p.pred.earlyFinish + p.lag - act.duration;
      if (p.type === 'SF') return p.pred.earlyStart + p.lag - act.duration;
    }));
    act.earlyFinish = act.earlyStart + act.duration;
  }
  
  // Backward pass: LS, LF
  const projectEnd = Math.max(...activities.map(a => a.earlyFinish));
  for (const act of sorted.reverse()) {
    const successors = getSuccessors(act);
    act.lateFinish = successors.length === 0 ? projectEnd : 
      Math.min(...successors.map(s => {
        if (s.type === 'FS') return s.succ.lateStart - s.lag;
        if (s.type === 'SS') return s.succ.lateStart - s.lag + act.duration;
        if (s.type === 'FF') return s.succ.lateFinish - s.lag;
        if (s.type === 'SF') return s.succ.lateFinish - s.lag + act.duration;
      }));
    act.lateStart = act.lateFinish - act.duration;
    act.totalFloat = act.lateFinish - act.earlyFinish;
    act.isCritical = act.totalFloat === 0;
  }
  
  return activities;
}
```

## Post-Import Actions
After import + CPM calculation:
1. Save all activities to database with `projectId`
2. Import progress data (`phys_complete_pct` or `PercentComplete`) into `ActivityProgress`
3. Auto-build linked modules: create `CostRecord` for each activity, create `ProcurementOrder` for long-lead items
4. Save as `ScheduleRevision` with full snapshot
5. Emit WebSocket event to refresh dashboards
