import { expect, type Locator, type Page } from '@playwright/test'

/** The toasts on the page carrying this text. */
export const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text })

/**
 * No toast with `text` is on the page while `beside` — the toast it would have
 * come with — is showing.
 *
 * A toast lives five seconds (`<Toaster duration={5000} />`). A retrying
 * `expect(toast(page, text)).toHaveCount(0)` therefore proves nothing: it waits
 * an unwanted toast out and passes. This reads the page once, and then checks
 * that `beside` is still up, so the reading was taken inside its lifetime — two
 * toasts raised by the same handler are on the page together.
 *
 * A toast with the same text from an earlier step must be gone before the step
 * under test starts (wait for it, or reload the page), or it is counted here.
 */
export const expectNoToastBeside = async (page: Page, text: string | RegExp, beside: Locator) => {
  await expect(beside).toBeVisible()
  const unwanted = await toast(page, text).count()
  expect(await beside.isVisible(), 'the toast the reading was taken beside had already gone').toBe(true)
  expect(unwanted, `toasts reading ${String(text)} beside the expected one`).toBe(0)
}
