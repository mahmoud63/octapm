import { expect, test } from '@playwright/test'
import { signIn } from './support'

/**
 * Signing out and an expired session are different things and must never be
 * conflated (Phase 22A, from the Phase 22 audit UX22-13): a deliberate sign
 * out ends with a neutral "Signed out", an expired or invalid session with
 * "Session expired!".
 */
test.describe('sign-out messaging', () => {
  test('a deliberate sign out says "Signed out" and never "Session expired!"', async ({ page }) => {
    await signIn(page, 'pm')
    await expect(page.getByText('Workspace Control')).toBeVisible()

    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: /sign out/i }).click()
    // the confirmation is an alert dialog; its own "Sign out" button
    await page.getByRole('alertdialog').getByRole('button', { name: /^sign out$/i }).click()

    await expect(page.getByText('Signed out')).toBeVisible()
    await expect(page.locator('input[type="password"]').first()).toBeVisible()
    await expect(page.getByText('Session expired!')).toHaveCount(0)
  })

  test('an invalid session still reports "Session expired!"', async ({ page }) => {
    await signIn(page, 'pm')
    await expect(page.getByText('Workspace Control')).toBeVisible()

    // With a person still signed in, the API answering 401 is an expired or
    // invalid session — that path keeps its warning.
    await page.route('**/api/v1/projects**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token expired' } }),
      })
    )
    await page.goto('/projects')
    await expect(page.getByText('Session expired!').first()).toBeVisible({ timeout: 15_000 })
    // and only one of them, however many requests answered 401 together
    await expect(page.getByText('Session expired!')).toHaveCount(1)
  })
})
