import { test, expect } from '@playwright/test'
import { gateConsole, openProject, signIn } from './support'
import { observe } from './support-ux'

/**
 * The console quality gate for the Phase 20 workflows.
 *
 * Three real defects were found by looking at the console and none of them had
 * ever failed a test, because the suite's existing watcher listened for
 * `console.error` and two of the three arrive as `console.warn`
 * (OCTA-QA-CONSOLE-106):
 *
 *   - `PackagesPanel` keyed the wrong element: the map returned a bare `<>`,
 *     so React had no key for the array element at all.
 *   - The purchase-order dialog rendered its heading inside the body that only
 *     mounts once the fetch resolves, so for the whole load it had no
 *     accessible name and no description.
 *   - The activity dialog had a title but no description.
 *
 * This walks the screens those workflows use and fails on anything the
 * application says about itself. The allowlist lives in `support.ts` and holds
 * two entries, both messages the browser emits *about* the page.
 */

test.describe('the console is clean on the certified workflows', () => {
  test('every Phase 20 screen loads without the app complaining', async ({ page }) => {
    test.slow()
    const console_ = gateConsole(page)

    await signIn(page, 'pm')
    const projectId = await openProject(page)

    const screens: Array<[string, string]> = [
      ['project overview (Needs you)', `/projects/${projectId}/overview`],
      ['procurement packages', `/projects/${projectId}/procurement/packages`],
      ['purchase orders', `/projects/${projectId}/procurement/purchase-orders`],
      ['suppliers', `/projects/${projectId}/procurement/suppliers`],
      ['long lead', `/projects/${projectId}/procurement/long-lead`],
      ['pay applications', `/projects/${projectId}/commercial/pay-apps`],
      ['commitments', `/projects/${projectId}/commercial/commitments`],
      ['bid packages', `/projects/${projectId}/commercial/bids`],
      ['activities register', `/projects/${projectId}/activities`],
      ['schedule activities', `/projects/${projectId}/schedule/activities`],
      ['goods receipt', '/inventory?tab=receive'],
      ['inventory items', '/inventory?tab=items'],
    ]

    for (const [label, url] of screens) {
      await page.goto(url)
      await page.waitForTimeout(1800)
      console_.assertClean(`loading ${label}`)
    }
    observe('CONSOLE_SCREENS_CLEAN', screens.length)
  })

  test('expanding a package and opening an order stay clean', async ({ page }) => {
    test.slow()
    const console_ = gateConsole(page)

    await signIn(page, 'pm')
    const projectId = await openProject(page)

    // The package rows: this is where the missing key surfaced, and it only
    // surfaces when there is more than one row to key.
    await page.goto(`/projects/${projectId}/procurement/packages`)
    const rows = page.locator('[data-testid^="uat-package-row-"]')
    await expect(rows.first()).toBeVisible({ timeout: 30_000 })
    const count = await rows.count()
    expect(count, 'more than one package, so the keys actually matter').toBeGreaterThan(1)
    for (let i = 0; i < Math.min(count, 3); i += 1) {
      await rows.nth(i).click()
      await page.waitForTimeout(900)
    }
    console_.assertClean('expanding procurement packages')
    observe('CONSOLE_PACKAGE_ROWS', count)

    // The purchase-order dialog, through its loading state — which is the
    // window that had no accessible name.
    await page.goto(`/projects/${projectId}/procurement/purchase-orders`)
    const order = page.locator('tbody tr').first()
    await expect(order).toBeVisible({ timeout: 30_000 })
    await order.click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2000)
    console_.assertClean('opening a purchase order')

    // And the dialog is announced: a name, and something after it.
    const dialog = page.getByRole('dialog')
    const label = await dialog.getAttribute('aria-labelledby')
    const described = await dialog.getAttribute('aria-describedby')
    observe('DIALOG_ACCESSIBLE_NAME', { labelled: Boolean(label), described: Boolean(described) })
    expect(label, 'the dialog has an accessible name').toBeTruthy()
  })

  test('the activity dialog announces itself', async ({ page }) => {
    const console_ = gateConsole(page)
    await signIn(page, 'pm')
    const projectId = await openProject(page)

    await page.goto(`/projects/${projectId}/activities`)
    const add = page.getByRole('button', { name: /add activity/i }).first()
    await expect(add).toBeVisible({ timeout: 30_000 })
    await add.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1200)

    console_.assertClean('opening the activity dialog')
    expect(await dialog.getAttribute('aria-describedby'), 'it is described').toBeTruthy()
  })
})
