import { expect, test } from '@playwright/test'
import { ALLOWED_CAPS, accounts, addToProject, apiBase, apiSession, currentProjectId, ensureTempUser, findLeaks, getData, isWide, items, mainProject, signIn, tempUserEmail, tempUserPassword, withIsolationProject } from './cert-helpers'

/**
 * Certification: project isolation, cached previous-project data, a role
 * change, and forbidden modules, through the app's screens with the server
 * as the authority. A second project ("Cert Isolation") in the end-to-end
 * organisation is created once and reused; the demo organisation is never
 * touched.
 */
async function firstRfi(requestHeaders: Record<string, string>, request: Parameters<typeof getData>[0], projectId: string, subjectIfNone: string) {
  const list = items(await getData<{ items: { id: string; subject: string }[] }>(request, requestHeaders, `/projects/${projectId}/rfi`))
  if (list.length) return list[0]!
  const created = await request.post(`${apiBase}/projects/${projectId}/rfi`, { headers: requestHeaders, data: { subject: subjectIfNone, question: 'Raised by the certification run', status: 'open' } })
  expect(created.status()).toBe(201)
  return ((await created.json()) as { data: { id: string; subject: string } }).data
}

test.describe('certification: isolation and authorization through the app', () => {
  test('switching project leaves nothing of the previous project on screen, and its records refuse to open', async ({ page, request }) => {
    const admin = await apiSession(request, accounts.pm)
    const a = await mainProject(request, admin.headers)
    const rfiA = await firstRfi(admin.headers, request, a.id, `Cert isolation A ${Date.now()}`)
    await withIsolationProject(request, admin.headers, async (b) => {

    await signIn(page, accounts.pm)
    await page.goto('/projects')
    await page.getByTestId(`project-row-${a.id}`).click()
    await expect(page.getByTestId('screen-home')).toBeVisible()
    await page.goto('/rfi')
    await expect(page.getByTestId(`rfi-row-${rfiA.id}`).first()).toBeVisible()

    await page.goto('/projects')
    await page.getByTestId(`project-row-${b.id}`).click()
    await expect(page.getByTestId('screen-home')).toBeVisible()
    await expect(page.getByText(b.name).first()).toBeVisible()
    await page.goto('/rfi')
    await expect(page.getByTestId('screen-rfis').first()).toBeVisible()
    await expect(page.getByTestId('freshness').first()).toBeVisible()
    await expect(page.getByTestId(`rfi-row-${rfiA.id}`)).toHaveCount(0)
    await expect(page.getByText(rfiA.subject)).toHaveCount(0)

    // A record of the previous project, opened by its route while the other project is current, is refused by the server.
    await page.goto(`/rfi/${rfiA.id}`)
    await expect(page.getByTestId('screen-rfi').last()).toBeVisible()
    await expect(page.getByText(rfiA.subject)).toHaveCount(0)
    await expect(page.getByText(/no longer available|not found|could not|no access/i).first()).toBeVisible()
    expect(await findLeaks(page, ALLOWED_CAPS)).toEqual([])

    // Back to the main project for the specs that follow.
    await page.goto('/projects')
    await page.getByTestId(`project-row-${a.id}`).click()
    await expect(page.getByTestId('screen-home')).toBeVisible()
    })
  })

  test('a person outside a project cannot reach its records through a link or the API', async ({ page, request }) => {
    test.skip(isWide(page), 'layout-independent; runs once on the phone viewport')
    const admin = await apiSession(request, accounts.pm)
    const a = await mainProject(request, admin.headers)
    const temp = await ensureTempUser(request, admin.headers, 'site_engineer')
    await addToProject(request, admin.headers, a.id, temp.id, 'site_engineer')
    await withIsolationProject(request, admin.headers, async (b) => {
    const rfiB = await firstRfi(admin.headers, request, b.id, `Cert isolation B ${Date.now()}`)

    const outsider = await apiSession(request, tempUserEmail, tempUserPassword)
    const direct = await request.get(`${apiBase}/projects/${b.id}/rfi/${rfiB.id}`, { headers: outsider.headers })
    expect([403, 404]).toContain(direct.status())

    await signIn(page, tempUserEmail, tempUserPassword)
    await page.goto(`/open?to=${encodeURIComponent(`/rfi/${rfiB.id}`)}&projectId=${b.id}`)
    // The opener asks the server before switching project, so the person is told plainly and their own project is kept.
    await expect(page.getByTestId('screen-open')).toBeVisible()
    await expect(page.getByText(/not on that project/i).first()).toBeVisible()
    await expect(page.getByText(rfiB.subject)).toHaveCount(0)
    expect(await currentProjectId(page)).not.toBe(b.id)
    expect(await findLeaks(page, ALLOWED_CAPS)).toEqual([])
    })
  })

  test('a project role change takes effect on the next load, on the screen and on the server', async ({ page, request }) => {
    test.skip(isWide(page), 'layout-independent; runs once on the phone viewport')
    const admin = await apiSession(request, accounts.pm)
    const a = await mainProject(request, admin.headers)
    const temp = await ensureTempUser(request, admin.headers, 'site_engineer')
    // The project assignment role is what the server enforces and what the matrix reports (source "assignment").
    const assign = async (role: string) => {
      await request.delete(`${apiBase}/projects/${a.id}/team/${temp.id}`, { headers: admin.headers })
      const added = await request.post(`${apiBase}/projects/${a.id}/team`, { headers: admin.headers, data: { userId: temp.id, role } })
      expect([200, 201], `assign ${role}`).toContain(added.status())
    }
    await assign('site_engineer')

    await signIn(page, tempUserEmail, tempUserPassword)
    await expect(page.getByTestId('quick-rfi')).toHaveCount(1)
    await assign('warehouse')
    await page.reload()
    await expect(page.getByTestId('screen-home')).toBeVisible()
    await expect(page.getByTestId('freshness').first()).toBeVisible()
    await expect(page.getByTestId('quick-rfi')).toHaveCount(0)
    await page.goto('/controls')
    await expect(page.getByTestId('screen-controls')).toBeVisible()
    await expect(page.getByTestId('controls-inventory')).toHaveCount(1)
    const asWarehouse = await apiSession(request, tempUserEmail, tempUserPassword)
    const create = await request.post(`${apiBase}/projects/${a.id}/rfi`, { headers: asWarehouse.headers, data: { subject: `Cert role change ${Date.now()}`, question: 'Should be refused', status: 'open' } })
    expect(create.status()).toBe(403)
    await assign('site_engineer')
  })

  test('a module the role cannot use is never a blank screen or a technical error', async ({ page }) => {
    await signIn(page, accounts.site)
    for (const route of ['/commercial/pay-apps', '/commercial/change-orders', '/procurement/orders']) {
      await page.goto(route)
      await page.waitForTimeout(800)
      const text = (await page.evaluate(() => document.body.innerText)).trim()
      expect(text.length, `${route} shows something`).toBeGreaterThan(20)
      expect(await findLeaks(page, ALLOWED_CAPS), route).toEqual([])
    }
  })
})
