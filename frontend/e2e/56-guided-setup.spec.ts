import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { API, apiClient } from './support'
import {
  addMember,
  apiJson,
  createProject,
  dropLiveOrg,
  registerLiveOrg,
  signInForm,
  LIVE_PASSWORD,
  type LiveOrg,
} from './support-workspaces'

/**
 * Guided setup (PC-8, owner §32/§33) over the readiness engine, walked on a
 * greenfield project in a throwaway "LiveTest <uuid>" organisation:
 *
 *   fresh: ten stages, the BOQ stage is current and blocked, the baseline
 *      stage refuses Continue (its gate blocks), a warning stage (Locations)
 *      offers "Continue with warning" and moves on; the strip's figures are
 *      the engine's own (GET /setup-readiness)
 *   a planning engineer (no schedule approval) sees "Ask Project Manager …"
 *      where the PM sees Approve; the PM approves through the guide
 *   activated and fully mapped: Mapping PASS, the baseline gate ready — the
 *      baseline stage continues with a warning and offers the lock
 *   value left unmapped again (a new priced row; no route removes an approved
 *      allocation): Mapping back to Blocked, the baseline stage refuses
 *      Continue and names the gate's blockers
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
  '%R\tT1\tS100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0',
  '%R\tT2\tS200\tPour\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0',
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

const post = async (client: APIRequestContext, projectId: string, route: string, data: unknown, expected = 200) => {
  const moved = await apiJson(client, 'post', `/projects/${projectId}${route}`, { token: org!.adminToken, data })
  expect(moved.status, `${route} -> ${JSON.stringify(moved.body?.error)}`).toBe(expected)
  return moved.body!.data as Record<string, unknown>
}

type Headline = { key: string; label?: string; value: string }
const engineHeadline = (projectId: string) =>
  withApi(async (client) => {
    const readiness = await apiJson(client, 'get', `/projects/${projectId}/setup-readiness`, { token: org!.adminToken })
    expect(readiness.status).toBe(200)
    return ((readiness.body!.data as { summary: { headline: Headline[] } }).summary.headline ?? []) as Headline[]
  })

/** Every figure on the strip is the engine's, entry for entry. */
const expectStripIsEngine = async (page: Page, projectId: string) => {
  const headline = await engineHeadline(projectId)
  expect(headline.length).toBeGreaterThan(0)
  await expect(page.getByTestId('setup-guide-strip').locator('> li')).toHaveCount(headline.length)
  for (const entry of headline) {
    const shown = page.getByTestId(`setup-guide-strip-${entry.key}`)
    await expect(shown).toHaveAttribute('data-value', entry.value)
    await expect(shown).toContainText(`${entry.label ?? ''}${entry.value}`)
  }
  return headline
}

const openGuide = async (page: Page, base: string) => {
  await page.goto(base)
  const toggle = page.getByTestId('setup-guide-toggle')
  await expect(toggle).toBeVisible({ timeout: 45_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(page.getByTestId('setup-guide-stepper')).toBeVisible()
}

const stage = (page: Page, key: string) => page.getByTestId(`setup-guide-stage-${key}`)
const panel = (page: Page) => page.getByTestId('setup-guide-panel')

test('guided setup walks the readiness engine: warnings continue, the baseline gate refuses, actions follow permissions', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const { projectId, plannerEmail } = await withApi(async (client) => {
    org = await registerLiveOrg(client, 'pc8guide')
    const project = await createProject(client, org.adminToken, `Guided setup ${Date.now()}`)
    const email = `live-pc8guide-pe-${crypto.randomUUID()}@octapm-live.test`
    const plannerId = await addMember(client, org, { name: 'Planning Engineer', email, role: 'planning_eng' })
    const joined = await apiJson(client, 'post', `/projects/${project}/team`, {
      token: org.adminToken,
      data: { userId: plannerId },
    })
    expect(joined.status, JSON.stringify(joined.body?.error)).toBeLessThan(300)
    return { projectId: project, plannerEmail: email }
  })
  const base = `/o/${org!.segment}/projects/${projectId}`

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)

  // ── Fresh: ten stages; the BOQ stage is current and blocked.
  await openGuide(page, base)
  await expect(page.getByTestId('setup-guide-stepper').locator('> li')).toHaveCount(10)
  await expect(stage(page, 'boq')).toHaveAttribute('data-current', 'true')
  await expect(stage(page, 'boq')).toHaveAttribute('data-status', 'blocked')
  await expect(panel(page)).toHaveAttribute('data-stage', 'boq')
  await expect(page.getByTestId('setup-guide-blockers-NO_BOQ')).toBeVisible()
  await expectStripIsEngine(page, projectId)

  // The baseline stage refuses Continue: its gate blocks.
  await stage(page, 'baseline').click()
  await expect(panel(page)).toHaveAttribute('data-stage', 'baseline')
  await expect(page.getByTestId('setup-guide-continue')).toHaveAttribute('data-mode', 'block')
  await expect(page.getByTestId('setup-guide-continue')).toBeDisabled()

  // A warning stage offers Continue with warning, and Continue moves on.
  await stage(page, 'locations').click()
  await expect(stage(page, 'locations')).toHaveAttribute('data-status', 'attention')
  await expect(page.getByTestId('setup-guide-warnings-NO_LOCATIONS')).toBeVisible()
  const onward = page.getByTestId('setup-guide-continue')
  await expect(onward).toHaveAttribute('data-mode', 'warn')
  await expect(onward).toHaveText(/Continue with warning/)
  await onward.click()
  await expect(panel(page)).toHaveAttribute('data-stage', 'cost_codes')

  // ── The bill and the schedule, staged and under review.
  const { revisionId, items } = await withApi(async (client) => {
    const rows: Array<{ id: string; quantity: number }> = []
    for (const [code, description, quantity, rate] of [
      ['1.1', 'Excavation', 10, 100],
      ['1.2', 'Concrete', 20, 50],
    ] as const) {
      const created = await post(client, projectId, '/boq/items', { code, description, quantity, unit: 'm3', rate }, 201)
      rows.push({ id: (created as { item: { id: string } }).item.id, quantity })
    }
    const imported = await client.post(`${API}/projects/${projectId}/import/xer`, {
      headers: { authorization: `Bearer ${org!.adminToken}` },
      multipart: { file: { name: 'guided.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
    })
    const body = await imported.json()
    expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
    const revision = body.data.revisionId as string
    await post(client, projectId, `/schedule/revisions/${revision}/submit-review`, {})
    return { revisionId: revision, items: rows }
  })

  // ── A planning engineer may not approve: the guide says whom to ask.
  const plannerContext = await browser.newContext()
  try {
    const plannerPage = await plannerContext.newPage()
    await plannerPage.routeWebSocket(/socket\.io/, () => {})
    await signInForm(plannerPage, plannerEmail, LIVE_PASSWORD)
    await openGuide(plannerPage, base)
    await stage(plannerPage, 'validation').click()
    await expect(plannerPage.getByTestId('setup-guide-action-schedule-approve-ask')).toHaveText(
      'Ask Project Manager to approve the schedule revision.',
      { timeout: 30_000 },
    )
    await expect(plannerPage.getByTestId('setup-guide-action-schedule-approve')).toHaveCount(0)
  } finally {
    await plannerContext.close()
  }

  // ── The PM approves through the guide; the one readiness query refreshes.
  await openGuide(page, base)
  await stage(page, 'validation').click()
  await page.getByTestId('setup-guide-action-schedule-approve').click()
  await expect(page.getByText('Schedule approved')).toBeVisible({ timeout: 30_000 })
  await expect(stage(page, 'validation')).toHaveAttribute('data-status', 'complete', { timeout: 30_000 })

  // ── Activated and fully mapped: Mapping PASS, the baseline gate ready.
  await withApi(async (client) => {
    await post(client, projectId, `/schedule/revisions/${revisionId}/activate`, { mappings: [] })
    const activities = await apiJson(client, 'get', `/projects/${projectId}/activities`, { token: org!.adminToken })
    expect(activities.status).toBe(200)
    type Row = { id: string; activityCode?: string | null; p6ActivityId?: string | null }
    const data = activities.body!.data as unknown as Row[] | { activities?: Row[]; items?: Row[] }
    const list: Row[] = Array.isArray(data) ? data : (data.activities ?? data.items ?? [])
    const byCode = (code: string) => list.find((row) => (row.activityCode || row.p6ActivityId) === code)!.id
    for (const [item, code] of [
      [items[0], 'S100'],
      [items[1], 'S200'],
    ] as const) {
      const allocation = await post(
        client,
        projectId,
        '/activity-boq-allocations',
        { boqItemId: item.id, activityId: byCode(code), quantity: item.quantity },
        201,
      )
      for (const step of ['submit', 'approve']) {
        await post(client, projectId, `/activity-boq-allocations/${allocation.id}/${step}`, {})
      }
    }
  })
  await openGuide(page, base)
  await expect(stage(page, 'mapping')).toHaveAttribute('data-status', 'complete', { timeout: 30_000 })
  await stage(page, 'baseline').click()
  await expect(page.getByTestId('setup-guide-continue')).toHaveAttribute('data-mode', 'warn')
  await expect(page.getByTestId('setup-guide-continue')).toBeEnabled()
  await expect(page.getByTestId('setup-guide-action-baseline-lock')).toBeVisible()
  const mapped = await expectStripIsEngine(page, projectId)
  expect(mapped.find((entry) => entry.key === 'mapping')?.value).toBe('100%')

  // ── Value unmapped again: Mapping blocks, and Continue past the baseline is refused.
  await withApi((client) =>
    post(client, projectId, '/boq/items', { code: '1.3', description: 'Blinding', quantity: 5, unit: 'm2', rate: 40 }, 201),
  )
  await openGuide(page, base)
  await expect(stage(page, 'mapping')).toHaveAttribute('data-status', 'blocked', { timeout: 30_000 })
  await expect(stage(page, 'mapping')).toHaveAttribute('data-current', 'true')
  await stage(page, 'baseline').click()
  const refused = page.getByTestId('setup-guide-continue')
  await expect(refused).toHaveAttribute('data-mode', 'block')
  await expect(refused).toBeDisabled()
  await expect(page.getByTestId('setup-guide-gate-blockers-UNALLOCATED_BOQ')).toBeVisible()
  await expect(page.getByTestId('setup-guide-action-baseline-lock')).toHaveCount(0)
  const unmapped = await expectStripIsEngine(page, projectId)
  // The engine gives the unmapped quantity per unit; the strip shows it as given.
  expect(unmapped.find((entry) => entry.key === 'unmapped_quantity')?.value).toBe('5 m2')
})
