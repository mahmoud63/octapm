import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const hooks = read('src/features/projects/hooks/use-projects.ts')
const detail = read('src/features/projects/components/project-detail.tsx')
const wizard = read(
  'src/features/projects/components/project-setup-wizard.tsx'
)
const reviewPanel = read(
  'src/features/schedule/components/schedule-review-panel.tsx'
)
const progressTab = read('src/features/schedule/components/progress-tab.tsx')

assert.match(
  hooks,
  /\/projects\/\$\{projectId\}\/setup-readiness/,
  'project setup readiness hook calls backend endpoint'
)
assert.ok(
  detail.includes('ProjectSetupWizard'),
  'project detail renders setup wizard'
)
assert.ok(
  detail.includes('handleSetupNavigate'),
  'project detail links setup steps into module navigation'
)

;[
  'Setup Readiness',
  'Ready for progress',
  'Baseline ready',
  'Gate:',
  'ProjectSetupReadiness',
].forEach((copy) => {
  assert.ok(wizard.includes(copy), `setup wizard includes ${copy}`)
})

assert.ok(
  reviewPanel.includes('setupBaselineBlocked'),
  'baseline action consumes project setup gate'
)
assert.ok(
  reviewPanel.includes('Baseline setup blockers'),
  'baseline blockers are visible'
)
assert.ok(
  progressTab.includes('Progress setup warnings'),
  'progress setup warnings are visible'
)
assert.ok(
  progressTab.includes('projectSetupReadinessKey'),
  'progress updates refresh setup readiness'
)

console.log('Project setup readiness UI assertions passed')
