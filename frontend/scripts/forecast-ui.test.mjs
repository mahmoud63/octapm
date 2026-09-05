import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-AI-PREDICT-031 — schedule delay and cost overrun prediction wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/forecast/hooks/use-forecast.ts')
const panel = read('src/features/forecast/components/forecast-panel.tsx')
const dashboard = read('src/features/schedule/components/schedule-dashboard.tsx')
const detail = read('src/features/projects/components/project-detail.tsx')
const backendRoutes = readFileSync(path.join(root, '..', 'backend', 'src', 'routes', 'projects.js'), 'utf8')
const service = readFileSync(path.join(root, '..', 'backend', 'src', 'services', 'forecast.service.js'), 'utf8')

for (const name of ['useForecast', 'useExplainForecast', 'useRunForecastAction']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /`\/projects\/\$\{projectId\}\/forecast`/, 'forecast endpoint')
assert.match(hooks, /\/explain`, \{\}, \{ timeout: 120_000 \}/, 'explain endpoint with a long timeout')
assert.match(hooks, /\/actions`, \{ action \}/, 'actions endpoint')

assert.match(panel, /export function ForecastPanel/, 'panel component')
assert.match(panel, /data-testid=\{testId\}/, 'tiles carry their test id')
assert.match(panel, /testId='uat-forecast-finish'/, 'projected finish tile')
assert.match(panel, /testId='uat-forecast-cost'/, 'projected cost tile')
assert.match(panel, /data-testid='uat-forecast-explain'/, 'explain button')
assert.match(panel, /data-testid='uat-forecast-refresh'/, 'recompute button')
assert.match(panel, /data-testid='uat-forecast-activity'/, 'activity rows')
assert.match(panel, /data-testid='uat-forecast-cost-row'/, 'cost rows')
assert.match(panel, /data-testid='uat-forecast-line'/, 'budget line rows')
assert.match(panel, /data-testid='uat-forecast-narrative'/, 'narrative card')
assert.match(panel, /uat-forecast-action-\$\{action\.type\}/, 'draft actions run from the narrative')
assert.match(panel, /useCanPerform\('risk', 'create'\)/, 'risk action gated by permission')
assert.match(panel, /useCanPerform\('task', 'create'\)/, 'task action gated by permission')
assert.match(panel, /data-testid='uat-forecast-data-quality'/, 'data quality notes')
assert.match(panel, /Nothing here is a\s+model guess/, 'forecast vs narrative distinction explained')

assert.match(dashboard, /<TabsTrigger value='forecast'>Forecast<\/TabsTrigger>/, 'forecast tab trigger')
assert.match(dashboard, /<TabsContent value='forecast'[\s\S]*<ForecastPanel projectId=\{projectId\} \/>/, 'forecast tab content')
assert.match(detail, /\{ key: 'forecast', label: 'Forecast' \}/, 'forecast in the schedule menu')

assert.match(backendRoutes, /"\/:projectId\/forecast", nestedProjectAccess, require\("\.\/forecast"\)/, 'backend route mounted')
assert.match(service, /const forecastActivity = /, 'per-activity projection')
assert.match(service, /HISTORY_DAYS = 45/, 'velocity window')
assert.match(service, /overrun = projectedCost === null \? 0 : Math\.max\(0, /, 'underruns are not risks')

console.log('forecast-ui: ok')
