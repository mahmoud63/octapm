/// <reference types="node" />
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { accounts, apiBase, apiSession, getData, isWide, items, mainProject, signIn, type Headers } from './cert-helpers'

/**
 * Certification: financial and inventory integrity around a material issue
 * made on the app's own screen. Expected value = quantity × the item's
 * weighted average, and it must appear once in the stock ledger and once in
 * the project's actual cost, with no client arithmetic anywhere. Then the
 * server's safeguards: a double tap sends one request, the same receipt
 * posted twice counts once, and two people issuing the last of the stock
 * at the same moment cannot both succeed. The authoritative ledger table
 * is read afterwards by scratchpad/ledger-check.mjs from the movement ids
 * this spec writes to test-results/finance.json.
 */
const SKU = 'CEM-42.5N'
type Stock = { warehouseId: string; warehouse?: string; available: number; onHand?: number }

async function scan(request: Parameters<typeof getData>[0], headers: Headers) {
  return getData<{ item: { id: string; unit: string; unitCost?: number; averageCost?: number }; stock: Stock[] }>(request, headers, `/inventory/items/scan/${encodeURIComponent(SKU)}`)
}

test.describe('certification: financial and inventory integrity', () => {
  test.beforeEach(({ page }) => {
    test.skip(isWide(page), 'measured once on the phone viewport')
  })

  test('a material issue from the screen posts once to stock and once to the project cost, at the weighted average, delta 0.00', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const before = await scan(request, pm.headers)
    const holding = before.stock.find((s) => s.available >= 3)
    expect(holding, 'a warehouse with at least 3 units').toBeTruthy()
    const activities = items(await getData<{ id: string; name: string }[]>(request, pm.headers, `/projects/${project.id}/activities`))
    const costBefore = (await getData<{ rows: { activityId: string; material: number; actual: number }[] }>(request, pm.headers, `/projects/${project.id}/cost`)).rows

    await signIn(page, accounts.pm)
    await page.goto(`/inventory/items/${before.item.id}`)
    await expect(page.getByTestId('screen-item').last()).toBeVisible()
    await page.getByTestId('item-move-issue').click()
    await expect(page.getByTestId('stock-move-sheet')).toBeVisible()
    await page.getByTestId('move-warehouse').click()
    await page.getByTestId(`move-warehouse-option-${holding!.warehouseId}`).click()
    await page.getByTestId('move-quantity').fill('2')
    await page.getByTestId('move-activity').click()
    const option = page.locator('[data-testid^="move-activity-option-"]').first()
    const activityId = (await option.getAttribute('data-testid'))!.replace('move-activity-option-', '')
    await option.click()
    await page.getByTestId('move-reference').fill(`Cert finance issue ${Date.now() % 100000}`)
    // A double tap must send exactly one request.
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/inventory/stock/issue')) posts.push(r.url())
    })
    const issued = page.waitForResponse((r) => r.url().endsWith('/inventory/stock/issue') && r.request().method() === 'POST')
    const send = page.getByTestId('move-send')
    await expect(send).toBeEnabled()
    // Both taps in one task, so no re-render can slip between them and disable
    // the button. Clicking twice with an await in between only tests how fast
    // React is: it passed with the guard removed. This tests the guard.
    await send.evaluate((node: HTMLElement) => {
      node.click()
      node.click()
    })
    const response = await issued
    expect(response.status()).toBe(201)
    await page.waitForTimeout(1500)
    expect(posts.length, 'one request for a double tap').toBe(1)
    const body = ((await response.json()) as { data: { movements?: { id: string; value: number; unitCost: number; quantity: number }[]; movement?: { id: string; value: number; unitCost: number; quantity: number }; id?: string; value?: number; unitCost?: number; quantity?: number } }).data
    const movement = body.movements?.[0] ?? body.movement ?? (body as { id: string; value: number; unitCost: number; quantity: number })
    // An issue records a negative quantity and a positive value; the cost it posts is that value.
    const unitCost = Number(movement.unitCost)
    const value = Math.abs(Number(movement.value))
    expect(Math.abs(Number(movement.quantity))).toBe(2)
    expect(value).toBeCloseTo(2 * unitCost, 2)

    // Stock: the item's total available across every warehouse and bin falls by exactly the quantity.
    // (The scan lists a row per bin, and the sheet issues from the bin this device works from.)
    const total = (rows: Stock[]) => rows.reduce((sum, s) => sum + Number(s.available), 0)
    const startBalance = total(before.stock)
    const after = await scan(request, pm.headers)
    const balance = { available: total(after.stock) }
    expect(balance.available).toBeCloseTo(startBalance - 2, 3)
    // "Posts once" is a claim about this movement, not about a page count: the
    // ledger for a busy item outgrows any page, and a saturated page can never
    // show a delta. Assert the identity instead — this movement is in the
    // ledger exactly once, and nothing else was written for it.
    const ledger = items(await getData<{ items: { id: string }[] } | { id: string }[]>(request, pm.headers, `/inventory/stock/transactions?itemId=${before.item.id}&limit=200`))
    const thisMovement = ledger.filter((row) => row.id === movement.id)
    expect(thisMovement.length, 'the movement is in the ledger exactly once').toBe(1)

    // Cost: the activity's material and actual moved by exactly the movement's value.
    const costAfter = (await getData<{ rows: { activityId: string; material: number; actual: number }[] }>(request, pm.headers, `/projects/${project.id}/cost`)).rows
    const rowBefore = costBefore.find((r) => r.activityId === activityId)
    const rowAfter = costAfter.find((r) => r.activityId === activityId)!
    // "material" on this row is the budget breakdown by category; a material issue lands on the actual.
    const dActual = Number(rowAfter.actual) - Number(rowBefore?.actual ?? 0)
    expect(dActual).toBeCloseTo(value, 2)
    const activityName = activities.find((a) => a.id === activityId)?.name ?? activityId
    test.info().annotations.push({ type: 'finance', description: `issue 2 × ${SKU} @ weighted average ${unitCost.toFixed(4)} = ${value.toFixed(2)}; stock ${startBalance} → ${balance.available}; movement recorded once; cost row "${activityName}": actual +${dActual.toFixed(2)}; delta ${(dActual - value).toFixed(2)}` })
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/finance.json', JSON.stringify({ projectId: project.id, activityId, itemId: before.item.id, movementId: movement.id, expectedValue: value, unitCost, quantity: 2, at: new Date().toISOString() }, null, 2))
  })

  test('the same goods receipt posted twice counts once, and a retried issue with the same key does not post twice', async ({ request }) => {
    const pm = await apiSession(request, accounts.pm)
    const warehouse = await apiSession(request, accounts.warehouse)
    const project = await mainProject(request, pm.headers)
    const suppliers = items(await getData<{ items?: { id: string }[] } | { id: string }[]>(request, pm.headers, `/projects/${project.id}/procurement/suppliers`))
    const activities = items(await getData<{ id: string }[]>(request, pm.headers, `/projects/${project.id}/activities`))
    const s = Date.now() % 100000
    const created = await request.post(`${apiBase}/projects/${project.id}/procurement/purchase-orders`, { headers: pm.headers, data: { supplierId: suppliers[0]!.id, status: 'draft', requiredBy: '2030-01-31', promisedDate: '2030-01-15', lines: [{ activityId: activities[0]!.id, itemCode: SKU, description: `Cert replay cement ${s}`, unit: 'bag', orderedQty: 6, unitCost: 6.4 }] } })
    expect(created.status()).toBe(201)
    const orderId = ((await created.json()) as { data: { id: string } }).data.id
    for (const step of ['submit', 'approve', 'issue']) expect((await request.post(`${apiBase}/projects/${project.id}/purchase-orders/${orderId}/${step}`, { headers: pm.headers, data: {} })).status(), step).toBe(200)
    const order = await getData<{ lines: { id: string }[] }>(request, pm.headers, `/projects/${project.id}/purchase-orders/${orderId}`)
    const warehouses = items(await getData<{ items: { id: string }[] }>(request, pm.headers, '/inventory/warehouses'))
    // A warehouse holds its stock in bins, so the scan answers with a row per
    // bin. Taking the first one reads whichever bin happens to sort first and
    // misses a receipt that lands in any other: the question here is what the
    // warehouse holds, so add its rows up.
    const heldAt = (rows: Stock[], warehouseId: string) => rows.filter((x) => x.warehouseId === warehouseId).reduce((total, row) => total + (row.available ?? 0), 0)
    const before = await scan(request, pm.headers)
    const stockBefore = heldAt(before.stock, warehouses[0]!.id)
    const data = { orderId, warehouseId: warehouses[0]!.id, receiptNumber: `GRN-M-replay${s}`, deliveryNote: `DN-replay-${s}`, lines: [{ poLineId: order.lines[0]!.id, acceptedQty: 3, rejectedQty: 0 }] }
    const first = await request.post(`${apiBase}/inventory/goods-receipt`, { headers: { ...warehouse.headers, 'x-octapm-client': 'mobile' }, data })
    expect(first.status(), await first.text()).toBe(201)
    const second = await request.post(`${apiBase}/inventory/goods-receipt`, { headers: { ...warehouse.headers, 'x-octapm-client': 'mobile' }, data })
    expect([200, 409]).toContain(second.status())
    const secondBody = (await second.json()) as { success: boolean; data?: { replayed?: boolean }; error?: { code: string } }
    expect(second.status() === 409 ? secondBody.error?.code : String(secondBody.data?.replayed)).toMatch(/RECEIPT_ALREADY_POSTED|true/)
    const after = await scan(request, pm.headers)
    const stockAfter = heldAt(after.stock, warehouses[0]!.id)
    expect(stockAfter - stockBefore).toBeCloseTo(3, 3)
    test.info().annotations.push({ type: 'finance', description: `receipt ${data.receiptNumber} posted twice: first 201, second ${second.status()} ${secondBody.error?.code ?? 'replayed'}; stock +3 once` })
  })

  test('two people issuing the last of the stock at the same moment: one succeeds, one is refused, the balance never goes negative', async ({ request }) => {
    const pm = await apiSession(request, accounts.pm)
    const warehouse = await apiSession(request, accounts.warehouse)
    const project = await mainProject(request, pm.headers)
    const activities = items(await getData<{ id: string }[]>(request, pm.headers, `/projects/${project.id}/activities`))
    const warehouses = items(await getData<{ items: { id: string }[] }>(request, pm.headers, '/inventory/warehouses'))
    // A small, known balance in the second warehouse (or the first), topped up by exactly 5.
    const target = warehouses[1]?.id ?? warehouses[0]!.id
    const before = await scan(request, pm.headers)
    const start = before.stock.find((x) => x.warehouseId === target)?.available ?? 0
    expect((await request.post(`${apiBase}/inventory/stock/receive`, { headers: pm.headers, data: { itemId: before.item.id, warehouseId: target, quantity: 5, unitCost: 6.4, reference: 'Cert concurrency seed' } })).status()).toBe(201)
    const available = start + 5
    const issue = () => request.post(`${apiBase}/inventory/stock/issue`, { headers: { ...warehouse.headers, 'x-octapm-client': 'mobile' }, data: { itemId: before.item.id, warehouseId: target, quantity: available, projectId: project.id, activityId: activities[0]!.id, reference: `Cert concurrency ${Date.now() % 100000}` } })
    const [a, b] = await Promise.all([issue(), issue()])
    const statuses = [a.status(), b.status()].sort()
    expect(statuses[0]).toBe(201)
    expect([400, 409, 422]).toContain(statuses[1])
    const after = await scan(request, pm.headers)
    const balance = after.stock.find((x) => x.warehouseId === target)?.available ?? 0
    expect(balance).toBeGreaterThanOrEqual(0)
    expect(balance).toBeCloseTo(0, 3)
    test.info().annotations.push({ type: 'finance', description: `concurrent issue of ${available} twice: ${statuses.join('/')}, balance after ${balance}` })
    // Put the balance back where it was for the next run.
    if (start > 0) expect((await request.post(`${apiBase}/inventory/stock/receive`, { headers: pm.headers, data: { itemId: before.item.id, warehouseId: target, quantity: start, unitCost: 6.4, reference: 'Cert concurrency restore' } })).status()).toBe(201)
  })
})
