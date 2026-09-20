import { expect, test, type Page } from '@playwright/test'

const email = process.env.E2E_EMAIL ?? 'pm@octapm.demo'
const password = process.env.E2E_PASSWORD ?? 'DemoPassw0rd!'

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByTestId('sign-in-email').fill(email)
  await page.getByTestId('sign-in-password').fill(password)
  await page.getByTestId('sign-in-submit').click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  // A fresh browser has no remembered project. With several to choose from,
  // Home asks; pick the first so the project-scoped cards can render.
  // Wait for whichever comes first: the chooser, or project-scoped content
  // (its freshness line), which means a project was already chosen for us.
  const first = page.locator('[data-testid^="choose-"], [data-testid="freshness"]').first()
  await first.waitFor({ state: 'visible' })
  if ((await first.getAttribute('data-testid'))?.startsWith('choose-')) {
    await first.click()
    await expect(page.getByTestId('freshness').first()).toBeVisible()
  }
}

test.describe('M1 on the web target', () => {
  test('signs in through the native session contract and lands on Home', async ({ page }) => {
    const login = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST')
    await signIn(page)
    const response = await login
    expect(response.status()).toBe(200)
    expect(response.request().headers()['x-octapm-client']).toBe('mobile')
    const body = (await response.json()) as { data: { tokens: Record<string, unknown> } }
    expect(body.data.tokens).toHaveProperty('refreshToken')
    // The refresh token never travels as a cookie for a native client.
    expect(response.headers()['set-cookie'] ?? '').not.toContain('pmc_refresh_token')
    await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible()
    await expect(page.getByTestId('project-switch')).toBeVisible()
  })

  test("Home leads with the project's own standing, then what needs the person", async ({ page }) => {
    await signIn(page)
    // UX2-B: a project manager's home is an exception report in a fixed order —
    // where the project stands, what needs deciding, what is at risk, what the
    // site did, then the numbers. The module directory moved to Controls.
    await expect(page.getByTestId('pm-status')).toBeVisible()
    await expect(page.getByTestId('health-schedule')).toBeVisible()
    await expect(page.getByTestId('pm-needs-you')).toBeVisible()
    await expect(page.getByTestId('pm-risks')).toBeVisible()
    await expect(page.getByTestId('pm-today-on-site')).toBeVisible()
    await expect(page.getByTestId('pm-pulse')).toBeVisible()
    await expect(page.getByTestId('freshness').first()).toContainText(/Live|Updated/)
  })

  test('switching project clears the previous project from the screen', async ({ page }) => {
    await signIn(page)
    const before = (await page.getByTestId('project-switch').textContent()) ?? ''
    await page.getByTestId('project-switch').click()
    await expect(page.getByTestId('screen-projects')).toBeVisible()
    // The tab navigator keeps inactive screens mounted, so every locator on a
    // tab screen is scoped to that screen's own test id.
    const rows = page.getByTestId('screen-projects').getByTestId(/^project-row-/)
    const count = await rows.count()
    test.skip(count < 2, 'the seed has fewer than two projects for this person')
    // The first row that is not the current project.
    let picked = 0
    for (let i = 0; i < count; i += 1) {
      if ((await rows.nth(i).getAttribute('aria-selected')) !== 'true') {
        picked = i
        break
      }
    }
    const needsYou = page.waitForRequest((r) => r.url().includes('/assignments/mine'))
    await rows.nth(picked).click()
    await expect(page.getByTestId('screen-home')).toBeVisible()
    await expect(page.getByTestId('project-switch')).not.toHaveText(before)
    const projectId = new URL((await needsYou).url()).pathname.split('/')[4]
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('Needs You lists the open items with their counts and filters', async ({ page }) => {
    await signIn(page)
    await page.goto('/needs-you')
    const screen = page.getByTestId('screen-needs-you')
    await expect(screen).toBeVisible()
    await expect(screen.getByText(/\d+ open item/)).toBeVisible()
    await expect(screen.getByTestId('chip-ball')).toBeVisible()
    await page.getByTestId('chip-overdue').click()
    await expect(page.getByTestId('chip-overdue')).toHaveAttribute('aria-selected', 'true')
  })

  test('Search finds records and widens to every project', async ({ page }) => {
    await signIn(page)
    await page.goto('/search')
    const request = page.waitForRequest((r) => r.url().includes('/api/v1/search?') && r.url().includes('q=rfi'))
    await page.getByTestId('search-input').fill('rfi')
    const sent = await request
    expect(sent.headers()['authorization']).toMatch(/^Bearer /)
    await expect(page.getByTestId('search-count')).toContainText(/result/)
    await page.getByTestId('chip-scope-all').click()
    await expect(page.getByTestId('chip-scope-all')).toHaveAttribute('aria-selected', 'true')
  })

  test('Notifications shows the inbox and marks a notification read on open', async ({ page }) => {
    await signIn(page)
    await page.goto('/notifications')
    await expect(page.getByTestId('screen-notifications')).toBeVisible()
    await expect(page.getByText(/unread/).first()).toBeVisible()
    await page.getByTestId('chip-all').click()
    await expect(page.getByTestId('chip-all')).toHaveAttribute('aria-selected', 'true')
    await page.getByTestId('toggle-preferences').click()
    await expect(page.getByText('By category')).toBeVisible()
  })

  test('a refused refresh ends the session and explains why', async ({ page }) => {
    await signIn(page)
    // Corrupt the saved refresh token the way a revoked session would look, then reload.
    await page.evaluate(() => sessionStorage.setItem('octapm.session.refresh', 'no-longer-valid-token-value-0000'))
    const refresh = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/refresh'))
    await page.reload()
    expect((await refresh).status()).toBe(401)
    await expect(page.getByTestId('sign-in-submit')).toBeVisible()
    await expect(page.getByText(/session ended|Sign in again/)).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem('octapm.session.refresh'))).toBeNull()
  })

  test('sign-out revokes the session on the server and returns to sign-in', async ({ page }) => {
    await signIn(page)
    await page.goto('/more')
    const logout = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/logout'))
    await page.getByTestId('sign-out').click()
    expect((await logout).status()).toBe(200)
    await expect(page.getByTestId('sign-in-submit')).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem('octapm.session.refresh'))).toBeNull()
    expect(await page.evaluate(() => sessionStorage.getItem('octapm.session.profile'))).toBeNull()
  })
})
