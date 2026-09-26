import { test, expect } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, signIn } from './support'
import { cachedToken, observe } from './support-ux'

type OrderLine = { orderedQty?: number | string; receivedQty?: number | string }
type Order = { ref: string; lines?: OrderLine[] }

/**
 * What the storeman is told after a delivery.
 *
 * Posting a receipt used to raise a toast — "GRN-00052 posted" — and take the
 * answer away with it. The next questions are always what was accepted, what
 * is still to come, and how much is now in the shed, and none of them were on
 * the screen (OCTA-UX-RECEIPT-100).
 */
test('a posted delivery says what it did', async ({ page }) => {
  test.slow()
  await signIn(page, 'warehouse')
  const projectId = await openProject(page)

  // Find an order with something still outstanding, through the API, so the
  // test is about the result surface and not about finding a fixture.
  const client = await apiClient()
  const orderRef = await (async () => {
    try {
      const token = await cachedToken('wh-receipt', () => apiToken(client, 'warehouse'))
      const { body } = await apiGet(
        client,
        `/projects/${projectId}/purchase-orders?status=issued`,
        token,
      )
      const orders: Order[] = body?.data?.items ?? body?.data ?? []
      const found = orders.find((order) =>
        (order.lines ?? []).some(
          (line) => Number(line.orderedQty) > Number(line.receivedQty ?? 0),
        ),
      )
      expect(found, 'an order with an outstanding line exists').toBeTruthy()
      expect(API).toBeTruthy()
      return found?.ref ?? ''
    } finally {
      await client.dispose()
    }
  })()

  await page.goto(`/inventory?tab=receive&orderRef=${encodeURIComponent(orderRef)}`)
  await expect(page.getByTestId('uat-po-result')).toBeVisible({ timeout: 30_000 })

  // Accept one of whatever the first outstanding line is.
  const qty = page.locator('input[data-testid^="uat-receipt-accepted-"]').first()
  await expect(qty).toBeVisible({ timeout: 15_000 })
  await qty.fill('1')

  const postButton = page.getByTestId('uat-receipt-post')
  await expect(postButton).toBeEnabled({ timeout: 15_000 })
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/goods-receipt'),
      { timeout: 30_000 },
    ),
    postButton.click(),
  ])

  const result = page.getByTestId('uat-receipt-result')
  await expect(result, 'the delivery reports back on screen').toBeVisible({ timeout: 30_000 })
  const text = (await result.innerText()).replace(/\s+/g, ' ').trim()
  observe('RECEIPT_RESULT', text.slice(0, 240))

  // The four things a storeman asks next.
  expect(text, 'names the receipt').toMatch(/GRN-\d+/)
  expect(text, 'names the warehouse').toMatch(/warehouse/i)
  expect(text, 'says where the order now stands').toMatch(/part-delivered|fully received/)
  for (const heading of ['Accepted', 'Rejected', 'Still to come', 'On hand']) {
    expect(text, `reports ${heading}`).toContain(heading)
  }
  await expect(page.getByTestId('uat-receipt-to-stock')).toBeVisible()
})
