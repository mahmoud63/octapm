# Task 43 — Multi-Sheet XLSX Export (BR-010, AC-06)

## Gap Covered
- Export full project data as multi-sheet XLSX: Master Schedule, Critical Path, Risks, Assumptions, Long Lead, WBS

## BRD Refs
- BR-010: Export to XLSX (multi-sheet) and PDF
- AC-06: Export includes Master Schedule, Critical Path, Risks, Assumptions, Long Lead, WBS sheets

## DB Schema Changes
None.

## Backend Changes

### Install dependency
```bash
npm install exceljs --workspace=backend
```

### New file: `backend/src/services/export.service.js`

```js
const ExcelJS = require('exceljs');
const prisma = require('../config/db');
const { HttpError } = require('../utils/errors');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };

function styleHeaders(sheet, columns) {
  sheet.columns = columns;
  const headerRow = sheet.getRow(1);
  headerRow.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  headerRow.height = 30;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB');
}

async function generateProjectExport({ projectId, orgId }) {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const [activities, risks, longLead] = await Promise.all([
    prisma.activity.findMany({
      where: { projectId },
      orderBy: { activityId: 'asc' },
    }),
    prisma.risk.findMany({ where: { projectId } }).catch(() => []),
    prisma.longLeadItem.findMany({ where: { projectId } }).catch(() => []),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PMcopilots';
  workbook.created = new Date();

  // ── Sheet 1: Master Schedule ──────────────────────────────────────────
  const schedSheet = workbook.addWorksheet('Master Schedule');
  styleHeaders(schedSheet, [
    { header: 'ID',           key: 'activityId',     width: 10 },
    { header: 'Activity Name',key: 'name',           width: 40 },
    { header: 'Duration (d)', key: 'duration',       width: 12 },
    { header: 'Early Start',  key: 'earlyStart',     width: 14 },
    { header: 'Early Finish', key: 'earlyFinish',    width: 14 },
    { header: 'Late Start',   key: 'lateStart',      width: 14 },
    { header: 'Late Finish',  key: 'lateFinish',     width: 14 },
    { header: 'Total Float',  key: 'totalFloat',     width: 12 },
    { header: 'Critical',     key: 'isCritical',     width: 10 },
    { header: '% Complete',   key: 'percentComplete',width: 12 },
    { header: 'Status',       key: 'status',         width: 14 },
    { header: 'WBS',          key: 'wbsCode',        width: 16 },
  ]);

  activities.forEach(a => {
    const row = schedSheet.addRow({
      activityId: a.activityId,
      name: a.name,
      duration: a.duration,
      earlyStart: fmtDate(a.earlyStart),
      earlyFinish: fmtDate(a.earlyFinish),
      lateStart: fmtDate(a.lateStart),
      lateFinish: fmtDate(a.lateFinish),
      totalFloat: a.totalFloat,
      isCritical: a.isCritical ? 'Yes' : 'No',
      percentComplete: `${a.percentComplete ?? 0}%`,
      status: a.status,
      wbsCode: a.wbsCode ?? '',
    });

    if (a.isCritical) {
      row.getCell('isCritical').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0E0' } };
      row.getCell('isCritical').font = { color: { argb: 'FFCC0000' }, bold: true };
    }
  });

  // ── Sheet 2: Critical Path ────────────────────────────────────────────
  const critSheet = workbook.addWorksheet('Critical Path');
  styleHeaders(critSheet, [
    { header: 'ID',            key: 'activityId',  width: 10 },
    { header: 'Activity Name', key: 'name',        width: 40 },
    { header: 'Duration (d)',  key: 'duration',    width: 12 },
    { header: 'Early Start',   key: 'earlyStart',  width: 14 },
    { header: 'Early Finish',  key: 'earlyFinish', width: 14 },
    { header: 'Total Float',   key: 'totalFloat',  width: 12 },
    { header: '% Complete',    key: 'pct',         width: 12 },
  ]);

  activities.filter(a => a.isCritical).forEach(a => {
    critSheet.addRow({
      activityId: a.activityId,
      name: a.name,
      duration: a.duration,
      earlyStart: fmtDate(a.earlyStart),
      earlyFinish: fmtDate(a.earlyFinish),
      totalFloat: a.totalFloat,
      pct: `${a.percentComplete ?? 0}%`,
    });
  });

  // ── Sheet 3: Risks ────────────────────────────────────────────────────
  const riskSheet = workbook.addWorksheet('Risks');
  styleHeaders(riskSheet, [
    { header: 'Ref',           key: 'ref',          width: 10 },
    { header: 'Description',   key: 'description',  width: 40 },
    { header: 'Category',      key: 'category',     width: 16 },
    { header: 'Probability',   key: 'probability',  width: 12 },
    { header: 'Impact',        key: 'impact',       width: 12 },
    { header: 'Risk Score',    key: 'score',        width: 12 },
    { header: 'Status',        key: 'status',       width: 14 },
    { header: 'Mitigation',    key: 'mitigation',   width: 40 },
    { header: 'Owner',         key: 'owner',        width: 18 },
  ]);

  risks.forEach(r => {
    riskSheet.addRow({
      ref: r.ref,
      description: r.description,
      category: r.category ?? '',
      probability: r.probability ?? '',
      impact: r.impact ?? '',
      score: r.riskScore ?? '',
      status: r.status,
      mitigation: r.mitigationPlan ?? '',
      owner: r.owner ?? '',
    });
  });

  // ── Sheet 4: Assumptions ──────────────────────────────────────────────
  const assumSheet = workbook.addWorksheet('Assumptions');
  styleHeaders(assumSheet, [
    { header: 'Ref',         key: 'ref',         width: 10 },
    { header: 'Activity ID', key: 'activityId',  width: 12 },
    { header: 'Assumption',  key: 'assumption',  width: 60 },
  ]);

  // Pull assumptions from snapshotJson of latest schedule revision
  const latestRev = await prisma.scheduleRevision.findFirst({
    where: { projectId },
    orderBy: { revisionNumber: 'desc' },
  });

  if (latestRev?.snapshotJson) {
    try {
      const snap = JSON.parse(latestRev.snapshotJson);
      const assumptions = snap.assumptions ?? [];
      assumptions.forEach((a, i) => {
        assumSheet.addRow({ ref: `AS-${String(i + 1).padStart(2, '0')}`, activityId: a.activityId ?? '', assumption: a.text ?? a });
      });
    } catch (_) { /* no assumptions */ }
  }

  // ── Sheet 5: Long Lead ────────────────────────────────────────────────
  const llSheet = workbook.addWorksheet('Long Lead Items');
  styleHeaders(llSheet, [
    { header: 'Ref',            key: 'ref',              width: 10 },
    { header: 'Description',    key: 'description',      width: 40 },
    { header: 'Supplier',       key: 'supplier',         width: 20 },
    { header: 'Lead (wks)',     key: 'leadWeeks',        width: 12 },
    { header: 'Required On Site',key: 'requiredOnSite',  width: 16 },
    { header: 'Expected Delivery',key:'expectedDelivery', width: 16 },
    { header: 'Status',         key: 'status',           width: 14 },
    { header: 'Activity',       key: 'activityId',       width: 12 },
  ]);

  longLead.forEach(ll => {
    llSheet.addRow({
      ref: ll.ref,
      description: ll.description,
      supplier: ll.supplier ?? '',
      leadWeeks: ll.leadWeeks ?? '',
      requiredOnSite: fmtDate(ll.requiredOnSite),
      expectedDelivery: fmtDate(ll.expectedDelivery),
      status: ll.status,
      activityId: ll.activityId ?? '',
    });
  });

  // ── Sheet 6: WBS ──────────────────────────────────────────────────────
  const wbsSheet = workbook.addWorksheet('WBS');
  styleHeaders(wbsSheet, [
    { header: 'WBS Code',      key: 'wbsCode',  width: 18 },
    { header: 'Activity Count',key: 'count',    width: 16 },
    { header: 'Total Duration',key: 'duration', width: 16 },
  ]);

  const wbsGroups = activities.reduce((acc, a) => {
    const code = a.wbsCode ?? 'Unassigned';
    if (!acc[code]) acc[code] = { count: 0, duration: 0 };
    acc[code].count++;
    acc[code].duration += a.duration || 0;
    return acc;
  }, {});

  Object.entries(wbsGroups).forEach(([code, g]) => {
    wbsSheet.addRow({ wbsCode: code, count: g.count, duration: g.duration });
  });

  return workbook;
}

module.exports = { generateProjectExport };
```

### New file: `backend/src/routes/export.js`

```js
const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { generateProjectExport } = require('../services/export.service');

const router = Router({ mergeParams: true });
router.use(authenticate);

// GET /projects/:projectId/export/xlsx
router.get('/xlsx', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const workbook = await generateProjectExport({ projectId, orgId: req.user.orgId });

  const projectName = workbook.creator; // will be set in service — update to use project name
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="project-${projectId}-export.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
}));

module.exports = router;
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/export', require('./export'));`

## Frontend Changes

### New file: `frontend/src/features/projects/components/export-button.tsx`

```tsx
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api-client'
import { useState } from 'react'

interface Props { projectId: string }

export function ExportButton({ projectId }: Props) {
  const [loading, setLoading] = useState(false)

  const handleExport = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get(`/projects/${projectId}/export/xlsx`, {
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `project-export.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant='outline' onClick={handleExport} disabled={loading}>
      {loading ? 'Exporting…' : '↓ Export XLSX'}
    </Button>
  )
}
```

Add `<ExportButton projectId={projectId} />` to the schedule dashboard toolbar and the project detail header actions area.

## Acceptance Criteria
- [ ] XLSX file downloads with 6 sheets: Master Schedule, Critical Path, Risks, Assumptions, Long Lead, WBS
- [ ] Critical path activities highlighted in red in Master Schedule sheet
- [ ] Critical Path sheet contains only TF=0 activities
- [ ] Risks sheet includes all risk fields
- [ ] Long Lead sheet includes all long-lead fields
- [ ] WBS sheet shows activity count and total duration per WBS code
- [ ] exceljs installed as backend dependency
- [ ] Headers styled with dark blue fill and white bold text
