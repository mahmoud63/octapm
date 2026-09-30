import { test, expect, type APIRequestContext, type Page, type Request } from '@playwright/test'
import { API, apiClient } from './support'
import {
  apiJson,
  createProject,
  dropLiveOrg,
  registerLiveOrg,
  signInForm,
  type LiveOrg,
} from './support-workspaces'
import { expectNoToastBeside, toast } from './support-toasts'

/**
 * The budget line dialog's Original Budget protection (PC-7a; owner decision
 * R5 bounded follow-up, browser check 1), walked by a PM in a throwaway
 * "LiveTest <uuid>" organisation, every fixture built through the API:
 *
 *   reactivation: a line added, archived and added again with a different
 *      original comes back with the original it had — the toast says so,
 *      with the kept and the entered amounts and why (unlocked: "a
 *      re-activated line keeps its original budget"; locked: the lock
 *      condition, and "record the difference as a budget revision")
 *   read-only: a line with an approved budget revision on it (lock condition
 *      2) opens with its original shown, disabled, with the reason, and the
 *      save sends no originalBudget at all
 *   refused: a dialog opened while the line was still writable, saved after
 *      the lock landed, is refused by the server (409 BUDGET_ORIGINAL_LOCKED)
 *      and the person reads the plain sentence — never the API path the
 *      details carry — and the stored original is unchanged
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
  '%R\tT1\tB100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0',
  '%R\tT2\tB200\tPour\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0',
  '%T\tTASKPRED',
  '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
  '%R\tP1\tT2\tT1\tPR_FS\t0',
  '%E',
  '',
].join('\n')

/**
 * An active schedule: the project's Cost Control pages wait for one ("Generate a
 * schedule first …"), so the fixture imports, approves and activates a small
 * programme before the browser opens the page.
 */
const activateSchedule = async (client: APIRequestContext, projectId: string) => {
  const imported = await client.post(`${API}/projects/${projectId}/import/xer`, {
    headers: { authorization: `Bearer ${org!.adminToken}` },
    multipart: { file: { name: 'budget-lock.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
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

type Line = {
  id: string
  costCodeId: string
  costType: string
  status: string
  originalBudget: number
  originalBudgetLock?: { locked: boolean; conditions: Array<{ condition: string; reason: string }> }
}

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
  data?: unknown,
  status = 200,
) => {
  const moved = await apiJson(client, method, route, { token: org!.adminToken, data })
  expect(moved.status, `${method} ${route} -> ${JSON.stringify(moved.body?.error)}`).toBe(status)
  return moved.body!.data as Record<string, unknown>
}

const linesOf = (projectId: string) =>
  withApi(async (client) => {
    const data = await call(client, 'get', `/projects/${projectId}/budget/lines?includeArchived=true`)
    return data.items as Line[]
  })

const lineFor = async (projectId: string, costCodeId: string) => {
  const line = (await linesOf(projectId)).find((row) => row.costCodeId === costCodeId && row.costType === 'material')
  expect(line, `a material line for cost code ${costCodeId}`).toBeTruthy()
  return line!
}

/** "$100,000" or "$100,000.00", as the project's currency formatter writes it. */
const money = (amount: string) => `\\$${amount}(\\.00)?`

const row = (page: Page, code: string) => page.getByTestId('uat-budget-line-row').filter({ hasText: code })

/** Adds a material line for a cost code through the dialog. */
const addLine = async (page: Page, code: string, original: string) => {
  await page.getByTestId('uat-budget-line-new').click()
  const dialog = page.getByTestId('uat-budget-line-dialog')
  await expect(dialog).toBeVisible()
  await page.getByTestId('uat-budget-line-code').click()
  await page.getByRole('option', { name: new RegExp(`^${code} ·`) }).click()
  await expect(page.getByTestId('uat-budget-line-original')).toBeEnabled()
  await page.getByTestId('uat-budget-line-original').fill(original)
  await page.getByTestId('uat-budget-line-save').click()
  await expect(dialog).toBeHidden({ timeout: 20_000 })
}

const archiveLine = async (page: Page, code: string) => {
  page.once('dialog', (confirm) => void confirm.accept())
  await row(page, code).getByRole('button', { name: 'Archive line' }).click()
  await expect(toast(page, 'Line archived')).toBeVisible()
  await expect(row(page, code)).toHaveCount(0)
}

const openBudget = async (page: Page, base: string) => {
  await page.goto(`${base}/cost/budget`)
  await expect(page.getByTestId('uat-budget-panel')).toBeVisible({ timeout: 45_000 })
  await expect(page.getByTestId('uat-budget-line-new')).toBeVisible()
}

const isLinePatch = (lineId: string) => (request: Request) =>
  request.method() === 'PATCH' && request.url().includes(`/budget/lines/${lineId}`)

test('the budget line dialog keeps a re-activated original, shows a locked original read-only and says why a refused edit was refused', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const { projectId, keptCodeId, refusedCodeId } = await withApi(async (client) => {
    org = await registerLiveOrg(client, 'budgetlock')
    const project = await createProject(client, org.adminToken, `Budget lock ${Date.now()}`)
    await activateSchedule(client, project)
    const codes: string[] = []
    for (const [code, name] of [
      ['BL-100', 'Blockwork'],
      ['BL-200', 'Screed'],
    ]) {
      const created = await call(client, 'post', '/company/cost-codes', { code, name, category: 'material' }, 201)
      codes.push(created.id as string)
    }
    await call(client, 'put', `/projects/${project}/budget/cost-codes`, { costCodeIds: codes })
    return { projectId: project, keptCodeId: codes[0], refusedCodeId: codes[1] }
  })
  const base = `/o/${org!.segment}/projects/${projectId}`

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  await openBudget(page, base)

  // ── Reactivation of an unlocked line: the original it had is kept.
  await addLine(page, 'BL-100', '100000')
  await expect(toast(page, 'Budget line added')).toBeVisible()
  const first = await lineFor(projectId, keptCodeId)
  expect([first.originalBudget, first.status, first.originalBudgetLock?.locked]).toEqual([100000, 'active', false])
  await archiveLine(page, 'BL-100')
  expect((await lineFor(projectId, keptCodeId)).status).toBe('archived')

  // The first add's own "Budget line added" toast is gone before the line is
  // added again, so one seen beside the warning below is this add's.
  await expect(toast(page, 'Budget line added')).toHaveCount(0)
  await addLine(page, 'BL-100', '150000')
  const keptUnlocked = toast(page, 'Archived line re-activated with its original budget kept at')
  await expect(keptUnlocked).toBeVisible()
  await expect(keptUnlocked).toContainText(
    new RegExp(`kept at ${money('100,000')}, not the ${money('150,000')} entered\\.`),
  )
  await expect(keptUnlocked).toContainText(
    'A re-activated line keeps its original budget; edit the line to change it while it is unlocked.',
  )
  // The warning stands alone: the line was not "added" with what was typed.
  await expectNoToastBeside(page, 'Budget line added', keptUnlocked)
  const reactivated = await lineFor(projectId, keptCodeId)
  expect([reactivated.id, reactivated.originalBudget, reactivated.status]).toEqual([first.id, 100000, 'active'])

  // ── One real lock condition: an approved budget revision on the line.
  await withApi((client) =>
    call(
      client,
      'post',
      `/projects/${projectId}/budget/lines/${first.id}/revisions`,
      { amount: 25000, note: 'LiveTest approved revision' },
      201,
    ),
  )
  const locked = await lineFor(projectId, keptCodeId)
  expect(locked.originalBudgetLock?.locked).toBe(true)
  expect(locked.originalBudgetLock?.conditions.map((entry) => entry.condition)).toEqual(['approved_change'])

  // The edit dialog shows the original read-only, with the reason.
  await openBudget(page, base)
  await row(page, 'BL-100').getByRole('button', { name: 'Edit line' }).click()
  const dialog = page.getByTestId('uat-budget-line-dialog')
  await expect(dialog).toBeVisible()
  const original = page.getByTestId('uat-budget-line-original')
  await expect(original).toHaveValue('100000')
  await expect(original).toBeDisabled()
  await expect(original).toHaveAttribute('readonly', '')
  await expect(original).toHaveAttribute('aria-describedby', 'budget-original-locked')
  await expect(page.getByTestId('uat-budget-line-original-locked')).toHaveText(
    'Locked: an approved change order, revision or transfer stands on it. Record a changed amount as a budget revision on this line.',
  )
  // Saving the rest of the line does not send the original at all.
  await dialog.getByLabel('Description').fill('LiveTest description after the lock')
  const [patch] = await Promise.all([
    page.waitForRequest(isLinePatch(first.id)),
    page.getByTestId('uat-budget-line-save').click(),
  ])
  const sent = patch.postDataJSON() as Record<string, unknown>
  expect(sent).not.toHaveProperty('originalBudget')
  expect(sent.description).toBe('LiveTest description after the lock')
  expect((await patch.response())?.status()).toBe(200)
  await expect(toast(page, 'Budget line saved')).toBeVisible()
  await expect(dialog).toBeHidden()
  const saved = await lineFor(projectId, keptCodeId)
  expect([saved.originalBudget, saved.originalBudgetLock?.locked]).toEqual([100000, true])

  // ── Reactivation of a locked line: kept, and the lock condition says why.
  await archiveLine(page, 'BL-100')
  await addLine(page, 'BL-100', '175000')
  const keptLocked = toast(page, 'Archived line re-activated with its original budget kept at')
  await expect(keptLocked).toBeVisible()
  await expect(keptLocked).toContainText(
    new RegExp(`kept at ${money('100,000')}, not the ${money('175,000')} entered\\.`),
  )
  await expect(keptLocked).toContainText(
    'Its original budget is locked: a budget revision stands on it. Record the difference as a budget revision.',
  )
  await expectNoToastBeside(page, 'Budget line added', keptLocked)
  expect((await lineFor(projectId, keptCodeId)).originalBudget).toBe(100000)

  // ── A direct attempt the server refuses: the dialog opened while the line
  // was writable, the lock landed before the save.
  const writable = await withApi(async (client) => {
    await call(
      client,
      'post',
      `/projects/${projectId}/budget/lines`,
      { costCodeId: refusedCodeId, costType: 'material', originalBudget: 50000 },
      201,
    )
    return lineFor(projectId, refusedCodeId)
  })
  expect([writable.originalBudget, writable.originalBudgetLock?.locked]).toEqual([50000, false])
  await openBudget(page, base)
  await row(page, 'BL-200').getByRole('button', { name: 'Edit line' }).click()
  await expect(dialog).toBeVisible()
  await expect(original).toBeEnabled()
  await expect(page.getByTestId('uat-budget-line-original-locked')).toHaveCount(0)
  await withApi((client) =>
    call(
      client,
      'post',
      `/projects/${projectId}/budget/lines/${writable.id}/revisions`,
      { amount: 5000, note: 'LiveTest lock while open' },
      201,
    ),
  )
  await original.fill('80000')
  const [refusedPatch] = await Promise.all([
    page.waitForRequest(isLinePatch(writable.id)),
    page.getByTestId('uat-budget-line-save').click(),
  ])
  expect((refusedPatch.postDataJSON() as Record<string, unknown>).originalBudget).toBe(80000)
  const refusal = await refusedPatch.response()
  const refusedBody = (await refusal!.json()) as {
    error: { code: string; message: string; details?: { revisionPath?: string } }
  }
  expect([refusal!.status(), refusedBody.error.code]).toEqual([409, 'BUDGET_ORIGINAL_LOCKED'])
  // The server carries the path in the details, never in the sentence.
  expect(refusedBody.error.details?.revisionPath).toBe(`/budget/lines/${writable.id}/revisions`)
  expect(refusedBody.error.message).not.toContain('/budget/lines/')

  // (The dialog's own toast; the app-wide mutation default may repeat it.)
  const refusedToast = toast(page, 'The original budget of BL-200 / material is locked at 50,000.00').first()
  await expect(refusedToast).toBeVisible()
  await expect(refusedToast).toContainText('condition 2: a budget revision stands on it')
  await expect(refusedToast).toContainText('Record a changed amount as a budget revision on this line')
  await expect(refusedToast).toContainText(refusedBody.error.message)
  // No raw API path and no error code anywhere on the page.
  const shown = await page.locator('body').innerText()
  expect(shown).not.toContain('/budget/lines/')
  expect(shown).not.toContain('BUDGET_ORIGINAL_LOCKED')
  // The dialog stays open with what was typed; nothing was written.
  await expect(dialog).toBeVisible()
  const after = await lineFor(projectId, refusedCodeId)
  expect([after.originalBudget, after.originalBudgetLock?.locked]).toEqual([50000, true])
})
