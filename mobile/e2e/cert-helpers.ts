import { expect, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Shared pieces of the certification specs (cert-*.spec.ts). Everything
 * writes to the dedicated end-to-end organisation only; the demo
 * organisation is read for the isolation gate and never written to.
 */
export const apiBase = process.env.MOBILE_API_URL ?? 'http://localhost:5000/api/v1'
export const password = 'DemoPassw0rd!'
export const accounts = {
  pm: process.env.E2E_WRITE_EMAIL ?? 'pm@octapm-e2e.test',
  planner: 'planner@octapm-e2e.test',
  qs: 'qs@octapm-e2e.test',
  cost: 'cost@octapm-e2e.test',
  procurement: 'procurement@octapm-e2e.test',
  warehouse: 'warehouse@octapm-e2e.test',
  site: 'site@octapm-e2e.test',
  quality: 'quality@octapm-e2e.test',
  finance: 'finance@octapm-e2e.test',
  otherOrg: 'pm@octapm.demo',
} as const

/** A temporary person for the session and access checks; created once, reused by email, deactivated at the end of each run. */
export const tempUserEmail = 'cert-temp@octapm-e2e.test'
export const tempUserPassword = 'CertTemp1234'

export type Headers = Record<string, string>

export async function apiSession(request: APIRequestContext, email: string, pass = password) {
  const login = await request.post(`${apiBase}/auth/login`, { headers: { 'x-octapm-client': 'mobile' }, data: { email, password: pass } })
  expect(login.status(), `login ${email}`).toBe(200)
  const session = (await login.json()) as { data: { user: { id: string; role: string; isCompanyAdmin: boolean }; tokens: { accessToken: string; refreshToken: string } } }
  return { user: session.data.user, tokens: session.data.tokens, headers: { authorization: `Bearer ${session.data.tokens.accessToken}`, 'x-octapm-client': 'mobile' } as Headers }
}

export const items = <T>(data: { items?: T[]; rows?: T[] } | T[]): T[] => (Array.isArray(data) ? data : (data.items ?? data.rows ?? []))

export async function getData<T>(request: APIRequestContext, headers: Headers, path: string): Promise<T> {
  const response = await request.get(`${apiBase}${path}`, { headers })
  expect(response.status(), `GET ${path}`).toBe(200)
  return ((await response.json()) as { data: T }).data
}

/** Sign in on the web target; picks the first project when the person has several. */
export async function signIn(page: Page, email: string, pass = password) {
  await page.goto('/sign-in')
  await page.getByTestId('sign-in-email').fill(email)
  await page.getByTestId('sign-in-password').fill(pass)
  await page.getByTestId('sign-in-submit').click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  const first = page.locator('[data-testid^="choose-"], [data-testid="freshness"]').first()
  await first.waitFor({ state: 'visible' })
  if ((await first.getAttribute('data-testid'))?.startsWith('choose-')) {
    await first.click()
    await expect(page.getByTestId('freshness').first()).toBeVisible()
  }
}

/** The sign-in screen has no screen id of its own; its submit button is the marker every spec uses. */
export const signInScreen = (page: Page) => page.getByTestId('sign-in-submit')

/**
 * Open a project module the way a person does now.
 *
 * Home used to carry a wall of thirteen module buttons and every milestone
 * spec clicked them; UX2-B moved that directory to Controls, where navigation
 * belongs, so the specs go the same way.
 */
export async function openModule(page: Page, id: string) {
  await page.goto('/controls')
  await expect(page.getByTestId('screen-controls')).toBeVisible()
  await page.getByTestId(`controls-${id}`).click()
}

export async function signOut(page: Page) {
  await page.goto('/more')
  await page.getByTestId('sign-out').click()
  await expect(signInScreen(page)).toBeVisible()
}

export const currentProjectId = (page: Page) => page.evaluate(() => sessionStorage.getItem('octapm.session.project'))

/** The end-to-end organisation's first project (Riverside Tower). */
export async function mainProject(request: APIRequestContext, headers: Headers) {
  const projects = await getData<{ id: string; name: string }[] | { items: { id: string; name: string }[] }>(request, headers, '/projects')
  const list = items(projects)
  const riverside = list.find((p) => p.name === 'Riverside Tower') ?? list[0]!
  return riverside
}

/**
 * A second project in the end-to-end organisation, for the project-isolation
 * checks. It exists only for the duration of one check and is archived
 * afterwards, because the milestone specs sign in and take the first project
 * the server lists: a permanent second project would move them onto it. The
 * name also sorts after "Riverside Tower" so that even mid-check the default
 * selection does not change.
 */
export async function withIsolationProject<T>(request: APIRequestContext, headers: Headers, body: (project: { id: string; name: string }) => Promise<T>): Promise<T> {
  const name = `Zz Cert Isolation ${Date.now() % 1_000_000}`
  const created = await request.post(`${apiBase}/projects`, { headers, data: { name, startDate: '2026-09-01', endDate: '2027-03-31', currency: 'GBP' } })
  expect(created.status(), 'create the temporary isolation project').toBe(201)
  const project = ((await created.json()) as { data: { id: string; name: string } }).data
  try {
    return await body(project)
  } finally {
    await request.delete(`${apiBase}/projects/${project.id}`, { headers }).catch(() => undefined)
  }
}

/** The temporary person: exists, is active, holds the given role and the known password. */
export async function ensureTempUser(request: APIRequestContext, admin: Headers, role = 'site_engineer') {
  const users = items(await getData<{ id: string; email: string; status: string; role: string }[]>(request, admin, '/users'))
  let user = users.find((u) => u.email === tempUserEmail) ?? null
  if (!user) {
    const created = await request.post(`${apiBase}/users`, { headers: admin, data: { name: 'Cert Temp', email: tempUserEmail, password: tempUserPassword, role } })
    expect(created.status(), 'create temp user').toBe(201)
    user = ((await created.json()) as { data: { id: string; email: string; status: string; role: string } }).data
  } else {
    if (user.status !== 'active') expect((await request.patch(`${apiBase}/users/${user.id}/activate`, { headers: admin })).status()).toBe(200)
    if (user.role !== role) expect((await request.patch(`${apiBase}/users/${user.id}`, { headers: admin, data: { role } })).status()).toBe(200)
    const reset = await request.post(`${apiBase}/users/${user.id}/reset-password`, { headers: admin, data: { newPassword: tempUserPassword } })
    expect([200, 204]).toContain(reset.status())
  }
  return user
}

export async function addToProject(request: APIRequestContext, admin: Headers, projectId: string, userId: string, role = 'site_engineer') {
  const team = items(await getData<{ userId?: string; user?: { id: string } }[]>(request, admin, `/projects/${projectId}/team`))
  if (team.some((m) => (m.userId ?? m.user?.id) === userId)) return
  const added = await request.post(`${apiBase}/projects/${projectId}/team`, { headers: admin, data: { userId, role } })
  expect([200, 201]).toContain(added.status())
}

export async function removeFromProject(request: APIRequestContext, admin: Headers, projectId: string, userId: string) {
  const removed = await request.delete(`${apiBase}/projects/${projectId}/team/${userId}`, { headers: admin })
  expect([200, 204, 404]).toContain(removed.status())
}

/** Text a field user must never see: raw identifiers, stack frames, database or transport vocabulary. */
export const LEAK_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'uuid', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i },
  { name: 'prisma', pattern: /\bPrisma\b|PrismaClient|Invalid `prisma/ },
  { name: 'sql', pattern: /\bSELECT\b.*\bFROM\b|\bsyntax error\b|relation ".*" does not exist/i },
  { name: 'stack', pattern: /\bat [A-Za-z_$][\w$]* \(|TypeError:|ReferenceError:|\bECONNREFUSED\b|Failed to fetch|NetworkError when attempting/ },
  { name: 'transport', pattern: /\bAxiosError\b|Request failed with status code|\bstatus code \d{3}\b/i },
  // Server error codes are SCREAMING_SNAKE with an underscore; uppercase labels such as PROJECT or PARTIALLY RECEIVED are the design system's own.
  { name: 'server-code', pattern: /\b[A-Z]{2,}_[A-Z][A-Z_]+\b/ },
  { name: 'route', pattern: /\/api\/v1\//i },
]

/** Scan what a person can read on the screen; returns the leaks found (empty when clean). */
export async function findLeaks(page: Page, allow: RegExp[] = []): Promise<{ name: string; sample: string }[]> {
  const text = await page.evaluate(() => document.body.innerText)
  const out: { name: string; sample: string }[] = []
  for (const { name, pattern } of LEAK_PATTERNS) {
    const match = text.match(pattern)
    if (!match) continue
    const sample = match[0]
    if (allow.some((a) => a.test(sample))) continue
    out.push({ name, sample: sample.slice(0, 80) })
  }
  return out
}

/** Words the product legitimately shows in capitals (references, units, statuses) that the server-code pattern would otherwise flag. */
export const ALLOWED_CAPS = [/^(OCTAPM|RFI|NCR|ITP|BOQ|PO|GRN|EOT|IPC|SOV|QA\/QC|PDF|PNG|JPEG|SSO|EXIF|GBP|USD|AED|SAR|EUR|CEM|FWK|E2E|E2A|E2R|VO|SC|PL|SUB|RTM|GRID|TBC|TBD|N\/A)[-_ ]?[A-Z0-9_]*$/]

export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900
