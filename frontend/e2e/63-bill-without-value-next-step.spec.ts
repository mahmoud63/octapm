import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
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
 * A project whose bill is uploaded but has nothing to map (owner decision
 * E2, 2026-09-28), walked by its PM after the schedule is imported, approved
 * and activated. The review panel's headline next step names the bill's own
 * missing step, in the words of the server's refusal and of the readiness
 * fix shown beneath it — never "upload the BOQ" for a bill the project
 * already has (spec 60 keeps the upload for the project with no bill):
 *
 *   a token bill (its one priced row not applicable, then optional): mark
 *      the rows that belong to the schedule as required (Project Controls ›
 *      Mapping); the Overview's BOQ Upload card opens Mapping
 *   an unpriced bill (the row edited to rate 0): price the BOQ's rows (BOQ
 *      page); the card opens the BOQ
 *
 * and Lock Baseline is refused beside each, as the server refuses the lock.
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

const call = async (
  client: APIRequestContext,
  method: 'post' | 'patch',
  projectId: string,
  route: string,
  data: unknown,
  status = 200,
) => {
  const moved = await apiJson(client, method, `/projects/${projectId}${route}`, { token: org!.adminToken, data })
  expect(moved.status, `${route} -> ${JSON.stringify(moved.body?.error)}`).toBe(status)
  return moved.body?.data
}

const SCOPE_NEXT =
  'Next: mark the rows that belong to the schedule as required (Project Controls › Mapping), then lock baseline'
const SCOPE_FIX =
  "To fix: Mark the BOQ rows that belong to the schedule as required on Project Controls › Mapping, map them to the schedule's activities and lock the baseline."
const PRICE_NEXT = "Next: price the BOQ's rows (BOQ page), then lock baseline"
const PRICE_FIX =
  "To fix: Price the BOQ's rows on the BOQ page, then map them to the schedule's activities (Project Controls › Mapping) and lock the baseline."

const expectPanel = async (page: Page, base: string, next: string, fix: string, card: string) => {
  const panel = page.getByTestId('uat-schedule-review')
  await page.goto(`${base}/schedule/gantt`)
  await expect(panel).toHaveAttribute('data-status', 'approved', { timeout: 45_000 })
  await expect(page.getByTestId('uat-schedule-review-fix-boq_present')).toContainText(fix, { timeout: 30_000 })
  // The headline names the same step as the fix beneath it, never the upload.
  await expect(page.getByTestId('uat-schedule-review-next')).toHaveText(next)
  await expect(page.getByTestId('uat-schedule-review-next')).not.toContainText('upload the BOQ')
  await expect(panel.getByRole('button', { name: 'Lock Baseline' })).toBeDisabled()

  // The Overview's BOQ Upload card sends to the page where that step is taken.
  await page.goto(base)
  const expand = page.getByTestId('uat-setup-readiness-expand')
  await expect(page.getByTestId('uat-setup-headline')).toBeVisible({ timeout: 45_000 })
  if (await expand.isVisible().catch(() => false)) await expand.click()
  const upload = page.getByTestId('uat-setup-step-boq_upload')
  await expect(upload.getByRole('button', { name: card })).toBeVisible()
}

test('a bill with nothing to map: the review panel names the scope or the pricing step, not the upload', async ({ page }) => {
  test.setTimeout(300_000)
  const client = await apiClient()
  let projectId: string
  let itemId: string
  try {
    org = await registerLiveOrg(client, 'pc4tokenbill')
    projectId = await createProject(client, org.adminToken, `Token bill ${Date.now()}`)
    // The token bill: one priced row, marked not applicable.
    const created = await call(client, 'post', projectId, '/boq/items', {
      code: 'P.1',
      description: 'Preliminaries',
      quantity: 1,
      unit: 'item',
      rate: 5000,
    }, 201)
    itemId = created.item.id as string
    await call(client, 'patch', projectId, '/activity-boq-allocations/mapping-rules', { rule: 'not_applicable', itemIds: [itemId] })
    const imported = await client.post(`${API}/projects/${projectId}/import/xer`, {
      headers: { authorization: `Bearer ${org.adminToken}` },
      multipart: { file: { name: 'tokenbill.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
    })
    const body = await imported.json()
    expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
    const revisionId = body.data.revisionId as string
    for (const step of ['submit-review', 'approve', 'activate']) {
      await call(client, 'post', projectId, `/schedule/revisions/${revisionId}/${step}`, step === 'activate' ? { mappings: [] } : {})
    }
  } finally {
    await client.dispose()
  }

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${projectId}`

  // ── Not applicable: the scope step, on Mapping.
  await expectPanel(page, base, SCOPE_NEXT, SCOPE_FIX, 'Open Mapping')

  // ── Optional: the same.
  const edits = await apiClient()
  try {
    await call(edits, 'patch', projectId, '/activity-boq-allocations/mapping-rules', { rule: 'optional', itemIds: [itemId!] })
    await expectPanel(page, base, SCOPE_NEXT, SCOPE_FIX, 'Open Mapping')

    // ── Unpriced: the row back in scope, edited to rate 0 — the pricing step.
    await call(edits, 'patch', projectId, '/activity-boq-allocations/mapping-rules', { rule: 'required', itemIds: [itemId!] })
    await call(edits, 'patch', projectId, `/boq/items/${itemId!}`, { rate: 0 })
    await expectPanel(page, base, PRICE_NEXT, PRICE_FIX, 'Open BOQ')

    // The server refuses the lock with the same step.
    const refused = await apiJson(edits, 'post', `/projects/${projectId}/schedule/baseline`, { token: org!.adminToken, data: {} })
    expect([refused.status, refused.body?.error?.code]).toEqual([400, 'BOQ_VALUE_REQUIRED_FOR_BASELINE'])
  } finally {
    await edits.dispose()
  }
})
