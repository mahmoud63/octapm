import { expect, test } from '@playwright/test'
import { ALLOWED_CAPS, accounts, addToProject, apiBase, apiSession, ensureTempUser, findLeaks, isWide, mainProject, removeFromProject, signIn, signInScreen, signOut, tempUserEmail, tempUserPassword } from './cert-helpers'

/**
 * Certification: authentication and session edge cases on the web target,
 * against the one OctaPM backend. A temporary person in the end-to-end
 * organisation is deactivated, removed from the project and reactivated
 * by the run; nothing else is touched. Layout-independent, so it runs on
 * the phone viewport only.
 */
test.describe('certification: authentication and session', () => {
  test.beforeEach(({ page }) => {
    test.skip(isWide(page), 'layout-independent; runs once on the phone viewport')
  })

  test('a wrong password is refused with a plain sentence and no technical text', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByTestId('sign-in-email').fill(accounts.pm)
    await page.getByTestId('sign-in-password').fill('not-the-password')
    await page.getByTestId('sign-in-submit').click()
    await expect(page.getByRole('alert').first()).toBeVisible()
    await expect(signInScreen(page)).toBeVisible()
    const alert = await page.getByRole('alert').first().innerText()
    expect(alert.length).toBeGreaterThan(10)
    expect(await findLeaks(page, ALLOWED_CAPS)).toEqual([])
    test.info().annotations.push({ type: 'message', description: alert })
  })

  test('a deactivated person is signed out with a reason and cannot sign in again', async ({ page, request }) => {
    const admin = await apiSession(request, accounts.pm)
    const project = await mainProject(request, admin.headers)
    const temp = await ensureTempUser(request, admin.headers, 'site_engineer')
    await addToProject(request, admin.headers, project.id, temp.id, 'site_engineer')
    await signIn(page, tempUserEmail, tempUserPassword)
    await expect(page.getByTestId('screen-home')).toBeVisible()

    expect((await request.patch(`${apiBase}/users/${temp.id}/deactivate`, { headers: admin.headers })).status()).toBe(200)
    // The next request is refused, the refresh is refused, and the app ends the session with its reason.
    await page.goto('/rfi')
    await expect(signInScreen(page)).toBeVisible({ timeout: 20_000 })
    const reasonLine = page.getByText(/Your session ended|Your access was changed/)
    await expect(reasonLine.first()).toBeVisible()
    const reason = await reasonLine.first().innerText()
    expect(reason.length).toBeGreaterThan(10)
    expect(await findLeaks(page, ALLOWED_CAPS)).toEqual([])
    test.info().annotations.push({ type: 'reason', description: reason })

    const refused = await request.post(`${apiBase}/auth/login`, { headers: { 'x-octapm-client': 'mobile' }, data: { email: tempUserEmail, password: tempUserPassword } })
    expect([401, 403]).toContain(refused.status())
    // Reactivated for the checks that follow.
    expect((await request.patch(`${apiBase}/users/${temp.id}/activate`, { headers: admin.headers })).status()).toBe(200)
  })

  test('losing project access ends at a plain sentence and the project leaves the list, not at data', async ({ page, request }) => {
    const admin = await apiSession(request, accounts.pm)
    const project = await mainProject(request, admin.headers)
    const temp = await ensureTempUser(request, admin.headers, 'site_engineer')
    await addToProject(request, admin.headers, project.id, temp.id, 'site_engineer')
    await signIn(page, tempUserEmail, tempUserPassword)
    await page.goto('/rfi')
    await expect(page.getByTestId('screen-rfis').first()).toBeVisible()
    await expect(page.getByTestId('freshness').first()).toBeVisible()

    await removeFromProject(request, admin.headers, project.id, temp.id)
    const direct = await request.get(`${apiBase}/projects/${project.id}/rfi`, { headers: (await apiSession(request, tempUserEmail, tempUserPassword)).headers })
    expect([403, 404]).toContain(direct.status())

    await page.reload()
    // Either the list refuses with a sentence or the app drops the project and asks for another; never rows, never a code.
    await expect(page.getByRole('alert').or(page.getByText(/choose a project|no longer|access/i)).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid^="rfi-row-"]')).toHaveCount(0)
    expect(await findLeaks(page, ALLOWED_CAPS)).toEqual([])
    await page.goto('/projects')
    await expect(page.getByTestId('screen-projects')).toBeVisible()
    await expect(page.getByTestId(`project-row-${project.id}`)).toHaveCount(0)
    // Access restored for the other certification specs.
    await addToProject(request, admin.headers, project.id, temp.id, 'site_engineer')
  })

  test('a forbidden action is refused by the server whatever a screen might show', async ({ request }) => {
    const admin = await apiSession(request, accounts.pm)
    const site = await apiSession(request, accounts.site)
    const project = await mainProject(request, admin.headers)
    const stamp = Date.now()
    const created = await request.post(`${apiBase}/projects/${project.id}/activities`, { headers: admin.headers, data: { name: `Cert forbidden ${stamp}`, activityCode: `CFB-${stamp % 100000}`, category: 'structural', startDate: '2026-09-01', endDate: '2026-12-31', budget: 100, engineerIds: [site.user.id] } })
    expect(created.status()).toBe(201)
    const activityId = ((await created.json()) as { data: { id: string } }).data.id
    const submitted = await request.post(`${apiBase}/projects/${project.id}/activities/${activityId}/progress`, { headers: site.headers, data: { pctComplete: 5, status: 'submitted', source: 'mobile', notes: 'cert' } })
    expect([200, 201]).toContain(submitted.status())
    const submissionId = ((await submitted.json()) as { data: { submission: { id: string } } }).data.submission.id
    const approve = await request.post(`${apiBase}/projects/${project.id}/activities/${activityId}/progress-submissions/${submissionId}/approve`, { headers: site.headers, data: {} })
    expect(approve.status()).toBe(403)
    const body = (await approve.json()) as { success: boolean; error: { code: string; message: string; requestId?: string } }
    expect(body.success).toBe(false)
    expect(body.error.message.length).toBeGreaterThan(5)
    const rfi = await request.post(`${apiBase}/projects/${project.id}/rfi`, { headers: admin.headers, data: { subject: `Cert forbidden RFI ${stamp}`, question: 'May a site engineer approve this?', status: 'open' } })
    const rfiId = ((await rfi.json()) as { data: { id: string } }).data.id
    expect((await request.post(`${apiBase}/projects/${project.id}/rfi/${rfiId}/approve`, { headers: site.headers, data: {} })).status()).toBe(403)
    // Tidy.
    expect((await request.post(`${apiBase}/projects/${project.id}/activities/${activityId}/progress-submissions/${submissionId}/reject`, { headers: admin.headers, data: { reason: 'certification run' } })).status()).toBe(200)
  })

  test('signing out leaves nothing behind for the back button and needs a fresh sign-in', async ({ page }) => {
    await signIn(page, accounts.pm)
    await page.goto('/rfi')
    await expect(page.getByTestId('screen-rfis').first()).toBeVisible()
    await signOut(page)
    await page.goBack()
    await expect(signInScreen(page)).toBeVisible()
    await expect(page.locator('[data-testid^="rfi-row-"]')).toHaveCount(0)
    await page.goto('/rfi')
    await expect(signInScreen(page)).toBeVisible()
    // Browser storage on the web target holds no bearer or refresh token in plain text.
    const tokens = await page.evaluate(() => {
      const found: string[] = []
      for (const store of [localStorage, sessionStorage]) {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i)!
          const value = store.getItem(key) ?? ''
          if (/eyJ[A-Za-z0-9_-]{10,}\./.test(value)) found.push(key)
        }
      }
      return found
    })
    test.info().annotations.push({ type: 'storage-after-sign-out', description: tokens.length ? tokens.join(', ') : 'no token-shaped values' })
    expect(tokens).toEqual([])
  })
})
