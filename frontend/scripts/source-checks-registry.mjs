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

// The one workflow a RUNTIME check's `ci` job may live in.
export const CI_WORKFLOW = '.github/workflows/quality-gates.yml'
const EXCLUDED_FROM_CI = /^excluded:\s*(\S.*)$/s

export const loadWorkflow = () =>
  readFileSync(new URL(`../../${CI_WORKFLOW}`, import.meta.url), 'utf8')

// The jobs of a GitHub Actions workflow, read as text: job id -> that job's
// own lines. Enough to tell whether a job exists and what its steps run.
export const workflowJobs = (text) => {
  const jobs = new Map()
  let inJobs = false
  let current = null
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(line)) continue
    if (/^jobs:\s*(#.*)?$/.test(line)) {
      inJobs = true
      continue
    }
    if (/^\S/.test(line)) {
      inJobs = false
      current = null
    }
    if (!inJobs) continue
    const job = /^ {2}([A-Za-z_][\w-]*):\s*(#.*)?$/.exec(line)
    if (job) {
      current = job[1]
      jobs.set(current, [])
    } else if (current) jobs.get(current).push(line)
  }
  return new Map([...jobs].map(([id, lines]) => [id, lines.join('\n')]))
}

// Does this job run the check: by file name, or through an npm script whose
// command runs the file? The static runner's job never does; it runs the
// static list only.
const jobRunsCheck = (jobText, file, scripts) =>
  jobText.includes(`scripts/${file}`) ||
  Object.entries(scripts).some(
    ([name, command]) =>
      String(command).includes(`scripts/${file}`) &&
      jobText
        .split(`npm run ${name}`)
        .slice(1)
        .some((rest) => !/^[\w:.-]/.test(rest))
  )

// One line per RUNTIME check for the runner's output: the static runner does
// not run it, and this says where it runs instead, or that it runs nowhere.
export const describeRuntimeCheck = ({ file, needs, ci }) => {
  const excluded = EXCLUDED_FROM_CI.exec(String(ci ?? '').trim())
  return (
    `NOT RUN  ${file}  runtime (needs ${(needs ?? []).join(', ') || '?'}); ` +
    (excluded
      ? `EXCLUDED from CI: ${excluded[1].trim()}`
      : `runs in CI job "${ci}" (${CI_WORKFLOW})`)
  )
}

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
  // The CI workflow's text; read only when a runtime entry names a job.
  readWorkflow = loadWorkflow,
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

  let ciJobs = null
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
    // `ci` is either "excluded: <why>" or a job of the CI workflow whose steps
    // run this file. Any other text would take a check out of the static run
    // and run it nowhere.
    const ci = typeof entry.ci === 'string' ? entry.ci.trim() : ''
    if (ci === '') {
      errors.push(
        `runtime ${file} must name the isolated CI job that runs it, or "excluded: <why>" (ci)`
      )
    } else if (/^excluded\b/i.test(ci)) {
      if (!EXCLUDED_FROM_CI.test(ci))
        errors.push(
          `runtime ${file} is excluded from CI without a reason; write "excluded: <why>" (ci)`
        )
    } else {
      try {
        ciJobs ??= workflowJobs(readWorkflow())
      } catch (error) {
        errors.push(
          `runtime ${file} names CI job "${ci}", but ${CI_WORKFLOW} cannot be read (${error.message})`
        )
        continue
      }
      if (!ciJobs.has(ci))
        errors.push(
          `runtime ${file} names CI job "${ci}", which is not a job in ${CI_WORKFLOW} (jobs: ${[...ciJobs.keys()].join(', ') || 'none'}); name the isolated job that runs it, or "excluded: <why>"`
        )
      else if (!jobRunsCheck(ciJobs.get(ci), file, scripts))
        errors.push(
          `runtime ${file} names CI job "${ci}", but that job does not run it: its steps mention neither scripts/${file} nor an npm script that runs it`
        )
    }
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
