/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import path from 'node:path'

/**
 * Put the end-to-end organisation back to its seeded state before the run.
 *
 * Certification writes as it goes — change orders, approvals, RFIs, receipts —
 * and a run that is interrupted or fails leaves its rows behind. They used to
 * stay: the organisation had reached thirty-five projects, two hundred RFIs and
 * forty-seven approvals still waiting on the project manager, and the suite had
 * begun to fail because of what earlier suites had left rather than because of
 * the code. A test that depends on an ever-growing shared history is not a test.
 *
 * So the reset runs at the *start*, not the end. Anything an afterAll would have
 * tidied is already gone by the time the next run begins, and a killed process
 * cannot poison what follows it.
 *
 * `backend/scripts/e2e/reset-e2e-org.js` does the work and refuses any
 * organisation whose name is not an E2E name — of the twenty-three on this
 * machine exactly one qualifies, and the demo and UAT fixtures are untouched.
 *
 * Set E2E_SKIP_RESET=1 to iterate on a single spec without paying for a reseed.
 */
/* eslint-disable no-console -- this is a build step; its progress belongs on the run log. */
export default function globalSetup(): void {
  if (process.env.E2E_SKIP_RESET === '1') {
    console.log('[e2e] E2E_SKIP_RESET=1 — reusing the organisation as it stands')
    return
  }
  const backend = path.resolve(__dirname, '..', '..', 'backend')
  console.log('[e2e] resetting the end-to-end organisation…')
  execFileSync(process.execPath, [path.join('scripts', 'e2e', 'reset-e2e-org.js')], {
    cwd: backend,
    stdio: 'inherit',
    timeout: 10 * 60_000,
  })
}
