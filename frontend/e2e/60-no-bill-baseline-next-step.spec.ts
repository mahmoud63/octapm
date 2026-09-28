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
 * A project with no bill at all, walked by its PM after the schedule is
 * imported, approved and activated:
 *
 *   the review panel's next step names the upload (the setup baseline gate's
 *      first blocker) — never "lock baseline" beside a refused Lock Baseline
 *   the Overview's BOQ Approval card names the upload too — never "approved"
 *      or "locked" under a BOQ Upload card that says nothing was uploaded
 *   the server refuses a direct lock the same way, on both baseline routes,
 *      with 400 BOQ_REQUIRED_FOR_BASELINE, and writes nothing (owner decision
 *      2026-09-28)
 *   the schedule's readiness says it too: one blocking check, the BOQ, with
 *      the upload as its fix — never "0 blocking" beside a refused lock
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
  '%R\tT1\tN100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0',
  '%R\tT2\tN200\tPour\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0',
  '%T\tTASKPRED',
  '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
  '%R\tP1\tT2\tT1\tPR_FS\t0',
  '%E',
  '',
].join('\n')

const post = async (client: APIRequestContext, projectId: string, route: string, data: unknown) => {
  const moved = await apiJson(client, 'post', `/projects/${projectId}${route}`, { token: org!.adminToken, data })
  expect(moved.status, `${route} -> ${JSON.stringify(moved.body?.error)}`).toBe(200)
}

test('no bill: the review panel and the BOQ Approval card name the upload, not the lock', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  let projectId: string
  let revisionId: string
  try {
    org = await registerLiveOrg(client, 'pc4nobill')
    projectId = await createProject(client, org.adminToken, `No bill ${Date.now()}`)
    const imported = await client.post(`${API}/projects/${projectId}/import/xer`, {
      headers: { authorization: `Bearer ${org.adminToken}` },
      multipart: { file: { name: 'nobill.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
    })
    const body = await imported.json()
    expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
    revisionId = body.data.revisionId as string
    for (const step of ['submit-review', 'approve', 'activate']) {
      await post(client, projectId, `/schedule/revisions/${revisionId}/${step}`, step === 'activate' ? { mappings: [] } : {})
    }
  } finally {
    await client.dispose()
  }

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${projectId}`

  // ── The review panel: the upload first, and Lock Baseline refused beside it.
  const panel = page.getByTestId('uat-schedule-review')
  await page.goto(`${base}/schedule/gantt`)
  await expect(panel).toHaveAttribute('data-status', 'approved', { timeout: 45_000 })
  await expect(panel).toContainText('BOQ Upload: No BOQ items have been uploaded.', { timeout: 30_000 })
  await expect(page.getByTestId('uat-schedule-review-next')).toHaveText(
    'Next: upload the BOQ (BOQ page), then lock baseline',
  )
  await expect(panel.getByRole('button', { name: 'Lock Baseline' })).toBeDisabled()
  // The readiness the panel shows is the server's: the BOQ check fails, first,
  // and is the one blocker; its fix is the upload on the BOQ page.
  await expect(page.getByTestId('uat-schedule-review-blocking')).toHaveText('1 blocking')
  await expect(page.getByTestId('uat-schedule-review-check-boq_present')).toContainText(
    'No BOQ has been uploaded; a baseline locks a BOQ mapped to the schedule.',
  )
  await expect(page.getByTestId('uat-schedule-review-fix-boq_present')).toContainText(
    "To fix: Upload the BOQ on the BOQ page, then map it to the schedule's activities (Project Controls › Mapping) and lock the baseline.",
  )

  // ── A direct call is refused by the server with the same step, on both
  // baseline routes, and the revision is still approved (nothing written).
  const direct = await apiClient()
  try {
    for (const route of [`/schedule/revisions/${revisionId!}/baseline`, '/schedule/baseline']) {
      const refused = await apiJson(direct, 'post', `/projects/${projectId!}${route}`, { token: org!.adminToken, data: {} })
      expect([route, refused.status, refused.body?.error?.code, refused.body?.error?.message]).toEqual([
        route,
        400,
        'BOQ_REQUIRED_FOR_BASELINE',
        'BOQ required before baseline lock: upload the BOQ (BOQ page), then map it to the schedule and lock the baseline.',
      ])
    }
  } finally {
    await direct.dispose()
  }
  await page.reload()
  await expect(panel).toHaveAttribute('data-status', 'approved', { timeout: 45_000 })

  // ── The Overview: the approval card names the upload, not an approval.
  await page.goto(base)
  const expand = page.getByTestId('uat-setup-readiness-expand')
  await expect(page.getByTestId('uat-setup-headline')).toBeVisible({ timeout: 45_000 })
  if (await expand.isVisible().catch(() => false)) await expand.click()
  const upload = page.getByTestId('uat-setup-step-boq_upload')
  await expect(upload).toContainText('No BOQ items have been uploaded.')
  const approval = page.getByTestId('uat-setup-step-boq_approval')
  await expect(approval).toContainText(
    'Upload the BOQ first (BOQ page); it is then submitted, approved and locked here.',
  )
  await expect(approval).not.toContainText('BOQ revision is approved.')
  await expect(approval).not.toContainText('BOQ baseline is locked.')
})
