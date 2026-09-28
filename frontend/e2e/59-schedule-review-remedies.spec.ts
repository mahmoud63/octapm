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
 * The D5 sweep on screen: the review panel names a step a page offers.
 *
 *   A staged XER with no relationships, under review: the Gantt shows no
 *      activity (it shows the ACTIVE schedule), so the panel never sends
 *      the PM there. It says the revision fails its own checks and that
 *      the fix is a corrected import (Schedule › Update Schedule) or a
 *      rejection. The Update Schedule menu is on that page.
 *   A revision staged beside the active baselined one: the Schedule page
 *      shows a second review panel for it, with its own Submit Review.
 *
 * Everything is built through the API in a throwaway "LiveTest <uuid>"
 * organisation, dropped afterwards.
 */

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

const xer = (linked: boolean) =>
  [
    'ERMHDR\t19.12',
    '%T\tPROJWBS',
    '%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num',
    '%R\tW1\t\tCIV\tCivil\t1',
    '%T\tTASK',
    '%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct',
    '%R\tT1\tG100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0',
    '%R\tT2\tG200\tPour\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0',
    ...(linked
      ? ['%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt', '%R\tP1\tT2\tT1\tPR_FS\t0']
      : []),
    '%E',
    '',
  ].join('\n')

const STAGED_FIX =
  'A staged revision cannot be edited: correct the schedule at its source and import it again, or regenerate it from the BOQ (Schedule › Update Schedule) — the new revision replaces this one, or reject this revision (Schedule Review).'

const post = async (client: APIRequestContext, projectId: string, route: string, data: unknown, expected = 200) => {
  const moved = await apiJson(client, 'post', `/projects/${projectId}${route}`, { token: org!.adminToken, data })
  expect(moved.status, `${route} -> ${JSON.stringify(moved.body?.error)}`).toBe(expected)
  return moved.body!.data as Record<string, unknown>
}

const importXer = async (client: APIRequestContext, projectId: string, linked: boolean) => {
  const imported = await client.post(`${API}/projects/${projectId}/import/xer`, {
    headers: { authorization: `Bearer ${org!.adminToken}` },
    multipart: { file: { name: 'schedule.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(xer(linked)) } },
  })
  const body = await imported.json()
  expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
  return body.data.revisionId as string
}

const withApi = async <T,>(work: (client: APIRequestContext) => Promise<T>) => {
  const client = await apiClient()
  try {
    return await work(client)
  } finally {
    await client.dispose()
  }
}

test('a staged revision failing its own logic: the panel names the corrected import or the rejection, never the empty Gantt', async ({ page }) => {
  test.setTimeout(240_000)
  const { projectId } = await withApi(async (client) => {
    org = await registerLiveOrg(client, 'pc4r7')
    const project = await createProject(client, org.adminToken, `Staged remedy ${Date.now()}`)
    const revision = await importXer(client, project, false)
    await post(client, project, `/schedule/revisions/${revision}/submit-review`, {})
    return { projectId: project }
  })

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  await page.goto(`/o/${org!.segment}/projects/${projectId}/schedule/gantt`)
  const panel = page.getByTestId('uat-schedule-review')
  await expect(panel).toHaveAttribute('data-status', 'under_review', { timeout: 45_000 })
  // The Gantt is the active schedule's, and there is none yet.
  await expect(page.getByText('No activities to display.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('uat-schedule-review-next')).toHaveText(
    'Next: import a corrected schedule or regenerate it (Schedule › Update Schedule), or reject this revision (Schedule Review)'
  )
  await expect(page.getByTestId('uat-schedule-review-fix-predecessors')).toHaveText(`To fix: ${STAGED_FIX}`)
  await expect(panel).not.toContainText(/Schedule › Gantt|Schedule › Critical Path|Schedule › Activities|clear readiness blockers/)
  await expect(panel.getByRole('button', { name: 'Approve' })).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Reject' })).toBeEnabled()
  // The step it names is on this page.
  await page.getByRole('button', { name: 'Update Schedule' }).click()
  await expect(page.getByRole('menuitem', { name: 'Import Schedule (P6/MSP)' })).toBeVisible()
})

test('a revision staged beside the baselined schedule is reviewed on the Schedule page, beside it', async ({ page }) => {
  test.setTimeout(240_000)
  const { projectId, beside } = await withApi(async (client) => {
    if (!org) org = await registerLiveOrg(client, 'pc4r7')
    const project = await createProject(client, org.adminToken, `Staged beside ${Date.now()}`)
    // No baseline without a bill (owner decision 2026-09-28): a one-row bill
    // entered through the BOQ API, mapped to the active schedule before the
    // lock (D5).
    const bill = await post(client, project, '/boq/items', { code: '1.1', description: 'Excavation', quantity: 10, unit: 'm3', rate: 100 }, 201)
    const first = await importXer(client, project, true)
    for (const step of ['submit-review', 'approve']) await post(client, project, `/schedule/revisions/${first}/${step}`, {})
    await post(client, project, `/schedule/revisions/${first}/activate`, { mappings: [] })
    const activities = await apiJson(client, 'get', `/projects/${project}/activities`, { token: org!.adminToken })
    expect(activities.status).toBe(200)
    type Row = { id: string; activityCode?: string | null; p6ActivityId?: string | null }
    const data = activities.body!.data as unknown as Row[] | { activities?: Row[]; items?: Row[] }
    const list: Row[] = Array.isArray(data) ? data : (data.activities ?? data.items ?? [])
    const g100 = list.find((row) => (row.activityCode || row.p6ActivityId) === 'G100')!.id
    const allocation = await post(
      client,
      project,
      '/activity-boq-allocations',
      { boqItemId: (bill as { item: { id: string } }).item.id, activityId: g100, quantity: 10 },
      201,
    )
    for (const step of ['submit', 'approve']) await post(client, project, `/activity-boq-allocations/${String(allocation.id)}/${step}`, {})
    await post(client, project, `/schedule/revisions/${first}/baseline`, {})
    const next = await importXer(client, project, true)
    return { projectId: project, beside: next }
  })

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  await page.goto(`/o/${org!.segment}/projects/${projectId}/schedule/revisions`)
  await expect(page.getByTestId('uat-schedule-review')).toHaveAttribute('data-status', 'baselined', { timeout: 45_000 })
  const staged = page.getByTestId('uat-staged-review')
  await expect(staged).toHaveAttribute('data-status', 'draft')
  await expect(staged).toContainText('Staged revision: XER Import')
  await expect(page.getByTestId('uat-staged-review-next')).toHaveText('Next: submit for review')
  const submitted = page.waitForResponse(
    (r) => r.url().endsWith(`/schedule/revisions/${beside}/submit-review`) && r.request().method() === 'POST'
  )
  await staged.getByRole('button', { name: 'Submit Review' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click()
  expect((await submitted).status()).toBe(200)
  await expect(staged).toHaveAttribute('data-status', 'under_review', { timeout: 30_000 })
  await expect(page.getByTestId('uat-staged-review-next')).toHaveText('Next: approve or reject')
})
