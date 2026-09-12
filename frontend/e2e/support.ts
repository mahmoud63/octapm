import { mkdirSync } from 'node:fs'
import { expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test'

/** Seeded demo accounts — see backend/prisma/seed.js. */
export const PEOPLE = {
  pm: { email: 'pm@octapm.demo', role: 'pm' },
  planner: { email: 'planner@octapm.demo', role: 'planning_eng' },
  qs: { email: 'qs@octapm.demo', role: 'qs' },
  cost: { email: 'cost@octapm.demo', role: 'cost_controller' },
  procurement: { email: 'procurement@octapm.demo', role: 'procurement' },
  warehouse: { email: 'warehouse@octapm.demo', role: 'warehouse' },
  site: { email: 'site@octapm.demo', role: 'site_engineer' },
  finance: { email: 'finance@octapm.demo', role: 'finance' },
} as const

export const PASSWORD = process.env.E2E_PASSWORD || 'DemoPassw0rd!'
export const API = process.env.E2E_API_URL || 'http://localhost:5000/api/v1'

/**
 * Where the specs write their screenshots.
 *
 * They used to overwrite the committed design gallery under
 * docs/design/screenshots on every run. That folder is tracked and lives in a
 * OneDrive-synchronised tree, and a full suite run lost a test to
 * `UNKNOWN: unknown error, open …27-inventory-goods-receipt.png` while the
 * sync client held the previous file (Phase 21D). Transient evidence now goes
 * to a per-run folder under test-results (git-ignored, never rewritten). To
 * refresh the committed gallery deliberately, run with
 * E2E_SHOTS_DIR=../docs/design/screenshots.
 */
export const SHOTS = (() => {
  const dir =
    process.env.E2E_SHOTS_DIR ||
    `test-results/screenshots/${new Date().toISOString().replace(/[:.]/g, '-')}`
  mkdirSync(dir, { recursive: true })
  return dir
})()

/**
 * Signs in through the actual form. Typing rather than filling matters: these
 * are React controlled inputs, and setting `value` directly does not produce
 * the change events the form's state depends on.
 */
export async function signIn(page: Page, who: keyof typeof PEOPLE = 'pm') {
  await page.goto('/sign-in')
  const email = page.getByPlaceholder('name@example.com')
  await email.waitFor({ state: 'visible' })
  await email.click()
  await email.fill(PEOPLE[who].email)
  const password = page.locator('input[type="password"]').first()
  await password.click()
  await password.fill(PASSWORD)
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/auth/login') && r.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ])

  // Say why sign-in failed rather than leaving a "Workspace Control not found".
  // The API allows RATE_LIMIT_LOGIN_MAX logins per IP and email in a 15-minute
  // window (12 by default), and a full suite run — plus any run before it in
  // the same window — burns through that. Raise it for the local API before
  // running the suite back to back; see docs/qa/local-setup.md.
  if (response.status() === 429) {
    throw new Error(
      `sign-in for ${who} was rate limited (429). The login budget is shared ` +
        'across runs in a 15-minute window — start the API with a higher ' +
        'RATE_LIMIT_LOGIN_MAX, or wait for the window to roll over.',
    )
  }
  expect(response.status(), `sign-in for ${who} failed`).toBe(200)

  // The workspace dashboard is the landing page for a signed-in user.
  await expect(page.getByText('Workspace Control')).toBeVisible({ timeout: 30_000 })
}

/**
 * An API client that does NOT share the browser's cookie jar.
 *
 * This matters: signing in through `page.request` sets a refresh cookie in the
 * same context as the UI session, and the newer session displaces the one the
 * browser is using — so the page silently logs itself out mid-test. Verifying
 * the backend must never disturb the session under test.
 */
export async function apiClient(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: API })
}

/**
 * One bearer token per person, for the lifetime of the worker.
 *
 * The token does not depend on the request context, so it can be borrowed.
 * Minting a fresh one per call meant `openProject` alone signed in 79 times a
 * run for a value that never changes — pure round trips, and needless coupling
 * to a limiter whose whole purpose is to notice repeated logins
 * (OCTA-QA-LOGIN-107).
 *
 * The specs that are *about* signing in still go through the real form via
 * `signIn`; this only covers the out-of-band client used to check backend
 * state.
 */
const tokenCache = new Map<string, { minted: number; token: Promise<string> }>()

/**
 * How long a cached token may be reused.
 *
 * Access tokens live 15 minutes (`JWT_EXPIRY`, default `15 * 60`). A full
 * browser suite takes 16 to 25, so a token minted at the start is expired
 * before the end — which is exactly what happened: every isolated run passed
 * and every full run failed once, in a different spec each time, with the 401
 * swallowed by `apiGet` and surfacing as "project not visible" or "cannot
 * read properties of undefined" (OCTA-QA-FIXTURE-114).
 *
 * Ten minutes keeps almost all of the saving — a 25-minute run mints three
 * tokens per persona instead of the seventy-nine it started with — while never
 * handing out one that is about to expire.
 */
const TOKEN_TTL_MS = 10 * 60_000

/** A bearer token obtained out-of-band, for asserting on backend state. */
export async function apiToken(
  client: APIRequestContext,
  who: keyof typeof PEOPLE = 'pm',
): Promise<string> {
  const cached = tokenCache.get(who)
  if (cached && Date.now() - cached.minted < TOKEN_TTL_MS) return cached.token

  const fresh = (async () => {
    const response = await client.post(`${API}/auth/login`, {
      data: { email: PEOPLE[who].email, password: PASSWORD },
    })
    // Report what actually happened. A bare "sign-in failed" sent a previous
    // investigation chasing a rate limit that was never involved.
    const detail = response.ok()
      ? ''
      : ` (HTTP ${response.status()} ${await response.text().catch(() => '')})`.slice(0, 200)
    expect(response.ok(), `sign-in for ${who} failed${detail}`).toBeTruthy()
    const body = await response.json()
    return body.data.tokens.accessToken as string
  })().catch((error) => {
    // A failed sign-in must not be remembered as the answer.
    tokenCache.delete(who)
    throw error
  })

  tokenCache.set(who, { minted: Date.now(), token: fresh })
  return fresh
}

/** GETs an API path, for verifying what the UI claims. */
export async function apiGet(client: APIRequestContext, path: string, token: string) {
  const response = await client.get(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  return { status: response.status(), body: response.ok() ? await response.json() : null }
}

/** The seeded demo project, found through the UI's own project list. */
export async function openProject(page: Page, name = 'Riverside Tower') {
  await page.goto('/projects')
  await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 })

  const client = await apiClient()
  try {
    const token = await apiToken(client)
    // Report what the request actually did. `apiGet` returns `body: null` for
    // any non-2xx, so a transient 500 used to arrive here as an empty list and
    // fail with 'project "Riverside Tower" not visible' — which reads as a
    // missing fixture and sent an investigation looking at pagination and the
    // rate limiter, when the project was there all along
    // (OCTA-QA-FIXTURE-114).
    const response = await client.get(`${API}/projects`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const body = await response.json().catch(() => null)
    expect(
      response.ok(),
      `listing projects to find "${name}" -> ${response.status()} ` +
        `${body?.error?.code ?? ''} ${body?.error?.message ?? ''}`,
    ).toBeTruthy()

    const items = (body?.data?.items || []) as Array<{ id: string; name: string }>
    const project = items.find((p) => p.name === name)
    expect(
      project,
      `project "${name}" not among the ${items.length} the API returned: ` +
        items.map((p) => p.name).join(', '),
    ).toBeTruthy()
    return project!.id
  } finally {
    await client.dispose()
  }
}

/** Collects console errors and failed requests for the technical defect log. */
export function watchForProblems(page: Page) {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // React DevTools nag and Vite HMR chatter are not defects.
    if (text.includes('Download the React DevTools')) return
    // Before sign-in the app probes /auth/me and /auth/refresh and is told 401.
    // That is the session check working, not a fault.
    if (/401 \(Unauthorized\)/.test(text)) return
    consoleErrors.push(text.slice(0, 300))
  })
  page.on('response', (response) => {
    if (response.status() < 400) return
    const url = response.url()
    // Same reasoning as above: an anonymous session check is expected to 401.
    if (response.status() === 401 && /\/auth\/(me|refresh)/.test(url)) return
    failedRequests.push(`${response.status()} ${response.request().method()} ${url}`)
  })

  return { consoleErrors, failedRequests }
}

/** Money on screen ("$1,234.56", "USD 1,234") as a number. */
export const parseMoney = (text: string | null): number => {
  if (!text) return 0
  const cleaned = text.replace(/[^0-9.-]/g, '')
  const value = Number.parseFloat(cleaned)
  return Number.isFinite(value) ? value : 0
}

/**
 * A strict console gate for the workflows this programme certifies.
 *
 * `watchForProblems` above collects console *errors* for the defect log. This
 * is the harder line: it fails a test on any error **or warning** the
 * application itself produces, because the ones that matter most here are
 * warnings — Radix's missing-`DialogTitle` and React's controlled/uncontrolled
 * complaint are both `console.warn`, and a watcher listening only for errors
 * walked straight past them (OCTA-QA-CONSOLE-106).
 *
 * The allowlist is deliberately tiny and each entry has to earn its place. It
 * holds only messages the browser emits *about* the page rather than messages
 * the page emits about itself.
 */
const CONSOLE_ALLOWED: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /Download the React DevTools/,
    why: 'React DevTools nag: emitted by React itself, not by OctaPM.',
  },
  {
    pattern: /Failed to load resource.*\b401\b/,
    why:
      'The browser reporting the HTTP status of the bootstrap /auth/me probe. ' +
      'On a cold load the access token lives only in memory, so the first call ' +
      'is unauthenticated; the response interceptor refreshes and retries, and ' +
      'the user sees nothing. Only 401 is tolerated — any other status fails.',
  },
]

/**
 * Never allowlisted, and named here so a future reader cannot quietly add them:
 * controlled/uncontrolled transitions, missing `key` props, missing
 * `DialogTitle`, and missing `Description`/`aria-describedby`. Those are
 * defects to fix, not noise to tolerate.
 */
export const CONSOLE_NEVER_ALLOWED = [
  /changing an? (un)?controlled/i,
  /unique "key" prop/i,
  /requires a `?DialogTitle/i,
  /Missing `?Description`? or `?aria-describedby/i,
]

export function gateConsole(page: Page) {
  const offences: string[] = []

  const consider = (type: string, text: string) => {
    if (CONSOLE_NEVER_ALLOWED.some((p) => p.test(text))) {
      offences.push(`[${type}] ${text.replace(/\s+/g, ' ').slice(0, 300)}`)
      return
    }
    if (CONSOLE_ALLOWED.some((entry) => entry.pattern.test(text))) return
    offences.push(`[${type}] ${text.replace(/\s+/g, ' ').slice(0, 300)}`)
  }

  page.on('console', (message) => {
    const type = message.type()
    if (type !== 'error' && type !== 'warning') return
    consider(type, message.text())
  })
  page.on('pageerror', (error) => consider('pageerror', String(error)))

  return {
    offences,
    /** Fails with the offending messages rather than just a count. */
    assertClean(context: string) {
      expect(
        offences,
        `${context}: the browser console must be clean.\n${offences.join('\n')}`,
      ).toEqual([])
    },
  }
}
