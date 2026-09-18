import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * M4 on the web target: inspections, the punch list, NCRs with closeout
 * evidence, and material tests. Writes go to the dedicated end-to-end
 * organisation; the certified project is never touched.
 */
const email = process.env.E2E_WRITE_EMAIL ?? 'pm@octapm-e2e.test'
const password = process.env.E2E_WRITE_PASSWORD ?? 'DemoPassw0rd!'
const apiBase = process.env.MOBILE_API_URL ?? 'http://localhost:5000/api/v1'

// A 1×1 PNG on disk: enough for the server to accept it as evidence.
const evidence = 'e2e/fixtures/evidence.png'

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

const openQuality = async (page: Page) => {
  await page.getByTestId('records-quality').click()
  await expect(page.getByTestId('screen-quality')).toBeVisible()
}

test.describe('M4 on the web target', () => {
  test('an inspection is started from a template, answered in one request and completed', async ({ page, request }) => {
    await signIn(page)
    const projectId = await page.evaluate(() => sessionStorage.getItem('octapm.session.project'))
    const { headers } = await apiSession(request)
    // The end-to-end project has no templates of its own; make sure one exists, as the same person.
    const listed = await request.get(`${apiBase}/projects/${projectId}/forms/templates?status=active`, { headers })
    let templates = ((await listed.json()) as { data: { items: { id: string; name: string }[] } }).data.items
    let template = templates.find((t) => t.name === 'E2E Concrete pour ITP')
    if (!template) {
      const created = await request.post(`${apiBase}/projects/${projectId}/forms/templates`, {
        headers,
        data: { name: 'E2E Concrete pour ITP', type: 'itp', trade: 'Concrete', sections: [{ title: 'Before the pour', items: [{ label: 'Formwork clean and oiled', responseType: 'pass_fail', required: true }, { label: 'Slump (mm)', responseType: 'number' }] }] },
      })
      expect(created.status()).toBe(201)
      template = ((await created.json()) as { data: { id: string; name: string } }).data
    }

    await openQuality(page)
    await page.getByTestId('quality-inspections').click()
    await expect(page.getByTestId('screen-inspections')).toBeVisible()
    await page.getByTestId('inspection-new').click()
    await expect(page.getByTestId('screen-inspection-new')).toBeVisible()
    await page.getByTestId('inspection-template').click()
    await page.getByTestId(`inspection-template-option-${template.id}`).click()
    await page.getByTestId('inspection-title').fill(`E2E ITP ${Date.now() % 100000}`)
    const created = page.waitForResponse((r) => r.url().endsWith('/forms') && r.request().method() === 'POST')
    await page.getByTestId('inspection-create').click()
    const response = await created
    expect(response.status()).toBe(201)
    expect((response.request().postDataJSON() as { clientRequestId: string }).clientRequestId).toMatch(/[0-9a-f-]{20,}/)
    const instance = ((await response.json()) as { data: { id: string; sections: { items: { id: string; responseType: string }[] }[] } }).data
    const items = instance.sections.flatMap((s) => s.items)
    const passFail = items.find((i) => i.responseType === 'pass_fail')!
    const number = items.find((i) => i.responseType === 'number')!

    await expect(page.getByTestId('screen-inspection')).toBeVisible()
    await expect(page.getByTestId('inspection-header')).toContainText('E2E ITP')
    await page.getByTestId(`item-${passFail.id}-pass`).click()
    await page.getByTestId(`item-${number.id}-value`).fill('110')
    const saved = page.waitForResponse((r) => r.url().endsWith('/responses') && r.request().method() === 'PUT')
    await page.getByTestId('action-save').click()
    const put = await saved
    expect(put.status()).toBe(200)
    expect((put.request().postDataJSON() as { responses: unknown[] }).responses).toHaveLength(2)
    await expect(page.getByText(`${items.length} of ${items.length} answered`)).toBeVisible()
    const completed = page.waitForResponse((r) => r.url().endsWith('/complete') && r.request().method() === 'POST')
    await page.getByTestId('action-complete').click()
    expect((await completed).status()).toBe(200)
    await expect(page.getByText('Outcome: Pass')).toBeVisible()
  })

  test('a punch item is raised with a replay key and moved through review and close on the transition route', async ({ page }) => {
    await signIn(page)
    await openQuality(page)
    await page.getByTestId('quality-punch').click()
    await expect(page.getByTestId('screen-punch')).toBeVisible()
    await page.getByTestId('punch-new').click()
    await expect(page.getByTestId('screen-punch-new')).toBeVisible()
    await page.getByTestId('punch-title').fill(`E2E chipped tile ${Date.now() % 100000}`)
    await page.getByTestId('punch-priority-high').click()
    const created = page.waitForResponse((r) => r.url().endsWith('/punch') && r.request().method() === 'POST')
    await page.getByTestId('punch-raise').click()
    const response = await created
    expect(response.status()).toBe(201)
    const sent = response.request().postDataJSON() as { clientRequestId: string; status: string; priority: string }
    expect(sent.clientRequestId).toMatch(/[0-9a-f-]{20,}/)
    expect(sent.status).toBe('open')
    expect(sent.priority).toBe('high')

    await expect(page.getByTestId('screen-punch-item')).toBeVisible()
    await expect(page.getByTestId('punch-header')).toContainText('E2E chipped tile')
    const ready = page.waitForResponse((r) => r.url().endsWith('/transition') && r.request().method() === 'POST')
    await page.getByTestId('action-ready').click()
    const first = await ready
    expect(first.status()).toBe(200)
    expect((first.request().postDataJSON() as { action: string }).action).toBe('ready_for_review')
    await expect(page.getByTestId('punch-header')).toContainText('Ready for review')
    const closed = page.waitForResponse((r) => r.url().endsWith('/transition') && r.request().method() === 'POST')
    await page.getByTestId('action-close').click()
    expect((await closed).status()).toBe(200)
    await expect(page.getByTestId('action-reopen')).toBeVisible()
    await expect(page.getByTestId('action-close')).toHaveCount(0)
  })

  test('an NCR is raised, closed out with evidence through the workflow upload route, and approved', async ({ page }) => {
    await signIn(page)
    await openQuality(page)
    await page.getByTestId('quality-ncr').click()
    await expect(page.getByTestId('screen-ncrs')).toBeVisible()
    await page.getByTestId('ncr-new').click()
    const form = page.getByTestId('screen-ncr-new')
    await expect(form).toBeVisible()
    // The list underneath keeps its severity filter chips mounted; scope to the form.
    await form.getByTestId('ncr-severity-minor').click()
    await page.getByTestId('ncr-description').fill(`E2E blockwork joint over 15 mm ${Date.now() % 100000}`)
    await page.getByTestId('ncr-responsible').fill('E2E Masonry')
    await page.getByTestId('ncr-due').fill('2030-01-31')
    const created = page.waitForResponse((r) => r.url().endsWith('/ncr') && r.request().method() === 'POST')
    await page.getByTestId('ncr-raise').click()
    const response = await created
    expect(response.status()).toBe(201)
    expect((response.request().postDataJSON() as { status: string }).status).toBe('open')

    await expect(page.getByTestId('screen-ncr')).toBeVisible()
    await expect(page.getByTestId('ncr-header')).toContainText('E2E blockwork joint')
    await page.getByTestId('action-submit').click()
    await expect(page.getByTestId('closeout-sheet')).toBeVisible()
    await page.getByTestId('closeout-comment').fill('Joints raked out and repointed; checked with a 15 mm gauge.')
    await expect(page.getByTestId('closeout-submit')).toBeDisabled()
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('closeout-library').click()
    await (await chooser).setFiles(evidence)
    await expect(page.getByText('1 new photo ready.')).toBeVisible()
    const uploaded = page.waitForResponse((r) => r.url().endsWith('/workflow/uploads') && r.request().method() === 'POST')
    const submitted = page.waitForResponse((r) => r.url().endsWith('/submit') && r.request().method() === 'POST')
    await page.getByTestId('closeout-submit').click()
    expect((await uploaded).status()).toBe(201)
    const submit = await submitted
    expect(submit.status()).toBe(200)
    const body = submit.request().postDataJSON() as { attachmentRefs: { fileName: string }[]; closureComment: string }
    expect(body.attachmentRefs).toHaveLength(1)
    expect(body.attachmentRefs[0]!.fileName).toBe('evidence.png')
    await expect(page.getByTestId('ncr-header')).toContainText('Submitted')
    // The sentence also appears in the history line; match the closeout card's exact text.
    await expect(page.getByTestId('screen-ncr').getByText('Joints raked out and repointed; checked with a 15 mm gauge.', { exact: true })).toBeVisible()

    await page.getByTestId('action-approve').click()
    const approved = page.waitForResponse((r) => r.url().endsWith('/approve') && r.request().method() === 'POST')
    await page.getByTestId('prompt-approve-confirm').click()
    expect((await approved).status()).toBe(200)
    await expect(page.getByTestId('ncr-header')).toContainText('Closed')
    await expect(page.getByTestId('action-reopen')).toBeVisible()
  })

  test('a material test is scheduled as pending and its result recorded', async ({ page }) => {
    await signIn(page)
    await openQuality(page)
    await page.getByTestId('quality-tests').click()
    await expect(page.getByTestId('screen-tests')).toBeVisible()
    await page.getByTestId('tests-new').click()
    await page.getByTestId('prompt-test-input').fill(`E2E cube test ${Date.now() % 100000}`)
    const created = page.waitForResponse((r) => r.url().endsWith('/material-tests') && r.request().method() === 'POST')
    await page.getByTestId('prompt-test-confirm').click()
    const response = await created
    expect(response.status()).toBe(201)
    expect((response.request().postDataJSON() as { result: string }).result).toBe('pending')

    await expect(page.getByTestId('screen-test')).toBeVisible()
    await expect(page.getByTestId('test-header')).toContainText('E2E cube test')
    await page.getByTestId('action-record').click()
    await page.getByTestId('test-result-pass').click()
    await page.getByTestId('test-actual').fill('42 MPa')
    await expect(page.getByTestId('test-actual')).toHaveValue('42 MPa')
    await page.getByTestId('test-lab').fill('E2E Labs')
    await expect(page.getByTestId('test-lab')).toHaveValue('E2E Labs')
    const patched = page.waitForResponse((r) => r.url().includes('/material-tests/') && r.request().method() === 'PATCH')
    await page.getByTestId('test-save').click()
    const patch = await patched
    expect(patch.status()).toBe(200)
    expect(patch.request().postDataJSON()).toMatchObject({ result: 'pass', actualValue: '42 MPa', labName: 'E2E Labs' })
    await expect(page.getByTestId('test-header')).toContainText('Passed')
    await expect(page.getByText('42 MPa')).toBeVisible()
  })
})
