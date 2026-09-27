import { test, expect } from '@playwright/test'
import { API, apiClient } from './support'
import {
  apiJson,
  createProject,
  dropLiveOrg,
  LIVE_PASSWORD,
  registerLiveOrg,
  signInForm,
  type LiveOrg,
} from './support-workspaces'

/**
 * Setup wizard detail and the Overview landing (PC-4).
 *
 * A project lands on its Overview: a controls strip (setup readiness, the
 * bill's revision, allocation coverage with the not-applicable bucket, the
 * schedule, the progress method) above the setup checklist. The checklist
 * names the rows behind each step's issues — the BOQ row filed under no
 * WBS node, the activity filed under none — and each name is a link that
 * opens the module with the record in the URL, under the workspace.
 *
 * The bill and the programme are created through the API; what is under
 * test is the screen. It runs against its own API and Vite (the PC-4
 * driver), in a throwaway LiveTest organisation registered through the
 * product's sign-up (support-workspaces), never the E2E or demo ones.
 */

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

test('overview landing shows the controls strip; the wizard lists the offending rows and links to them', async ({ page }) => {
  const client = await apiClient()
  const setup = await (async () => {
    try {
      org = await registerLiveOrg(client, 'pc4')
      const token = org.adminToken
      const projectId = await createProject(client, token, `Setup detail ${Date.now()}`)

      const wbs = await apiJson(client, 'post', `/projects/${projectId}/structure/wbs`, {
        token,
        data: { code: 'A', name: 'Substructure' },
      })
      expect(wbs.status, `create wbs -> ${JSON.stringify(wbs.body?.error)}`).toBe(201)
      const wbsId = wbs.body!.data!.id as string

      const item = async (code: string, description: string, quantity: number, unit: string, rate: number) => {
        const row = await apiJson(client, 'post', `/projects/${projectId}/boq/items`, {
          token,
          data: { code, description, quantity, unit, rate },
        })
        expect(row.status, `create item ${code} -> ${JSON.stringify(row.body?.error)}`).toBe(201)
        return (row.body!.data as { item: { id: string } }).item.id
      }
      const activity = async (activityCode: string, name: string) => {
        const row = await apiJson(client, 'post', `/projects/${projectId}/activities`, {
          token,
          data: {
            name,
            activityCode,
            duration: 5,
            startDate: '2026-02-02',
            endDate: '2026-02-06',
            engineerIds: [org!.adminId],
          },
        })
        expect(row.status, `create activity ${activityCode} -> ${JSON.stringify(row.body?.error)}`).toBe(201)
        return row.body!.data!.id as string
      }
      // Two priced rows and a preliminaries row (n/a); two activities. The
      // project has a WBS node but nothing is filed under it yet (the grid's
      // structure editor is another wave's screen), so every row and every
      // activity is one the wizard must name.
      const concrete = await item('1.1', 'Concrete in foundations', 100, 'm3', 200)
      const rebar = await item('1.2', 'Reinforcement to foundations', 50, 't', 1000)
      const prelims = await item('P.1', 'Site establishment', 1, 'sum', 30000)
      const pour = await activity('1.1', 'Pour foundations')
      const fix = await activity('A130', 'Fix reinforcement')
      const ruled = await apiJson(client, 'patch', `/projects/${projectId}/activity-boq-allocations/mapping-rules`, {
        token,
        data: { rule: 'not_applicable', itemIds: [prelims] },
      })
      expect(ruled.status).toBe(200)
      return { projectId, concrete, rebar, prelims, pour, fix, wbsId }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`

  // The landing is the Overview, not the Gantt.
  await page.goto(base)
  await expect(page).toHaveURL(new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?(\\?.*)?$`))
  await expect(page.getByTestId('uat-project-content-overview')).toBeVisible({ timeout: 30_000 })

  // The controls strip: the figures the readiness check derives.
  const strip = page.getByTestId('uat-controls-strip')
  await expect(strip).toBeVisible()
  await expect(page.getByTestId('uat-controls-readiness-pct')).toHaveText(/^\d+%$/)
  await expect(page.getByTestId('uat-controls-boq-revision')).toHaveText('3 rows')
  await expect(page.getByTestId('uat-controls-coverage-pct')).toHaveText('0%')
  await expect(page.getByTestId('uat-controls-na-amount')).toContainText('30,000')
  await expect(page.getByTestId('uat-controls-schedule')).toHaveText('No schedule')
  await expect(page.getByTestId('uat-controls-progress-method')).toHaveText('0/2')

  // §20: the figures row under the strip — each says which truth it is, and
  // the forecast says it is a projection. Two priced rows are unmapped (the
  // n/a row is not), nothing is over-allocated.
  await expect(page.getByTestId('uat-controls-figures')).toBeVisible()
  await expect(page.getByTestId('uat-controls-figure-forecast-truth')).toHaveText('projection')
  await expect(page.getByTestId('uat-controls-figure-actual-truth')).toHaveText('derived')
  await expect(page.getByTestId('uat-controls-figure-unmapped-value')).toHaveText('2')
  await expect(page.getByTestId('uat-controls-figure-exceptions-value')).toHaveText('0')
  // Both activities sit on the critical path (no links yet) and neither
  // has an approved allocation: the readiness check counts them.
  await expect(page.getByTestId('uat-controls-figure-critical-value')).toHaveText('2')
  await expect(page.getByTestId('uat-controls-figure-critical')).toContainText('2 without an approved allocation')

  // The wizard: expand it if this browser remembered it collapsed, then the
  // two new steps sit where §89 puts them.
  const expand = page.getByTestId('uat-setup-readiness-expand')
  if (await expand.isVisible().catch(() => false)) await expand.click()
  await expect(page.getByTestId('uat-setup-step-structure_setup')).toBeVisible()
  await expect(page.getByTestId('uat-setup-step-boq_approval')).toBeVisible()

  // §33: the status line before the cards.
  const headline = page.getByTestId('uat-setup-headline')
  await expect(headline.getByTestId('uat-setup-headline-boq_imported')).toHaveText(/BOQ imported\s*PASS/)
  await expect(headline.getByTestId('uat-setup-headline-schedule_imported')).toHaveText(/Schedule imported\s*PASS/)
  await expect(headline.getByTestId('uat-setup-headline-mapping')).toHaveText(/Mapping\s*0%/)
  await expect(headline.getByTestId('uat-setup-headline-baseline')).toHaveText(/Baseline\s*NOT APPROVED/)
  await expect(headline.getByTestId('uat-setup-headline-cost_loading')).toHaveText(/Cost loading\s*INCOMPLETE/)

  // §21: the structure step guides WBS, locations, cost codes, the BOQ and
  // schedule structure and mapping readiness, each a link to its page.
  const structureStep = page.getByTestId('uat-setup-step-structure_setup')
  const wbsGuide = structureStep.getByTestId('uat-setup-guide-wbs')
  await expect(wbsGuide).toContainText('1 node')
  await expect(wbsGuide).toHaveAttribute('href', `${base}/controls/structure`)
  await expect(structureStep.getByTestId('uat-setup-guide-locations')).toHaveAttribute('href', `${base}/locations`)
  await expect(structureStep.getByTestId('uat-setup-guide-cost_codes')).toHaveAttribute('href', `${base}/cost/budget`)
  await expect(structureStep.getByTestId('uat-setup-guide-boq_structure')).toContainText('3 rows without a WBS node')
  await expect(structureStep.getByTestId('uat-setup-guide-mapping_readiness')).toContainText('0% covered')
  const stepKeys = await page.locator('[data-testid^="uat-setup-step-"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-testid')!.replace('uat-setup-step-', '')),
  )
  expect(stepKeys.slice(0, 5)).toEqual(['project_profile', 'structure_setup', 'boq_upload', 'boq_approval', 'schedule_generation'])

  // The BOQ upload step names the rows without a WBS node (all three, with
  // the count), each a link into the grid with the record in the URL, under
  // the workspace.
  const boqStep = page.getByTestId('uat-setup-step-boq_upload')
  const withoutWbs = boqStep.getByTestId('uat-setup-issue-BOQ_ITEMS_WITHOUT_WBS')
  await expect(withoutWbs).toContainText(/no WBS node/i)
  await expect(withoutWbs).toContainText('(3)')
  const rebarLink = boqStep.getByTestId(`uat-setup-item-boq_item-${setup.rebar}`)
  await expect(rebarLink).toContainText('1.2 · Reinforcement to foundations')
  await expect(rebarLink).toContainText('WBS node')
  await expect(rebarLink).toHaveAttribute('href', `${base}/boq?recordId=${setup.rebar}&source=boq_item`)
  await expect(boqStep.getByTestId(`uat-setup-item-boq_item-${setup.concrete}`)).toBeVisible()
  await expect(boqStep.getByTestId(`uat-setup-item-boq_item-${setup.prelims}`)).toBeVisible()

  // The schedule step names the activities without a node.
  const scheduleStep = page.getByTestId('uat-setup-step-schedule_generation')
  const fixLink = scheduleStep.getByTestId(`uat-setup-item-activity-${setup.fix}`)
  await expect(fixLink).toContainText('A130 · Fix reinforcement')
  await expect(fixLink).toHaveAttribute('href', `${base}/activities?recordId=${setup.fix}&source=activity`)
  await expect(scheduleStep.getByTestId(`uat-setup-item-activity-${setup.pour}`)).toBeVisible()

  // The links work: the BOQ row opens the BOQ module with the record in the
  // URL, the activity opens the activities module.
  await rebarLink.click()
  await expect(page).toHaveURL(new RegExp(`/boq\\?recordId=${setup.rebar}&source=boq_item$`))
  await expect(page.getByTestId('uat-project-content-boq')).toBeVisible({ timeout: 30_000 })
  await page.goBack()
  await expect(page.getByTestId('uat-project-content-overview')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('uat-setup-step-schedule_generation').getByTestId(`uat-setup-item-activity-${setup.fix}`).click()
  await expect(page).toHaveURL(new RegExp(`/activities\\?recordId=${setup.fix}&source=activity$`))
  await expect(page.getByTestId('uat-project-content-activities')).toBeVisible({ timeout: 30_000 })

  // The strip's coverage tile opens the mapping matrix.
  await page.goto(base)
  await expect(page.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('uat-controls-coverage').click()
  await expect(page).toHaveURL(new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/controls/mapping$`))
  await expect(page.getByTestId('uat-mapping-page')).toBeVisible({ timeout: 30_000 })

  // §19: one Project Controls group in the project's module bar, listing
  // the bill, the programme, the mapping and what follows from them, in
  // working order; an entry owned by another module opens that module.
  const openControls = async () => {
    await page.getByTestId('uat-module-tab-controls').click()
    const menu = page.getByTestId('uat-module-menu-controls')
    await expect(menu).toBeVisible()
    return menu
  }
  const menu = await openControls()
  await expect(menu).toContainText(/Project Controls/i)
  const entries = await menu
    .locator('[data-testid^="uat-module-child-controls-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()))
  expect(entries).toEqual([
    'Overview',
    'Structure',
    'Schedule',
    'BOQ',
    'Mapping',
    'Progress',
    'Cost',
    'Forecast',
    'Resources',
    'Risks',
    'Baselines / Revisions',
  ])
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await menu.getByTestId('uat-module-child-controls-boq').click()
  await expect(page).toHaveURL(new RegExp(`${escaped}/boq$`), { timeout: 30_000 })
  await expect(page.getByTestId('uat-project-content-boq')).toBeVisible({ timeout: 30_000 })
  await (await openControls()).getByTestId('uat-module-child-controls-progress').click()
  await expect(page).toHaveURL(new RegExp(`${escaped}/schedule/progress$`), { timeout: 30_000 })
  await expect(page.getByTestId('uat-project-content-schedule')).toBeVisible({ timeout: 30_000 })
  await (await openControls()).getByTestId('uat-module-child-controls-structure').click()
  await expect(page).toHaveURL(new RegExp(`${escaped}/controls/structure$`), { timeout: 30_000 })
  await (await openControls()).getByTestId('uat-module-child-controls-overview').click()
  await expect(page).toHaveURL(new RegExp(`${escaped}/overview$`), { timeout: 30_000 })
  await expect(page.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 30_000 })
})

/**
 * §22 and §20 on screen: an uploaded bill's revision on the approval card —
 * revision, status, scope, value, changes and the review trail with the
 * people named — and the strip's money and progress figures, each the
 * figure the cost summary and the forecast state. The strip asks for those
 * only once this person's permission matrix has arrived (Phase 22B): the
 * matrix is held back here, and no figure request may go out before it.
 */
test('the bill revision on the approval card, the strip figures as the services state them, and no figure asked for before the permissions', async ({ page }) => {
  const client = await apiClient()
  const setup = await (async () => {
    try {
      if (!org) org = await registerLiveOrg(client, 'pc4')
      const token = org.adminToken
      const projectId = await createProject(client, token, `Setup revision ${Date.now()}`)

      // The product's own BOQ template, downloaded and uploaded as the bill:
      // three priced rows (revision 1, three added).
      const template = await client.get(`${API}/projects/${projectId}/boq/template`, {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(template.status(), 'download the BOQ template').toBe(200)
      const upload = await client.post(`${API}/projects/${projectId}/boq/upload`, {
        headers: { authorization: `Bearer ${token}` },
        multipart: {
          file: {
            name: 'boq-template.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            buffer: await template.body(),
          },
        },
      })
      const uploaded = (await upload.json()) as { data?: { revisionId?: string; mode?: string }; error?: unknown }
      expect(upload.status(), `upload the bill -> ${JSON.stringify(uploaded.error)}`).toBe(200)
      expect(uploaded.data?.mode).toBe('imported')
      const revisionId = uploaded.data!.revisionId as string
      const submitted = await apiJson(client, 'post', `/projects/${projectId}/boq/revisions/${revisionId}/submit`, {
        token,
        data: {},
      })
      expect(submitted.status, `submit -> ${JSON.stringify(submitted.body?.error)}`).toBe(200)

      // One activity with a cost row whose forecast is above its budget, so
      // the budget and the forecast at completion are different figures.
      const activity = await apiJson(client, 'post', `/projects/${projectId}/activities`, {
        token,
        data: {
          name: 'Bulk excavation',
          activityCode: '1.2',
          duration: 5,
          startDate: '2026-02-02',
          endDate: '2026-02-06',
          engineerIds: [org.adminId],
        },
      })
      expect(activity.status, `create activity -> ${JSON.stringify(activity.body?.error)}`).toBe(201)
      const cost = await apiJson(client, 'post', `/projects/${projectId}/cost/activity/${activity.body!.data!.id}`, {
        token,
        data: { budget: 5000, forecast: 6400 },
      })
      expect(cost.status, `cost row -> ${JSON.stringify(cost.body?.error)}`).toBe(201)
      return { projectId, revisionId, token }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`

  // Hold the permission matrix back and record when the figure requests go out.
  let permissionsAnsweredAt = Number.POSITIVE_INFINITY
  const figureRequests: { url: string; at: number }[] = []
  const isFigure = (url: string) =>
    new RegExp(`/projects/${setup.projectId}/(cost/summary|forecast)(\\?|$)`).test(url)
  page.on('request', (request) => {
    if (isFigure(request.url())) figureRequests.push({ url: request.url(), at: Date.now() })
  })
  await page.route('**/auth/me/permissions**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const response = await route.fetch()
    permissionsAnsweredAt = Date.now()
    await route.fulfill({ response })
  })

  const figureResponse = page.waitForResponse((response) => /\/cost\/summary(\?|$)/.test(response.url()), {
    timeout: 30_000,
  })
  await page.goto(base)
  await expect(page.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 30_000 })
  await figureResponse
  expect(figureRequests.length, 'the strip reads the cost summary and the forecast').toBeGreaterThan(0)
  for (const request of figureRequests) {
    expect(request.at, `${request.url} went out before the permission matrix`).toBeGreaterThanOrEqual(permissionsAnsweredAt)
  }
  await page.unroute('**/auth/me/permissions**')

  // §20: budget, actual, forecast at completion and progress are what the
  // cost summary and the forecast say, formatted as the strip formats money.
  const figuresClient = await apiClient()
  const [summaryResponse, forecastResponse, projectResponse] = await Promise.all([
    apiJson(figuresClient, 'get', `/projects/${setup.projectId}/cost/summary`, { token: setup.token }),
    apiJson(figuresClient, 'get', `/projects/${setup.projectId}/forecast`, { token: setup.token }),
    apiJson(figuresClient, 'get', `/projects/${setup.projectId}`, { token: setup.token }),
  ])
  await figuresClient.dispose()
  type Summary = {
    budget?: { revisedBudget?: number | null }
    totals: { budget: number; actual: number }
    eac?: { mostLikely?: number | null }
  }
  type Forecast = {
    schedule?: { counts?: { complete: number; activities: number } }
    dataQuality?: string[]
  }
  const summary = summaryResponse.body!.data as unknown as Summary
  const forecast = forecastResponse.body!.data as unknown as Forecast
  const currency = ((projectResponse.body!.data as { currency?: string | null }).currency ?? null) as string | null
  const budget = summary.budget?.revisedBudget ?? summary.totals.budget
  const eac = summary.eac?.mostLikely as number
  expect(eac, 'the fixture keeps the forecast apart from the budget').not.toBe(budget)
  const money = (value: number) =>
    page.evaluate(
      ([code, amount]) =>
        `${code ? `${code} ` : ''}${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      [currency, value] as const,
    )
  await expect(page.getByTestId('uat-controls-figure-budget-value')).toHaveText(await money(budget))
  await expect(page.getByTestId('uat-controls-figure-actual-value')).toHaveText(await money(summary.totals.actual))
  await expect(page.getByTestId('uat-controls-figure-forecast-value')).toHaveText(await money(eac))
  const counts = forecast.schedule!.counts!
  await expect(page.getByTestId('uat-controls-figure-progress-value')).toHaveText(
    `${counts.complete.toLocaleString()}/${counts.activities.toLocaleString()}`,
  )
  await expect(page.getByTestId('uat-controls-figure-data-quality-value')).toHaveText(
    String((forecast.dataQuality ?? []).length),
  )

  // §22: the bill under review — revision, status, scope, value, changes
  // and the trail so far.
  await expect(page.getByTestId('uat-controls-boq-revision')).toHaveText('Rev 1')
  const expand = page.getByTestId('uat-setup-readiness-expand')
  if (await expand.isVisible().catch(() => false)) await expand.click()
  const approvalCard = page.getByTestId('uat-setup-step-boq_approval')
  const revision = approvalCard.getByTestId('uat-setup-boq-revision')
  await expect(revision).toBeVisible()
  await expect(revision.getByTestId('uat-setup-boq-revision-number')).toContainText('Rev 1')
  await expect(revision.getByTestId('uat-setup-boq-revision-status')).toContainText('Under review')
  await expect(revision.getByTestId('uat-setup-boq-revision-scope')).toContainText('3 rows')
  await expect(revision.getByTestId('uat-setup-boq-revision-scope')).toContainText(await money(252_500))
  await expect(revision.getByTestId('uat-setup-boq-revision-changes')).toContainText('+3 added')
  const history = revision.getByTestId('uat-setup-boq-revision-history')
  await expect(history).toContainText('Submitted by pc4 Admin')
  await expect(history).not.toContainText('Approved by')
  await expect(approvalCard.getByTestId('uat-setup-issue-PENDING_BOQ_REVISION')).toBeVisible()

  // Approved: the card says so and the trail names the approver.
  const approveClient = await apiClient()
  const approved = await apiJson(
    approveClient,
    'post',
    `/projects/${setup.projectId}/boq/revisions/${setup.revisionId}/approve`,
    { token: setup.token, data: {} },
  )
  await approveClient.dispose()
  expect(approved.status, `approve -> ${JSON.stringify(approved.body?.error)}`).toBe(200)
  await page.reload()
  const approvedCard = page.getByTestId('uat-setup-step-boq_approval')
  const expandAgain = page.getByTestId('uat-setup-readiness-expand')
  if (await expandAgain.isVisible({ timeout: 5_000 }).catch(() => false)) await expandAgain.click()
  await expect(approvedCard.getByTestId('uat-setup-boq-revision-status')).toContainText('Approved', { timeout: 30_000 })
  await expect(approvedCard.getByTestId('uat-setup-boq-revision-history')).toContainText('Submitted by pc4 Admin')
  await expect(approvedCard.getByTestId('uat-setup-boq-revision-history')).toContainText('Approved by pc4 Admin')
  await expect(page.getByTestId('uat-controls-boq-revision')).toHaveText('Rev 1')
  await expect(page.getByTestId('uat-controls-boq')).toContainText('Approved')
})

/**
 * §12 on screen: a site engineer whose permission template sets the BOQ
 * tool to none lands on the Overview, opens the Gantt and the Activities
 * list, and every one of them renders without an error while the server
 * hands this person no BOQ figure — the schedule's and the activities'
 * answers carry no allocated quantity, value or weight, no open value and
 * no budget (a site engineer has no cost tool either), and the Activities
 * list reads the withheld BOQ value as a dash, not as 0.
 */
test('a member who cannot read the BOQ: the landing, the Gantt and the Activities list render without errors and without a BOQ figure', async ({ page }) => {
  const client = await apiClient()
  const setup = await (async () => {
    try {
      if (!org) org = await registerLiveOrg(client, 'pc4')
      const token = org.adminToken
      const projectId = await createProject(client, token, `BOQ withheld ${Date.now()}`)

      // A site engineer on the project, under a template that takes the BOQ away.
      const email = `live-se-${crypto.randomUUID()}@octapm-live.test`
      const member = await apiJson(client, 'post', '/users', {
        token,
        data: { name: 'pc4 Site Engineer', email, role: 'site_engineer', password: LIVE_PASSWORD },
      })
      expect(member.status, `add the member -> ${JSON.stringify(member.body?.error)}`).toBe(201)
      const memberId = member.body!.data!.id as string
      const joined = await apiJson(client, 'post', `/projects/${projectId}/team`, {
        token,
        data: { userId: memberId, role: 'site_engineer' },
      })
      expect(joined.status, `put them on the project -> ${JSON.stringify(joined.body?.error)}`).toBe(201)
      const template = await apiJson(client, 'post', '/permissions/templates', {
        token,
        data: { name: `No BOQ ${Date.now()}`, baseRole: 'site_engineer', tools: [{ module: 'boq', level: 'none' }] },
      })
      expect(template.status, `template -> ${JSON.stringify(template.body?.error)}`).toBe(201)
      const applied = await apiJson(client, 'put', `/projects/${projectId}/team/${memberId}/permissions`, {
        token,
        data: { templateId: template.body!.data!.id },
      })
      expect(applied.status, `apply the template -> ${JSON.stringify(applied.body?.error)}`).toBe(200)

      // One priced row, allocated in full and approved to one activity, so
      // the activity carries the bill's value for a BOQ reader.
      const row = await apiJson(client, 'post', `/projects/${projectId}/boq/items`, {
        token,
        data: { code: '1.1', description: 'Concrete in foundations', quantity: 100, unit: 'm3', rate: 213.37 },
      })
      expect(row.status, `create item -> ${JSON.stringify(row.body?.error)}`).toBe(201)
      const activity = await apiJson(client, 'post', `/projects/${projectId}/activities`, {
        token,
        data: {
          name: 'Pour foundations',
          activityCode: 'A100',
          duration: 5,
          startDate: '2026-02-02',
          endDate: '2026-02-06',
          engineerIds: [org.adminId, memberId],
        },
      })
      expect(activity.status, `create activity -> ${JSON.stringify(activity.body?.error)}`).toBe(201)
      const allocation = await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
        token,
        data: {
          boqItemId: (row.body!.data as { item: { id: string } }).item.id,
          activityId: activity.body!.data!.id,
          quantity: 100,
        },
      })
      expect(allocation.status, `allocate -> ${JSON.stringify(allocation.body?.error)}`).toBe(201)
      for (const step of ['submit', 'approve']) {
        const moved = await apiJson(
          client,
          'post',
          `/projects/${projectId}/activity-boq-allocations/${allocation.body!.data!.id}/${step}`,
          { token, data: {} }
        )
        expect(moved.status, `${step} -> ${JSON.stringify(moved.body?.error)}`).toBe(200)
      }
      const full = await apiJson(client, 'get', `/projects/${projectId}/schedule`, { token })
      expect(JSON.stringify(full.body?.data), 'a BOQ reader gets the figure').toContain('"allocatedBoqAmount":21337')
      return { projectId, email, activityId: activity.body!.data!.id as string }
    } finally {
      await client.dispose()
    }
  })()

  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const withheld = /"(allocatedBoqAmount|allocatedBoqQuantity|allocatedBoqWeight|unallocatedBoqAmount|budget|totalBudget|generatedBudget|generatedTotalBudget|boqRows)"/
  const answers: { url: string; leaked: boolean }[] = []
  page.on('response', async (response) => {
    const url = response.url()
    if (!new RegExp(`/projects/${setup.projectId}/(schedule|activities)(\\?|$)`).test(url)) return
    const text = await response.text().catch(() => '')
    answers.push({ url, leaked: withheld.test(text) })
  })

  await signInForm(page, setup.email)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`

  // The landing: the Overview, with the schedule asked for its counts.
  const scheduleAnswer = page.waitForResponse((r) => /\/schedule(\?|$)/.test(r.url()), { timeout: 30_000 })
  await page.goto(base)
  await expect(page.getByTestId('uat-project-content-overview')).toBeVisible({ timeout: 30_000 })
  await scheduleAnswer

  // The Gantt.
  await page.goto(`${base}/schedule`)
  await expect(page.getByTestId('uat-project-content-schedule')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('primavera-gantt')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('primavera-gantt')).toContainText('Pour foundations')

  // Progress: every live estimate there is built from the budgets, so with
  // them withheld none is shown (no row of zeros); the activity reads a
  // dash for its budget.
  await page.goto(`${base}/schedule/progress`)
  await expect(page.getByTestId('uat-project-content-schedule')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Budget —/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('SPI Est.')).toHaveCount(0)
  await expect(page.getByText(/Total budget considered/)).toHaveCount(0)

  // The Activities list: the BOQ value column reads a dash.
  const activitiesAnswer = page.waitForResponse((r) => /\/activities(\?|$)/.test(r.url()), { timeout: 30_000 })
  await page.goto(`${base}/activities`)
  await expect(page.getByTestId('uat-project-content-activities')).toBeVisible({ timeout: 30_000 })
  await activitiesAnswer
  const pourRow = page.locator('tr', { hasText: 'Pour foundations' })
  await expect(pourRow).toBeVisible()
  const boqColumn = await page.locator('thead th').evaluateAll((cells) =>
    cells.findIndex((cell) => cell.textContent?.trim() === 'BOQ Value')
  )
  expect(boqColumn).toBeGreaterThanOrEqual(0)
  await expect(pourRow.locator('td').nth(boqColumn)).toHaveText('—')

  expect(answers.map((answer) => answer.url).join('\n'), 'the schedule and the activities were read').toMatch(/\/schedule/)
  expect(answers.some((answer) => /\/activities(\?|$)/.test(answer.url))).toBe(true)
  expect(answers.filter((answer) => answer.leaked).map((answer) => answer.url)).toEqual([])
  expect(errors).toEqual([])
})
