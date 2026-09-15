import { expect, test, type Page } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, SHOTS, signIn } from './support'

/**
 * Inventory and warehouse.
 *
 * The scan is the thing worth testing hardest: it is what somebody standing in
 * front of a pallet with a phone actually does, and it has to answer "what is
 * this, how much is there and where" before it offers to move anything.
 *
 * Screenshots land under test-results (see SHOTS in support.ts).
 */

const CEMENT = 'CEM-42.5N'

async function openInventory(page: Page, who: 'pm' | 'warehouse' = 'warehouse') {
  await signIn(page, who)
  await page.goto('/inventory')
  await expect(page.getByRole('heading', { name: 'Inventory & warehouse' })).toBeVisible({
    timeout: 30_000,
  })
}

/**
 * What the API says the item holds, for checking the screen against.
 *
 * Answers null for an item that does not exist. That is a real answer while
 * polling for a first delivery to land — the item is created by the receipt —
 * and throwing there would abort the poll instead of retrying it.
 */
async function onHandFromApi(sku: string): Promise<number | null> {
  const client = await apiClient()
  try {
    const token = await apiToken(client, 'warehouse')
    const { body } = await apiGet(client, `/inventory/items/scan/${sku}`, token)
    return (body?.data?.item?.onHand ?? null) as number | null
  } finally {
    await client.dispose()
  }
}

/** The same, for an item that is expected to be on the shelf already. */
async function onHandNow(sku: string): Promise<number> {
  const value = await onHandFromApi(sku)
  expect(value, `no stocked item for ${sku}`).not.toBeNull()
  return value as number
}

/**
 * Raises a purchase order for the receiving test to take a delivery against.
 *
 * The test makes its own rather than eating into a seeded one: a goods receipt
 * cannot be un-posted, so a test that consumed shared data would behave
 * differently on its second run.
 */
async function raisePurchaseOrder(orderedQty: number) {
  const client = await apiClient()
  try {
    const token = await apiToken(client, 'pm')
    const { body: projects } = await apiGet(client, '/projects', token)
    const project = (projects?.data?.items || []).find(
      (candidate: { name: string }) => candidate.name === 'Riverside Tower',
    )
    expect(project, 'the seeded project is missing').toBeTruthy()

    const { body: activities } = await apiGet(client, `/projects/${project.id}/activities`, token)
    const activityRows = Array.isArray(activities?.data)
      ? activities.data
      : activities?.data?.items || []
    const activityId = activityRows[0]?.id
    expect(activityId, 'the seeded project has no activities').toBeTruthy()

    const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
    const ref = `PO-E2E-${stamp}`
    const itemCode = `E2E-TUBE-${stamp}`

    const response = await client.post(
      `${API}/projects/${project.id}/procurement/purchase-orders`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: {
          ref,
          item: 'Scaffold tube for the goods receipt test',
          supplier: 'Riverstone Cement',
          // Submitting an order for approval requires a date it is needed on
          // site — a guard the old `status: 'issued'` shortcut skipped.
          requiredBy: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          // The Match tab lists at most 100 open orders, earliest promised date
          // first and unpromised last (goods-receipt.service.js listOrders,
          // take: 100, sorted on the ORDER's promisedDate). Orders this suite
          // leaves behind pushed a fresh, unpromised order out of that window
          // and the match test timed out looking for its row (Phase 21D). A
          // promised date the product sorts first keeps the order where the
          // tab can show it; the cap itself is P21-022.
          promisedDate: '2020-01-01T00:00:00.000Z',
          lines: [
            {
              activityId,
              itemCode,
              description: 'Scaffold tube 48.3mm',
              unit: 'm',
              orderedQty,
              unitCost: 12.5,
            },
          ],
        },
      },
    )
    expect(response.status(), await response.text()).toBe(201)
    const order = (await response.json()).data

    // A new order is planned; it becomes issuable by being submitted, approved
    // and issued, which is what a delivery arrives against
    // (OCTA-PROC-APPROVAL-067). Setting `status: 'issued'` on creation used to
    // skip all three.
    for (const step of ['submit', 'approve', 'issue']) {
      const moved = await client.post(
        `${API}/projects/${project.id}/purchase-orders/${order.id}/${step}`,
        { headers: { authorization: `Bearer ${token}` }, data: {} },
      )
      expect(moved.status(), `${step}: ${await moved.text()}`).toBe(200)
    }
    return { ref, itemCode }
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
    const expected = await onHandNow(CEMENT)
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
    const before = await onHandNow(CEMENT)

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
      // A return brings its cost back from the activity the bags were issued
      // to (CX21-455): the latest issue movement says which one.
      const { body: moved } = await apiGet(
        client,
        `/inventory/stock/transactions?itemId=${item.id}&type=issue&limit=1`,
        token,
      )
      const movements = Array.isArray(moved?.data) ? moved.data : moved?.data?.items || []
      const activityId = movements[0]?.activityId
      expect(activityId, 'the issue to put back names no activity').toBeTruthy()
      await client.post(`${API}/inventory/stock/return`, {
        headers: { authorization: `Bearer ${token}` },
        data: {
          itemId: item.id,
          warehouseId,
          locationId: body.data.stock[0].locationId,
          quantity: 12,
          activityId,
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

  test('a delivery against a purchase order becomes stock, minus what was rejected', async ({
    page,
  }) => {
    const { ref, itemCode } = await raisePurchaseOrder(100)

    await openInventory(page)
    await page.getByRole('tab', { name: 'Goods in' }).click()

    // The storeman scans the PO off the delivery note.
    const receipt = page.getByTestId('uat-goods-receipt')
    await receipt.getByTestId('uat-scan-input').fill(ref)
    await receipt.getByTestId('uat-scan-submit').click()

    const order = page.getByTestId('uat-po-result')
    await expect(order).toBeVisible()
    await expect(order).toContainText(ref)
    await expect(order).toContainText('Scaffold tube 48.3mm')

    // Nothing has been delivered yet, so the line proposes the full order.
    await expect(page.getByTestId('uat-receipt-accepted-1')).toHaveValue('100')

    // 90 good, 10 damaged and sent back.
    await page.getByTestId('uat-receipt-accepted-1').fill('90')
    await page.getByTestId('uat-receipt-rejected-1').fill('10')
    await page.getByTestId('uat-receipt-note').fill('DN-E2E-1')
    await page.getByTestId('uat-receipt-post').click()

    // Only the 90 that were accepted are stock. The 10 went back on the lorry.
    await expect.poll(() => onHandFromApi(itemCode), { timeout: 20_000 }).toBe(90)

    // And the order now shows the 10 that are still owed.
    await expect(page.getByTestId('uat-receipt-accepted-1')).toHaveValue('10', {
      timeout: 15_000,
    })

    await page.screenshot({ path: `${SHOTS}/27-inventory-goods-receipt.png` })
  })

  test('the match flags an invoice for more than was accepted', async ({ page }) => {
    await openInventory(page)
    await page.getByRole('tab', { name: 'Match' }).click()

    // PO-0002 is the brief's own example: 1,000 ordered, 950 accepted, 50
    // rejected, and a supplier invoice for the full 1,000.
    await page.getByTestId('uat-match-order-PO-0002').click()

    const result = page.getByTestId('uat-match-result')
    await expect(result).toBeVisible()
    await expect(page.getByTestId('uat-match-verdict')).toContainText('Hold for review')

    const row = result.locator('tbody tr').first()
    await expect(row).toContainText('1,000')
    await expect(row).toContainText('950')

    // The flag has to say what is wrong, not merely that something is.
    const flags = page.getByTestId('uat-match-flags').first()
    await expect(flags).toContainText('only 950 were accepted')
    await expect(flags).toContainText('rejected on delivery')

    await page.screenshot({ path: `${SHOTS}/28-inventory-three-way-match.png` })
  })

  test('an order with nothing wrong is reported as matched', async ({ page }) => {
    // A clean order raised and received in full: the match must be able to say
    // "nothing to see here", or its warnings mean nothing.
    const { ref } = await raisePurchaseOrder(40)

    await openInventory(page)
    await page.getByRole('tab', { name: 'Goods in' }).click()
    const receipt = page.getByTestId('uat-goods-receipt')
    await receipt.getByTestId('uat-scan-input').fill(ref)
    await receipt.getByTestId('uat-scan-submit').click()
    await expect(page.getByTestId('uat-po-result')).toBeVisible()
    await page.getByTestId('uat-receipt-post').click()
    await expect(page.getByTestId('uat-receipt-accepted-1')).toHaveValue('', { timeout: 15_000 })

    await page.getByRole('tab', { name: 'Match' }).click()
    // Say why, if the tab cannot show the order, rather than time out on a click.
    const listed = await (async () => {
      const client = await apiClient()
      try {
        const token = await apiToken(client, 'warehouse')
        const { body } = await apiGet(client, '/inventory/purchase-orders?scope=all', token)
        return (body?.data?.items ?? []).some((order: { ref: string }) => order.ref === ref)
      } finally {
        await client.dispose()
      }
    })()
    expect(listed, `${ref} is within the Match tab's 100-order window (P21-022)`).toBe(true)
    await page.getByTestId(`uat-match-order-${ref}`).click()
    await expect(page.getByTestId('uat-match-verdict')).toContainText('Matched')
    await expect(page.getByTestId('uat-match-flags')).toHaveCount(0)
  })

  test('the dashboard names the rows behind every number', async ({ page }) => {
    await openInventory(page)
    await page.getByRole('tab', { name: 'Dashboard' }).click()

    const dashboard = page.getByTestId('uat-inventory-analytics')
    await expect(dashboard).toBeVisible()

    // Value by warehouse, against what the API says the whole store is worth.
    const warehouses = page.getByTestId('uat-analytics-warehouses')
    await expect(warehouses).toContainText('Central Warehouse')
    await expect(warehouses).toContainText('%')

    // Each attention list has to name items, not just count them.
    const attention = page.getByTestId('uat-analytics-attention')
    await expect(attention).toContainText('Polyurethane joint sealant')
    await expect(attention).toContainText('days to replace')

    await page.getByTestId('uat-analytics-tab-outOfStock').click()
    await expect(attention).toContainText('Waterproofing membrane')

    await page.getByTestId('uat-analytics-tab-slowMoving').click()
    await expect(attention).toContainText('Scaffold tube')

    // Ordered against received against used, and the rejected quantity beside
    // them. Checked against what the analytics API reports rather than against
    // seeded literals: any delivery posted by another test moves these figures,
    // and what matters is that the screen shows the same numbers the records do.
    // The variance list is a ranked top-25 (largest |issued − received| first,
    // LIST_LIMIT in inventory-analytics.service.js), not a register: which
    // items are in it depends on every delivery and issue on the store, so no
    // seeded row can be assumed to be there. What the screen owes the reader
    // is that every row the API ranks is shown with the API's own figures —
    // so the rows are taken from the API and each is found by its own name.
    const variance = page.getByTestId('uat-analytics-variance')
    type VarianceRow = { name?: string; itemName?: string; sku?: string; itemCode?: string; ordered?: number; received?: number; rejected?: number }
    const reported: VarianceRow[] = await (async () => {
      const client = await apiClient()
      try {
        const token = await apiToken(client, 'warehouse')
        const { body } = await apiGet(client, '/inventory/analytics', token)
        return body?.data?.variance ?? body?.data?.varianceByItem ?? []
      } finally {
        await client.dispose()
      }
    })()
    expect(reported.length, 'the analytics API ranks at least one variance row').toBeGreaterThan(0)
    for (const row of reported.slice(0, 3)) {
      const name = `${row.name ?? row.itemName ?? ''}`
      expect(name, 'a ranked row is named').toBeTruthy()
      // several items can share a name (every receipt of a line without an item
      // code numbers a new one), so the row is found by its SKU when the API gives one
      const key = `${row.sku ?? row.itemCode ?? ''}` || name
      const shown = variance.locator('tbody tr', { hasText: key }).first()
      await expect(shown, `the screen shows the ranked row "${name}"`).toBeVisible()
      for (const figure of [row.ordered, row.received, row.rejected]) {
        if (figure === undefined || figure === null) continue
        await expect(shown).toContainText(Number(figure).toLocaleString('en-US'))
      }
    }

    // Usage lands on a named activity, not an id.
    await expect(page.getByTestId('uat-analytics-usage')).toContainText(
      'Substructure and raft foundation',
    )

    // A price that has moved across deliveries.
    await expect(page.getByTestId('uat-analytics-prices')).toContainText('Reinforcement bar T16')

    // And what the programme needs that the store cannot cover.
    await expect(page.getByTestId('uat-analytics-needs')).toContainText('Unitised glazing panel')
    const longLead = page.getByTestId('uat-analytics-long-lead')
    await expect(longLead).toContainText('Unitised glazing panel type A')
    // Its order-by date has passed and it has not arrived: that is the point.
    await expect(longLead).toContainText('overdue')

    await page.screenshot({
      path: `${SHOTS}/29-inventory-dashboard.png`,
      fullPage: true,
    })
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
