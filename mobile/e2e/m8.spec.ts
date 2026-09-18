import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

/**
 * M8 on the web target: the wide layout. Master–detail on the tablet
 * viewport and none on the phone; a signature drawn with the mouse and
 * posted as a PNG; the timeline on the wide screen; a progress update
 * approved from the tablet. Writes go to the dedicated end-to-end
 * organisation only.
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

const items = <T>(data: { items?: T[] } | T[]): T[] => (Array.isArray(data) ? data : (data.items ?? []))

/** The element's box once two readings 150 ms apart agree, so an entrance animation has finished. */
async function settledBox(locator: Locator) {
  let last = await locator.boundingBox()
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 150))
    const next = await locator.boundingBox()
    if (last && next && last.x === next.x && last.y === next.y && last.width === next.width && last.height === next.height) return next
    last = next
  }
  throw new Error('The element kept moving')
}
const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900

test.describe('M8 on the web target', () => {
  test('the RFI list keeps its place beside the record on a tablet, and the record takes the whole phone', async ({ page }) => {
    await signIn(page)
    await page.goto('/rfi')
    await expect(page.getByTestId('screen-rfis').first()).toBeVisible()
    if (isWide(page)) {
      await expect(page.getByTestId('split-group')).toBeVisible()
      await expect(page.getByTestId('pane-placeholder')).toBeVisible()
      const row = page.getByTestId('split-master').locator('[data-testid^="rfi-row-"]').first()
      await row.click()
      await expect(page.getByTestId('split-pane').getByTestId('screen-rfi')).toBeVisible()
      // The list is still there on the left.
      await expect(page.getByTestId('split-master').getByTestId('screen-rfis')).toBeVisible()
    } else {
      await expect(page.getByTestId('split-group')).toHaveCount(0)
      await page.locator('[data-testid^="rfi-row-"]').first().click()
      await expect(page.getByTestId('screen-rfi')).toBeVisible()
      await expect(page.getByTestId('split-group')).toHaveCount(0)
    }
  })

  test('a checklist signature is drawn on the pad and posted as a PNG with the signer', async ({ page, request }) => {
    const { headers } = await apiSession(request)
    await signIn(page)
    const projectId = (await page.evaluate(() => sessionStorage.getItem('octapm.session.project')))!
    const listed = await request.get(`${apiBase}/projects/${projectId}/forms/templates?status=active`, { headers })
    let template = items<{ id: string; name: string }>(((await listed.json()) as { data: never }).data).find((t) => t.name === 'E2E signed ITP')
    if (!template) {
      const created = await request.post(`${apiBase}/projects/${projectId}/forms/templates`, { headers, data: { name: 'E2E signed ITP', type: 'itp', sections: [{ title: 'Sign-off', items: [{ label: 'Formwork checked', responseType: 'pass_fail' }, { label: 'Inspector signature', responseType: 'signature', required: true }] }] } })
      expect(created.status()).toBe(201)
      template = ((await created.json()) as { data: { id: string; name: string } }).data
    }
    const instance = await request.post(`${apiBase}/projects/${projectId}/forms`, { headers, data: { templateId: template.id, title: `E2E signed ITP ${Date.now() % 100000}`, startNow: true, clientRequestId: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } })
    expect(instance.status()).toBe(201)
    const form = ((await instance.json()) as { data: { id: string; sections: { items: { id: string; responseType: string }[] }[] } }).data
    const signatureItem = form.sections.flatMap((s) => s.items).find((i) => i.responseType === 'signature')!

    await page.goto(`/quality/inspections/${form.id}`)
    const pane = page.getByTestId('screen-inspection').last()
    await expect(pane).toBeVisible()
    await pane.getByTestId(`item-${signatureItem.id}-sign`).click()
    await expect(page.getByTestId('signature')).toBeVisible()
    // The sheet slides in; draw only once the pad has stopped moving.
    const box = await settledBox(page.getByTestId('signature-pad'))
    await page.mouse.move(box.x + 40, box.y + 120)
    await page.mouse.down()
    await page.mouse.move(box.x + 140, box.y + 60, { steps: 8 })
    await page.mouse.move(box.x + 260, box.y + 150, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByTestId('signature-confirm')).toBeEnabled()
    const posted = page.waitForResponse((r) => r.url().endsWith('/signatures') && r.request().method() === 'POST')
    await page.getByTestId('signature-confirm').click()
    const response = await posted
    expect(response.status()).toBe(201)
    const sent = response.request().postDataJSON() as { role: string; image: string; signerName: string; itemId: string }
    expect(sent.role).toBe('inspector')
    expect(sent.itemId).toBe(signatureItem.id)
    expect(sent.image.startsWith('data:image/png;base64,')).toBe(true)
    await expect(pane.getByTestId(`item-${signatureItem.id}-signed`)).toContainText('Signed by')
  })

  test('the activities list offers the timeline on the wide screen only', async ({ page }) => {
    await signIn(page)
    await page.goto('/activities')
    await expect(page.getByTestId('screen-activities').first()).toBeVisible()
    if (isWide(page)) {
      await page.getByTestId('split-master').getByTestId('activities-chip-all').click()
      await page.getByTestId('split-master').getByTestId('activities-chip-timeline').click()
      await expect(page.getByTestId('timeline')).toBeVisible()
      await expect(page.locator('[data-testid^="timeline-row-"]').first()).toBeVisible()
    } else {
      await expect(page.getByTestId('activities-chip-timeline')).toHaveCount(0)
    }
  })

  test('a submitted progress update is approved from the tablet through the approve route', async ({ page, request }) => {
    test.skip(!isWide(page), 'progress approval is a tablet decision')
    const { headers, userId } = await apiSession(request)
    await signIn(page)
    const projectId = (await page.evaluate(() => sessionStorage.getItem('octapm.session.project')))!
    const stamp = Date.now()
    const created = await request.post(`${apiBase}/projects/${projectId}/activities`, { headers, data: { name: `E2E approval activity ${stamp}`, activityCode: `E2A-${stamp % 100000}`, category: 'structural', startDate: '2026-09-01', endDate: '2026-12-31', budget: 1000, engineerIds: [userId] } })
    expect(created.status()).toBe(201)
    const activityId = ((await created.json()) as { data: { id: string } }).data.id
    const submitted = await request.post(`${apiBase}/projects/${projectId}/activities/${activityId}/progress`, { headers, data: { pctComplete: 10, status: 'submitted', source: 'mobile', notes: 'E2E first pour' } })
    expect([200, 201]).toContain(submitted.status())
    const submissionId = ((await submitted.json()) as { data: { submission: { id: string } } }).data.submission.id

    await page.goto(`/activities/${activityId}`)
    const pane = page.getByTestId('screen-activity').last()
    await expect(pane).toBeVisible()
    const approved = page.waitForResponse((r) => r.url().endsWith(`/progress-submissions/${submissionId}/approve`) && r.request().method() === 'POST')
    await pane.getByTestId(`submission-approve-${submissionId}`).click()
    expect((await approved).status()).toBe(200)
    await expect(pane.getByTestId(`submission-approve-${submissionId}`)).toHaveCount(0)
    const after = await request.get(`${apiBase}/projects/${projectId}/activities/${activityId}`, { headers })
    expect(((await after.json()) as { data: { pctComplete: number | null } }).data.pctComplete).toBe(10)
  })
})
