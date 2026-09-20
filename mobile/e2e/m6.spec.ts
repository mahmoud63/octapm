/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { openModule } from './cert-helpers'

/**
 * M6 on the web target: an approval answered through the respond route on
 * a change order raised and submitted for the run, a change event raised
 * from the field form, a lead-time alert acknowledged, and the order
 * register opening into the delivery. Writes go to the dedicated
 * end-to-end organisation only.
 */
const email = process.env.E2E_WRITE_EMAIL ?? 'pm@octapm-e2e.test'
const password = process.env.E2E_WRITE_PASSWORD ?? 'DemoPassw0rd!'
const apiBase = process.env.MOBILE_API_URL ?? 'http://localhost:5000/api/v1'

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

const items = <T>(data: { items?: T[]; orders?: T[] } | T[]): T[] => (Array.isArray(data) ? data : (data.items ?? data.orders ?? []))

/** The end-to-end project has no workflow templates of its own; make sure one exists for change orders, as the same person. */
async function ensureChangeOrderTemplate(request: APIRequestContext, headers: Record<string, string>, projectId: string) {
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

test.describe('M6 on the web target', () => {
  test('an approval step is answered through the respond route and the change order moves', async ({ page, request }) => {
    const { headers } = await apiSession(request)
    await signIn(page)
    const projectId = (await page.evaluate(() => sessionStorage.getItem('octapm.session.project')))!
    await ensureChangeOrderTemplate(request, headers, projectId)
    const stamp = Date.now() % 100000
    // The server refuses a submit without both impact summaries, an affected activity and a supporting document.
    const activities = await request.get(`${apiBase}/projects/${projectId}/activities`, { headers })
    const activityId = items<{ id: string }>(((await activities.json()) as { data: never }).data)[0]!.id
    const uploaded = await request.post(`${apiBase}/projects/${projectId}/workflow/uploads`, { headers, multipart: { files: { name: 'evidence.png', mimeType: 'image/png', buffer: readFileSync('e2e/fixtures/evidence.png') } } })
    expect(uploaded.status(), 'upload').toBe(201)
    const ref = ((await uploaded.json()) as { data: { fileName: string; fileUrl: string; storageKey: string; mimeType: string; sizeBytes: number; documentId: string }[] }).data[0]!
    const created = await request.post(`${apiBase}/projects/${projectId}/change-orders`, {
      headers,
      data: { description: `E2E change order ${stamp}`, value: 1500, status: 'draft', category: 'site_condition', scheduleImpact: 0, scheduleImpactSummary: 'No programme impact', costImpactSummary: 'Priced at cost', affectedActivityIds: [activityId], attachmentRefs: [ref] },
    })
    expect(created.status(), 'change order').toBe(201)
    const orderId = ((await created.json()) as { data: { id: string } }).data.id
    const submitted = await request.post(`${apiBase}/projects/${projectId}/change-orders/${orderId}/submit`, { headers, data: {} })
    expect(submitted.status(), 'submit').toBe(200)
    // The submit starts the template's approval after it replies; the step lands in the PM's inbox a moment later.
    let step: { assignmentId: string; instanceId: string; recordId: string } | undefined
    await expect
      .poll(
        async () => {
          const inbox = await request.get(`${apiBase}/workflows/my-steps`, { headers })
          step = items<{ assignmentId: string; instanceId: string; recordId: string }>(((await inbox.json()) as { data: never }).data).find((s) => s.recordId === orderId)
          return !!step
        },
        { message: 'a step for the submitted change order', timeout: 15_000 },
      )
      .toBe(true)

    await openModule(page, 'workflow')
    await expect(page.getByTestId('screen-workflow')).toBeVisible()
    // The inbox is a windowed list and this step, being the newest, sorts last:
    // it is not in the page at all until the list has been scrolled near it, and
    // scroll-into-view cannot reach an element that is not there. Drive the
    // list's own scroller down until the row exists, as a person would.
    const row = page.getByTestId(`step-row-${step!.assignmentId}`)
    for (let i = 0; i < 40 && (await row.count()) === 0; i += 1) {
      await page.evaluate(() => {
        const scroller = [...document.querySelectorAll<HTMLElement>('*')].find((node) => node.scrollHeight > node.clientHeight + 50)
        if (scroller) scroller.scrollTop = scroller.scrollHeight
      })
      await page.waitForTimeout(150)
    }
    await expect(row, 'the new step is reachable in the inbox').toBeVisible()
    await row.click()
    await expect(page.getByTestId('screen-workflow-instance')).toBeVisible()
    await expect(page.getByTestId('workflow-my-step')).toBeVisible()
    await page.getByTestId('workflow-respond-approve').click()
    const responded = page.waitForResponse((r) => r.url().endsWith('/respond') && r.request().method() === 'POST')
    await page.getByTestId('prompt-respond-confirm').click()
    const response = await responded
    expect(response.status()).toBe(200)
    expect(response.request().postDataJSON()).toEqual({ response: 'approve' })
    await expect(page.getByTestId('workflow-my-step')).toHaveCount(0)
    await expect(page.getByTestId('workflow-header')).toContainText(/Success|Succeeded/)

    // The server moved the record; the app never called the approve route.
    const after = await request.get(`${apiBase}/projects/${projectId}/change-orders`, { headers })
    const order = items<{ id: string; status: string }>(((await after.json()) as { data: never }).data).find((o) => o.id === orderId)
    expect(order?.status).toBe('approved')
  })

  test('a change event is raised from the field form and opened', async ({ page }) => {
    await signIn(page)
    await openModule(page, 'commercial')
    await expect(page.getByTestId('screen-commercial')).toBeVisible()
    await page.getByTestId('commercial-change-events').click()
    await expect(page.getByTestId('screen-change-events')).toBeVisible()
    await page.getByTestId('change-event-new').click()
    await expect(page.getByTestId('screen-change-event-new')).toBeVisible()
    const stamp = Date.now() % 100000
    await page.getByTestId('change-event-title').fill(`E2E rock at founding level ${stamp}`)
    await page.getByTestId('change-event-type-site_condition').click()
    await page.getByTestId('change-event-rom').fill('18000')
    await page.getByTestId('change-event-days').fill('4')
    const created = page.waitForResponse((r) => r.url().endsWith('/change-events') && r.request().method() === 'POST')
    await page.getByTestId('change-event-raise').click()
    const response = await created
    expect(response.status()).toBe(201)
    expect(response.request().postDataJSON()).toMatchObject({ type: 'site_condition', origin: 'manual', romAmount: 18000, scheduleImpactDays: 4 })
    await expect(page.getByTestId('screen-change-event')).toBeVisible()
    await expect(page.getByTestId('change-event-header')).toContainText('E2E rock at founding level')
    await expect(page.getByTestId('change-event-web')).toBeVisible()
  })

  test('the procurement overview loads and an open lead-time alert, when there is one, is acknowledged', async ({ page, request }) => {
    const { headers } = await apiSession(request)
    await signIn(page)
    const projectId = (await page.evaluate(() => sessionStorage.getItem('octapm.session.project')))!
    await openModule(page, 'procurement')
    await expect(page.getByTestId('screen-procurement')).toBeVisible()
    await expect(page.getByTestId('procurement-doors')).toBeVisible()
    const alerts = await request.get(`${apiBase}/projects/${projectId}/procurement/lead-time-alerts?status=open`, { headers })
    const open = items<{ id: string }>(((await alerts.json()) as { data: never }).data)[0]
    if (!open) {
      test.info().annotations.push({ type: 'note', description: 'No open lead-time alert on the end-to-end project; the acknowledge step ran only in the rendered tests.' })
      return
    }
    const patched = page.waitForResponse((r) => r.url().includes('/lead-time-alerts/') && r.request().method() === 'PATCH')
    await page.getByTestId(`alert-acknowledge-${open.id}`).click()
    const response = await patched
    expect(response.status()).toBe(200)
    expect(response.request().postDataJSON()).toEqual({ status: 'acknowledged' })
    await expect(page.getByTestId(`alert-acknowledge-${open.id}`)).toHaveCount(0)
  })

  test('the order register opens an issued order and hands the delivery to inventory', async ({ page, request }) => {
    const { headers } = await apiSession(request)
    await signIn(page)
    const projectId = (await page.evaluate(() => sessionStorage.getItem('octapm.session.project')))!
    const register = await request.get(`${apiBase}/projects/${projectId}/purchase-orders?status=issued`, { headers })
    const issued = items<{ id: string; ref: string }>(((await register.json()) as { data: never }).data)[0]
    expect(issued, 'an issued order on the end-to-end project').toBeTruthy()
    await page.goto('/procurement/orders')
    await expect(page.getByTestId('screen-orders')).toBeVisible()
    await page.getByTestId('orders-chip-issued').click()
    await page.getByTestId(`order-row-${issued!.id}`).click()
    await expect(page.getByTestId('screen-order')).toBeVisible()
    await expect(page.getByTestId('order-header')).toContainText(issued!.ref)
    await page.getByTestId('order-receive').click()
    await expect(page.getByTestId('screen-receive')).toBeVisible()
    await expect(page.getByTestId('po-header')).toContainText(issued!.ref)
  })
})
