import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiClient } from './support'
import {
  apiJson,
  createProject,
  dropLiveOrg,
  registerLiveOrg,
  signInForm,
  LIVE_PASSWORD,
  type LiveOrg,
} from './support-workspaces'

/**
 * Owner decision R5-2 (2026-09-30) on screen, in a throwaway "LiveTest <uuid>"
 * organisation: a cost record's DEFAULT forecast is never presented as an
 * entered one.
 *
 *   the cost register (By Activity): the record made without a forecast shows
 *      the "Default" marker with the server's basis on hover; the record made
 *      with a forecast of 0 shows 0 with no marker — 0 is a forecast
 *   the cost overview: the cost records' projection is "Projected final cost
 *      (cost records)", not "EAC", and the mix of sources is stated
 *   the activity detail drawer: the default's marker and its basis; the
 *      entered one without a marker
 *   a cost controller who may not read the BOQ: the default forecast is a dash
 *      with the server's reason — never a figure, never 0 — and the entered
 *      one is shown
 *   editing: emptying the Forecast field sends nothing — the record stays a
 *      default (it used to be sent as 0 and stored as an entered 0)
 *   By Phase: the column is "Projected final cost (cost records)", not "Forecast"
 *   the member without BOQ access, sorting by Forecast: the default rows follow
 *      the others whatever the direction, with the server's reason; and they
 *      can replace a default they are not shown with a forecast of their own
 */

const DEFAULT_BASIS =
  'Default forecast: the larger of the budget and the actual cost as they stood when it was set; it does not follow them afterwards (no forecast was entered)'
const ENTERED_BASIS = 'Entered forecast'

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

const ok = (response: { status: number; body: { error?: unknown } | null }, expected: number, what: string) =>
  expect(response.status, `${what} -> ${JSON.stringify(response.body?.error)}`).toBe(expected)

const build = async (client: APIRequestContext) => {
  org = await registerLiveOrg(client, 'r52fc')
  const token = org.adminToken
  const projectId = await createProject(client, token, `Default forecast ${Date.now()}`)
  const row = await apiJson(client, 'post', `/projects/${projectId}/boq/items`, {
    token,
    data: { code: 'F1.1', description: 'Concrete to slabs', quantity: 6, unit: 'm3', rate: 4111.17 },
  })
  ok(row, 201, 'boq item')
  const boqItemId = (row.body!.data as { item: { id: string } }).item.id
  const acts: Record<string, string> = {}
  for (const [key, code] of [['byDefault', 'F100'], ['entered', 'F200']]) {
    const created = await apiJson(client, 'post', `/projects/${projectId}/activities`, {
      token,
      data: { name: `Pour ${key}`, activityCode: code, duration: 5, startDate: '2026-02-02', endDate: '2026-02-06', engineerIds: [org.adminId] },
    })
    ok(created, 201, `activity ${key}`)
    acts[key] = created.body!.data!.id as string
    const allocation = await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
      token,
      data: { boqItemId, activityId: acts[key], quantity: 3 },
    })
    ok(allocation, 201, `allocation ${key}`)
    for (const step of ['submit', 'approve']) {
      ok(await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations/${allocation.body!.data!.id}/${step}`, { token, data: {} }), 200, `${key} ${step}`)
    }
  }
  // One record with no forecast (the default: its allocation, 12,333.51), one with a forecast of 0.
  const byDefault = await apiJson(client, 'post', `/projects/${projectId}/cost/activity/${acts.byDefault}`, { token, data: {} })
  ok(byDefault, 201, 'cost record without a forecast')
  expect([byDefault.body!.data!.forecast, byDefault.body!.data!.forecastSource]).toEqual([12333.51, 'default'])
  const entered = await apiJson(client, 'post', `/projects/${projectId}/cost/activity/${acts.entered}`, { token, data: { forecast: 0 } })
  ok(entered, 201, 'cost record with forecast 0')
  expect([entered.body!.data!.forecast, entered.body!.data!.forecastSource]).toEqual([0, 'entered'])

  // A cost controller on the project under a template that takes the BOQ away.
  const readerEmail = `live-r52-cost-${crypto.randomUUID()}@octapm-live.test`
  const created = await apiJson(client, 'post', '/users', {
    token,
    data: { name: 'Cost without BOQ', email: readerEmail, role: 'cost_controller', password: LIVE_PASSWORD },
  })
  ok(created, 201, 'add the cost controller')
  const readerId = created.body!.data!.id as string
  ok(await apiJson(client, 'post', `/projects/${projectId}/team`, { token, data: { userId: readerId, role: 'cost_controller' } }), 201, 'put the cost controller on the project')
  const template = await apiJson(client, 'post', '/permissions/templates', {
    token,
    data: { name: `No BOQ cost ${Date.now()}`, baseRole: 'cost_controller', tools: [{ module: 'boq', level: 'none' }] },
  })
  ok(template, 201, 'template')
  ok(
    await apiJson(client, 'put', `/projects/${projectId}/team/${readerId}/permissions`, { token, data: { templateId: template.body!.data!.id } }),
    200,
    'apply the template',
  )
  return { projectId, acts, readerEmail, ids: { byDefault: byDefault.body!.data!.id as string, entered: entered.body!.data!.id as string } }
}

test('a default cost forecast carries its marker and basis, an entered 0 is a forecast, an emptied forecast field is not sent, and a member without BOQ access sees a dash with the reason and no order of it', async ({
  page,
  browser,
}) => {
  test.setTimeout(420_000)
  const client = await apiClient()
  let built: Awaited<ReturnType<typeof build>>
  try {
    built = await build(client)
  } finally {
    await client.dispose()
  }
  const base = `/o/${org!.segment}/projects/${built.projectId}`

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 45_000 })

  // ── Cost register: the default is marked; the entered 0 is not.
  await page.goto(`${base}/cost/activity`)
  const defaultRow = page.locator('tr', { hasText: 'Pour byDefault' })
  const enteredRow = page.locator('tr', { hasText: 'Pour entered' })
  await expect(defaultRow).toBeVisible({ timeout: 45_000 })
  const defaultForecast = defaultRow.getByTestId('cost-record-forecast')
  await expect(defaultForecast).toHaveAttribute('data-forecast-source', 'default')
  await expect(defaultForecast).toHaveAttribute('title', DEFAULT_BASIS)
  await expect(defaultForecast).toContainText('$12,334')
  const marker = defaultRow.getByTestId('cost-record-forecast-default')
  await expect(marker).toHaveText('Default')
  await expect(marker).toHaveAttribute('title', DEFAULT_BASIS)
  const enteredForecast = enteredRow.getByTestId('cost-record-forecast')
  await expect(enteredForecast).toHaveAttribute('data-forecast-source', 'entered')
  await expect(enteredForecast).toHaveAttribute('title', ENTERED_BASIS)
  await expect(enteredForecast).toHaveText('$0')
  await expect(enteredRow.getByTestId('cost-record-forecast-default')).toHaveCount(0)
  await expect(page.getByTestId('cost-record-forecast-withheld')).toHaveCount(0)

  // ── Editing: emptying the Forecast field is "no forecast typed". Nothing is
  // sent, and the record stays a default — it is not turned into an entered 0.
  await defaultRow.getByRole('button', { name: 'Edit' }).click()
  const forecastInput = defaultRow.getByTestId('cost-record-forecast-input')
  await expect(forecastInput).toHaveValue('12333.51')
  await forecastInput.fill('')
  await defaultRow.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('The forecast was left as it was')).toBeVisible()
  await expect(defaultRow.getByTestId('cost-record-forecast-default')).toHaveText('Default')
  await expect(defaultRow.getByTestId('cost-record-forecast')).toContainText('$12,334')
  {
    const check = await apiClient()
    try {
      const listed = await apiJson(check, 'get', `/projects/${built.projectId}/cost?limit=100`, { token: org!.adminToken })
      const stored = (listed.body!.data as { rows: Array<{ id: string; forecast: number; forecastSource: string }> }).rows.find((row) => row.id === built.ids.byDefault)
      expect([stored?.forecast, stored?.forecastSource]).toEqual([12333.51, 'default'])
    } finally {
      await check.dispose()
    }
  }

  // ── By Phase: the summary's projection under its own name, not "Forecast".
  await page.goto(`${base}/cost/phase`)
  await expect(page.getByTestId('cost-phase-projected-header')).toHaveText('Projected final cost (cost records)', { timeout: 45_000 })

  // ── Cost overview: not called the EAC, and the mix is stated.
  await page.goto(`${base}/cost/overview`)
  const projected = page.getByTestId('uat-cost-forecast-eac')
  await expect(projected).toContainText('Projected final cost (cost records)', { timeout: 45_000 })
  await expect(projected).not.toContainText('EAC)')
  await expect(page.getByTestId('cost-eac-scenarios')).toContainText('Most likely projected final cost')
  await expect(page.getByTestId('cost-eac-scenarios')).not.toContainText('EAC')
  const sources = page.getByTestId('cost-forecast-sources')
  await expect(sources).toContainText('1 entered')
  await expect(sources).toContainText('1 default')
  await expect(sources).toContainText('0 source not recorded')

  // ── Activity detail drawer: the default's marker and basis; the entered one without.
  await page.goto(`${base}/activities?recordId=${built.acts.byDefault}&source=activity`)
  const figure = page.getByTestId('activity-detail-forecast')
  await expect(figure).toBeVisible({ timeout: 45_000 })
  await expect(figure.locator('[data-forecast-source="default"]')).toHaveText('Default')
  await expect(figure.locator('[data-forecast-source="default"]')).toHaveAttribute('title', DEFAULT_BASIS)
  await expect(figure).toContainText(DEFAULT_BASIS)
  await expect(figure.locator('[data-value="12333.51"]')).toBeVisible()
  await page.goto(`${base}/activities?recordId=${built.acts.entered}&source=activity`)
  await expect(page.getByTestId('activity-detail-drawer')).toHaveAttribute('data-activity-id', built.acts.entered, { timeout: 45_000 })
  await expect(page.getByTestId('activity-detail-forecast')).toContainText(ENTERED_BASIS)
  await expect(page.getByTestId('activity-detail-forecast').locator('[data-forecast-source="default"]')).toHaveCount(0)
  await expect(page.getByTestId('activity-detail-forecast').locator('[data-value="0"]')).toBeVisible()

  // ── A cost controller without BOQ access: a dash and the reason for the
  // default, never the figure and never 0; the entered forecast is shown.
  const context = await browser.newContext()
  const reader = await context.newPage()
  try {
    await reader.routeWebSocket(/socket\.io/, () => {})
    const answers: string[] = []
    reader.on('response', async (response) => {
      if (!response.url().includes('/api/v1/')) return
      const text = await response.text().catch(() => '')
      if (text) answers.push(text)
    })
    await signInForm(reader, built.readerEmail)
    await reader.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 45_000 })
    await reader.goto(`${base}/cost/activity`)
    const readerDefault = reader.locator('tr', { hasText: 'Pour byDefault' })
    await expect(readerDefault).toBeVisible({ timeout: 45_000 })
    const withheld = readerDefault.getByTestId('cost-record-forecast-withheld')
    await expect(withheld).toContainText('—')
    await expect(withheld).toContainText('available only to members who may read the BOQ')
    await expect(readerDefault.getByTestId('cost-record-forecast')).toHaveCount(0)
    await expect(readerDefault).not.toContainText('12,33')
    const readerEntered = reader.locator('tr', { hasText: 'Pour entered' })
    await expect(readerEntered.getByTestId('cost-record-forecast')).toHaveText('$0')

    await reader.goto(`${base}/activities?recordId=${built.acts.byDefault}&source=activity`)
    const readerFigure = reader.getByTestId('activity-detail-forecast')
    await expect(readerFigure).toBeVisible({ timeout: 45_000 })
    await expect(readerFigure.locator('[data-withheld="true"]')).toHaveText('—')
    await expect(readerFigure).toContainText('available only to members who may read the BOQ')
    await expect(readerFigure.locator('[data-value]')).toHaveCount(0)
    await reader.waitForLoadState('networkidle')
    // Sorted by Forecast, the withheld default does not take part in the
    // order: it follows the entered forecast in both directions (the BOQ
    // reader's descending order puts 12,333.51 first), and the server's reason
    // is on the screen.
    await reader.goto(`${base}/cost/activity`)
    await expect(reader.locator('tr', { hasText: 'Pour byDefault' })).toBeVisible({ timeout: 45_000 })
    await reader.getByTestId('cost-sort-by').click()
    await reader.getByRole('option', { name: 'Forecast' }).click()
    await expect(reader.getByTestId('cost-sort-withheld')).toContainText('not ordered by it')
    await expect(reader.locator('tbody tr').first()).toContainText('Pour entered')
    await reader.getByTestId('cost-sort-dir').click()
    await reader.getByRole('option', { name: 'Desc' }).click()
    await expect(reader.getByTestId('cost-sort-withheld')).toBeVisible()
    await expect(reader.locator('tbody tr').nth(1)).toContainText('Pour byDefault')
    await expect(reader.locator('tbody tr').first()).toContainText('Pour entered')
    await reader.waitForLoadState('networkidle')

    // No answer this member received states the allocation the default was built from.
    expect(answers.length).toBeGreaterThan(0)
    expect(answers.filter((text) => text.includes('12333.51'))).toEqual([])

    // They may update cost: the withheld default opens as an empty field, and
    // a forecast of their own replaces it — entered, and shown to them.
    const theirDefault = reader.locator('tr', { hasText: 'Pour byDefault' })
    await theirDefault.getByRole('button', { name: 'Edit' }).click()
    const theirInput = theirDefault.getByTestId('cost-record-forecast-input')
    await expect(theirInput).toHaveValue('')
    await expect(theirInput).toHaveAttribute('title', /available only to members who may read the BOQ/)
    await theirInput.fill('777')
    await theirDefault.getByRole('button', { name: 'Save' }).click()
    const theirs = theirDefault.getByTestId('cost-record-forecast')
    await expect(theirs).toHaveText('$777', { timeout: 45_000 })
    await expect(theirs).toHaveAttribute('data-forecast-source', 'entered')
    await expect(theirDefault.getByTestId('cost-record-forecast-withheld')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
