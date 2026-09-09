#!/usr/bin/env node
/**
 * Is the local stack actually in the shape the browser suite assumes?
 *
 * The suite needs exactly three long-lived processes — one database, one API,
 * one web server — and it fails in confusing ways when that is not true. A
 * second API losing the race for :5000 leaves a dead nodemon that restarts the
 * *live* one mid-suite; that invalidated a whole 16-minute regression run and
 * looked like a product defect (a sign-in failure deep into the suite).
 *
 * This reports; it does not repair. Killing a process the operator did not ask
 * about is how you lose someone else's work, so where something is wrong this
 * prints the exact command and stops.
 *
 *   node scripts/dev-preflight.mjs
 *   npm run dev:check
 */

import { execFileSync } from 'node:child_process'
import net from 'node:net'

const API_PORT = Number(process.env.API_PORT || 5000)
const WEB_PORT = Number(process.env.WEB_PORT || 5173)
const DB_PORT = Number(process.env.DEV_DB_PORT || 55432)
const API_HEALTH = `http://localhost:${API_PORT}/api/health`

const isWindows = process.platform === 'win32'
let failures = 0

const say = (icon, label, detail) =>
  console.log(`${icon} ${label.padEnd(26)} ${detail}`)

const fail = (label, detail, remedy) => {
  failures += 1
  say('✗', label, detail)
  if (remedy) console.log(`${' '.repeat(2)}→ ${remedy}`)
}

/**
 * Anything listening, without caring what it is.
 *
 * Both address families, because Vite binds `::1` only: probing 127.0.0.1
 * alone reported the web server down while curl on the same port answered 200,
 * and acting on that would have started a second one — the very duplicate this
 * script exists to prevent.
 */
const openOn = (port, host) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(1500)
    socket.on('connect', () => done(true))
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
  })

const portOpen = async (port) =>
  (await openOn(port, '127.0.0.1')) || (await openOn(port, '::1'))

/** Who owns the port, on Windows, where this actually bites. */
const ownerOf = (port) => {
  if (!isWindows) return null
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;` +
          `if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue;` +
          `"$($c.OwningProcess)|$($p.ProcessName)|$($p.Path)" }`,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    ).trim()
    if (!out) return null
    const [pid, name, path] = out.split('|')
    return { pid: Number(pid), name, path: path || '' }
  } catch {
    return null
  }
}

const fetchJson = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return { ok: response.ok, status: response.status, body: await response.json() }
  } catch (error) {
    return { ok: false, status: 0, error: String(error.message || error) }
  }
}

console.log('\nOctaPM local stack preflight\n')

// ── 1. Database ────────────────────────────────────────────────────────
if (await portOpen(DB_PORT)) {
  say('✓', 'database', `listening on :${DB_PORT}`)
} else {
  fail(
    'database',
    `nothing on :${DB_PORT}`,
    'cd backend && DEV_DB_PORT=55432 DEV_DB_DIR=C:/Temp/octapm-pg node scripts/dev-db.mjs',
  )
}

// ── 2. API: exactly one, and answering its own health endpoint ─────────
const apiOwner = ownerOf(API_PORT)
const health = await fetchJson(API_HEALTH)

if (health.ok && health.body?.data?.status === 'ok') {
  say('✓', 'api', `healthy on :${API_PORT}${apiOwner ? ` (pid ${apiOwner.pid})` : ''}`)
} else if (apiOwner) {
  fail(
    'api',
    `:${API_PORT} is held by pid ${apiOwner.pid} (${apiOwner.name}) but /api/health did not answer`,
    `Check it is OctaPM and not something else, then: Stop-Process -Id ${apiOwner.pid}`,
  )
} else {
  fail('api', `nothing on :${API_PORT}`, 'cd backend && npm start   # see the note on nodemon below')
}

// ── 3. Web ─────────────────────────────────────────────────────────────
const webOwner = ownerOf(WEB_PORT)
if (await portOpen(WEB_PORT)) {
  say('✓', 'web', `listening on :${WEB_PORT}${webOwner ? ` (pid ${webOwner.pid})` : ''}`)
} else {
  fail('web', `nothing on :${WEB_PORT}`, 'cd frontend && npm run dev')
}

// ── 4. One API, not several ────────────────────────────────────────────
if (isWindows) {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
          "Where-Object { $_.CommandLine -match 'src(\\\\|/)index\\.js|nodemon' } | " +
          'Select-Object -ExpandProperty ProcessId',
      ],
      { encoding: 'utf8', timeout: 15_000 },
    ).trim()
    const pids = out ? out.split(/\s+/).filter(Boolean) : []
    if (pids.length <= 1) {
      say('✓', 'api instances', `${pids.length} (${pids.join(', ') || 'none'})`)
    } else {
      fail(
        'api instances',
        `${pids.length} API-ish node processes: ${pids.join(', ')}`,
        'Exactly one should own :5000. Inspect each, then stop the strays with Stop-Process -Id <pid>.',
      )
    }
  } catch {
    say('•', 'api instances', 'could not enumerate (not fatal)')
  }
}

// ── 5. The login ceiling the suite will run under ──────────────────────
const loginMax = Number(process.env.RATE_LIMIT_LOGIN_MAX || 0)
if (loginMax >= 200) {
  say('✓', 'login ceiling', `${loginMax} in this shell`)
} else {
  say(
    '•',
    'login ceiling',
    'not raised in this shell — backend/.env sets it for the API process, which is what counts',
  )
}

// ── 6. Verdict ─────────────────────────────────────────────────────────
console.log('')
if (failures) {
  console.log(`${failures} problem${failures === 1 ? '' : 's'}. Fix the above before running the suite.\n`)
  process.exit(1)
}
console.log('Stack looks right.')
console.log('')
console.log('Before a full regression:')
console.log('  cd backend && npm run db:seed   # clears PO-E2E-/PO-LC- rows from earlier runs')
console.log('During one: no code edits, no API restart, no reseed.')
console.log('')
