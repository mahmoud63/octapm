import { test, expect, type Page } from '@playwright/test'
import { openProject, signIn } from './support'
import { observe } from './support-ux'

/**
 * The badge has to be on the screen, not just in the payload.
 *
 * Ball-in-court is derived on the server and was already correct there while
 * every register still showed only a status — which is the state Phase 19
 * left the whole nervous system in. This checks the four registers a person
 * actually reads, and that the words on them name a person rather than a
 * permission code.
 */

const badgesOn = async (page: Page, url: string) => {
  await page.goto(url)
  const badges = page.locator('[data-testid^="uat-"][data-state]')
  await expect(badges.first()).toBeVisible({ timeout: 30_000 })
  const seen = await badges.evaluateAll((nodes) =>
    nodes.slice(0, 6).map((node) => ({
      state: node.getAttribute('data-state'),
      party: node.getAttribute('data-party'),
      text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
    })),
  )
  return seen
}

test.describe('whose move it is, on the screen', () => {
  test('the registers a person reads say who is holding each record', async ({ page }) => {
    test.slow()
    await signIn(page, 'pm')
    const projectId = await openProject(page)

    const screens: Array<[string, string]> = [
      ['purchase orders', `/projects/${projectId}/procurement/purchase-orders`],
      ['pay applications', `/projects/${projectId}/commercial/pay-apps`],
      ['commitments', `/projects/${projectId}/commercial/commitments`],
      ['bid packages', `/projects/${projectId}/commercial/bids`],
    ]

    for (const [name, url] of screens) {
      const seen = await badgesOn(page, url)
      observe('BALL_IN_COURT_ON_SCREEN', { screen: name, count: seen.length, seen })
      expect(seen.length, `${name} shows at least one badge`).toBeGreaterThan(0)

      for (const badge of seen) {
        // A permission code is two lowercase words joined by a dot. Nobody
        // outside this repository should ever be shown one.
        expect(badge.text, `${name}: no permission code on screen`).not.toMatch(
          /\b[a-z_]+\.[a-z_]+\b/,
        )
        expect(badge.text.length, `${name}: the badge says something`).toBeGreaterThan(0)
        expect(['yours', 'awaiting']).toContain(badge.state)
      }
    }
  })
})
