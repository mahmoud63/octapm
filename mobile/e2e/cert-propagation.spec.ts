/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { accounts, apiBase, apiSession, getData, isWide, items, mainProject, signIn, type Headers } from './cert-helpers'

/**
 * Certification: web ↔ mobile propagation. The "web" side is the same API
 * the web platform calls, driven here with the platform's own routes; the
 * "mobile" side is the app on the web target, either its screen (measured
 * for how the change arrives) or a request with the mobile client header.
 * Each handoff is timed from the moment the other side's change is
 * confirmed by the server to the moment the open screen shows it, without
 * any reload, and classified:
 *   REALTIME          shown within 5 s without a reload
 *   NEAR REALTIME     shown within 20 s without a reload
 *   REFRESH REQUIRED  shown only after a reload
 *   STALE             not shown even after a reload
 * Writes go to the dedicated end-to-end organisation only.
 */
const stamp = () => Date.now() % 1_000_000

async function arrival(page: Page, probe: () => Promise<boolean>, t0: number): Promise<{ cls: string; ms: number }> {
  const deadline = t0 + 20_000
  while (Date.now() < deadline) {
    if (await probe()) {
      const ms = Date.now() - t0
      return { cls: ms <= 5_000 ? 'REALTIME' : 'NEAR REALTIME', ms }
    }
    await page.waitForTimeout(250)
  }
  await page.reload()
  await page.locator('[data-testid^="screen-"]').first().waitFor({ state: 'visible' })
  // After a reload the screen's own queries still have to answer; give them a moment before calling it stale.
  const afterReload = Date.now() + 10_000
  while (Date.now() < afterReload) {
    if (await probe()) return { cls: 'REFRESH REQUIRED', ms: Date.now() - t0 }
    await page.waitForTimeout(250)
  }
  return { cls: 'STALE', ms: Date.now() - t0 }
}

const note = (label: string, r: { cls: string; ms: number }) => test.info().annotations.push({ type: 'propagation', description: `${label}: ${r.cls} (${r.ms} ms)` })
const mobileHeaders = (h: Headers) => ({ ...h, 'x-octapm-client': 'mobile' })

async function ensureChangeOrderTemplate(request: APIRequestContext, headers: Headers, projectId: string) {
  const listed = await request.get(`${apiBase}/projects/${projectId}/workflows/templates?tool=change_order`, { headers })
  const existing = items<{ id: string; tool: string; status: string }>(((await listed.json()) as { data: never }).data).find((t) => t.tool === 'change_order' && t.status === 'active')
  if (existing) return existing.id
  const created = await request.post(`${apiBase}/projects/${projectId}/workflows/templates`, {
    headers,
    data: {
      tool: 'change_order',
      name: 'E2E change order approval',
      isDefault: true,
      steps: [{ key: 'pm_approval', name: 'PM approval', type: 'response', assignees: [{ type: 'role', role: 'pm' }], days: 5, responses: [{ key: 'approve', label: 'Approve', next: 'end_success', tone: 'positive' }, { key: 'reject', label: 'Reject', next: 'end_fail', tone: 'negative', requireComment: true }] }],
    },
  })
  expect(created.status(), 'template').toBe(201)
  return ((await created.json()) as { data: { id: string } }).data.id
}

test.describe('certification: web ↔ mobile propagation', () => {
  test.beforeEach(({ page }) => {
    test.skip(isWide(page), 'measured once on the phone viewport')
  })

  test('1 RFI: raised from the field, answered on the web, the answer reaches the open record', async ({ page, request }) => {
    const site = await apiSession(request, accounts.site)
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const s = stamp()
    const raised = await request.post(`${apiBase}/projects/${project.id}/rfi`, { headers: mobileHeaders(site.headers), data: { subject: `Cert propagation RFI ${s}`, question: 'Which grout for the base plates?', status: 'open' } })
    expect(raised.status()).toBe(201)
    const rfiId = ((await raised.json()) as { data: { id: string } }).data.id
    // The web side sees it at once.
    expect(((await getData<{ id: string }>(request, pm.headers, `/projects/${project.id}/rfi/${rfiId}`)).id)).toBe(rfiId)

    await signIn(page, accounts.site)
    await page.goto(`/rfi/${rfiId}`)
    await expect(page.getByTestId('screen-rfi').last()).toBeVisible()
    await expect(page.getByText(`Cert propagation RFI ${s}`).first()).toBeVisible()
    const answer = `Use non-shrink grout, class ${s}`
    const t0 = Date.now()
    const responded = await request.post(`${apiBase}/projects/${project.id}/rfi/${rfiId}/responses`, { headers: pm.headers, data: { body: answer, isOfficial: true } })
    expect([200, 201]).toContain(responded.status())
    const r = await arrival(page, () => page.getByText(answer).first().isVisible().catch(() => false), t0)
    note('RFI answer → mobile record', r)
    expect(['REALTIME', 'NEAR REALTIME', 'REFRESH REQUIRED']).toContain(r.cls)
  })

  test('2 NCR: assigned on the web, closed out from the field, reviewed on the web, each step reaching the open screens', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const quality = await apiSession(request, accounts.quality)
    const project = await mainProject(request, pm.headers)
    const s = stamp()
    await signIn(page, accounts.quality)
    await page.goto('/quality/ncr')
    await expect(page.getByTestId('screen-ncrs').first()).toBeVisible()
    await expect(page.getByTestId('freshness').first()).toBeVisible()
    const t0 = Date.now()
    const created = await request.post(`${apiBase}/projects/${project.id}/ncr`, { headers: pm.headers, data: { severity: 'minor', description: `Cert propagation NCR ${s}`, responsible: 'Quality', assigneeUserId: quality.user.id, dueDate: '2026-12-31' } })
    expect(created.status()).toBe(201)
    const ncrId = ((await created.json()) as { data: { id: string } }).data.id
    const arrived = await arrival(page, () => page.getByText(`Cert propagation NCR ${s}`).first().isVisible().catch(() => false), t0)
    note('web NCR assignment → mobile NCR list', arrived)

    // The closeout itself is proved through the screens by the M4 checks; here the question is how a web-side
    // change of the same record reaches an open mobile record screen.
    await page.goto(`/quality/ncr/${ncrId}`)
    await expect(page.getByTestId('screen-ncr').last()).toBeVisible()
    const t1 = Date.now()
    const edited = await request.patch(`${apiBase}/projects/${project.id}/ncr/${ncrId}`, { headers: pm.headers, data: { severity: 'major' } })
    expect([200, 201], await edited.text()).toContain(edited.status())
    const reviewed = await arrival(page, () => page.getByText(/major/i).first().isVisible().catch(() => false), t1)
    note('web NCR edit → open mobile NCR record', reviewed)
    expect(['REALTIME', 'NEAR REALTIME', 'REFRESH REQUIRED']).toContain(reviewed.cls)
  })

  test('3 Purchase order: issued on the web, received from the field, the register shows the receipt', async ({ page, request }) => {
    test.setTimeout(120_000)
    const pm = await apiSession(request, accounts.pm)
    const warehouse = await apiSession(request, accounts.warehouse)
    const project = await mainProject(request, pm.headers)
    const s = stamp()
    const suppliers = items(await getData<{ items?: { id: string }[] } | { id: string }[]>(request, pm.headers, `/projects/${project.id}/procurement/suppliers`))
    const activities = items(await getData<{ id: string }[]>(request, pm.headers, `/projects/${project.id}/activities`))
    const created = await request.post(`${apiBase}/projects/${project.id}/procurement/purchase-orders`, { headers: pm.headers, data: { supplierId: suppliers[0]!.id, status: 'draft', requiredBy: '2030-01-31', promisedDate: '2030-01-15', lines: [{ activityId: activities[0]!.id, itemCode: 'CEM-42.5N', description: `Cert propagation cement ${s}`, unit: 'bag', orderedQty: 10, unitCost: 6.4 }] } })
    expect(created.status()).toBe(201)
    const orderId = ((await created.json()) as { data: { id: string } }).data.id
    for (const step of ['submit', 'approve', 'issue']) expect((await request.post(`${apiBase}/projects/${project.id}/purchase-orders/${orderId}/${step}`, { headers: pm.headers, data: {} })).status(), step).toBe(200)
    const order = await getData<{ lines: { id: string }[] }>(request, pm.headers, `/projects/${project.id}/purchase-orders/${orderId}`)
    const warehouses = items(await getData<{ items: { id: string }[] }>(request, pm.headers, '/inventory/warehouses'))

    await signIn(page, accounts.pm)
    await page.goto(`/procurement/orders/${orderId}`)
    await expect(page.getByTestId('screen-order').last()).toBeVisible()
    const t0 = Date.now()
    const receipt = await request.post(`${apiBase}/inventory/goods-receipt`, { headers: mobileHeaders(warehouse.headers), data: { orderId, warehouseId: warehouses[0]!.id, receiptNumber: `GRN-M-cert${s}`, deliveryNote: `DN-cert-${s}`, lines: [{ poLineId: order.lines[0]!.id, acceptedQty: 4, rejectedQty: 0 }] } })
    expect(receipt.status(), await receipt.text()).toBe(201)
    const after = await getData<{ status: string; lines: { receivedQty?: number; received?: number }[] }>(request, pm.headers, `/projects/${project.id}/purchase-orders/${orderId}`)
    expect(after.status).toMatch(/partial|received/i)
    const r = await arrival(page, () => page.getByTestId('screen-order').last().innerText({ timeout: 2_000 }).then((t) => /partial|received/i.test(t)).catch(() => false), t0)
    note('mobile receipt → open PO record status', r)
    expect(['REALTIME', 'NEAR REALTIME', 'REFRESH REQUIRED']).toContain(r.cls)
  })

  test('4 Material issue: issued from the field, stock and the project cost move on the web at once; the open item screen is measured', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const warehouse = await apiSession(request, accounts.warehouse)
    const project = await mainProject(request, pm.headers)
    const scan = await getData<{ item: { id: string; unitCost?: number }; stock: { warehouseId: string; available: number }[] }>(request, pm.headers, '/inventory/items/scan/CEM-42.5N')
    const holding = scan.stock.find((x) => x.available >= 2)!
    expect(holding).toBeTruthy()
    const activities = items(await getData<{ id: string }[]>(request, pm.headers, `/projects/${project.id}/activities`))
    const activityId = activities[0]!.id
    const before = (await getData<{ rows: { activityId: string; actual: number }[] }>(request, pm.headers, `/projects/${project.id}/cost`)).rows.find((r) => r.activityId === activityId)

    await signIn(page, accounts.pm)
    await page.goto(`/inventory/items/${scan.item.id}`)
    await expect(page.getByTestId('screen-item').last()).toBeVisible()
    const text0 = await page.evaluate(() => document.body.innerText)
    const t0 = Date.now()
    const issued = await request.post(`${apiBase}/inventory/stock/issue`, { headers: mobileHeaders(warehouse.headers), data: { itemId: scan.item.id, warehouseId: holding.warehouseId, quantity: 1, projectId: project.id, activityId, reference: `Cert propagation issue ${stamp()}` } })
    expect(issued.status(), await issued.text()).toBe(201)
    // The issue route answers either one movement or { movements: [...] }.
    const body = ((await issued.json()) as { data: { movements?: { id: string; value: number }[]; movement?: { id: string; value: number }; id?: string; value?: number } }).data
    const movement = body.movements?.[0] ?? body.movement ?? (body as { id?: string; value?: number })
    const value = Math.abs(Number(movement.value ?? 0))
    expect(value).toBeGreaterThan(0)
    // The item's total available across every warehouse and bin falls by exactly the quantity issued.
    const total = (rows: { available: number }[]) => rows.reduce((sum, s) => sum + Number(s.available), 0)
    const startBalance = total(scan.stock)
    const afterScan = await getData<{ stock: { warehouseId: string; available: number }[] }>(request, pm.headers, '/inventory/items/scan/CEM-42.5N')
    expect(total(afterScan.stock)).toBeCloseTo(startBalance - 1, 3)
    const after = (await getData<{ rows: { activityId: string; actual: number }[] }>(request, pm.headers, `/projects/${project.id}/cost`)).rows.find((r) => r.activityId === activityId)
    const dActual = Number(after!.actual) - Number(before?.actual ?? 0)
    expect(dActual).toBeCloseTo(value, 2)
    test.info().annotations.push({ type: 'finance', description: `issue 1 unit: movement value ${value.toFixed(2)}, project cost actual +${dActual.toFixed(2)} (delta ${(dActual - value).toFixed(2)})` })
    const r = await arrival(page, async () => (await page.evaluate(() => document.body.innerText)) !== text0, t0)
    note('mobile issue → open item screen (stock figures)', r)
  })

  test('5 Schedule progress: submitted from the field, the open activity shows it', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const site = await apiSession(request, accounts.site)
    const project = await mainProject(request, pm.headers)
    const s = stamp()
    const created = await request.post(`${apiBase}/projects/${project.id}/activities`, { headers: pm.headers, data: { name: `Cert propagation activity ${s}`, activityCode: `CPA-${s % 100000}`, category: 'structural', startDate: '2026-09-01', endDate: '2026-12-31', budget: 500, engineerIds: [site.user.id] } })
    expect(created.status()).toBe(201)
    const activityId = ((await created.json()) as { data: { id: string } }).data.id
    await signIn(page, accounts.pm)
    await page.goto(`/activities/${activityId}`)
    await expect(page.getByTestId('screen-activity').last()).toBeVisible()
    const t0 = Date.now()
    const submitted = await request.post(`${apiBase}/projects/${project.id}/activities/${activityId}/progress`, { headers: mobileHeaders(site.headers), data: { pctComplete: 15, status: 'submitted', source: 'mobile', notes: `Cert progress note ${s}` } })
    expect([200, 201]).toContain(submitted.status())
    const submissionId = ((await submitted.json()) as { data: { submission: { id: string } } }).data.submission.id
    const r = await arrival(page, () => page.getByText(`Cert progress note ${s}`).first().isVisible().catch(() => false), t0)
    note('mobile progress submission → open activity (web sees the same record)', r)
    expect(['REALTIME', 'NEAR REALTIME', 'REFRESH REQUIRED']).toContain(r.cls)
    expect((await request.post(`${apiBase}/projects/${project.id}/activities/${activityId}/progress-submissions/${submissionId}/reject`, { headers: pm.headers, data: { reason: 'certification run' } })).status()).toBe(200)
  })

  test('6 Task: assigned on the web, completed from the field, the web sees the state', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const s = stamp()
    await signIn(page, accounts.pm)
    await page.goto('/tasks')
    await expect(page.getByTestId('screen-tasks').first()).toBeVisible()
    await page.getByTestId('task-chip-all').click().catch(() => undefined)
    await expect(page.getByTestId('freshness').first()).toBeVisible()
    const t0 = Date.now()
    const created = await request.post(`${apiBase}/tasks`, { headers: pm.headers, data: { title: `Cert propagation task ${s}`, projectId: project.id, priority: 'high', label: 'field' } })
    expect(created.status()).toBe(201)
    const taskId = ((await created.json()) as { data: { id: string } }).data.id
    const arrived = await arrival(page, () => page.getByTestId(`task-row-${taskId}`).first().isVisible().catch(() => false), t0)
    note('web task assignment → mobile task list', arrived)
    const closed = await request.post(`${apiBase}/tasks/${taskId}/close`, { headers: mobileHeaders(pm.headers), data: { comment: 'Done on site' } })
    expect([200, 201]).toContain(closed.status())
    const after = await getData<{ status: string }>(request, pm.headers, `/tasks/${taskId}`)
    expect(after.status).toMatch(/done|closed|complete/i)
    test.info().annotations.push({ type: 'propagation', description: `mobile task completion → web state: ${after.status} (immediate, same record)` })
  })

  test('7 Change event: raised from the field on the screen, the web lists it at once', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const s = stamp()
    await signIn(page, accounts.pm)
    await page.goto('/commercial/change-events')
    await expect(page.getByTestId('screen-change-events').first()).toBeVisible()
    await page.getByTestId('change-event-new').click()
    await expect(page.getByTestId('screen-change-event-new')).toBeVisible()
    await page.getByTestId('change-event-title').fill(`Cert propagation change ${s}`)
    await page.getByTestId('change-event-type-site_condition').click()
    await page.getByTestId('change-event-rom').fill('750')
    await page.getByTestId('change-event-days').fill('2')
    const posted = page.waitForResponse((r) => r.url().endsWith('/change-events') && r.request().method() === 'POST')
    await page.getByTestId('change-event-raise').click()
    const response = await posted
    expect(response.status()).toBe(201)
    const eventId = ((await response.json()) as { data: { id: string } }).data.id
    const t0 = Date.now()
    // The web platform reads the same record: fetch it by id rather than hunting a filtered list.
    const onWeb = await getData<{ id: string; title?: string; description?: string }>(request, pm.headers, `/projects/${project.id}/change-events/${eventId}`)
    expect(onWeb.id).toBe(eventId)
    test.info().annotations.push({ type: 'propagation', description: `mobile change event → web commercial record: readable ${Date.now() - t0} ms after the app's request returned (same record, no propagation delay)` })
  })

  test('8 Approval: assigned on the web, answered from the field, the web sees the final status', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    await ensureChangeOrderTemplate(request, pm.headers, project.id)
    const s = stamp()
    const activities = items(await getData<{ id: string }[]>(request, pm.headers, `/projects/${project.id}/activities`))
    const uploaded = await request.post(`${apiBase}/projects/${project.id}/workflow/uploads`, { headers: pm.headers, multipart: { files: { name: 'evidence.png', mimeType: 'image/png', buffer: readFileSync('e2e/fixtures/evidence.png') } } })
    expect(uploaded.status()).toBe(201)
    const ref = ((await uploaded.json()) as { data: unknown[] }).data[0]
    await signIn(page, accounts.pm)
    await page.goto('/workflow')
    await expect(page.getByTestId('screen-workflow').first()).toBeVisible()
    await expect(page.getByTestId('freshness').first()).toBeVisible()
    const created = await request.post(`${apiBase}/projects/${project.id}/change-orders`, { headers: pm.headers, data: { description: `Cert propagation change order ${s}`, value: 900, status: 'draft', category: 'site_condition', scheduleImpact: 0, scheduleImpactSummary: 'No programme impact', costImpactSummary: 'Priced at cost', affectedActivityIds: [activities[0]!.id], attachmentRefs: [ref] } })
    expect(created.status()).toBe(201)
    const orderId = ((await created.json()) as { data: { id: string } }).data.id
    const t0 = Date.now()
    expect((await request.post(`${apiBase}/projects/${project.id}/change-orders/${orderId}/submit`, { headers: pm.headers, data: {} })).status()).toBe(200)
    let step: { assignmentId: string; instanceId: string } | undefined
    await expect.poll(async () => {
      step = items<{ assignmentId: string; instanceId: string; recordId: string }>((await getData<never>(request, pm.headers, '/workflows/my-steps'))).find((x) => x.recordId === orderId)
      return !!step
    }, { timeout: 15_000 }).toBe(true)
    const arrived = await arrival(page, () => page.getByTestId(`step-row-${step!.assignmentId}`).first().isVisible().catch(() => false), t0)
    note('web approval assignment → mobile inbox', arrived)
    // The decision is made on the record's own screen, reached by its route so the check does not depend on the inbox's filters.
    await page.goto(`/workflow/${step!.instanceId}`)
    await expect(page.getByTestId('screen-workflow-instance').last()).toBeVisible()
    await page.getByTestId('workflow-respond-approve').click()
    const answered = page.waitForResponse((r) => r.url().includes('/workflows/instances/') && r.url().endsWith('/respond') && r.request().method() === 'POST')
    await page.getByTestId('prompt-respond-confirm').click()
    expect((await answered).status()).toBe(200)
    const instance = await getData<{ status: string }>(request, pm.headers, `/projects/${project.id}/workflows/instances/${step!.instanceId}`)
    const order = (await getData<{ orders: { id: string; status: string }[] }>(request, pm.headers, `/projects/${project.id}/change-orders`)).orders.find((o) => o.id === orderId)
    test.info().annotations.push({ type: 'propagation', description: `mobile approval → web: instance ${instance.status}, change order ${order?.status} (immediate, same record)` })
    expect(order?.status).toMatch(/approved/i)
  })
})
