import { test, expect, type APIRequestContext, type Page, type Request } from '@playwright/test'
import { API, apiClient } from './support'
import {
  addMember,
  apiJson,
  createProject,
  dropLiveOrg,
  registerLiveOrg,
  signInForm,
  workspaceToken,
  type LiveOrg,
} from './support-workspaces'

/**
 * PC-7b on the web, against the API's own contract (routes/exceptions.js,
 * exception.service serialize, change-event.service prefillFromRecord /
 * raiseFromRecord): an exception the engine opened → reviewed → a change
 * event raised from it through POST /controls/exceptions/:id/raise-change-
 * event (prefilled, amount blank, a DRAFT with the typed link — no change
 * order) → the exception reads "in change" → the PC-5 drawers show exactly
 * the record's exceptions; a change event raised from an NCR carries its
 * typed link; and a member without BOQ read is told some exceptions were
 * withheld, with the server's reason — never a count, never "none".
 *
 * A throwaway "LiveTest <uuid>" organisation, every fixture built through the
 * API: an active two-activity programme, two 20 m3 BOQ rows each allocated in
 * full (1.1 to V100, 1.2 to V200, measured by quantity) and approved, and a
 * quantity surveyor whose template takes the BOQ away. The overruns are made
 * through the product's own flows: 25 m3 installed on each and approved. The
 * engine is never called here: its event trigger (EXCEPTIONS_ENGINE_ENABLED
 * on the API under test, which serves only this LiveTest organisation's
 * requests) opens the rows, and the spec waits for them.
 *
 * The real-server walks FAIL on a server without the PC-7b API — they skip
 * only when E2E_EXCEPTIONS_API_PENDING=1 says so explicitly.
 */

const PENDING = process.env.E2E_EXCEPTIONS_API_PENDING === '1'
const PENDING_REASON = 'E2E_EXCEPTIONS_API_PENDING=1: the PC-7b exceptions API is not on the server under test'

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
    multipart: { file: { name: 'exception-handoff.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
  })
  const body = await imported.json()
  expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
  const revisionId = body.data.revisionId as string
  for (const step of ['submit-review', 'approve', 'activate']) {
    await call(client, 'post', `/projects/${projectId}/schedule/revisions/${revisionId}/${step}`, {
      data: step === 'activate' ? { mappings: [] } : {},
    })
  }
}

type Activity = { id: string; activityCode?: string | null; p6ActivityId?: string | null }
type Figure = { value: number | null; unitCode: string | null; basis: string }
type Subject = { type: string; id: string; label: string | null }
type Exception = {
  id: string
  kind: string
  severity: string
  status: string
  subject: Subject
  secondarySubject?: Subject | null
  measured: Figure
  limit: Figure
  review?: { note: string | null; reviewedBy: string | null; reviewedByName: string | null } | null
  changeEvent?: { id: string; ref: string; status: string } | null
  actions: Record<string, boolean>
}
type ExceptionList = { status: number; items: Exception[]; withheld: { reason: string } | null; nextCursor: string | null }

const exceptionsPath = (projectId: string) => `/projects/${projectId}/controls/exceptions`

/** The list as the API answers it: `{ data: { data: [...], pagination: { nextCursor }, withheld? } }`. */
const listExceptions = async (
  client: APIRequestContext,
  projectId: string,
  token = org!.adminToken,
  query = '',
): Promise<ExceptionList> => {
  const response = await apiJson(client, 'get', `${exceptionsPath(projectId)}${query}`, { token })
  const answer = (response.body?.data ?? {}) as {
    data?: Exception[]
    pagination?: { nextCursor?: string | null }
    withheld?: { reason: string }
  }
  return {
    status: response.status,
    items: answer.data ?? [],
    withheld: answer.withheld ?? null,
    nextCursor: answer.pagination?.nextCursor ?? null,
  }
}

const changeOrderCount = async (client: APIRequestContext, projectId: string) => {
  const data = (await call(client, 'get', `/projects/${projectId}/change-orders`)) as unknown
  const list = Array.isArray(data)
    ? data
    : ((data as { items?: unknown[]; changeOrders?: unknown[] }).items ??
      (data as { changeOrders?: unknown[] }).changeOrders ??
      [])
  return list.length
}

const touches = (exception: Exception, ids: string[]) =>
  [exception.subject, exception.secondarySubject].some((subject) => subject && ids.includes(subject.id))

type Side = { boqItemId: string; activityId: string; allocationId: string }
type Base = { projectId: string; one: Side; two: Side; qsEmail: string; qsToken: string }

let base: Base | null = null

/** The LiveTest project, programme, two allocated rows and the no-BOQ surveyor (no overrun yet). */
const buildBase = async (): Promise<Base> => {
  if (base) return base
  const qsEmail = `live-pc7bweb-qs-${crypto.randomUUID()}@octapm-live.test`
  base = await withApi(async (client) => {
    org = await registerLiveOrg(client, 'pc7bweb')
    const projectId = await createProject(client, org.adminToken, `Exception handoff ${Date.now()}`)
    await activateSchedule(client, projectId)

    // A quantity surveyor whose template takes the BOQ away.
    const qsId = await addMember(client, org, { name: 'No BOQ Surveyor', email: qsEmail, role: 'qs' })
    const joined = await apiJson(client, 'post', `/projects/${projectId}/team`, { token: org.adminToken, data: { userId: qsId } })
    expect(joined.status, JSON.stringify(joined.body?.error)).toBeLessThan(300)
    const template = await call(client, 'post', '/permissions/templates', {
      data: { name: `No BOQ surveyor ${Date.now()}`, baseRole: 'qs', tools: [{ module: 'boq', level: 'none' }] },
      status: 201,
    })
    await call(client, 'put', `/projects/${projectId}/team/${qsId}/permissions`, { data: { templateId: template.id } })

    const listed = (await call(client, 'get', `/projects/${projectId}/activities`)) as unknown as
      | Activity[]
      | { activities?: Activity[]; items?: Activity[] }
    const activities = Array.isArray(listed) ? listed : (listed.activities ?? listed.items ?? [])
    const byCode = (code: string) => activities.find((entry) => (entry.activityCode || entry.p6ActivityId) === code)!
    const side = async (code: string, description: string, activity: Activity): Promise<Side> => {
      expect(activity, `the imported activity for ${code}`).toBeTruthy()
      const row = await call(client, 'post', `/projects/${projectId}/boq/items`, {
        data: { code, description, quantity: 20, unit: 'm3', rate: 500 },
        status: 201,
      })
      const boqItemId = (row.item as { id: string }).id
      const allocation = await call(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
        data: { boqItemId, activityId: activity.id, quantity: 20 },
        status: 201,
      })
      for (const step of ['submit', 'approve']) {
        await call(client, 'post', `/projects/${projectId}/activity-boq-allocations/${allocation.id as string}/${step}`)
      }
      await call(client, 'put', `/projects/${projectId}/activities/${activity.id}/progress-method`, {
        data: { method: 'quantity', quantityUnit: 'm3', evidenceRequired: false },
      })
      return { boqItemId, activityId: activity.id, allocationId: allocation.id as string }
    }
    const one = await side('1.1', 'Blockwork', byCode('V100'))
    const two = await side('1.2', 'Render', byCode('V200'))
    return { projectId, one, two, qsEmail, qsToken: await workspaceToken(client, qsEmail, org.orgId) }
  })
  return base
}

type Built = Base & { exception: Exception; other: Exception }
let built: Built | null = null

/** 25 m3 installed against each 20 m3 allocation and approved; then the engine's rows. */
const buildOverrun = async (): Promise<Built> => {
  if (built) return built
  const fixture = await buildBase()
  const { projectId } = fixture
  built = await withApi(async (client) => {
    const probe = await listExceptions(client, projectId)
    expect(probe.status, `GET ${exceptionsPath(projectId)} — the PC-7b exceptions API must be on the server under test`).toBe(200)
    for (const side of [fixture.one, fixture.two]) {
      const entry = await call(client, 'post', `/projects/${projectId}/quantity-progress`, {
        data: {
          activityId: side.activityId,
          boqItemId: side.boqItemId,
          quantity: 25,
          unitCode: 'm3',
          date: new Date().toISOString().slice(0, 10),
          status: 'submitted',
        },
        status: 201,
      })
      const entryId = ((entry.entry ?? (entry.entries as unknown[])?.[0]) as { id: string }).id
      const submitted = await call(client, 'post', `/projects/${projectId}/activities/${side.activityId}/progress`, {
        data: { entryIds: [entryId] },
      })
      const submissionId = (submitted.submission as { id: string }).id
      await call(client, 'post', `/projects/${projectId}/activities/${side.activityId}/progress-submissions/${submissionId}/approve`)
    }

    // The engine's event trigger opens the rows; nothing here writes one.
    const oneIds = [fixture.one.boqItemId, fixture.one.allocationId, fixture.one.activityId]
    const twoIds = [fixture.two.boqItemId, fixture.two.allocationId, fixture.two.activityId]
    let exception: Exception | null = null
    let other: Exception | null = null
    for (let attempt = 0; attempt < 45 && !(exception && other); attempt += 1) {
      const current = (await listExceptions(client, projectId)).items.filter((item) => item.status === 'open')
      exception =
        current.find((item) => item.kind === 'quantity_over_allocation' && touches(item, oneIds) && !touches(item, twoIds)) ??
        current.find((item) => touches(item, oneIds) && !touches(item, twoIds)) ??
        null
      other = current.find((item) => touches(item, twoIds) && !touches(item, oneIds)) ?? null
      if (!(exception && other)) await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    expect(exception, 'the engine opened an exception on 1.1 / V100 within 90 s — is EXCEPTIONS_ENGINE_ENABLED=true on the API under test?').toBeTruthy()
    expect(other, 'the engine opened an exception on 1.2 / V200 within 90 s').toBeTruthy()
    return { ...fixture, exception: exception!, other: other! }
  })
  return built
}

const projectPath = (projectId: string, rest: string) => `/o/${org!.segment}/projects/${projectId}/${rest}`

const openExceptions = async (page: Page, projectId: string) => {
  await page.goto(projectPath(projectId, 'controls/exceptions'))
  await expect(page.getByTestId('exceptions-page')).toBeVisible({ timeout: 45_000 })
}

const isPost = (request: Request, path: string) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith(path)

/** The drawer section lists exactly these rows (by id), no more. */
const expectSectionRows = async (page: Page, section: string, ids: string[]) => {
  const rows = page.getByTestId(section).locator(`[data-testid^="${section}-"][data-kind]`)
  await expect(rows).toHaveCount(ids.length, { timeout: 30_000 })
  for (const id of ids) await expect(page.getByTestId(`${section}-${id}`)).toBeVisible()
}

test('an engine-opened exception is reviewed, raised to a prefilled DRAFT change event with its typed link (no change order), reads in change, and each drawer shows exactly its record’s exceptions', async ({
  page,
}) => {
  test.skip(PENDING, PENDING_REASON)
  test.setTimeout(480_000)
  const fixture = await buildOverrun()
  const { projectId, one, exception, other } = fixture
  const rowId = `exception-row-${exception.id}`
  expect(exception.actions.review && exception.actions.raiseChangeEvent, 'the PM may review and raise').toBe(true)
  const ordersBefore = await withApi((client) => changeOrderCount(client, projectId))

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  await openExceptions(page, projectId)

  // The row: severity, kind, subject, measured vs limit as the server sent them, each with its basis.
  const row = page.getByTestId(rowId)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row).toHaveAttribute('data-status', 'open')
  await expect(row.locator(`[data-severity="${exception.severity}"]`).first()).toBeVisible()
  await expect(page.getByTestId(`${rowId}-figures-measured`).locator('[data-value]')).toHaveAttribute('data-value', String(exception.measured.value ?? ''))
  await expect(page.getByTestId(`${rowId}-figures-limit`).locator('[data-value]')).toHaveAttribute('data-value', String(exception.limit.value ?? ''))
  await expect(page.getByTestId(`${rowId}-figures-measured`)).toContainText(exception.measured.basis)
  await expect(page.getByTestId(`${rowId}-figures-limit`)).toContainText(exception.limit.basis)
  // Each action is drawn exactly when the server said this caller may.
  for (const [action, testId] of [
    ['review', 'review'],
    ['snooze', 'snooze'],
    ['dismiss', 'dismiss'],
    ['raiseChangeEvent', 'raise'],
    ['associateChangeEvent', 'associate'],
  ] as const) {
    await expect(page.getByTestId(`${rowId}-${testId}`)).toHaveCount(exception.actions[action] ? 1 : 0)
  }

  // Review: the note is required, sent as the API takes it, and attributed by name.
  const note = `LiveTest review ${Date.now()}`
  await page.getByTestId(`${rowId}-review`).click()
  await expect(page.getByTestId('exception-action-submit')).toBeDisabled()
  await page.getByTestId('exception-note').fill(note)
  const reviewed = page.waitForResponse((r) => isPost(r.request(), `/controls/exceptions/${exception.id}/review`))
  await page.getByTestId('exception-action-submit').click()
  expect((await reviewed).status()).toBe(200)
  await expect(page.getByTestId(`${rowId}-reviewed`)).toContainText(note)
  await expect(page.getByTestId(`${rowId}-reviewed`)).toContainText('by pc7bweb Admin')
  await expect(page.getByTestId(`${rowId}-reviewed`)).not.toContainText(org!.adminId)
  const afterReview = await withApi((client) => listExceptions(client, projectId))
  expect(afterReview.items.find((item) => item.id === exception.id)?.review?.note).toBe(note)

  // Raise change event: the form opens PREFILLED from the API's prefill, the amount blank.
  const prefillResponse = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(`/controls/exceptions/${exception.id}/change-event-prefill`),
  )
  await page.getByTestId(`${rowId}-raise`).click()
  const prefill = await prefillResponse
  expect(prefill.status(), 'the server prefill').toBe(200)
  const proposed = ((await prefill.json()) as { data: { prefill: { title: string; lines?: unknown[] }; links: Record<string, string> } }).data
  expect(proposed.links.exceptionId, 'the endpoint will carry the exception link').toBe(exception.id)
  await expect(page.getByTestId('raise-change-event-dialog')).toBeVisible()
  await expect(page.getByTestId('raise-change-event-title')).toHaveValue(proposed.prefill.title)
  expect(proposed.prefill.title.length, 'the prefill has a title').toBeGreaterThan(0)
  for (let index = 0; index < (proposed.prefill.lines?.length ?? 0); index += 1) {
    await expect(page.getByTestId(`raise-change-event-line-amount-${index}`)).toHaveAttribute('data-amount-blank', 'true')
  }
  const raised = page.waitForResponse((r) => isPost(r.request(), `/controls/exceptions/${exception.id}/raise-change-event`))
  await page.getByTestId('raise-change-event-save').click()
  const raisedResponse = await raised
  expect(raisedResponse.status(), 'one change event is raised').toBe(201)
  const sent = raisedResponse.request().postDataJSON() as Record<string, unknown> & { lines: Array<Record<string, unknown>> }
  expect(Object.keys(sent).sort(), 'only what a person may set over the prefill').toEqual(['description', 'lines', 'title', 'type'])
  for (const field of ['romAmount', 'unitCost', 'amount']) {
    for (const line of sent.lines) expect(line[field], `no line ${field} is sent`).toBeUndefined()
  }
  const answer = ((await raisedResponse.json()) as {
    data: { exception: Exception; changeEvent: { id: string; ref: string; status: string; changeOrderId?: string | null } }
  }).data
  expect(answer.changeEvent.status, 'a draft change event').toBe('open')
  expect(answer.changeEvent.changeOrderId ?? null, 'no change order').toBeNull()
  expect(answer.exception.status, 'the exception is carried by it').toBe('in_change')
  // The typed link, read back from the change event itself.
  const event = await withApi((client) => call(client, 'get', `/projects/${projectId}/change-events/${answer.changeEvent.id}`))
  expect(event.status).toBe('open')
  expect(event.sourceLinks as Array<{ type: string; id: string }>).toContainEqual(
    expect.objectContaining({ type: 'project_exception', id: exception.id }),
  )
  expect(await withApi((client) => changeOrderCount(client, projectId)), 'no change order was created').toBe(ordersBefore)

  // The exception reads "in change" and links to its event; it offers no second raise.
  await page.reload()
  await expect(page.getByTestId('exceptions-page')).toBeVisible({ timeout: 45_000 })
  await expect(row).toHaveAttribute('data-status', 'in_change', { timeout: 30_000 })
  await expect(page.getByTestId(`${rowId}-change-event`)).toContainText(answer.changeEvent.ref)
  await expect(page.getByTestId(`${rowId}-change-event`)).toHaveAttribute('data-change-event-id', answer.changeEvent.id)
  await expect(page.getByTestId(`${rowId}-raise`)).toHaveCount(0)

  // The drawers show exactly what the API lists on each record — and never 1.2's exception.
  const current = (items: Exception[]) => items.filter((item) => !['resolved', 'dismissed'].includes(item.status)).map((item) => item.id)
  const onItem = await withApi((client) => listExceptions(client, projectId, org!.adminToken, `?subjectType=boq_item&subjectId=${one.boqItemId}`))
  const onActivity = await withApi((client) => listExceptions(client, projectId, org!.adminToken, `?subjectType=activity&subjectId=${one.activityId}`))
  expect(current(onItem.items), 'the API lists the exception on its BOQ item').toContain(exception.id)
  expect(current(onActivity.items), 'the API lists the exception on its activity').toContain(exception.id)
  expect(current(onItem.items)).not.toContain(other.id)
  expect(current(onActivity.items)).not.toContain(other.id)

  await page.goto(projectPath(projectId, `boq?recordId=${one.boqItemId}&source=boq_item`))
  await expect(page.getByTestId('boq-detail-drawer')).toBeVisible({ timeout: 45_000 })
  await page.getByTestId('boq-detail-exceptions').scrollIntoViewIfNeeded()
  await expectSectionRows(page, 'boq-detail-exceptions', current(onItem.items))
  await expect(page.getByTestId(`boq-detail-exceptions-${other.id}`)).toHaveCount(0)
  await expect(page.getByTestId(`boq-detail-exceptions-${exception.id}`)).toHaveAttribute('data-status', 'in_change')
  await expect(page.getByTestId(`boq-detail-exceptions-${exception.id}-change-event`)).toContainText(answer.changeEvent.ref)

  await page.goto(projectPath(projectId, `schedule/gantt?recordId=${one.activityId}&source=activity`))
  await expect(page.getByTestId('activity-detail-drawer')).toBeVisible({ timeout: 45_000 })
  await page.getByTestId('activity-detail-exceptions').scrollIntoViewIfNeeded()
  await expectSectionRows(page, 'activity-detail-exceptions', current(onActivity.items))
  await expect(page.getByTestId(`activity-detail-exceptions-${other.id}`)).toHaveCount(0)
  await expect(page.getByTestId(`activity-detail-exceptions-${exception.id}`)).toHaveAttribute('data-status', 'in_change')
})

test('Raise change event on an NCR creates one DRAFT change event with the NCR’s typed link — no change order', async ({ page }) => {
  test.skip(PENDING, PENDING_REASON)
  test.setTimeout(300_000)
  const { projectId } = await buildBase()
  const { ncrId, ordersBefore } = await withApi(async (client) => {
    const ncr = await call(client, 'post', `/projects/${projectId}/ncr`, {
      data: { description: `LiveTest NCR ${Date.now()}`, severity: 'minor' },
      status: 201,
    })
    return { ncrId: (ncr.id ?? (ncr.ncr as { id: string })?.id) as string, ordersBefore: await changeOrderCount(client, projectId) }
  })
  expect(ncrId, 'the NCR').toBeTruthy()

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  await page.goto(projectPath(projectId, 'quality/ncr'))
  const button = page.getByTestId(`uat-ncr-raise-change-event-${ncrId}`)
  await expect(button).toBeVisible({ timeout: 45_000 })
  const prefillResponse = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(`/ncr/${ncrId}/change-event-prefill`),
  )
  await button.click()
  const prefill = await prefillResponse
  expect(prefill.status(), 'the NCR prefill').toBe(200)
  const proposed = ((await prefill.json()) as { data: { prefill: { title: string }; links: Record<string, string> } }).data
  expect(proposed.links.ncrId).toBe(ncrId)
  await expect(page.getByTestId('raise-change-event-title')).toHaveValue(proposed.prefill.title)
  const raised = page.waitForResponse((r) => isPost(r.request(), `/ncr/${ncrId}/raise-change-event`))
  await page.getByTestId('raise-change-event-save').click()
  const response = await raised
  expect(response.status()).toBe(201)
  expect(Object.keys(response.request().postDataJSON() as object).sort()).toEqual(['description', 'lines', 'title', 'type'])
  const created = ((await response.json()) as { data: { id: string; status: string } }).data
  const event = await withApi((client) => call(client, 'get', `/projects/${projectId}/change-events/${created.id}`))
  expect(event.status, 'a draft change event').toBe('open')
  expect(event.sourceLinks as Array<{ type: string; id: string }>).toContainEqual(expect.objectContaining({ type: 'ncr', id: ncrId }))
  expect(await withApi((client) => changeOrderCount(client, projectId)), 'no change order was created').toBe(ordersBefore)
})

test('a member without BOQ read is told exceptions were withheld, with the reason — never a count, never "none"', async ({
  page,
}) => {
  test.skip(PENDING, PENDING_REASON)
  test.setTimeout(480_000)
  const fixture = await buildOverrun()
  const { projectId, qsEmail, qsToken, exception } = fixture

  // The server withholds the BOQ-derived row whole and says so.
  const asQs = await withApi((client) => listExceptions(client, projectId, qsToken))
  expect(asQs.status).toBe(200)
  expect(asQs.items.some((item) => item.id === exception.id), 'the BOQ-derived exception is not listed').toBe(false)
  expect(asQs.withheld?.reason, 'the server says it withheld some').toBeTruthy()

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, qsEmail)
  await openExceptions(page, projectId)
  await expect(page.getByTestId(`exception-row-${exception.id}`)).toHaveCount(0)
  const note = page.getByTestId('exceptions-withheld')
  await expect(note).toBeVisible()
  await expect(note).toHaveAttribute('data-reason', asQs.withheld!.reason)
  await expect(note).toContainText(asQs.withheld!.reason)
  const count = page.getByTestId('exceptions-count')
  await expect(count).not.toContainText(/\b0\b/)
  await expect(count).not.toContainText('No exceptions')

  // The Overview figure is never a 0 for them.
  await page.goto(projectPath(projectId, 'overview'))
  await expect(page.getByTestId('uat-controls-figure-open-exceptions-value')).toHaveText('—', { timeout: 45_000 })
})

/**
 * The renderers against the API's shapes (routed): the exceptions router is
 * answered with rows shaped as exception.service serialize shapes them — a
 * BOQ-derived open row with every action granted, a reviewed row in change
 * with none, a snoozed row, a withheld marker and cursor pages — plus the
 * prefill `{ prefill, links }` that (wrongly) carries amounts. The web is
 * proven to draw exactly what it is sent and to send exactly what the API's
 * validators take: figures as sent (never their gap), actions only where
 * granted, attribution by name, the pages, the review / snooze / dismiss
 * bodies, the raise body with no amount and no link, the drawers' subject
 * filter, the Overview figure (the project summary the API is asked to add)
 * and the workspace tile as the API sends openExceptions.
 */
test('the screens draw the API’s shapes as sent and send what its validators take', async ({ page }) => {
  test.setTimeout(300_000)
  const { projectId, one } = await buildBase()
  const reason = 'BOQ details unavailable to you'
  const openId = crypto.randomUUID()
  const changedId = crypto.randomUUID()
  const snoozedId = crypto.randomUUID()
  const reviewerId = crypto.randomUUID()
  const pageTwo = crypto.randomUUID()
  const fakeEventId = crypto.randomUUID()
  const figure = (value: number, basis: string) => ({ value, unitCode: 'm3', basis })
  const granted = { review: true, snooze: true, dismiss: true, raiseChangeEvent: true, associateChangeEvent: true }
  const none = { review: false, snooze: false, dismiss: false, raiseChangeEvent: false, associateChangeEvent: false }
  const group = { wbsNodeId: null, wbsNode: null, locationId: null, location: null, costCodeId: null, costCode: null }
  const open = {
    id: openId,
    projectId,
    kind: 'quantity_over_allocation',
    kindLabel: 'Installed quantity over the allocation',
    severity: 'critical',
    status: 'open',
    module: 'boq',
    subject: { type: 'allocation', id: one.allocationId, label: 'V100 · 1.1 Blockwork' },
    secondarySubject: { type: 'boq_item', id: one.boqItemId, label: '1.1 Blockwork' },
    group,
    measured: figure(25, 'Σ approved quantity entries (quantity views)'),
    limit: figure(20, 'approved allocation quantity (allocation summary)'),
    detectedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    resolvedAt: null,
    review: null,
    snooze: null,
    dismissal: null,
    changeEvent: null,
    actions: granted,
  }
  const changed = {
    ...open,
    id: changedId,
    kind: 'schedule_slip_on_mapped_item',
    kindLabel: 'Schedule slip on a mapped item',
    severity: 'warning',
    status: 'in_change',
    module: 'schedule',
    subject: { type: 'activity', id: one.activityId, label: 'V100 Blockwork' },
    secondarySubject: undefined,
    group: { ...group, wbsNodeId: crypto.randomUUID(), wbsNode: { id: 'w', code: 'CIV', name: 'Civil' } },
    measured: { value: 6, unitCode: 'd', basis: 'finish variance (schedule)' },
    limit: { value: 3, unitCode: 'd', basis: 'threshold (documented constant)' },
    review: { reviewedAt: new Date().toISOString(), reviewedBy: reviewerId, reviewedByName: 'Rhea Reviewer', note: 'Seen on site' },
    changeEvent: { id: fakeEventId, ref: 'CE-901', status: 'open', title: 'Slip', path: null },
    actions: none,
  }
  const snoozed = {
    ...open,
    id: snoozedId,
    kind: 'committed_over_budget',
    kindLabel: 'Committed over the revised budget',
    severity: 'info',
    status: 'snoozed',
    module: 'cost',
    subject: { type: 'budget_line', id: crypto.randomUUID(), label: '03 Concrete' },
    secondarySubject: undefined,
    snooze: { until: '2026-12-31T00:00:00.000Z', by: reviewerId, byName: 'Sam Snoozer', reason: 'Waiting for the survey' },
    actions: { ...none, review: true },
  }
  const dismissed = {
    ...open,
    id: crypto.randomUUID(),
    status: 'dismissed',
    resolvedAt: new Date().toISOString(),
    dismissal: { at: new Date().toISOString(), reason: 'Measured twice', by: reviewerId, byName: 'Dee Dismisser' },
    actions: none,
  }
  const posted: Record<string, unknown> = {}
  const listQueries: URLSearchParams[] = []
  await page.route(/\/api\/v1\/projects\/[^/]+\/controls\/exceptions(\/[^?]*)?(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const rest = url.pathname.split('/controls/exceptions')[1] ?? ''
    if (rest === '/summary') {
      return route.fulfill({
        json: { success: true, data: { total: 2, bySeverity: { critical: 1, warning: 1, info: 0 }, withheld: { reason } } },
      })
    }
    if (method === 'GET' && rest === `/${openId}/change-event-prefill`) {
      return route.fulfill({
        json: {
          success: true,
          data: {
            prefill: {
              title: 'Installed quantity over the allocation',
              type: 'site_condition',
              origin: 'exception',
              description: 'Raised from a project exception. The amount is left for the QS to price.',
              activityId: one.activityId,
              locationId: null,
              romAmount: 999,
              scheduleImpactDays: 0,
              lines: [{ description: 'Blockwork overrun', quantity: 5, unit: 'm3', activityId: one.activityId, unitCost: 10, romAmount: 50 }],
            },
            links: { exceptionId: openId },
          },
        },
      })
    }
    if (method === 'POST' && rest === `/${openId}/raise-change-event`) {
      posted.raise = route.request().postDataJSON()
      const changeEvent = { id: crypto.randomUUID(), ref: 'CE-777', status: 'open' }
      return route.fulfill({
        status: 201,
        json: { success: true, data: { exception: { ...open, status: 'in_change', changeEvent, actions: none }, changeEvent } },
      })
    }
    if (method === 'POST') {
      posted[rest.split('/').pop()!] = route.request().postDataJSON()
      return route.fulfill({ json: { success: true, data: open } })
    }
    listQueries.push(url.searchParams)
    const subjectType = url.searchParams.get('subjectType')
    const subjectId = url.searchParams.get('subjectId')
    const pageOf = (data: unknown[], nextCursor: string | null = null) =>
      route.fulfill({ json: { success: true, data: { data, pagination: { limit: 50, nextCursor }, withheld: { reason } } } })
    if (subjectType === 'boq_item') return pageOf(subjectId === one.boqItemId ? [open] : [])
    // A dismissed row on the activity (as a server might send under a status
    // filter): the drawer shows current exceptions only.
    if (subjectType === 'activity') return pageOf(subjectId === one.activityId ? [open, changed, dismissed] : [])
    // The register in two cursor pages.
    return url.searchParams.get('cursor') === pageTwo ? pageOf([snoozed]) : pageOf([open, changed], pageTwo)
  })

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  await openExceptions(page, projectId)

  // Figures as sent, each with its basis — never the gap between them.
  const openRow = page.getByTestId(`exception-row-${openId}`)
  await expect(openRow).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId(`exception-row-${openId}-kind`)).toHaveText('Installed quantity over the allocation')
  await expect(page.getByTestId(`exception-row-${openId}-figures-measured`)).toContainText('25 m3')
  await expect(page.getByTestId(`exception-row-${openId}-figures-measured`)).toContainText('Σ approved quantity entries')
  await expect(page.getByTestId(`exception-row-${openId}-figures-limit`)).toContainText('20 m3')
  await expect(page.getByTestId(`exception-row-${openId}-figures-limit`)).toContainText('approved allocation quantity')
  await expect(openRow).not.toContainText(/\b5 m3\b/)
  await expect(openRow.locator('[data-severity="critical"]').first()).toBeVisible()
  for (const action of ['review', 'snooze', 'dismiss', 'raise', 'associate']) {
    await expect(page.getByTestId(`exception-row-${openId}-${action}`)).toHaveCount(1)
    await expect(page.getByTestId(`exception-row-${changedId}-${action}`)).toHaveCount(0)
  }
  // In change: linked to its event; the review attributed by name, never the id; the WBS named.
  const changedRow = page.getByTestId(`exception-row-${changedId}`)
  await expect(changedRow).toHaveAttribute('data-status', 'in_change')
  await expect(page.getByTestId(`exception-row-${changedId}-change-event`)).toContainText('CE-901')
  await expect(page.getByTestId(`exception-row-${changedId}-reviewed`)).toContainText('by Rhea Reviewer — Seen on site')
  await expect(changedRow).not.toContainText(reviewerId)
  await expect(changedRow).toContainText('WBS CIV Civil')
  // The withheld note; the first page and that more are available.
  await expect(page.getByTestId('exceptions-withheld')).toHaveAttribute('data-reason', reason)
  await expect(page.getByTestId('exceptions-count')).toHaveText('2 shown, more available')
  await page.getByTestId('exceptions-load-more').click()
  await expect(page.getByTestId('exceptions-count')).toHaveText('3 shown')
  await expect(page.getByTestId('exceptions-load-more')).toHaveCount(0)
  await expect(page.getByTestId(`exception-row-${snoozedId}-snoozed`)).toContainText('by Sam Snoozer — Waiting for the survey')
  expect(listQueries.some((query) => query.get('cursor') === pageTwo), 'the next page follows the API cursor').toBe(true)

  // Review needs its note; snooze needs a date and a reason; dismiss needs a reason — each body as the API takes it.
  await page.getByTestId(`exception-row-${openId}-review`).click()
  await expect(page.getByTestId('exception-action-submit')).toBeDisabled()
  await page.getByTestId('exception-note').fill('Checked on site')
  await page.getByTestId('exception-action-submit').click()
  await expect.poll(() => posted.review).toEqual({ note: 'Checked on site' })
  const until = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  await page.getByTestId(`exception-row-${openId}-snooze`).click()
  await page.getByTestId('exception-snooze-until').fill(until)
  await expect(page.getByTestId('exception-action-submit')).toBeDisabled()
  await page.getByTestId('exception-note').fill('Waiting for the survey')
  await page.getByTestId('exception-action-submit').click()
  await expect.poll(() => posted.snooze).toEqual({ until, reason: 'Waiting for the survey' })
  await page.getByTestId(`exception-row-${openId}-dismiss`).click()
  await expect(page.getByTestId('exception-action-submit')).toBeDisabled()
  await expect(page.getByTestId('exception-note')).toHaveAttribute('maxlength', '500')
  await page.getByTestId('exception-note').fill('Measured twice; the allocation is being revised')
  await page.getByTestId('exception-action-submit').click()
  await expect.poll(() => posted.dismiss).toEqual({ reason: 'Measured twice; the allocation is being revised' })

  // Raise change event: prefilled from `prefill`, the amount blank, the raise body has no amount and no link.
  await page.getByTestId(`exception-row-${openId}-raise`).click()
  await expect(page.getByTestId('raise-change-event-form')).toBeVisible()
  await expect(page.getByTestId('raise-change-event-title')).toHaveValue('Installed quantity over the allocation')
  await expect(page.getByTestId('raise-change-event-description')).toHaveValue(/left for the QS to price/)
  await expect(page.getByTestId('raise-change-event-origin')).toContainText('Origin exception')
  await expect(page.getByTestId('raise-change-event-line-qty-0')).toHaveText('5 m3')
  await expect(page.getByTestId('raise-change-event-line-amount-0')).toHaveAttribute('data-amount-blank', 'true')
  await page.getByTestId('raise-change-event-save').click()
  await expect.poll(() => posted.raise).toBeTruthy()
  const sent = posted.raise as Record<string, unknown> & { lines: Array<Record<string, unknown>> }
  expect(Object.keys(sent).sort()).toEqual(['description', 'lines', 'title', 'type'])
  expect(sent.title).toBe('Installed quantity over the allocation')
  expect(sent.type).toBe('site_condition')
  expect(sent.lines).toEqual([{ description: 'Blockwork overrun', quantity: 5, unit: 'm3', activityId: one.activityId }])
  await expect(page.getByTestId('raise-change-event-dialog')).toHaveCount(0)

  // The drawers ask the API for their record's exceptions (subjectType / subjectId) and draw exactly those.
  await page.goto(projectPath(projectId, `boq?recordId=${one.boqItemId}&source=boq_item`))
  await expect(page.getByTestId('boq-detail-drawer')).toBeVisible({ timeout: 45_000 })
  await expectSectionRows(page, 'boq-detail-exceptions', [openId])
  await expect(page.getByTestId('boq-detail-exceptions-withheld')).toContainText(reason)
  expect(listQueries.some((query) => query.get('subjectType') === 'boq_item' && query.get('subjectId') === one.boqItemId)).toBe(true)
  expect(listQueries.every((query) => !query.has('recordType') && !query.has('recordId')), 'no parameter the API ignores').toBe(true)
  await page.goto(projectPath(projectId, `schedule/gantt?recordId=${one.activityId}&source=activity`))
  await expect(page.getByTestId('activity-detail-drawer')).toBeVisible({ timeout: 45_000 })
  await expectSectionRows(page, 'activity-detail-exceptions', [openId, changedId])
  await expect(page.getByTestId(`activity-detail-exceptions-${dismissed.id}`)).toHaveCount(0)
  await expect(page.getByTestId(`activity-detail-exceptions-${changedId}-change-event`)).toContainText('CE-901')

  // The Overview figure: the server's total and per-severity counts, and the withheld reason.
  await page.goto(projectPath(projectId, 'overview'))
  await expect(page.getByTestId('uat-controls-figure-open-exceptions-value')).toHaveText('2', { timeout: 45_000 })
  const basis = page.getByTestId('uat-controls-figure-open-exceptions-basis')
  await expect(basis).toContainText('1 critical · 1 warning · 0 info')
  await expect(basis).toContainText(`some withheld: ${reason}`)

  // The workspace tile, as the API sends openExceptions: a withheld project named with its reason, never a count.
  const otherProjectId = crypto.randomUUID()
  await page.route(/\/api\/v1\/projects\/workspace-dashboard$/, async (route) => {
    const real = await route.fetch()
    const json = (await real.json()) as { data: Record<string, unknown> }
    json.data.openExceptions = {
      total: 3,
      bySeverity: { critical: 1, warning: 2 },
      inChange: 1,
      snoozed: 0,
      basis: 'Unresolved project exceptions the caller may read',
      withheld: {
        reason: `On some of your projects: ${reason}`,
        modules: ['boq'],
        projects: [{ projectId: otherProjectId, name: 'Other project', reason, modules: ['boq'] }],
      },
    }
    await route.fulfill({ response: real, json })
  })
  await page.goto(`/o/${org!.segment}`)
  await expect(page.getByTestId('dashboard-open-exceptions')).toBeVisible({ timeout: 45_000 })
  await expect(page.getByTestId('dashboard-open-exceptions-total')).toHaveText('3')
  await expect(page.getByTestId('dashboard-open-exceptions-severity-critical')).toHaveAttribute('data-count', '1')
  await expect(page.getByTestId('dashboard-open-exceptions-severity-warning')).toHaveAttribute('data-count', '2')
  await expect(page.getByTestId('dashboard-open-exceptions-severity-info')).toHaveCount(0)
  await expect(page.getByTestId('dashboard-open-exceptions-others')).toHaveText('1 in change · 0 snoozed')
  await expect(page.getByTestId('dashboard-open-exceptions-withheld')).toContainText(reason)
  const otherRow = page.getByTestId(`dashboard-open-exceptions-project-${otherProjectId}`)
  await expect(otherRow).toContainText('Other project')
  await expect(otherRow.locator('[data-withheld="true"]')).toContainText(reason)
  await expect(otherRow.locator('[data-count]')).toHaveCount(0)
})

/**
 * Navigation for a member without BOQ read (routed list): Project Controls
 * offers them Exceptions (it follows cost and schedule too) while Structure
 * and Mapping stay the BOQ's; the list the server answers with nothing but a
 * withheld marker reads as withheld with the reason — never "0", never
 * "no exceptions" — and the Overview figure is a dash, not 0.
 */
test('a member without BOQ read reaches Exceptions, not Mapping, and an all-withheld answer never reads as none', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const { projectId, qsEmail } = await buildBase()
  const reason = 'BOQ details unavailable to you'
  await page.route(/\/api\/v1\/projects\/[^/]+\/controls\/exceptions(\/[^?]*)?(\?.*)?$/, (route) =>
    new URL(route.request().url()).pathname.endsWith('/summary')
      ? route.fulfill({ json: { success: true, data: { total: 0, bySeverity: {}, withheld: { reason } } } })
      : route.fulfill({ json: { success: true, data: { data: [], pagination: { limit: 50, nextCursor: null }, withheld: { reason } } } }),
  )
  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, qsEmail)
  await openExceptions(page, projectId)
  await expect(page).toHaveURL(/\/controls\/exceptions/)
  await expect(page.getByTestId('exceptions-withheld')).toHaveAttribute('data-reason', reason)
  await expect(page.getByTestId('exceptions-withheld')).toContainText('Exceptions withheld')
  await expect(page.getByTestId('exceptions-count')).toHaveText('None you may see')
  await expect(page.getByTestId('exceptions-list')).toHaveCount(0)

  // Mapping is the BOQ's: its address lands on what is offered (Exceptions).
  await page.goto(projectPath(projectId, 'controls/mapping'))
  await expect(page).toHaveURL(/\/controls\/exceptions/, { timeout: 45_000 })

  // The Overview figure: a dash and the reason, never 0.
  await page.goto(projectPath(projectId, 'overview'))
  await expect(page.getByTestId('uat-controls-figure-open-exceptions-value')).toHaveText('—', { timeout: 45_000 })
  await expect(page.getByTestId('uat-controls-figure-open-exceptions-basis')).toContainText(`some withheld: ${reason}`)
})
