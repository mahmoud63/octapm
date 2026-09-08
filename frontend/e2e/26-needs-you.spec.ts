import { test, expect } from '@playwright/test'
import { openProject, signIn } from './support'
import { observe } from './support-ux'

/**
 * "What needs my attention today?", asked by four different people.
 *
 * The endpoint behind this has existed since the records module and nothing
 * ever called it, so a buyer with thirty orders to send opened the project to
 * a health dashboard and went looking module by module. The list has to be
 * different for each person — a panel that shows everyone the same thing is
 * the same as no panel.
 */

test.describe('what needs you today', () => {
  for (const who of ['procurement', 'qs', 'finance', 'warehouse'] as const) {
    test(`the ${who} sees their own work first`, async ({ page }) => {
      await signIn(page, who)
      const projectId = await openProject(page)
      await page.goto(`/projects/${projectId}/overview`)

      const panel = page.getByTestId('uat-needs-you')
      await expect(panel).toBeVisible({ timeout: 30_000 })

      const rows = page.locator('[data-testid^="uat-needs-you-"][href]')
      const count = await page.getByTestId('uat-needs-you-count').innerText()
      const shown = await rows.evaluateAll((nodes) =>
        nodes.map((node) => ({
          href: node.getAttribute('href'),
          text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
        })),
      )
      observe('NEEDS_YOU', { who, count: count.trim(), rows: shown.length, first: shown[0] })

      expect(shown.length, `${who} has work listed`).toBeGreaterThan(0)
      for (const row of shown) {
        // Every row goes to the record, not to the module it lives in.
        expect(row.href, 'the row deep-links to its record').toMatch(/[?&]recordId=/)
        expect(row.text, 'no permission codes').not.toMatch(/\b[a-z_]+\.[a-z_]+\b/)
      }
    })
  }
})

/**
 * A row that loads the register and opens nothing looks exactly like a row
 * that worked — the list is there either way. The purchase-order link was
 * broken this way: the workspace calls that record `procurement_order` when
 * it opens one from a URL, and the action centre was sending its own name for
 * the type (OCTA-UX-ACTION-099).
 */
test.describe('the rows go to the record', () => {
  for (const who of ['procurement', 'qs', 'finance'] as const) {
    test(`the ${who}'s first item opens when followed`, async ({ page }) => {
      await signIn(page, who)
      const projectId = await openProject(page)
      await page.goto(`/projects/${projectId}/overview`)

      const first = page.locator('[data-testid^="uat-needs-you-"][href]').first()
      await expect(first).toBeVisible({ timeout: 30_000 })
      const href = await first.getAttribute('href')

      await page.goto(href!)
      await expect(
        page.getByRole('dialog'),
        `${who}: following the row opens the record itself`,
      ).toBeVisible({ timeout: 30_000 })
      observe('NEEDS_YOU_OPENS_RECORD', { who, href })
    })
  }
})
