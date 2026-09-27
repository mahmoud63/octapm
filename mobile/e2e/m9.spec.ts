import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { currentProjectId } from './cert-helpers'

/**
 * M9 on the web target: a web-platform record link opens the record in the
 * app through the opener; a record raised through the API reaches an open
 * list without a reload (realtime); the web target registers no native push
 * device; a photo is marked up before upload and the marked copy lands on
 * the daily log. Writes go to the dedicated end-to-end organisation only.
 */
const email = process.env.E2E_WRITE_EMAIL ?? 'pm@octapm-e2e.test'
const password = process.env.E2E_WRITE_PASSWORD ?? 'DemoPassw0rd!'
const apiBase = process.env.MOBILE_API_URL ?? 'http://localhost:5000/api/v1'
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

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function raiseRfi(request: APIRequestContext, headers: Record<string, string>, projectId: string, subject: string) {
  const created = await request.post(`${apiBase}/projects/${projectId}/rfi`, { headers, data: { subject, question: 'Raised by the M9 checks', status: 'open' } })
  expect(created.status()).toBe(201)
  return ((await created.json()) as { data: { id: string; ref: string } }).data
}

test.describe('M9 on the web target', () => {
  test('a web-platform record link opens the record in the app through the opener', async ({ page, request }) => {
    const { headers } = await apiSession(request)
    await signIn(page)
    const projectId = (await currentProjectId(page))!
    const stamp = Date.now()
    const rfi = await raiseRfi(request, headers, projectId, `E2E deep link ${stamp}`)

    // The link the server puts in a notification, as an email or the web would hand it over.
    await page.goto(`/open?link=${encodeURIComponent(`/projects/${projectId}/rfi?recordId=${rfi.id}&source=rfi`)}`)
    await expect(page.getByTestId('screen-rfi').last()).toBeVisible()
    await expect(page.getByText(`E2E deep link ${stamp}`).first()).toBeVisible()

    // The app's own route with the project named, as the scheme and the native intent hook deliver it.
    await page.goto(`/open?to=${encodeURIComponent(`/rfi/${rfi.id}`)}&projectId=${projectId}`)
    await expect(page.getByTestId('screen-rfi').last()).toBeVisible()
    await expect(page.getByText(`E2E deep link ${stamp}`).first()).toBeVisible()

    // A link that names nothing the app has lands on Home rather than a broken screen.
    await page.goto(`/open?link=${encodeURIComponent('/projects/not-a-project/anything')}`)
    await expect(page.getByTestId('screen-home')).toBeVisible()
  })

  test('a record raised through the API reaches the open list without a reload', async ({ page, request }) => {
    const { headers } = await apiSession(request)
    await signIn(page)
    const projectId = (await currentProjectId(page))!
    await page.goto('/rfi')
    await expect(page.getByTestId('screen-rfis').first()).toBeVisible()
    await expect(page.getByTestId('freshness').first()).toBeVisible()
    const stamp = Date.now()
    const subject = `E2E realtime ${stamp}`
    await expect(page.getByText(subject)).toHaveCount(0)
    await raiseRfi(request, headers, projectId, subject)
    // The socket's event marks the list stale and the screen refetches on its own.
    await expect(page.getByText(subject).first()).toBeVisible({ timeout: 15_000 })
    expect(page.url()).toContain('/rfi')
  })

  test('the web target registers no native push device', async ({ page }) => {
    const pushCalls: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/notifications/push/subscriptions')) pushCalls.push(r.method())
    })
    await signIn(page)
    await page.waitForTimeout(1500)
    expect(pushCalls).toEqual([])
  })

  test('a photo is marked up before upload and the marked copy lands on the daily log', async ({ page, request }) => {
    const { headers } = await apiSession(request)
    await signIn(page)
    const projectId = (await currentProjectId(page))!
    await page.goto('/photos')
    await expect(page.getByTestId('screen-photos').first()).toBeVisible()
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('photos-library').first().click()
    await (await chooser).setFiles(evidence)
    await expect(page.getByTestId('prompt-caption')).toBeVisible()
    await expect(page.getByTestId('photo-markup-0')).toContainText('Mark up photo')
    await page.getByTestId('photo-markup-0').click()
    await expect(page.getByTestId('annotate')).toBeVisible()
    await page.getByTestId('annotate-colour-yellow').click()
    const box = await settledBox(page.getByTestId('annotate-canvas'))
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4, { steps: 8 })
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByTestId('annotate-confirm')).toBeEnabled()
    await page.getByTestId('annotate-confirm').click()
    await expect(page.getByTestId('annotate')).toBeHidden()
    await expect(page.getByTestId('photo-markup-0')).toContainText('Marked up')

    const stamp = Date.now()
    await page.getByTestId('prompt-caption-input').fill(`Marked up E2E ${stamp}`)
    const posted = page.waitForResponse((r) => r.url().includes('/attachments') && r.request().method() === 'POST')
    await page.getByTestId('prompt-caption-confirm').click()
    expect((await posted).status()).toBe(201)

    const log = await request.get(`${apiBase}/projects/${projectId}/daily-logs/${localDay(new Date())}`, { headers })
    const logId = ((await log.json()) as { data: { id: string } }).data.id
    const listed = await request.get(`${apiBase}/projects/${projectId}/attachments?recordType=daily_log&recordId=${logId}`, { headers })
    const attachment = items<{ caption: string | null; fileName: string | null }>(((await listed.json()) as { data: never }).data).find((a) => a.caption === `Marked up E2E ${stamp}`)
    expect(attachment).toBeTruthy()
    expect(attachment!.fileName).toMatch(/-marked\.jpg$/)
  })
})
