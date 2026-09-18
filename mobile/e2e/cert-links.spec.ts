import { expect, test, type APIRequestContext } from '@playwright/test'
import { ALLOWED_CAPS, accounts, apiBase, apiSession, currentProjectId, findLeaks, isWide, items, localDay, mainProject, signIn, signInScreen, type Headers } from './cert-helpers'

/**
 * Certification: deep links for every record type, through the same
 * resolver the native intent hook and a notification tap use. A record of
 * each type that exists in the end-to-end project is opened from the web
 * platform's own path (the form the server puts in notifications) and
 * must land on its screen; types without a screen must land on a module
 * home or on Home, never on a blank or misleading screen. Then the hard
 * cases: a record that does not exist, a route of the wrong type, a
 * project the person cannot see, and a link opened while signed out.
 */
type Sample = { type: string; slug: string; screen: string; find: (request: APIRequestContext, headers: Headers, projectId: string) => Promise<string | null> }

const first = async <T extends { id: string }>(request: APIRequestContext, headers: Headers, path: string, pick?: (data: never) => T[]): Promise<string | null> => {
  const response = await request.get(`${apiBase}${path}`, { headers })
  if (!response.ok()) return null
  const data = ((await response.json()) as { data: never }).data
  const list = pick ? pick(data) : items<T>(data)
  return list[0]?.id ?? null
}

const SAMPLES: Sample[] = [
  { type: 'rfi', slug: 'rfi', screen: 'screen-rfi', find: (r, h, p) => first(r, h, `/projects/${p}/rfi`) },
  { type: 'change_event', slug: 'commercial/change-events', screen: 'screen-change-event', find: (r, h, p) => first(r, h, `/projects/${p}/change-events`) },
  { type: 'change_order', slug: 'commercial/change-orders', screen: 'screen-change-order', find: (r, h, p) => first(r, h, `/projects/${p}/change-orders`, (d: { orders: { id: string }[] }) => d.orders) },
  { type: 'purchase_order', slug: 'procurement', screen: 'screen-order', find: (r, h, p) => first(r, h, `/projects/${p}/purchase-orders`) },
  { type: 'inventory_item', slug: 'inventory/items', screen: 'screen-item', find: (r, h) => first(r, h, '/inventory/items') },
  { type: 'stock_transfer', slug: 'inventory/transfers', screen: 'screen-transfer', find: (r, h) => first(r, h, '/inventory/transfers') },
  { type: 'ncr', slug: 'quality/ncr', screen: 'screen-ncr', find: (r, h, p) => first(r, h, `/projects/${p}/ncr`) },
  { type: 'form_instance', slug: 'quality/inspections', screen: 'screen-inspection', find: (r, h, p) => first(r, h, `/projects/${p}/forms`) },
  { type: 'punch_item', slug: 'quality/defects', screen: 'screen-punch-item', find: (r, h, p) => first(r, h, `/projects/${p}/punch`) },
  { type: 'safety_incident', slug: 'quality/safety', screen: 'screen-safety-incident', find: (r, h, p) => first(r, h, `/projects/${p}/safety`) },
  { type: 'material_test', slug: 'quality/tests', screen: 'screen-test', find: (r, h, p) => first(r, h, `/projects/${p}/material-tests`) },
  { type: 'task', slug: 'tasks', screen: 'screen-task', find: (r, h, p) => first(r, h, `/tasks?projectId=${p}`) },
  { type: 'activity', slug: 'schedule/activities', screen: 'screen-activity', find: (r, h, p) => first(r, h, `/projects/${p}/activities`) },
  { type: 'timesheet', slug: 'timesheets', screen: 'screen-timesheet', find: (r, h, p) => first(r, h, `/projects/${p}/timesheets`) },
  { type: 'photo', slug: 'photos', screen: 'screen-photo', find: (r, h, p) => first(r, h, `/projects/${p}/photos`) },
  { type: 'commitment', slug: 'commercial/commitments', screen: 'screen-commitment', find: (r, h, p) => first(r, h, `/projects/${p}/commitments`) },
  { type: 'sub_pay_app', slug: 'commercial/pay-apps', screen: 'screen-pay-app', find: (r, h, p) => first(r, h, `/projects/${p}/pay-apps`) },
  { type: 'procurement_package', slug: 'procurement/packages', screen: 'screen-package', find: (r, h, p) => first(r, h, `/projects/${p}/procurement/packages`) },
  { type: 'sheet', slug: 'drawings', screen: 'screen-sheet', find: (r, h, p) => first(r, h, `/projects/${p}/drawings/sheets`) },
]

/** Types with no record screen: the link must land on a module home or on Home, with something to read. */
const NO_SCREEN = [
  { type: 'document', path: (p: string) => `/projects/${p}/documents?recordId=00000000-0000-4000-8000-000000000001`, lands: 'screen-documents' },
  { type: 'material_issue', path: (p: string) => `/projects/${p}/inventory?recordId=00000000-0000-4000-8000-000000000002&source=stock_movement`, lands: 'screen-inventory' },
  { type: 'submittal', path: (p: string) => `/projects/${p}/submittals?recordId=00000000-0000-4000-8000-000000000003&source=submittal`, lands: 'screen-home' },
  { type: 'meeting', path: (p: string) => `/projects/${p}/meetings?recordId=00000000-0000-4000-8000-000000000004&source=meeting`, lands: 'screen-home' },
  { type: 'location', path: (p: string) => `/projects/${p}/locations?recordId=00000000-0000-4000-8000-000000000005&source=location`, lands: 'screen-home' },
  { type: 'daily_log', path: () => `/projects/__P__/site-reporting?date=${localDay(new Date())}`, lands: 'screen-daily-log' },
]

test.describe('certification: deep links', () => {
  test('every record type with a sample opens its own screen from the web platform’s path, and types without a screen land somewhere sensible', async ({ page, request }) => {
    test.setTimeout(300_000)
    const admin = await apiSession(request, accounts.pm)
    const project = await mainProject(request, admin.headers)
    await signIn(page, accounts.pm)
    const outcomes: string[] = []
    const failures: string[] = []
    for (const s of SAMPLES) {
      const id = await s.find(request, admin.headers, project.id)
      if (!id) {
        outcomes.push(`${s.type}: no sample record in the end-to-end project (not exercised)`)
        continue
      }
      await page.goto(`/open?link=${encodeURIComponent(`/projects/${project.id}/${s.slug}?recordId=${id}&source=${s.type}`)}`)
      const screen = page.getByTestId(s.screen).last()
      const ok = await screen.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)
      await page.waitForLoadState('networkidle').catch(() => undefined)
      const leaks = await findLeaks(page, ALLOWED_CAPS)
      outcomes.push(`${s.type}: ${ok ? 'opened ' + s.screen : 'NOT on ' + s.screen} ${leaks.length ? 'LEAK ' + leaks.map((l) => l.sample).join(',') : ''}`)
      if (!ok) failures.push(`${s.type} did not open ${s.screen} from /projects/${project.id}/${s.slug}?recordId=…`)
      if (leaks.length) failures.push(`${s.type}: technical text ${leaks.map((l) => `${l.name}=${l.sample}`).join('; ')}`)
    }
    for (const n of NO_SCREEN) {
      await page.goto(`/open?link=${encodeURIComponent(n.path(project.id).replace('__P__', project.id))}`)
      const ok = await page.getByTestId(n.lands).first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)
      await page.waitForLoadState('networkidle').catch(() => undefined)
      const text = (await page.evaluate(() => document.body.innerText)).trim()
      outcomes.push(`${n.type}: ${ok ? 'landed on ' + n.lands : 'NOT on ' + n.lands}`)
      if (!ok) failures.push(`${n.type} did not land on ${n.lands}`)
      if (text.length < 20) failures.push(`${n.type}: blank screen`)
    }
    test.info().annotations.push({ type: 'matrix', description: outcomes.join('\n') })
    expect(failures, failures.join('\n')).toEqual([])
  })

  test('a record that does not exist, a route of the wrong type and a project the person cannot see all end in a sentence', async ({ page, request }) => {
    const admin = await apiSession(request, accounts.pm)
    const project = await mainProject(request, admin.headers)
    const ncrId = await first(request, admin.headers, `/projects/${project.id}/ncr`)
    await signIn(page, accounts.pm)
    const gone = '00000000-0000-4000-8000-00000000dead'
    for (const route of [`/rfi/${gone}`, `/quality/ncr/${gone}`, `/tasks/${gone}`, `/inventory/items/${gone}`, `/activities/${gone}`, ...(ncrId ? [`/rfi/${ncrId}`] : [])]) {
      await page.goto(route)
      await page.locator('[data-testid^="screen-"]').last().waitFor({ state: 'visible' })
      await expect(page.getByText(/no longer available|not found|does not allow|could not|no access/i).first(), route).toBeVisible({ timeout: 10_000 })
      expect(await findLeaks(page, ALLOWED_CAPS), route).toEqual([])
    }
    // A project outside the person's organisation, named by a link: the opener checks with the server and keeps the current project.
    const beforeProject = await currentProjectId(page)
    await page.goto(`/open?to=${encodeURIComponent(`/rfi/${gone}`)}&projectId=00000000-0000-4000-8000-00000000beef`)
    await expect(page.getByTestId('screen-open')).toBeVisible()
    await expect(page.getByText(/not on that project/i).first()).toBeVisible({ timeout: 10_000 })
    expect(await currentProjectId(page)).toBe(beforeProject)
    expect(await findLeaks(page, ALLOWED_CAPS)).toEqual([])
    // Back on the real project for the specs that follow.
    await page.goto('/projects')
    await page.getByTestId(`project-row-${project.id}`).click()
    await expect(page.getByTestId('screen-home')).toBeVisible()
  })

  test('a link opened while signed out asks for sign-in first, and says where the person lands afterwards', async ({ page, request }) => {
    test.skip(isWide(page), 'layout-independent; runs once on the phone viewport')
    const admin = await apiSession(request, accounts.pm)
    const project = await mainProject(request, admin.headers)
    const rfiId = await first(request, admin.headers, `/projects/${project.id}/rfi`)
    expect(rfiId).toBeTruthy()
    await page.goto(`/rfi/${rfiId}`)
    await expect(signInScreen(page)).toBeVisible()
    await page.getByTestId('sign-in-email').fill(accounts.pm)
    await page.getByTestId('sign-in-password').fill('DemoPassw0rd!')
    await page.getByTestId('sign-in-submit').click()
    await page.locator('[data-testid^="screen-"]').first().waitFor({ state: 'visible' })
    const record = await page.getByTestId('screen-rfi').last().isVisible().catch(() => false)
    const home = await page.getByTestId('screen-home').isVisible().catch(() => false)
    test.info().annotations.push({ type: 'after-sign-in', description: record ? 'returned to the intended record' : home ? 'landed on Home (intended route not kept)' : 'landed elsewhere' })
    expect(record || home).toBe(true)
  })
})
