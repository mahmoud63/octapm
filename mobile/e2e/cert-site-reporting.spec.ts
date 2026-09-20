import { expect, test } from '@playwright/test'
import { accounts, apiBase, apiSession, getData, isWide, items, mainProject, openModule, signIn } from './cert-helpers'

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Certification: a working day, recorded from the site.
 *
 * The daily report is the one thing a site engineer is judged on having done,
 * and it is written standing up, in pieces, between other jobs. So these
 * checks follow the day rather than the screen: what is already down, what the
 * crew and the plant were, what went wrong, and then handing it to the office.
 * Every figure is read back from the server afterwards, because a report that
 * only looks right on the phone is worth nothing to the people reading it.
 */
test.describe('certification: a day recorded from site', () => {
  test.beforeEach(({ page }) => {
    test.skip(isWide(page), 'layout-independent; runs once on the phone viewport')
  })

  test('the report opens on what the day already amounts to', async ({ page }) => {
    await signIn(page, accounts.site)
    await openModule(page, 'site')
    await expect(page.getByTestId('screen-daily-log')).toBeVisible()

    // The tally leads, so a person can see at a glance what is missing.
    const status = page.getByTestId('site-status')
    await expect(status).toBeVisible()
    for (const line of ['work', 'manpower', 'man-hours', 'equipment', 'deliveries', 'visitors', 'delays', 'constraints']) {
      await expect(status.getByTestId(`site-status-${line}`)).toBeVisible()
    }
    await expect(page.getByTestId('site-status-date')).toBeVisible()
  })

  test('the crew, the plant and the time lost go down, and the report follows', async ({ page, request }) => {
    const stamp = Date.now() % 100000
    await signIn(page, accounts.site)
    await openModule(page, 'site')
    await expect(page.getByTestId('screen-daily-log')).toBeVisible()

    // The crew.
    await page.getByTestId('daily-log-add-manpower').click()
    await page.getByTestId('entry-companyName').fill(`E2E Crew ${stamp}`)
    await page.getByTestId('entry-trade').fill('Steelfixers')
    await page.getByTestId('entry-workers').fill('7')
    await page.getByTestId('entry-hours').fill('9')
    const manpower = page.waitForResponse((r) => r.url().endsWith('/entries/manpower') && r.request().method() === 'POST')
    await page.getByTestId('entry-save').click()
    expect((await manpower).status()).toBe(201)

    // The report's own tally moves with it: 7 workers, 63 man-hours.
    await expect(page.getByTestId('site-status-manpower')).toContainText('7 workers')
    await expect(page.getByTestId('site-status-man-hours')).toContainText('63')

    // The time lost, which is the line a claim is later argued from.
    await page.getByTestId('daily-log-add-delays').click()
    // A delay is a kind, an amount of time and what happened, in that order.
    await page.getByTestId('entry-choice-material').click()
    await page.getByTestId('entry-description').fill(`E2E late delivery ${stamp}`)
    await page.getByTestId('entry-hoursLost').fill('2')
    const delay = page.waitForResponse((r) => r.url().endsWith('/entries/delays') && r.request().method() === 'POST')
    await page.getByTestId('entry-save').click()
    expect((await delay).status()).toBe(201)
    await expect(page.getByTestId('site-status-delays')).toContainText('2 h lost')

    // And the server agrees, which is the only version that matters.
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const log = await getData<{ totals: { workers: number; manHours: number; hoursLost: number } }>(request, pm.headers, `/projects/${project.id}/daily-logs/${localDay()}`)
    expect(log.totals.workers).toBeGreaterThanOrEqual(7)
    expect(log.totals.manHours).toBeGreaterThanOrEqual(63)
    expect(log.totals.hoursLost).toBeGreaterThanOrEqual(2)
  })

  test('the day carries its photographs, what is holding the work up, and what tomorrow needs', async ({ page }) => {
    await signIn(page, accounts.site)
    await openModule(page, 'site')
    await expect(page.getByTestId('screen-daily-log')).toBeVisible()

    // Photographs are the one evidence system, not a second photo table.
    await expect(page.getByTestId('site-photos')).toBeVisible()

    // Constraints are the lookahead's own; the report points at them.
    const constraints = page.getByTestId('site-constraints')
    await expect(constraints).toBeVisible()
    await expect(constraints.getByTestId('site-constraints-open')).toBeVisible()

    // Safety and quality summarise; the records live in their own modules.
    await expect(page.getByTestId('site-safety')).toBeVisible()
    await expect(page.getByTestId('site-quality')).toBeVisible()

    // Tomorrow is the lookahead's, so the report does not keep a second plan.
    await expect(page.getByTestId('site-tomorrow')).toBeVisible()
  })

  test('the days behind today are one tap away and open the report for that day', async ({ page }) => {
    await signIn(page, accounts.site)
    await openModule(page, 'site')
    await page.getByTestId('site-previous').click()
    await expect(page.getByTestId('screen-site-previous')).toBeVisible()
    await expect(page.getByTestId('site-span-14')).toBeVisible()
  })

  test('the report is handed to the office, and the office has it', async ({ page, request }) => {
    const stamp = Date.now() % 100000
    await signIn(page, accounts.site)
    await openModule(page, 'site')
    await expect(page.getByTestId('screen-daily-log')).toBeVisible()

    // Something has to be on the day before it can be handed over.
    await page.getByTestId('daily-log-add-visitors').click()
    await page.getByTestId('entry-name').fill(`E2E visitor ${stamp}`)
    await page.getByTestId('entry-company').fill('E2E Consulting')
    const added = page.waitForResponse((r) => r.url().endsWith('/entries/visitors') && r.request().method() === 'POST')
    await page.getByTestId('entry-save').click()
    expect((await added).status()).toBe(201)

    const submitted = page.waitForResponse((r) => r.url().endsWith('/submit') && r.request().method() === 'POST')
    await page.getByTestId('daily-log-submit').click()
    expect((await submitted).status()).toBe(200)

    // The person is told plainly, and the server holds the same answer.
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const log = await getData<{ status: string; submittedAt: string | null }>(request, pm.headers, `/projects/${project.id}/daily-logs/${localDay()}`)
    expect(['submitted', 'approved']).toContain(log.status)
    expect(log.submittedAt).toBeTruthy()

    // Put the day back as it was found. A submitted day closes its sections,
    // and every later spec that records anything on today would find the Add
    // buttons gone — the suite would be failing on what this test left behind
    // rather than on the code, which is the whole point of the reset.
    const reopened = await request.post(`${apiBase}/projects/${project.id}/daily-logs/${localDay()}/reopen`, { headers: pm.headers, data: { reason: 'certification' } })
    expect(reopened.status(), 'the day is left open for the rest of the run').toBe(200)
  })

  test('the project manager sees the day the site recorded, without it being typed twice', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const before = await getData<{ totals: { workers: number } }>(request, pm.headers, `/projects/${project.id}/daily-logs/${localDay()}`)

    await signIn(page, accounts.pm)
    // Home carries the day's figures for a project manager, read from the same log.
    const today = page.getByTestId('pm-today-on-site')
    await expect(today).toBeVisible()
    if (before.totals.workers > 0) await expect(today).toContainText(String(before.totals.workers))

    // And nothing on Home is a second copy: opening the report shows the same tally.
    await page.goto('/site')
    await expect(page.getByTestId('screen-daily-log')).toBeVisible()
    await expect(page.getByTestId('site-status-manpower')).toContainText(String(before.totals.workers))

    const activities = items(await getData<{ items: unknown[] } | unknown[]>(request, pm.headers, `/projects/${project.id}/activities`))
    expect(activities.length).toBeGreaterThan(0)
  })
})
