import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, SHOTS, signIn } from './support'

/**
 * Purchase orders.
 *
 * The module had no interface at all until now — everything below was
 * reachable only over the API. What is worth testing hardest is the lifecycle:
 * an order has three states and shows one word, and the actions offered are
 * only the ones legal from where it actually is.
 *
 * Screenshots land under test-results (see SHOTS in support.ts).
 */


async function withApi<T>(
  fn: (client: APIRequestContext, token: string) => Promise<T>,
  who: 'pm' | 'procurement' = 'pm',
) {
  const client = await apiClient()
  try {
    return await fn(client, await apiToken(client, who))
  } finally {
    await client.dispose()
  }
}

/** Raises an order to drive the lifecycle through, so runs stay independent. */
async function raiseOrder(projectId: string) {
  return withApi(async (client, token) => {
    const { body: activities } = await apiGet(client, `/projects/${projectId}/activities`, token)
    const rows = Array.isArray(activities?.data) ? activities.data : activities?.data?.items || []
    const activityId = rows[0]?.id
    expect(activityId, 'the project has no activities').toBeTruthy()

    const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toUpperCase()
    const ref = `PO-LC-${stamp}`
    const response = await client.post(
      `${API}/projects/${projectId}/procurement/purchase-orders`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: {
          ref,
          item: 'Lifecycle test order',
          supplier: 'Riverstone Cement',
          status: 'draft',
          requiredBy: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          lines: [
            {
              activityId,
              itemCode: `LC-${stamp}`,
              description: 'Ready-mix concrete C40/50',
              unit: 'm3',
              orderedQty: 40,
              unitCost: 120,
            },
          ],
        },
      },
    )
    expect(response.status(), await response.text()).toBe(201)
    const created = (await response.json()).data
    return { ref, id: created.id ?? created.order?.id }
  })
}

const orderPath = (projectId: string, orderId: string) =>
  `/projects/${projectId}/purchase-orders/${orderId}`

async function readOrder(projectId: string, orderId: string) {
  return withApi(async (client, token) => {
    const { body } = await apiGet(client, orderPath(projectId, orderId), token)
    return body.data
  })
}

async function move(
  projectId: string,
  orderId: string,
  action: string,
  data: Record<string, unknown> = {},
) {
  return withApi(async (client, token) => {
    const response = await client.post(`${API}${orderPath(projectId, orderId)}/${action}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    })
    return { status: response.status(), body: await response.json() }
  })
}

async function openProcurement(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}/procurement/purchase-orders`)
  await expect(page.getByTestId('uat-purchase-orders')).toBeVisible({ timeout: 30_000 })
}

test.describe('purchase orders', () => {
  test('the register opens with the orders and what is waiting on you', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await openProcurement(page, projectId)

    const register = page.getByTestId('uat-purchase-orders')
    await expect(register).toContainText('PO value')
    await expect(register).toContainText('Waiting on you')
    // Seeded orders are there to look at.
    await expect(register.locator('tbody tr').first()).toBeVisible()

    await page.screenshot({ path: `${SHOTS}/31-purchase-orders.png`, fullPage: true })
  })

  test('an order walks request → approval → issue → acknowledgement', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const { ref, id } = await raiseOrder(projectId)

    // Approval cannot be skipped.
    const skipped = await move(projectId, id, 'issue')
    expect(skipped.status).toBe(409)
    expect(skipped.body.error.code).toBe('PO_TRANSITION_INVALID')

    expect((await move(projectId, id, 'submit')).status).toBe(200)
    expect((await readOrder(projectId, id)).lifecycleStatus).toBe('pending_approval')

    expect((await move(projectId, id, 'approve')).status).toBe(200)
    expect((await move(projectId, id, 'issue')).status).toBe(200)

    const acknowledged = await move(projectId, id, 'acknowledge', {
      acknowledgedRef: 'RC-ACK-9001',
    })
    expect(acknowledged.status).toBe(200)

    const order = await readOrder(projectId, id)
    expect(order.lifecycleStatus).toBe('acknowledged')
    expect(order.acknowledgedRef).toBe('RC-ACK-9001')

    // And it reads that way on screen.
    await openProcurement(page, projectId)
    await page.getByTestId('uat-po-search').fill(ref)
    await page.getByTestId(`uat-po-row-${ref}`).click()
    const detail = page.getByTestId('uat-po-detail')
    await expect(detail).toBeVisible()
    await expect(page.getByTestId('uat-po-detail-status')).toContainText('Acknowledged')
    await expect(detail).toContainText('RC-ACK-9001')
  })

  test('sending an order back says what needs to change', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const { ref, id } = await raiseOrder(projectId)
    await move(projectId, id, 'submit')

    // A rejection with no reason is refused, because "no" without a reason is
    // not an instruction.
    const bare = await move(projectId, id, 'reject')
    expect(bare.status).toBe(400)
    expect(bare.body.error.code).toBe('PO_REJECT_REASON_REQUIRED')

    expect((await move(projectId, id, 'reject', { reason: 'Rate is above the quote' })).status).toBe(
      200,
    )

    await openProcurement(page, projectId)
    await page.getByTestId('uat-po-search').fill(ref)
    await page.getByTestId(`uat-po-row-${ref}`).click()
    await expect(page.getByTestId('uat-po-sent-back')).toContainText('Rate is above the quote')
  })

  test('the value is the lines plus tax, never a typed total', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const { id } = await raiseOrder(projectId)

    const before = await readOrder(projectId, id)
    // 40 m3 at 120.
    expect(before.subtotal).toBeCloseTo(4800, 2)
    expect(before.value).toBeCloseTo(4800, 2)

    await withApi(async (client, token) => {
      const response = await client.patch(`${API}${orderPath(projectId, id)}`, {
        headers: { authorization: `Bearer ${token}` },
        data: { taxRate: 5 },
      })
      expect(response.status(), await response.text()).toBe(200)
    })

    const after = await readOrder(projectId, id)
    expect(after.taxAmount).toBeCloseTo(240, 2)
    expect(after.value).toBeCloseTo(5040, 2)
  })

  test('an order out with the supplier can no longer be edited', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const { id } = await raiseOrder(projectId)
    await move(projectId, id, 'submit')
    await move(projectId, id, 'approve')
    await move(projectId, id, 'issue')

    const edited = await withApi(async (client, token) => {
      const response = await client.patch(`${API}${orderPath(projectId, id)}`, {
        headers: { authorization: `Bearer ${token}` },
        data: { item: 'Something else entirely' },
      })
      return { status: response.status(), body: await response.json() }
    })
    expect(edited.status).toBe(409)
    expect(edited.body.error.code).toBe('PO_LOCKED')
  })

  test('closing short is refused unless forced and explained', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    const { id } = await raiseOrder(projectId)
    await move(projectId, id, 'submit')
    await move(projectId, id, 'approve')
    await move(projectId, id, 'issue')

    const bare = await move(projectId, id, 'close')
    expect(bare.status).toBe(409)
    expect(bare.body.error.code).toBe('PO_CLOSE_OUTSTANDING')

    const forced = await move(projectId, id, 'close', { force: true })
    expect(forced.status).toBe(400)
    expect(forced.body.error.code).toBe('PO_CLOSE_REASON_REQUIRED')

    const closed = await move(projectId, id, 'close', {
      force: true,
      reason: 'Balance no longer required',
    })
    expect(closed.status).toBe(200)
    expect((await readOrder(projectId, id)).lifecycleStatus).toBe('closed')
  })

  test('a delivered order reads as delivered, not as issued', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await openProcurement(page, projectId)

    // PO-0002 in the seed is fully received.
    const orders = await withApi(async (client, token) => {
      const { body } = await apiGet(client, `/projects/${projectId}/purchase-orders`, token)
      return body.data.items
    })
    // The seeded PO-0002 first; otherwise any fully received order that is still
    // open. A received order that was closed afterwards reads "closed", which is
    // its own state and not what this case is about.
    type Listed = { ref: string; warehouseStatus: string; lifecycleStatus: string }
    const received =
      orders.find((order: Listed) => order.ref === 'PO-0002' && order.warehouseStatus === 'received') ??
      orders.find(
        (order: Listed) =>
          order.warehouseStatus === 'received' &&
          !(['closed', 'cancelled'] as string[]).includes(order.lifecycleStatus),
      )
    test.skip(!received, 'no fully received, still-open order on this project')

    // Delivery beats the commercial state, and billing beats delivery.
    expect(['delivered', 'partially_invoiced', 'fully_invoiced']).toContain(
      received.lifecycleStatus,
    )
  })

  test('suppliers are listed with what they are approved for', async ({ page }) => {
    await signIn(page)
    const projectId = await openProject(page)
    await page.goto(`/projects/${projectId}/procurement/suppliers`)

    const panel = page.getByTestId('uat-procurement-suppliers')
    await expect(panel).toBeVisible({ timeout: 30_000 })
    await expect(panel).toContainText('Riverstone Cement')
  })
})
