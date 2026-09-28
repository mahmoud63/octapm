import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
  // Two activities and no revision: a schedule, not "No schedule".
  await expect(page.getByTestId('uat-controls-schedule')).toHaveText('2 activities')
  await expect(page.getByTestId('uat-controls-schedule-tile')).toContainText('No revision')
  await expect(page.getByTestId('uat-controls-progress-method')).toHaveText('0/2')

  // §20: the figures row under the strip — each says which truth it is. No
  // allocation is approved, so there is no approved budget and no estimate
  // at completion: the forecast is tagged as no figure, never a projection
  // (round 3). Two priced rows are unmapped (the n/a row is not), nothing
  // is over-allocated.
  await expect(page.getByTestId('uat-controls-figures')).toBeVisible()
  await expect(page.getByTestId('uat-controls-figure-forecast-truth')).toHaveText('no figure')
  await expect(page.getByTestId('uat-controls-figure-forecast-value')).toHaveText('—')
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
  // Filing a BOQ row under a WBS node has no page yet: the guide says so and
  // is read, not followed — no link to a page that cannot resolve it.
  const boqGuide = structureStep.getByTestId('uat-setup-guide-boq_structure')
  await expect(boqGuide).toContainText('3 rows without a WBS node (filing comes with the BOQ item detail)')
  await expect(boqGuide).toHaveAttribute('data-inert', 'true')
  await expect(boqGuide).not.toHaveAttribute('href', /.*/)
  await expect(structureStep.getByTestId('uat-setup-guide-mapping_readiness')).toContainText('0% covered')
  const stepKeys = await page.locator('[data-testid^="uat-setup-step-"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-testid')!.replace('uat-setup-step-', '')),
  )
  expect(stepKeys.slice(0, 5)).toEqual(['project_profile', 'structure_setup', 'boq_upload', 'boq_approval', 'schedule_generation'])

  // The Structure step names the rows without a WBS node (all three, with
  // the count) — as information, named but not linked: nothing in the
  // product files a row yet (it comes with the BOQ item detail), so it holds
  // no step, the BOQ upload is complete as before PC-4, and no link sends the
  // PM to the BOQ grid, which cannot file it.
  await expect(page.getByTestId('uat-setup-step-boq_upload')).not.toContainText(/no WBS node/i)
  const boqStep = structureStep.getByTestId('uat-setup-advisories-structure_setup')
  const withoutWbs = boqStep.getByTestId('uat-setup-issue-BOQ_ITEMS_WITHOUT_WBS')
  await expect(withoutWbs).toContainText(/no WBS node/i)
  await expect(withoutWbs).toContainText('(3)')
  await expect(withoutWbs).toContainText('it comes with the BOQ item detail')
  const rebarLink = boqStep.getByTestId(`uat-setup-item-boq_item-${setup.rebar}`)
  await expect(rebarLink).toContainText('1.2 · Reinforcement to foundations')
  await expect(rebarLink).toContainText('WBS node')
  await expect(rebarLink).toHaveAttribute('data-inert', 'true')
  await expect(rebarLink).not.toHaveAttribute('href', /.*/)
  await expect(boqStep.getByTestId(`uat-setup-item-boq_item-${setup.concrete}`)).toBeVisible()
  await expect(boqStep.getByTestId(`uat-setup-item-boq_item-${setup.prelims}`)).toBeVisible()

  // ... and the activities without a node, beside them.
  const scheduleStep = boqStep
  const fixLink = scheduleStep.getByTestId(`uat-setup-item-activity-${setup.fix}`)
  await expect(fixLink).toContainText('A130 · Fix reinforcement')
  await expect(fixLink).toHaveAttribute('href', `${base}/activities?recordId=${setup.fix}&source=activity`)
  await expect(scheduleStep.getByTestId(`uat-setup-item-activity-${setup.pour}`)).toBeVisible()

  // The activity's link works: it opens the activities module.
  await page.getByTestId('uat-setup-step-structure_setup').getByTestId(`uat-setup-item-activity-${setup.fix}`).click()
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
    'Changes',
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
  // Changes opens the Commercial module at its change events.
  await (await openControls()).getByTestId('uat-module-child-controls-changes').click()
  await expect(page).toHaveURL(new RegExp(`${escaped}/commercial/change-events$`), { timeout: 30_000 })
  await expect(page.getByTestId('uat-project-content-commercial')).toBeVisible({ timeout: 30_000 })
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
    records: unknown[]
    budget?: { revisedBudget?: number | null; originalBudget?: number | null; source?: string | null }
    totals: { budget: number; actual: number }
    eac?: { mostLikely?: number | null }
  }
  type Forecast = {
    schedule?: { counts?: { complete: number; activities: number } }
    cost?: { eac?: number | null; eacBasis?: string | null }
    dataQuality?: string[]
  }
  const summary = summaryResponse.body!.data as unknown as Summary
  const forecast = forecastResponse.body!.data as unknown as Forecast
  const currency = ((projectResponse.body!.data as { currency?: string | null }).currency ?? null) as string | null
  const eac = summary.eac?.mostLikely as number
  // The register has no lines: its revised budget comes back as 0, which is
  // not a budget — the strip says so instead of printing USD 0.
  expect(summary.budget).toMatchObject({ source: 'budget_register', revisedBudget: 0 })
  expect(summary.records.length, 'the fixture has one cost record').toBe(1)
  expect(eac, 'the fixture keeps the ledger forecast apart from the budget').toBe(6400)
  // D2: the forecast at completion is the business-rule EAC the forecast
  // carries — here there is no approved allocation, so no revised BAC and
  // no EAC to present; the cost ledger's 6,400 stays in the cost cockpit.
  expect(forecast.cost?.eacBasis).toBe('no_budget')
  const money = (value: number) =>
    page.evaluate(
      ([code, amount]) =>
        `${code ? `${code} ` : ''}${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      [currency, value] as const,
    )
  await expect(page.getByTestId('uat-controls-figure-budget-value')).toHaveText('—')
  await expect(page.getByTestId('uat-controls-figure-budget')).toContainText('no budget register yet')
  await expect(page.getByTestId('uat-controls-figure-actual-value')).toHaveText(await money(summary.totals.actual))
  await expect(page.getByTestId('uat-controls-figure-actual')).toContainText('cost ledger as of')
  await expect(page.getByTestId('uat-controls-figure-forecast-value')).toHaveText('—')
  await expect(page.getByTestId('uat-controls-figure-forecast')).toContainText('no approved budget yet')
  await expect(page.getByTestId('uat-controls-figure-forecast')).toHaveAttribute('data-tone', 'neutral')
  await expect(page.getByTestId('uat-controls-figures')).not.toContainText(await money(eac))
  await expect(page.getByTestId('uat-controls-figures-basis')).toContainText('budget register and cost ledger as of')
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
 * §12 on screen: two members whose permission template sets the BOQ tool to
 * none — a site engineer (no cost tool either) and a cost controller (who
 * keeps it) — land on the Overview and open every tab of the Schedule
 * module — having first landed, as everyone does after signing in, on the
 * workspace home, whose project rows state each project's budget (bac) and
 * EAC. Every page renders without an error, a withheld figure reads as a
 * dash (never 0, $0k or NaN), and not one answer the browser receives on the
 * way carries a figure the server withholds from that person: no allocated
 * quantity, value or weight, no open or total bill value, no BOQ rows, and —
 * the cost controller included (owner decision E1, 2026-09-28) — no figure an
 * allocation gives one activity: its budget, the generator's per-activity or
 * per-WBS-node budget, its forecast cost, its row of the EV breakdown; each
 * screen shows a dash and "Mapping details unavailable to you". For the site
 * engineer, no project budget, EAC or projected cost built from the bill
 * either.
 *
 * The project carries an active generated revision (the generator's budgets
 * and BOQ rows in its snapshot, a WBS with a budget) and a staged one under
 * review, written into the LiveTest organisation by a backend script that
 * refuses any other organisation — the product only makes such revisions
 * through the AI generator.
 */
const TABS = [
  'gantt',
  'activities',
  'progress',
  'lookahead',
  'critical',
  'ev',
  'forecast',
  'milestones',
  'resources',
  'risks',
  'longLead',
  'wbs',
  'revisions',
] as const

// The bill's figures: withheld from both members.
const BOQ_KEYS = [
  'allocatedBoqAmount',
  'allocatedBoqQuantity',
  'allocatedBoqWeight',
  'unallocatedBoqAmount',
  'totalBoqAmount',
  'allocatableBoqAmount',
  'approvedAllocatedAmount',
  'pendingAllocatedAmount',
  'unallocatedAmount',
  'optionalUnallocatedAmount',
  'notApplicableAmount',
  'boqRows',
  // The mapping share (owner decision C): withheld, not rounded.
  'coveragePct',
  // ... and every count derived from the bill (the owner's rule): the
  // mapping counts, and the number of BOQ rows, of rows without a WBS node
  // or a cost code, of rows and unit spellings with an unknown unit, and a
  // revision's row counts.
  'itemsWithoutMappingRule',
  'suggestionsPending',
  'unitMismatchCount',
  'locationMismatchCount',
  'boqItems',
  'itemsWithoutWbs',
  'itemsWithoutCostCode',
  'itemsWithUnresolvedUnit',
  'unitsUnresolved',
  'revisionItems',
  'revisionChanges',
  'revisionBlockedRows',
  // ... and what is read off the mapping (owner decision, 2026-09-28): an
  // activity's approved allocation count (its mapping badge), and how many
  // critical activities have no approved allocation.
  'approvedAllocationCount',
  'criticalUnmappedActivities',
]
// The budgets built from the bill, and the forecast's money built from them:
// withheld from the member who reads neither the BOQ nor the cost module.
const BUDGET_KEYS = ['budget', 'generatedBudget', 'totalBudget', 'generatedTotalBudget', 'eac', 'bottomUp', 'bac']
// ... and the earned-value report's money, where the health card and the
// workspace home state it: EV is the allocations × % complete (a finished
// activity's budget), PV the cost loading, AC the cost ledger.
const EV_MONEY_KEYS = ['ev', 'pv', 'ac']
// ... and, from the forecast, what is read off the mapping (owner decision,
// 2026-09-28): an activity's cost has a basis, and a level above low, only
// when it has an approved allocation; only an activity with one can be
// among those over budget; the EAC's basis labels a withheld figure.
const FORECAST_ACTIVITY_MAPPING_KEYS = new Set(['basis', 'level'])
const FORECAST_COST_MAPPING_KEYS = new Set(['topRisks', 'atRisk', 'eacBasis'])
// ... and, for a cost reader without BOQ read (owner decision E1): each
// activity's budget and what is built from it; the project's cost stays.
const FORECAST_ACTIVITY_BUDGET_KEYS = new Set(['budget', 'projected', 'overrun', 'overrunPct', 'basis', 'level', 'reasons'])
const MAPPING_DETAILS_WITHHELD = 'Mapping details unavailable to you'
type ForecastRow = { id: string; isCritical?: boolean; cost?: Record<string, unknown> }
type ForecastAnswer = {
  activities?: ForecastRow[]
  schedule?: { topRisks?: ForecastRow[] } | null
  cost?: Record<string, unknown> | null
}

const keyPaths = (value: unknown, keys: Set<string>, at = ''): string[] =>
  value && typeof value === 'object'
    ? Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => [
        ...(keys.has(key) ? [`${at}.${key}`] : []),
        ...keyPaths(inner, keys, `${at}.${key}`),
      ])
    : []

const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url))

// The two revisions a generated schedule leaves, written straight into the
// LiveTest organisation's project: the script refuses any organisation not
// named `LiveTest <uuid>` and any project outside it.
const seedGeneratedRevisions = (orgId: string, projectId: string, criticalUnmappedId: string) => {
  const script = `
require('./src/utils/data-script-guard').exitUnlessDataScriptAllowed('e2e:pc4-generated-revisions');
const { prisma } = require('./src/config/db');
const [orgId, projectId, criticalUnmappedId] = process.argv.slice(1);
const snapshot = (label) => ({
  projectSummary: { name: label, startDate: '2026-01-05', endDate: '2026-12-18', totalBudget: 69999.99 },
  wbs: [{ code: 'A', level: 1, name: 'Substructure', budget: 69999.99 }],
  boqRows: [
    { description: 'Concrete in foundations', qty: 100, unit: 'm3', rate: 213.37, amount: 21337 },
    { description: 'Reinforcement to foundations', qty: 50, unit: 't', rate: 1009.13, amount: 50456.5 },
  ],
  activities: [
    { id: 'A100', activityCode: 'A100', name: 'Pour foundations', duration: 5, earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true, budget: 21337 },
    { id: 'A110', activityCode: 'A110', name: 'Fix reinforcement', duration: 6, earlyStart: 5, earlyFinish: 11, lateStart: 5, lateFinish: 11, totalFloat: 0, isCritical: true, predecessors: 'A100', budget: 48662.99 },
  ],
  source: 'ai',
});
(async () => {
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { name: true } });
  if (!org || !/^LiveTest [0-9a-f-]{36}$/.test(org.name)) throw new Error('refusing: not a LiveTest organisation');
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
  if (!project) throw new Error('refusing: the project is not in that organisation');
  const common = { projectId, source: 'ai', activityCount: 2, criticalCount: 2, totalBudget: 69999.99 };
  const active = await prisma.scheduleRevision.create({ data: { ...common, label: 'Rev A', status: 'approved', isActive: true, snapshotJson: snapshot('Rev A'), approvedAt: new Date(), activatedAt: new Date() } });
  const staged = await prisma.scheduleRevision.create({ data: { ...common, label: 'Rev B', status: 'under_review', isActive: false, snapshotJson: snapshot('Rev B'), submittedAt: new Date() } });
  // The pour is complete and approved: its earned value is its whole
  // allocation (21337, its budget), on the health card and the workspace home.
  const pour = await prisma.activity.findFirst({ where: { projectId, name: 'Pour foundations' }, select: { id: true } });
  if (pour) await prisma.activityProgress.create({ data: { activityId: pour.id, pctComplete: 100, status: 'approved', approvedAt: new Date(Date.now() - 60000), updatedAt: new Date(Date.now() - 60000) } });
  // A critical activity with no allocation (one known row of this project):
  // the forecast must not let a member without BOQ read tell it from a mapped one.
  const unmapped = await prisma.activity.findFirst({ where: { id: criticalUnmappedId, projectId }, select: { id: true } });
  if (!unmapped) throw new Error('refusing: the activity is not in that project');
  await prisma.activity.update({ where: { id: unmapped.id }, data: { isCritical: true, totalFloat: 0 } });
  process.stdout.write(JSON.stringify({ active: active.id, staged: staged.id }));
})()
  .catch((error) => { process.stderr.write(String(error && error.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
`
  const result = spawnSync(process.execPath, ['-e', script, orgId, projectId, criticalUnmappedId], {
    cwd: backendDir,
    env: process.env,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`seed revisions (exit ${result.status}): ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout) as { active: string; staged: string }
}

test('members who cannot read the BOQ: the Overview and every Schedule tab render without errors, and no answer carries a withheld figure', async ({ browser }) => {
  test.setTimeout(600_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      if (!org) org = await registerLiveOrg(client, 'pc4')
      const token = org.adminToken
      const projectId = await createProject(client, token, `BOQ withheld ${Date.now()}`)

      // Two members on the project, each under a template that takes the BOQ away.
      const member = async (role: 'site_engineer' | 'cost_controller', label: string) => {
        const email = `live-${role.replace('_', '-')}-${crypto.randomUUID()}@octapm-live.test`
        const created = await apiJson(client, 'post', '/users', {
          token,
          data: { name: `pc4 ${label}`, email, role, password: LIVE_PASSWORD },
        })
        expect(created.status, `add the ${label} -> ${JSON.stringify(created.body?.error)}`).toBe(201)
        const id = created.body!.data!.id as string
        const joined = await apiJson(client, 'post', `/projects/${projectId}/team`, { token, data: { userId: id, role } })
        expect(joined.status, `put the ${label} on the project -> ${JSON.stringify(joined.body?.error)}`).toBe(201)
        const template = await apiJson(client, 'post', '/permissions/templates', {
          token,
          data: { name: `No BOQ ${role} ${Date.now()}`, baseRole: role, tools: [{ module: 'boq', level: 'none' }] },
        })
        expect(template.status, `template -> ${JSON.stringify(template.body?.error)}`).toBe(201)
        const applied = await apiJson(client, 'put', `/projects/${projectId}/team/${id}/permissions`, {
          token,
          data: { templateId: template.body!.data!.id },
        })
        expect(applied.status, `apply the template -> ${JSON.stringify(applied.body?.error)}`).toBe(200)
        return { id, email }
      }
      const siteEngineer = await member('site_engineer', 'Site Engineer')
      const costController = await member('cost_controller', 'Cost Controller')

      // Two priced rows; all the concrete approved onto the pour, two fifths
      // of the steel onto the fixing — money on the activities, money open.
      const item = async (code: string, description: string, quantity: number, unit: string, rate: number) => {
        const row = await apiJson(client, 'post', `/projects/${projectId}/boq/items`, {
          token,
          data: { code, description, quantity, unit, rate },
        })
        expect(row.status, `create item ${code} -> ${JSON.stringify(row.body?.error)}`).toBe(201)
        return (row.body!.data as { item: { id: string } }).item.id
      }
      const activity = async (activityCode: string, name: string, startDate: string, endDate: string) => {
        const row = await apiJson(client, 'post', `/projects/${projectId}/activities`, {
          token,
          data: { name, activityCode, duration: 5, startDate, endDate, engineerIds: [org!.adminId, siteEngineer.id] },
        })
        expect(row.status, `create activity ${activityCode} -> ${JSON.stringify(row.body?.error)}`).toBe(201)
        return row.body!.data!.id as string
      }
      const concrete = await item('1.1', 'Concrete in foundations', 100, 'm3', 213.37)
      const rebar = await item('1.2', 'Reinforcement to foundations', 50, 't', 1009.13)
      const pour = await activity('A100', 'Pour foundations', '2026-02-02', '2026-02-06')
      const fix = await activity('A110', 'Fix reinforcement', '2026-01-26', '2026-02-01')
      // ... and a third, critical, that nothing is allocated to.
      const strip = await activity('A120', 'Strip formwork', '2026-02-09', '2026-02-13')
      for (const [boqItemId, activityId, quantity] of [
        [concrete, pour, 100],
        [rebar, fix, 20],
      ] as const) {
        const allocation = await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
          token,
          data: { boqItemId, activityId, quantity },
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
      }
      const revisions = seedGeneratedRevisions(org.orgId, projectId, strip)
      const full = await apiJson(client, 'get', `/projects/${projectId}/schedule`, { token })
      expect(JSON.stringify(full.body?.data), 'a BOQ reader gets the figure').toContain('"allocatedBoqAmount":21337')
      expect(full.body?.data?.revision, 'the generated revision is the active one').toMatchObject({ id: revisions.active })
      // The forecast tells a reader of the BOQ which activities have an
      // allocation: an activity's cost has a basis only when it has a budget.
      const readerForecast = await apiJson(client, 'get', `/projects/${projectId}/forecast`, { token })
      const readerActivities = (readerForecast.body?.data as unknown as ForecastAnswer).activities ?? []
      expect(readerActivities.find((row) => row.id === strip), 'the unmapped activity, for the reader').toMatchObject({ isCritical: true, cost: { basis: null } })
      expect(readerActivities.find((row) => row.id === pour)?.cost?.basis, 'the mapped activity, for the reader').toBeTruthy()
      return { projectId, siteEngineer, costController, revisions }
    } finally {
      await client.dispose()
    }
  })()

  const members = [
    {
      name: 'site engineer',
      email: setup.siteEngineer.email,
      readsCost: false,
      withheld: new Set([...BOQ_KEYS, ...BUDGET_KEYS, ...EV_MONEY_KEYS]),
      // The bill's total, open value and second row; the allocations and the
      // budgets built from them; the generator's total; the rates.
      secrets: ['71793.5', '30273.9', '50456.5', '21337', '20182.6', '41519.6', '69999.99', '213.37', '1009.13'],
    },
    {
      name: 'cost controller',
      email: setup.costController.email,
      readsCost: true,
      // ... and the generator's per-activity budget (owner decision E1).
      withheld: new Set([...BOQ_KEYS, 'generatedBudget']),
      // The fixing's allocation (20182.6) and the generator's budget for it
      // (48662.99) are that activity's own figures (E1); the project's EV —
      // the complete pour's allocation, 21337 — and the totals stay.
      secrets: ['71793.5', '30273.9', '50456.5', '213.37', '1009.13', '20182.6', '48662.99'],
    },
  ]

  for (const member of members) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const answers: { url: string; status: number; paths: string[]; secrets: string[] }[] = []
    const pending: Promise<void>[] = []
    // The API requests still in flight. A tab's reads can start after the
    // network first goes idle (a lazily loaded panel), and the next
    // navigation would cancel them — seen as aborted requests in the API
    // log — so the sweep would miss them. Each tab is left only once none
    // has been in flight for a quiet second.
    const inFlight = new Set<unknown>()
    const isApi = (url: string) => url.includes('/api/v1/')
    page.on('request', (request) => {
      if (isApi(request.url())) inFlight.add(request)
    })
    page.on('requestfinished', (request) => inFlight.delete(request))
    page.on('requestfailed', (request) => inFlight.delete(request))
    const apiSettled = async () => {
      let quietSince = Date.now()
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        if (inFlight.size) quietSince = Date.now()
        else if (Date.now() - quietSince >= 1_000) return
        await page.waitForTimeout(100)
      }
    }
    page.on('response', (response) => {
      const url = response.url()
      if (!url.includes('/api/v1/') || !(response.headers()['content-type'] ?? '').includes('json')) return
      pending.push(
        (async () => {
          const text = await response.text().catch(() => '')
          let body: unknown
          try {
            body = JSON.parse(text)
          } catch {
            body = null
          }
          // The EV report is a cost reader's, and so is its budget: the
          // approved allocations' sum it is built on stays for the cost
          // controller (the rule's budget); the bill's other figures do not.
          const allowed = member.readsCost && /\/reports\/ev(\?|$)/.test(url)
            ? new Set(['.data.approvedAllocatedAmount', '.data.sourceSummary.budget.approvedAllocatedAmount'])
            : new Set<string>()
          answers.push({
            url: `${response.request().method()} ${url.replace(/^.*\/api\/v1/, '')}`,
            status: response.status(),
            paths: keyPaths(body, member.withheld).filter((path) => !allowed.has(path)),
            secrets: member.secrets.filter((secret) => text.includes(secret)),
          })
        })()
      )
    })

    await signInForm(page, member.email)
    const base = `/o/${org!.segment}/projects/${setup.projectId}`
    const screenText = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ')
    const noBrokenFigure = async (where: string) => {
      const text = await screenText()
      expect(text, `${member.name}, ${where}: a figure read as NaN`).not.toMatch(/NaN/)
      // A chart of budgets the cost controller may read starts its axis at
      // $0k; for the site engineer no such chart is drawn at all.
      if (!member.readsCost) {
        expect(text, `${member.name}, ${where}: a withheld figure read as $0k`).not.toMatch(/\$0k/)
      }
    }

    // The workspace home, where signing in lands: its project rows carry
    // the project's scores — and, for a reader of the BOQ or the cost
    // module only, its budget and EAC.
    const home = page.waitForResponse((r) => /\/projects\/workspace-dashboard(\?|$)/.test(r.url()), {
      timeout: 30_000,
    })
    await page.goto(`/o/${org!.segment}`)
    await expect(page.getByTestId('workspace-dashboard')).toBeVisible({ timeout: 30_000 })
    const homeAnswer = await home
    expect(homeAnswer.status(), `${member.name}: the workspace home`).toBe(200)
    const homeRow = ((await homeAnswer.json()) as { data: { projectHealth: Record<string, unknown>[] } }).data.projectHealth.find(
      (row) => row.id === setup.projectId
    )
    expect(homeRow, `${member.name}: the project on the workspace home`).toBeTruthy()
    expect(['bac' in homeRow!, 'eac' in homeRow!, 'ev' in homeRow!, 'pv' in homeRow!, 'ac' in homeRow!, typeof homeRow!.overallScore]).toEqual([
      member.readsCost,
      member.readsCost,
      member.readsCost,
      member.readsCost,
      member.readsCost,
      'number',
    ])
    await page.waitForLoadState('networkidle')
    await noBrokenFigure('workspace home')

    // The landing: the Overview — the controls strip, the setup wizard, the
    // health card, the module bar's counts.
    const scheduleAnswer = page.waitForResponse((r) => /\/schedule(\?|$)/.test(r.url()), { timeout: 30_000 })
    const forecastAnswer = page.waitForResponse((r) => /\/forecast(\?|$)/.test(r.url()), { timeout: 30_000 })
    await page.goto(base)
    await expect(page.getByTestId('uat-project-content-overview')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 30_000 })
    await scheduleAnswer
    const forecastBody = (await (await forecastAnswer).json()) as { data: ForecastAnswer }
    if (!member.readsCost) {
      // No activity's cost basis or level, no list or tally of the
      // activities over budget, no EAC basis: nothing tells the critical
      // activity with no allocation from the mapped ones.
      const rows = [...(forecastBody.data.activities ?? []), ...(forecastBody.data.schedule?.topRisks ?? [])]
      expect(rows.length, 'the forecast lists the activities').toBeGreaterThanOrEqual(3)
      expect(keyPaths(rows.map((row) => row.cost), FORECAST_ACTIVITY_MAPPING_KEYS), `${member.name}: an activity's cost basis or level`).toEqual([])
      expect(rows.every((row) => row.cost?.withheld === true && row.cost?.reason === 'Cost figures are not available to you')).toBe(true)
      expect(keyPaths(forecastBody.data.cost, FORECAST_COST_MAPPING_KEYS), `${member.name}: the activities over budget`).toEqual([])
      expect(forecastBody.data.cost).toMatchObject({ withheld: true, reason: 'Cost figures are not available to you' })
    } else {
      // A cost reader without BOQ read (owner decision E1): the project's
      // cost, and no activity's budget, projection, basis or level — each
      // activity keeps the cost ledger's spend and commitments — and no list
      // or tally of the activities over budget.
      const rows = [...(forecastBody.data.activities ?? []), ...(forecastBody.data.schedule?.topRisks ?? [])]
      expect(rows.length, 'the forecast lists the activities').toBeGreaterThanOrEqual(3)
      expect(keyPaths(rows.map((row) => row.cost), FORECAST_ACTIVITY_BUDGET_KEYS), `${member.name}: an activity's budget`).toEqual([])
      expect(rows.every((row) => row.cost?.withheld === true && row.cost?.reason === MAPPING_DETAILS_WITHHELD)).toBe(true)
      expect(keyPaths(forecastBody.data.cost, new Set(['topRisks', 'atRisk'])), `${member.name}: the activities over budget`).toEqual([])
      expect(forecastBody.data.cost).toMatchObject({ budget: 41519.6, activityCostWithheld: true, activityCostReason: MAPPING_DETAILS_WITHHELD })
    }
    await page.waitForLoadState('networkidle')
    await noBrokenFigure('overview')
    // The health card's earned value and actual cost: a dash with the
    // reason for the site engineer, the figure for the cost controller.
    const evMetric = page.getByTestId('uat-health-metric-cost-ev')
    await expect(evMetric).toBeVisible({ timeout: 30_000 })
    if (member.readsCost) {
      await expect(evMetric).toContainText('21,337')
      await expect(page.getByTestId('uat-health-withheld-cost')).toHaveCount(0)
    } else {
      await expect(evMetric.locator('dd')).toHaveText('—')
      await expect(page.getByTestId('uat-health-metric-cost-ac').locator('dd')).toHaveText('—')
      await expect(page.getByTestId('uat-health-withheld-cost')).toContainText('BOQ or the cost module')
    }
    await expect(page.getByTestId('uat-health-dimension-cost')).not.toContainText('[object Object]')
    // C: no mapping share and no counts — the strip says the details are
    // unavailable, it never shows a figure it was not given.
    await expect(page.getByTestId('uat-controls-coverage-pct')).toHaveText('—')
    await expect(page.getByTestId('uat-controls-coverage-withheld')).toHaveText('Mapping details unavailable to you')
    await expect(page.getByTestId('uat-controls-figure-unmapped-value')).toHaveText('—')
    // The critical activities are the schedule's, counted for everyone; how
    // many have no approved allocation is read off the mapping (owner
    // decision, 2026-09-28): the tile says it is unavailable, never a count.
    await expect(page.getByTestId('uat-controls-figure-critical-value')).toHaveText(/^\d+$/)
    await expect(page.getByTestId('uat-controls-figure-critical-basis')).toContainText('Mapping details unavailable to you')
    await expect(page.getByTestId('uat-controls-figure-critical')).not.toContainText('without an approved allocation')
    // ... and so does the setup checklist's status line.
    const expandChecklist = page.getByTestId('uat-setup-readiness-expand')
    if (await expandChecklist.isVisible().catch(() => false)) await expandChecklist.click()
    await expect(page.getByTestId('uat-setup-headline-critical_unmapped')).toContainText('—')
    await expect(page.getByTestId('uat-setup-headline-critical_unmapped-withheld')).toHaveText(
      '(Mapping details unavailable to you)'
    )
    // D2: the forecast at completion is the business-rule EAC — without CPI
    // the revised BAC (41,519.60), said to be the budget — for the cost
    // reader; for the site engineer a dash and why.
    const forecastFigure = page.getByTestId('uat-controls-figure-forecast')
    if (member.readsCost) {
      await expect(page.getByTestId('uat-controls-figure-forecast-value')).toContainText('41,520')
      await expect(forecastFigure).toContainText('the budget — no cost performance yet')
    } else {
      await expect(page.getByTestId('uat-controls-figure-forecast-value')).toHaveText('—')
      await expect(forecastFigure).toContainText('Cost figures are not available to you')
    }

    for (const tab of TABS) {
      if (tab === 'wbs') {
        // The WBS tab is offered once the schedule says it has a WBS, so it
        // is opened from the module bar rather than by its address.
        await page.getByTestId('uat-module-tab-schedule').click()
        await page.getByTestId('uat-module-menu-schedule').getByTestId('uat-module-child-schedule-wbs').click()
        await expect(page).toHaveURL(/\/schedule\/wbs$/, { timeout: 30_000 })
      } else {
        // The Gantt reads its saved layouts after it renders, which can be
        // after the network first goes idle: wait for that answer, so the
        // next navigation cannot cancel it before it is recorded below.
        const layoutsAnswer =
          tab === 'gantt'
            ? page.waitForResponse(
                (r) => /\/schedule\/layouts(\?|$)/.test(r.url()) && r.request().method() === 'GET',
                { timeout: 45_000 }
              )
            : null
        await page.goto(`${base}/schedule/${tab}`)
        if (layoutsAnswer) expect((await layoutsAnswer).status()).toBe(200)
      }
      await expect(page.getByTestId('uat-project-content-schedule')).toBeVisible({ timeout: 30_000 })
      await expect(page.locator(`[role="tabpanel"][data-state="active"][id$="-content-${tab}"]`)).toBeVisible({
        timeout: 30_000,
      })
      await page.waitForLoadState('networkidle')
      await apiSettled()

      if (tab === 'gantt') {
        await expect(page.getByTestId('primavera-gantt')).toContainText('Pour foundations')
      }
      if (tab === 'activities') {
        const pourRow = page.locator('tr', { hasText: 'Pour foundations' }).first()
        await expect(pourRow).toBeVisible()
        // The activity's budget is its approved allocation: a dash and why,
        // for both members (owner decision E1), never the figure or $0.
        await expect(pourRow.getByTestId('uat-schedule-activity-budget-withheld')).toHaveText(`— ${MAPPING_DETAILS_WITHHELD}`)
        await expect(pourRow).not.toContainText('21,337')
      }
      if (tab === 'progress') {
        // Every live estimate there is built from the activity budgets,
        // withheld from both members (owner decision E1): none is shown,
        // and the activity reads a dash and why.
        await expect(page.getByText(/Budget — \(Mapping details unavailable to you\)/).first()).toBeVisible({ timeout: 30_000 })
        await expect(page.getByText('SPI Est.')).toHaveCount(0)
        await expect(page.getByText(/Total budget considered/)).toHaveCount(0)
      }
      if (tab === 'ev' && member.readsCost) {
        // The EV report's totals stay the cost reader's; its breakdown per
        // activity is built from the allocations (owner decision E1): a
        // dash and why, never an empty table.
        await expect(page.getByTestId('uat-ev-activity-breakdown-withheld')).toHaveText(`— ${MAPPING_DETAILS_WITHHELD}`, { timeout: 30_000 })
      }
      if (tab === 'forecast') {
        const cost = page.getByTestId('uat-forecast-cost')
        await expect(cost).toBeVisible({ timeout: 30_000 })
        if (member.readsCost) {
          await expect(cost).not.toContainText('Cost figures are not available to you')
          // Which activities are over budget is read off the mapping (E1).
          await expect(page.getByTestId('uat-forecast-cost-risks-withheld')).toHaveText(`— ${MAPPING_DETAILS_WITHHELD}`)
          await expect(page.getByText('No activity is projected over its budget.')).toHaveCount(0)
        } else {
          await expect(cost).toContainText('—')
          await expect(cost).toContainText('Cost figures are not available to you')
          await expect(cost).not.toContainText('Within the')
          // Which activities are over budget is withheld too: a dash and why,
          // never "No activity is projected over its budget."
          await expect(page.getByTestId('uat-forecast-cost-risks-withheld')).toHaveText('— Cost figures are not available to you')
          await expect(page.getByText('No activity is projected over its budget.')).toHaveCount(0)
        }
        // The explanation is written from the forecast this person receives.
        const explained = page.waitForResponse((r) => /\/forecast\/explain(\?|$)/.test(r.url()), { timeout: 60_000 })
        await page.getByTestId('uat-forecast-explain').click()
        expect((await explained).status()).toBe(200)
        await page.waitForLoadState('networkidle')
      }
      if (tab === 'wbs') {
        const row = page.getByTestId('uat-schedule-wbs-row-A')
        await expect(row).toBeVisible({ timeout: 30_000 })
        // The generator's per-node budget is the bill spread over the
        // programme, withheld from both members (owner decision E1): a dash
        // in the row, no rollup of $0k bars.
        await expect(row.locator('td').nth(3)).toHaveText('—')
        await expect(page.getByTestId('uat-schedule-wbs-rollup')).toHaveCount(0)
      }
      if (tab === 'revisions') {
        // The staged revision: its row, then the revision itself, viewed.
        const staged = page.locator('tr', { hasText: 'Rev B' }).first()
        await expect(staged).toBeVisible({ timeout: 30_000 })
        const viewed = page.waitForResponse(
          (r) => r.url().endsWith(`/schedule/revisions/${setup.revisions.staged}`),
          { timeout: 30_000 }
        )
        await staged.getByRole('button', { name: 'View' }).click()
        expect((await viewed).status()).toBe(200)
        await page.waitForLoadState('networkidle')
        await noBrokenFigure('schedule/revisions, viewing Rev B')
        await page.keyboard.press('Escape')
      }
      await noBrokenFigure(`schedule/${tab}`)
      await apiSettled()
    }

    // The Activities list: the BOQ value column reads a dash.
    await page.goto(`${base}/activities`)
    await expect(page.getByTestId('uat-project-content-activities')).toBeVisible({ timeout: 30_000 })
    const pourRow = page.locator('tr', { hasText: 'Pour foundations' })
    await expect(pourRow).toBeVisible({ timeout: 30_000 })
    const boqColumn = await page
      .locator('thead th')
      .evaluateAll((cells) => cells.findIndex((cell) => cell.textContent?.trim() === 'BOQ Value'))
    expect(boqColumn).toBeGreaterThanOrEqual(0)
    await expect(pourRow.locator('td').nth(boqColumn)).toHaveText('—')
    await page.waitForLoadState('networkidle')

    await Promise.all(pending)
    const urls = [...new Set(answers.map((answer) => answer.url.replace(/\?.*$/, '')))].sort()
    test.info().annotations.push({ type: `§12 ${member.name}`, description: `${answers.length} answers: ${urls.join(', ')}` })
    expect(
      answers.filter((answer) => answer.paths.length || answer.secrets.length),
      `${member.name}: an answer carried a withheld figure`
    ).toEqual([])
    // Every project request these pages make — the Overview's strip, wizard,
    // health card, needs-you panel and module bar, and the Schedule tabs —
    // was made, and swept above (the live test sweeps the same list).
    const project = `/projects/${setup.projectId}`
    const expected = [
      `GET ${project}`,
      `GET ${project}/activities`,
      `GET ${project}/activities/progress-submissions`,
      `GET ${project}/assignments/mine`,
      `GET ${project}/audit`,
      `GET ${project}/forecast`,
      `GET ${project}/health`,
      `GET ${project}/long-lead`,
      `GET ${project}/lookaheads`,
      `GET ${project}/lookaheads/constraints`,
      `GET ${project}/parties`,
      `GET ${project}/reports/ev`,
      `GET ${project}/reports/periods`,
      `GET ${project}/risks`,
      `GET ${project}/schedule`,
      `GET ${project}/schedule/layouts`,
      `GET ${project}/schedule/resources`,
      `GET ${project}/schedule/revisions`,
      `GET ${project}/schedule/revisions/${setup.revisions.staged}`,
      `GET ${project}/setup-readiness`,
      `GET ${project}/structure/wbs`,
      `POST ${project}/forecast/explain`,
      ...(member.readsCost ? [`GET ${project}/cost/summary`] : []),
    ].sort()
    expect(urls.filter((url) => url.startsWith(`GET ${project}`) || url.startsWith(`POST ${project}`))).toEqual(expected)
    // ... and the workspace home's answer before them (the live test sweeps it too).
    expect(urls, `${member.name}: the workspace home was answered and swept`).toContain('GET /projects/workspace-dashboard')
    // The EV tab is the cost reader's: the report answers them, and refuses
    // the site engineer outright.
    const ev = answers.find((answer) => /\/reports\/ev(\?|$)/.test(answer.url))
    expect(ev?.status, `${member.name}: the EV report`).toBe(member.readsCost ? 200 : 403)
    expect(errors, `${member.name}: page errors`).toEqual([])
    await context.close()
  }
})
