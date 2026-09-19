/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { accounts, apiBase, apiSession, getData, isWide, items, mainProject, signIn, type Headers } from './cert-helpers'

/**
 * Certification: what a person is told before their approval is recorded
 * (PILOT-02). A commercial approval on a phone has to carry the business
 * consequence — what the record is worth, why it was raised, what it does
 * to the programme, what evidence sits behind it — and the confirmation has
 * to name the record and the money, not merely say "Confirm". Where the app
 * has not been given the figure a money decision turns on, it must hand
 * over to the web platform rather than offer an approve button it cannot
 * justify.
 *
 * Everything asserted here is compared against the server's own numbers,
 * read back from the API in the same run. Writes go to the dedicated
 * end-to-end organisation only.
 */
const stamp = () => Date.now() % 1_000_000

async function ensureChangeOrderTemplate(request: APIRequestContext, headers: Headers, projectId: string) {
  const listed = await request.get(`${apiBase}/projects/${projectId}/workflows/templates?tool=change_order`, { headers })
  const existing = items<{ id: string }>(((await listed.json()) as { data: never }).data)[0]
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

/** A submitted change order of a known value, with one file of evidence, and the step it raises for the PM. */
async function pendingApproval(request: APIRequestContext, headers: Headers, projectId: string, value: number) {
  await ensureChangeOrderTemplate(request, headers, projectId)
  const s = stamp()
  const activities = items(await getData<{ id: string }[]>(request, headers, `/projects/${projectId}/activities`))
  const uploaded = await request.post(`${apiBase}/projects/${projectId}/workflow/uploads`, { headers, multipart: { files: { name: 'evidence.png', mimeType: 'image/png', buffer: readFileSync('e2e/fixtures/evidence.png') } } })
  expect(uploaded.status()).toBe(201)
  const ref = ((await uploaded.json()) as { data: unknown[] }).data[0]
  const created = await request.post(`${apiBase}/projects/${projectId}/change-orders`, {
    headers,
    data: { description: `Cert approval context ${s}`, value, status: 'draft', category: 'site_condition', scheduleImpact: 3, scheduleImpactSummary: 'Three days on the critical path', costImpactSummary: 'Priced at cost plus 8%', affectedActivityIds: [activities[0]!.id], attachmentRefs: [ref] },
  })
  expect(created.status(), 'change order').toBe(201)
  const orderId = ((await created.json()) as { data: { id: string; ref: string } }).data.id
  expect((await request.post(`${apiBase}/projects/${projectId}/change-orders/${orderId}/submit`, { headers, data: {} })).status()).toBe(200)
  let step: { assignmentId: string; instanceId: string; recordId: string; recordRef: string } | undefined
  await expect
    .poll(async () => {
      step = items<{ assignmentId: string; instanceId: string; recordId: string; recordRef: string }>(await getData<never>(request, headers, '/workflows/my-steps')).find((x) => x.recordId === orderId)
      return !!step
    }, { timeout: 15_000 })
    .toBe(true)
  return { orderId, step: step! }
}

test.describe('certification: the approval carries its own consequence', () => {
  test.beforeEach(({ page }) => {
    test.skip(isWide(page), 'the field decision is certified on the phone viewport')
  })

  test('a change-order approval names the money, the reason, the programme and the evidence', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const { orderId, step } = await pendingApproval(request, pm.headers, project.id, 42_500)

    // The server's own figures, to compare the screen against.
    const instance = await getData<{ context: Record<string, unknown>; recordRef: string }>(request, pm.headers, `/projects/${project.id}/workflows/instances/${step.instanceId}`)
    expect(instance.context.amount, 'the server carries the amount on the instance').toBe(42_500)

    await signIn(page, accounts.pm)
    await page.goto(`/workflow/${step.instanceId}`)
    await expect(page.getByTestId('screen-workflow-instance').last()).toBeVisible()

    const card = page.getByTestId('workflow-context').last()
    await expect(card, 'the decision card is on the screen').toBeVisible()
    const shown = async () => (await card.innerText()).replace(/\s+/g, ' ')
    await expect.poll(shown, { timeout: 15_000 }).toContain('42,500')
    // The instance context arrives first; the rest of the record follows.
    await expect.poll(shown, { timeout: 15_000 }).not.toContain('Reading the rest of the record')
    const text = await shown()
    expect(text, 'the money is labelled as the change value').toContain('Change value')
    expect(text, 'why it was raised').toContain('Site condition')
    expect(text, 'what it does to the programme').toMatch(/3 days|Three days on the critical path/)
    expect(text, 'the priced basis').toContain('Priced at cost plus 8%')
    expect(text, 'the programme note from the record').toContain('Three days on the critical path')
    expect(text, 'the evidence behind it').toMatch(/1 file on the record/)
    expect(text, 'what the change touches').toContain('Affected activity')
    // Two rows must not carry the same label with different values.
    expect(text.match(/Schedule impact/g)?.length ?? 0, 'one schedule row, not two').toBe(1)

    // The evidence it counts can actually be opened, one tap away on the record.
    await page.getByTestId('workflow-open-record').click()
    await expect(page.getByTestId('screen-change-order').last()).toBeVisible()
    const evidenceCard = page.getByTestId('change-order-evidence-card').last()
    await expect(evidenceCard).toBeVisible()
    await expect(evidenceCard.getByText('evidence.png').first(), 'the file is named').toBeVisible()
    await expect(evidenceCard.getByText('Open').first(), 'and can be opened').toBeVisible()

    // The confirmation says what is being decided and what it is worth.
    await page.goto(`/workflow/${step.instanceId}`)
    await expect(page.getByTestId('screen-workflow-instance').last()).toBeVisible()
    await page.getByTestId('workflow-respond-approve').click()
    const sheet = page.getByTestId('prompt-respond').last()
    await expect(sheet).toBeVisible()
    const prompt = (await sheet.innerText()).replace(/\s+/g, ' ')
    expect(prompt, 'the record is named').toContain(`Approve change order ${instance.recordRef}?`)
    expect(prompt, 'the money is repeated in the confirmation').toContain('42,500')
    expect(prompt, 'and what the answer does').toContain('record your approval in the project audit trail')
    expect(prompt, 'the answer is not a bare Confirm').not.toMatch(/^Confirm/)

    const answered = page.waitForResponse((r) => r.url().endsWith('/respond') && r.request().method() === 'POST')
    await page.getByTestId('prompt-respond-confirm').click()
    expect((await answered).status()).toBe(200)
    const order = (await getData<{ orders: { id: string; status: string }[] }>(request, pm.headers, `/projects/${project.id}/change-orders`)).orders.find((o) => o.id === orderId)
    expect(order?.status, 'the decision reached the record').toMatch(/approved/i)
  })

  test('a money decision the app has no figure for is handed to the web, not approved here', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const { step } = await pendingApproval(request, pm.headers, project.id, 7_250)

    // An instance whose context predates the amount — the payload an older
    // record still carries. The app must not offer an approve button for it.
    await page.route(`**/workflows/instances/${step.instanceId}`, async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as { data: { context: Record<string, unknown> } }
      delete body.data.context.amount
      await route.fulfill({ response, json: body })
    })

    await signIn(page, accounts.pm)
    await page.goto(`/workflow/${step.instanceId}`)
    await expect(page.getByTestId('screen-workflow-instance').last()).toBeVisible()
    await expect(page.getByTestId('workflow-review-on-web').last(), 'the hand-over is offered').toBeVisible()
    await expect(page.getByTestId('workflow-respond-approve'), 'no approve button without the figure').toHaveCount(0)
    await expect(page.getByTestId('workflow-respond-reject'), 'and no reject either').toHaveCount(0)
    expect((await page.getByTestId('workflow-review-on-web').last().innerText()).replace(/\s+/g, ' ')).toContain('Review it on the web platform')
  })

  test('the server decides who may answer, whatever the app shows', async ({ request }) => {
    const pm = await apiSession(request, accounts.pm)
    const site = await apiSession(request, accounts.site)
    const project = await mainProject(request, pm.headers)
    const { step } = await pendingApproval(request, pm.headers, project.id, 1_100)

    // Someone the step is not assigned to, asking directly.
    const refused = await request.post(`${apiBase}/projects/${project.id}/workflows/instances/${step.instanceId}/respond`, { headers: { ...site.headers, 'x-octapm-client': 'mobile' }, data: { response: 'approve' } })
    expect([403, 404], 'a step that is not yours is refused').toContain(refused.status())

    // The same instance, asked for under another project: the tenant and
    // project scope is on the server, not on the route the app happens to use.
    const projects = items<{ id: string }>(await getData<never>(request, pm.headers, '/projects'))
    const other = projects.find((p) => p.id !== project.id)
    if (other) {
      const misrouted = await request.post(`${apiBase}/projects/${other.id}/workflows/instances/${step.instanceId}/respond`, { headers: pm.headers, data: { response: 'approve' } })
      expect([403, 404], 'the instance does not exist under another project').toContain(misrouted.status())
    }

    // An answer the template does not offer.
    const unknown = await request.post(`${apiBase}/projects/${project.id}/workflows/instances/${step.instanceId}/respond`, { headers: pm.headers, data: { response: 'approve_silently' } })
    expect(unknown.status(), 'an invented response is refused').toBe(400)

    // The step is still open and undecided after all three.
    const after = await getData<{ status: string }>(request, pm.headers, `/projects/${project.id}/workflows/instances/${step.instanceId}`)
    expect(after.status).toBe('running')

    // Leave nothing pending behind.
    expect((await request.post(`${apiBase}/projects/${project.id}/workflows/instances/${step.instanceId}/respond`, { headers: pm.headers, data: { response: 'approve' } })).status()).toBe(200)
  })
})
