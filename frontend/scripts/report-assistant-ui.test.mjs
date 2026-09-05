import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-AI-NLREPORT-033 — natural-language reporting wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/reports/hooks/use-report-assistant.ts')
const ask = read('src/features/reports/components/report-ask.tsx')
const narrative = read('src/features/reports/components/report-narrative.tsx')
const page = read('src/features/reports/report-builder-page.tsx')
const editor = read('src/features/reports/components/report-editor.tsx')
const routes = readFileSync(path.join(root, '..', 'backend', 'src', 'routes', 'report-builder.js'), 'utf8')
const service = readFileSync(path.join(root, '..', 'backend', 'src', 'services', 'report-assistant.service.js'), 'utf8')

assert.match(hooks, /export const useAskReport\b/, 'ask hook')
assert.match(hooks, /export const useNarrateReport\b/, 'narrate hook')
assert.match(hooks, /'\/reports\/ask'/, 'ask endpoint')
assert.match(hooks, /'\/reports\/narrate'/, 'narrate endpoint')

assert.match(ask, /export function ReportAsk/, 'ask box component')
assert.match(ask, /data-testid='uat-report-ask-question'/, 'question box')
assert.match(ask, /data-testid='uat-report-ask-scope'/, 'project scope')
assert.match(ask, /data-testid='uat-report-ask-run'/, 'build button')
assert.match(ask, /data-testid='uat-report-ask-warnings'/, 'dropped parts are listed')
assert.match(ask, /data-testid='uat-report-ask-use'/, 'open in the builder')
assert.match(ask, /Nothing is saved here/, 'assistant never saves')

assert.match(narrative, /export function ReportNarrative/, 'narrative component')
assert.match(narrative, /data-testid='uat-report-narrate'/, 'explain button')
assert.match(narrative, /data-testid='uat-report-narrative-result'/, 'narrative result')

assert.match(page, /<ReportAsk\s+projects=\{projects\}/, 'ask box on the new-report page')
assert.match(page, /setSeed\(\{ definition, key: Date\.now\(\) \}\)/, 'definition seeds the editor')
assert.match(page, /seed && seed\.definition\.source === source\?\.key\s*\? seed\.definition\s*: blankDefinition\(source\)/, 'editor opens with the seeded definition')
assert.match(editor, /<ReportNarrative definition=\{draft\} \/>/, 'narrative under the preview')

assert.match(routes, /"\/ask",\s*requirePermission\("assistant", "read"\)/, 'ask route gated')
assert.match(routes, /"\/narrate",\s*requirePermission\("assistant", "read"\)/, 'narrate route gated')
assert.match(service, /const repair = async/, 'definitions repaired against the builder normaliser')
assert.match(service, /const heuristicDefinition = /, 'keyword fallback')
assert.match(service, /const deterministicNarrative = /, 'numbers-only narrative fallback')

console.log('report-assistant-ui: ok')
