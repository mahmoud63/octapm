import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext } from '@playwright/test'
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
 * PC-4 acceptance, round 1 — what the Overview, the Earned Value tab, the
 * Forecast tab, the WBS tab and the Revisions tab say, on screen.
 *
 *   §4 earned value: the S-curve plots EV only where it was measured (this
 *     report's cutoff and each locked period's), never a flat line written
 *     back into months nobody measured; the EV tab and the Overview state
 *     the same cutoff date; the Overview's cost figures say what they are
 *     and as of when, apart from the earned value
 *   forecast fallbacks: no cost records, an empty budget register, no CPI —
 *     each a dash or a stated basis, never USD 0 presented as a projection
 *   the forecast tile is judged against its own basis
 *   the WBS outline follows the snapshot's own parent ids
 *   a hand-entered bill's approval card sends to the page that approves it
 *   Rollback is offered only when there is something to restore
 *
 * The browser is put west of UTC (Chicago), where a cutoff instant read in
 * local time falls on the previous day. Everything is built in throwaway
 * "LiveTest <uuid>" organisations through the API; the few rows the product
 * only writes over time (approved progress on past dates, approved cost
 * loading, an imported revision) are written by a backend script that
 * refuses any organisation not named "LiveTest <uuid>".
 */

test.use({ timezoneId: 'America/Chicago' })

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url))

/** Runs `body` (with prisma, projectId, args) against a LiveTest organisation's project only. */
const seed = (orgId: string, projectId: string, body: string, args: unknown = {}) => {
  const script = `
require('./src/utils/data-script-guard').exitUnlessDataScriptAllowed('e2e:pc4-acceptance');
const { prisma } = require('./src/config/db');
const [orgId, projectId, rawArgs] = process.argv.slice(1);
const args = JSON.parse(rawArgs);
(async () => {
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { name: true } });
  if (!org || !/^LiveTest [0-9a-f-]{36}$/.test(org.name)) throw new Error('refusing: not a LiveTest organisation');
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
  if (!project) throw new Error('refusing: the project is not in that organisation');
  const out = await (async () => { ${body} })();
  process.stdout.write(JSON.stringify(out ?? null));
})()
  .catch((error) => { process.stderr.write(String(error && error.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
`
  const result = spawnSync(process.execPath, ['-e', script, orgId, projectId, JSON.stringify(args)], {
    cwd: backendDir,
    env: process.env,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`seed (exit ${result.status}): ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout || 'null')
}

const ok = (response: { status: number; body: { error?: unknown } | null }, expected: number, what: string) =>
  expect(response.status, `${what} -> ${JSON.stringify(response.body?.error)}`).toBe(expected)

const createItem = async (client: APIRequestContext, token: string, projectId: string, data: Record<string, unknown>) => {
  const row = await apiJson(client, 'post', `/projects/${projectId}/boq/items`, { token, data })
  ok(row, 201, `item ${data.code}`)
  return (row.body!.data as { item: { id: string } }).item.id
}

const createActivity = async (client: APIRequestContext, projectId: string, data: Record<string, unknown>) => {
  const row = await apiJson(client, 'post', `/projects/${projectId}/activities`, {
    token: org!.adminToken,
    data: { duration: 5, engineerIds: [org!.adminId], ...data },
  })
  ok(row, 201, `activity ${data.activityCode}`)
  return row.body!.data!.id as string
}

const allocate = async (client: APIRequestContext, projectId: string, boqItemId: string, activityId: string, quantity: number) => {
  const token = org!.adminToken
  const allocation = await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
    token,
    data: { boqItemId, activityId, quantity },
  })
  ok(allocation, 201, 'allocate')
  for (const step of ['submit', 'approve']) {
    const moved = await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations/${allocation.body!.data!.id}/${step}`, {
      token,
      data: {},
    })
    ok(moved, 200, step)
  }
}

/**
 * §4 on screen. A 100,000 bill allocated to one activity; approved cost
 * loading in June, July and August; 40% approved on 10 July and 90% on
 * 20 August; July's period locked (its snapshot stores EV 40,000), August's
 * open (EV 90,000). The service writes today's EV into every month up to the
 * cutoff; the tab must plot July's locked 40,000 and August's 90,000 only.
 */
test('earned value is plotted only where it was measured, the EV tab and the Overview state one cutoff, and the Overview says what its cost figures are', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      if (!org) org = await registerLiveOrg(client, 'pc4acc')
      const token = org.adminToken
      const projectId = await createProject(client, token, `EV basis ${Date.now()}`)
      const item = await createItem(client, token, projectId, { code: '1.1', description: 'Concrete frame', quantity: 100, unit: 'm3', rate: 1000 })
      const activity = await createActivity(client, projectId, { name: 'Concrete frame', activityCode: 'A100', startDate: '2026-06-01', endDate: '2026-08-28' })
      await allocate(client, projectId, item, activity, 100)
      seed(
        org.orgId,
        projectId,
        `
        const common = { projectId, activityId: args.activity, status: 'approved', approvedAt: new Date('2026-06-01T12:00:00Z') };
        for (const [plannedDate, plannedValue] of [['2026-06-15', 30000], ['2026-07-15', 30000], ['2026-08-15', 40000]]) {
          await prisma.activityCostLoading.create({ data: { ...common, plannedDate: new Date(plannedDate + 'T12:00:00Z'), plannedValue } });
        }
        for (const [pctComplete, at] of [[40, '2026-07-10T12:00:00Z'], [90, '2026-08-20T12:00:00Z']]) {
          await prisma.activityProgress.create({ data: { activityId: args.activity, pctComplete, status: 'approved', approvedAt: new Date(at), updatedAt: new Date(at) } });
        }
        `,
        { activity },
      )
      const period = async (code: string, periodStart: string, periodEnd: string) => {
        const created = await apiJson(client, 'post', `/projects/${projectId}/reports/periods`, {
          token,
          data: { code, periodStart, periodEnd, cutoffDate: periodEnd },
        })
        ok(created, 201, `period ${code}`)
        return created.body!.data!.id as string
      }
      const july = await period('P07', '2026-07-01', '2026-07-31')
      await period('P08', '2026-08-01', '2026-08-31')
      const locked = await apiJson(client, 'post', `/projects/${projectId}/reports/periods/${july}/lock`, {
        token,
        data: { overrideReason: 'LiveTest PC-4 acceptance: lock July over the setup gate' },
      })
      ok(locked, 200, 'lock July')
      expect(locked.body!.data!.ev, 'July locked at 40% of the allocation').toBe(40000)
      const report = await apiJson(client, 'get', `/projects/${projectId}/reports/ev`, { token })
      ok(report, 200, 'EV report')
      const data = report.body!.data as { ev: number; cpi: number | null; sCurve: { label: string; ev: number | null }[] }
      // The premise: the service backfills today's EV into the months before
      // the cutoff — the flat line the tab must not draw.
      expect(data.ev).toBe(90000)
      expect(data.sCurve.filter((row) => row.ev === 90000).map((row) => row.label)).toEqual(
        expect.arrayContaining(['Jun 26', 'Jul 26']),
      )
      expect(data.cpi).toBeNull()
      return { projectId }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`

  // The Earned Value tab.
  await page.goto(`${base}/schedule/ev`)
  const curve = page.getByTestId('uat-ev-scurve')
  await expect(curve).toBeVisible({ timeout: 30_000 })
  await expect(curve).toHaveAttribute('data-ev-points', JSON.stringify([['Jul 26', 40000], ['Aug 26', 90000]]))
  await expect(page.getByTestId('uat-ev-scurve-history-note')).toContainText(
    'EV history is only available for locked periods; earlier months are not shown',
  )
  const evCutoff = (await page.getByTestId('uat-ev-cutoff').innerText()).trim()
  expect(evCutoff).toBe('Aug 31, 2026')
  await expect(page.getByTestId('uat-ev-cutoff-instant')).toContainText('UTC')
  // With no CPI the EAC is the budget, and says so.
  await expect(page.getByText('Budget — no CPI yet')).toBeVisible()
  await expect(page.getByText('Budget / CPI')).toHaveCount(0)

  // The Overview: the same cutoff on the health card and in the strip's
  // basis line; the strip's cost figures are the ledger's, as of today.
  await page.goto(base)
  await expect(page.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('uat-health-cutoff')).toHaveText(`EV cutoff ${evCutoff}`, { timeout: 30_000 })
  await expect(page.getByTestId('uat-controls-ev-cutoff')).toHaveText(evCutoff)
  await expect(page.getByTestId('uat-health-provenance-cost')).toContainText(`through ${evCutoff}`)
  await expect(page.getByTestId('uat-controls-figures-basis')).toContainText('budget register and cost ledger as of')
  // No cost records, no budget register: dashes with the reason — never USD 0.
  await expect(page.getByTestId('uat-controls-figure-budget-value')).toHaveText('—')
  await expect(page.getByTestId('uat-controls-figure-budget')).toContainText('no budget register yet')
  for (const figure of ['actual', 'forecast']) {
    await expect(page.getByTestId(`uat-controls-figure-${figure}-value`)).toHaveText('—')
    await expect(page.getByTestId(`uat-controls-figure-${figure}`)).toContainText('no cost records yet')
  }
  await expect(page.getByTestId('uat-controls-figures')).not.toContainText(/USD 0\b|\$0\b/)

  // The Forecast tab: with no CPI the projected cost is the budget handed
  // back, and says so beside the reason.
  await page.goto(`${base}/schedule/forecast`)
  const cost = page.getByTestId('uat-forecast-cost')
  await expect(cost).toBeVisible({ timeout: 30_000 })
  await expect(cost).toContainText('no cost performance yet')
  await expect(cost).not.toContainText('Within the')
  await expect(page.getByTestId('uat-forecast-cost-note')).toContainText('CPI is not available yet: no official cost-record actuals')
})

/**
 * The forecast tile against its own basis: a register budget of 1,000,000
 * beside a forecast of 60,000 on 21,337 of allocated budget — heavily over
 * its own basis, well under the register. The tile reads "review", and it
 * opens the Cost overview, where its figure is stated.
 */
test('the forecast at completion is judged against its own basis and opens where its figure is stated; activities without a revision are a schedule', async ({ page }) => {
  test.setTimeout(180_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      if (!org) org = await registerLiveOrg(client, 'pc4acc')
      const token = org.adminToken
      const projectId = await createProject(client, token, `Forecast basis ${Date.now()}`)
      const item = await createItem(client, token, projectId, { code: '1.1', description: 'Concrete in foundations', quantity: 100, unit: 'm3', rate: 213.37 })
      const activity = await createActivity(client, projectId, { name: 'Pour foundations', activityCode: 'A100', startDate: '2026-02-02', endDate: '2026-02-06' })
      await allocate(client, projectId, item, activity, 100)
      const record = await apiJson(client, 'post', `/projects/${projectId}/cost/activity/${activity}`, {
        token,
        data: { budget: 21337, forecast: 60000 },
      })
      ok(record, 201, 'cost record')
      const code = await apiJson(client, 'post', '/company/cost-codes', {
        token,
        data: { code: `LT-${Date.now()}`, name: 'Concrete works', category: 'material' },
      })
      ok(code, 201, 'cost code')
      const costCodeId = code.body!.data!.id as string
      ok(await apiJson(client, 'put', `/projects/${projectId}/budget/cost-codes`, { token, data: { costCodeIds: [costCodeId] } }), 200, 'select cost code')
      ok(
        await apiJson(client, 'post', `/projects/${projectId}/budget/lines`, {
          token,
          data: { costCodeId, costType: 'material', originalBudget: 1000000 },
        }),
        201,
        'budget line',
      )
      const summary = await apiJson(client, 'get', `/projects/${projectId}/cost/summary`, { token })
      const data = summary.body!.data as { budget: { revisedBudget: number; allocatedToActivities: number }; eac: { mostLikely: number } }
      // The premise: register ≠ allocated, and the forecast over the allocated.
      expect([data.budget.revisedBudget, data.budget.allocatedToActivities, data.eac.mostLikely]).toEqual([1000000, 21337, 60000])
      return { projectId }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`
  await page.goto(base)
  await expect(page.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('uat-controls-figure-budget-value')).toContainText('1,000,000')
  await expect(page.getByTestId('uat-controls-figure-budget')).toContainText('budget register, revised')
  const forecast = page.getByTestId('uat-controls-figure-forecast')
  await expect(page.getByTestId('uat-controls-figure-forecast-value')).toContainText('60,000')
  await expect(forecast).toHaveAttribute('data-tone', 'review')
  // One activity, entered without a revision: a schedule, and what to do next.
  await expect(page.getByTestId('uat-controls-schedule')).toHaveText('1 activity')
  await expect(page.getByTestId('uat-controls-schedule-tile')).toContainText('No revision')
  await forecast.click()
  await expect(page).toHaveURL(new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/cost/overview$`), { timeout: 30_000 })
})

/**
 * An imported programme's WBS (XER-shaped: wbsId / parentWbsId, the short
 * code "FDN" under both CIV and MEP), a hand-entered bill, and two revisions:
 * the active one approved, rolled forward from one that stored no
 * activities. The WBS tab follows the snapshot's parents; the rows view has
 * no Budget column; the bill's approval card sends to the page that locks
 * the baseline; Rollback is offered only once there is something to restore.
 */
test('the WBS outline follows the snapshot parents, the hand-entered bill card opens the baseline lock, and Rollback needs something to restore', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      if (!org) org = await registerLiveOrg(client, 'pc4acc')
      const token = org.adminToken
      const projectId = await createProject(client, token, `WBS outline ${Date.now()}`)
      await createItem(client, token, projectId, { code: '1.1', description: 'Blinding', quantity: 10, unit: 'm3', rate: 90 })
      const revisions = seed(
        org.orgId,
        projectId,
        `
        const wbs = [
          { wbsId: 'W1', parentWbsId: null, code: 'CIV', name: 'Civil works' },
          { wbsId: 'W2', parentWbsId: 'W1', code: 'FDN', name: 'Civil foundations' },
          { wbsId: 'W3', parentWbsId: 'W1', code: 'SUP', name: 'Superstructure' },
          { wbsId: 'W4', parentWbsId: null, code: 'MEP', name: 'MEP works' },
          { wbsId: 'W5', parentWbsId: 'W4', code: 'FDN', name: 'MEP foundations' },
          { wbsId: 'W6', parentWbsId: 'W5', code: 'L3', name: 'Plinths' },
        ];
        const activities = [
          { id: 'T1', activityCode: 'T1', name: 'Excavate', duration: 5, wbsCode: 'FDN', earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
        ];
        const before = await prisma.scheduleRevision.create({ data: { projectId, label: 'Rev A', source: 'xer', status: 'superseded', isActive: false, activityCount: 1, approvedAt: new Date(), activatedAt: new Date() } });
        const active = await prisma.scheduleRevision.create({ data: { projectId, label: 'Rev B', source: 'xer', status: 'approved', isActive: true, activityCount: 1, criticalCount: 1, approvedAt: new Date(), activatedAt: new Date(), previousActiveRevisionId: before.id, snapshotJson: { wbs, activities, source: 'xer' } } });
        return { before: before.id, active: active.id };
        `,
      ) as { before: string; active: string }
      return { projectId, revisions }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`

  // The WBS tab, from the module bar (offered once the schedule has a WBS,
  // so it is opened from there rather than by its address).
  const openWbs = async () => {
    await page.goto(`${base}/schedule/gantt`)
    await expect(page.getByTestId('uat-project-content-schedule')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('uat-module-tab-schedule').click()
    await page.getByTestId('uat-module-menu-schedule').getByTestId('uat-module-child-schedule-wbs').click()
    await expect(page).toHaveURL(/\/schedule\/wbs$/, { timeout: 30_000 })
  }
  await openWbs()
  await page.getByRole('button', { name: 'Expand All' }).click()
  const outline = async () =>
    page.locator('[data-testid^="uat-schedule-wbs-row-"]').evaluateAll((rows) =>
      rows.map((row) => [
        row.getAttribute('data-testid')!.replace('uat-schedule-wbs-row-', ''),
        Number(row.getAttribute('data-depth')),
        row.querySelectorAll('td')[1]?.textContent?.trim(),
      ]),
    )
  await expect(page.locator('[data-testid^="uat-schedule-wbs-row-"]')).toHaveCount(6, { timeout: 30_000 })
  expect(await outline()).toEqual([
    ['CIV', 0, 'Civil works'],
    ['FDN', 1, 'Civil foundations'],
    ['SUP', 1, 'Superstructure'],
    ['MEP', 0, 'MEP works'],
    ['FDN', 1, 'MEP foundations'],
    ['L3', 2, 'Plinths'],
  ])

  // The project's own WBS rows: no Budget column, and the counts are direct.
  const client2 = await apiClient()
  ok(await apiJson(client2, 'post', `/projects/${setup.projectId}/structure/wbs`, { token: org!.adminToken, data: { code: 'A', name: 'Substructure' } }), 201, 'wbs node')
  await client2.dispose()
  await openWbs()
  await expect(page.getByTestId('uat-schedule-wbs-row-A')).toBeVisible({ timeout: 30_000 })
  const headers = await page.locator('thead th').allInnerTexts()
  expect(headers.map((text) => text.trim())).toEqual(['WBS Code', 'Name', 'Duration', 'Activities (direct)', 'Responsible'])

  // Revisions: Rev B is active, rolled forward from Rev A, which stored no
  // activities — nothing to restore, so no Rollback.
  await page.goto(`${base}/schedule/revisions`)
  const activeRow = page.locator('tr', { hasText: 'Rev B' }).first()
  await expect(activeRow).toBeVisible({ timeout: 30_000 })
  await expect(activeRow.getByRole('button', { name: 'Rollback' })).toHaveCount(0)
  // Once Rev A stores its activities, Rollback is offered.
  seed(org!.orgId, setup.projectId, `
    await prisma.scheduleRevision.update({ where: { id: args.before }, data: { snapshotJson: { activities: [{ id: 'T1', activityCode: 'T1', name: 'Excavate', duration: 5 }] } } });
  `, { before: setup.revisions.before })
  await page.reload()
  await expect(page.locator('tr', { hasText: 'Rev B' }).first().getByRole('button', { name: 'Rollback' })).toBeVisible({ timeout: 30_000 })

  // The hand-entered bill: its approval card names the baseline lock and
  // opens the page that offers it.
  await page.goto(base)
  const expand = page.getByTestId('uat-setup-readiness-expand')
  if (await expand.isVisible({ timeout: 5_000 }).catch(() => false)) await expand.click()
  const approval = page.getByTestId('uat-setup-step-boq_approval')
  await expect(approval).toContainText('it is approved when the schedule baseline is locked (Schedule → Lock Baseline)', { timeout: 30_000 })
  await approval.getByRole('button', { name: 'Lock schedule baseline' }).click()
  await expect(page).toHaveURL(/\/schedule\/revisions$/, { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Lock Baseline' })).toBeVisible({ timeout: 30_000 })
})
