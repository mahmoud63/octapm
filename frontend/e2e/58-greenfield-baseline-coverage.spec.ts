import { test, expect, type APIRequestContext } from '@playwright/test'
import { API, apiClient } from './support'
import {
  apiJson,
  createProject,
  dropLiveOrg,
  registerLiveOrg,
  signInForm,
  type LiveOrg,
} from './support-workspaces'

/**
 * Owner decision D5 on screen — BOQ allocation coverage is checked at the
 * baseline lock, not at the approval. A greenfield project, walked by its PM:
 *
 *   a bill of two priced rows and an imported XER (staged), submitted for
 *      review: the review panel shows 0 blocking, the BOQ allocations check
 *      as "Before baseline", and Approve enabled — the PM approves it
 *   approved but staged: the next step is the activation, and the mapping
 *      page says to activate first rather than "create or import activities"
 *   activated: Lock Baseline stays disabled, the next step is to map the bill
 *      to the active activities, and the panel links to Project Controls ›
 *      Mapping, which opens with the active activities
 *   mapped (allocations approved): Lock Baseline is enabled and the PM locks it
 *
 * Everything is built through the API in a throwaway "LiveTest <uuid>"
 * organisation, dropped afterwards.
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
  '%R\tT1\tG100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0',
  '%R\tT2\tG200\tPour\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0',
  '%T\tTASKPRED',
  '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
  '%R\tP1\tT2\tT1\tPR_FS\t0',
  '%E',
  '',
].join('\n')

const post = async (client: APIRequestContext, projectId: string, route: string, data: unknown, expected = 200) => {
  const moved = await apiJson(client, 'post', `/projects/${projectId}${route}`, { token: org!.adminToken, data })
  expect(moved.status, `${route} -> ${JSON.stringify(moved.body?.error)}`).toBe(expected)
  return moved.body!.data as Record<string, unknown>
}

const withApi = async <T,>(work: (client: APIRequestContext) => Promise<T>) => {
  const client = await apiClient()
  try {
    return await work(client)
  } finally {
    await client.dispose()
  }
}

test('greenfield: the PM approves the imported schedule with the bill unmapped, activates it, maps the bill, then locks the baseline', async ({ page }) => {
  test.setTimeout(300_000)
  const { projectId, revisionId, items } = await withApi(async (client) => {
    org = await registerLiveOrg(client, 'pc4d5')
    const project = await createProject(client, org.adminToken, `Greenfield D5 ${Date.now()}`)
    const rows: Array<{ id: string; quantity: number }> = []
    for (const [code, description, quantity, rate] of [
      ['1.1', 'Excavation', 10, 12345.5],
      ['1.2', 'Concrete', 20, 2515],
    ] as const) {
      const item = await post(client, project, '/boq/items', { code, description, quantity, unit: 'm3', rate }, 201)
      rows.push({ id: (item as { item: { id: string } }).item.id, quantity })
    }
    const imported = await client.post(`${API}/projects/${project}/import/xer`, {
      headers: { authorization: `Bearer ${org.adminToken}` },
      multipart: { file: { name: 'greenfield.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
    })
    const body = await imported.json()
    expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
    expect(body.data).toMatchObject({ staged: true, imported: 2 })
    const revision = body.data.revisionId as string
    await post(client, project, `/schedule/revisions/${revision}/submit-review`, {})
    return { projectId: project, revisionId: revision, items: rows }
  })

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${projectId}`
  const panel = page.getByTestId('uat-schedule-review')
  const next = page.getByTestId('uat-schedule-review-next')

  // ── Under review: the revision's own logic passes; coverage waits.
  await page.goto(`${base}/schedule/gantt`)
  await expect(panel).toHaveAttribute('data-status', 'under_review', { timeout: 45_000 })
  await expect(page.getByTestId('uat-schedule-review-blocking')).toHaveText('0 blocking')
  const coverageCheck = page.getByTestId('uat-schedule-review-check-allocations')
  await expect(coverageCheck).toContainText('Before baseline')
  await expect(coverageCheck).toContainText('after it is activated')
  await expect(next).toHaveText('Next: approve or reject')
  await expect(panel.getByRole('button', { name: 'Approve' })).toBeEnabled()

  // The PM approves it — the server lets it through with the bill unmapped.
  await panel.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Schedule approved')).toBeVisible({ timeout: 30_000 })
  await expect(panel).toHaveAttribute('data-status', 'approved', { timeout: 30_000 })
  await expect(next).toHaveText('Next: activate this revision (Schedule › Revisions)', { timeout: 30_000 })
  await expect(panel).not.toContainText('Project Controls › Mapping')

  // ── Approved but staged: the mapping page says to activate first.
  await page.goto(`${base}/controls/mapping`)
  await expect(page.getByTestId('uat-mapping-matrix')).toHaveText(
    'The approved schedule revision is not active yet. Activate it on Schedule › Revisions, then map the BOQ rows to its activities here.',
    { timeout: 45_000 },
  )

  // ── Activated: the baseline waits on the mapping, and the panel links to it.
  await withApi((client) => post(client, projectId, `/schedule/revisions/${revisionId}/activate`, { mappings: [] }))
  await page.goto(`${base}/schedule/gantt`)
  await expect(panel).toHaveAttribute('data-status', 'approved', { timeout: 45_000 })
  await expect(next).toHaveText(
    'Next: map the BOQ to the active activities (Project Controls › Mapping), then lock baseline',
    { timeout: 30_000 },
  )
  await expect(panel.getByRole('button', { name: 'Lock Baseline' })).toBeDisabled()
  await expect(page.getByTestId('uat-schedule-review-blocking')).toHaveText('1 blocking')
  await expect(panel).toContainText(
    'Map it to the active activities on Project Controls › Mapping, then lock the baseline.',
    { timeout: 30_000 },
  )
  // No figure of the bill in the reasons.
  for (const figure of ['173,755', '173755', '123,455', '50,300']) {
    await expect(panel).not.toContainText(figure)
  }
  await page.getByTestId('uat-schedule-review-open-mapping').click()
  await expect(page).toHaveURL(/\/controls\/mapping/, { timeout: 30_000 })
  await expect(page.getByTestId('uat-mapping-matrix')).not.toContainText('not active yet', { timeout: 45_000 })
  await expect(page.getByTestId('uat-mapping-matrix')).toContainText('G100')

  // ── Mapped and approved: the PM locks the baseline.
  await withApi(async (client) => {
    const activities = await apiJson(client, 'get', `/projects/${projectId}/activities`, { token: org!.adminToken })
    expect(activities.status).toBe(200)
    type Row = { id: string; activityCode?: string | null; p6ActivityId?: string | null }
    const data = activities.body!.data as unknown as Row[] | { activities?: Row[]; items?: Row[] }
    const list: Row[] = Array.isArray(data) ? data : (data.activities ?? data.items ?? [])
    const byCode = (code: string) => list.find((row) => (row.activityCode || row.p6ActivityId) === code)!.id
    for (const [item, code] of [
      [items[0], 'G100'],
      [items[1], 'G200'],
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
  await page.goto(`${base}/schedule/gantt`)
  await expect(next).toHaveText('Next: lock baseline', { timeout: 45_000 })
  await expect(panel.getByRole('button', { name: 'Lock Baseline' })).toBeEnabled({ timeout: 30_000 })
  await panel.getByRole('button', { name: 'Lock Baseline' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lock baseline' }).click()
  await expect(panel).toHaveAttribute('data-status', 'baselined', { timeout: 30_000 })
})
