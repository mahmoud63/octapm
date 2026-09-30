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
import { expectNoToastBeside, toast } from './support-toasts'

/**
 * IPC certification waits for an established contract value, and the refusal
 * leads to Contract terms (PC-7a; owner decision R5 bounded follow-up, browser
 * check 2). A throwaway "LiveTest <uuid>" organisation, every fixture built
 * through the API: a project with NO contract value and a priced bill, so its
 * client contract is the BOQ's total (boq_fallback), and IPC P01 claimed and
 * submitted.
 *
 *   the PM certifies: refused in the server's words — one toast with an
 *      "Open Contract terms" link, never two, and a notice kept on the
 *      workbook with the same sentence and link after the toast is gone —
 *      and nothing is certified or advanced; either link lands on Client
 *      Billing for the same project, where the PM — who manages the contract
 *      and reads the BOQ — may confirm the value or enter one
 *   a quantity surveyor whose template takes the BOQ away (a contract
 *      manager without BOQ read): the original value reads "—" with the
 *      server's reason, no confirm-as-is button; they enter a value
 *   entered (contract_entry): Certify is no longer refused
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
  '%R\tT1\tV100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0',
  '%R\tT2\tV200\tPour\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0',
  '%T\tTASKPRED',
  '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
  '%R\tP1\tT2\tT1\tPR_FS\t0',
  '%E',
  '',
].join('\n')

/**
 * An active schedule: the project's Commercial pages wait for one ("Generate a
 * schedule first …"), so the fixture imports, approves and activates a small
 * programme before the browser opens the page.
 */
const activateSchedule = async (client: APIRequestContext, projectId: string) => {
  const imported = await client.post(`${API}/projects/${projectId}/import/xer`, {
    headers: { authorization: `Bearer ${org!.adminToken}` },
    multipart: { file: { name: 'contract-value.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
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

const REFUSAL = 'Establish the contract value first (Contract terms: enter it, or confirm it if you may read the BOQ)'

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

type Contract = { originalValue?: number; originalValueSource: string; valueWithheld?: { reason: string } }

const contractOf = (projectId: string, token = org!.adminToken) =>
  withApi(async (client) => (await call(client, 'get', `/projects/${projectId}/prime-contract`, { token })) as unknown as Contract)

/**
 * What a certification or an advance receipt writes, read back through the
 * API: the period's state and money, its "certified" audit events and the
 * contract's advance records.
 */
const footprint = (projectId: string) =>
  withApi(async (client) => {
    const period = await call(client, 'get', `/projects/${projectId}/ipc/P01`)
    const advances = await call(client, 'get', `/projects/${projectId}/prime-contract/advances`)
    expect(Array.isArray(advances.items), 'the advances list').toBe(true)
    const audit = await call(
      client,
      'get',
      `/projects/${projectId}/audit?entityType=ipc_certificate&action=certified&limit=20`,
    )
    expect(Array.isArray(audit.events), 'the audit events list').toBe(true)
    return {
      status: period.status,
      invoiceStatus: period.invoiceStatus ?? null,
      retentionStatus: period.retentionStatus ?? null,
      totalRet: period.totalRet ?? null,
      netPayable: period.netPayable ?? null,
      certifiedEvents: (audit.events as unknown[]).length,
      advances: (advances.items as unknown[]).length,
    }
  })

const openIpc = async (page: Page, base: string) => {
  await page.goto(`${base}/commercial/ipc`)
  await expect(page.getByTestId('uat-ipc-period-select')).toBeVisible({ timeout: 45_000 })
  await expect(page.getByTestId('uat-ipc-period-select')).toHaveValue('P01')
  const certify = page.getByRole('button', { name: 'Certify IPC' })
  await expect(certify).toBeVisible()
  // Where the workbook asks for a PM override reason, the PM gives one.
  const override = page.getByPlaceholder('PM override reason')
  if (await override.isEnabled()) await override.fill('LiveTest: claim agreed with the client')
  await expect(certify).toBeEnabled()
  return certify
}

test('a refused IPC certification links to Contract terms, which offers each person the road their access allows', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const qsEmail = `live-ipclink-qs-${crypto.randomUUID()}@octapm-live.test`
  const { projectId, qsToken } = await withApi(async (client) => {
    org = await registerLiveOrg(client, 'ipclink')
    const project = await createProject(client, org.adminToken, `Contract value link ${Date.now()}`)
    await activateSchedule(client, project)
    // The project carries no contract value of its own.
    const created = await call(client, 'get', `/projects/${project}`)
    expect(Number(created.contractValue ?? 0)).toBe(0)

    // A contract manager without BOQ read: a QS whose template sets the BOQ
    // tool to none on this project.
    const qsId = await addMember(client, org, { name: 'No BOQ Surveyor', email: qsEmail, role: 'qs' })
    const joined = await apiJson(client, 'post', `/projects/${project}/team`, {
      token: org.adminToken,
      data: { userId: qsId },
    })
    expect(joined.status, JSON.stringify(joined.body?.error)).toBeLessThan(300)
    const template = await call(client, 'post', '/permissions/templates', {
      data: { name: `No BOQ surveyor ${Date.now()}`, baseRole: 'qs', tools: [{ module: 'boq', level: 'none' }] },
      status: 201,
    })
    await call(client, 'put', `/projects/${project}/team/${qsId}/permissions`, { data: { templateId: template.id } })

    // A priced bill: 20 m3 at 500 = 10,000, the only figure the contract has.
    const row = await call(client, 'post', `/projects/${project}/boq/items`, {
      data: { code: '1.1', description: 'Blockwork', quantity: 20, unit: 'm3', rate: 500 },
      status: 201,
    })
    // Allocated in full to one activity and approved: what an IPC period bills.
    type Activity = { id: string; activityCode?: string | null; p6ActivityId?: string | null }
    const listed = (await call(client, 'get', `/projects/${project}/activities`)) as unknown as
      | Activity[]
      | { activities?: Activity[]; items?: Activity[] }
    const activities = Array.isArray(listed) ? listed : (listed.activities ?? listed.items ?? [])
    const activity = activities.find((entry) => (entry.activityCode || entry.p6ActivityId) === 'V100')
    expect(activity, 'the imported activity V100').toBeTruthy()
    const allocation = await call(client, 'post', `/projects/${project}/activity-boq-allocations`, {
      data: { boqItemId: (row.item as { id: string }).id, activityId: activity!.id, quantity: 20 },
      status: 201,
    })
    for (const step of ['submit', 'approve']) {
      await call(client, 'post', `/projects/${project}/activity-boq-allocations/${allocation.id as string}/${step}`)
    }
    // Approved progress on that activity: a claim needs it.
    const progress = await call(client, 'post', `/projects/${project}/activities/${activity!.id}/progress`, {
      data: { pctComplete: 50 },
    })
    const submission = progress.submission as { id: string }
    await call(
      client,
      'post',
      `/projects/${project}/activities/${activity!.id}/progress-submissions/${submission.id}/approve`,
    )
    // P01 drafted, claimed and submitted.
    const period = await call(client, 'post', `/projects/${project}/ipc`, { data: { period: 'P01' }, status: 201 })
    const item = (period.items as Array<{ id: string }>)[0]
    await call(client, 'patch', `/projects/${project}/ipc/P01/items/${item.id}`, { data: { qty: 5 } })
    const submitted = await call(client, 'post', `/projects/${project}/ipc/P01/submit`)
    expect(submitted.status).toBe('submitted')
    return { projectId: project, qsToken: await workspaceToken(client, qsEmail, org.orgId) }
  })
  const base = `/o/${org!.segment}/projects/${projectId}`

  // The contract is the bill's figure, not yet the contract's.
  const fallback = await contractOf(projectId)
  expect([fallback.originalValueSource, fallback.originalValue]).toEqual(['boq_fallback', 10000])
  // The QS may not read the BOQ: the value is withheld from them, with a reason.
  expect((await withApi((client) => apiJson(client, 'get', `/projects/${projectId}/boq`, { token: qsToken }))).status).toBe(403)
  const qsView = await contractOf(projectId, qsToken)
  expect(qsView.originalValue).toBeUndefined()
  expect(qsView.valueWithheld?.reason).toBeTruthy()
  const before = await footprint(projectId)
  expect([before.status, before.certifiedEvents, before.advances]).toEqual(['submitted', 0, 0])

  // ── The PM certifies: refused, with the way to Contract terms.
  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  const certify = await openIpc(page, base)
  const [refused] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/ipc/P01/certify') && response.request().method() === 'POST'),
    certify.click(),
  ])
  const refusedBody = (await refused.json()) as { error: { code: string; message: string } }
  expect([refused.status(), refusedBody.error.code, refusedBody.error.message]).toEqual([
    409,
    'CONTRACT_VALUE_NOT_ESTABLISHED',
    REFUSAL,
  ])
  // The server's words, in ONE toast — the workbook's own, carrying the
  // link; the app-wide mutation handler no longer repeats the sentence
  // (the certify mutation reports its own error, lib/mutation-meta.ts).
  const refusals = toast(page, REFUSAL)
  await expect(refusals).toHaveCount(1)
  const refusal = refusals.first()
  const toastLink = refusal.getByRole('button', { name: 'Open Contract terms' })
  await expect(toastLink).toBeVisible()
  expect(await refusals.count(), 'toasts carrying the refusal').toBe(1)
  // Never the generic failure beside it.
  await expectNoToastBeside(page, 'Failed to certify IPC', refusal)
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/commercial/ipc(\\?|$)`))

  // ... and the same sentence kept on the workbook, with the same way to
  // Contract terms, for as long as the period stays refused — a toast is
  // gone in five seconds. No amount in it (the server's sentence has none).
  const notice = page.getByTestId('uat-ipc-contract-value-notice')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Certification of P01 was refused')
  await expect(notice).toContainText(REFUSAL)
  await expect(notice).not.toContainText('10,000')
  await expect(notice).not.toContainText('10000')
  const noticeLink = notice.getByTestId('uat-ipc-open-contract-terms')
  await expect(noticeLink).toHaveText('Open Contract terms')
  // Certify is still offered: the server decides on each attempt.
  await expect(certify).toBeEnabled()
  // Past the toast's five seconds: the toast has gone, the notice has not.
  await expect(refusals).toHaveCount(0, { timeout: 20_000 })
  await expect(notice).toBeVisible()
  await expect(noticeLink).toBeVisible()

  // The notice's link lands on Contract terms (Client Billing) for the same project.
  await noticeLink.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/commercial/client-billing(\\?|$)`))
  await expect(page.getByTestId('uat-client-billing')).toBeVisible({ timeout: 45_000 })

  // Nothing was certified or advanced by the refused attempt.
  expect(await footprint(projectId)).toEqual(before)
  expect((await contractOf(projectId)).originalValueSource).toBe('boq_fallback')

  // The toast's own link lands there too: refused once more, followed at once.
  const certifyAgain = await openIpc(page, base)
  const [refusedAgain] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/ipc/P01/certify') && response.request().method() === 'POST'),
    certifyAgain.click(),
  ])
  expect(refusedAgain.status()).toBe(409)
  await expect(refusals).toHaveCount(1)
  await refusal.getByRole('button', { name: 'Open Contract terms' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/commercial/client-billing(\\?|$)`))
  await expect(page.getByTestId('uat-client-billing')).toBeVisible({ timeout: 45_000 })
  expect(await footprint(projectId)).toEqual(before)

  const card = page.getByTestId('uat-contract-card')
  await expect(card).toBeVisible()

  // A contract manager who reads the BOQ: the fallback is shown and said to
  // be unconfirmed, with the confirm and enter controls.
  await expect(page.getByTestId('uat-contract-value-unconfirmed')).toContainText(
    'The original value is the BOQ total, taken because the project had no contract value.',
  )
  await expect(page.getByTestId('uat-contract-value-confirm')).toBeVisible()
  await expect(page.getByTestId('uat-contract-value-confirm')).toHaveText('Confirm as contract value')
  await expect(card.getByTestId('uat-contract-value-withheld')).toHaveCount(0)
  await page.getByTestId('uat-contract-terms').click()
  const pmValue = page.getByTestId('uat-contract-original-value')
  await expect(pmValue).toBeEditable()
  await expect(pmValue).toHaveValue('10000')
  await expect(page.getByTestId('uat-contract-original-value-withheld')).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(pmValue).toBeHidden()

  // ── A contract manager without BOQ read.
  const qsContext = await browser.newContext()
  try {
    const qsPage = await qsContext.newPage()
    await qsPage.routeWebSocket(/socket\.io/, () => {})
    await signInForm(qsPage, qsEmail, LIVE_PASSWORD)
    await qsPage.goto(`${base}/commercial/client-billing`)
    await expect(qsPage.getByTestId('uat-client-billing')).toBeVisible({ timeout: 45_000 })
    const qsCard = qsPage.getByTestId('uat-contract-card')
    const statement = await withApi((client) =>
      call(client, 'get', `/projects/${projectId}/prime-contract/statement`, { token: qsToken }),
    )
    const withheld = (statement.summary as { valueWithheld?: { keys: string[]; reason: string } }).valueWithheld
    expect(withheld?.keys).toContain('originalValue')
    const original = qsCard.getByTestId('uat-contract-value-withheld').first()
    await expect(original).toContainText('—')
    await expect(original).toContainText(withheld!.reason)
    // Never a zero, never the bill's figure, never the confirm-as-is button.
    await expect(qsCard).not.toContainText('10,000')
    await expect(qsCard).not.toContainText('$0.00')
    await expect(qsPage.getByTestId('uat-contract-value-confirm')).toHaveCount(0)
    await expect(qsPage.getByTestId('uat-contract-value-unconfirmed')).toHaveCount(0)

    // They may enter the contract value: the field starts empty and says why.
    await qsPage.getByTestId('uat-contract-terms').click()
    const qsValue = qsPage.getByTestId('uat-contract-original-value')
    await expect(qsValue).toBeEditable()
    await expect(qsValue).toHaveValue('')
    await expect(qsPage.getByTestId('uat-contract-original-value-withheld')).toContainText(qsView.valueWithheld!.reason)
    await qsValue.fill('12000')
    const [saved] = await Promise.all([
      qsPage.waitForRequest((request) => request.url().endsWith('/prime-contract') && request.method() === 'PATCH'),
      qsPage.getByTestId('uat-contract-save').click(),
    ])
    expect((saved.postDataJSON() as Record<string, unknown>).originalValue).toBe(12000)
    expect((await saved.response())?.status()).toBe(200)
    await expect(toast(qsPage, 'Contract terms saved')).toBeVisible()
  } finally {
    await qsContext.close()
  }
  const entered = await contractOf(projectId)
  expect([entered.originalValueSource, entered.originalValue]).toEqual(['contract_entry', 12000])

  // ── Established: Certify is no longer refused.
  const again = await openIpc(page, base)
  const [certified] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/ipc/P01/certify') && response.request().method() === 'POST'),
    again.click(),
  ])
  expect(certified.status(), JSON.stringify(await certified.json().catch(() => null))).toBe(200)
  // (The page was reloaded by openIpc, so the first attempt's refusal is gone.)
  await expectNoToastBeside(page, REFUSAL, toast(page, 'IPC certified'))
  // The same reading now shows the certification the refusal did not write.
  const after = await footprint(projectId)
  expect(after.status).toBe('certified')
  expect(after.certifiedEvents).toBeGreaterThan(0)
})
