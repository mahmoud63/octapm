import { expect, test, type Page } from '@playwright/test'

/**
 * M2 on the web target: RFIs, tasks, documents and drawings.
 *
 * These checks write records, so they sign in to the dedicated end-to-end
 * organisation (seeded by backend/scripts/e2e/reset-e2e-org.js), never to
 * the demo or the certified projects. Override with E2E_WRITE_EMAIL /
 * E2E_WRITE_PASSWORD.
 */
const email = process.env.E2E_WRITE_EMAIL ?? 'pm@octapm-e2e.test'
const password = process.env.E2E_WRITE_PASSWORD ?? 'DemoPassw0rd!'

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

test.describe('M2 on the web target', () => {
  test('Home offers the record screens and the RFI quick action to a project manager', async ({ page }) => {
    await signIn(page)
    await expect(page.getByTestId('records-rfi')).toBeVisible()
    await expect(page.getByTestId('records-tasks')).toBeVisible()
    await expect(page.getByTestId('records-documents')).toBeVisible()
    await expect(page.getByTestId('records-drawings')).toBeVisible()
    await expect(page.getByTestId('quick-rfi')).toBeVisible()
  })

  test('an RFI is raised from the field, answered officially and closed, every step through the server', async ({ page }) => {
    await signIn(page)
    await page.getByTestId('quick-rfi').click()
    await expect(page.getByTestId('screen-rfi-new')).toBeVisible()

    const stamp = new Date().toISOString().slice(11, 19)
    await page.getByTestId('rfi-subject').fill(`E2E ${stamp} rebar cover at the lift pit`)
    await page.getByTestId('rfi-question').fill('Drawing S-102 shows 40mm cover; the specification says 50mm. Which governs?')
    await page.getByTestId('rfi-priority-high').click()
    await page.getByTestId('rfi-discipline-structural').click()

    const created = page.waitForResponse((r) => r.url().includes('/api/v1/projects/') && r.url().endsWith('/rfi') && r.request().method() === 'POST')
    await page.getByTestId('rfi-raise').click()
    const response = await created
    expect(response.status()).toBe(201)
    const body = (await response.json()) as { data: { id: string; ref: string; status: string } }
    expect(body.data.status).toBe('open')

    await expect(page.getByTestId('screen-rfi')).toBeVisible()
    await expect(page.getByTestId('rfi-header')).toContainText(body.data.ref)
    await expect(page.getByTestId('rfi-header')).toContainText('Open')

    // Answer it officially through the response thread.
    await page.getByTestId('action-respond').click()
    await page.getByTestId('prompt-respond-input').fill('The specification governs: 50mm cover. Drawing S-102 will be revised.')
    await page.getByTestId('prompt-respond-toggle').click()
    const responded = page.waitForResponse((r) => r.url().endsWith(`/rfi/${body.data.id}/responses`) && r.request().method() === 'POST')
    await page.getByTestId('prompt-respond-confirm').click()
    expect((await responded).status()).toBe(201)
    await expect(page.getByTestId('rfi-official-answer')).toContainText('50mm cover')
    await expect(page.getByTestId('rfi-header')).toContainText('Answered')

    // Approve and close: a project manager's transition, not a status edit.
    const approved = page.waitForResponse((r) => r.url().endsWith(`/rfi/${body.data.id}/approve`))
    await page.getByTestId('action-approve').click()
    expect((await approved).status()).toBe(200)
    await expect(page.getByTestId('rfi-header')).toContainText('Closed')
    await expect(page.getByTestId('history')).toContainText(/Closed|closed/)
  })

  test('the RFI list narrows to my court through the server and opens a record in the app', async ({ page }) => {
    await signIn(page)
    await page.getByTestId('records-rfi').click()
    await expect(page.getByTestId('screen-rfis')).toBeVisible()
    const mine = page.waitForRequest((r) => r.url().includes('/rfi?') && r.url().includes('ballInCourtUserId=me'))
    await page.getByTestId('rfi-chip-mine').click()
    await mine
    await page.getByTestId('rfi-chip-all').click()
    const row = page.getByTestId('screen-rfis').locator('[data-testid^="rfi-row-"]').first()
    await expect(row).toBeVisible()
    await row.click()
    await expect(page.getByTestId('screen-rfi')).toBeVisible()
    await expect(page.getByTestId('comments')).toBeVisible()
    await expect(page.getByTestId('history')).toBeVisible()
  })

  test('tasks list mine on this project, and a task can be commented on', async ({ page, request }) => {
    await signIn(page)
    // The seed carries no tasks; raise one through the API as the same person, on the chosen project.
    const apiBase = process.env.MOBILE_API_URL ?? 'http://localhost:5000/api/v1'
    const login = await request.post(`${apiBase}/auth/login`, { headers: { 'x-octapm-client': 'mobile' }, data: { email, password } })
    expect(login.status()).toBe(200)
    const token = ((await login.json()) as { data: { tokens: { accessToken: string } } }).data.tokens.accessToken
    const projectId = await page.evaluate(() => sessionStorage.getItem('octapm.session.project'))
    expect(projectId).toBeTruthy()
    const created = await request.post(`${apiBase}/tasks`, { headers: { authorization: `Bearer ${token}`, 'x-octapm-client': 'mobile' }, data: { title: `E2E task ${Date.now()}`, projectId, priority: 'high', label: 'field' } })
    expect(created.status()).toBe(201)

    await page.getByTestId('records-tasks').click()
    await expect(page.getByTestId('screen-tasks')).toBeVisible()
    await page.getByTestId('task-chip-all').click()
    const rows = page.getByTestId('screen-tasks').locator('[data-testid^="task-row-"]')
    await expect(rows.first()).toBeVisible()
    await rows.first().click()
    await expect(page.getByTestId('screen-task')).toBeVisible()
    const posted = page.waitForResponse((r) => r.url().includes('/tasks/') && r.url().endsWith('/comments') && r.request().method() === 'POST')
    await page.getByTestId('task-comment-input').fill(`E2E comment ${Date.now()}`)
    await page.getByTestId('task-comment-post').click()
    expect((await posted).status()).toBe(201)
  })

  test('the document register and the sheet register load for the project', async ({ page }) => {
    await signIn(page)
    await page.getByTestId('records-documents').click()
    await expect(page.getByTestId('screen-documents')).toBeVisible()
    await expect(page.getByTestId('documents-folder-all')).toBeVisible()
    await page.goto('/drawings')
    await expect(page.getByTestId('screen-drawings')).toBeVisible()
    await expect(page.getByTestId('drawings-chip-favourites')).toBeVisible()
    // Either the register has sheets, or it says so; the caption with the published count is always there.
    await expect(page.getByTestId('screen-drawings').getByText(/\d+ sheets? published/)).toBeVisible()
  })

  test('a search hit for an RFI opens inside the app', async ({ page }) => {
    await signIn(page)
    await page.goto('/search')
    await page.getByTestId('search-input').fill('E2E')
    const rows = page.getByTestId('screen-search').locator('[role="button"]').filter({ hasText: /^RFI-/ })
    await expect(rows.first()).toBeVisible()
    await rows.first().click()
    await expect(page.getByTestId('screen-rfi')).toBeVisible()
  })
})
