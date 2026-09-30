// R5-6: the source-check registry accounts for every scripts/*.test.mjs file
// and every test:* script, and it catches the ways it can drift.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  describeRuntimeCheck,
  importSpecifiers,
  loadWorkflow,
  validateRegistry,
  workflowJobs,
} from './source-checks-registry.mjs'

// The committed registry is complete and consistent.
const errors = validateRegistry()
assert.deepEqual(errors, [], `registry problems:\n- ${errors.join('\n- ')}`)

// The guard itself has teeth, on a small synthetic registry.
const files = ['a.test.mjs', 'b.test.mjs']
const scripts = {
  'test:a': 'node scripts/a.test.mjs',
  'test:e2e': 'playwright test',
}
const registry = {
  static: ['a.test.mjs', 'b.test.mjs'],
  runtime: [],
  notSourceChecks: { 'test:e2e': 'Playwright' },
}
const clean = "import assert from 'node:assert/strict'\n"
const run = (overrides = {}) =>
  validateRegistry({
    registry,
    files,
    scripts,
    readCheck: () => clean,
    ...overrides,
  })

assert.deepEqual(run(), [], 'the synthetic registry is valid')

const hasError = (errs, pattern, label) =>
  assert.ok(
    errs.some((e) => pattern.test(e)),
    `${label}: expected an error matching ${pattern}, got ${JSON.stringify(errs)}`
  )

hasError(
  run({ files: [...files, 'c.test.mjs'] }),
  /scripts\/c\.test\.mjs is in neither the static nor the runtime list/,
  'an unregistered test file fails'
)
hasError(
  run({ scripts: { ...scripts, 'test:d': 'node scripts/d.test.mjs' } }),
  /"test:d" runs scripts\/d\.test\.mjs, which is not in the registry/,
  'a test:* script pointing at an unregistered file fails'
)
hasError(
  run({ scripts: { ...scripts, 'test:x': 'vitest run' } }),
  /"test:x" runs "vitest run", which is neither a registered source check/,
  'a test:* script that is not a node source check and not an exception fails'
)
hasError(
  run({ registry: { ...registry, static: [...registry.static, 'z.test.mjs'] } }),
  /z\.test\.mjs is registered but scripts\/z\.test\.mjs does not exist/,
  'a registered file that does not exist fails'
)
hasError(
  run({
    registry: {
      ...registry,
      runtime: [{ file: 'a.test.mjs', needs: ['database'], reason: 'r', ci: 'j' }],
    },
  }),
  /a\.test\.mjs is listed more than once/,
  'a file in both lists fails'
)
hasError(
  run({
    registry: {
      ...registry,
      static: ['a.test.mjs'],
      runtime: [{ file: 'b.test.mjs', needs: [], reason: '', ci: '' }],
    },
  }),
  /runtime b\.test\.mjs must name what it needs/,
  'a runtime entry without needs fails'
)
hasError(
  run({
    registry: {
      ...registry,
      static: ['a.test.mjs'],
      runtime: [{ file: 'b.test.mjs', needs: ['database'], reason: '', ci: '' }],
    },
  }),
  /runtime b\.test\.mjs must say why/,
  'a runtime entry without a reason fails'
)
// A RUNTIME entry's `ci` is a job of the CI workflow that runs the file, or an
// explicit "excluded: <why>". Anything else would take a check out of the
// static run and run it nowhere.
const workflow = [
  'name: Quality Gates',
  'on:',
  '  pull_request:',
  'jobs:',
  '  static-checks:',
  '    # the static runner',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: npm run test:source --workspace=frontend',
  '',
  '  db-checks:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: node scripts/b.test.mjs',
  '  script-checks:',
  '    steps:',
  '      - run: npm run test:b --workspace=frontend',
  '  other-script-checks:',
  '    steps:',
  '      - run: npm run test:bb --workspace=frontend',
  'defaults:',
  '  not-a-job:',
  '    run: node scripts/b.test.mjs',
  '',
].join('\n')
const runtimeRun = (ci, overrides = {}) =>
  run({
    registry: {
      ...registry,
      static: ['a.test.mjs'],
      runtime: [{ file: 'b.test.mjs', needs: ['database'], reason: 'r', ci }],
    },
    scripts: { ...scripts, 'test:b': 'node scripts/b.test.mjs' },
    readWorkflow: () => workflow,
    ...overrides,
  })

assert.deepEqual(
  [...workflowJobs(workflow).keys()],
  ['static-checks', 'db-checks', 'script-checks', 'other-script-checks'],
  'the workflow reader sees the jobs and nothing outside jobs:'
)
assert.deepEqual(
  runtimeRun('db-checks'),
  [],
  'a runtime entry whose job runs the file is valid'
)
assert.deepEqual(
  runtimeRun('script-checks'),
  [],
  'a runtime entry whose job runs the npm script for the file is valid'
)
assert.deepEqual(
  runtimeRun('excluded: needs a licensed browser farm'),
  [],
  'a runtime entry excluded from CI with a reason is valid'
)
hasError(
  runtimeRun('no-such-job'),
  /runtime b\.test\.mjs names CI job "no-such-job", which is not a job in \.github\/workflows\/quality-gates\.yml/,
  'a runtime entry naming a job that does not exist fails'
)
hasError(
  runtimeRun('not-a-job'),
  /runtime b\.test\.mjs names CI job "not-a-job", which is not a job/,
  'a key outside jobs: is not a job'
)
hasError(
  runtimeRun('static-checks'),
  /runtime b\.test\.mjs names CI job "static-checks", but that job does not run it/,
  'a runtime entry naming the static job (which never runs runtime checks) fails'
)
hasError(
  runtimeRun('other-script-checks'),
  /names CI job "other-script-checks", but that job does not run it/,
  'a job running a different npm script does not count'
)
hasError(
  runtimeRun('excluded'),
  /runtime b\.test\.mjs is excluded from CI without a reason/,
  'an exclusion without a reason fails'
)
hasError(
  runtimeRun('excluded:   '),
  /runtime b\.test\.mjs is excluded from CI without a reason/,
  'an exclusion with a blank reason fails'
)
hasError(
  runtimeRun('db-checks', {
    readWorkflow: () => {
      throw new Error('ENOENT')
    },
  }),
  /names CI job "db-checks", but \.github\/workflows\/quality-gates\.yml cannot be read \(ENOENT\)/,
  'a workflow that cannot be read fails rather than passing the job name'
)
assert.deepEqual(
  run({
    readWorkflow: () => {
      throw new Error('the workflow is read only when a job is named')
    },
  }),
  [],
  'with no runtime entry the workflow is not read'
)

// The runner names every runtime check it leaves out, and where it runs.
assert.equal(
  describeRuntimeCheck({
    file: 'b.test.mjs',
    needs: ['database', 'api'],
    ci: 'db-checks',
  }),
  'NOT RUN  b.test.mjs  runtime (needs database, api); runs in CI job "db-checks" (.github/workflows/quality-gates.yml)'
)
assert.equal(
  describeRuntimeCheck({
    file: 'b.test.mjs',
    needs: ['browser'],
    ci: 'excluded: no browser in CI',
  }),
  'NOT RUN  b.test.mjs  runtime (needs browser); EXCLUDED from CI: no browser in CI'
)
const runner = readFileSync(
  new URL('./run-source-checks.mjs', import.meta.url),
  'utf8'
)
assert.match(
  runner,
  /const runtimeLines = runtime\.map\(describeRuntimeCheck\)\s+for \(const line of runtimeLines\) console\.log\(line\)/,
  'the runner prints one line per runtime check'
)
assert.match(
  runner,
  /'===== runtime checks, not run by the static runner =====',\s+\.\.\.runtimeLines,/,
  'the runner keeps those lines in the log'
)

// The real workflow runs the static registry with its real exit code, keeps
// its evidence, and the required-checks job waits for it.
const realJobs = workflowJobs(loadWorkflow())
const staticJob = realJobs.get('frontend-source-checks') ?? ''
assert.match(
  staticJob,
  /run: npm run test:source --workspace=frontend/,
  'quality-gates.yml has a frontend-source-checks job that runs the static runner'
)
assert.match(
  staticJob,
  /if: always\(\)\s+uses: actions\/upload-artifact@v\d+[\s\S]*path: frontend\/test-results\/source-checks/,
  'the job uploads the summary and log even when a check fails'
)
assert.doesNotMatch(
  staticJob,
  /continue-on-error|\|\|\s*true/,
  "the job keeps the runner's real exit code"
)
assert.match(
  realJobs.get('deployment-readiness') ?? '',
  /needs:[\s\S]*?- frontend-source-checks[\s\S]*FRONTEND_SOURCE_CHECKS_RESULT/,
  'the required-checks job depends on the source checks'
)

hasError(
  run({
    readCheck: (name) =>
      name === 'b.test.mjs' ? "import pg from 'pg'\n" : clean,
  }),
  /static b\.test\.mjs imports "pg"/,
  'a static check importing a database client fails'
)
hasError(
  run({
    readCheck: (name) =>
      name === 'b.test.mjs' ? "import { spawn } from 'node:child_process'\n" : clean,
  }),
  /static b\.test\.mjs imports "node:child_process"/,
  'a static check importing child_process fails'
)

// The import reader sees multi-line imports and ignores import() inside strings.
assert.deepEqual(
  importSpecifiers(
    "import {\n  a,\n  b,\n} from '../src/x.ts'\nconst s = \"import('@/y')\"\n"
  ),
  ['../src/x.ts']
)

console.log('source-checks-registry: ok')
