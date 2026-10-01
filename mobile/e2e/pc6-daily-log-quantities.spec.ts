/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiBase, isWide, items, localDay } from './cert-helpers'

/**
 * PC-6 on the field app: quantities installed, recorded from the site.
 *
 * A site engineer records a quantity against an allocated BOQ item in the
 * daily log without a signal; the entry waits in the outbox, goes once when
 * the signal returns, and when the reply to that send is lost the retry
 * carries the same replay key and the server still holds one row. The
 * entry is never shown as official — it reads "awaiting approval" with
 * its source — and the web Progress tab's register (read here through the
 * API) holds it as a pending entry. A member the server withholds the bill
 * from sees a dash and the reason, never a zero; a member who may not
 * submit progress sees no form at all; the activity screen names PROGRESS
 * SOURCE and counts what is waiting.
 *
 * Every fixture is built through the API in a throwaway "LiveTest <uuid>"
 * organisation (registered through sign-up, given a plan by
 * backend/scripts/e2e/live-org.js, dropped afterwards). Nothing here signs
 * in to the demo, UAT or E2E organisations. Runs against a web export of
 * this checkout pointed at an API of its own (MOBILE_WEB_URL,
 * MOBILE_API_URL), never :8081.
 *
 * Where the server does not yet carry the quantities section of the daily
 * log (the day's answer has no `sections.quantities`), the checks that need
 * it skip with that reason; the orchestrator re-runs them after the core
 * track merges.
 */

const PASSWORD = 'Live-Passw0rd!9a'
const MOBILE = { 'x-octapm-client': 'mobile' }
const backend = path.resolve(__dirname, '..', '..', 'backend')

const liveOrg = (command: 'activate' | 'drop', orgId: string) => {
  const result = spawnSync(process.execPath, [path.join('scripts', 'e2e', 'live-org.js'), command, orgId], { cwd: backend, env: process.env, encoding: 'utf8', timeout: 120_000 })
  if (result.status !== 0) throw new Error(`live-org ${command} ${orgId} failed (exit ${result.status}): ${result.stderr || result.stdout}`)
}

type Json = { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } }

const call = async (client: APIRequestContext, method: 'get' | 'post' | 'put' | 'patch' | 'delete', route: string, { token, data }: { token?: string; data?: unknown } = {}) => {
  const response = await client.fetch(`${apiBase}${route}`, { method: method.toUpperCase(), headers: { ...MOBILE, ...(token ? { authorization: `Bearer ${token}` } : {}) }, data })
  const body: Json | null = await response.json().catch(() => null)
  return { status: response.status(), body }
}

const must = async (client: APIRequestContext, method: 'get' | 'post' | 'put' | 'patch' | 'delete', route: string, token: string, data?: unknown, status = 200) => {
  const answer = await call(client, method, route, { token, data })
  expect(answer.status, `${method} ${route} -> ${JSON.stringify(answer.body?.error)}`).toBe(status)
  return answer.body!.data as Record<string, unknown>
}

const XER = [
  'ERMHDR\t19.12',
  '%T\tPROJWBS',
  '%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num',
  '%R\tW1\t\tCIV\tCivil\t1',
  '%T\tTASK',
  '%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct',
  '%R\tT1\tQ100\tBlockwork to external walls\tW1\t80\t80\t2026-02-02 08:00\t2026-02-13 17:00\t2026-02-02 08:00\t2026-02-13 17:00\t0\t0',
  '%R\tT2\tQ200\tScreed to ground floor\tW1\t40\t40\t2026-02-16 08:00\t2026-02-20 17:00\t2026-02-16 08:00\t2026-02-20 17:00\t0\t0',
  '%T\tTASKPRED',
  '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
  '%R\tP1\tT2\tT1\tPR_FS\t0',
  '%E',
  '',
].join('\n')

interface Fixture {
  orgId: string
  adminToken: string
  projectId: string
  activityId: string
  activityName: string
  boqItemId: string
  itemDescription: string
  siteEmail: string
  siteToken: string
  noBoqEmail: string
  financeEmail: string
  /** Whether the server's day carries the quantities section at all. */
  sectionOnServer: boolean
}

let fx: Fixture | null = null

/**
 * The organisation registered by beforeAll, recorded the moment sign-up
 * succeeds — before anything that could still fail — so that it is dropped
 * whether the rest of the fixture was built or threw halfway: a fixture
 * failure after sign-up must not leave a "LiveTest <uuid>" organisation on
 * the shared database. Dropping it once clears the record, so the drop in
 * beforeAll's failure path and the one in afterAll cannot double up.
 */
let registeredOrgId: string | null = null
const dropRegisteredOrg = () => {
  const orgId = registeredOrgId
  if (!orgId) return
  registeredOrgId = null
  try {
    liveOrg('drop', orgId)
  } catch (error) {
    process.stderr.write(`[e2e] ${String(error)}\n`)
  }
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(300_000)
  const id = crypto.randomUUID()
  const adminEmail = `live-pc6m-${id}@octapm-live.test`
  const registered = await call(request, 'post', '/auth/register', { data: { orgName: `LiveTest ${id}`, name: 'PC6 Mobile Admin', email: adminEmail, password: PASSWORD } })
  expect(registered.status, `register: ${JSON.stringify(registered.body?.error)}`).toBe(201)
  const user = registered.body!.data!.user as { id: string; orgId: string }
  const adminToken = (registered.body!.data!.tokens as { accessToken: string }).accessToken
  registeredOrgId = user.orgId
  try {
    fx = await buildFixture(request, { id, orgId: user.orgId, adminToken })
  } catch (error) {
    dropRegisteredOrg()
    throw error
  }
})

/** Everything after sign-up: the plan, the project, the schedule, the BOQ row and its allocation, the three members. */
async function buildFixture(request: APIRequestContext, { id, orgId, adminToken }: { id: string; orgId: string; adminToken: string }): Promise<Fixture> {
  liveOrg('activate', orgId)
  await must(request, 'post', `/organisations/${orgId}/convert`, adminToken)

  const project = await must(request, 'post', '/projects', adminToken, { name: `PC6 quantities ${Date.now()}`, type: 'building', startDate: '2026-01-05', endDate: '2026-12-18' }, 201)
  const projectId = project.id as string

  // An active schedule, so the activities exist and progress can be recorded against them.
  const imported = await request.post(`${apiBase}/projects/${projectId}/import/xer`, { headers: { ...MOBILE, authorization: `Bearer ${adminToken}` }, multipart: { file: { name: 'pc6.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } } })
  const importBody = (await imported.json()) as Json
  expect(imported.status(), JSON.stringify(importBody?.error)).toBe(201)
  const revisionId = importBody.data!.revisionId as string
  for (const step of ['submit-review', 'approve', 'activate']) {
    await must(request, 'post', `/projects/${projectId}/schedule/revisions/${revisionId}/${step}`, adminToken, step === 'activate' ? { mappings: [] } : {})
  }
  const activities = items(await must(request, 'get', `/projects/${projectId}/activities`, adminToken) as unknown as { id: string; name: string; activityCode: string | null }[])
  const activity = activities.find((a) => a.activityCode === 'Q100' || a.name === 'Blockwork to external walls')
  expect(activity, 'the imported activity').toBeTruthy()

  // A BOQ row, allocated to the activity and approved — the one item the site may record against.
  const item = await must(request, 'post', `/projects/${projectId}/boq/items`, adminToken, { code: 'BW-100', description: 'Blockwork 200 mm to external walls', quantity: 480, unit: 'm2', rate: 65 }, 201)
  const boqItemId = ((item.item as { id?: string } | undefined)?.id ?? item.id) as string
  expect(boqItemId, `boq item id from ${JSON.stringify(item).slice(0, 200)}`).toBeTruthy()
  const allocation = await must(request, 'post', `/projects/${projectId}/activity-boq-allocations`, adminToken, { boqItemId, activityId: activity!.id, quantity: 480, amount: 31200 }, 201)
  const allocationId = ((allocation.allocation as { id?: string } | undefined)?.id ?? allocation.id) as string
  await must(request, 'post', `/projects/${projectId}/activity-boq-allocations/${allocationId}/submit`, adminToken, {})
  await must(request, 'post', `/projects/${projectId}/activity-boq-allocations/${allocationId}/approve`, adminToken, {})
  await must(request, 'put', `/projects/${projectId}/activities/${activity!.id}/progress-method`, adminToken, { method: 'quantity', plannedQuantity: 480, quantityUnit: 'm2' })

  // Three members: a site engineer assigned to the activity; one whose template withholds the bill; a finance reader.
  const member = async (label: string, role: string) => {
    const email = `live-pc6m-${label}-${id}@octapm-live.test`
    const created = await must(request, 'post', '/users', adminToken, { name: `PC6 ${label}`, email, role, password: PASSWORD }, 201)
    await must(request, 'post', `/projects/${projectId}/team`, adminToken, { userId: created.id, role }, 201)
    return { id: created.id as string, email }
  }
  const site = await member('site', 'site_engineer')
  const noBoq = await member('noboq', 'site_engineer')
  const finance = await member('finance', 'finance')
  await must(request, 'patch', `/projects/${projectId}/activities/${activity!.id}`, adminToken, { engineerIds: [site.id, noBoq.id] })
  const template = await must(request, 'post', '/permissions/templates', adminToken, { name: `LiveTest site, no BOQ ${id.slice(0, 8)}`, baseRole: 'site_engineer', tools: [{ module: 'boq', level: 'none' }] }, 201)
  await must(request, 'put', `/projects/${projectId}/team/${noBoq.id}/permissions`, adminToken, { templateId: template.id })

  const login = await call(request, 'post', '/auth/login', { data: { email: site.email, password: PASSWORD } })
  expect(login.status).toBe(200)
  const siteToken = (login.body!.data!.tokens as { accessToken: string }).accessToken
  const day = (await must(request, 'get', `/projects/${projectId}/daily-logs/${localDay(new Date())}`, siteToken)) as { sections?: Record<string, unknown> }
  const sectionOnServer = !!day.sections && 'quantities' in day.sections

  return { orgId, adminToken, projectId, activityId: activity!.id, activityName: activity!.name, boqItemId, itemDescription: 'Blockwork 200 mm to external walls', siteEmail: site.email, siteToken, noBoqEmail: noBoq.email, financeEmail: finance.email, sectionOnServer }
}

test.afterAll(() => {
  dropRegisteredOrg()
})

/** Sign in on the field app; the one project is chosen when the server lists it. */
async function signIn(page: Page, email: string) {
  await page.goto('/sign-in')
  await page.getByTestId('sign-in-email').fill(email)
  await page.getByTestId('sign-in-password').fill(PASSWORD)
  await page.getByTestId('sign-in-submit').click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  const first = page.locator('[data-testid^="choose-"], [data-testid="freshness"]').first()
  await first.waitFor({ state: 'visible' })
  if ((await first.getAttribute('data-testid'))?.startsWith('choose-')) {
    await first.click()
    await expect(page.getByTestId('freshness').first()).toBeVisible()
  }
}

const quantitiesRoute = (projectId: string) => `/projects/${projectId}/daily-logs/${localDay(new Date())}/entries/quantities`

/** The day's quantity rows carrying a given replay key, as the server holds them. */
const rowsWithKey = async (request: APIRequestContext, key: string) => {
  const day = (await must(request, 'get', `/projects/${fx!.projectId}/daily-logs/${localDay(new Date())}`, fx!.adminToken)) as { sections: { quantities?: { id: string; clientRequestId: string | null; quantity: number; unitCode?: string | null; boqItemId?: string | null; activityId?: string | null }[] } }
  return (day.sections.quantities ?? []).filter((row) => row.clientRequestId === key)
}

type Figure = { value: number | string | null; unitCode: string | null; notAvailable?: { reason: string } | null }

/** The first few words of a reason, enough to tell the server's sentence from the app's "Not available". */
const opening = (reason: string) => reason.split(/\s+/).slice(0, 5).join(' ')

/** Each of the six lines on the activity screen against the figure the server gave for it (or the whole answer's withholding). */
async function expectFigureLines(page: Page, figures: Record<string, Figure | null>, withheldReason: string | null) {
  await expect(page.getByTestId('activity-quantities')).toBeVisible()
  for (const key of ['received', 'issued', 'installed', 'certified', 'paid', 'committed']) {
    const line = page.getByTestId(`activity-quantity-${key}`)
    const figure = figures[key] ?? null
    const reason = figure?.notAvailable?.reason ?? (figure == null ? withheldReason : null) ?? withheldReason
    if (reason) {
      await expect(line, key).toContainText('—')
      await expect(line, `${key}: the server's reason`).toContainText(opening(reason))
      await expect(line, `${key}: never a zero in place of a withheld figure`).not.toContainText(/\b0\b/)
    } else {
      expect(figure?.value, `${key}: a served figure has a value`).not.toBeNull()
      await expect(line, `${key}: the figure in its unit`).toContainText(`${Number(figure!.value)}${figure!.unitCode ? ` ${figure!.unitCode}` : ''}`)
      await expect(line, `${key}: no dash for a served figure`).not.toContainText('—')
    }
  }
}

test.describe('PC-6: quantities installed, recorded from site', () => {
  test.beforeEach(({ page }) => {
    test.skip(isWide(page), 'layout-independent; runs once on the phone viewport')
  })

  test('captured offline, sent once when the signal returns, replayed once more after a lost reply — one row, pending, with its source', async ({ page, context, request }) => {
    test.setTimeout(180_000)
    test.skip(!fx!.sectionOnServer, 'the daily log on this server does not carry the quantities section yet (PC-6 core not merged)')
    await signIn(page, fx!.siteEmail)
    await page.goto('/site')
    await expect(page.getByTestId('screen-daily-log')).toBeVisible()
    await expect(page.getByTestId('daily-log-section-quantities')).toBeVisible()

    // Warm the lists the form needs — the activities and the activity's allocated items — so offline they can still be chosen.
    await page.getByTestId('daily-log-add-quantities').click()
    await expect(page.getByTestId('entry-sheet-quantities')).toBeVisible()
    await page.getByTestId('entry-activity').click()
    const allocations = page.waitForResponse((r) => r.url().includes('/activity-boq-allocations') && r.request().method() === 'GET')
    await page.getByTestId(`entry-activity-option-${fx!.activityId}`).click()
    expect((await allocations).status()).toBe(200)
    await page.getByTestId('entry-item').click()
    await expect(page.getByTestId(`entry-item-option-${fx!.boqItemId}`)).toContainText(fx!.itemDescription)
    await expect(page.getByTestId(`entry-item-option-${fx!.boqItemId}`)).toContainText('m2')
    await page.getByTestId('entry-item-done').click()
    await page.getByTestId('entry-cancel').click()

    // Without a signal: the same form, filled from what was warmed, saved to the outbox.
    await context.setOffline(true)
    await expect(page.getByTestId('connectivity-bar')).toContainText('Offline')
    await page.getByTestId('daily-log-add-quantities').click()
    await page.getByTestId('entry-activity').click()
    await page.getByTestId(`entry-activity-option-${fx!.activityId}`).click()
    await page.getByTestId('entry-item').click()
    await page.getByTestId(`entry-item-option-${fx!.boqItemId}`).click()
    await page.getByTestId('entry-quantity').fill('25')
    await page.getByTestId('entry-notes').fill('East elevation, grid 1-4')
    await page.getByTestId('entry-save').click()
    await expect(page.getByTestId('daily-log-queued')).toContainText('Saved to the outbox')
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('octapm.offline.outbox:v1:items') ?? '[]') as { kind: string; status: string; clientRequestId: string; payload: { section: string; body: Record<string, unknown> } }[])
    const queued = stored.find((i) => i.payload?.section === 'quantities')
    expect(queued, 'the entry waits in the outbox').toBeTruthy()
    expect(queued!.kind).toBe('daily-log.entry')
    expect(queued!.status).toBe('waiting')
    expect(queued!.clientRequestId).toMatch(/[0-9a-f-]{20,}/)
    expect(queued!.payload.body).toMatchObject({ activityId: fx!.activityId, boqItemId: fx!.boqItemId, unitCode: 'm2', quantity: 25, clientRequestId: queued!.clientRequestId })

    // The signal returns, but the reply to the first send is lost after the
    // server has handled it: the retry carries the same key, and the server
    // replays rather than doubling.
    const sends: number[] = []
    await page.route((url) => url.pathname.endsWith('/entries/quantities'), async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      sends.push(Date.now())
      if (sends.length === 1) {
        await route.fetch()
        return route.abort('failed')
      }
      return route.continue()
    })
    const landed = page.waitForResponse((r) => r.url().endsWith('/entries/quantities') && r.request().method() === 'POST' && r.status() === 201, { timeout: 60_000 })
    await context.setOffline(false)
    const response = await landed
    expect(sends.length, 'the first send was lost, the second landed').toBeGreaterThanOrEqual(2)
    expect((response.request().postDataJSON() as { clientRequestId: string }).clientRequestId).toBe(queued!.clientRequestId)

    // One row on the server for that key — after the lost send, after the retry, and after one more replay by hand.
    expect(await rowsWithKey(request, queued!.clientRequestId)).toHaveLength(1)
    const replayed = await call(request, 'post', quantitiesRoute(fx!.projectId), { token: fx!.siteToken, data: queued!.payload.body })
    expect([200, 201]).toContain(replayed.status)
    const rows = await rowsWithKey(request, queued!.clientRequestId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ boqItemId: fx!.boqItemId, activityId: fx!.activityId })
    expect(Number(rows[0]!.quantity), 'the quantity, however the server serialises its Decimal').toBe(25)

    // On the phone: sent, and shown as pending with its source — never as official.
    await page.goto('/outbox')
    await expect(page.locator('[data-testid^="outbox-item-"]').filter({ hasText: 'Quantities entry' })).toContainText('Sent')
    await page.goto('/site')
    const line = page.getByTestId('daily-log-section-quantities').locator('[data-testid^="daily-log-entry-"]').filter({ hasText: fx!.itemDescription })
    await expect(line).toHaveCount(1)
    await expect(line).toContainText('25 m2')
    await expect(line).toContainText('awaiting approval · source daily log')
    await expect(line).not.toContainText('Approved')

    // The web Progress tab's register, read through the API: the entry is there, pending, from the daily log —
    // and nothing is official: the activity's approved figure is untouched.
    const register = await call(request, 'get', `/projects/${fx!.projectId}/quantity-progress?activityId=${fx!.activityId}`, { token: fx!.adminToken })
    if (register.status === 404) {
      test.info().annotations.push({ type: 'skipped-assertion', description: 'GET /quantity-progress is not on this server yet (PC-6 core not merged); the register assertion is left to the re-run' })
    } else {
      expect(register.status).toBe(200)
      const entries = items(register.body!.data as unknown as { items?: Record<string, unknown>[] } | Record<string, unknown>[])
      const mine = entries.filter((e) => e.activityId === fx!.activityId && e.boqItemId === fx!.boqItemId)
      expect(mine.length, 'exactly one pending entry for the one row').toBe(1)
      expect(mine[0]).toMatchObject({ source: 'daily_log', status: 'submitted' })
      expect(Number(mine[0]!.quantity)).toBe(25)
    }
    // The server answers pctComplete 0 for an activity with no approved
    // ActivityProgress at all (activity.service sanitizeActivity), so a 0 %
    // cannot tell "no approved row" from "an approved 0 %": the approved
    // row's own stamp and source say whether one exists, and the approval
    // status must not read approved.
    const activity = (await must(request, 'get', `/projects/${fx!.projectId}/activities/${fx!.activityId}`, fx!.adminToken)) as { pctComplete: number | null; approvedProgressUpdatedAt: string | null; approvedProgressSource: string | null; progressApprovalStatus: string | null }
    expect(activity.approvedProgressUpdatedAt, 'no ActivityProgress row was approved by the capture').toBeNull()
    expect(activity.approvedProgressSource).toBeNull()
    expect(activity.progressApprovalStatus).not.toBe('approved')
  })

  test('the activity screen names PROGRESS SOURCE and counts the quantities awaiting approval', async ({ page, request }) => {
    await signIn(page, fx!.siteEmail)
    await page.goto(`/activities/${fx!.activityId}`)
    await expect(page.getByTestId('screen-activity')).toBeVisible()
    await expect(page.getByTestId('activity-progress-source')).toContainText('No approved progress yet')
    const register = await call(request, 'get', `/projects/${fx!.projectId}/quantity-progress?activityId=${fx!.activityId}&status=submitted`, { token: fx!.adminToken })
    if (register.status === 404) {
      await expect(page.getByTestId('activity-pending-quantities')).toHaveCount(0)
      test.info().annotations.push({ type: 'skipped-assertion', description: 'no quantity register on this server yet: the pending count is (rightly) absent' })
    } else {
      const count = items(register.body!.data as unknown as { items?: unknown[] } | unknown[]).length
      await expect(page.getByTestId('activity-pending-quantities')).toContainText(`${count} quantit${count === 1 ? 'y' : 'ies'} awaiting approval`)
    }

    // The five figures and the committed one, line by line against the
    // server's own answer (views: the figures sit under `figures`): a figure
    // the server gave is printed in its unit — a genuine 0 included — and
    // one it did not carries a dash and the server's reason, never the
    // app's own sentence and never a zero.
    const figuresAnswer = await call(request, 'get', `/projects/${fx!.projectId}/activities/${fx!.activityId}/quantities`, { token: fx!.siteToken })
    if (figuresAnswer.status === 404) {
      await expect(page.getByTestId('activity-quantities')).toHaveCount(0)
      test.info().annotations.push({ type: 'skipped-assertion', description: 'no quantity views on this server yet: the figures card is (rightly) absent' })
    } else {
      expect(figuresAnswer.status).toBe(200)
      const served = figuresAnswer.body!.data as { figures?: Record<string, Figure | null>; withheld?: boolean; reason?: string }
      expect(served.withheld, 'the site engineer may read the BOQ').toBeFalsy()
      expect(served.figures, 'the server folds the figures under `figures`').toBeTruthy()
      await expectFigureLines(page, served.figures!, null)
    }

    // A member the server withholds the bill from: every line a dash with the server's reason.
    if (figuresAnswer.status !== 404) {
      await page.goto('/more')
      await page.getByTestId('sign-out').click()
      await expect(page.getByTestId('sign-in-submit')).toBeVisible()
      await signIn(page, fx!.noBoqEmail)
      await page.goto(`/activities/${fx!.activityId}`)
      await expect(page.getByTestId('screen-activity')).toBeVisible()
      const noBoqLogin = await call(request, 'post', '/auth/login', { data: { email: fx!.noBoqEmail, password: PASSWORD } })
      const noBoqToken = (noBoqLogin.body!.data!.tokens as { accessToken: string }).accessToken
      const withheld = (await must(request, 'get', `/projects/${fx!.projectId}/activities/${fx!.activityId}/quantities`, noBoqToken)) as { figures?: Record<string, Figure | null>; withheld?: boolean; reason?: string }
      expect(withheld.withheld, 'the server withholds the bill from this member').toBe(true)
      expect(withheld.reason).toBeTruthy()
      await expectFigureLines(page, withheld.figures ?? {}, withheld.reason!)
    }
  })

  test('a member the server withholds the bill from sees a dash and the reason, never a zero; a member without progress submit sees no form', async ({ page }) => {
    test.skip(!fx!.sectionOnServer, 'the daily log on this server does not carry the quantities section yet (PC-6 core not merged)')
    await signIn(page, fx!.noBoqEmail)
    await page.goto('/site')
    await expect(page.getByTestId('screen-daily-log')).toBeVisible()
    await page.getByTestId('daily-log-add-quantities').click()
    await page.getByTestId('entry-activity').click()
    const refused = page.waitForResponse((r) => r.url().includes('/activity-boq-allocations') && r.request().method() === 'GET')
    await page.getByTestId(`entry-activity-option-${fx!.activityId}`).click()
    expect((await refused).status(), 'the server withholds the bill').toBe(403)
    const withheld = page.getByTestId('entry-item-withheld')
    await expect(withheld).toBeVisible()
    await expect(withheld).toContainText('—')
    await expect(withheld).toContainText(/permission|role does not allow/i)
    await expect(page.getByTestId('entry-item')).toHaveCount(0)
    await page.getByTestId('entry-quantity').fill('25')
    await expect(page.getByTestId('entry-save')).toBeDisabled()
    await expect(withheld).not.toContainText('0')
    await page.getByTestId('entry-cancel').click()

    // Sign out, then a reader without progress submit: no Add on any section, no form.
    await page.goto('/more')
    await page.getByTestId('sign-out').click()
    await expect(page.getByTestId('sign-in-submit')).toBeVisible()
    await signIn(page, fx!.financeEmail)
    await page.goto('/site')
    await expect(page.getByTestId('screen-daily-log')).toBeVisible()
    await expect(page.getByTestId('daily-log-add-quantities')).toHaveCount(0)
    await expect(page.getByTestId('daily-log-add-manpower')).toHaveCount(0)
    await expect(page.getByTestId('site-continue')).toHaveCount(0)
  })
})
