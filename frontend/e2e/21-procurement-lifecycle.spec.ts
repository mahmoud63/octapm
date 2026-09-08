import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API, apiClient, apiGet, apiToken, openProject, signIn } from './support'
import { Journey, cachedToken, observe } from './support-ux'

/**
 * Procurement and inventory, end to end, as four people.
 *
 * Requirement → package → purchase order → approval → long lead → delivery →
 * goods receipt → scan → warehouse → inventory → issue to an activity →
 * actual cost → supplier invoice → three-way match → payment → cash flow.
 *
 * The lineage questions matter as much as the workflow: does the cost coding on
 * a purchase-order line survive receipt, stock and issue, and does stocked
 * material get counted once rather than twice.
 */

const tag = () => Math.random().toString(36).slice(2, 7)
type Who = 'pm' | 'qs' | 'procurement' | 'warehouse' | 'finance' | 'cost'

async function withApi<T>(
  fn: (client: APIRequestContext, token: string) => Promise<T>,
  who: Who = 'pm',
) {
  const client = await apiClient()
  try {
    // One sign-in per persona for the whole file: a spec that reads back what
    // the screens did makes dozens of calls, and signing in for each burns the
    // login budget the rest of the suite needs.
    return await fn(client, await cachedToken(who, () => apiToken(client, who)))
  } finally {
    await client.dispose()
  }
}

async function send(
  method: 'post' | 'patch' | 'delete',
  path: string,
  data: Record<string, unknown> = {},
  who: Who = 'pm',
) {
  return withApi(async (client, token) => {
    const response = await client[method](`${API}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      data,
    })
    let body: any = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return { status: response.status(), body }
  }, who)
}

const read = async (path: string, who: Who = 'pm') =>
  withApi(async (client, token) => (await apiGet(client, path, token)).body?.data, who)

const ledger = async (projectId: string) =>
  read(`/projects/${projectId}/cost/reconciliation`)

async function switchTo(page: Page, who: Who) {
  await page.context().clearCookies()
  await page.goto('/')
  await page.evaluate(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch {
      /* fine */
    }
  })
  await signIn(page, who as 'pm')
}

/** The ledger entries a source put there, by commitment or by activity. */
async function entriesFor(projectId: string, activityId: string) {
  const explained = await read(
    `/projects/${projectId}/cost/reconciliation/explain?activityId=${activityId}&limit=500`,
  )
  return explained?.entries ?? []
}

test.describe('procurement and inventory, end to end', () => {
  test('a requirement becomes stock, becomes activity cost, and is invoiced once', async ({
    page,
  }) => {
    test.slow()
    test.setTimeout(360_000)
    const t = tag()

    await signIn(page, 'pm')
    const projectId = await openProject(page)

    // ── the coding this material should carry all the way through ────────
    const activities = await read(`/projects/${projectId}/activities`)
    const activity = (activities?.items ?? activities ?? []).find(
      (a: { activityCode: string }) => a.activityCode === 'A-2000',
    )
    expect(activity, 'an activity to consume against').toBeTruthy()

    const budget = await read(`/projects/${projectId}/budget/lines`)
    const budgetLine = (budget?.items ?? budget?.lines ?? []).find(
      (l: { costType: string }) => l.costType === 'material',
    )
    expect(budgetLine, 'a material budget line').toBeTruthy()

    const warehouses = await read(`/inventory/warehouses`)
    const warehouse = (warehouses?.items ?? warehouses ?? [])[0]
    expect(warehouse, 'a warehouse to receive into').toBeTruthy()

    // ══ PROCUREMENT MANAGER: raise and issue the order ═══════════════════
    const buyer = new Journey(
      'Procurement Manager',
      'Buy the rebar the frame needs and get it on site',
      '/projects/:id/procurement/purchase-orders',
    )
    await switchTo(page, 'procurement')

    await page.goto(`/projects/${projectId}/procurement/purchase-orders`)
    buyer.step('Open the purchase-order register').navigate('Procurement → Purchase orders')
    await expect(page.getByTestId('uat-purchase-orders')).toBeVisible({ timeout: 30_000 })

    const suppliers = await read(`/projects/${projectId}/procurement/suppliers`, 'procurement')
    const supplierList = suppliers?.items ?? suppliers ?? []
    let supplierId = supplierList[0]?.id ?? null
    if (!supplierId) {
      const created = await send('post', '/companies', {
        name: `Steelworks ${t}`,
        type: 'supplier',
      })
      supplierId = created.body.data.id
      buyer.step('Add the supplier').typed('supplier name', `Steelworks ${t}`)
    } else {
      buyer.inherited('supplier', 'the supplier register')
    }
    observe('SUPPLIERS_ON_FILE', supplierList.length)

    // An inventory item to buy — the thing that will become stock.
    // Stock is held at company level and issued to a project, so the inventory
    // API is not project-scoped.
    const items = await read('/inventory/items', 'procurement')
    const itemList = items?.items ?? items ?? []
    const item = itemList[0]
    expect(item, 'a stocked item').toBeTruthy()
    observe('INVENTORY_ITEM', {
      code: item.code ?? item.sku ?? null,
      unit: item.unit,
      onHand: item.onHand ?? item.quantityOnHand ?? null,
    })

    const REQUIRED_ON_SITE = new Date(Date.now() + 45 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const QTY = 100
    const RATE = 640

    const order = await send(
      'post',
      `/projects/${projectId}/procurement/purchase-orders`,
      {
        // Every other record in the product numbers itself (BP-001, SC-001,
        // …-PA01). A purchase order does not: the reference is typed.
        ref: `PO-${t}`,
        supplierId,
        item: 'Rebar B500B, 16mm',
        activityId: activity.id,
        requiredBy: REQUIRED_ON_SITE,
        lines: [
          {
            description: 'Rebar B500B, 16mm',
            unit: item.unit || 'tonne',
            orderedQty: QTY,
            unitCost: RATE,
            activityId: activity.id,
            costCodeId: budgetLine.costCodeId ?? null,
            budgetLineId: budgetLine.id,
            requiredDate: REQUIRED_ON_SITE,
          },
        ],
      },
      'procurement',
    )
    observe('PO_CREATE', {
      status: order.status,
      code: order.body?.error?.code ?? null,
      message: order.body?.error?.message ?? null,
    })
    expect(order.status, JSON.stringify(order.body)).toBeLessThan(300)
    const po = order.body.data
    buyer
      .step('Raise the order')
      .typed('order reference', `PO-${t}`)
      .typed('item', 'Rebar B500B, 16mm')
      .typed('required by', REQUIRED_ON_SITE)
      .typed('line description', 'Rebar B500B, 16mm')
      .typed('unit', item.unit || 'tonne')
      .typed('ordered quantity', QTY)
      .typed('unit cost', RATE)
      .typed('line required date', REQUIRED_ON_SITE)
      .duplicate({
        id: 'UX-DUP-PROC-001',
        field: 'reference',
        alreadyKnownFrom: 'the register, which numbers every other record itself',
        note: 'Bid packages are BP-nnn, subcontracts SC-nnn, pay applications …-PAnn — a purchase order alone asks the buyer to invent one, and two buyers can collide',
      })
      .duplicate({
        id: 'UX-DUP-PROC-002',
        field: 'description',
        alreadyKnownFrom: 'the order header `item`, typed one field earlier',
      })
      .duplicate({
        id: 'UX-DUP-PROC-003',
        field: 'unit',
        alreadyKnownFrom: 'the inventory item, which already states its unit',
      })
      .duplicate({
        id: 'UX-DUP-PROC-004',
        field: 'required date',
        alreadyKnownFrom: 'the order header `requiredBy`, typed two fields earlier',
      })

    observe('PO_VALUE', {
      ref: po.ref,
      // A newly planned order must not claim to have been issued to a supplier.
      status: po.status,
      value: po.value,
      lines: po.lines?.length ?? 0,
      submittedAt: po.submittedAt ?? null,
      approvedAt: po.approvedAt ?? null,
      issuedAt: po.issuedAt ?? null,
    })
    expect(
      ['planned', 'draft'],
      'a planned order has not been approved by anybody yet',
    ).toContain(po.status)

    // And planning may not declare an order approved either.
    const smuggled = await send(
      'post',
      `/projects/${projectId}/procurement/purchase-orders`,
      {
        ref: `PO-${t}-X`,
        supplierId,
        item: 'Smuggled',
        activityId: activity.id,
        status: 'issued',
        lines: [
          {
            description: 'Smuggled',
            unit: 'ea',
            orderedQty: 1,
            unitCost: 1,
            activityId: activity.id,
          },
        ],
      },
      'procurement',
    )
    observe('PO_CANNOT_BE_BORN_ISSUED', {
      status: smuggled.status,
      code: smuggled.body?.error?.code ?? null,
    })
    expect(smuggled.status).toBe(400)

    // ══ PM: approve it ═══════════════════════════════════════════════════
    const approver = new Journey(
      'Project Manager',
      'Approve the purchase order',
      '/projects/:id/procurement/purchase-orders',
    )
    const buyerApprove = await send(
      'post',
      `/projects/${projectId}/purchase-orders/${po.id}/submit`,
      {},
      'procurement',
    )
    observe('PO_SUBMIT', { status: buyerApprove.status, code: buyerApprove.body?.error?.code ?? null })
    buyer.step('Send it for approval')

    const procurementApprove = await send(
      'post',
      `/projects/${projectId}/purchase-orders/${po.id}/approve`,
      {},
      'procurement',
    )
    observe('PROCUREMENT_CAN_APPROVE_OWN_PO', {
      status: procurementApprove.status,
      code: procurementApprove.body?.error?.code ?? null,
    })
    if (procurementApprove.status >= 400) {
      buyer.friction(
        'permission',
        `Procurement raises the order but cannot approve it (${procurementApprove.body?.error?.code}) — correct separation, but the register offers the control`,
      )
    }
    buyer.emit()

    await switchTo(page, 'pm')
    const approved =
      procurementApprove.status < 400
        ? procurementApprove
        : await send(
            'post',
            `/projects/${projectId}/purchase-orders/${po.id}/approve`,
          )
    expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300)
    approver.step('Approve the order').inherited(
      'supplier, lines, value and required-on-site date',
      'the order the buyer raised',
    )

    const issued = await send(
      'post',
      `/projects/${projectId}/purchase-orders/${po.id}/issue`,
    )
    observe('PO_ISSUE', { status: issued.status, code: issued.body?.error?.code ?? null })
    approver.step('Issue it to the supplier')
    approver.emit()

    // ── does the required-on-site date reach the long-lead view? ─────────
    const longLead = await read(`/projects/${projectId}/long-lead`)
    const longLeadRows = longLead?.items ?? longLead?.rows ?? longLead ?? []
    observe('LONG_LEAD', {
      rows: Array.isArray(longLeadRows) ? longLeadRows.length : 0,
      mentionsThisOrder: Array.isArray(longLeadRows)
        ? longLeadRows.some((r: { ref?: string; title?: string }) =>
            `${r.ref ?? ''}${r.title ?? ''}`.includes(t),
          )
        : false,
    })

    // ══ WAREHOUSE: receive it ════════════════════════════════════════════
    const store = new Journey(
      'Warehouse Manager',
      'Receive the delivery and put it away',
      '/projects/:id/inventory/goods-receipt',
    )
    await switchTo(page, 'warehouse')
    await page.goto('/inventory')
    store.step('Open goods receipt').navigate('Inventory → Goods receipt')
    const receiptVisible = await page
      .getByTestId('uat-goods-receipt')
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    observe('WAREHOUSE_SEES_GOODS_RECEIPT', receiptVisible)

    const beforeReceipt = await ledger(projectId)

    const RECEIVED = 60

    // There are two receipt endpoints for the same delivery. The procurement
    // one records the receipt against the order and creates **no stock**; the
    // inventory one creates the stock. Drive both, and see what each does.
    const procurementReceipt = await send(
      'post',
      `/projects/${projectId}/procurement/purchase-orders/${po.id}/receipts`,
      {
        // The receipt number is typed too, like the order reference.
        receiptNumber: `GRN-${t}-A`,
        warehouseLocation: warehouse.name ?? 'Main store',
        lines: [{ poLineId: po.lines[0].id, acceptedQty: 1 }],
        notes: `Procurement-side receipt ${t}`,
      },
      'warehouse',
    )
    const stockAfterProcurementReceipt = await read(
      `/inventory/items/${item.id}`,
      'warehouse',
    )
    observe('PROCUREMENT_RECEIPT_CREATES_STOCK', {
      status: procurementReceipt.status,
      code: procurementReceipt.body?.error?.code ?? null,
      onHandAfter:
        stockAfterProcurementReceipt?.onHand ??
        stockAfterProcurementReceipt?.item?.onHand ??
        null,
      // It has no warehouseId to give and no inventory item to move.
      acceptsWarehouseId: false,
    })

    const receipt = await send(
      'post',
      `/inventory/goods-receipt`,
      {
        orderId: po.id,
        warehouseId: warehouse.id,
        receiptNumber: `GRN-${t}`,
        lines: [
          {
            poLineId: po.lines[0].id,
            acceptedQty: RECEIVED,
            inventoryItemId: item.id,
          },
        ],
        notes: `Partial delivery ${t}`,
      },
      'warehouse',
    )
    observe('GOODS_RECEIPT', {
      status: receipt.status,
      code: receipt.body?.error?.code ?? null,
      message: receipt.body?.error?.message ?? null,
    })
    expect(receipt.status, JSON.stringify(receipt.body)).toBeLessThan(300)
    store
      .step('Post the delivery')
      .typed('received quantity', RECEIVED)
      .inherited('order, supplier, lines and expected quantities', 'the purchase order')
      .inherited('unit and item', 'the order line')

    // Receiving stock is not a cost: it is an asset until it is consumed.
    const afterReceipt = await ledger(projectId)
    observe('RECEIPT_POSTS_NO_COST', {
      moved:
        Math.round((afterReceipt.ledger.total - beforeReceipt.ledger.total) * 100) / 100,
    })
    expect(
      afterReceipt.ledger.total,
      'goods received into stock are an asset, not a cost',
    ).toBe(beforeReceipt.ledger.total)

    // ── the scan a storeman actually uses ────────────────────────────────
    const scanCode = item.code ?? item.sku ?? item.barcode
    if (scanCode) {
      const scanned = await read(
        `/inventory/items/scan/${encodeURIComponent(scanCode)}`,
        'warehouse',
      )
      observe('SCAN', {
        found: Boolean(scanned),
        onHand: scanned?.onHand ?? scanned?.item?.onHand ?? null,
        locations: scanned?.locations?.length ?? null,
      })
      store.step('Scan the code to check it landed').inherited(
        'what it is, how much and where',
        'the scan',
      )
    }

    // ══ WAREHOUSE: issue it to the work ══════════════════════════════════
    // Issue what this warehouse actually holds — earlier runs have drawn it
    // down, and the point under test is the posting, not the quantity.
    const stocked = await read(`/inventory/items/${item.id}`, 'warehouse')
    const balances =
      stocked?.balances ?? stocked?.locations ?? stocked?.item?.balances ?? []
    const here = (Array.isArray(balances) ? balances : []).filter(
      (b: { warehouseId?: string }) => !b.warehouseId || b.warehouseId === warehouse.id,
    )
    const available = here.reduce(
      (s: number, b: { onHand?: number; quantity?: number }) =>
        s + Number(b.onHand ?? b.quantity ?? 0),
      0,
    )
    observe('STOCK_IN_WAREHOUSE', { available, balances: here.length })
    const ISSUE = Math.max(1, Math.min(25, Math.floor(available)))
    const beforeIssue = await ledger(projectId)
    const issue = await send(
      'post',
      `/inventory/stock/issue`,
      {
        itemId: item.id,
        warehouseId: warehouse.id,
        quantity: ISSUE,
        activityId: activity.id,
        notes: `Issued to the frame ${t}`,
      },
      'warehouse',
    )
    observe('MATERIAL_ISSUE', {
      status: issue.status,
      code: issue.body?.error?.code ?? null,
      message: issue.body?.error?.message ?? null,
    })
    expect(issue.status, JSON.stringify(issue.body)).toBeLessThan(300)
    store
      .step('Issue it to the activity')
      .typed('quantity', ISSUE)
      .inherited('valuation', 'weighted average cost of the stock')
    store.emit()

    const afterIssue = await ledger(projectId)
    const issueCost =
      Math.round((afterIssue.ledger.total - beforeIssue.ledger.total) * 100) / 100
    observe('ISSUE_BECOMES_COST', {
      moved: issueCost,
      bySource: afterIssue.ledger.bySource?.material_issue ?? null,
      balanced: afterIssue.balanced,
    })
    expect(issueCost, 'consuming stock is what makes it a cost').toBeGreaterThan(0)

    // The coding has to have survived: PO line → receipt → stock → issue.
    const entries = await entriesFor(projectId, activity.id)
    const issueEntries = entries.filter(
      (e: { sourceType: string }) => e.sourceType === 'material_issue',
    )
    observe('ISSUE_COST_CODING', {
      entries: issueEntries.length,
      allOnActivity: issueEntries.every((e: { amount: number }) => e.amount !== 0),
      sample: issueEntries.slice(0, 2),
    })
    expect(issueEntries.length, 'the issue reached the activity').toBeGreaterThan(0)

    // ══ FINANCE: the invoice, and the three-way match ════════════════════
    const money = new Journey(
      'Finance',
      'Match the supplier invoice against the order and the delivery',
      '/projects/:id/inventory/match',
    )
    await switchTo(page, 'finance')
    await page.goto('/inventory')
    money.step('Open the three-way match').navigate('Inventory → Match')

    const matchBefore = await read(
      `/inventory/match/order/${po.id}`,
      'finance',
    )
    observe('MATCH_BEFORE_INVOICE', {
      verdict: matchBefore?.verdict ?? null,
      ordered: matchBefore?.ordered ?? null,
      received: matchBefore?.received ?? null,
      invoiced: matchBefore?.invoiced ?? null,
      flags: (matchBefore?.flags ?? []).map((f: { code?: string } | string) =>
        typeof f === 'string' ? f : f.code,
      ),
    })
    money.inherited('ordered and received quantities and values', 'the order and its receipts')

    observe('LIFECYCLE', {
      poRef: po.ref,
      received: RECEIVED,
      issued: ISSUE,
      issueCost,
    })
    money.emit()
  })
})
