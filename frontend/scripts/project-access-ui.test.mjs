import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const projectDetail = readFileSync(
  new URL('../src/features/projects/components/project-detail.tsx', import.meta.url),
  'utf8'
)

const projectHooks = readFileSync(
  new URL('../src/features/projects/hooks/use-projects.ts', import.meta.url),
  'utf8'
)

const scheduleHooks = readFileSync(
  new URL('../src/features/schedule/hooks/use-schedule.ts', import.meta.url),
  'utf8'
)

assert.match(
  projectDetail,
  /projectError instanceof AxiosError && projectError\.response\?\.status === 403/,
  'Project detail detects 403 project authorization errors'
)

assert.match(
  projectDetail,
  /Project access restricted/,
  'Project detail renders a clear project-access denial state'
)

assert.match(
  projectDetail,
  /This project is only visible to assigned project members\./,
  'Project detail explains project membership restriction'
)

assert.match(
  projectDetail,
  /useProjectSetupReadiness\(\s*projectId,\s*\{ enabled: canLoadProjectModules \}\s*\)/,
  'Setup readiness query waits for project access'
)

assert.match(
  projectDetail,
  /useProjectSchedule\(\s*projectId,\s*\{ enabled: canLoadProjectModules \}\s*\)/,
  'Schedule query waits for project access'
)

assert.match(
  projectHooks,
  /enabled: Boolean\(projectId\) && \(options\.enabled \?\? true\)/,
  'Project setup readiness hook supports dependent query gating'
)

assert.match(
  scheduleHooks,
  /enabled: !!projectId && \(options\.enabled \?\? true\)/,
  'Project schedule hook supports dependent query gating'
)

console.log('Project access UI assertions passed')
