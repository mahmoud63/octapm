import { expect, test, type Page } from '@playwright/test'

/**
 * M7 on the web target: capture without a signal, then send when it
 * returns. The browser is taken offline with Playwright's own switch, so
 * the app's connectivity listener, the outbox and the drain are the real
 * ones. Writes go to the dedicated end-to-end organisation only.
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

test.describe('M7 on the web target', () => {
  test('a punch item captured offline waits in the outbox and is sent once when the signal returns', async ({ page, context }) => {
    await signIn(page)
    // Warm the lists the form needs, so offline it can still be filled.
    await page.goto('/quality/punch/new')
    await expect(page.getByTestId('screen-punch-new')).toBeVisible()
    await context.setOffline(true)
    await expect(page.getByTestId('connectivity-bar')).toContainText('Offline')
    const stamp = Date.now() % 100000
    await page.getByTestId('punch-title').fill(`E2E offline tile ${stamp}`)
    await page.getByTestId('punch-raise').click()
    await expect(page.getByTestId('screen-outbox')).toBeVisible()
    const item = page.locator('[data-testid^="outbox-item-"]').first()
    await expect(item).toContainText(`E2E offline tile ${stamp}`)
    await expect(item).toContainText('Waiting')
    await expect(page.getByTestId('connectivity-bar')).toContainText('1 item waiting to send')

    const posted = page.waitForResponse((r) => r.url().endsWith('/punch') && r.request().method() === 'POST', { timeout: 20_000 })
    await context.setOffline(false)
    const response = await posted
    expect(response.status()).toBe(201)
    const sent = response.request().postDataJSON() as { title: string; clientRequestId: string }
    expect(sent.title).toBe(`E2E offline tile ${stamp}`)
    expect(sent.clientRequestId).toMatch(/[0-9a-f-]{20,}/)
    await expect(item).toContainText('Sent')
    await expect(page.getByTestId('connectivity-bar')).toHaveCount(0)
    // Sent once: one POST for this title.
    await page.goto('/quality/punch')
    await page.getByTestId('punch-search').fill(`E2E offline tile ${stamp}`)
    await page.getByTestId('punch-search').press('Enter')
    await expect(page.locator('[data-testid^="punch-row-"]')).toHaveCount(1)
  })

  test('a daily-log entry captured offline says so on the screen and goes to the outbox', async ({ page, context }) => {
    await signIn(page)
    await page.getByTestId('records-site').click()
    await expect(page.getByTestId('screen-daily-log')).toBeVisible()
    await expect(page.getByTestId('daily-log-add-manpower')).toBeVisible()
    await context.setOffline(true)
    await page.getByTestId('daily-log-add-manpower').click()
    await page.getByTestId('entry-companyName').fill(`E2E Offline Crew ${Date.now() % 10000}`)
    await page.getByTestId('entry-trade').fill('Steelfixers')
    await page.getByTestId('entry-workers').fill('3')
    await page.getByTestId('entry-hours').fill('8')
    await page.getByTestId('entry-save').click()
    await expect(page.getByTestId('daily-log-queued')).toContainText('Saved to the outbox')
    await page.getByTestId('daily-log-open-outbox').click()
    await expect(page.getByTestId('screen-outbox')).toBeVisible()
    await expect(page.locator('[data-testid^="outbox-item-"]').first()).toContainText('Manpower entry')
    const posted = page.waitForResponse((r) => r.url().endsWith('/entries/manpower') && r.request().method() === 'POST', { timeout: 20_000 })
    await context.setOffline(false)
    expect((await posted).status()).toBe(201)
    await expect(page.locator('[data-testid^="outbox-item-"]').first()).toContainText('Sent')
  })
})
