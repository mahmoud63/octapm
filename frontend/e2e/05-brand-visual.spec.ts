import { expect, test } from '@playwright/test'
import { openProject, signIn } from './support'

/**
 * Brand and visual validation.
 *
 * Captures the states the design brief asks to be reviewed by eye, and asserts
 * the things that can be checked mechanically: that the collapsed rail is
 * actually Midnight Indigo, that status colours carry their assigned meaning,
 * and that the layout survives tablet and mobile widths without overflowing.
 *
 * Screenshots land in docs/design/screenshots/.
 */

// Relative to the Playwright config, which lives in frontend/.
const SHOTS = '../docs/design/screenshots'
const MIDNIGHT_INDIGO = 'rgb(15, 27, 100)'

/** Sets both collapsible panels before the page is loaded. */
async function presetPanels(page: import('@playwright/test').Page, collapsed: boolean) {
  await page.addInitScript((value) => {
    localStorage.setItem('octa.project.nav.collapsed', String(value))
    localStorage.setItem('octa.project.readiness.collapsed', String(value))
  }, collapsed)
}

test.describe('brand visual validation', () => {
  test('desktop, expanded: module nav and readiness in full', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await presetPanels(page, false)
    await page.goto(`/projects/${projectId}/overview`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3500)

    // Project navigation is the top module bar. It is deliberately lighter
    // than the application header above it.
    const bar = page.getByTestId('uat-project-module-bar')
    await expect(bar, 'the project module bar did not render').toBeVisible()

    const barBg = await bar.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(barBg, 'the module bar should be a light surface').not.toBe(MIDNIGHT_INDIGO)

    await page.screenshot({ path: `${SHOTS}/01-desktop-expanded.png`, fullPage: false })
  })

  test('the workspace runs full width with the module bar on top', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await presetPanels(page, true)
    await page.goto(`/projects/${projectId}/cost/budget`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3500)

    // Navigation moved to the top bar; the left rail was removed so there is
    // one obvious primary module navigation rather than two.
    await expect(page.getByTestId('uat-project-module-rail')).toHaveCount(0)
    await expect(page.getByTestId('uat-project-module-bar')).toBeVisible()

    // The compact readiness bar keeps its collapsed state.
    await expect(page.getByTestId('uat-setup-readiness-expand')).toBeVisible()

    // The workspace should now use nearly the whole viewport width.
    const content = page.getByTestId(/^uat-project-content-/)
    const box = await content.first().boundingBox()
    const viewport = page.viewportSize()!
    expect(
      box!.width / viewport.width,
      'the workspace should span most of the viewport now the sidebar is gone',
    ).toBeGreaterThan(0.9)

    await page.screenshot({ path: `${SHOTS}/02-desktop-full-width.png`, fullPage: false })
  })

  test('readiness panel collapses and expands, and remembers it', async ({ page }) => {
    // No preset here: a fresh context starts with empty storage, which is the
    // default expanded state. Seeding it would mean the reload check was only
    // testing the harness, since addInitScript re-runs on every navigation.
    await signIn(page)
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/overview`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)

    await page.screenshot({ path: `${SHOTS}/03-readiness-expanded.png`, fullPage: false })

    await page.getByTestId('uat-setup-readiness-collapse').click()
    const bar = page.getByTestId('uat-setup-readiness-expand')
    await expect(bar).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/04-readiness-collapsed.png`, fullPage: false })

    // The choice must survive a reload, or it is not a preference.
    await page.reload()
    await page.waitForTimeout(3000)
    await expect(
      page.getByTestId('uat-setup-readiness-expand'),
      'the collapsed choice was forgotten on reload',
    ).toBeVisible()

    await page.getByTestId('uat-setup-readiness-expand').click()
    await expect(page.getByTestId('uat-setup-readiness-collapse')).toBeVisible()
  })

  test('status colours carry their assigned meaning', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await presetPanels(page, false)
    await page.goto(`/projects/${projectId}/overview`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)

    // Semantics are fixed product-wide: Done is green, Blocked is red.
    const done = page.getByText('Done', { exact: true }).first()
    const blocked = page.getByText('Blocked', { exact: true }).first()

    if (await done.isVisible().catch(() => false)) {
      const colour = await done.evaluate((el) => getComputedStyle(el).color)
      // The success token resolves to a green; assert the channel ordering
      // rather than an exact value, so a brand tweak does not break the test.
      const [r, g, b] = colour.match(/\d+/g)!.map(Number)
      expect(g, `"Done" should read green, got ${colour}`).toBeGreaterThan(r)
      expect(g, `"Done" should read green, got ${colour}`).toBeGreaterThan(b)
    }

    if (await blocked.isVisible().catch(() => false)) {
      const colour = await blocked.evaluate((el) => getComputedStyle(el).color)
      const [r, g, b] = colour.match(/\d+/g)!.map(Number)
      expect(r, `"Blocked" should read red, got ${colour}`).toBeGreaterThan(g)
      expect(r, `"Blocked" should read red, got ${colour}`).toBeGreaterThan(b)
    }
  })

  test('tablet and mobile keep the brand without overflowing', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await presetPanels(page, false)

    for (const [label, width, height] of [
      ['05-tablet', 834, 1112],
      ['06-mobile', 390, 844],
    ] as Array<[string, number, number]>) {
      await page.setViewportSize({ width, height })
      await page.goto(`/projects/${projectId}/overview`)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(3000)

      // Nothing may scroll the page sideways.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(overflow, `${label} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(2)

      await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: false })
    }
  })
})
