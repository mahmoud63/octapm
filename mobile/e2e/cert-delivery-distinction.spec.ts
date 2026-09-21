import { expect, test, type APIRequestContext } from '@playwright/test'
import { accounts, apiBase, apiSession, getData, isWide, items, mainProject, type Headers } from './cert-helpers'

const SKU = 'CEM-42.5N'
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

interface Stock {
  warehouseId: string
  available: number
}

const scan = (request: APIRequestContext, headers: Headers) =>
  getData<{ item: { id: string }; stock: Stock[] }>(request, headers, `/inventory/items/scan/${encodeURIComponent(SKU)}`)

/** A warehouse holds stock in bins, so the question "what does it hold" is the sum of its rows. */
const heldAt = (rows: Stock[], warehouseId: string) => rows.filter((r) => r.warehouseId === warehouseId).reduce((total, row) => total + (row.available ?? 0), 0)

const actualFor = async (request: APIRequestContext, headers: Headers, projectId: string, activityId: string) => {
  const cost = await getData<{ rows: { activityId: string; actual: number }[] }>(request, headers, `/projects/${projectId}/cost`)
  return Number(cost.rows.find((r) => r.activityId === activityId)?.actual ?? 0)
}

/**
 * Certification: what a delivery is, and what it is not.
 *
 * A site engineer writing "a truck arrived with 300 bags" has recorded an
 * observation. It is not three hundred bags in controlled stock, and it is
 * certainly not three hundred bags of cost against the job. The storekeeper
 * counts them, rejects what is broken and says which warehouse they went in —
 * that receipt is what moves stock. Cost waits until the material is issued to
 * the work, at the weighted average, which is the only point money moves.
 *
 * This walks all three steps in order and checks the two things that must not
 * happen as carefully as the one that must.
 */
test.describe('certification: an observed delivery is not a receipt, and a receipt is not a cost', () => {
  test.beforeEach(({ page }) => {
    test.skip(isWide(page), 'API-level; runs once on the phone viewport')
  })

  test('observed on site changes nothing; the receipt moves stock; only the issue moves money', async ({ request }) => {
    const pm = await apiSession(request, accounts.pm)
    const store = await apiSession(request, accounts.warehouse)
    const project = await mainProject(request, pm.headers)
    const stamp = Date.now() % 100000
    const activities = items(await getData<{ id: string; name: string }[]>(request, pm.headers, `/projects/${project.id}/activities`))
    const activity = activities[0]!
    const warehouses = items(await getData<{ items: { id: string }[] }>(request, pm.headers, '/inventory/warehouses'))
    const warehouseId = warehouses[0]!.id
    const suppliers = items(await getData<{ id: string }[]>(request, pm.headers, `/projects/${project.id}/procurement/suppliers`))

    // An order to deliver against.
    const created = await request.post(`${apiBase}/projects/${project.id}/procurement/purchase-orders`, {
      headers: pm.headers,
      data: { supplierId: suppliers[0]!.id, status: 'draft', requiredBy: '2030-01-31', promisedDate: '2030-01-15', lines: [{ activityId: activity.id, itemCode: SKU, description: `Cert distinction cement ${stamp}`, unit: 'bag', orderedQty: 300, unitCost: 6.4 }] },
    })
    expect(created.status(), await created.text()).toBe(201)
    const orderId = ((await created.json()) as { data: { id: string } }).data.id
    for (const step of ['submit', 'approve', 'issue']) {
      expect((await request.post(`${apiBase}/projects/${project.id}/purchase-orders/${orderId}/${step}`, { headers: pm.headers, data: {} })).status(), step).toBe(200)
    }
    const order = await getData<{ ref: string; lines: { id: string }[] }>(request, pm.headers, `/projects/${project.id}/purchase-orders/${orderId}`)

    const stockAtStart = heldAt((await scan(request, pm.headers)).stock, warehouseId)
    const actualAtStart = await actualFor(request, pm.headers, project.id, activity.id)

    // ── 1. The site engineer records what they saw ───────────────────────────
    const observed = await request.post(`${apiBase}/projects/${project.id}/daily-logs/${localDay()}/entries/deliveries`, {
      headers: pm.headers,
      data: { supplierName: 'Cert Distinction Supplies', description: `Cert distinction delivery ${stamp}`, quantity: 300, unit: 'bag', poRef: order.ref, clientRequestId: `cert-observed-${stamp}` },
    })
    expect(observed.status(), await observed.text()).toBe(201)

    const log = await getData<{ totals: { deliveries: number } }>(request, pm.headers, `/projects/${project.id}/daily-logs/${localDay()}`)
    expect(log.totals.deliveries, 'the day records the delivery it saw').toBeGreaterThanOrEqual(1)

    // The two things that must NOT have happened.
    expect(heldAt((await scan(request, pm.headers)).stock, warehouseId), 'an observation moves no stock').toBeCloseTo(stockAtStart, 3)
    expect(await actualFor(request, pm.headers, project.id, activity.id), 'an observation moves no money').toBeCloseTo(actualAtStart, 2)

    // ── 2. The storekeeper counts them in: 290 good, 10 damaged ──────────────
    const receipt = await request.post(`${apiBase}/inventory/goods-receipt`, {
      headers: { ...store.headers, 'x-octapm-client': 'mobile' },
      data: { orderId, warehouseId, receiptNumber: `GRN-M-dist${stamp}`, deliveryNote: `DN-dist-${stamp}`, lines: [{ poLineId: order.lines[0]!.id, acceptedQty: 290, rejectedQty: 10 }] },
    })
    expect(receipt.status(), await receipt.text()).toBe(201)

    const stockAfterReceipt = heldAt((await scan(request, pm.headers)).stock, warehouseId)
    expect(stockAfterReceipt - stockAtStart, 'the accepted quantity, and only that, reaches stock').toBeCloseTo(290, 3)
    // The rule this whole test exists to hold: receiving stock is not spending.
    expect(await actualFor(request, pm.headers, project.id, activity.id), 'a receipt is an asset movement, not a cost').toBeCloseTo(actualAtStart, 2)

    const afterReceipt = await getData<{ warehouseStatus: string }>(request, pm.headers, `/projects/${project.id}/purchase-orders/${orderId}`)
    expect(['partial', 'received'], 'the order knows it was delivered against').toContain(afterReceipt.warehouseStatus)

    // ── 3. Issuing to the work is where the money moves ──────────────────────
    const item = (await scan(request, pm.headers)).item
    const issued = await request.post(`${apiBase}/inventory/stock/issue`, {
      headers: { ...store.headers, 'x-octapm-client': 'mobile' },
      data: { itemId: item.id, warehouseId, quantity: 20, projectId: project.id, activityId: activity.id, reference: `Cert distinction issue ${stamp}`, clientRequestId: `cert-issue-${stamp}` },
    })
    expect(issued.status(), await issued.text()).toBe(201)
    const movement = ((await issued.json()) as { data: { movements?: { value: number }[]; movement?: { value: number }; value?: number } }).data
    const value = Number((movement.movements?.[0] ?? movement.movement ?? (movement as { value: number })).value)

    expect(heldAt((await scan(request, pm.headers)).stock, warehouseId) - stockAfterReceipt, 'the issue leaves stock').toBeCloseTo(-20, 3)
    const actualAtEnd = await actualFor(request, pm.headers, project.id, activity.id)
    const delta = actualAtEnd - actualAtStart - value
    expect(delta, 'the cost of the issue, and not a penny else').toBeCloseTo(0, 2)

    test.info().annotations.push({
      type: 'finance',
      description: `observed 300 (stock +0, cost +0) · receipt accepted 290 rejected 10 (stock +${(stockAfterReceipt - stockAtStart).toFixed(0)}, cost +0) · issued 20 at weighted average = ${value.toFixed(2)} (cost +${(actualAtEnd - actualAtStart).toFixed(2)}); delta ${delta.toFixed(2)}`,
    })
  })
})
