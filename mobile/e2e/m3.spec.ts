import { expect, test, type Page } from '@playwright/test'

/**
 * M3 on the web target: the daily log, activities and progress, photos and
 * timesheets. Writes go to the dedicated end-to-end organisation.
 */
const email = process.env.E2E_WRITE_EMAIL ?? 'pm@octapm-e2e.test'
const password = process.env.E2E_WRITE_PASSWORD ?? 'DemoPassw0rd!'
const apiBase = process.env.MOBILE_API_URL ?? 'http://localhost:5000/api/v1'

async function signIn(page: Page) {
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

test.describe('M3 on the web target', () => {
  test('the daily log takes a manpower entry with a replay key and shows it in the totals', async ({ page }) => {
    await signIn(page)
    await page.getByTestId('records-site').click()
    await expect(page.getByTestId('screen-daily-log')).toBeVisible()
    await page.getByTestId('daily-log-add-manpower').click()
    await page.getByTestId('entry-companyName').fill(`E2E Crew ${Date.now() % 10000}`)
    await page.getByTestId('entry-trade').fill('Steelfixers')
    await page.getByTestId('entry-workers').fill('4')
    await page.getByTestId('entry-hours').fill('9')
    const posted = page.waitForResponse((r) => r.url().includes('/daily-logs/') && r.url().endsWith('/entries/manpower') && r.request().method() === 'POST')
    await page.getByTestId('entry-save').click()
    const response = await posted
    expect(response.status()).toBe(201)
    const sent = response.request().postDataJSON() as { clientRequestId: string; workers: number }
    expect(sent.clientRequestId).toMatch(/[0-9a-f-]{20,}/)
    expect(sent.workers).toBe(4)
    await expect(page.getByTestId('daily-log-section-manpower')).toContainText('Steelfixers')
    await expect(page.getByTestId('daily-log-submit')).toBeVisible()
  })

  test('an activity shows its approved progress and takes an update for approval', async ({ page, request }) => {
    await signIn(page)
    // The seed's activities are complete; raise one that is not, through the API as the same person.
    const login = await request.post(`${apiBase}/auth/login`, { headers: { 'x-octapm-client': 'mobile' }, data: { email, password } })
    const session = (await login.json()) as { data: { user: { id: string }; tokens: { accessToken: string } } }
    const token = session.data.tokens.accessToken
    const projectId = await page.evaluate(() => sessionStorage.getItem('octapm.session.project'))
    const stamp = Date.now()
    const created = await request.post(`${apiBase}/projects/${projectId}/activities`, {
      headers: { authorization: `Bearer ${token}`, 'x-octapm-client': 'mobile' },
      // An activity needs at least one engineer; the same person will submit its progress.
      data: { name: `E2E progress activity ${stamp}`, activityCode: `E2E-${stamp % 100000}`, category: 'structural', startDate: '2026-09-01', endDate: '2026-12-31', budget: 1000, engineerIds: [session.data.user.id] },
    })
    expect(created.status()).toBe(201)
    const activityId = ((await created.json()) as { data: { id: string } }).data.id

    await page.getByTestId('records-activities').click()
    await expect(page.getByTestId('screen-activities')).toBeVisible()
    await page.getByTestId('activities-chip-all').click()
    await page.getByTestId('activities-search').fill(`E2E-${stamp % 100000}`)
    const row = page.getByTestId(`activity-row-${activityId}`)
    await expect(row).toBeVisible()
    await row.click()
    await expect(page.getByTestId('screen-activity')).toBeVisible()
    await expect(page.getByTestId('activity-header')).toContainText('E2E progress activity')
    const update = page.getByTestId('action-progress')
    await expect(update).toBeVisible()
    await update.click()
    await page.getByTestId('progress-notes').fill(`E2E field note ${Date.now()}`)
    const submitted = page.waitForResponse((r) => r.url().includes('/activities/') && r.url().endsWith('/progress') && r.request().method() === 'POST')
    await page.getByTestId('progress-draft').click()
    const response = await submitted
    expect([200, 201]).toContain(response.status())
    expect((response.request().postDataJSON() as { source: string; status: string }).source).toBe('mobile')
  })

  test('the photo gallery and the timesheet list load, and a timesheet can be started for a crew', async ({ page, request }) => {
    await signIn(page)
    await page.getByTestId('records-photos').click()
    await expect(page.getByTestId('screen-photos')).toBeVisible()
    await expect(page.getByTestId('photos-library')).toBeVisible()

    // Make sure the e2e project has a crew with a worker, through the API as the same person.
    const login = await request.post(`${apiBase}/auth/login`, { headers: { 'x-octapm-client': 'mobile' }, data: { email, password } })
    const token = ((await login.json()) as { data: { tokens: { accessToken: string } } }).data.tokens.accessToken
    const projectId = await page.evaluate(() => sessionStorage.getItem('octapm.session.project'))
    const auth = { authorization: `Bearer ${token}`, 'x-octapm-client': 'mobile' }
    const workers = await request.get(`${apiBase}/projects/${projectId}/timesheets/workers`, { headers: auth })
    let items = ((await workers.json()) as { data: { items: { id: string; name: string }[] } }).data.items
    if (items.length === 0) {
      const created = await request.post(`${apiBase}/projects/${projectId}/timesheets/workers`, { headers: auth, data: { name: 'E2E Worker One', trade: 'Steelfixer' } })
      expect(created.status()).toBe(201)
      items = [((await created.json()) as { data: { id: string; name: string } }).data]
    }

    await page.goto('/timesheets')
    await expect(page.getByTestId('screen-timesheets')).toBeVisible()
    await page.getByTestId('timesheet-new').click()
    await expect(page.getByTestId('screen-timesheet-new')).toBeVisible()
    await page.getByTestId('timesheet-workers').click()
    await page.getByTestId(`timesheet-workers-option-${items[0]!.id}`).click()
    await page.getByTestId('timesheet-workers-done').click()
    const created = page.waitForResponse((r) => r.url().endsWith('/timesheets') && r.request().method() === 'POST')
    await page.getByTestId('timesheet-save').click()
    const response = await created
    expect([201, 409]).toContain(response.status())
    if (response.status() === 201) {
      await expect(page.getByTestId('screen-timesheet')).toBeVisible()
      await expect(page.getByTestId('timesheet-header')).toContainText(/Draft|Timesheet/)
    }
  })
})
