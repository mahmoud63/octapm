# Task 14 — Risks: Manual CRUD, Owner & Status Tracking

## Gaps Covered
- Risks are read-only from AI output; no manual add/edit/delete
- Risk owner field not captured or displayed
- Risk status (open/closed) not tracked

## BRD Refs
- §15 Risk Register Report: Risk ref, description, probability, impact, severity, mitigation, owner
- BR-010: Excel export includes Risk Register sheet

## DB Schema Changes

### Add `Risk` model (risks currently only live in `ScheduleRevision.snapshotJson`)
```prisma
model Risk {
  id          String   @id @default(uuid())
  projectId   String
  ref         String   // e.g. RSK-01
  description String
  probability String   @default("medium")  // low, medium, high
  impact      String   @default("medium")  // low, medium, high
  severity    String   @default("MEDIUM")  // LOW, MEDIUM, HIGH, CRITICAL
  mitigation  String?
  phase       String?
  owner       String?
  status      String   @default("open")    // open, closed, monitoring
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
}
```

Add to `Project` model: `risks Risk[]`

Run migration: `npx prisma migrate dev --name add_risk_model`

## Backend Changes

### New file: `backend/src/routes/risks.js`
```js
const express = require('express');
const { body, param } = require('express-validator');
const { asyncHandler } = require('../utils/async-handler');
const { sendSuccess } = require('../utils/api-response');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const riskService = require('../services/risk.service');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const result = await riskService.listRisks({ orgId: req.user.orgId, projectId: req.params.projectId });
  return sendSuccess(res, result);
}));

router.post('/', requireRoles('pm', 'planning_eng', 'qs'),
  [
    body('description').isString().trim().notEmpty(),
    body('probability').isIn(['low', 'medium', 'high']),
    body('impact').isIn(['low', 'medium', 'high']),
    body('severity').isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    body('mitigation').optional().isString().trim(),
    body('phase').optional().isString().trim(),
    body('owner').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await riskService.createRisk({ orgId: req.user.orgId, projectId: req.params.projectId, payload: req.body });
    return sendSuccess(res, result, 201);
  })
);

router.patch('/:id', requireRoles('pm', 'planning_eng', 'qs'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    const result = await riskService.updateRisk({ orgId: req.user.orgId, projectId: req.params.projectId, riskId: req.params.id, payload: req.body });
    return sendSuccess(res, result);
  })
);

router.delete('/:id', requireRoles('pm', 'planning_eng'),
  [param('id').isUUID(), validate],
  asyncHandler(async (req, res) => {
    await riskService.deleteRisk({ orgId: req.user.orgId, projectId: req.params.projectId, riskId: req.params.id });
    return sendSuccess(res, { deleted: true });
  })
);

module.exports = router;
```

### New file: `backend/src/services/risk.service.js`
Standard CRUD service with orgId scoping via `project: { orgId }` in where clauses.

Auto-generate `ref` on create: count existing risks + 1, format as `RSK-${n.toString().padStart(2, '0')}`.

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/risks', require('./risks'));`

### File: `backend/src/services/schedule.service.js`
After saving schedule revision (in `runGeneratePipeline`), seed the `Risk` table from `scheduleJson.risks`:
```js
if (Array.isArray(scheduleJson.risks) && scheduleJson.risks.length > 0) {
  await tx.risk.deleteMany({ where: { projectId } });
  await tx.risk.createMany({
    data: scheduleJson.risks.map((r, i) => ({
      projectId,
      ref: r.ref || `RSK-${String(i + 1).padStart(2, '0')}`,
      description: r.description || '',
      probability: (r.probability || 'medium').toLowerCase(),
      impact: (r.impact || 'medium').toLowerCase(),
      severity: (r.severity || 'MEDIUM').toUpperCase(),
      mitigation: r.mitigation || null,
      phase: r.phase || null,
    })),
  });
}
```

## Frontend Changes

### New file: `frontend/src/features/risks/hooks/use-risks.ts`
TanStack Query hooks: `useRisks(projectId)`, `useCreateRisk`, `useUpdateRisk`, `useDeleteRisk`.

### New file: `frontend/src/features/risks/components/risks-table.tsx`
Full table with CRUD:
- Table columns: Ref, Description, Probability, Impact, Severity, Mitigation, Phase, Owner, Status, Actions
- Row actions: Edit (inline row or dialog), Delete (confirm dialog)
- "Add Risk" button opens a form dialog/drawer

### New file: `frontend/src/features/risks/components/risk-form-dialog.tsx`
Fields: Description (textarea), Probability (select: Low/Medium/High), Impact (select), Severity (auto-computed or manual select), Mitigation (textarea), Phase (text), Owner (text), Status (select: Open/Closed/Monitoring).

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
Replace the current read-only risks table in the Risks tab with `<RisksTable projectId={projectId} />`.

## Acceptance Criteria
- [ ] Risks tab shows risks from DB (seeded from AI on generation, editable after)
- [ ] "Add Risk" button opens form dialog; new risk appears in table
- [ ] Edit row updates risk in DB
- [ ] Delete with confirm removes risk
- [ ] Owner and Status columns visible
- [ ] Risk ref auto-generated (RSK-01, RSK-02, …)
- [ ] AI-generated risks are seeded to Risk table on schedule generation
