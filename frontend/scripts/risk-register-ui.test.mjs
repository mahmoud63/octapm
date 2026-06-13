import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const riskHook = read('src/features/risks/hooks/use-risks.ts')
const riskTable = read('src/features/risks/components/risks-table.tsx')
const riskForm = read('src/features/risks/components/risk-form-dialog.tsx')
const schedule = read('src/features/schedule/components/schedule-dashboard.tsx')
const scheduleSchema = read('src/features/schedule/data/schema.ts')
const projectDetail = read('src/features/projects/components/project-detail.tsx')
const workspaceService = read(
  '../backend/src/services/workspace-dashboard.service.js'
)

;[
  'activityLinks',
  'responsePlan',
  'residualSeverity',
  'dueDate',
  'escalationLevel',
  'useSubmitRiskCloseout',
  'useApproveRiskCloseout',
  'useRejectRiskCloseout',
  'useReopenRisk',
].forEach((token) => {
  assert.ok(riskHook.includes(token), `risk hook exposes ${token}`)
})

;[
  'Activity Impact',
  'Mitigation Due',
  'Residual Risk',
  'Escalation',
  'scheduleImpactDays',
  'costImpact',
].forEach((label) => {
  assert.ok(riskForm.includes(label), `risk form includes ${label}`)
})

;[
  'Risk closeout review',
  'Overdue Risk Mitigations',
  'source: "risk"',
  'status: "overdue"',
].forEach((label) => {
  assert.ok(workspaceService.includes(label), `dashboard risk queue includes ${label}`)
})

assert.ok(
  riskTable.includes("initialTarget?.source !== 'risk'") &&
    riskTable.includes("initialTarget.status === 'overdue'") &&
    riskTable.includes("<AuditHistoryPanel") &&
    riskTable.includes("entityType='risk'") &&
    riskTable.includes('WorkflowDecisionDialog'),
  'risk table supports dashboard filters, audit history, and PM decisions'
)

assert.ok(
  schedule.includes('Project Risk') &&
    schedule.includes('projectRiskSummary') &&
    schedule.includes('initialTarget={initialTarget}') &&
    projectDetail.includes('initialTarget={initialTarget}') &&
    scheduleSchema.includes('scheduleRiskSummarySchema'),
  'schedule activity grid surfaces linked project risks'
)

console.log('Risk register UI assertions passed')
