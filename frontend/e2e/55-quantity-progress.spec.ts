import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { API, apiClient } from './support'
import {
  addMember,
  apiJson,
  createProject,
  dropLiveOrg,
  registerLiveOrg,
  signInForm,
  workspaceToken,
  LIVE_PASSWORD,
  type LiveOrg,
} from './support-workspaces'

/**
 * PC-6 on the web (OCTAPM_PROGRESS_MEASUREMENT §3–§6). A throwaway
 * "LiveTest <uuid>" organisation, every fixture built through the API: a
 * project with an active two-activity programme, a priced BOQ row allocated
 * in full to V100 and approved, V100 measured by quantity, V200 by percent
 * with an approved 40 % and a pending 60 %, and a quantity surveyor whose
 * template takes the BOQ away.
 *
 * Test 1 runs on any server (this branch alone included): the Progress tab
 * names the PROGRESS SOURCE of V200's official and pending figures from the
 * source string, shows installed / planned for V100 (planned typed on the
 * method, installed "—" with a reason until the server reports it), the
 * activity drawer draws the six quantity labels with "—" and one reason
 * when the views are not on the server or are withheld — never a zero —
 * and the daily log has its seventh section with the unit never typed. The
 * surveyor without BOQ read sees the approved percentage and "—" with the
 * server's reason for every per-item quantity.
 *
 * Test 2 is the full walk — daily log → Progress tab pending with the
 * bundled entry → approve → official with the daily log as its source —
 * and skips with its reason when the core endpoints (the activity's
 * allocated items, the daily log's quantities section) are not on this
 * server yet; the orchestrator re-runs it after the merge. It assumes that
 * submitting a day with quantity rows puts one submission bundling them in
 * the approval queue (core's contract).
 */

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

const XER = [
  'ERMHDR\t19.12',
  '%T\tPROJWBS',
  '%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num',
  '%R\tW1\t\tCIV\tCivil\t1',
  '%T\tTASK',
  '%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct',
  '%R\tT1\tV100\tBlockwork\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0',
  '%R\tT2\tV200\tRender\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0',
  '%T\tTASKPRED',
  '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
  '%R\tP1\tT2\tT1\tPR_FS\t0',
  '%E',
  '',
].join('\n')

const withApi = async <T,>(work: (client: APIRequestContext) => Promise<T>) => {
  const client = await apiClient()
  try {
    return await work(client)
  } finally {
    await client.dispose()
  }
}

const call = async (
  client: APIRequestContext,
  method: 'get' | 'post' | 'put' | 'patch',
  route: string,
  { data, token = org!.adminToken, status = 200 }: { data?: unknown; token?: string; status?: number } = {},
) => {
  const moved = await apiJson(client, method, route, { token, data })
  expect(moved.status, `${method} ${route} -> ${JSON.stringify(moved.body?.error)}`).toBe(status)
  return moved.body!.data as Record<string, unknown>
}

const activateSchedule = async (client: APIRequestContext, projectId: string) => {
  const imported = await client.post(`${API}/projects/${projectId}/import/xer`, {
    headers: { authorization: `Bearer ${org!.adminToken}` },
    multipart: { file: { name: 'quantity-progress.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
  })
  const body = await imported.json()
  expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
  const revisionId = body.data.revisionId as string
  for (const step of ['submit-review', 'approve', 'activate']) {
    const moved = await apiJson(client, 'post', `/projects/${projectId}/schedule/revisions/${revisionId}/${step}`, {
      token: org!.adminToken,
      data: step === 'activate' ? { mappings: [] } : {},
    })
    expect(moved.status, `${step} -> ${JSON.stringify(moved.body?.error)}`).toBe(200)
  }
}

type Activity = { id: string; activityCode?: string | null; p6ActivityId?: string | null; pctComplete?: number }

const listActivities = async (client: APIRequestContext, projectId: string, token = org!.adminToken) => {
  const listed = (await call(client, 'get', `/projects/${projectId}/activities`, { token })) as unknown as
    | Activity[]
    | { activities?: Activity[]; items?: Activity[] }
  return Array.isArray(listed) ? listed : (listed.activities ?? listed.items ?? [])
}

type Built = {
  projectId: string
  v100: string
  v200: string
  boqItemId: string
  qsEmail: string
  qsToken: string
  pc6: { allocatedItems: number; dailyLogSection: boolean }
}

let built: Built | null = null
const today = () => new Date().toISOString().slice(0, 10)

/** Builds the fixtures once, and probes which PC-6 core endpoints this server has. */
const build = async () => {
  if (built) return built
  const qsEmail = `live-pc6web-qs-${crypto.randomUUID()}@octapm-live.test`
  built = await withApi(async (client) => {
    org = await registerLiveOrg(client, 'pc6web')
    const projectId = await createProject(client, org.adminToken, `Quantity progress web ${Date.now()}`)
    await activateSchedule(client, projectId)

    const qsId = await addMember(client, org, { name: 'No BOQ Surveyor', email: qsEmail, role: 'qs' })
    const joined = await apiJson(client, 'post', `/projects/${projectId}/team`, { token: org.adminToken, data: { userId: qsId } })
    expect(joined.status, JSON.stringify(joined.body?.error)).toBeLessThan(300)
    const template = await call(client, 'post', '/permissions/templates', {
      data: { name: `No BOQ surveyor ${Date.now()}`, baseRole: 'qs', tools: [{ module: 'boq', level: 'none' }] },
      status: 201,
    })
    await call(client, 'put', `/projects/${projectId}/team/${qsId}/permissions`, { data: { templateId: template.id } })

    // A priced bill: 20 m3 of blockwork, allocated in full to V100 and approved.
    const row = await call(client, 'post', `/projects/${projectId}/boq/items`, {
      data: { code: '1.1', description: 'Blockwork', quantity: 20, unit: 'm3', rate: 500 },
      status: 201,
    })
    const boqItemId = (row.item as { id: string }).id
    const activities = await listActivities(client, projectId)
    const v100 = activities.find((entry) => (entry.activityCode || entry.p6ActivityId) === 'V100')!
    const v200 = activities.find((entry) => (entry.activityCode || entry.p6ActivityId) === 'V200')!
    expect(v100 && v200, 'the imported activities').toBeTruthy()
    const allocation = await call(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
      data: { boqItemId, activityId: v100.id, quantity: 20 },
      status: 201,
    })
    for (const step of ['submit', 'approve']) {
      await call(client, 'post', `/projects/${projectId}/activity-boq-allocations/${allocation.id as string}/${step}`)
    }
    // V100 is measured by quantity: 20 m3 planned (the figure typed on the
    // method; a server with PC-6 core derives it from the allocation).
    await call(client, 'put', `/projects/${projectId}/activities/${v100.id}/progress-method`, {
      data: { method: 'quantity', plannedQuantity: 20, quantityUnit: 'm3', evidenceRequired: false },
    })
    // V200 by percent: an approved 40 % and a pending 60 %.
    const first = await call(client, 'post', `/projects/${projectId}/activities/${v200.id}/progress`, { data: { pctComplete: 40 } })
    await call(client, 'post', `/projects/${projectId}/activities/${v200.id}/progress-submissions/${(first.submission as { id: string }).id}/approve`)
    await call(client, 'post', `/projects/${projectId}/activities/${v200.id}/progress`, { data: { pctComplete: 60 } })

    // Which PC-6 core endpoints does this server have?
    const allocatedItems = (await apiJson(client, 'get', `/projects/${projectId}/activities/${v100.id}/allocated-items`, { token: org.adminToken })).status
    const probe = await apiJson(client, 'get', `/projects/${projectId}/daily-logs/${today()}`, { token: org.adminToken })
    expect(probe.status).toBe(200)
    const dailyLogSection = Boolean((probe.body!.data!.sections as Record<string, unknown>).quantities)

    return {
      projectId,
      v100: v100.id,
      v200: v200.id,
      boqItemId,
      qsEmail,
      qsToken: await workspaceToken(client, qsEmail, org.orgId),
      pc6: { allocatedItems, dailyLogSection },
    }
  })
  return built
}

const projectPath = (projectId: string, rest: string) => `/o/${org!.segment}/projects/${projectId}/${rest}`

const openProgressTab = async (page: Page, projectId: string) => {
  await page.goto(projectPath(projectId, 'schedule/progress'))
  await expect(page.getByText('Approval Queue')).toBeVisible({ timeout: 45_000 })
}

const openActivityDrawer = async (page: Page, projectId: string, activityId: string) => {
  await page.goto(projectPath(projectId, `schedule/gantt?recordId=${activityId}&source=activity`))
  const drawer = page.getByTestId('activity-detail-drawer')
  await expect(drawer).toBeVisible({ timeout: 45_000 })
  await expect(drawer).toHaveAttribute('data-activity-id', activityId)
  return drawer
}

/** The six quantity labels, "—" for every absent figure, never a zero. */
const expectHonestQuantities = async (page: Page, testId: string) => {
  const block = page.getByTestId(testId)
  await expect(block).toBeVisible({ timeout: 30_000 })
  const state = await block.getAttribute('data-state')
  expect(['ok', 'not-on-server', 'withheld', 'error']).toContain(state)
  for (const key of ['installed', 'certified', 'paid', 'received', 'issued', 'committed']) {
    await expect(block.locator(`[data-figure="${key}"]`).first()).toBeVisible()
  }
  // An absent figure is a dash — a value of 0 is never drawn for it.
  const absent = block.locator('[data-figure][data-absent="true"]')
  for (let index = 0; index < (await absent.count()); index += 1) {
    await expect(absent.nth(index)).toContainText('—')
    await expect(absent.nth(index).locator('[data-value]')).toHaveCount(0)
  }
  if (state !== 'ok') {
    await expect(block.getByTestId(`${testId}-${state}`)).toContainText('—')
    expect((await block.getByTestId(`${testId}-${state}`).getAttribute('data-reason')) ?? '').not.toBe('')
  }
  return state
}

test('the Progress tab names every figure’s source, the drawer and the daily log say what the server does not give — on any server', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const { projectId, v100, v200, qsEmail } = await build()

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)

  // ── The Progress tab: PROGRESS SOURCE on the official and the pending figure.
  await openProgressTab(page, projectId)
  const official = page.getByTestId(`uat-progress-source-official-${v200}`)
  await expect(official).toContainText('Progress source')
  await expect(official).toContainText('Manual submission')
  await expect(official).not.toContainText('No approved progress yet')
  const pending = page.getByTestId(`uat-progress-source-pending-${v200}`)
  await expect(pending).toContainText('Manual submission')
  await expect(page.getByTestId(`uat-progress-approved-pct-${v200}`)).toHaveText('40%')
  // V100 has no approved progress yet: said so, not a blank or a zero source.
  await expect(page.getByTestId(`uat-progress-source-official-${v100}`)).toContainText('No approved progress yet')
  // The queue: V200's pending 60 % with its source.
  const queued = page.locator('[data-testid^="uat-progress-queue-"][data-activity-id]').filter({ hasText: 'Render' })
  await expect(queued.first()).toBeVisible()
  await expect(queued.first().locator('[data-progress-source-kind="pending"]')).toContainText('Manual submission')

  // ── V100 by quantity: installed / planned with its basis.
  const installedPlanned = page.getByTestId(`uat-progress-installed-planned-${v100}`)
  await expect(installedPlanned).toBeVisible()
  const planned = page.getByTestId(`uat-progress-planned-${v100}`)
  await expect(planned).toContainText('20')
  await expect(planned).toContainText('m3')
  const plannedBasis = await planned.getAttribute('data-planned-basis')
  expect(['method_config', 'approved_allocations']).toContain(plannedBasis)
  const installed = page.getByTestId(`uat-progress-installed-${v100}`)
  await expect(installed).toBeVisible()
  if ((await installed.getAttribute('data-absent')) === 'true') {
    // Nothing installed yet, or a server that does not report it: a dash and why.
    await expect(installed).toContainText('—')
  }
  // Never a zero drawn as installed.
  await expect(installed.locator('[data-installed-quantity="0"]')).toHaveCount(0)

  // ── The activity drawer: six labels, honest absence.
  await openActivityDrawer(page, projectId, v100)
  await expectHonestQuantities(page, 'activity-detail-quantities-pc6')
  await expect(page.getByTestId('activity-detail-pct')).toBeVisible()
  await expect(page.getByTestId('activity-detail-progress-source')).toContainText('No approved progress yet')

  // ── The renderer against the views contract itself: a server answering
  // the contract (routed here, so it is proven on any server) draws each
  // figure with its truth and unit, a unit-mismatch warning, and "—" with
  // the reason for a figure not available or withheld — never a 0.
  const contract = {
    kind: 'activity',
    id: v100,
    asOf: '2026-09-30T12:00:00.000Z',
    installed: { value: 15, truth: 'derived', basis: 'Σ approved quantity progress entries', unitCode: 'm3', unitMatch: true },
    certified: { value: null, truth: 'source', basis: 'Σ IpcItem.qty on certified or paid certificates', unitCode: 'm3', unitMatch: true, notAvailable: { reason: 'No certified certificate names this item' } },
    paid: { value: 7.5, truth: 'projection', basis: 'certified × amountPaid ÷ totalCert', unitCode: 'm3', unitMatch: true },
    received: { value: 12, truth: 'derived', basis: 'Σ stock receipts', unitCode: 't', unitMatch: false },
    issued: { value: null, truth: 'derived', basis: 'Σ stock issues', unitCode: 'm3', unitMatch: true, notAvailable: { reason: 'No stock movement names this item' } },
    committed: { value: null, truth: 'derived', basis: 'Σ commitment SOV line quantity', unitCode: 'm3', unitMatch: true, withheld: { reason: 'Commitments are not readable by you' } },
  }
  await page.route(`**/activities/${v100}/quantities`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: contract }) }),
  )
  await openActivityDrawer(page, projectId, v100)
  expect(await expectHonestQuantities(page, 'activity-detail-quantities-pc6')).toBe('ok')
  const block = page.getByTestId('activity-detail-quantities-pc6')
  await expect(block.locator('[data-figure="installed"] [data-value]')).toHaveAttribute('data-value', '15')
  await expect(block.locator('[data-figure="installed"] [data-unit]')).toHaveAttribute('data-unit', 'm3')
  await expect(block.locator('[data-figure="installed"] [data-truth]')).toHaveAttribute('data-truth', 'derived')
  await expect(block.locator('[data-figure="paid"] [data-truth]')).toHaveAttribute('data-truth', 'projection')
  await expect(block.locator('[data-figure="paid"]')).toContainText('Paid (pro-rata)')
  await expect(block.locator('[data-figure="received"] [data-unit-mismatch]')).toBeVisible()
  await expect(block.locator('[data-figure="received"] [data-value]')).toHaveAttribute('data-value', '12')
  for (const [key, reason] of [
    ['certified', 'No certified certificate names this item'],
    ['issued', 'No stock movement names this item'],
    ['committed', 'Commitments are not readable by you'],
  ] as const) {
    const figure = block.locator(`[data-figure="${key}"]`)
    await expect(figure).toHaveAttribute('data-absent', 'true')
    await expect(figure).toContainText('—')
    await expect(figure).toContainText(reason)
    await expect(figure.locator('[data-value]')).toHaveCount(0)
  }
  await expect(block.locator('[data-figure="committed"]')).toContainText('Committed quantity (excluding variations)')
  await expect(block.locator('[data-value="0"]')).toHaveCount(0)
  await page.unroute(`**/activities/${v100}/quantities`)

  // ── The daily log: the seventh section, unit never typed, quantity ≥ 0.
  await page.goto(projectPath(projectId, `site-reporting?recordId=${today()}&source=daily_log`))
  const section = page.getByTestId('uat-dailylog-section-quantities')
  await expect(section).toBeVisible({ timeout: 45_000 })
  await expect(section).toContainText('Quantities installed')
  await expect(section).toContainText('never changes official progress by itself')
  await section.getByTestId('uat-dailylog-add-quantities').click()
  const form = page.getByTestId('uat-dailylog-form-quantities')
  await expect(form).toBeVisible()
  await expect(form.getByTestId('uat-dailylog-quantities-unit')).toHaveAttribute('readonly', '')
  await expect(form.getByTestId('uat-dailylog-quantities-quantity')).toHaveAttribute('min', '0')
  await expect(form.getByTestId('uat-dailylog-save-quantities')).toBeDisabled()
  await form.getByTestId('uat-dailylog-quantities-activity').click()
  await page.getByRole('option', { name: /V100/ }).click()
  // The item picker, or the server's reason for having none — never an
  // empty picker that reads as "no allocations".
  const unavailable = form.getByTestId('uat-dailylog-quantities-items-unavailable')
  const picker = form.getByTestId('uat-dailylog-quantities-item')
  await expect(unavailable.or(picker)).toBeVisible({ timeout: 30_000 })
  if (await unavailable.isVisible()) {
    await expect(unavailable).toContainText('—')
    expect(['not-on-server', 'withheld', 'error']).toContain(await unavailable.getAttribute('data-state'))
    await expect(form.getByTestId('uat-dailylog-save-quantities')).toBeDisabled()
  }

  // ── The surveyor without BOQ read: the approved percentage, "—" for the rest.
  const qsContext = await browser.newContext()
  try {
    const qsPage = await qsContext.newPage()
    await qsPage.routeWebSocket(/socket\.io/, () => {})
    await signInForm(qsPage, qsEmail, LIVE_PASSWORD)
    await openProgressTab(qsPage, projectId)
    await expect(qsPage.getByTestId(`uat-progress-approved-pct-${v200}`)).toHaveText('40%')
    await expect(qsPage.getByTestId(`uat-progress-source-official-${v200}`)).toContainText('Manual submission')
    const qsInstalled = qsPage.getByTestId(`uat-progress-installed-${v100}`)
    await expect(qsInstalled).toBeVisible()
    await expect(qsInstalled.locator('[data-installed-quantity]')).toHaveCount(0)
    await expect(qsInstalled).toContainText('—')
    await openActivityDrawer(qsPage, projectId, v100)
    const state = await expectHonestQuantities(qsPage, 'activity-detail-quantities-pc6')
    // On a server with the views, the read is withheld from them, with the reason.
    if (built!.pc6.allocatedItems !== 404) expect(state).toBe('withheld')
    await expect(qsPage.getByTestId('activity-detail-quantities-pc6').locator('[data-value]')).toHaveCount(0)
  } finally {
    await qsContext.close()
  }
})

test('daily log → Progress tab pending with the bundled entry → approve → official, with the daily log as its source; the surveyor without BOQ read sees "—"', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const { projectId, v100, qsEmail } = await build()
  test.skip(
    built!.pc6.allocatedItems === 404 || !built!.pc6.dailyLogSection,
    `PC-6 core is not on this server: allocated-items answered ${built!.pc6.allocatedItems}, daily log quantities section ${built!.pc6.dailyLogSection ? 'present' : 'absent'} — re-run after the core merge`,
  )

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)

  // ── The daily log: 15 m3 of blockwork on V100, in the item's unit.
  await page.goto(projectPath(projectId, `site-reporting?recordId=${today()}&source=daily_log`))
  const section = page.getByTestId('uat-dailylog-section-quantities')
  await expect(section).toBeVisible({ timeout: 45_000 })
  await section.getByTestId('uat-dailylog-add-quantities').click()
  const form = page.getByTestId('uat-dailylog-form-quantities')
  await form.getByTestId('uat-dailylog-quantities-activity').click()
  await page.getByRole('option', { name: /V100/ }).click()
  await form.getByTestId('uat-dailylog-quantities-item').click()
  await page.getByRole('option', { name: /1\.1/ }).click()
  await expect(form.getByTestId('uat-dailylog-quantities-unit')).toHaveValue('m3')
  await form.getByTestId('uat-dailylog-quantities-quantity').fill('15')
  await form.getByTestId('uat-dailylog-quantities-notes').fill('LiveTest: north wall')
  const [saved] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/entries/quantities') && response.request().method() === 'POST'),
    form.getByTestId('uat-dailylog-save-quantities').click(),
  ])
  expect(saved.status(), await saved.text()).toBeLessThan(300)
  const row = section.locator('[data-testid="uat-dailylog-entry-quantities"]').first()
  await expect(row).toContainText('15')
  await expect(row).toContainText('m3')
  await expect(section.getByTestId('uat-dailylog-quantities-by-unit')).toContainText('not official progress')
  await expect(section.getByTestId('uat-dailylog-quantities-by-unit').locator('[data-unit="m3"]')).toHaveAttribute('data-quantity', '15')

  // Nothing official moved: the daily log never changes progress by itself.
  const beforeSubmit = await withApi(async (client) => listActivities(client, projectId))
  expect(beforeSubmit.find((entry) => entry.id === v100)!.pctComplete).toBe(0)

  // ── Submit the day: a pending entry, bundled in a submission the approvers see.
  // A day whose only rows are quantities is a day with entries: a refusal
  // here (DAILY_LOG_EMPTY) means the server's day totals leave the seventh
  // section out — a core defect, named rather than worked around.
  const [submitted] = await Promise.all([
    page.waitForResponse((response) => /\/daily-logs\/[^/]+\/submit$/.test(response.url()) && response.request().method() === 'POST'),
    page.getByTestId('uat-dailylog-submit').click(),
  ])
  expect(submitted.status(), `submitting a day with only quantity rows: ${await submitted.text()}`).toBe(200)
  await expect(page.getByTestId('uat-dailylog-status')).toHaveText('Submitted', { timeout: 30_000 })
  const afterSubmit = await withApi(async (client) => listActivities(client, projectId))
  expect(afterSubmit.find((entry) => entry.id === v100)!.pctComplete, 'official progress is unchanged by the submission').toBe(0)

  await openProgressTab(page, projectId)
  const queued = page.locator('[data-testid^="uat-progress-queue-"][data-activity-id]').filter({ hasText: 'Blockwork' }).first()
  await expect(queued).toBeVisible({ timeout: 30_000 })
  await expect(queued.locator('[data-progress-source-kind="pending"]')).toContainText('Daily log')
  await expect(queued.locator('[data-progress-source-kind="pending"]')).toContainText(today())
  const bundle = queued.locator('[data-testid^="uat-progress-queue-entries-"]')
  await expect(bundle).toBeVisible()
  const entry = bundle.locator('[data-testid^="uat-progress-queue-entry-"]').first()
  await expect(entry).toContainText('1.1')
  await expect(entry.locator('[data-entry-quantity]')).toHaveAttribute('data-entry-quantity', '15')
  await expect(entry.locator('[data-entry-unit]')).toHaveAttribute('data-entry-unit', 'm3')
  await expect(page.getByTestId(`uat-progress-source-pending-${v100}`)).toContainText('Daily log')

  // ── Approve from the Progress tab: the figure is official, its source the daily log.
  const [approved] = await Promise.all([
    page.waitForResponse((response) => /progress-submissions\/[^/]+\/approve/.test(response.url()) && response.request().method() === 'POST'),
    queued.getByRole('button', { name: 'Approve' }).click(),
  ])
  expect(approved.status(), await approved.text()).toBe(200)
  await expect(page.getByTestId(`uat-progress-approved-pct-${v100}`)).toHaveText('75%', { timeout: 30_000 })
  const official = page.getByTestId(`uat-progress-source-official-${v100}`)
  await expect(official).toContainText('Daily log')
  await expect(official).toContainText(today())
  const installed = page.getByTestId(`uat-progress-installed-${v100}`)
  await expect(installed.locator('[data-installed-quantity]').first()).toHaveAttribute('data-installed-quantity', '15')
  await expect(installed.locator('[data-installed-unit]').first()).toHaveAttribute('data-installed-unit', 'm3')
  const planned = page.getByTestId(`uat-progress-planned-${v100}`)
  await expect(planned).toHaveAttribute('data-planned-basis', 'approved_allocations')
  await expect(page.getByTestId(`uat-progress-planned-readonly-${v100}`)).toBeDisabled()

  // The official figure through the API: 15 of 20 = 75 %.
  const afterApprove = await withApi(async (client) => listActivities(client, projectId))
  expect(afterApprove.find((entry) => entry.id === v100)!.pctComplete).toBe(75)

  // ── The drawer: installed 15 m3 with its truth, the rest honest.
  await openActivityDrawer(page, projectId, v100)
  expect(await expectHonestQuantities(page, 'activity-detail-quantities-pc6')).toBe('ok')
  const drawerInstalled = page.getByTestId('activity-detail-quantities-pc6').locator('[data-figure="installed"]').first()
  await expect(drawerInstalled.locator('[data-value]')).toHaveAttribute('data-value', '15')

  // ── The surveyor without BOQ read: 75 % stays, every per-item quantity is "—" with the reason.
  const qsContext = await browser.newContext()
  try {
    const qsPage = await qsContext.newPage()
    await qsPage.routeWebSocket(/socket\.io/, () => {})
    await signInForm(qsPage, qsEmail, LIVE_PASSWORD)
    await openProgressTab(qsPage, projectId)
    await expect(qsPage.getByTestId(`uat-progress-approved-pct-${v100}`)).toHaveText('75%')
    await expect(qsPage.getByTestId(`uat-progress-source-official-${v100}`)).toContainText('Daily log')
    const qsInstalled = qsPage.getByTestId(`uat-progress-installed-${v100}`)
    await expect(qsInstalled).toHaveAttribute('data-absent', 'true')
    await expect(qsInstalled).toContainText('—')
    expect(((await qsInstalled.getAttribute('title')) ?? '').length, 'the server reason is shown').toBeGreaterThan(0)
    await expect(qsInstalled.locator('[data-installed-quantity]')).toHaveCount(0)
    await openActivityDrawer(qsPage, projectId, v100)
    expect(await expectHonestQuantities(qsPage, 'activity-detail-quantities-pc6')).toBe('withheld')
    await expect(qsPage.getByTestId('activity-detail-quantities-pc6').locator('[data-value]')).toHaveCount(0)
  } finally {
    await qsContext.close()
  }
})
