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

/** A bearer token obtained out-of-band, for asserting on backend state. */
export async function apiToken(
  client: APIRequestContext,
  who: keyof typeof PEOPLE = 'pm',
): Promise<string> {
  const response = await client.post(`${API}/auth/login`, {
    data: { email: PEOPLE[who].email, password: PASSWORD },
  })
  expect(response.ok(), `sign-in for ${who} failed`).toBeTruthy()
  const body = await response.json()
  return body.data.tokens.accessToken
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
    const { body } = await apiGet(client, '/projects', token)
    const project = (body?.data?.items || []).find((p: { name: string }) => p.name === name)
    expect(project, `project "${name}" not visible`).toBeTruthy()
    return project.id as string
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
