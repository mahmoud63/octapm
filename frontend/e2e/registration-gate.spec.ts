import { expect, test, type Page } from '@playwright/test'

/**
 * The self-service registration switch, as the signed-out screens show it.
 *
 * GET /config/public says whether sign-up is open; it is closed in production
 * unless the operator opens it. These tests answer that request themselves,
 * so they run the same whatever the local API is configured to do (locally
 * it is open, which is what 08-auth-entry and 09-landing-brand rely on).
 */

const answerRegistration = (page: Page, registration: 'open' | 'closed') =>
  page.route('**/api/v1/config/public', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { registration } }),
    })
  )

const signUpLinks = (page: Page) => page.locator('a[href="/sign-up"]')

test.describe('registration closed', () => {
  test.beforeEach(async ({ page }) => {
    await answerRegistration(page, 'closed')
  })

  test('/sign-up explains that organisations join by invitation', async ({
    page,
  }) => {
    await page.goto('/sign-up')
    await expect(page.getByTestId('sign-up-invitation-only')).toBeVisible()
    await expect(page.getByText('Joining is by invitation')).toBeVisible()
    await expect(page.getByTestId('uat-sign-up-form')).toHaveCount(0)
    await page.getByTestId('uat-sign-up-to-sign-in').click()
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('sign-in and forgot-password offer no sign-up', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.getByTestId('sign-in-invitation-only')).toBeVisible()
    await expect(page.getByTestId('uat-sign-in-to-sign-up')).toHaveCount(0)
    await expect(signUpLinks(page)).toHaveCount(0)

    await page.goto('/forgot-password')
    await expect(
      page.getByText('Ask your company administrator for an invitation.')
    ).toBeVisible()
    await expect(signUpLinks(page)).toHaveCount(0)
  })

  test('the landing page leads to sign-in, never to sign-up', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByTestId('uat-landing-cta')).toHaveText('Sign in')
    await expect(page.getByTestId('uat-landing-cta')).toHaveAttribute(
      'href',
      '/sign-in'
    )
    await expect(signUpLinks(page)).toHaveCount(0)
  })
})

test.describe('registration open', () => {
  test('sign-up, sign-in and the landing page offer it', async ({ page }) => {
    await answerRegistration(page, 'open')
    await page.goto('/sign-up')
    await expect(page.getByTestId('uat-sign-up-form')).toBeVisible()
    await expect(page.getByTestId('sign-up-invitation-only')).toHaveCount(0)

    await page.goto('/sign-in')
    await expect(page.getByTestId('uat-sign-in-to-sign-up')).toBeVisible()

    await page.goto('/')
    await expect(page.getByTestId('uat-landing-cta')).toHaveAttribute(
      'href',
      '/sign-up'
    )
  })

  test('an unreachable switch falls back to offering sign-up', async ({
    page,
  }) => {
    await page.route('**/api/v1/config/public', (route) =>
      route.fulfill({ status: 503, body: 'unavailable' })
    )
    await page.goto('/sign-up')
    await expect(page.getByTestId('uat-sign-up-form')).toBeVisible()
  })
})
