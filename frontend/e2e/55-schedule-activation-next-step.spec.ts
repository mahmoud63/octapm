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
 * PC-4 merge gate round 5 — an approved schedule revision that is still
 * staged (imported, submitted and approved, not yet activated) is not the
 * schedule yet, and the Schedule page's review panel says what to do next:
 * activate it on Schedule › Revisions. It no longer says "Next: lock
 * baseline", and the baseline blockers beside it name the activation instead
 * of "No schedule activities exist" or "Generate or import a schedule".
 * Activated, the next step is the baseline lock.
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
  '%R\tT1\tA100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0',
  '%R\tT2\tA200\tFrame\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0',
  '%T\tTASKPRED',
  '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
  '%R\tP1\tT2\tT1\tPR_FS\t0',
  '%E',
  '',
].join('\n')

const ACTIVATION_BLOCKER =
  'This approved schedule revision has not been activated yet. Activate it on Schedule › Revisions; its baseline can be locked after that.'

const step = async (client: APIRequestContext, projectId: string, route: string, data: unknown = {}) => {
  const moved = await apiJson(client, 'post', `/projects/${projectId}${route}`, { token: org!.adminToken, data })
  expect(moved.status, `${route} -> ${JSON.stringify(moved.body?.error)}`).toBe(200)
}

test('an approved staged revision names its activation as the next step, and the baseline blockers say the same', async ({ page }) => {
  test.setTimeout(180_000)
  const client = await apiClient()
  const { projectId, revisionId } = await (async () => {
    try {
      org = await registerLiveOrg(client, 'pc4act')
      const project = await createProject(client, org.adminToken, `Staged approval ${Date.now()}`)
      const imported = await client.post(`${API}/projects/${project}/import/xer`, {
        headers: { authorization: `Bearer ${org.adminToken}` },
        multipart: { file: { name: 'staged.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
      })
      const body = await imported.json()
      expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
      expect(body.data).toMatchObject({ staged: true, imported: 2 })
      const revision = body.data.revisionId as string
      await step(client, project, `/schedule/revisions/${revision}/submit-review`)
      await step(client, project, `/schedule/revisions/${revision}/approve`)
      return { projectId: project, revisionId: revision }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${projectId}`
  await page.goto(`${base}/schedule/gantt`)
  const panel = page.getByTestId('uat-schedule-review')
  await expect(panel).toHaveAttribute('data-status', 'approved', { timeout: 45_000 })
  await expect(page.getByTestId('uat-schedule-review-next')).toHaveText(
    'Next: activate this revision (Schedule › Revisions)',
    { timeout: 30_000 },
  )
  await expect(panel.getByRole('button', { name: 'Lock Baseline' })).toBeDisabled()
  // The baseline blockers name the activation, not an absent schedule.
  await expect(panel).toContainText(`Baseline Readiness: ${ACTIVATION_BLOCKER}`, { timeout: 30_000 })
  await expect(panel).toContainText(
    'Activate the approved schedule revision (Schedule › Revisions) before locking the baseline.',
  )
  await expect(panel).not.toContainText('No schedule activities exist')
  await expect(panel).not.toContainText('Generate or import a schedule')
  await expect(panel).not.toContainText('Next: lock baseline')

  // Activated: the revision is the schedule, and the next step is the baseline.
  const again = await apiClient()
  try {
    await step(again, projectId, `/schedule/revisions/${revisionId}/activate`, { mappings: [] })
  } finally {
    await again.dispose()
  }
  await page.reload()
  await expect(page.getByTestId('uat-schedule-review')).toHaveAttribute('data-status', 'approved', { timeout: 45_000 })
  await expect(page.getByTestId('uat-schedule-review-next')).toHaveText('Next: lock baseline', { timeout: 30_000 })
  await expect(page.getByTestId('uat-schedule-review')).not.toContainText(ACTIVATION_BLOCKER)
})
