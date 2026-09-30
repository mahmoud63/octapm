// R5-6: run every STATIC frontend source check from
// scripts/source-checks.registry.json, each in its own node process.
//
//   node scripts/run-source-checks.mjs [--out <dir>] [--concurrency <n>]
//                                      [--timeout-ms <ms>]
//
// Each check runs under the Node permission model with read-only access to the
// repository (no child processes, no file writes) and with network APIs
// disabled (source-checks-static-guard.mjs), so a check that is not truly
// static fails instead of quietly reaching a database, server or browser.
// Every check's real exit code, signal, duration and output are kept: one
// PASS/FAIL line per check, a JSON summary and a combined log in the output
// directory (default frontend/test-results/source-checks/), and the output of
// every failing check printed at the end. A RUNTIME check is never run here;
// each one is named in the output, the summary and the log with the CI job
// that runs it, or as excluded from CI. The runner exits 1 if the registry is
// invalid, if no check ran, or if any check did not exit 0.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  describeRuntimeCheck,
  frontendDir,
  loadRegistry,
  registryPath,
  repoRoot,
  scriptsDir,
  validateRegistry,
} from './source-checks-registry.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`run-source-checks: ${name} needs a value`)
    process.exit(2)
  }
  return value
}
const known = new Set(['--out', '--concurrency', '--timeout-ms'])
for (let i = 0; i < args.length; i += 2)
  if (!known.has(args[i])) {
    console.error(`run-source-checks: unknown argument ${args[i]}`)
    process.exit(2)
  }

const outDir = resolve(
  option('--out', join(frontendDir, 'test-results', 'source-checks'))
)
const concurrency = Math.max(
  1,
  Number(option('--concurrency', String(Math.min(4, availableParallelism()))))
)
const timeoutMs = Math.max(1000, Number(option('--timeout-ms', '120000')))
const guardUrl = pathToFileURL(
  join(scriptsDir, 'source-checks-static-guard.mjs')
).href

// A check sees no credentials or connection strings from the parent shell.
const SENSITIVE =
  /DATABASE|POSTGRES|PG(HOST|USER|PASSWORD|DATABASE|PORT)|SECRET|TOKEN|PASSWORD|API_KEY|CREDENTIAL|PRIVATE|AWS_|STRIPE/i
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !SENSITIVE.test(key) && key !== 'NODE_OPTIONS'
  )
)
childEnv.OCTAPM_SOURCE_CHECK = 'static'

const writeReports = (summary, logSections) => {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    join(outDir, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n'
  )
  writeFileSync(join(outDir, 'source-checks.log'), logSections.join('\n'))
}

const startedAt = new Date()
const registryErrors = validateRegistry()
const registry = loadRegistry()
const runtime = registry.runtime ?? []
const baseSummary = {
  startedAt: startedAt.toISOString(),
  node: process.version,
  registry: registryPath,
  repoRoot,
  concurrency,
  timeoutMs,
  runtimeNotRunHere: runtime.map(({ file, needs, reason, ci }) => ({
    file,
    needs,
    reason,
    ci,
  })),
}

if (registryErrors.length > 0) {
  console.error('FAIL  source-check registry is invalid:')
  for (const error of registryErrors) console.error(`  - ${error}`)
  writeReports(
    {
      ...baseSummary,
      finishedAt: new Date().toISOString(),
      ok: false,
      registryErrors,
      total: 0,
      passed: 0,
      failed: 0,
      checks: [],
    },
    ['source-check registry is invalid:', ...registryErrors, '']
  )
  process.exit(1)
}

const runCheck = (file) =>
  new Promise((done) => {
    const started = process.hrtime.bigint()
    const output = []
    let timedOut = false
    let spawnError = null
    const child = spawn(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${repoRoot}`,
        '--import',
        guardUrl,
        join(scriptsDir, file),
      ],
      { cwd: frontendDir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    child.stdout.on('data', (chunk) => output.push(chunk))
    child.stderr.on('data', (chunk) => output.push(chunk))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('error', (error) => {
      spawnError = error
    })
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer)
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6
      let text = Buffer.concat(output).toString('utf8')
      if (spawnError) text += `\n[runner] could not start: ${spawnError.message}`
      if (timedOut) text += `\n[runner] killed after ${timeoutMs} ms (timeout)`
      done({
        file,
        status: exitCode === 0 && !timedOut && !spawnError ? 'PASS' : 'FAIL',
        exitCode,
        signal,
        timedOut,
        durationMs: Math.round(durationMs),
        output: text,
      })
    })
  })

const queue = [...registry.static]
const results = []
const worker = async () => {
  while (queue.length > 0) {
    const file = queue.shift()
    const result = await runCheck(file)
    results.push(result)
    const code =
      result.exitCode === null ? `signal=${result.signal}` : `exit=${result.exitCode}`
    console.log(
      `${result.status}  ${file}  ${code}${result.timedOut ? ' timeout' : ''}  (${result.durationMs} ms)`
    )
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))
const runtimeLines = runtime.map(describeRuntimeCheck)
for (const line of runtimeLines) console.log(line)

const order = new Map(registry.static.map((file, index) => [file, index]))
results.sort((a, b) => order.get(a.file) - order.get(b.file))
const failed = results.filter((result) => result.status !== 'PASS')
const ok = results.length > 0 && failed.length === 0

writeReports(
  {
    ...baseSummary,
    finishedAt: new Date().toISOString(),
    ok,
    registryErrors: [],
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    failedChecks: failed.map((result) => result.file),
    checks: results.map(({ output: _output, ...rest }) => rest),
  },
  [
    ...results.map(
      (result) =>
        `===== ${result.status} ${result.file} exit=${result.exitCode} signal=${result.signal} ${result.durationMs} ms =====\n${result.output}`
    ),
    ...(runtimeLines.length > 0
      ? [
          '===== runtime checks, not run by the static runner =====',
          ...runtimeLines,
          '',
        ]
      : []),
  ]
)

console.log(
  `\nsource checks: ${results.length - failed.length}/${results.length} passed` +
    `; ${runtime.length} runtime check(s) registered and not run here` +
    `\nsummary: ${join(outDir, 'summary.json')}\nlog: ${join(outDir, 'source-checks.log')}`
)
if (results.length === 0) console.error('FAIL  no static source check ran')
for (const result of failed) {
  console.error(
    `\n----- FAIL ${result.file} (exit=${result.exitCode} signal=${result.signal}${result.timedOut ? ', timeout' : ''}) -----`
  )
  console.error(result.output.trimEnd() || '(no output)')
}
if (failed.length > 0)
  console.error(
    `\n${failed.length} source check(s) failed: ${failed.map((r) => r.file).join(', ')}`
  )
process.exit(ok ? 0 : 1)
