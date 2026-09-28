import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test'
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
 * PC-4 merge gate, round 3 — on screen:
 *
 *   the Overview's forecast at completion, when it is the budget handed back
 *      (CPI 0 here), is tagged "budget fallback", never "projection"; its
 *      whole label is visible (the basis wraps, at 1440 and at 390), it names
 *      the revised budget it hands back, and its title carries the server's
 *      CPI sentence; the budget figure's ledger total says what it is
 *   the health card: a missing SPI is a dash with the server's reason and a
 *      neutral band, not "Fair"; CPI 0 carries its reason; the non-EV
 *      dimensions say "as of today"
 *   no approved budget: the Forecast tab's projected cost is a dash with the
 *      reason, CPI 0 is explained, and the EV tab's EAC and ETC are dashes
 *   progress with no actual cost: the health card's actual cost and the EV
 *      tab's cost variance are dashes with the reason, not USD 0 / +$50.0K
 *   a period whose cutoff is still ahead, chosen on the EV tab, says PV
 *      runs to the cutoff while EV and AC stop at today (since round 4 it is
 *      never the default basis — owner decision D4, spec 57)
 *   the EV tab's S-curve draws a locked period's EV against the PV at that
 *      same cutoff, not the month-end PV
 *   a site engineer without the BOQ: the Structure step's guides to pages
 *      not offered are plain text, never anchors that bounce elsewhere
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
const CPI_ZERO_LABEL = 'the budget — nothing earned against the cost spent (CPI 0)'
const CUTOFF_NOTE = "This period's cutoff has not been reached; EV and AC are measured through today while PV runs to the cutoff."

/** Runs `body` (with prisma, projectId, args) against a LiveTest organisation's project only. */
const seed = (orgId: string, projectId: string, body: string, args: unknown = {}) => {
  const script = `
require('./src/utils/data-script-guard').exitUnlessDataScriptAllowed('e2e:pc4-merge-gate-r3');
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
  if (!org) org = await registerLiveOrg(client, 'pc4r3')
  return org
}

const createActivity = async (client: APIRequestContext, projectId: string, data: Record<string, unknown>) => {
  const row = await apiJson(client, 'post', `/projects/${projectId}/activities`, {
    token: org!.adminToken,
    data: { duration: 5, startDate: '2026-02-02', endDate: '2026-02-06', engineerIds: [org!.adminId], ...data },
  })
  ok(row, 201, `activity ${data.activityCode}`)
  return row.body!.data!.id as string
}

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
  const activity = await createActivity(client, projectId, { name, activityCode: `A-${code}` })
  const allocation = await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
    token,
    data: { boqItemId: (item.body!.data as { item: { id: string } }).item.id, activityId: activity, quantity },
  })
  ok(allocation, 201, `allocate ${code}`)
  for (const step of ['submit', 'approve']) {
    ok(
      await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations/${allocation.body!.data!.id}/${step}`, { token, data: {} }),
      200,
      `${step} ${code}`,
    )
  }
  return activity
}

const period = async (client: APIRequestContext, projectId: string, code: string, cutoffDate: string) => {
  const created = await apiJson(client, 'post', `/projects/${projectId}/reports/periods`, {
    token: org!.adminToken,
    data: { code, periodStart: `${cutoffDate.slice(0, 7)}-01`, periodEnd: cutoffDate, cutoffDate },
  })
  ok(created, 201, `period ${code}`)
  return created.body!.data!.id as string
}

/** The site engineer, on the project, under a template that sets the BOQ tool to none. */
const addNoBoqSiteEngineer = async (client: APIRequestContext, projectId: string) => {
  const token = org!.adminToken
  const email = `live-se-${crypto.randomUUID()}@octapm-live.test`
  const created = await apiJson(client, 'post', '/users', {
    token,
    data: { name: 'pc4r3 Site Engineer', email, role: 'site_engineer', password: LIVE_PASSWORD },
  })
  ok(created, 201, 'add the site engineer')
  const id = created.body!.data!.id as string
  ok(await apiJson(client, 'post', `/projects/${projectId}/team`, { token, data: { userId: id, role: 'site_engineer' } }), 201, 'join')
  const template = await apiJson(client, 'post', '/permissions/templates', {
    token,
    data: { name: `No BOQ site engineer r3 ${Date.now()}`, baseRole: 'site_engineer', tools: [{ module: 'boq', level: 'none' }] },
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

/** Whether any part of the element's text is cut off (clipped or ellipsed). */
const clipped = (on: Page, testId: string) =>
  on.getByTestId(testId).evaluate((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)

/**
 * CPI 0 with a budget: two activities, 100,000 each, approved; 50,000 spent
 * on one (its cost record carries its 100,000 budget), nothing earned. The
 * certified EAC is the revised BAC, 200,000.
 */
test('CPI 0: the Overview tags the forecast at completion a budget fallback with its whole label visible, names the revised budget, and the health card explains the missing and zero indices', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const projectId = await createProject(client, org!.adminToken, `CPI zero r3 ${Date.now()}`)
      const first = await billedActivity(client, projectId, { code: '1.1', name: 'Concrete frame' })
      await billedActivity(client, projectId, { code: '1.2', name: 'Envelope' })
      seed(
        org!.orgId,
        projectId,
        `await prisma.costRecord.create({ data: { projectId, activityId: args.first, budget: 100000, actual: 50000, actualThroughDate: new Date('2026-02-05T00:00:00Z') } });`,
        { first },
      )
      const forecast = await apiJson(client, 'get', `/projects/${projectId}/forecast`, { token: org!.adminToken })
      ok(forecast, 200, 'forecast')
      const cost = (forecast.body!.data as { cost: { eac: number; bac: number; eacBasis: string } }).cost
      expect([cost.eac, cost.bac, cost.eacBasis]).toEqual([200000, 200000, 'budget_cpi_zero'])
      return { projectId }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(base)
    await expect(page.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 45_000 })
    const figure = page.getByTestId('uat-controls-figure-forecast')
    await expect(figure).toContainText('200,000', { timeout: 30_000 })
    // Not a projection: the budget handed back.
    await expect(page.getByTestId('uat-controls-figure-forecast-truth')).toHaveText('budget fallback')
    // The whole label, and the revised budget it hands back, visible — none
    // of it cut off.
    const basis = page.getByTestId('uat-controls-figure-forecast-basis')
    await expect(basis).toContainText(CPI_ZERO_LABEL)
    await expect(basis).toContainText(/revised budget (\w{3} )?200,000/)
    expect(await clipped(page, 'uat-controls-figure-forecast-basis'), `basis clipped at ${width}`).toBe(false)
    // Its title: which rule applied, and the server's reason.
    const title = (await figure.getAttribute('title')) ?? ''
    expect(title).toContain(CPI_ZERO_LABEL)
    expect(title).toContain('not a projection')
    expect(title).toContain('CPI is 0: actual cost has been recorded with no earned value')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  // The budget figure's ledger total says what it is.
  await expect(page.getByTestId('uat-controls-figure-budget-basis')).toContainText('in budgets of activities with cost records')
  await expect(page.getByTestId('uat-controls-figure-budget-basis')).not.toContainText('allocated to activities')

  // The health card: SPI missing is a dash with the reason and a neutral
  // band; CPI 0 carries its reason; the other dimensions are as of today.
  await expect(page.getByTestId('uat-health-metric-schedule-spi').locator('dd')).toHaveText('—')
  await expect(page.getByTestId('uat-health-band-schedule')).toHaveText('No index yet (neutral 60)')
  await expect(page.getByTestId('uat-health-notes-schedule')).toContainText('SPI is not available yet')
  await expect(page.getByTestId('uat-health-notes-cost')).toContainText('CPI is 0: actual cost has been recorded')
  await expect(page.getByTestId('uat-health-band-cost')).not.toHaveText('No index yet (neutral 60)')
  await expect(page.getByTestId('uat-health-provenance-commercial')).toContainText('as of today')
  await expect(page.getByTestId('uat-health-provenance-commercial')).not.toContainText('through')
  await expect(page.getByTestId('uat-health-provenance-cost')).toContainText('through')
})

/** No approved budget, 20,000 spent: nothing to earn against. */
test('no approved budget: the projected cost is a dash with the reason, CPI 0 is explained, and the EV tab shows no EAC or ETC', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const projectId = await createProject(client, org!.adminToken, `No budget r3 ${Date.now()}`)
      const activity = await createActivity(client, projectId, { name: 'Unbudgeted works', activityCode: 'A100' })
      seed(
        org!.orgId,
        projectId,
        `await prisma.costRecord.create({ data: { projectId, activityId: args.activity, actual: 20000, actualThroughDate: new Date('2026-02-05T00:00:00Z') } });`,
        { activity },
      )
      return { projectId }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`
  await page.goto(`${base}/schedule/forecast`)
  const projected = page.getByTestId('uat-forecast-cost')
  await expect(projected).toContainText('No approved budget to project from', { timeout: 45_000 })
  await expect(projected).toContainText('—')
  await expect(projected).not.toContainText('Within the')
  await expect(projected).not.toContainText('max(EAC, bottom-up)')
  await expect(page.getByTestId('uat-forecast-eac')).toContainText('no approved budget yet')
  await expect(page.getByTestId('uat-forecast-indices-note')).toContainText('CPI is 0 because there is no approved budget to earn against')

  await page.goto(`${base}/schedule/ev`)
  await expect(page.getByTestId('uat-ev-eac')).toContainText('—', { timeout: 45_000 })
  await expect(page.getByTestId('uat-ev-eac')).not.toContainText('$0')
  await expect(page.getByTestId('uat-ev-etc')).toContainText('—')
  await expect(page.getByTestId('uat-ev-etc')).not.toContainText('-$20.0K')
})

/** A 50,000 bill, complete, nothing spent on the ledger. */
test('progress with no actual cost: the health card and the EV tab show no actual cost and no cost variance, with the reason', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const projectId = await createProject(client, org!.adminToken, `No actuals r3 ${Date.now()}`)
      const activity = await billedActivity(client, projectId, { code: '1.1', name: 'Frame', quantity: 50 })
      seed(
        org!.orgId,
        projectId,
        `await prisma.activityProgress.create({ data: { activityId: args.activity, pctComplete: 100, status: 'approved', approvedAt: new Date('2026-02-06T15:00:00Z'), updatedAt: new Date('2026-02-06T15:00:00Z') } });`,
        { activity },
      )
      return { projectId }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`
  await page.goto(base)
  const ac = page.getByTestId('uat-health-metric-cost-ac')
  await expect(ac).toContainText('no official cost records through the cutoff', { timeout: 45_000 })
  await expect(ac.locator('dd')).not.toContainText('0')
  await expect(page.getByTestId('uat-health-metric-cost-ev')).toContainText('50,000')

  await page.goto(`${base}/schedule/ev`)
  const cv = page.getByTestId('uat-ev-cv')
  await expect(cv).toContainText('No actual cost recorded — CV not meaningful', { timeout: 45_000 })
  await expect(cv).not.toContainText('$50.0K')
})

/**
 * America/Chicago; the only period's cutoff is next January; 1,000 loaded
 * this January and 1,000 next; 10% of a 10,000 bill approved. Owner decision
 * D4: a period whose cutoff is still ahead is never the default basis, so the
 * Overview reads the ad hoc report cut at today (PV 1,000, EV 1,000, SPI
 * 1.00). Chosen on the EV tab, the future period gives SPI 0.5 exactly as
 * before — and says why it reads so.
 */
test('a period whose cutoff is still ahead is not the default; chosen on the EV tab it says PV runs to the cutoff while EV and AC stop at today', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const nextYear = new Date().getUTCFullYear() + 1
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const projectId = await createProject(client, org!.adminToken, `Future cutoff r3 ${Date.now()}`)
      const activity = await billedActivity(client, projectId, { code: '1.1', name: 'Frame', quantity: 10 })
      seed(
        org!.orgId,
        projectId,
        `
        await prisma.project.update({ where: { id: projectId }, data: { timezone: 'America/Chicago' } });
        const common = { projectId, activityId: args.activity, status: 'approved', approvedAt: new Date('2026-01-02T12:00:00Z') };
        for (const plannedDate of ['2026-01-10', args.nextYear + '-01-10']) {
          await prisma.activityCostLoading.create({ data: { ...common, plannedDate: new Date(plannedDate + 'T00:00:00Z'), plannedValue: 1000 } });
        }
        await prisma.activityProgress.create({ data: { activityId: args.activity, pctComplete: 10, status: 'approved', approvedAt: new Date('2026-02-20T15:00:00Z'), updatedAt: new Date('2026-02-20T15:00:00Z') } });
        `,
        { activity, nextYear },
      )
      await period(client, projectId, 'F01', `${nextYear}-01-25`)
      return { projectId }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`
  await page.goto(base)
  // The default: the ad hoc report cut at today, never next January.
  await expect(page.getByTestId('uat-health-metric-schedule-spi')).toContainText('1.00', { timeout: 45_000 })
  await expect(page.getByTestId('uat-health-cutoff')).not.toContainText(`${nextYear}-01-26`)
  await expect(page.getByTestId('uat-controls-ev-cutoff')).not.toContainText(`${nextYear}-01-26`)

  await page.goto(`${base}/schedule/ev`)
  await expect(page.getByTestId('uat-ev-spi')).toContainText('1.00', { timeout: 45_000 })
  await page.getByTestId('uat-ev-period-select').click()
  await page.getByRole('option', { name: 'F01' }).click()
  await expect(page.getByTestId('uat-ev-cutoff')).toContainText(`${nextYear}-01-26 05:59:59 UTC`, { timeout: 30_000 })
  await expect(page.getByTestId('uat-ev-spi')).toContainText('0.50')
  await expect(page.getByText(CUTOFF_NOTE)).toBeVisible()
})

/**
 * Loaded 1,000 on the 10th of January to June, plus 500 on 25 March and 700
 * on 28 May; 30% of a 10,000 bill approved on 12 March, 60% on 12 May.
 * March locked at its cutoff, the 15th (PV 3,000, EV 3,000); May open. The
 * March point is EV 3,000 against PV 3,000 — never the month-end 3,500.
 */
test("the EV tab's S-curve draws a locked period's EV against the PV at that same cutoff", async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const projectId = await createProject(client, org!.adminToken, `S-curve r3 ${Date.now()}`)
      const activity = await billedActivity(client, projectId, { code: '1.1', name: 'Frame', quantity: 10 })
      seed(
        org!.orgId,
        projectId,
        `
        await prisma.project.update({ where: { id: projectId }, data: { timezone: 'America/Chicago' } });
        const common = { projectId, activityId: args.activity, status: 'approved', approvedAt: new Date('2026-01-02T12:00:00Z') };
        for (const [plannedDate, plannedValue] of [['2026-01-10', 1000], ['2026-02-10', 1000], ['2026-03-10', 1000], ['2026-03-25', 500], ['2026-04-10', 1000], ['2026-05-10', 1000], ['2026-05-28', 700], ['2026-06-10', 1000]]) {
          await prisma.activityCostLoading.create({ data: { ...common, plannedDate: new Date(plannedDate + 'T00:00:00Z'), plannedValue } });
        }
        for (const [pctComplete, at] of [[30, '2026-03-12T15:00:00Z'], [60, '2026-05-12T15:00:00Z']]) {
          await prisma.activityProgress.create({ data: { activityId: args.activity, pctComplete, status: 'approved', approvedAt: new Date(at), updatedAt: new Date(at) } });
        }
        `,
        { activity },
      )
      const march = await period(client, projectId, 'M03', '2026-03-15')
      await period(client, projectId, 'M05', '2026-05-15')
      const locked = await apiJson(client, 'post', `/projects/${projectId}/reports/periods/${march}/lock`, {
        token: org!.adminToken,
        data: { overrideReason: 'LiveTest PC-4 r3: lock March over the setup gate' },
      })
      ok(locked, 200, 'lock March')
      expect([locked.body!.data!.pv, locked.body!.data!.ev]).toEqual([3000, 3000])
      return { projectId }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  await page.goto(`/o/${org!.segment}/projects/${setup.projectId}/schedule/ev`)
  const curve = page.getByTestId('uat-ev-scurve')
  await expect(curve).toBeVisible({ timeout: 45_000 })
  await expect(curve).toHaveAttribute('data-ev-points', JSON.stringify([['Mar 26', 3000], ['May 26', 6000]]))
  // Each EV point against the PV at its own cutoff: March's stored 3,000
  // (not the month-end 3,500), May's report 5,500.
  await expect(curve).toHaveAttribute('data-pv-at-ev-points', JSON.stringify([['Mar 26', 3000], ['May 26', 5500]]))
  await expect(page.getByTestId('uat-ev-scurve-pv-note')).toContainText('PV is the planned value at that same cutoff')
})

/**
 * A site engineer whose template sets the BOQ to none is not offered the
 * BOQ, Project Controls or Cost: the Structure step's guides to them are
 * plain text that says so, never anchors that land on another page.
 */
test('the Structure step offers a guide link only where the member may go', async ({ page, browser }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const projectId = await createProject(client, org!.adminToken, `Guides r3 ${Date.now()}`)
      await billedActivity(client, projectId, { code: '1.1', name: 'Frame' })
      const siteEngineer = await addNoBoqSiteEngineer(client, projectId)
      return { projectId, siteEngineer }
    } finally {
      await client.dispose()
    }
  })()
  const base = `/o/${org!.segment}/projects/${setup.projectId}`

  const se = await pageAs(browser, setup.siteEngineer)
  try {
    await se.page.goto(base)
    const step = se.page.getByTestId('uat-setup-step-structure_setup')
    await expect(step).toBeVisible({ timeout: 45_000 })
    for (const key of ['boq_structure', 'mapping_readiness']) {
      const guide = step.getByTestId(`uat-setup-guide-${key}`)
      await expect(guide, key).toHaveAttribute('data-inert', 'true')
      await expect(guide, key).toHaveAttribute('title', 'This page is not offered to you')
      expect(await guide.evaluate((el) => el.tagName), key).toBe('SPAN')
    }
  } finally {
    await se.context.close()
  }

  // The PM is offered those pages: the same guides are links.
  await signInForm(page, org!.adminEmail)
  await page.goto(base)
  const step = page.getByTestId('uat-setup-step-structure_setup')
  await expect(step).toBeVisible({ timeout: 45_000 })
  for (const key of ['boq_structure', 'mapping_readiness']) {
    const guide = step.getByTestId(`uat-setup-guide-${key}`)
    expect(await guide.evaluate((el) => el.tagName), key).toBe('A')
    await expect(guide, key).not.toHaveAttribute('data-inert', 'true')
  }
})
