import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { API, apiClient } from './support'
import {
  apiJson,
  createProject,
  dropLiveOrg,
  registerLiveOrg,
  signInForm,
  type LiveOrg,
} from './support-workspaces'

/**
 * PC-4 merge gate, round 4 — on screen:
 *
 *   the EV tab's ETC, when the EAC is the budget handed back (CPI 0 with
 *      actual cost above the budget, or no cost performance yet), is a dash
 *      with the reason — never "budget − AC" presented as an estimate to
 *      complete (-$50.0K, or the whole $100.0K budget)
 *   owner decision D4: with a passed period and a future one, the Overview
 *      (health card and controls strip), the EV tab and the Forecast tab
 *      state the passed period's cutoff; the future period, chosen on the EV
 *      tab, states its own cutoff and that it has not been reached
 *   a schedule imported into a project with no active schedule: the review
 *      panel judges the staged revision on its own activities (0 blocking,
 *      Approve enabled once under review), and the Revisions tab calls it
 *      staged, not active
 *
 * Everything is built in a throwaway "LiveTest <uuid>" organisation through
 * the API; rows the product only writes over time are written by a backend
 * script that refuses any organisation not named "LiveTest <uuid>".
 */

test.use({ timezoneId: 'America/Chicago' })

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url))
const CUTOFF_NOTE = "This period's cutoff has not been reached; EV and AC are measured through today while PV runs to the cutoff."

/** Runs `body` (with prisma, projectId, args) against a LiveTest organisation's project only. */
const seed = (orgId: string, projectId: string, body: string, args: unknown = {}) => {
  const script = `
require('./src/utils/data-script-guard').exitUnlessDataScriptAllowed('e2e:pc4-merge-gate-r4');
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

const ensureOrg = async (client: APIRequestContext) => {
  if (!org) org = await registerLiveOrg(client, 'pc4r4')
  return org
}

const withoutRealtime = (on: Page) => on.routeWebSocket(/socket\.io/, () => {})

/** A priced BOQ row allocated in full, and approved, to a new activity. */
const billedActivity = async (
  client: APIRequestContext,
  projectId: string,
  { code, name, quantity = 100, rate = 1000 }: { code: string; name: string; quantity?: number; rate?: number },
) => {
  const token = org!.adminToken
  const item = await apiJson(client, 'post', `/projects/${projectId}/boq/items`, {
    token,
    data: { code, description: name, quantity, unit: 'm3', rate },
  })
  ok(item, 201, `item ${code}`)
  const activity = await apiJson(client, 'post', `/projects/${projectId}/activities`, {
    token,
    data: { name, activityCode: `A-${code}`, duration: 5, startDate: '2026-08-03', endDate: '2026-08-07', engineerIds: [org!.adminId] },
  })
  ok(activity, 201, `activity ${code}`)
  const activityId = activity.body!.data!.id as string
  const allocation = await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
    token,
    data: { boqItemId: (item.body!.data as { item: { id: string } }).item.id, activityId, quantity },
  })
  ok(allocation, 201, `allocate ${code}`)
  for (const step of ['submit', 'approve']) {
    ok(
      await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations/${allocation.body!.data!.id}/${step}`, { token, data: {} }),
      200,
      `${step} ${code}`,
    )
  }
  return activityId
}

const period = async (client: APIRequestContext, projectId: string, code: string, periodStart: string, cutoffDate: string) => {
  const created = await apiJson(client, 'post', `/projects/${projectId}/reports/periods`, {
    token: org!.adminToken,
    data: { code, periodStart, periodEnd: cutoffDate, cutoffDate },
  })
  ok(created, 201, `period ${code}`)
  return created.body!.data!.id as string
}

/**
 * A 100,000 bill. CPI 0 with actual cost above the budget: 150,000 spent,
 * nothing earned — the certified EAC is the budget, 100,000, and the
 * report's ETC (EAC − AC) is −50,000. No cost performance: the same bill,
 * nothing spent — the report's ETC is the whole 100,000.
 */
test("the EV tab's ETC is a dash with the reason when the EAC is the budget handed back, never budget minus spend", async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const cpiZero = await createProject(client, org!.adminToken, `ETC CPI zero r4 ${Date.now()}`)
      const activity = await billedActivity(client, cpiZero, { code: '1.1', name: 'Concrete frame' })
      seed(
        org!.orgId,
        cpiZero,
        `await prisma.costRecord.create({ data: { projectId, activityId: args.activity, budget: 100000, actual: 150000, actualThroughDate: new Date('2026-08-05T00:00:00Z') } });`,
        { activity },
      )
      const report = await apiJson(client, 'get', `/projects/${cpiZero}/reports/ev`, { token: org!.adminToken })
      ok(report, 200, 'EV report')
      const data = report.body!.data as { cpi: number; eac: number; etc: number; eacBasis: string }
      // The premise, from the server: the figures stand as certified.
      expect([data.cpi, data.eac, data.etc, data.eacBasis]).toEqual([0, 100000, -50000, 'budget_cpi_zero'])

      const noPerformance = await createProject(client, org!.adminToken, `ETC no CPI r4 ${Date.now()}`)
      await billedActivity(client, noPerformance, { code: '1.1', name: 'Frame' })
      return { cpiZero, noPerformance }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  await page.goto(`/o/${org!.segment}/projects/${setup.cpiZero}/schedule/ev`)
  const etc = page.getByTestId('uat-ev-etc')
  await expect(page.getByTestId('uat-ev-eac')).toContainText('$100.0K', { timeout: 45_000 })
  await expect(etc).toContainText('—')
  await expect(etc).toContainText('Not projected — the EAC is the budget, nothing earned against the cost spent (CPI 0)')
  await expect(etc).not.toContainText('-$50.0K')
  await expect(etc).not.toContainText('EAC - AC')

  await page.goto(`/o/${org!.segment}/projects/${setup.noPerformance}/schedule/ev`)
  const etc2 = page.getByTestId('uat-ev-etc')
  await expect(page.getByTestId('uat-ev-eac')).toContainText('$100.0K', { timeout: 45_000 })
  await expect(etc2).toContainText('—')
  await expect(etc2).toContainText('Not projected — the EAC is the budget, no cost performance yet')
  await expect(etc2).not.toContainText('$100.0K')
})

/**
 * America/Chicago. A 10,000 bill; 1,000 loaded on 10 August, 10 September
 * and next January; 10% approved on 20 August. August (cutoff 31 August,
 * passed) and next January (still ahead).
 */
test('D4: the Overview, the EV tab and the Forecast tab state the passed period’s cutoff; the future period, chosen, states its own and that it is not reached', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const nextYear = new Date().getUTCFullYear() + 1
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const projectId = await createProject(client, org!.adminToken, `Default period r4 ${Date.now()}`)
      const activity = await billedActivity(client, projectId, { code: '1.1', name: 'Frame', quantity: 10 })
      seed(
        org!.orgId,
        projectId,
        `
        await prisma.project.update({ where: { id: projectId }, data: { timezone: 'America/Chicago' } });
        const common = { projectId, activityId: args.activity, status: 'approved', approvedAt: new Date('2026-01-02T12:00:00Z') };
        for (const plannedDate of ['2026-08-10', '2026-09-10', args.nextYear + '-01-10']) {
          await prisma.activityCostLoading.create({ data: { ...common, plannedDate: new Date(plannedDate + 'T00:00:00Z'), plannedValue: 1000 } });
        }
        await prisma.activityProgress.create({ data: { activityId: args.activity, pctComplete: 10, status: 'approved', approvedAt: new Date('2026-08-20T15:00:00Z'), updatedAt: new Date('2026-08-20T15:00:00Z') } });
        `,
        { activity, nextYear },
      )
      await period(client, projectId, 'M08', '2026-08-01', '2026-08-31')
      await period(client, projectId, 'F01', `${nextYear}-01-01`, `${nextYear}-01-25`)
      return { projectId }
    } finally {
      await client.dispose()
    }
  })()

  // 31 August ends at 2026-09-01 04:59:59 UTC in Chicago (CDT); 25 January
  // next year at 05:59:59 UTC on the 26th (CST).
  const AUGUST = /end of .*Aug.*31.*2026 \(America\/Chicago\) · 2026-09-01 04:59:59 UTC/
  const JANUARY = `${nextYear}-01-26 05:59:59 UTC`

  await withoutRealtime(page)
  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`
  await page.goto(base)
  await expect(page.getByTestId('uat-health-cutoff')).toContainText(AUGUST, { timeout: 45_000 })
  await expect(page.getByTestId('uat-controls-ev-cutoff')).toContainText(AUGUST)
  await expect(page.getByTestId('uat-health-cutoff-not-reached')).toHaveCount(0)
  await expect(page.getByTestId('uat-controls-ev-cutoff-not-reached')).toHaveCount(0)
  await expect(page.getByTestId('uat-health-metric-schedule-spi')).toContainText('1.00')

  await page.goto(`${base}/schedule/forecast`)
  await expect(page.getByTestId('uat-forecast-ev-cutoff')).toContainText(AUGUST, { timeout: 45_000 })
  await expect(page.getByText(CUTOFF_NOTE)).toHaveCount(0)

  await page.goto(`${base}/schedule/ev`)
  await expect(page.getByTestId('uat-ev-cutoff')).toContainText(AUGUST, { timeout: 45_000 })
  await expect(page.getByTestId('uat-ev-period-select')).toContainText('M08')
  await expect(page.getByText(CUTOFF_NOTE)).toHaveCount(0)
  // Chosen explicitly, the future period: its own cutoff, and the note.
  await page.getByTestId('uat-ev-period-select').click()
  await page.getByRole('option', { name: 'F01' }).click()
  await expect(page.getByTestId('uat-ev-cutoff')).toContainText(JANUARY, { timeout: 30_000 })
  await expect(page.getByText(CUTOFF_NOTE)).toBeVisible()
})

/** Two tasks, one finish-to-start link: an XER imported as a staged revision. */
test('an imported schedule is judged on its own activities: 0 blocking, Approve enabled under review, and the Revisions tab calls it staged', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const projectId = await createProject(client, org!.adminToken, `Staged import r4 ${Date.now()}`)
      const xer = [
        'ERMHDR\t19.12',
        '%T\tPROJWBS',
        '%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num',
        '%R\tW1\t\tCIV\tCivil\t1',
        '%T\tTASK',
        '%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct',
        '%R\tT1\tA100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0',
        '%R\tT2\tA200\tFrame\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0',
        '%T\tTASKPRED',
        '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
        '%R\tP1\tT2\tT1\tPR_FS\t0',
        '%E',
        '',
      ].join('\n')
      const imported = await client.post(`${API}/projects/${projectId}/import/xer`, {
        headers: { authorization: `Bearer ${org!.adminToken}`, 'x-octapm-client': 'mobile' },
        multipart: { file: { name: 'staged.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(xer) } },
      })
      const body = await imported.json()
      expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
      expect(body.data).toMatchObject({ staged: true, imported: 2 })
      return { projectId, revisionId: body.data.revisionId as string }
    } finally {
      await client.dispose()
    }
  })()

  await withoutRealtime(page)
  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`
  await page.goto(`${base}/schedule/gantt`)
  const panel = page.getByTestId('uat-schedule-review')
  await expect(panel).toHaveAttribute('data-status', 'draft', { timeout: 45_000 })
  await expect(page.getByTestId('uat-schedule-review-blocking')).toHaveText('0 blocking')
  await expect(panel).not.toContainText('No schedule activities exist')
  await expect(panel).not.toContainText('No activities exist for CPM review')

  const client2 = await apiClient()
  try {
    ok(
      await apiJson(client2, 'post', `/projects/${setup.projectId}/schedule/revisions/${setup.revisionId}/submit-review`, { token: org!.adminToken, data: {} }),
      200,
      'submit for review',
    )
  } finally {
    await client2.dispose()
  }
  await page.reload()
  await expect(panel).toHaveAttribute('data-status', 'under_review', { timeout: 45_000 })
  await expect(page.getByTestId('uat-schedule-review-blocking')).toHaveText('0 blocking')
  await expect(panel.getByRole('button', { name: 'Approve' })).toBeEnabled()
  await expect(panel).not.toContainText('Next: clear readiness blockers')

  await page.goto(`${base}/schedule/revisions`)
  const row = page.locator('tr', { hasText: 'XER Import' }).first()
  await expect(row).toBeVisible({ timeout: 45_000 })
  await expect(row.getByTestId('uat-revision-staged-badge')).toHaveText('Staged')
  await expect(row.getByTestId('uat-revision-active-badge')).toHaveCount(0)
})
