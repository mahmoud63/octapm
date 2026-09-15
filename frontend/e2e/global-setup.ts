import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every run starts from the same rows (Phase 22B).
 *
 * The suites sign in to a dedicated organisation, "OctaPM E2E", whose people
 * are <role>@octapm-e2e.test. Before a run, backend/scripts/e2e/reset-e2e-org.js
 * deletes that organisation (and any a suite registered itself) and seeds it
 * again from prisma/seed.js — so a run never sees another run's residue, the
 * demo organisation is never touched, and three runs in a row give the same
 * answer. A failed reset fails the run, loudly, rather than letting the
 * suites drift onto stale data.
 *
 * Set E2E_SKIP_RESET=1 to keep the current rows (debugging one spec).
 */
export default function globalSetup() {
  if (process.env.E2E_SKIP_RESET === '1') {
    process.stdout.write('[e2e] E2E_SKIP_RESET=1 — keeping the current E2E organisation\n')
    return
  }
  const backend = fileURLToPath(new URL('../../backend/', import.meta.url))
  const script = path.join(backend, 'scripts', 'e2e', 'reset-e2e-org.js')
  if (!existsSync(script)) throw new Error(`[e2e] reset script missing: ${script}`)
  const started = Date.now()
  const result = spawnSync(process.execPath, [script], {
    cwd: backend,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  process.stdout.write(result.stdout || '')
  if (result.status !== 0) {
    process.stderr.write(result.stderr || '')
    throw new Error(`[e2e] resetting the E2E organisation failed (exit ${result.status})`)
  }
  process.stdout.write(`[e2e] E2E organisation reset and seeded in ${((Date.now() - started) / 1000).toFixed(1)} s\n`)
}
