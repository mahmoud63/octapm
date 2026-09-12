import { test, expect, type APIRequestContext } from '@playwright/test'
import { API, PEOPLE, apiClient, apiToken, signIn } from './support'

/**
 * The permanent greenfield regression (Phase 21C).
 *
 * Every run builds a brand-new project through the API — nothing pre-seeded
 * beyond the demo identities, their roles and the plan — and drives the
 * connected spine across the personas whose job each step is:
 *
 *   PM          creates the project and its team, approves what needs approving
 *   planner     plans two activities and allocates the bill to one of them
 *   QS          prices the bill, raises the change
 *   cost        sets the budget
 *   procurement buys the cement; warehouse stores it, then issues it
 *
 * and then checks the money the way the Phase 21 drive did: stock is an
 * asset, not a cost, until it is issued; the ledger, the budget projection
 * and the activity projection agree to the cent; an approved change lands in
 * the Revised Budget and nowhere on the ledger. Finally the PM sees the same
 * figures in the browser.
 *
 * Harness rules: every non-2xx is an error with status and code (no
 * null-on-failure helpers); tokens come from `apiToken`, which re-mints well
 * inside the 15-minute expiry; records are read by id, never by "the first
 * page happens to contain it"; nothing is swallowed. The project is retired
 * at the end and the run FAILS if that retirement fails, so the plan
 * allowance cannot leak silently. Two back-to-back runs must both pass: the
 * stamp makes every code unique and nothing here depends on a prior run.
 */

type Who = keyof typeof PEOPLE
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete'
type Refusal = { status: number; code: string | null; message: string | null }
/** A record as the API hands it back: whatever keys, read field by field. */
type Row = Record<string, unknown>
type Envelope = {
  data?: unknown
  error?: { code?: string; message?: string; details?: unknown }
} | null

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const num = (v: unknown) => Number(v ?? 0)
const cents = (v: unknown) => Math.round(num(v) * 100)
const row = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {})
const rows = (x: unknown): Row[] => {
  const r = row(x)
  const list = r.rows ?? r.items ?? r.orders ?? r.allocations ?? r.lines ?? (Array.isArray(x) ? x : [])
  return Array.isArray(list) ? list.map(row) : []
}

const createdProjects: string[] = []
let client: APIRequestContext

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase()
const TAG = `GR-${stamp}`

async function request(who: Who, method: Method, path: string, data?: unknown): Promise<{ status: number; body: Envelope }> {
  const token = await apiToken(client, who)
  const response = await client[method](`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(data === undefined ? {} : { data }),
  })
  const body: Envelope = await response.json().catch(() => null)
  return { status: response.status(), body }
}

/** A call that must succeed; anything else is an error that says why. */
async function call(who: Who, method: Method, path: string, data?: unknown): Promise<Row> {
  const { status, body } = await request(who, method, path, data)
  if (status < 200 || status >= 300) {
    throw new Error(
      `${who} ${method.toUpperCase()} ${path} -> ${status} ${body?.error?.code ?? ''}: ${body?.error?.message ?? ''} ${JSON.stringify(body?.error?.details ?? '').slice(0, 300)}`,
    )
  }
  return row(body?.data)
}

/** A call whose refusal is the point. */
async function probe(who: Who, method: Method, path: string, data?: unknown): Promise<Refusal> {
  const { status, body } = await request(who, method, path, data)
  return { status, code: body?.error?.code ?? null, message: body?.error?.message ?? null }
}

/**
 * Live (unarchived) projects the organisation is paying for on its plan —
 * every page of them, never just the first.
 */
async function activeProjectCount(): Promise<number> {
  let cursor: string | null = null
  let active = 0
  for (let page = 0; page < 50; page += 1) {
    const list = await call('pm', 'get', `/projects?limit=100&includeArchived=true${cursor ? `&cursor=${cursor}` : ''}`)
    active += rows(list).filter((p) => !p.archivedAt && p.status !== 'archived').length
    cursor = str(row(list.pagination).nextCursor) || null
    if (!cursor) return active
  }
  throw new Error('more than 5,000 projects? the allowance walk gave up')
}

const ledgerOf = (recon: Row) => {
  const ledger = row(recon.ledger)
  return {
    ledger: cents(ledger.total),
    entries: num(ledger.entries),
    bySource: Object.fromEntries(Object.entries(row(ledger.bySource)).map(([k, v]) => [k, cents(v)])),
    budgetProjection: cents(row(recon.budget).recordedTotal),
    activityProjection: cents(row(recon.activity).recordedTotal),
    balanced: Boolean(recon.balanced),
  }
}

test.beforeAll(async () => {
  client = await apiClient()
})

test.afterAll(async () => {
  // Retire what this run created. DELETE soft-archives (sets archivedAt),
  // which is what the plan allowance counts. A failure here is a failure of
  // the run — printed AND thrown — never a silent leak.
  const failures: string[] = []
  for (const projectId of createdProjects) {
    const { status, body } = await request('pm', 'delete', `/projects/${projectId}`)
    if (status < 200 || status >= 300) failures.push(`${projectId}: ${status} ${body?.error?.code ?? ''}`)
  }
  await client.dispose()
  if (failures.length) {
    // eslint-disable-next-line no-console
    console.log(`CLEANUP FAILED: ${failures.join('; ')}`)
    throw new Error(`greenfield regression could not retire its project(s): ${failures.join('; ')}`)
  }
})

/** What one run collects as it goes: ids and references, by name. */
type Ctx = {
  activeBefore: number
  projectId: string
  projectName: string
  userIds: Record<string, string>
  costCodes: Record<string, string>
  activities: Record<string, string>
  boqItemId: string
  allocationId: string
  budgetLines: Record<string, string>
  supplierId: string
  warehouseId: string
  binId: string
  itemId: string
  orderId: string
  orderRef: string
  receiptNumber: string
  changeOrderId: string
  changeRef: string
}

test.describe.serial('greenfield regression — a project built from nothing, every run', () => {
  const ctx = {} as Ctx

  test('the connected spine, from a new project to a reconciled ledger', async () => {
    test.slow()

    await test.step('plan allowance before', async () => {
      ctx.activeBefore = await activeProjectCount()
    })

    await test.step('PM: a new project and its team', async () => {
      const project = await call('pm', 'post', '/projects', {
        name: `GREENFIELD REGRESSION ${stamp}`,
        code: TAG,
        type: 'building',
        contractType: 'unit_rate',
        startDate: '2027-01-04',
        endDate: '2027-12-17',
        currency: 'USD',
        contractValue: 500_000,
        defaultRetentionRate: 5,
        status: 'active',
      })
      expect(project.id, 'project created').toBeTruthy()
      createdProjects.push(str(project.id))
      ctx.projectId = str(project.id)
      ctx.projectName = str(project.name)

      const assignable = await call('pm', 'get', `/projects/${ctx.projectId}/team/assignable`)
      const byEmail = new Map(rows(assignable).map((u) => [str(u.email), u]))
      const TEAM: Record<Exclude<Who, 'pm'>, string> = {
        planner: 'planning_eng', qs: 'qs', cost: 'cost_controller', procurement: 'procurement', warehouse: 'warehouse', site: 'site_engineer', finance: 'finance',
      }
      ctx.userIds = {}
      for (const who of Object.keys(TEAM) as Array<Exclude<Who, 'pm'>>) {
        const candidate = byEmail.get(PEOPLE[who].email)
        expect(candidate, `${PEOPLE[who].email} is assignable`).toBeTruthy()
        const userId = str(candidate?.userId)
        const added = await call('pm', 'post', `/projects/${ctx.projectId}/team`, { userId, role: TEAM[who] })
        expect(added.assignmentRole).toBe(TEAM[who])
        ctx.userIds[who] = userId
      }
      // A storeman cannot plan.
      const refused = await probe('warehouse', 'post', `/projects/${ctx.projectId}/activities`, { name: 'x', activityCode: 'X1', duration: 1 })
      expect(refused.status, 'storeman refused on activities').toBe(403)
    })

    const P = () => ctx.projectId

    await test.step('PM: cost codes selected onto the project', async () => {
      const library = await call('pm', 'get', '/company/cost-codes?includeArchived=false')
      const existing = new Map(rows(library).map((c) => [str(c.code), c]))
      ctx.costCodes = {}
      for (const [code, name, category] of [['01-100', 'Site works', 'direct'], ['02-100', 'Concrete supply', 'direct']]) {
        const found = existing.get(code) ?? (await call('pm', 'post', '/company/cost-codes', { code, name, category, status: 'active' }))
        ctx.costCodes[code] = str(found.id)
      }
      const selected = await call('pm', 'put', `/projects/${P()}/budget/cost-codes`, { costCodeIds: Object.values(ctx.costCodes) })
      expect(rows(selected).filter((c) => ctx.costCodes[str(c.code)]).length, 'both codes on the project').toBe(2)
    })

    await test.step('planner: two activities, one after the other', async () => {
      const a100 = await call('planner', 'post', `/projects/${P()}/activities`, {
        name: 'Site clearance', activityCode: 'A100', category: 'civil', duration: 5, isMilestone: false, sortOrder: 0, engineerIds: [ctx.userIds.site],
      })
      const a130 = await call('planner', 'post', `/projects/${P()}/activities`, {
        name: 'Foundation concrete', activityCode: 'A130', category: 'structural', duration: 12, isMilestone: false, sortOrder: 1, engineerIds: [ctx.userIds.site],
        dependencies: [{ predecessorId: a100.id, relationshipType: 'FS', lagDays: 0 }],
      })
      ctx.activities = { A100: str(a100.id), A130: str(a130.id) }
      const list = await call('planner', 'get', `/projects/${P()}/activities?limit=200`)
      expect(rows(list).length, 'exactly the two activities').toBe(2)
    })

    await test.step('QS prices the bill; planner allocates it; PM approves the allocation', async () => {
      const created = await call('qs', 'post', `/projects/${P()}/boq/items`, { code: 'B-002', description: 'Foundation concrete C35', quantity: 800, unit: 'm3', rate: 150 })
      // The create answer wraps the row (`item`) on this endpoint.
      const boqItemId = str(created.id || row(created.item).id)
      expect(boqItemId, `a BOQ item id came back: ${JSON.stringify(created).slice(0, 120)}`).toBeTruthy()
      ctx.boqItemId = boqItemId
      const boq = await call('qs', 'get', `/projects/${P()}/boq`)
      const boqTotal = boq.total ?? row(boq.summary).total ?? rows(boq).reduce((sum, r) => sum + num(r.amount ?? r.total ?? num(r.quantity) * num(r.rate)), 0)
      expect(cents(boqTotal), 'BOQ total 120,000.00').toBe(cents(120_000))
      const alloc = await call('planner', 'post', `/projects/${P()}/activity-boq-allocations`, { boqItemId, activityId: ctx.activities.A130, quantity: 800, amount: 120_000, source: 'manual' })
      await call('planner', 'post', `/projects/${P()}/activity-boq-allocations/${str(alloc.id)}/submit`, {})
      const approved = await call('pm', 'post', `/projects/${P()}/activity-boq-allocations/${str(alloc.id)}/approve`, {})
      expect(str(approved.status || 'approved')).toBe('approved')
      ctx.allocationId = str(alloc.id)
    })

    await test.step('cost controller: the original budget', async () => {
      const l1 = await call('cost', 'post', `/projects/${P()}/budget/lines`, { costCodeId: ctx.costCodes['01-100'], costType: 'labour', description: 'Site works', originalBudget: 50_000, status: 'active' })
      const l2 = await call('cost', 'post', `/projects/${P()}/budget/lines`, { costCodeId: ctx.costCodes['02-100'], costType: 'material', description: 'Concrete supply', originalBudget: 100_000, status: 'active' })
      ctx.budgetLines = { '01-100': str(l1.id), '02-100': str(l2.id) }
      const lines = rows(await call('cost', 'get', `/projects/${P()}/budget/lines`))
      expect(lines.reduce((sum, l) => sum + cents(l.originalBudget), 0), 'original budget 150,000.00').toBe(cents(150_000))
      // A site engineer cannot set a budget.
      expect((await probe('site', 'post', `/projects/${P()}/budget/lines`, { costCodeId: ctx.costCodes['01-100'], costType: 'labour', description: 'x', originalBudget: 1 })).status).toBe(403)
    })

    await test.step('procurement buys 100 bags; the warehouse receives them; the ledger stays at nil', async () => {
      const supplier = await call('procurement', 'post', `/projects/${P()}/procurement/suppliers`, { name: `${TAG} Cement Supply`, code: `SUP-${stamp}`, contactName: 'Rana Haddad', email: `supplier@${stamp.toLowerCase()}.octapm.test`, status: 'approved' })
      const wh = await call('warehouse', 'post', '/inventory/warehouses', { code: `WH-${stamp}`, name: `${TAG} Site Store`, kind: 'site', projectId: P(), address: 'Gate 2' })
      const zone = await call('warehouse', 'post', `/inventory/warehouses/${str(wh.id)}/locations`, { code: 'Z-A', name: 'Zone A', kind: 'zone' })
      const bin = await call('warehouse', 'post', `/inventory/warehouses/${str(wh.id)}/locations`, { code: 'Z-A-B01', name: 'Bin 01', kind: 'bin', parentId: zone.id })
      const item = await call('warehouse', 'post', '/inventory/items', { sku: `CEM-${stamp}`, name: 'Cement OPC 42.5N (50kg bag)', unit: 'bag', category: 'material', projectId: P(), barcode: `BC-${stamp}`, qrCode: `QR-${stamp}`, status: 'active' })
      Object.assign(ctx, { supplierId: str(supplier.id), warehouseId: str(wh.id), binId: str(bin.id), itemId: str(item.id) })

      const order = await call('procurement', 'post', `/projects/${P()}/procurement/purchase-orders`, {
        ref: `PO-${stamp}-A`, supplierId: supplier.id, status: 'draft', currency: 'USD', orderDate: '2027-01-10', requiredBy: '2027-02-01',
        lines: [{ lineNumber: 1, activityId: ctx.activities.A130, costCodeId: ctx.costCodes['02-100'], itemCode: item.sku, description: item.name, unit: 'bag', orderedQty: 100, unitCost: 10, inventoryItemId: item.id }],
      })
      ctx.orderId = str(order.id)
      ctx.orderRef = str(order.ref)
      await call('procurement', 'post', `/projects/${P()}/purchase-orders/${ctx.orderId}/submit`, {})
      // The site engineer may not approve a purchase order; the PM may.
      expect((await probe('site', 'post', `/projects/${P()}/purchase-orders/${ctx.orderId}/approve`, {})).status).toBe(403)
      await call('pm', 'post', `/projects/${P()}/purchase-orders/${ctx.orderId}/approve`, {})
      await call('procurement', 'post', `/projects/${P()}/purchase-orders/${ctx.orderId}/issue`, {})
      const po = await call('procurement', 'get', `/projects/${P()}/purchase-orders/${ctx.orderId}`)
      expect(cents(po.value ?? po.total), 'PO value 1,000.00').toBe(cents(1_000))

      const before = ledgerOf(await call('cost', 'get', `/projects/${P()}/cost/reconciliation`))
      expect(before.ledger, 'a new project has an empty ledger').toBe(0)

      const line = rows(await call('warehouse', 'get', `/inventory/purchase-orders/${ctx.orderId}`))[0]
      const receipt = await call('warehouse', 'post', '/inventory/goods-receipt', {
        orderId: ctx.orderId, warehouseId: wh.id, deliveryNote: `${TAG}-DN-1`,
        lines: [{ poLineId: line.id, acceptedQty: 100, rejectedQty: 0, locationId: bin.id, inventoryItemId: item.id }],
      })
      expect(receipt.receiptNumber, 'a receipt number').toBeTruthy()
      ctx.receiptNumber = str(receipt.receiptNumber)
      const stocked = await call('warehouse', 'get', `/inventory/items/${ctx.itemId}`)
      expect(num(stocked.onHand ?? stocked.stockOnHand ?? stocked.quantity), '100 bags on hand').toBe(100)
      const afterReceipt = ledgerOf(await call('cost', 'get', `/projects/${P()}/cost/reconciliation`))
      expect(afterReceipt.ledger, 'receiving stock is not a project cost').toBe(0)
    })

    await test.step('the warehouse issues 64 bags: cost is recognised at 10.00 each, 640.00', async () => {
      await call('warehouse', 'post', '/inventory/stock/issue', {
        itemId: ctx.itemId, warehouseId: ctx.warehouseId, locationId: ctx.binId, quantity: 64, projectId: P(), activityId: ctx.activities.A130, costCodeId: ctx.costCodes['02-100'], reference: `${TAG}-ISSUE-1`, notes: 'Foundation pour',
      })
      const after = ledgerOf(await call('cost', 'get', `/projects/${P()}/cost/reconciliation`))
      expect(after.ledger, 'ACTUAL COST 640.00').toBe(cents(640))
      expect(after.bySource.material_issue, 'posted as a material issue').toBe(cents(640))
      expect(after.budgetProjection, 'budget projection agrees').toBe(cents(640))
      expect(after.activityProjection, 'activity projection agrees').toBe(cents(640))
      expect(after.balanced, 'reconciliation balanced').toBe(true)
      const line = rows(await call('cost', 'get', `/projects/${P()}/budget/lines`)).find((l) => l.id === ctx.budgetLines['02-100'])
      expect(cents(line?.actual), 'budget line 02-100 shows 640.00 actual').toBe(cents(640))
      const stocked = await call('warehouse', 'get', `/inventory/items/${ctx.itemId}`)
      expect(num(stocked.onHand ?? stocked.stockOnHand ?? stocked.quantity), '36 bags left').toBe(36)
    })

    await test.step('QS raises a 25,000.00 change; PM approves it; Revised Budget moves, the ledger does not', async () => {
      const change = await call('qs', 'post', `/projects/${P()}/change-orders`, {
        description: `${TAG} Additional 150mm excavation at grid A-D`, activityId: ctx.activities.A130, budgetLineId: ctx.budgetLines['02-100'], value: 25_000, scheduleImpact: 3,
      })
      ctx.changeOrderId = str(change.id)
      ctx.changeRef = str(change.ref)
      await call('qs', 'patch', `/projects/${P()}/change-orders/${ctx.changeOrderId}`, {
        budgetLineId: ctx.budgetLines['02-100'],
        scheduleImpactSummary: 'Three working days on A130.',
        costImpactSummary: '25,000.00 on budget line 02-100.',
        activityLinks: [{ activityId: ctx.activities.A130, relationType: 'impacted', scheduleImpactDays: 3, costImpact: 25_000 }],
      })
      const token = await apiToken(client, 'qs')
      const upload = await client.post(`${API}/projects/${P()}/attachments`, {
        headers: { authorization: `Bearer ${token}` },
        multipart: {
          files: { name: `${TAG}-instruction.txt`, mimeType: 'text/plain', buffer: Buffer.from(`Instruction for ${TAG}\n`) },
          recordType: 'change_order', recordId: ctx.changeOrderId, caption: 'Instruction',
        },
      })
      expect(upload.ok(), `attachment upload ${upload.status()}`).toBeTruthy()
      const uploaded = rows(row(await upload.json()).data)
      const documentId = str(uploaded[0]?.documentId ?? uploaded[0]?.id)
      expect(documentId, 'a document id came back').toBeTruthy()
      await call('qs', 'patch', `/projects/${P()}/change-orders/${ctx.changeOrderId}`, { documentIds: [documentId] })
      await call('qs', 'post', `/projects/${P()}/change-orders/${ctx.changeOrderId}/submit`, { comment: 'submit' })
      // The QS may not approve their own change.
      expect((await probe('qs', 'post', `/projects/${P()}/change-orders/${ctx.changeOrderId}/approve`, { comment: 'x' })).status).toBe(403)
      await call('pm', 'post', `/projects/${P()}/change-orders/${ctx.changeOrderId}/approve`, { comment: 'approve' })

      const lines = rows(await call('cost', 'get', `/projects/${P()}/budget/lines`))
      const original = lines.reduce((sum, l) => sum + cents(l.originalBudget), 0)
      const approvedChanges = lines.reduce((sum, l) => sum + cents(l.approvedChanges), 0)
      const revised = lines.reduce((sum, l) => sum + cents(l.revisedBudget), 0)
      expect(original, 'original still 150,000.00').toBe(cents(150_000))
      expect(approvedChanges, 'approved changes 25,000.00').toBe(cents(25_000))
      expect(revised, 'Revised Budget 175,000.00').toBe(cents(175_000))
      const after = ledgerOf(await call('cost', 'get', `/projects/${P()}/cost/reconciliation`))
      expect(after.ledger, 'an approved change is not a cost').toBe(cents(640))
      // Approved is final.
      expect((await probe('pm', 'post', `/projects/${P()}/change-orders/${ctx.changeOrderId}/approve`, { comment: 'again' })).status).toBeGreaterThanOrEqual(400)
    })
  })

  test('the PM sees the same figures in the browser', async ({ page }) => {
    test.slow()
    expect(ctx.projectId, 'the API half of this run built a project').toBeTruthy()
    await signIn(page, 'pm')
    await page.goto(`/projects/${ctx.projectId}/procurement/purchase-orders`)
    await expect(page.getByRole('heading', { name: ctx.projectName })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(ctx.orderRef, { exact: false }).first(), 'the purchase order is on the register').toBeVisible({ timeout: 30_000 })
    await page.goto(`/projects/${ctx.projectId}/commercial/change-orders`)
    await expect(page.getByText(ctx.changeRef, { exact: false }).first(), 'the approved change is on the register').toBeVisible({ timeout: 30_000 })
    await page.goto(`/projects/${ctx.projectId}/cost`)
    await expect(page.getByText(/\$640(\.00)?\b/).first(), 'the 640.00 actual is on the cost overview').toBeVisible({ timeout: 30_000 })
    await page.goto(`/projects/${ctx.projectId}/cost/budget`)
    await expect(page.getByText('Concrete supply').first(), 'the budget line is on the budget page').toBeVisible({ timeout: 30_000 })
  })

  test('the project is retired and the plan allowance is where it was', async () => {
    // Retire now (afterAll would too) so the allowance can be checked inside a test.
    const projectId = ctx.projectId
    const { status, body } = await request('pm', 'delete', `/projects/${projectId}`)
    expect(status, `retire ${projectId}: ${body?.error?.code ?? ''}`).toBeLessThan(300)
    const index = createdProjects.indexOf(projectId)
    if (index >= 0) createdProjects.splice(index, 1)
    const activeAfter = await activeProjectCount()
    expect(activeAfter, 'no plan-allowance leak').toBe(ctx.activeBefore)
    // Retired is a soft archive: the record stays readable, stamped archivedAt, and off the allowance.
    const retired = await call('pm', 'get', `/projects/${projectId}`)
    expect(retired.archivedAt, 'archivedAt is stamped').toBeTruthy()
  })
})
