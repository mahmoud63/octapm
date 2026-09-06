import { expect, test } from '@playwright/test'
import { watchForProblems } from './support'

/**
 * The signed-out entry surfaces: sign in, sign up, and the two legal documents
 * they link to.
 *
 * These pages are the only part of the product a prospect sees before they have
 * an account, so the checks here are about reachability rather than data: the
 * routes must resolve without a session, the links between them must actually
 * go somewhere, and the brand ground must render behind all of it.
 *
 * Screenshots land in docs/design/screenshots/.
 */

const SHOTS = '../docs/design/screenshots'

/** The dark brand ground the auth and legal pages sit on. */
const HERO = '.octa-hero.octa-pattern'

test.describe('signed-out entry', () => {
  test('sign-in sits on the full brand ground', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.getByTestId('uat-sign-in-form')).toBeVisible()

    const hero = page.locator(HERO).first()
    await expect(hero, 'the sign-in page is missing the brand ground').toBeVisible()

    // "Full in the background pattern": the ground must cover the viewport,
    // not sit in a card in the middle of it.
    const box = await hero.boundingBox()
    const viewport = page.viewportSize()!
    expect(box!.width, 'the brand ground does not span the viewport').toBeGreaterThanOrEqual(
      viewport.width - 2,
    )
    expect(box!.height, 'the brand ground does not fill the viewport').toBeGreaterThanOrEqual(
      viewport.height - 2,
    )

    // The pattern is drawn as a ::before layer over the gradient. If the layer
    // is missing or transparent there is a gradient but no octagons.
    const pattern = await hero.evaluate((el) => {
      const style = getComputedStyle(el, '::before')
      return { image: style.backgroundImage, opacity: Number(style.opacity) }
    })
    expect(pattern.image, 'no pattern layer on the auth ground').not.toBe('none')
    expect(pattern.opacity, 'the pattern layer is invisible').toBeGreaterThan(0)

    // The brand promise carries the left column on a desktop viewport.
    await expect(page.getByText('Total Project Control')).toBeVisible()

    await page.screenshot({ path: `${SHOTS}/07-sign-in.png`, fullPage: false })
  })

  test('sign-in offers a way to create an account, and back again', async ({ page }) => {
    await page.goto('/sign-in')

    const toSignUp = page.getByTestId('uat-sign-in-to-sign-up')
    await expect(toSignUp, 'sign-in offers no route to sign-up').toBeVisible()
    await toSignUp.click()

    await expect(page).toHaveURL(/\/sign-up/)
    await expect(page.getByTestId('uat-sign-up-form')).toBeVisible()
    await expect(page.getByTestId('uat-sign-up-submit')).toBeEnabled()
    await expect(page.locator(HERO).first()).toBeVisible()

    await page.screenshot({ path: `${SHOTS}/08-sign-up.png`, fullPage: false })

    // The pair has to work in both directions, or one is a dead end.
    await page.getByTestId('uat-sign-up-to-sign-in').click()
    await expect(page).toHaveURL(/\/sign-in/)
    await expect(page.getByTestId('uat-sign-in-form')).toBeVisible()
  })

  test('the sign-up form validates before it calls the API', async ({ page }) => {
    const problems = watchForProblems(page)
    await page.goto('/sign-up')
    await expect(page.getByTestId('uat-sign-up-form')).toBeVisible()

    // Mismatched passwords must be caught client-side: a registration request
    // that the server has to reject is a defect, not validation.
    await page.getByPlaceholder('Sara Haddad').fill('Test Person')
    await page.getByPlaceholder('name@example.com').fill('someone@example.com')
    const passwords = page.locator('input[type="password"]')
    await passwords.nth(0).fill('DemoPassw0rd!')
    await passwords.nth(1).fill('SomethingElse1!')
    await page.getByTestId('uat-sign-up-submit').click()

    await expect(page.getByText("Passwords don't match.")).toBeVisible()
    expect(
      problems.failedRequests.filter((r) => r.includes('/auth/register')),
      'the form posted a registration it should have rejected itself',
    ).toEqual([])
  })

  test('a signed-out visitor can read the Terms of Service', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByRole('link', { name: 'Terms of Service' }).first().click()

    await expect(page).toHaveURL(/\/terms/)
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible()

    // A contents list that names sections which do not exist is worse than none.
    const contents = page.getByRole('navigation', { name: 'Contents' })
    await expect(contents).toBeVisible()
    const links = await contents.getByRole('link').all()
    expect(links.length, 'the terms have no sections').toBeGreaterThan(5)
    for (const link of links) {
      const id = (await link.getAttribute('href'))!.replace('#', '')
      await expect(
        page.locator(`#${id}`),
        `the contents list points at a missing section: #${id}`,
      ).toHaveCount(1)
    }

    // It must not have become a signed-in page by accident.
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible()

    await page.screenshot({ path: `${SHOTS}/09-terms.png`, fullPage: false })
  })

  test('a signed-out visitor can read the Privacy Policy', async ({ page }) => {
    await page.goto('/privacy')

    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible()
    await expect(page.getByText('Draft pending legal review')).toBeVisible()

    // The subjects a construction platform has to address, and the reason these
    // were written rather than borrowed.
    for (const topic of ['Daily logs', 'Timesheets', 'Site photographs']) {
      await expect(
        page.getByText(topic, { exact: true }).first(),
        `the privacy policy never mentions ${topic}`,
      ).toBeVisible()
    }

    await page.getByRole('link', { name: 'Back to sign in' }).click()
    await expect(page).toHaveURL(/\/sign-in/)

    await page.goto('/privacy')
    await page.screenshot({ path: `${SHOTS}/10-privacy.png`, fullPage: false })
  })

  test('the entry pages hold together on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    for (const [label, path] of [
      ['sign-in', '/sign-in'],
      ['sign-up', '/sign-up'],
      ['terms', '/terms'],
      ['privacy', '/privacy'],
    ] as Array<[string, string]>) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${label} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(2)
    }

    await page.goto('/sign-in')
    await expect(page.getByTestId('uat-sign-in-form')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/11-sign-in-mobile.png`, fullPage: false })
  })
})
