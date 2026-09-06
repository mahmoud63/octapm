import { expect, test } from '@playwright/test'
import { signIn, watchForProblems } from './support'

/**
 * Error handling and resilience.
 *
 * Real networks fail. What matters is whether a failure in something
 * peripheral — a billing check, a background poll — degrades gracefully or
 * takes the page down, and whether the user is told anything useful.
 */

test.describe('resilience to backend failures', () => {
  test('a rate-limited billing check does not take down the page', async ({ page }) => {
    const problems = watchForProblems(page)
    await signIn(page)

    // The app asks for the subscription on navigation. Make that call fail the
    // way a rate limiter makes it fail, and see what the page does.
    await page.route('**/billing/subscription*', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many billing requests. Try again later.' },
        }),
      }),
    )

    await page.goto('/reports')
    await page.waitForLoadState('domcontentloaded')
    // Give the app every chance to recover before judging it.
    await page.waitForTimeout(6000)
    const body = await page.locator('body').innerText()
    // eslint-disable-next-line no-console
    console.log(`BILLING_429_BODY url=${page.url()} len=${body.trim().length} text=${JSON.stringify(body.trim().slice(0, 200))}`)
    // eslint-disable-next-line no-console
    console.log('BILLING_429_FAILED ' + JSON.stringify([...new Set(problems.failedRequests)].slice(0, 10)))
    // eslint-disable-next-line no-console
    console.log('BILLING_429_CONSOLE ' + JSON.stringify([...new Set(problems.consoleErrors)].slice(0, 6)))

    // The reports page has nothing to do with billing. It must still render.
    expect(
      /Something went wrong|Unexpected error/i.test(body),
      'a 429 on the billing check dropped the page into an error boundary',
    ).toBeFalsy()
    expect(body.trim().length, 'the page rendered blank').toBeGreaterThan(40)
  })

  test('a transient failure on the session check does not log the user out', async ({ page }) => {
    await signIn(page)

    // A rate limit or a blip on /auth/me is not proof the session is invalid.
    // Only a 401 means "not authenticated"; everything else is a fault to
    // recover from, and must not throw the user out of the application.
    let served = 0
    await page.route('**/auth/me*', async (route) => {
      served += 1
      if (served === 1) {
        return route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
          }),
        })
      }
      return route.continue()
    })

    await page.goto('/reports')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(5000)

    const url = page.url()
    const body = await page.locator('body').innerText()
    const ejected = url.includes('/landing') || body.includes('Get Early Access')

    expect(
      ejected,
      `a 429 on /auth/me ejected the signed-in user to the marketing page (url=${url})`,
    ).toBeFalsy()
  })

  test('a failed project list shows a message, not a raw stack trace', async ({ page }) => {
    await signIn(page)
    await page.route('**/api/v1/projects*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
        }),
      }),
    )

    await page.goto('/projects')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)
    const body = await page.locator('body').innerText()

    // Whatever it shows, it must not leak internals at the user.
    for (const leak of ['PrismaClient', 'at Module._compile', 'node_modules', 'QueryEngine', '\\backend\\src']) {
      expect(body, `the page leaked "${leak}" to the user`).not.toContain(leak)
    }
  })

  test('an unknown project id does not crash the workspace', async ({ page }) => {
    await signIn(page)
    await page.goto('/projects/00000000-0000-4000-8000-000000000000/overview')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)

    const body = await page.locator('body').innerText()
    expect(body.trim().length, 'blank page for an unknown project id').toBeGreaterThan(40)
    for (const leak of ['PrismaClient', 'node_modules', 'QueryEngine']) {
      expect(body, `leaked "${leak}"`).not.toContain(leak)
    }
  })

  test('a malformed project id in the URL is handled', async ({ page }) => {
    await signIn(page)
    await page.goto('/projects/not-a-uuid/overview')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2500)

    const body = await page.locator('body').innerText()
    expect(body.trim().length, 'blank page for a malformed id').toBeGreaterThan(40)
    expect(body).not.toContain('PrismaClient')
  })
})

test.describe('form validation', () => {
  test('a required field is enforced before anything is sent', async ({ page }) => {
    const problems = watchForProblems(page)
    await signIn(page)
    await page.goto('/company/cost-codes')
    // The app ships `uat-*` test ids for exactly this purpose; they are stabler
    // than button text.
    await page.getByTestId('uat-cost-code-new').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Submit the empty form. Nothing should be created, and the user should be
    // told why rather than the request silently failing.
    const before = problems.failedRequests.length
    await page.getByTestId('uat-cost-code-save').click()
    await page.waitForTimeout(1500)

    const stillOpen = await dialog.isVisible().catch(() => false)
    const serverRejections = problems.failedRequests.length - before

    // Either the client blocked it (dialog stays open, no request) or the
    // server rejected it and the dialog stayed open to show the error. What
    // must not happen is the dialog closing as though it worked.
    expect(
      stillOpen,
      'the dialog closed on an empty submit, implying success that did not happen',
    ).toBeTruthy()
    // eslint-disable-next-line no-console
    console.log(`EMPTY_SUBMIT server rejections: ${serverRejections}`)
  })
})
