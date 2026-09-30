// The frontend source-check registry (R5-6): which scripts/*.test.mjs files
// are STATIC (read repository files only) and which are RUNTIME (need a
// database, browser, dev server, network or fixture reset). The runner
// (run-source-checks.mjs) and the registry guard
// (source-checks-registry.test.mjs) share this reading of it, so a file or a
// test:* script that is not accounted for fails both.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const scriptsDir = fileURLToPath(new URL('./', import.meta.url))
export const frontendDir = fileURLToPath(new URL('../', import.meta.url))
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
export const registryPath = fileURLToPath(
  new URL('./source-checks.registry.json', import.meta.url)
)

const CHECK_FILE = /^[\w.-]+\.test\.mjs$/
// What a RUNTIME check may declare it needs.
export const RUNTIME_NEEDS = new Set([
  'database',
  'api',
  'browser',
  'dev-server',
  'network',
  'fixture-reset',
  'child-process',
  'fs-write',
])
// A STATIC check may import only these built-ins, plus relative paths inside
// the repository. The runner enforces the rest at run time.
export const STATIC_IMPORTS = new Set([
  'node:assert',
  'node:assert/strict',
  'node:fs',
  'node:fs/promises',
  'node:path',
  'node:url',
])

export const loadRegistry = () => JSON.parse(readFileSync(registryPath, 'utf8'))

export const loadPackageScripts = () =>
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    .scripts ?? {}

export const listCheckFiles = () =>
  readdirSync(scriptsDir)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()

// The static import specifiers of a module's source (`import ... from 'x'`,
// `import 'x'`, `export ... from 'x'`) and any `require('x')`.
export const importSpecifiers = (source) => {
  const specs = []
  const patterns = [
    /^\s*import\s+[^'"]*?\sfrom\s+['"]([^'"]+)['"]/gms,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /^\s*export\s+[^'"]*?\sfrom\s+['"]([^'"]+)['"]/gms,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns)
    for (const match of source.matchAll(pattern)) specs.push(match[1])
  return specs
}

// Every problem with the registry, as readable sentences. Empty = valid.
export const validateRegistry = ({
  registry = loadRegistry(),
  files = listCheckFiles(),
  scripts = loadPackageScripts(),
  readCheck = (name) =>
    readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'),
} = {}) => {
  const errors = []
  const staticList = Array.isArray(registry.static) ? registry.static : null
  const runtimeList = Array.isArray(registry.runtime) ? registry.runtime : null
  if (!staticList) errors.push('registry.static must be an array of file names')
  if (!runtimeList)
    errors.push(
      'registry.runtime must be an array of { file, needs, reason, ci }'
    )
  if (!staticList || !runtimeList) return errors

  const seen = new Map()
  const note = (file, list) => {
    if (seen.has(file))
      errors.push(
        `${file} is listed more than once (${seen.get(file)} and ${list})`
      )
    else seen.set(file, list)
  }

  for (const file of staticList) {
    if (typeof file !== 'string' || !CHECK_FILE.test(file)) {
      errors.push(
        `static entry ${JSON.stringify(file)} is not a scripts/*.test.mjs file name`
      )
      continue
    }
    note(file, 'static')
  }
  for (const entry of runtimeList) {
    const file = entry?.file
    if (typeof file !== 'string' || !CHECK_FILE.test(file)) {
      errors.push(
        `runtime entry ${JSON.stringify(entry)} has no scripts/*.test.mjs file name`
      )
      continue
    }
    note(file, 'runtime')
    const needs = Array.isArray(entry.needs) ? entry.needs : []
    if (needs.length === 0)
      errors.push(
        `runtime ${file} must name what it needs (${[...RUNTIME_NEEDS].join(', ')})`
      )
    for (const need of needs)
      if (!RUNTIME_NEEDS.has(need))
        errors.push(`runtime ${file} names an unknown need "${need}"`)
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '')
      errors.push(`runtime ${file} must say why it is not static (reason)`)
    if (typeof entry.ci !== 'string' || entry.ci.trim() === '')
      errors.push(
        `runtime ${file} must name the isolated CI job that runs it, or "excluded: <why>" (ci)`
      )
  }

  const present = new Set(files)
  for (const file of seen.keys())
    if (!present.has(file))
      errors.push(`${file} is registered but scripts/${file} does not exist`)
  for (const file of files)
    if (!seen.has(file))
      errors.push(
        `scripts/${file} is in neither the static nor the runtime list of scripts/source-checks.registry.json`
      )

  // Every test:* script is either a node run of registered checks or a named
  // exception (test:e2e is Playwright; test:source is the runner).
  const exceptions = registry.notSourceChecks ?? {}
  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith('test:')) continue
    const referenced = [
      ...command.matchAll(/scripts\/([\w.-]+\.test\.mjs)/g),
    ].map((m) => m[1])
    for (const file of referenced)
      if (!seen.has(file))
        errors.push(
          `package.json "${name}" runs scripts/${file}, which is not in the registry`
        )
    if (name in exceptions) continue
    const parts = command.split('&&').map((part) => part.trim())
    for (const part of parts)
      if (!/^node scripts\/[\w.-]+\.test\.mjs$/.test(part))
        errors.push(
          `package.json "${name}" runs "${part}", which is neither a registered source check nor listed in notSourceChecks`
        )
  }
  for (const name of Object.keys(exceptions))
    if (!(name in scripts))
      errors.push(
        `notSourceChecks names "${name}", which is not a package.json script`
      )

  // A STATIC check imports only file/path/assert built-ins and repository files.
  for (const file of staticList) {
    if (!present.has(file)) continue
    for (const spec of importSpecifiers(readCheck(file)))
      if (!STATIC_IMPORTS.has(spec) && !spec.startsWith('.'))
        errors.push(
          `static ${file} imports "${spec}"; a static check may import only ${[...STATIC_IMPORTS].join(', ')} and repository files; register it as runtime if it needs more`
        )
  }
  return errors
}
