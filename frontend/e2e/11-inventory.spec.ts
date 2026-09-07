import { expect, test, type Page } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, signIn } from './support'

/**
 * Inventory and warehouse.
 *
 * The scan is the thing worth testing hardest: it is what somebody standing in
 * front of a pallet with a phone actually does, and it has to answer "what is
 * this, how much is there and where" before it offers to move anything.
 *
 * Screenshots land in docs/design/screenshots/.
 */

const SHOTS = '../docs/design/screenshots'
const CEMENT = 'CEM-42.5N'

async function openInventory(page: Page, who: 'pm' | 'warehouse' = 'warehouse') {
  await signIn(page, who)
  await page.goto('/inventory')
  await expect(page.getByRole('heading', { name: 'Inventory & warehouse' })).toBeVisible({
    timeout: 30_000,
  })
}

/** What the API says the item holds, for checking the screen against. */
async function onHandFromApi(sku: string) {
  const client = await apiClient()
  try {
    const token = await apiToken(client, 'warehouse')
    const { body } = await apiGet(client, `/inventory/items/scan/${sku}`, token)
    return body.data.item.onHand as number
  } finally {
    await client.dispose()
  }
}

test.describe('inventory and warehouse', () => {
  test('the workspace opens on scanning, with the stock position', async ({ page }) => {
    await openInventory(page)

    // The figures come from the ledger, so they must not be placeholders.
    const stockValue = page.locator('text=Stock value').locator('..')
    await expect(stockValue).not.toContainText('—')

    await expect(page.getByTestId('uat-inventory-scan')).toBeVisible()
    await expect(page.getByTestId('uat-scan-input')).toBeVisible()

    await page.screenshot({ path: `${SHOTS}/23-inventory-scan.png` })
  })

  test('a scan answers what it is, how much and where', async ({ page }) => {
    await openInventory(page)

    await page.getByTestId('uat-scan-input').fill(CEMENT)
    await page.getByTestId('uat-scan-submit').click()

    const result = page.getByTestId('uat-scan-result')
    await expect(result).toBeVisible()
    await expect(result).toContainText('Cement OPC 42.5N')

    // The bin path is the answer to "where is it", and it has to be the real
    // five-level one rather than a warehouse name alone.
    const locations = page.getByTestId('uat-scan-locations')
    await expect(locations).toContainText('Central Warehouse')
    await expect(locations).toContainText('B-A03-R06-S2-B04')

    // On hand on screen must equal what the API says, not a cached guess.
    const expected = await onHandFromApi(CEMENT)
    await expect(result).toContainText(String(expected))

    // And the actions a storeman needs are right there.
    for (const action of ['issue', 'receive', 'return', 'damage']) {
      await expect(page.getByTestId(`uat-scan-action-${action}`)).toBeVisible()
    }
  })

  test('an unknown code says so rather than failing silently', async ({ page }) => {
    await openInventory(page)

    await page.getByTestId('uat-scan-input').fill('NOT-A-REAL-CODE')
    await page.getByTestId('uat-scan-submit').click()

    await expect(page.getByTestId('uat-scan-error')).toBeVisible()
    await expect(page.getByTestId('uat-scan-result')).toHaveCount(0)
  })

  test('scan, issue to an activity, and the stock and ledger both move', async ({ page }) => {
    await openInventory(page)
    const before = await onHandFromApi(CEMENT)

    await page.getByTestId('uat-scan-input').fill(CEMENT)
    await page.getByTestId('uat-scan-submit').click()
    await expect(page.getByTestId('uat-scan-result')).toBeVisible()

    await page.getByTestId('uat-scan-action-issue').click()
    await expect(page.getByTestId('uat-movement-title')).toContainText('Issue to site')

    await page.getByTestId('uat-movement-quantity').fill('12')

    // An issue has to land on an activity; the dialog will not submit without.
    await expect(page.getByTestId('uat-movement-submit')).toBeDisabled()

    await page.getByTestId('uat-movement-project').click()
    await page.getByRole('option', { name: 'Riverside Tower' }).click()
    await page.getByTestId('uat-movement-activity').click()
    await page.getByRole('option').first().click()

    await expect(page.getByTestId('uat-movement-submit')).toBeEnabled()
    await page.getByTestId('uat-movement-submit').click()

    // The store is 12 lighter, in the API and not just on screen.
    await expect
      .poll(() => onHandFromApi(CEMENT), { timeout: 15_000 })
      .toBe(before - 12)

    // And the movement is in the ledger with the balance it left behind.
    await page.getByRole('tab', { name: 'Ledger' }).click()
    const ledger = page.getByTestId('uat-inventory-ledger')
    await expect(ledger).toBeVisible()
    // The movement type is lower case in the markup and capitalised by CSS.
    await expect(ledger.locator('tbody tr').first()).toContainText(/issue/i)
    await expect(ledger.locator('tbody tr').first()).toContainText('-12')

    // Put it back, so a re-run starts where this one did.
    const client = await apiClient()
    try {
      const token = await apiToken(client, 'warehouse')
      const { body } = await apiGet(client, `/inventory/items/scan/${CEMENT}`, token)
      const item = body.data.item
      const warehouseId = body.data.stock[0].warehouseId
      await client.post(`${API}/inventory/stock/return`, {
        headers: { authorization: `Bearer ${token}` },
        data: {
          itemId: item.id,
          warehouseId,
          locationId: body.data.stock[0].locationId,
          quantity: 12,
          notes: 'Returned by the inventory test',
        },
      })
    } finally {
      await client.dispose()
    }
  })

  test('the item list finds stock and flags what is out', async ({ page }) => {
    await openInventory(page)
    await page.getByRole('tab', { name: 'Items' }).click()

    const items = page.getByTestId('uat-inventory-items')
    await expect(items).toBeVisible()
    await expect(items).toContainText('Cement OPC 42.5N')

    await page.getByTestId('uat-items-search').fill('membrane')
    // The seeded membrane is deliberately unstocked, so the out-of-stock badge
    // has something real to mark.
    await expect(items.locator('tbody tr')).toHaveCount(1)
    await expect(items).toContainText('Out of stock')

    await page.getByTestId('uat-items-search').fill('')
    await page.screenshot({ path: `${SHOTS}/24-inventory-items.png` })
  })

  test('the warehouse tree shows the whole bin path', async ({ page }) => {
    await openInventory(page)
    await page.getByRole('tab', { name: 'Warehouses' }).click()

    await expect(page.getByTestId('uat-warehouse-WH-CENTRAL')).toBeVisible()
    await expect(page.getByTestId('uat-warehouse-WH-RIVERSIDE')).toBeVisible()

    // Zone → aisle → rack → shelf → bin, all five of them.
    const tree = page.getByTestId('uat-warehouse-locations')
    for (const kind of ['zone', 'aisle', 'rack', 'shelf', 'bin']) {
      await expect(tree).toContainText(kind)
    }
    await expect(tree).toContainText('B-A03-R06-S2-B04')

    await page.screenshot({ path: `${SHOTS}/25-inventory-warehouses.png` })
  })

  test('it works on a phone, which is where scanning happens', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openInventory(page)

    await page.getByTestId('uat-scan-input').fill(CEMENT)
    await page.getByTestId('uat-scan-submit').click()
    await expect(page.getByTestId('uat-scan-result')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `the scan page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(2)

    await page.screenshot({ path: `${SHOTS}/26-inventory-mobile.png` })
  })
})
