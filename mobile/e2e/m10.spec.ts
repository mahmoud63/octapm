import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * M10 certification on the web target: the role gate and the isolation gate
 * proved through the app's own screens rather than the API alone. A site
 * engineer is offered no approval anywhere the project manager is; a person
 * from another organisation who follows a link to this project's record
 * sees no record. Writes go to the dedicated end-to-end organisation only;
 * the demo organisation is only read.
 */
const apiBase = process.env.MOBILE_API_URL ?? 'http://localhost:5000/api/v1'
const password = 'DemoPassw0rd!'
const pmEmail = process.env.E2E_WRITE_EMAIL ?? 'pm@octapm-e2e.test'
const siteEmail = 'site@octapm-e2e.test'
const otherOrgEmail = 'pm@octapm.demo'

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in')
  await page.getByTestId('sign-in-email').fill(email)
  await page.getByTestId('sign-in-password').fill(password)
  await page.getByTestId('sign-in-submit').click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  const first = page.locator('[data-testid^="choose-"], [data-testid="freshness"]').first()
  await first.waitFor({ state: 'visible' })
  if ((await first.getAttribute('data-testid'))?.startsWith('choose-')) {
    await first.click()
    await expect(page.getByTestId('freshness').first()).toBeVisible()
  }
}

async function apiSession(request: APIRequestContext, email: string) {
  const login = await request.post(`${apiBase}/auth/login`, { headers: { 'x-octapm-client': 'mobile' }, data: { email, password } })
  const session = (await login.json()) as { data: { user: { id: string }; tokens: { accessToken: string } } }
  return { userId: session.data.user.id, headers: { authorization: `Bearer ${session.data.tokens.accessToken}`, 'x-octapm-client': 'mobile' } }
}

const items = <T>(data: { items?: T[] } | T[]): T[] => (Array.isArray(data) ? data : (data.items ?? []))
const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

test.describe('M10 certification on the web target', () => {
  test('a site engineer is offered no approval on a submitted progress update or on an open RFI', async ({ page, request }) => {
    const pm = await apiSession(request, pmEmail)
    const users = items<{ id: string; email: string }>(((await (await request.get(`${apiBase}/users`, { headers: pm.headers })).json()) as { data: never }).data)
    const site = users.find((u) => u.email === siteEmail)!
    expect(site).toBeTruthy()
    const projects = items<{ id: string }>(((await (await request.get(`${apiBase}/projects`, { headers: pm.headers })).json()) as { data: never }).data)
    const projectId = projects[0]!.id
    const stamp = Date.now()
    const created = await request.post(`${apiBase}/projects/${projectId}/activities`, { headers: pm.headers, data: { name: `E2E role gate ${stamp}`, activityCode: `E2R-${stamp % 100000}`, category: 'structural', startDate: '2026-09-01', endDate: '2026-12-31', budget: 1000, engineerIds: [site.id] } })
    expect(created.status()).toBe(201)
    const activityId = ((await created.json()) as { data: { id: string } }).data.id
    const submitted = await request.post(`${apiBase}/projects/${projectId}/activities/${activityId}/progress`, { headers: pm.headers, data: { pctComplete: 10, status: 'submitted', source: 'mobile', notes: 'E2E role gate' } })
    expect([200, 201]).toContain(submitted.status())
    const submissionId = ((await submitted.json()) as { data: { submission: { id: string } } }).data.submission.id
    const rfi = await request.post(`${apiBase}/projects/${projectId}/rfi`, { headers: pm.headers, data: { subject: `E2E role gate RFI ${stamp}`, question: 'Who may answer this?', status: 'open' } })
    expect(rfi.status()).toBe(201)
    const rfiId = ((await rfi.json()) as { data: { id: string } }).data.id

    await signIn(page, siteEmail)
    await page.goto(`/activities/${activityId}`)
    const activity = page.getByTestId('screen-activity').last()
    await expect(activity).toBeVisible()
    await expect(activity.getByText('E2E role gate').first()).toBeVisible()
    // The project manager sees Approve here on the wide screen (M8 check); the site engineer never does, on any width.
    await expect(activity.getByTestId(`submission-approve-${submissionId}`)).toHaveCount(0)
    await expect(activity.getByTestId(`submission-reject-${submissionId}`)).toHaveCount(0)

    await page.goto(`/rfi/${rfiId}`)
    const record = page.getByTestId('screen-rfi').last()
    await expect(record).toBeVisible()
    await expect(record.getByText(`E2E role gate RFI ${stamp}`).first()).toBeVisible()
    await expect(record.getByTestId('action-answer')).toHaveCount(0)
    await expect(record.getByTestId('action-approve')).toHaveCount(0)
    await expect(record.getByTestId('action-close')).toHaveCount(0)

    // Tidy: the manager rejects the run's update so it does not wait for anyone.
    const rejected = await request.post(`${apiBase}/projects/${projectId}/activities/${activityId}/progress-submissions/${submissionId}/reject`, { headers: pm.headers, data: { reason: 'certification run' } })
    expect(rejected.status()).toBe(200)
    test.info().annotations.push({ type: 'viewport', description: isWide(page) ? 'tablet' : 'phone' })
  })

  test('a person from another organisation who follows a link to this project’s record sees no record', async ({ page, request }) => {
    const pm = await apiSession(request, pmEmail)
    const projects = items<{ id: string }>(((await (await request.get(`${apiBase}/projects`, { headers: pm.headers })).json()) as { data: never }).data)
    const projectId = projects[0]!.id
    const stamp = Date.now()
    const rfi = await request.post(`${apiBase}/projects/${projectId}/rfi`, { headers: pm.headers, data: { subject: `E2E isolation ${stamp}`, question: 'Only this organisation may read this.', status: 'open' } })
    expect(rfi.status()).toBe(201)
    const rfiId = ((await rfi.json()) as { data: { id: string } }).data.id

    // The server is the authority: the other organisation's manager gets not-found, not a record.
    const other = await apiSession(request, otherOrgEmail)
    const direct = await request.get(`${apiBase}/projects/${projectId}/rfi/${rfiId}`, { headers: other.headers })
    expect([403, 404]).toContain(direct.status())

    await signIn(page, otherOrgEmail)
    await page.goto(`/open?to=${encodeURIComponent(`/rfi/${rfiId}`)}&projectId=${projectId}`)
    await expect(page.getByTestId('screen-rfi').last()).toBeVisible()
    await expect(page.getByText(`E2E isolation ${stamp}`)).toHaveCount(0)
    await expect(page.getByText(/no longer available|not found|could not|no access|nothing here/i).first()).toBeVisible()
  })
})
