import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiClient } from './support'
import { apiJson, createProject, dropLiveOrg, registerLiveOrg, signInForm, type LiveOrg } from './support-workspaces'

/**
 * The Forecast panel shows the forecast's calendar dates as the server sent
 * them (owner decision R5-1's surface; the Round-6 review's finding).
 *
 * The forecast's planned and projected finishes are calendar dates
 * (`YYYY-MM-DD`). Read through `new Date(value).toLocaleDateString()` they
 * are UTC midnights shown in the viewer's zone, so everyone west of UTC saw
 * the day before: the API and the mobile app said 23 May, the web panel said
 * 22 May. The browser here is in Chicago, and every date on the panel is
 * compared with the very response the panel drew — the projected finish, the
 * planned finish, and each listed activity's two dates — so the check does
 * not depend on the day it runs. `asOf` is an instant and stays in the
 * reader's own time.
 *
 * Under "Projected slip" the row's second figure is said in words — "+60 d
 * recorded impact", never a bare "(+60)" beside a slip of nothing — and the
 * note under the table says what the two figures are and how they make the
 * main driver's days.
 *
 * Built in a throwaway "LiveTest <uuid>" organisation through the API: two
 * activities and one approved change order with 60 days on the first.
 */

// West of UTC: a calendar date read as an instant lands on the evening before.
test.use({ timezoneId: 'America/Chicago', locale: 'en-US' })

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

type ForecastActivity = { id: string; name: string; plannedFinish: string | null; projectedFinish: string | null; slipDays: number; impactDays: number }
type Forecast = {
  available: boolean
  asOf: string
  schedule: { plannedFinish: string; projectedFinish: string; slipDays: number; criticalDriver: { id: string; name: string; slipDays: number } | null; topRisks: ForecastActivity[] }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
/** `2027-05-23` as an en-US reader writes that calendar date: 5/23/2027. */
const usDay = (value: string) => {
  expect(value, 'the server sends a calendar date').toMatch(DATE_ONLY)
  const [year, month, day] = value.split('-').map(Number)
  return `${month}/${day}/${year}`
}

const build = async (client: APIRequestContext) => {
  org = await registerLiveOrg(client, 'r6fcdates')
  const token = org.adminToken
  const projectId = await createProject(client, token, `Forecast dates ${Date.now()}`)
  const send = async (route: string, data: unknown, expected: number) => {
    const response = await apiJson(client, 'post', `/projects/${projectId}${route}`, { token, data })
    expect(response.status, `${route} -> ${JSON.stringify(response.body?.error)}`).toBe(expected)
    return response.body!.data as { id: string }
  }
  const walls = await send('/activities', { name: 'Blockwork walls', activityCode: 'R6X', duration: 9, startDate: '2027-03-13', endDate: '2027-03-24', engineerIds: [org.adminId] }, 201)
  await send('/activities', { name: 'Finishes', activityCode: 'R6P', duration: 13, startDate: '2027-03-24', endDate: '2027-04-08', engineerIds: [org.adminId], dependencies: [{ predecessorId: walls.id, relationshipType: 'FS', lagDays: 0 }] }, 201)
  const order = await send(
    '/change-orders',
    {
      description: 'LiveTest instruction: fair-faced blockwork',
      category: 'variation',
      value: 500,
      scheduleImpactSummary: '60 days on the activity',
      costImpactSummary: 'priced',
      activityLinks: [{ activityId: walls.id, relationType: 'impacted', scheduleImpactDays: 60 }],
      attachmentRefs: [{ fileName: 'LiveTest proof.pdf', fileUrl: 'https://example.test/proof.pdf' }],
    },
    201,
  )
  await send(`/change-orders/${order.id}/submit`, {}, 200)
  await send(`/change-orders/${order.id}/approve`, { comment: 'LiveTest' }, 200)
  return { projectId, wallsId: walls.id }
}

// An instant whose Chicago day (31 December, 21:30) is the day before its UTC
// day. The server's `asOf` is "now", whose two days agree most of the day, so
// the panel is handed this one in the server's otherwise untouched answer.
const AS_OF = '2027-01-01T03:30:00.000Z'

/** Opens the Forecast tab and returns the forecast the panel drew. */
const openForecast = async (page: Page, projectId: string) => {
  const isForecast = (url: string) => new URL(url).pathname.endsWith(`/projects/${projectId}/forecast`)
  await page.route(
    (url) => isForecast(url.href),
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const body = (await response.json()) as { data: Forecast }
      body.data.asOf = AS_OF
      await route.fulfill({ response, json: body })
    },
  )
  const answered = page.waitForResponse((response) => isForecast(response.url()) && response.request().method() === 'GET' && response.status() === 200, { timeout: 60_000 })
  await page.goto(`/o/${org!.segment}/projects/${projectId}/schedule/forecast`)
  const forecast = ((await (await answered).json()) as { data: Forecast }).data
  await expect(page.getByTestId('uat-forecast')).toBeVisible({ timeout: 60_000 })
  return forecast
}

let built: { projectId: string; wallsId: string } | null = null
/** The fixture, built once for the file. */
const fixture = async () => {
  if (!built) {
    const client = await apiClient()
    built = await build(client).finally(() => client.dispose())
  }
  return built
}

test('a reader west of UTC sees the calendar dates the server sent, not the day before', async ({ page }) => {
  test.setTimeout(240_000)
  const { projectId, wallsId } = await fixture()

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  const forecast = await openForecast(page, projectId)
  expect(forecast.available).toBe(true)
  const { schedule } = forecast

  // This browser does move a UTC midnight to the evening before: the defect
  // would show here.
  expect(await page.evaluate((value) => new Date(value).toLocaleDateString('en-US'), schedule.projectedFinish)).not.toBe(usDay(schedule.projectedFinish))

  // The headline: the projected finish, and the planned finish beside it.
  const finish = page.getByTestId('uat-forecast-finish')
  await expect(finish).toContainText(usDay(schedule.projectedFinish))
  await expect(finish).toContainText(schedule.slipDays > 0 ? `${schedule.slipDays} days after the plan (${usDay(schedule.plannedFinish)})` : `On the planned ${usDay(schedule.plannedFinish)}`)

  // Every listed activity's planned and projected dates, row for row.
  expect(schedule.topRisks.map((activity) => activity.id)).toContain(wallsId)
  const rows = page.getByTestId('uat-forecast-activity')
  await expect(rows).toHaveCount(schedule.topRisks.length)
  for (const [index, activity] of schedule.topRisks.entries()) {
    const row = rows.nth(index)
    await expect(row).toContainText(activity.name)
    await expect(row.getByTestId('uat-forecast-activity-planned')).toHaveText(activity.plannedFinish ? usDay(activity.plannedFinish) : '—')
    await expect(row.getByTestId('uat-forecast-activity-projected')).toHaveText(activity.projectedFinish ? usDay(activity.projectedFinish) : '—')
  }

  // `asOf` is an instant: shown as the reader's own day (31 December in
  // Chicago), not as the UTC calendar date (1 January).
  expect(forecast.asOf).toBe(AS_OF)
  await expect(page.getByTestId('uat-forecast')).toContainText('as of 12/31/2026.')
})

test('the recorded impact under "Projected slip" is said in words, with a note that reconciles it with the main driver', async ({ page }) => {
  test.setTimeout(240_000)
  const { projectId, wallsId } = await fixture()

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  const { schedule } = await openForecast(page, projectId)
  const index = schedule.topRisks.findIndex((activity) => activity.id === wallsId)
  expect(index).toBeGreaterThanOrEqual(0)
  const walls = schedule.topRisks[index]
  // The approved change order's 60 days, as the server counts them.
  expect(walls.impactDays).toBe(60)

  const rows = page.getByTestId('uat-forecast-activity')
  await expect(rows).toHaveCount(schedule.topRisks.length)
  const impact = rows.nth(index).getByTestId('uat-forecast-activity-impact')
  await expect(impact).toHaveText('+60 d recorded impact')
  await expect(rows.nth(index)).not.toContainText('(+60)')
  // The same sentence is the figure's tooltip and the note under the table.
  const legend = page.getByTestId('uat-forecast-slip-legend')
  await expect(legend).toContainText('“+N d recorded impact” is the days recorded against the activity')
  await expect(legend).toContainText('The main driver’s days are its projected slip plus its recorded impact.')
  await expect(impact).toHaveAttribute('title', (await legend.innerText()).trim())
  // A row without a recorded impact says nothing about one.
  for (const [other, activity] of schedule.topRisks.entries()) {
    if (activity.impactDays === 0) await expect(rows.nth(other).getByTestId('uat-forecast-activity-impact')).toHaveCount(0)
  }
  // What the note says is what the server did: the driver's days are its
  // projected slip plus its recorded impact. No figure is changed here.
  expect(schedule.criticalDriver?.id).toBe(wallsId)
  expect(schedule.criticalDriver?.slipDays).toBe(walls.slipDays + walls.impactDays)
  await expect(page.getByTestId('uat-forecast')).toContainText(`${walls.slipDays + walls.impactDays} days of projected slip`)
  // Still a projection, never an extension of time.
  expect(await page.getByTestId('uat-forecast').innerText()).not.toMatch(/extension of time|\bEOT\b|approved delay|granted/i)
})
