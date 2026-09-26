import { test, expect } from '@playwright/test'
import { apiClient } from './support'
import {
  apiJson,
  createProject,
  dropLiveOrg,
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
