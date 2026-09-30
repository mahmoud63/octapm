// R5-6: the source-check registry accounts for every scripts/*.test.mjs file
// and every test:* script, and it catches the ways it can drift.
import assert from 'node:assert/strict'
import { importSpecifiers, validateRegistry } from './source-checks-registry.mjs'

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
