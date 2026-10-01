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
  type LiveOrg,
} from './support-workspaces'

/**
 * PC-7b on the web: an exception the engine opened → reviewed → a change
 * event raised from it (prefilled, amount blank, a DRAFT — no change order)
 * → the exception reads "in change" → the PC-5 drawers show it; and a member
 * without BOQ read is told some exceptions were withheld, with the server's
 * reason — never a count, never "none".
 *
 * A throwaway "LiveTest <uuid>" organisation, every fixture built through the
 * API: an active two-activity programme, a 20 m3 BOQ row allocated in full to
 * V100 (measured by quantity) and approved, and a quantity surveyor whose
 * template takes the BOQ away. The overrun is then made through the
 * product's own flows: 25 m3 installed on V100 and approved (installed over
 * allocation, change intelligence §1); where this server refuses that, the
 * row's quantity is cut to 12 m3 under its 20 m3 allocation (allocations over
 * item quantity). The engine is never called directly: the event trigger
 * (EXCEPTIONS_ENGINE_ENABLED on the API under test — the spawned API's tick
 * must stay off for durable organisations) opens the row, and the spec waits
 * for it.
 *
 * Skips with its reason when the exceptions route answers 404 (a branch
 * before the PC-7b API merge); the orchestrator re-runs it after the merges.
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
type Exception = {
  id: string
  kind: string
  severity: string
  status: string
  subject: { type: string; id: string; label: string | null }
  secondarySubject?: { type: string; id: string } | null
  measured: Figure
  limit: Figure
  review?: { note: string | null } | null
  changeEvent?: { id: string; ref: string; status: string } | null
  actions: Record<string, boolean>
}
type ExceptionList = { status: number; items: Exception[]; withheld: { reason: string } | null }

/** The list as the server answers it, either envelope shape (`{ data: [...] }` or `{ data: { data|items } }`). */
const listExceptions = async (
  client: APIRequestContext,
  projectId: string,
  token = org!.adminToken,
  query = '',
): Promise<ExceptionList> => {
  const response = await apiJson(client, 'get', `/projects/${projectId}/exceptions${query}`, { token })
  const body = response.body as unknown as { data?: unknown; withheld?: { reason: string } } | null
  const inner = body?.data as unknown
  if (Array.isArray(inner)) return { status: response.status, items: inner as Exception[], withheld: body?.withheld ?? null }
  const nested = (inner ?? {}) as { data?: Exception[]; items?: Exception[]; withheld?: { reason: string } }
  return {
    status: response.status,
    items: nested.data ?? nested.items ?? [],
    withheld: nested.withheld ?? body?.withheld ?? null,
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

type Built = {
  projectId: string
  v100: string
  boqItemId: string
  allocationId: string
  qsEmail: string
  qsToken: string
  skip: string | null
  exception: Exception | null
  route: string
}

let built: Built | null = null

const build = async (): Promise<Built> => {
  if (built) return built
  const qsEmail = `live-pc7bweb-qs-${crypto.randomUUID()}@octapm-live.test`
  built = await withApi(async (client) => {
    org = await registerLiveOrg(client, 'pc7bweb')
    const projectId = await createProject(client, org.adminToken, `Exception handoff ${Date.now()}`)
    const probe = await listExceptions(client, projectId)
    const skip =
      probe.status === 404
        ? 'GET /projects/:id/exceptions answers 404 on this server: the PC-7b API is not merged here'
        : null
    if (!skip) expect(probe.status, 'the exceptions list').toBe(200)
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

    // 20 m3 of blockwork, allocated in full to V100 and approved.
    const row = await call(client, 'post', `/projects/${projectId}/boq/items`, {
      data: { code: '1.1', description: 'Blockwork', quantity: 20, unit: 'm3', rate: 500 },
      status: 201,
    })
    const boqItemId = (row.item as { id: string }).id
    const listed = (await call(client, 'get', `/projects/${projectId}/activities`)) as unknown as
      | Activity[]
      | { activities?: Activity[]; items?: Activity[] }
    const activities = Array.isArray(listed) ? listed : (listed.activities ?? listed.items ?? [])
    const v100 = activities.find((entry) => (entry.activityCode || entry.p6ActivityId) === 'V100')!
    expect(v100, 'the imported activity V100').toBeTruthy()
    const allocation = await call(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
      data: { boqItemId, activityId: v100.id, quantity: 20 },
      status: 201,
    })
    for (const step of ['submit', 'approve']) {
      await call(client, 'post', `/projects/${projectId}/activity-boq-allocations/${allocation.id as string}/${step}`)
    }
    await call(client, 'put', `/projects/${projectId}/activities/${v100.id}/progress-method`, {
      data: { method: 'quantity', quantityUnit: 'm3', evidenceRequired: false },
    })
    const base = {
      projectId,
      v100: v100.id,
      boqItemId,
      allocationId: allocation.id as string,
      qsEmail,
      qsToken: await workspaceToken(client, qsEmail, org.orgId),
    }
    if (skip) return { ...base, skip, exception: null, route: '' }

    // The overrun, through the product's own flows: 25 m3 installed against
    // the 20 m3 allocation and approved …
    let route = 'installed 25 m3 over a 20 m3 allocation'
    const entry = await apiJson(client, 'post', `/projects/${projectId}/quantity-progress`, {
      token: org.adminToken,
      data: {
        activityId: v100.id,
        boqItemId,
        quantity: 25,
        unitCode: 'm3',
        date: new Date().toISOString().slice(0, 10),
        status: 'submitted',
      },
    })
    let installed = false
    if (entry.status < 300) {
      const entryId = ((entry.body!.data!.entry ?? (entry.body!.data!.entries as unknown[])?.[0]) as { id: string }).id
      const submitted = await apiJson(client, 'post', `/projects/${projectId}/activities/${v100.id}/progress`, {
        token: org.adminToken,
        data: { entryIds: [entryId] },
      })
      const submissionId = (submitted.body?.data?.submission as { id?: string } | undefined)?.id
      if (submitted.status < 300 && submissionId) {
        const approved = await apiJson(
          client,
          'post',
          `/projects/${projectId}/activities/${v100.id}/progress-submissions/${submissionId}/approve`,
          { token: org.adminToken },
        )
        installed = approved.status < 300
      }
    }
    // … or, where this server refuses an installation past the allocation,
    // the row's quantity cut under its approved allocation.
    if (!installed) {
      route = 'BOQ row cut to 12 m3 under a 20 m3 approved allocation'
      await call(client, 'patch', `/projects/${projectId}/boq/items/${boqItemId}`, { data: { quantity: 12 } })
    }

    // The engine's event trigger opens the row; nothing here writes one.
    let exception: Exception | null = null
    for (let attempt = 0; attempt < 45 && !exception; attempt += 1) {
      const current = await listExceptions(client, projectId)
      exception =
        current.items.find(
          (item) =>
            item.status === 'open' &&
            [item.subject, item.secondarySubject].some(
              (subject) => subject && (subject.id === boqItemId || subject.id === allocation.id || subject.id === v100.id),
            ),
        ) ?? null
      if (!exception) await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    expect(
      exception,
      `the engine opened no exception on the overrun (${route}) within 90 s — is EXCEPTIONS_ENGINE_ENABLED=true on the API under test?`,
    ).toBeTruthy()

    return { ...base, skip: null, exception, route }
  })
  return built
}

const projectPath = (projectId: string, rest: string) => `/o/${org!.segment}/projects/${projectId}/${rest}`

const openExceptions = async (page: Page, projectId: string) => {
  await page.goto(projectPath(projectId, 'controls/exceptions'))
  await expect(page.getByTestId('exceptions-page')).toBeVisible({ timeout: 45_000 })
}

test('an engine-opened exception is reviewed, raised to a prefilled DRAFT change event (no change order), reads in change, and the drawers show it', async ({
  page,
}) => {
  test.setTimeout(420_000)
  const fixture = await build()
  test.skip(Boolean(fixture.skip), fixture.skip ?? '')
  const { projectId, boqItemId, v100 } = fixture
  const exception = fixture.exception!
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
  await expect(page.getByTestId(`${rowId}-figures-measured`).locator('[data-value]')).toHaveAttribute(
    'data-value',
    String(exception.measured.value ?? ''),
  )
  await expect(page.getByTestId(`${rowId}-figures-limit`).locator('[data-value]')).toHaveAttribute(
    'data-value',
    String(exception.limit.value ?? ''),
  )
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

  // Review with a note.
  const note = `LiveTest review ${Date.now()}`
  await page.getByTestId(`${rowId}-review`).click()
  await page.getByTestId('exception-note').fill(note)
  const reviewed = page.waitForResponse((r) => r.url().includes(`/exceptions/${exception.id}/review`) && r.request().method() === 'POST')
  await page.getByTestId('exception-action-submit').click()
  expect((await reviewed).status()).toBeLessThan(300)
  await expect(page.getByTestId(`${rowId}-reviewed`)).toContainText(note)
  const afterReview = await withApi((client) => listExceptions(client, projectId))
  expect(afterReview.items.find((item) => item.id === exception.id)?.review?.note).toBe(note)

  // Raise change event: the form opens PREFILLED from the server, the amount blank.
  const prefillResponse = page.waitForResponse((r) => r.url().includes('/change-events/prefill') && r.request().method() === 'GET')
  await page.getByTestId(`${rowId}-raise`).click()
  const prefill = await prefillResponse
  expect(prefill.status(), 'the server prefill').toBe(200)
  const prefillBody = (await prefill.json()) as { data?: { payload?: unknown } }
  const proposed = (prefillBody.data?.payload ?? prefillBody.data ?? {}) as { title?: string; lines?: unknown[] }
  const dialog = page.getByTestId('raise-change-event-dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('raise-change-event-title')).toHaveValue(proposed.title ?? '')
  for (let index = 0; index < (proposed.lines?.length ?? 0); index += 1) {
    await expect(page.getByTestId(`raise-change-event-line-amount-${index}`)).toHaveAttribute('data-amount-blank', 'true')
  }
  if (!proposed.title) await page.getByTestId('raise-change-event-title').fill('LiveTest overrun')
  const created = page.waitForResponse(
    (r) => /\/change-events$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
  )
  await page.getByTestId('raise-change-event-save').click()
  const createdResponse = await created
  expect(createdResponse.status(), 'a change event is created').toBe(201)
  const sent = createdResponse.request().postDataJSON() as Record<string, unknown> & { lines?: Array<Record<string, unknown>> }
  for (const field of ['romAmount', 'unitCost', 'amount']) {
    expect(sent[field], `no ${field} is sent`).toBeUndefined()
    for (const line of sent.lines ?? []) expect(line[field], `no line ${field} is sent`).toBeUndefined()
  }
  const event = (await createdResponse.json()).data as { id: string; ref: string; status: string; changeOrderId?: string | null }
  expect(event.status, 'a draft change event').toBe('open')
  expect(event.changeOrderId ?? null, 'no change order').toBeNull()
  expect(await withApi((client) => changeOrderCount(client, projectId)), 'no change order was created').toBe(ordersBefore)

  // The exception reads "in change" and links to its event.
  await page.reload()
  await expect(page.getByTestId('exceptions-page')).toBeVisible({ timeout: 45_000 })
  await expect(row).toHaveAttribute('data-status', 'in_change', { timeout: 30_000 })
  await expect(page.getByTestId(`${rowId}-change-event`)).toContainText(event.ref)
  await expect(page.getByTestId(`${rowId}-change-event`)).toHaveAttribute('data-change-event-id', event.id)

  // The drawers show what the server lists on each record.
  const onItem = await withApi((client) => listExceptions(client, projectId, org!.adminToken, `?recordType=boq_item&recordId=${boqItemId}`))
  const onActivity = await withApi((client) => listExceptions(client, projectId, org!.adminToken, `?recordType=activity&recordId=${v100}`))
  expect(
    [...onItem.items, ...onActivity.items].some((item) => item.id === exception.id),
    'the server lists the exception on its BOQ item or activity',
  ).toBe(true)

  await page.goto(projectPath(projectId, `boq?recordId=${boqItemId}&source=boq_item`))
  const boqDrawer = page.getByTestId('boq-detail-drawer')
  await expect(boqDrawer).toBeVisible({ timeout: 45_000 })
  const boqSection = boqDrawer.getByTestId('boq-detail-exceptions')
  await boqSection.scrollIntoViewIfNeeded()
  for (const item of onItem.items.filter((entry) => !['resolved', 'dismissed'].includes(entry.status))) {
    await expect(boqSection.getByTestId(`boq-detail-exceptions-${item.id}`)).toBeVisible({ timeout: 30_000 })
  }
  if (onItem.items.some((item) => item.id === exception.id)) {
    await expect(boqSection.getByTestId(`boq-detail-exceptions-${exception.id}`)).toHaveAttribute('data-status', 'in_change')
    await expect(boqSection.getByTestId(`boq-detail-exceptions-${exception.id}-change-event`)).toContainText(event.ref)
  }

  await page.goto(projectPath(projectId, `schedule/gantt?recordId=${v100}&source=activity`))
  const activityDrawer = page.getByTestId('activity-detail-drawer')
  await expect(activityDrawer).toBeVisible({ timeout: 45_000 })
  const activitySection = activityDrawer.getByTestId('activity-detail-exceptions')
  await activitySection.scrollIntoViewIfNeeded()
  for (const item of onActivity.items.filter((entry) => !['resolved', 'dismissed'].includes(entry.status))) {
    await expect(activitySection.getByTestId(`activity-detail-exceptions-${item.id}`)).toBeVisible({ timeout: 30_000 })
  }
  if (exception.kind === 'quantity_over_allocation') {
    // An allocation's exception belongs to both ends of the allocation.
    await expect(activitySection.getByTestId(`activity-detail-exceptions-${exception.id}`)).toHaveAttribute('data-status', 'in_change')
  }
})

test('a member without BOQ read is told exceptions were withheld, with the reason — never a count, never "none"', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const fixture = await build()
  test.skip(Boolean(fixture.skip), fixture.skip ?? '')
  const { projectId, qsEmail, qsToken } = fixture
  const exception = fixture.exception!

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

  // The Overview strip says it too, never as 0.
  await page.goto(projectPath(projectId, 'overview'))
  const figure = page.getByTestId('uat-controls-figure-open-exceptions')
  await expect(figure).toBeVisible({ timeout: 45_000 })
  await expect(page.getByTestId('uat-controls-figure-open-exceptions-basis')).toContainText('withheld')
})

/**
 * The renderers against the contract (routed): the exceptions endpoints are
 * answered by the contract's own shapes — a BOQ-derived open row with every
 * action granted, a row in change with none, a withheld marker, a summary
 * and a prefill that (wrongly) carries amounts — so the web is proven to draw
 * exactly what it is sent, on any server: figures as sent (never their gap),
 * actions only where granted, the withheld reason, a prefilled form that
 * sends no amount and creates a real DRAFT change event (no change order),
 * the drawer sections, the Overview figure and the workspace tile.
 */
test('the screens draw the contract as sent: figures, granted actions, withheld reason, a prefilled draft with no amount', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const fixture = await build()
  const { projectId, boqItemId, v100, allocationId } = fixture
  const reason = 'BOQ details unavailable to you'
  const openId = crypto.randomUUID()
  const changedId = crypto.randomUUID()
  const fakeEventId = crypto.randomUUID()
  const figure = (value: number, basis: string) => ({ value, unitCode: 'm3', basis })
  const granted = { review: true, snooze: true, dismiss: true, raiseChangeEvent: true, associateChangeEvent: true }
  const none = { review: false, snooze: false, dismiss: false, raiseChangeEvent: false, associateChangeEvent: false }
  const open = {
    id: openId,
    kind: 'quantity_over_allocation',
    severity: 'critical',
    status: 'open',
    subject: { type: 'allocation', id: allocationId, label: 'V100 · 1.1 Blockwork' },
    secondarySubject: { type: 'boq_item', id: boqItemId, label: '1.1 Blockwork' },
    group: null,
    measured: figure(25, 'Σ approved quantity entries (quantity views)'),
    limit: figure(20, 'approved allocation quantity (allocation summary)'),
    detectedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    review: null,
    changeEvent: null,
    actions: granted,
  }
  const changed = {
    ...open,
    id: changedId,
    kind: 'schedule_slip_on_mapped_item',
    severity: 'warning',
    status: 'in_change',
    subject: { type: 'activity', id: v100, label: 'V100 · Blockwork' },
    secondarySubject: null,
    measured: { value: 6, unitCode: 'd', basis: 'finish variance (schedule)' },
    limit: { value: 3, unitCode: 'd', basis: 'threshold (documented constant)' },
    changeEvent: { id: fakeEventId, ref: 'CE-901', status: 'open' },
    actions: none,
  }
  const posted: Record<string, unknown> = {}
  await page.route(/\/api\/v1\/projects\/[^/]+\/exceptions(\/[^?]*)?(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname.endsWith('/exceptions/summary')) {
      return route.fulfill({
        json: { success: true, data: { open: { total: 2, bySeverity: { critical: 1, warning: 1, info: 0 } }, withheld: { reason } } },
      })
    }
    if (method === 'POST') {
      const action = url.pathname.split('/').pop()!
      posted[action] = route.request().postDataJSON()
      return route.fulfill({ json: { success: true, data: open } })
    }
    const recordType = url.searchParams.get('recordType')
    const recordId = url.searchParams.get('recordId')
    const rows =
      recordType === 'boq_item' && recordId === boqItemId
        ? [open]
        : recordType === 'activity' && recordId === v100
          ? [open, changed]
          : recordType
            ? []
            : [open, changed]
    return route.fulfill({ json: { success: true, data: rows, withheld: { reason } } })
  })
  await page.route(/\/api\/v1\/projects\/[^/]+\/change-events\/prefill(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          payload: {
            title: 'Installed over allocation — 1.1 Blockwork',
            type: 'site_condition',
            origin: 'other',
            description: '25 m3 installed against a 20 m3 allocation',
            activityId: v100,
            exceptionId: openId,
            romAmount: 999,
            lines: [{ description: 'Blockwork overrun', quantity: 5, unit: 'm3', activityId: v100, unitCost: 10, romAmount: 50 }],
          },
          source: { type: 'exception', id: openId, label: '1.1 Blockwork' },
          notes: ['The amount is left to the QS.'],
        },
      },
    }),
  )

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  await openExceptions(page, projectId)

  // Figures as sent, each with its basis — never the gap between them.
  const openRow = page.getByTestId(`exception-row-${openId}`)
  await expect(openRow).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId(`exception-row-${openId}-figures-measured`)).toContainText('25 m3')
  await expect(page.getByTestId(`exception-row-${openId}-figures-measured`)).toContainText('Σ approved quantity entries')
  await expect(page.getByTestId(`exception-row-${openId}-figures-limit`)).toContainText('20 m3')
  await expect(page.getByTestId(`exception-row-${openId}-figures-limit`)).toContainText('approved allocation quantity')
  await expect(openRow).not.toContainText(/\b5 m3\b/)
  await expect(openRow.locator('[data-severity="critical"]').first()).toBeVisible()
  // Every granted action on the open row, none on the row the server grants nothing.
  for (const action of ['review', 'snooze', 'dismiss', 'raise', 'associate']) {
    await expect(page.getByTestId(`exception-row-${openId}-${action}`)).toHaveCount(1)
    await expect(page.getByTestId(`exception-row-${changedId}-${action}`)).toHaveCount(0)
  }
  // In change: linked to its event.
  await expect(page.getByTestId(`exception-row-${changedId}`)).toHaveAttribute('data-status', 'in_change')
  await expect(page.getByTestId(`exception-row-${changedId}-change-event`)).toContainText('CE-901')
  // The withheld note, with the reason; the count is what is shown.
  await expect(page.getByTestId('exceptions-withheld')).toHaveAttribute('data-reason', reason)
  await expect(page.getByTestId('exceptions-count')).toHaveText('2 shown')

  // Review with a note, snooze until a date, dismiss only with a reason.
  await page.getByTestId(`exception-row-${openId}-review`).click()
  await page.getByTestId('exception-note').fill('Checked on site')
  await page.getByTestId('exception-action-submit').click()
  await expect.poll(() => posted.review).toEqual({ note: 'Checked on site' })
  await page.getByTestId(`exception-row-${openId}-snooze`).click()
  await page.getByTestId('exception-snooze-until').fill('2026-12-01')
  await page.getByTestId('exception-action-submit').click()
  await expect.poll(() => posted.snooze).toEqual({ until: '2026-12-01', note: null })
  await page.getByTestId(`exception-row-${openId}-dismiss`).click()
  await expect(page.getByTestId('exception-action-submit')).toBeDisabled()
  await page.getByTestId('exception-note').fill('Measured twice; the allocation is being revised')
  await page.getByTestId('exception-action-submit').click()
  await expect.poll(() => posted.dismiss).toEqual({ reason: 'Measured twice; the allocation is being revised' })

  // Raise change event: prefilled, the amount blank, nothing priced is sent, a real DRAFT created, no change order.
  const ordersBefore = await withApi((client) => changeOrderCount(client, projectId))
  await page.getByTestId(`exception-row-${openId}-raise`).click()
  await expect(page.getByTestId('raise-change-event-form')).toBeVisible()
  await expect(page.getByTestId('raise-change-event-title')).toHaveValue('Installed over allocation — 1.1 Blockwork')
  await expect(page.getByTestId('raise-change-event-description')).toHaveValue('25 m3 installed against a 20 m3 allocation')
  await expect(page.getByTestId('raise-change-event-line-qty-0')).toHaveText('5 m3')
  await expect(page.getByTestId('raise-change-event-line-amount-0')).toHaveAttribute('data-amount-blank', 'true')
  await expect(page.getByTestId('raise-change-event-notes')).toContainText('left to the QS')
  // What the web sends is kept; the server is sent it without the routed
  // exception's id (that exception exists only in this test), so a real
  // DRAFT is created on any server.
  type Sent = Record<string, unknown> & { lines: Array<Record<string, unknown>> }
  const captured: { body?: Sent } = {}
  await page.route(/\/api\/v1\/projects\/[^/]+\/change-events$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    captured.body = route.request().postDataJSON() as Sent
    const forServer: Record<string, unknown> = { ...captured.body }
    delete forServer.exceptionId
    return route.continue({ postData: JSON.stringify(forServer) })
  })
  const created = page.waitForResponse(
    (r) => /\/change-events$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
  )
  await page.getByTestId('raise-change-event-save').click()
  const response = await created
  expect(response.status(), JSON.stringify(await response.json().catch(() => null))).toBe(201)
  const sent = captured.body
  if (!sent) throw new Error('the create was not sent')
  expect(sent.exceptionId).toBe(openId)
  expect(sent.title).toBe('Installed over allocation — 1.1 Blockwork')
  for (const field of ['romAmount', 'unitCost', 'amount']) {
    expect(sent[field], `no ${field}`).toBeUndefined()
    expect(sent.lines[0][field], `no line ${field}`).toBeUndefined()
  }
  expect(sent.lines[0].quantity).toBe(5)
  const event = (await response.json()).data as { status: string; changeOrderId?: string | null; romAmount?: number }
  expect(event.status).toBe('open')
  expect(event.changeOrderId ?? null).toBeNull()
  expect(Number(event.romAmount ?? 0)).toBe(0)
  expect(await withApi((client) => changeOrderCount(client, projectId))).toBe(ordersBefore)

  // The drawers: the BOQ item's section lists its row; the activity's both.
  await page.goto(projectPath(projectId, `boq?recordId=${boqItemId}&source=boq_item`))
  const boqSection = page.getByTestId('boq-detail-drawer').getByTestId('boq-detail-exceptions')
  await expect(boqSection.getByTestId(`boq-detail-exceptions-${openId}`)).toBeVisible({ timeout: 45_000 })
  await expect(boqSection.getByTestId(`boq-detail-exceptions-${changedId}`)).toHaveCount(0)
  await expect(boqSection.getByTestId('boq-detail-exceptions-withheld')).toContainText(reason)
  await page.goto(projectPath(projectId, `schedule/gantt?recordId=${v100}&source=activity`))
  const activitySection = page.getByTestId('activity-detail-drawer').getByTestId('activity-detail-exceptions')
  await expect(activitySection.getByTestId(`activity-detail-exceptions-${changedId}`)).toBeVisible({ timeout: 45_000 })
  await expect(activitySection.getByTestId(`activity-detail-exceptions-${changedId}-change-event`)).toContainText('CE-901')

  // The Overview figure: the server's total and per-severity counts, and the withheld reason.
  await page.goto(projectPath(projectId, 'overview'))
  await expect(page.getByTestId('uat-controls-figure-open-exceptions-value')).toHaveText('2', { timeout: 45_000 })
  const basis = page.getByTestId('uat-controls-figure-open-exceptions-basis')
  await expect(basis).toContainText('1 critical · 1 warning · 0 info')
  await expect(basis).toContainText(`some withheld: ${reason}`)

  // The workspace tile, as the server sends it: a withheld project said with its reason, never 0.
  const otherProjectId = crypto.randomUUID()
  await page.route(/\/api\/v1\/projects\/workspace-dashboard$/, async (route) => {
    const real = await route.fetch()
    const json = (await real.json()) as { data: Record<string, unknown> }
    json.data.openExceptions = {
      total: 3,
      bySeverity: { critical: 1, warning: 2 },
      withheld: { reason },
      projects: [
        { projectId, projectName: 'Exception handoff', total: 3, bySeverity: { critical: 1, warning: 2 } },
        { projectId: otherProjectId, projectName: 'Other project', withheld: { reason } },
      ],
    }
    await route.fulfill({ response: real, json })
  })
  await page.goto(`/o/${org!.segment}`)
  const tile = page.getByTestId('dashboard-open-exceptions')
  await expect(tile).toBeVisible({ timeout: 45_000 })
  await expect(page.getByTestId('dashboard-open-exceptions-total')).toHaveText('3')
  await expect(page.getByTestId('dashboard-open-exceptions-severity-critical')).toHaveAttribute('data-count', '1')
  await expect(page.getByTestId('dashboard-open-exceptions-severity-warning')).toHaveAttribute('data-count', '2')
  await expect(page.getByTestId('dashboard-open-exceptions-severity-info')).toHaveCount(0)
  await expect(page.getByTestId('dashboard-open-exceptions-withheld')).toContainText(reason)
  const otherRow = page.getByTestId(`dashboard-open-exceptions-project-${otherProjectId}`)
  await expect(otherRow.locator('[data-withheld="true"]')).toContainText(reason)
  await expect(otherRow.locator('[data-count]')).toHaveCount(0)
  const ownRow = page.getByTestId(`dashboard-open-exceptions-project-${projectId}`)
  await expect(ownRow.locator('[data-severity="critical"]')).toBeVisible()
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
  const fixture = await build()
  const { projectId, qsEmail } = fixture
  const reason = 'BOQ details unavailable to you'
  await page.route(/\/api\/v1\/projects\/[^/]+\/exceptions(\/[^?]*)?(\?.*)?$/, (route) =>
    new URL(route.request().url()).pathname.endsWith('/summary')
      ? route.fulfill({ json: { success: true, data: { open: { total: 0, bySeverity: {} }, withheld: { reason } } } })
      : route.fulfill({ json: { success: true, data: [], withheld: { reason } } }),
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
