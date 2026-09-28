import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Browser } from '@playwright/test'
import { apiClient } from './support'
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
 * PC-4 acceptance — what the Overview, the Earned Value tab, the Forecast
 * tab, the WBS tab and the Revisions tab say, on screen, with the owner's
 * decisions of 2026-09-27:
 *
 *   §4 earned value: the S-curve plots EV only where it was measured (this
 *     report's cutoff and each locked period's), never a flat line written
 *     back into months nobody measured
 *   D1 the EV cutoff is the end of the cutoff date in the project's time
 *     zone; the EV tab, the Overview's health card and strip and the
 *     Forecast tab state it one way — the date, the zone and the instant
 *   D2 the Overview's "Forecast at completion" is the business-rule EAC
 *     (revised BAC / CPI, or the revised BAC labelled "the budget — no cost
 *     performance yet"), toned against that BAC, opening the Forecast tab,
 *     which shows the same figure with the same label; a member who may not
 *     see budget figures gets "—" and says why
 *   C  a member without BOQ read is told the mapping details are
 *     unavailable — no share, no counts
 *   D3 the WBS tab builds from the project's own WBS rows when they exist,
 *     for a BOQ reader and for a site engineer without BOQ read alike; the
 *     snapshot outline (joined on its own parent ids) only when none exist
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
 * A site engineer on the project whose permission template sets the BOQ tool
 * to none (the site engineer has no cost tool either): a member who may read
 * neither the bill nor the budget built from it.
 */
const addNoBoqSiteEngineer = async (client: APIRequestContext, projectId: string) => {
  const token = org!.adminToken
  const email = `live-se-${crypto.randomUUID()}@octapm-live.test`
  const created = await apiJson(client, 'post', '/users', {
    token,
    data: { name: 'pc4acc Site Engineer', email, role: 'site_engineer', password: LIVE_PASSWORD },
  })
  ok(created, 201, 'add the site engineer')
  const id = created.body!.data!.id as string
  ok(await apiJson(client, 'post', `/projects/${projectId}/team`, { token, data: { userId: id, role: 'site_engineer' } }), 201, 'join the project')
  const template = await apiJson(client, 'post', '/permissions/templates', {
    token,
    data: { name: `No BOQ site engineer ${Date.now()}`, baseRole: 'site_engineer', tools: [{ module: 'boq', level: 'none' }] },
  })
  ok(template, 201, 'template')
  ok(
    await apiJson(client, 'put', `/projects/${projectId}/team/${id}/permissions`, { token, data: { templateId: template.body!.data!.id } }),
    200,
    'apply the template',
  )
  return email
}

const pageAs = async (browser: Browser, email: string) => {
  const context = await browser.newContext({ timezoneId: 'America/Chicago' })
  const page = await context.newPage()
  await signInForm(page, email)
  return { context, page }
}

/** The digits of a money figure as shown ("USD 125,000" and "125,000" read alike). */
const digits = (text: string) => text.replace(/[^\d.-]/g, '')

/**
 * §4 on screen. A 100,000 bill allocated to one activity of a project in
 * America/Chicago; approved cost loading in June, July and August; 40%
 * approved on 10 July and 90% on 20 August; July's period locked (its
 * snapshot stores EV 40,000), August's open (EV 90,000). The service writes
 * today's EV into every month up to the cutoff; the tab must plot July's
 * locked 40,000 and August's 90,000 only — July's cutoff instant is already
 * 1 August in UTC, so the point is placed by its date in the project's zone.
 *
 * D1: August's cutoff is the end of 31 August in Chicago, 2026-09-01
 * 04:59:59.999Z — stated the same way on the EV tab, the health card, the
 * strip and the Forecast tab (never "Sep 1" in UTC). D2 without CPI: the
 * strip's forecast at completion is the revised BAC, 100,000, labelled the
 * budget with no cost performance yet, and opens the Forecast tab, which
 * shows the same figure with the same label.
 */
test('earned value is plotted only where it was measured, every EV surface states one cutoff in the project zone, and the forecast at completion without CPI is the budget on the strip and the Forecast tab', async ({ page }) => {
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
        await prisma.project.update({ where: { id: projectId }, data: { timezone: 'America/Chicago' } });
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
      const data = report.body!.data as {
        ev: number
        cpi: number | null
        eac: number
        totalBudget: number
        reporting: { cutoffDate: string; cutoffLocalDate: string; timeZone: string }
        sCurve: { label: string; ev: number | null }[]
      }
      // D1: the end of 31 August in Chicago (CDT), which is 1 September in UTC.
      expect(data.reporting).toMatchObject({
        cutoffDate: '2026-09-01T04:59:59.999Z',
        cutoffLocalDate: '2026-08-31',
        timeZone: 'America/Chicago',
      })
      // D2 without CPI: the EAC is the revised BAC.
      expect([data.eac, data.totalBudget]).toEqual([100000, 100000])
      // The service gives this report's EV only in the month of its cutoff
      // (round 3) — never backfilled into the months before it; the tab adds
      // July's locked 40,000 from the period's snapshot.
      expect(data.ev).toBe(90000)
      expect(data.sCurve.filter((row) => row.ev !== null).map((row) => [row.label, row.ev])).toEqual([['Aug 26', 90000]])
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
  // D1: one statement of the cutoff — the date in the project's zone, the
  // zone, and the instant PV, EV and AC were selected against.
  const evCutoff = (await page.getByTestId('uat-ev-cutoff').innerText()).trim()
  expect(evCutoff).toBe('end of Aug 31, 2026 (America/Chicago) · 2026-09-01 04:59:59 UTC')
  // The project has its own zone: no fallback note anywhere.
  await expect(page.getByTestId('uat-ev-cutoff-zone-note')).toHaveCount(0)
  await expect(page.getByText(/Project timezone is not configured/)).toHaveCount(0)
  // With no CPI the EAC is the budget, and says so (the Phase 22A wording).
  await expect(page.getByText('The budget — no cost performance yet')).toBeVisible()
  await expect(page.getByText('Revised budget / CPI')).toHaveCount(0)

  // The Overview: the same cutoff on the health card and in the strip's
  // basis line; the budget and actual are the register's and the ledger's.
  await page.goto(base)
  await expect(page.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('uat-health-cutoff')).toHaveText(`EV cutoff ${evCutoff}`, { timeout: 30_000 })
  await expect(page.getByTestId('uat-controls-ev-cutoff')).toHaveText(evCutoff, { timeout: 30_000 })
  await expect(page.getByTestId('uat-health-cutoff-zone-note')).toHaveCount(0)
  await expect(page.getByTestId('uat-controls-ev-cutoff-zone-note')).toHaveCount(0)
  await expect(page.getByTestId('uat-health-provenance-cost')).toContainText('through Aug 31, 2026')
  await expect(page.getByTestId('uat-controls-figures-basis')).toContainText('budget register and cost ledger as of')
  // No cost records, no budget register: dashes with the reason — never USD 0.
  await expect(page.getByTestId('uat-controls-figure-budget-value')).toHaveText('—')
  await expect(page.getByTestId('uat-controls-figure-budget')).toContainText('no budget register yet')
  await expect(page.getByTestId('uat-controls-figure-actual-value')).toHaveText('—')
  await expect(page.getByTestId('uat-controls-figure-actual')).toContainText('no cost records yet')
  await expect(page.getByTestId('uat-controls-figures')).not.toContainText(/USD 0\b|\$0\b/)
  // D2 without CPI: the forecast at completion is the revised BAC, labelled.
  const forecastFigure = page.getByTestId('uat-controls-figure-forecast')
  const stripValue = (await page.getByTestId('uat-controls-figure-forecast-value').innerText()).trim()
  expect(digits(stripValue)).toBe('100000')
  await expect(forecastFigure).toContainText('the budget — no cost performance yet')
  await expect(forecastFigure).toHaveAttribute('data-tone', 'neutral')

  // It opens the Forecast tab, which shows the same figure with the same
  // label, the CPI note beside it, and how the projected cost relates.
  await forecastFigure.click()
  await expect(page).toHaveURL(/\/schedule\/forecast$/, { timeout: 30_000 })
  const eac = page.getByTestId('uat-forecast-eac')
  await expect(eac).toBeVisible({ timeout: 30_000 })
  await expect(eac).toContainText('the budget — no cost performance yet')
  expect(digits(await eac.locator('p').nth(1).innerText())).toBe(digits(stripValue))
  await expect(page.getByTestId('uat-forecast-eac-note')).toContainText('CPI is not available yet: no official cost-record actuals')
  await expect(page.getByTestId('uat-forecast-cost-note')).toContainText('Projected cost = max(EAC, bottom-up)')
  await expect(page.getByTestId('uat-forecast-ev-cutoff')).toHaveText(evCutoff)
})

/**
 * D2 with cost performance: a 100,000 bill on one activity, half the work
 * approved, 62,500 spent through the cutoff — CPI 0.8, so the EAC is
 * 100,000 / 0.8 = 125,000. A budget register of 1,000,000 stands beside it:
 * the tile is toned against the revised BAC it was computed from (over),
 * never against the register (well under). It opens the Forecast tab, which
 * shows the same figure with the same label. A site engineer who may read
 * neither the BOQ nor the budget gets "—" and the reason, and (C) is told the
 * mapping details are unavailable — no share, no counts.
 */
test('the forecast at completion is the budget over CPI, toned against that budget, the same on the Forecast tab; a member without budget read gets a dash and the mapping details are unavailable to them', async ({ page, browser }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      if (!org) org = await registerLiveOrg(client, 'pc4acc')
      const token = org.adminToken
      const projectId = await createProject(client, token, `Forecast basis ${Date.now()}`)
      const item = await createItem(client, token, projectId, { code: '1.1', description: 'Concrete frame', quantity: 100, unit: 'm3', rate: 1000 })
      const activity = await createActivity(client, projectId, { name: 'Concrete frame', activityCode: 'A100', startDate: '2026-02-02', endDate: '2026-02-06' })
      await allocate(client, projectId, item, activity, 100)
      seed(
        org.orgId,
        projectId,
        `
        await prisma.activityProgress.create({ data: { activityId: args.activity, pctComplete: 50, status: 'approved', approvedAt: new Date('2026-02-04T12:00:00Z'), updatedAt: new Date('2026-02-04T12:00:00Z') } });
        await prisma.costRecord.upsert({
          where: { projectId_activityId: { projectId, activityId: args.activity } },
          create: { projectId, activityId: args.activity, actual: 62500, actualThroughDate: new Date('2026-02-05T12:00:00Z') },
          update: { actual: 62500, actualThroughDate: new Date('2026-02-05T12:00:00Z') },
        });
        `,
        { activity },
      )
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
      const [ev, forecast] = await Promise.all([
        apiJson(client, 'get', `/projects/${projectId}/reports/ev`, { token }),
        apiJson(client, 'get', `/projects/${projectId}/forecast`, { token }),
      ])
      const report = ev.body!.data as { ev: number; ac: number; totalBudget: number; eac: number }
      const cost = (forecast.body!.data as { cost: { eac: number; bac: number; eacBasis: string } }).cost
      // The premise: CPI 0.8 on a 100,000 BAC, the forecast carrying the EV report's EAC.
      expect([report.totalBudget, report.ev, report.ac]).toEqual([100000, 50000, 62500])
      expect(report.eac).toBeCloseTo(report.totalBudget / (report.ev / report.ac), 2)
      expect(cost).toMatchObject({ eac: report.eac, bac: 100000, eacBasis: 'budget_over_cpi' })
      const siteEngineer = await addNoBoqSiteEngineer(client, projectId)
      return { projectId, eac: report.eac, siteEngineer }
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
  const forecastValue = page.getByTestId('uat-controls-figure-forecast-value')
  await expect(forecastValue).toContainText('125,000', { timeout: 30_000 })
  expect(Number(digits(await forecastValue.innerText()))).toBe(Math.round(setup.eac))
  await expect(forecast).toContainText('revised budget ÷ CPI')
  // Over the 100,000 it was computed from — under the 1,000,000 register.
  await expect(forecast).toHaveAttribute('data-tone', 'review')
  // One activity, entered without a revision: a schedule, and what to do next.
  await expect(page.getByTestId('uat-controls-schedule')).toHaveText('1 activity')
  await expect(page.getByTestId('uat-controls-schedule-tile')).toContainText('No revision')
  // A BOQ reader sees the mapping share, and the bill's row count.
  await expect(page.getByTestId('uat-controls-coverage-pct')).toHaveText('100%')
  await expect(page.getByTestId('uat-controls-boq-revision')).toHaveText('1 rows')
  // D1 (the owner's correction): this project and its workspace have no
  // time zone, so the cutoff is read in UTC — and every EV surface says so,
  // beside the cutoff, in the server's words.
  const UTC_NOTE = 'Project timezone is not configured; UTC is being used'
  await expect(page.getByTestId('uat-health-cutoff')).toContainText('(UTC)', { timeout: 30_000 })
  await expect(page.getByTestId('uat-health-cutoff-zone-note')).toHaveText(UTC_NOTE)
  await expect(page.getByTestId('uat-controls-ev-cutoff-zone-note')).toHaveText(`${UTC_NOTE}.`)
  await forecast.click()
  await expect(page).toHaveURL(new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/schedule/forecast$`), { timeout: 30_000 })
  const eac = page.getByTestId('uat-forecast-eac')
  await expect(eac).toContainText('revised budget ÷ CPI', { timeout: 30_000 })
  await expect(eac).toContainText('125,000')
  await expect(page.getByTestId('uat-forecast-ev-cutoff')).toContainText('(UTC)')
  await expect(page.getByTestId('uat-forecast-ev-cutoff-zone-note')).toHaveText(UTC_NOTE)
  await page.goto(`${base}/schedule/ev`)
  await expect(page.getByTestId('uat-ev-cutoff')).toContainText('(UTC)', { timeout: 30_000 })
  await expect(page.getByTestId('uat-ev-cutoff-zone-note')).toHaveText(UTC_NOTE)

  // The site engineer: no budget figure, the reason instead; no mapping details.
  const { context, page: sePage } = await pageAs(browser, setup.siteEngineer)
  try {
    await sePage.goto(base)
    await expect(sePage.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 30_000 })
    await expect(sePage.getByTestId('uat-controls-figure-forecast-value')).toHaveText('—', { timeout: 30_000 })
    await expect(sePage.getByTestId('uat-controls-figure-forecast')).toContainText('Cost figures are not available to you')
    await expect(sePage.getByTestId('uat-controls-coverage-pct')).toHaveText('—')
    await expect(sePage.getByTestId('uat-controls-coverage-withheld')).toHaveText('Mapping details unavailable to you')
    await expect(sePage.getByTestId('uat-controls-figure-unmapped-value')).toHaveText('—')
    await expect(sePage.getByTestId('uat-controls-figure-unmapped')).toContainText('Mapping details unavailable to you')
    await expect(sePage.getByTestId('uat-controls-figures')).not.toContainText('125,000')
    // No count of the bill's rows either (the owner's rule on BOQ-derived
    // counts): the tile says the bill exists, not how many rows it has.
    await expect(sePage.getByTestId('uat-controls-boq-revision')).toHaveText('Entered by hand')
    await expect(sePage.getByTestId('uat-controls-boq')).not.toContainText(/\d+ rows/)
    await sePage.goto(`${base}/schedule/forecast`)
    const seEac = sePage.getByTestId('uat-forecast-eac')
    await expect(seEac).toBeVisible({ timeout: 30_000 })
    await expect(seEac).toContainText('—')
    await expect(seEac).toContainText('Cost figures are not available to you')
    await expect(sePage.getByTestId('uat-forecast')).not.toContainText('125,000')
  } finally {
    await context.close()
  }
})

/**
 * An imported programme's WBS (XER-shaped: wbsId / parentWbsId, the short
 * code "FDN" under both CIV and MEP), a hand-entered bill, and two revisions:
 * the active one approved, rolled forward from one that stored no
 * activities. With no WbsNode rows the WBS tab follows the snapshot's own
 * parents. D3: once the project has its own WBS rows — a three-level tree
 * whose second FDN is qualified "MEP.FDN", as an activation makes it — the
 * tab builds from them alone, for the PM and for a site engineer without BOQ
 * read alike, with no Budget column. The bill's approval card sends to the
 * page that locks the baseline; Rollback is offered only once there is
 * something to restore.
 */
test('the WBS tab builds from the project WBS for every schedule reader and from the snapshot parents only without one, the hand-entered bill card opens the baseline lock, and Rollback needs something to restore', async ({ page, browser }) => {
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
  const openWbs = async (on = page) => {
    await on.goto(`${base}/schedule/gantt`)
    await expect(on.getByTestId('uat-project-content-schedule')).toBeVisible({ timeout: 30_000 })
    await on.getByTestId('uat-module-tab-schedule').click()
    await on.getByTestId('uat-module-menu-schedule').getByTestId('uat-module-child-schedule-wbs').click()
    await expect(on).toHaveURL(/\/schedule\/wbs$/, { timeout: 30_000 })
    await expect(on.getByTestId('uat-schedule-wbs')).toBeVisible({ timeout: 30_000 })
    await on.getByRole('button', { name: 'Expand All' }).click()
  }
  await openWbs()
  await expect(page.getByTestId('uat-schedule-wbs')).toHaveAttribute('data-source', 'snapshot')
  const outline = async (on = page) =>
    on.locator('[data-testid^="uat-schedule-wbs-row-"]').evaluateAll((rows) =>
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

  // D3: the project's own WBS rows — three levels, the second FDN qualified
  // as an activation qualifies it — and a site engineer without BOQ read.
  const client2 = await apiClient()
  const node = async (code: string, name: string, parentId: string | null = null) => {
    const created = await apiJson(client2, 'post', `/projects/${setup.projectId}/structure/wbs`, {
      token: org!.adminToken,
      data: { code, name, parentId },
    })
    ok(created, 201, `wbs node ${code}`)
    return created.body!.data!.id as string
  }
  const civ = await node('CIV', 'Civil works')
  await node('PILE', 'Piles', await node('FDN', 'Civil foundations', civ))
  const mep = await node('MEP', 'MEP works')
  await node('PLI', 'Plinths', await node('MEP.FDN', 'MEP foundations', mep))
  const siteEngineer = await addNoBoqSiteEngineer(client2, setup.projectId)
  await client2.dispose()
  const canonical = [
    ['CIV', 0, 'Civil works'],
    ['FDN', 1, 'Civil foundations'],
    ['PILE', 2, 'Piles'],
    ['MEP', 0, 'MEP works'],
    ['MEP.FDN', 1, 'MEP foundations'],
    ['PLI', 2, 'Plinths'],
  ]
  await openWbs()
  await expect(page.getByTestId('uat-schedule-wbs')).toHaveAttribute('data-source', 'wbs-nodes')
  await expect(page.locator('[data-testid^="uat-schedule-wbs-row-"]')).toHaveCount(6, { timeout: 30_000 })
  // The canonical tree alone: the snapshot's Superstructure is not drawn.
  expect(await outline()).toEqual(canonical)
  await expect(page.getByTestId('uat-schedule-wbs-row-SUP')).toHaveCount(0)
  // No Budget column, and the counts are direct.
  const headers = await page.locator('thead th').allInnerTexts()
  expect(headers.map((text) => text.trim())).toEqual(['WBS Code', 'Name', 'Duration', 'Activities (direct)', 'Responsible'])
  // The site engineer reads the same canonical outline.
  const se = await pageAs(browser, siteEngineer)
  try {
    const answer = se.page.waitForResponse((r) => /\/structure\/wbs(\?|$)/.test(r.url()), { timeout: 60_000 })
    await openWbs(se.page)
    expect((await answer).status(), 'the site engineer reads the WBS outline').toBe(200)
    await expect(se.page.getByTestId('uat-schedule-wbs')).toHaveAttribute('data-source', 'wbs-nodes')
    await expect(se.page.locator('[data-testid^="uat-schedule-wbs-row-"]')).toHaveCount(6, { timeout: 30_000 })
    expect(await outline(se.page)).toEqual(canonical)
  } finally {
    await se.context.close()
  }

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
