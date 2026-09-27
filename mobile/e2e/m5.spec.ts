import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { currentProjectId, openModule } from './cert-helpers'

/**
 * M5 on the web target: scan, issue, goods receipt against a purchase order
 * with the device's receipt number, a transfer dispatched and received, and
 * the ledger. Writes go to the dedicated end-to-end organisation only.
 */
const email = process.env.E2E_WRITE_EMAIL ?? 'pm@octapm-e2e.test'
const password = process.env.E2E_WRITE_PASSWORD ?? 'DemoPassw0rd!'
const apiBase = process.env.MOBILE_API_URL ?? 'http://localhost:5000/api/v1'
const SKU = 'CEM-42.5N'

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByTestId('sign-in-email').fill(email)
  await page.getByTestId('sign-in-password').fill(password)
  await page.getByTestId('sign-in-submit').click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  const first = page.locator('[data-testid^="choose-"], [data-testid="freshness"]').first()
  await first.waitFor({ state: 'visible' })
  if ((await first.getAttribute('data-testid'))?.startsWith('choose-')) {
    await first.click()
    await expect(page.getByTestId('freshness').first()).toBeVisible()
  }
}

async function apiSession(request: APIRequestContext) {
  const login = await request.post(`${apiBase}/auth/login`, { headers: { 'x-octapm-client': 'mobile' }, data: { email, password } })
  const session = (await login.json()) as { data: { user: { id: string }; tokens: { accessToken: string } } }
  return { userId: session.data.user.id, headers: { authorization: `Bearer ${session.data.tokens.accessToken}`, 'x-octapm-client': 'mobile' } }
}

type Stock = { warehouseId: string; warehouse: string; available: number }

/** The cement item and a warehouse that holds at least `need` of it, topped up through the direct receipt route when empty. */
async function stockedWarehouse(request: APIRequestContext, headers: Record<string, string>, need: number) {
  const scan = await request.get(`${apiBase}/inventory/items/scan/${encodeURIComponent(SKU)}`, { headers })
  expect(scan.status()).toBe(200)
  const { item, stock } = ((await scan.json()) as { data: { item: { id: string; unit: string }; stock: Stock[] } }).data
  const holding = stock.find((s) => s.available >= need)
  if (holding) return { item, warehouseId: holding.warehouseId, warehouse: holding.warehouse }
  const warehouses = await request.get(`${apiBase}/inventory/warehouses`, { headers })
  const first = ((await warehouses.json()) as { data: { items: { id: string; name: string }[] } }).data.items[0]!
  const topUp = await request.post(`${apiBase}/inventory/stock/receive`, { headers, data: { itemId: item.id, warehouseId: first.id, quantity: 100, unitCost: 6.4, reference: 'E2E seed' } })
  expect(topUp.status()).toBe(201)
  return { item, warehouseId: first.id, warehouse: first.name }
}

const openInventory = async (page: Page) => {
  await openModule(page, 'inventory')
  await expect(page.getByTestId('screen-inventory')).toBeVisible()
}

test.describe('M5 on the web target', () => {
  test('a typed code resolves to the item, and stock is issued to an activity once through the issue route', async ({ page, request }) => {
    const { headers } = await apiSession(request)
    const { item, warehouseId } = await stockedWarehouse(request, headers, 5)
    await signIn(page)
    await openInventory(page)
    await page.getByTestId('inventory-scan').click()
    await expect(page.getByTestId('screen-scan')).toBeVisible()
    await page.getByTestId('scan-code').fill(SKU)
    await page.getByTestId('scan-lookup').click()
    await expect(page.getByTestId('scan-hit')).toBeVisible()
    await page.getByTestId('scan-open').click()
    await expect(page.getByTestId('screen-item')).toBeVisible()
    await expect(page.getByTestId('item-header')).toContainText(SKU)

    await page.getByTestId('item-move-issue').click()
    await expect(page.getByTestId('stock-move-sheet')).toBeVisible()
    await page.getByTestId('move-warehouse').click()
    await page.getByTestId(`move-warehouse-option-${warehouseId}`).click()
    await page.getByTestId('move-quantity').fill('1')
    await page.getByTestId('move-activity').click()
    await page.locator('[data-testid^="move-activity-option-"]').first().click()
    await page.getByTestId('move-reference').fill(`E2E issue ${Date.now() % 100000}`)
    const issued = page.waitForResponse((r) => r.url().endsWith('/inventory/stock/issue') && r.request().method() === 'POST')
    await page.getByTestId('move-send').click()
    const response = await issued
    expect(response.status()).toBe(201)
    const sent = response.request().postDataJSON() as { itemId: string; warehouseId: string; quantity: number; activityId: string }
    expect(sent.itemId).toBe(item.id)
    expect(sent.warehouseId).toBe(warehouseId)
    expect(sent.quantity).toBe(1)
    expect(sent.activityId).toBeTruthy()
    await expect(page.getByTestId('item-notice')).toContainText('Issue to site')
  })

  test('a delivery is received against a fresh purchase order with a receipt number the server then treats as already posted', async ({ page, request }) => {
    const { headers } = await apiSession(request)
    await signIn(page)
    const projectId = await currentProjectId(page)
    // A fresh order each run, through the procurement routes as the same person: draft, submit, approve, issue.
    const suppliers = await request.get(`${apiBase}/projects/${projectId}/procurement/suppliers`, { headers })
    const supplier = ((await suppliers.json()) as { data: { items?: { id: string }[] } | { id: string }[] }).data
    const supplierId = (Array.isArray(supplier) ? supplier[0] : supplier.items?.[0])!.id
    const activities = await request.get(`${apiBase}/projects/${projectId}/activities`, { headers })
    const activityId = ((await activities.json()) as { data: { id: string }[] }).data[0]!.id
    const stamp = Date.now() % 100000
    const created = await request.post(`${apiBase}/projects/${projectId}/procurement/purchase-orders`, {
      headers,
      data: { supplierId, status: 'draft', requiredBy: '2030-01-31', promisedDate: '2030-01-15', lines: [{ activityId, itemCode: SKU, description: `E2E cement ${stamp}`, unit: 'bag', orderedQty: 10, unitCost: 6.4 }] },
    })
    expect(created.status()).toBe(201)
    const orderId = ((await created.json()) as { data: { id: string } }).data.id
    for (const step of ['submit', 'approve', 'issue']) {
      const moved = await request.post(`${apiBase}/projects/${projectId}/purchase-orders/${orderId}/${step}`, { headers, data: {} })
      expect(moved.status(), step).toBe(200)
    }

    await openInventory(page)
    await page.getByTestId('inventory-receive').click()
    await expect(page.getByTestId('screen-goods-in')).toBeVisible()
    await page.getByTestId('goods-in-search').fill(`E2E cement ${stamp}`)
    await page.getByTestId(`po-row-${orderId}`).click()
    await expect(page.getByTestId('screen-receive')).toBeVisible()
    await page.getByTestId('receipt-start').click()
    const accepted = page.locator('[data-testid^="receipt-accepted-"]').first()
    await expect(accepted).toHaveValue('10')
    await accepted.fill('8')
    await page.locator('[data-testid^="receipt-rejected-"]').first().fill('2')
    await page.getByTestId('receipt-warehouse').click()
    await page.locator('[data-testid^="receipt-warehouse-option-"]').first().click()
    await page.getByTestId('receipt-delivery-note').fill(`DN-E2E-${stamp}`)
    const receiptNumber = ((await page.getByTestId('receipt-number').textContent()) ?? '').replace('Receipt ', '').trim()
    expect(receiptNumber).toMatch(/^GRN-M-[A-Z0-9]{10}$/)
    const posted = page.waitForResponse((r) => r.url().endsWith('/inventory/goods-receipt') && r.request().method() === 'POST')
    await page.getByTestId('receipt-post').click()
    const response = await posted
    expect(response.status()).toBe(201)
    const sent = response.request().postDataJSON() as { receiptNumber: string; lines: { acceptedQty?: number; rejectedQty?: number }[] }
    expect(sent.receiptNumber).toBe(receiptNumber)
    expect(sent.lines[0]).toMatchObject({ acceptedQty: 8, rejectedQty: 2 })
    await expect(page.getByTestId('receipt-posted')).toContainText('Received')

    // The same number again is the replay case the app treats as done: the server refuses it as already posted.
    const again = await request.post(`${apiBase}/inventory/goods-receipt`, { headers, data: response.request().postDataJSON() })
    expect(again.status()).toBe(409)
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('RECEIPT_ALREADY_POSTED')
  })

  test('a transfer is drafted, dispatched and received line by line, and the ledger shows the movements', async ({ page, request }) => {
    const { headers } = await apiSession(request)
    const { item, warehouseId } = await stockedWarehouse(request, headers, 5)
    await signIn(page)
    await openInventory(page)
    await page.getByTestId('inventory-transfers').click()
    await expect(page.getByTestId('screen-transfers')).toBeVisible()
    await page.getByTestId('transfer-new').click()
    await expect(page.getByTestId('screen-transfer-new')).toBeVisible()
    await page.getByTestId('transfer-from').click()
    await page.getByTestId(`transfer-from-option-${warehouseId}`).click()
    await page.getByTestId('transfer-to').click()
    await page.locator('[data-testid^="transfer-to-option-"]').first().click()
    await page.getByTestId('transfer-item-0').click()
    await page.getByTestId(`transfer-item-0-option-${item.id}`).click()
    await page.getByTestId('transfer-qty-0').fill('2')
    await page.getByTestId('transfer-reason').fill(`E2E transfer ${Date.now() % 100000}`)
    const created = page.waitForResponse((r) => r.url().endsWith('/inventory/transfers') && r.request().method() === 'POST')
    await page.getByTestId('transfer-create').click()
    expect((await created).status()).toBe(201)
    await expect(page.getByTestId('screen-transfer')).toBeVisible()
    await expect(page.getByTestId('transfer-header')).toContainText('Draft')

    const dispatched = page.waitForResponse((r) => r.url().endsWith('/dispatch') && r.request().method() === 'POST')
    await page.getByTestId('action-dispatch').click()
    expect((await dispatched).status()).toBe(200)
    await expect(page.getByTestId('transfer-header')).toContainText('In transit')
    await page.getByTestId('action-receive').click()
    const received = page.locator('[data-testid^="transfer-received-"]').first()
    await expect(received).toHaveValue('2')
    await received.fill('1')
    await page.locator('[data-testid^="transfer-damaged-"]').first().fill('1')
    const done = page.waitForResponse((r) => r.url().endsWith('/receive') && r.request().method() === 'POST')
    await page.getByTestId('transfer-receive-confirm').click()
    const response = await done
    expect(response.status()).toBe(200)
    expect((response.request().postDataJSON() as { lines: { receivedQty: number; damagedQty?: number }[] }).lines[0]).toMatchObject({ receivedQty: 1, damagedQty: 1 })
    await expect(page.getByTestId('transfer-header')).toContainText('Received')

    await page.goto('/inventory/movements')
    await expect(page.getByTestId('screen-movements')).toBeVisible()
    await page.getByTestId('movements-chip-transfer_out').click()
    await expect(page.locator('[data-testid^="movement-"]').first()).toContainText('Transfer out')
  })
})
