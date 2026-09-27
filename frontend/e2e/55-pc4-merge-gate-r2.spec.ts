import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test'
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
 * PC-4 merge gate, round 2 — on screen:
 *
 *   D3 the Schedule's WBS tab is offered and built from the project's own
 *      WbsNode rows for a schedule planned in OctaPM (whose revision snapshot
 *      carries no WBS), for the PM and for a schedule reader without BOQ
 *      read, in the canonical sibling order (sortOrder, then code); a deep
 *      link to it is honoured; a tree whose nodes are all archived says so
 *   D2 actual cost with nothing earned (CPI 0): the Overview's forecast at
 *      completion, the Forecast tab's EAC card and the EV tab's EAC card give
 *      the budget one label — never "revised budget ÷ CPI", never "no cost
 *      performance yet" — and the projected cost is not "within the budget"
 *   a stale Approve on the Revisions panel names the failing readiness check
 *      and where to fix it, once, and the panel re-reads its blockers
 *   a stale Approve on the BOQ page says, in BOQ words, that the revision is
 *      already approved and locked, and the row re-reads its status
 *   the workspace home states the official cutoff in its zone with the
 *      server's note when the project has none
 *
 * Everything is built in a throwaway "LiveTest <uuid>" organisation through
 * the API; the rows the product only writes over time are written by a
 * backend script that refuses any organisation not named "LiveTest <uuid>".
 */

test.use({ timezoneId: 'America/Chicago' })

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url))
const CONSTRUCTION_BOQ = fileURLToPath(new URL('../../docs/Construction_BOQ.xlsx', import.meta.url))
const UTC_NOTE = 'Project timezone is not configured; UTC is being used'
const CPI_ZERO_LABEL = 'the budget — nothing earned against the cost spent (CPI 0)'

/** Runs `body` (with prisma, projectId, args) against a LiveTest organisation's project only. */
const seed = (orgId: string, projectId: string, body: string, args: unknown = {}) => {
  const script = `
require('./src/utils/data-script-guard').exitUnlessDataScriptAllowed('e2e:pc4-merge-gate-r2');
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
  if (!org) org = await registerLiveOrg(client, 'pc4r2')
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

/** A site engineer on the project whose template sets the BOQ tool to none. */
const addNoBoqSiteEngineer = async (client: APIRequestContext, projectId: string) => {
  const token = org!.adminToken
  const email = `live-se-${crypto.randomUUID()}@octapm-live.test`
  const created = await apiJson(client, 'post', '/users', {
    token,
    data: { name: 'pc4r2 Site Engineer', email, role: 'site_engineer', password: LIVE_PASSWORD },
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

/** The WBS tab's rows as [code, depth, name]. */
const outline = (on: Page) =>
  on.locator('[data-testid^="uat-schedule-wbs-row-"]').evaluateAll((rows) =>
    rows.map((row) => [
      row.getAttribute('data-testid')!.replace('uat-schedule-wbs-row-', ''),
      Number(row.getAttribute('data-depth')),
      row.querySelectorAll('td')[1]?.textContent?.trim(),
    ]),
  )

/** Toasts whose text contains `text`. */
const toasts = (on: Page, text: string) => on.locator('[data-sonner-toast]', { hasText: text })

/**
 * Cuts the page's realtime socket, so a change made behind the page reaches
 * it only through what the page itself re-reads — here, the refusal.
 */
const withoutRealtime = (on: Page) => on.routeWebSocket(/socket\.io/, () => {})

/**
 * D3 for a schedule planned in OctaPM: activities entered by hand, no
 * imported revision, so the schedule's snapshot carries no WBS. The project
 * has its own WBS rows, whose sibling order (sortOrder) is not their code
 * order: Z-FIRST before A-SECOND, and under A-SECOND, A-B before A-A.
 */
test('the WBS tab is offered for an in-product schedule with WBS rows, in canonical order, for the PM and a no-BOQ schedule reader, honours a deep link, and says when every node is archived', async ({ page, browser }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const token = org!.adminToken
      const projectId = await createProject(client, token, `WBS in-product ${Date.now()}`)
      await createActivity(client, projectId, { name: 'Excavate', activityCode: 'A100' })
      const node = async (code: string, name: string, sortOrder: number, parentId: string | null = null) => {
        const created = await apiJson(client, 'post', `/projects/${projectId}/structure/wbs`, {
          token,
          data: { code, name, parentId, sortOrder },
        })
        ok(created, 201, `wbs node ${code}`)
        return created.body!.data!.id as string
      }
      const first = await node('Z-FIRST', 'First by sort order', 0)
      const second = await node('A-SECOND', 'Second by sort order', 1)
      await node('A-B', 'First child by sort order', 0, second)
      await node('A-A', 'Second child by sort order', 5, second)
      const schedule = await apiJson(client, 'get', `/projects/${projectId}/schedule`, { token })
      ok(schedule, 200, 'schedule')
      const revision = (schedule.body!.data as { revision: { source: string; wbs: unknown[] } }).revision
      // The premise: the in-product schedule's snapshot carries no WBS.
      expect(revision.wbs).toEqual([])
      const siteEngineer = await addNoBoqSiteEngineer(client, projectId)
      return { projectId, roots: [first, second], siteEngineer }
    } finally {
      await client.dispose()
    }
  })()

  const expected = [
    ['Z-FIRST', 0, 'First by sort order'],
    ['A-SECOND', 0, 'Second by sort order'],
    ['A-B', 1, 'First child by sort order'],
    ['A-A', 1, 'Second child by sort order'],
  ]
  const base = `/o/${org!.segment}/projects/${setup.projectId}`
  const openWbs = async (on: Page) => {
    await on.goto(`${base}/schedule/gantt`)
    await expect(on.getByTestId('uat-project-content-schedule')).toBeVisible({ timeout: 30_000 })
    await on.getByTestId('uat-module-tab-schedule').click()
    await on.getByTestId('uat-module-menu-schedule').getByTestId('uat-module-child-schedule-wbs').click()
    await expect(on).toHaveURL(/\/schedule\/wbs$/, { timeout: 30_000 })
    await expect(on.getByTestId('uat-schedule-wbs')).toBeVisible({ timeout: 30_000 })
    await on.getByRole('button', { name: 'Expand All' }).click()
  }

  await signInForm(page, org!.adminEmail)
  await openWbs(page)
  await expect(page.getByTestId('uat-schedule-wbs')).toHaveAttribute('data-source', 'wbs-nodes')
  await expect(page.locator('[data-testid^="uat-schedule-wbs-row-"]')).toHaveCount(4, { timeout: 30_000 })
  expect(await outline(page)).toEqual(expected)

  // A deep link lands on the tab, not on the Gantt.
  await page.goto(`${base}/schedule/wbs`)
  await expect(page.getByTestId('uat-schedule-wbs')).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/schedule\/wbs$/)

  // The site engineer without BOQ read: the same outline.
  const se = await pageAs(browser, setup.siteEngineer)
  try {
    await openWbs(se.page)
    await expect(se.page.getByTestId('uat-schedule-wbs')).toHaveAttribute('data-source', 'wbs-nodes')
    await expect(se.page.locator('[data-testid^="uat-schedule-wbs-row-"]')).toHaveCount(4, { timeout: 30_000 })
    expect(await outline(se.page)).toEqual(expected)

    // The Overview strip: a tile whose page is not offered to this member
    // (the BOQ, the cost module, Project Controls' mapping) is drawn without
    // its link; the schedule's pages are offered, so theirs stay links.
    await se.page.goto(base)
    await expect(se.page.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 30_000 })
    for (const id of ['uat-controls-boq', 'uat-controls-coverage', 'uat-controls-figure-budget', 'uat-controls-figure-actual', 'uat-controls-figure-unmapped']) {
      await expect(se.page.getByTestId(id), id).toHaveAttribute('data-inert', 'true')
    }
    await expect(se.page.getByTestId('uat-controls-figure-critical')).not.toHaveAttribute('data-inert', 'true')
    await se.page.getByTestId('uat-controls-figure-critical').click()
    await expect(se.page).toHaveURL(/\/schedule\/critical$/, { timeout: 30_000 })
  } finally {
    await se.context.close()
  }

  // The PM is offered those pages: the same tiles are links.
  await page.goto(base)
  await expect(page.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 30_000 })
  for (const id of ['uat-controls-boq', 'uat-controls-coverage', 'uat-controls-figure-budget']) {
    await expect(page.getByTestId(id), id).not.toHaveAttribute('data-inert', 'true')
  }

  // Every node archived: still the project's tree — it says so.
  const client2 = await apiClient()
  try {
    for (const id of setup.roots) {
      ok(
        await apiJson(client2, 'post', `/projects/${setup.projectId}/structure/wbs/${id}/archive`, { token: org!.adminToken, data: {} }),
        200,
        'archive',
      )
    }
  } finally {
    await client2.dispose()
  }
  await openWbs(page)
  await expect(page.getByTestId('uat-schedule-wbs')).toHaveAttribute('data-source', 'wbs-nodes')
  await expect(page.getByTestId('uat-schedule-wbs-all-archived')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-testid^="uat-schedule-wbs-row-"]')).toHaveCount(0)
})

/**
 * D2 at CPI 0: a 100,000 bill on one activity, 62,500 spent, nothing
 * approved as done. The certified EAC is the revised BAC, 100,000 — the
 * budget handed back because BAC / 0 cannot be computed — and every screen
 * names it the same way.
 */
test('actual cost with nothing earned (CPI 0): the Overview, the Forecast tab and the EV tab label the budget fallback the same way, and the projected cost is not "within the budget"', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const token = org!.adminToken
      const projectId = await createProject(client, token, `CPI zero ${Date.now()}`)
      const item = await apiJson(client, 'post', `/projects/${projectId}/boq/items`, {
        token,
        data: { code: '1.1', description: 'Concrete frame', quantity: 100, unit: 'm3', rate: 1000 },
      })
      ok(item, 201, 'item')
      const activity = await createActivity(client, projectId, { name: 'Concrete frame', activityCode: 'A100' })
      const allocation = await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
        token,
        data: { boqItemId: (item.body!.data as { item: { id: string } }).item.id, activityId: activity, quantity: 100 },
      })
      ok(allocation, 201, 'allocate')
      for (const step of ['submit', 'approve']) {
        ok(
          await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations/${allocation.body!.data!.id}/${step}`, { token, data: {} }),
          200,
          step,
        )
      }
      seed(
        org!.orgId,
        projectId,
        `
        await prisma.costRecord.upsert({
          where: { projectId_activityId: { projectId, activityId: args.activity } },
          create: { projectId, activityId: args.activity, actual: 62500, actualThroughDate: new Date('2026-02-05T00:00:00Z') },
          update: { actual: 62500, actualThroughDate: new Date('2026-02-05T00:00:00Z') },
        });
        `,
        { activity },
      )
      const ev = await apiJson(client, 'get', `/projects/${projectId}/reports/ev`, { token })
      ok(ev, 200, 'EV report')
      const report = ev.body!.data as { ev: number; ac: number; cpi: number; eac: number; eacBasis: string }
      // The premise: CPI 0 and the certified fallback to the revised BAC.
      expect([report.ev, report.ac, report.cpi, report.eac, report.eacBasis]).toEqual([0, 62500, 0, 100000, 'budget_cpi_zero'])
      return { projectId }
    } finally {
      await client.dispose()
    }
  })()

  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`

  // The Overview's forecast at completion.
  await page.goto(base)
  await expect(page.getByTestId('uat-controls-strip')).toBeVisible({ timeout: 30_000 })
  const tile = page.getByTestId('uat-controls-figure-forecast')
  await expect(tile).toContainText(CPI_ZERO_LABEL, { timeout: 30_000 })
  await expect(tile).not.toContainText('no cost performance yet')
  await expect(tile).not.toContainText('÷ CPI')

  // The Forecast tab: the same label, the reason, and no "within the budget".
  await page.goto(`${base}/schedule/forecast`)
  const eac = page.getByTestId('uat-forecast-eac')
  await expect(eac).toContainText(CPI_ZERO_LABEL, { timeout: 30_000 })
  await expect(eac).toContainText('100,000')
  await expect(page.getByTestId('uat-forecast-eac-note')).toContainText('CPI is 0: actual cost has been recorded with no earned value')
  const projected = page.getByTestId('uat-forecast-cost')
  await expect(projected).not.toContainText('Within the')
  await expect(projected).toContainText('The budget — nothing earned against the cost spent (CPI 0)')

  // The EV tab: the same label on its EAC card, never "Revised budget ÷ CPI".
  await page.goto(`${base}/schedule/ev`)
  const evEac = page.getByTestId('uat-ev-eac')
  await expect(evEac).toContainText('The budget — nothing earned against the cost spent (CPI 0)', { timeout: 30_000 })
  await expect(evEac).not.toContainText(/Revised budget/i)
})

/**
 * The Revisions panel loaded with the revision under review and ready; then,
 * behind the page, a second activity is entered with no link — readiness
 * now fails. Approve is refused: the toast names the check and where to fix
 * it, once, and the panel re-reads its readiness.
 */
test('a stale Approve on the schedule review panel names the failing check once and the panel re-reads its blockers', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const setup = await (async () => {
    try {
      await ensureOrg(client)
      const token = org!.adminToken
      const projectId = await createProject(client, token, `Stale approve ${Date.now()}`)
      const activity = await createActivity(client, projectId, { name: 'Excavate', activityCode: 'A100' })
      // The revision under review, active, over the project's one activity —
      // critical, with no float — so every blocking check passes.
      seed(
        org!.orgId,
        projectId,
        `
        await prisma.activity.update({ where: { id: args.activity }, data: { isCritical: true, totalFloat: 0, earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5 } });
        await prisma.scheduleRevision.create({ data: { projectId, label: 'Rev A', source: 'manual', status: 'under_review', isActive: true, activityCount: 1, criticalCount: 1, activatedAt: new Date(), snapshotJson: { activities: [{ id: 'A100', activityCode: 'A100', name: 'Excavate', duration: 5 }] } } });
        `,
        { activity },
      )
      return { projectId }
    } finally {
      await client.dispose()
    }
  })()

  await withoutRealtime(page)
  await signInForm(page, org!.adminEmail)
  const base = `/o/${org!.segment}/projects/${setup.projectId}`
  await page.goto(`${base}/schedule/gantt`)
  const panel = page.getByTestId('uat-schedule-review')
  await expect(panel).toHaveAttribute('data-status', 'under_review', { timeout: 30_000 })
  await expect(page.getByTestId('uat-schedule-review-blocking')).toHaveText('0 blocking')
  const approve = panel.getByRole('button', { name: 'Approve' })
  await expect(approve).toBeEnabled()

  // Behind the page: a second activity, with no predecessor link.
  const client2 = await apiClient()
  try {
    const added = await apiJson(client2, 'post', `/projects/${setup.projectId}/activities`, {
      token: org!.adminToken,
      data: { name: 'Pour', activityCode: 'A110', duration: 5, startDate: '2026-02-09', endDate: '2026-02-13', engineerIds: [org!.adminId] },
    })
    ok(added, 201, 'second activity')
  } finally {
    await client2.dispose()
  }

  const refusal = page.waitForResponse((r) => /\/schedule\/revisions\/[^/]+\/approve$/.test(r.url()) && r.request().method() === 'POST')
  await approve.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  expect((await refusal).status()).toBe(400)
  const reason = 'Predecessor logic — at least one predecessor relationship is required (Schedule › Gantt)'
  await expect(toasts(page, reason).first()).toBeVisible({ timeout: 15_000 })
  // Shown once — the global handler does not repeat it. Counted once, not
  // retried: a retried count would pass when a duplicate expires.
  await page.waitForTimeout(500)
  expect(await toasts(page, 'Schedule readiness checks must pass').count()).toBe(1)
  // The panel re-read the readiness the server found.
  await expect(page.getByTestId('uat-schedule-review-blocking')).toHaveText('1 blocking', { timeout: 30_000 })
  await expect(panel.getByRole('button', { name: 'Approve' })).toBeDisabled()
})

/**
 * The BOQ page loaded with revision 1 under review; behind the page it is
 * approved and locked as the baseline. Approve on the page is refused in BOQ
 * words, and the row re-reads its status.
 */
test('a stale Approve on the BOQ page says the revision is already approved and locked, and the row re-reads its status', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const token = (await ensureOrg(client)).adminToken
  const projectId = await createProject(client, token, `Stale BOQ approve ${Date.now()}`)
  const uploaded = await client.fetch(`${API}/projects/${projectId}/boq/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'Construction_BOQ.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: readFileSync(CONSTRUCTION_BOQ),
      },
      label: 'Tender bill',
    },
  })
  expect(uploaded.status()).toBe(200)
  const revisionId = ((await uploaded.json()) as { data: { revisionId: string } }).data.revisionId
  ok(await apiJson(client, 'post', `/projects/${projectId}/boq/revisions/${revisionId}/submit`, { token, data: {} }), 200, 'submit')

  await withoutRealtime(page)
  await signInForm(page, org!.adminEmail)
  await page.goto(`/o/${org!.segment}/projects/${projectId}/boq`)
  const row = page.getByTestId('boq-revision-1')
  await expect(row).toHaveAttribute('data-status', 'under_review', { timeout: 30_000 })
  const approve = row.getByRole('button', { name: 'Approve' })
  await expect(approve).toBeVisible()

  // Behind the page: approved and locked by someone else.
  for (const step of ['approve', 'lock']) {
    ok(await apiJson(client, 'post', `/projects/${projectId}/boq/revisions/${revisionId}/${step}`, { token, data: {} }), 200, step)
  }
  await client.dispose()

  const refusal = page.waitForResponse((r) => r.url().endsWith(`/boq/revisions/${revisionId}/approve`) && r.request().method() === 'POST')
  await approve.click()
  expect((await refusal).status()).toBe(409)
  const said = toasts(page, 'BOQ revision 1 is already approved and locked as the baseline; refresh the BOQ page to see it.')
  await expect(said.first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(500)
  expect(await said.count()).toBe(1)
  await expect(page.locator('[data-sonner-toast]', { hasText: /boq_revision|workflow transition/ })).toHaveCount(0)
  // The row re-read: locked as the baseline, no Approve.
  await expect(row).toHaveAttribute('data-status', 'baselined', { timeout: 30_000 })
  await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0)
})

/**
 * The workspace home's official cutoff: this organisation's projects have
 * no time zone, and neither does the organisation — the cutoff is read in
 * UTC, stated with its zone and the server's note.
 */
test('the workspace home states the official cutoff with its zone and the UTC note', async ({ page }) => {
  test.setTimeout(120_000)
  const client = await apiClient()
  try {
    const token = (await ensureOrg(client)).adminToken
    const projectId = await createProject(client, token, `Home cutoff ${Date.now()}`)
    ok(
      await apiJson(client, 'post', `/projects/${projectId}/reports/periods`, {
        token,
        data: { code: 'P01', periodStart: '2026-01-01', periodEnd: '2026-01-31', cutoffDate: '2026-01-31' },
      }),
      201,
      'period',
    )
    const home = await apiJson(client, 'get', '/projects/workspace-dashboard', { token })
    ok(home, 200, 'workspace home')
    expect((home.body!.data as { dataFreshness: { cutoffTimeZone: string } }).dataFreshness.cutoffTimeZone).toBe('UTC')
  } finally {
    await client.dispose()
  }
  await signInForm(page, org!.adminEmail)
  await page.goto(`/o/${org!.segment}`)
  await expect(page.getByTestId('workspace-dashboard')).toBeVisible({ timeout: 45_000 })
  await expect(page.getByTestId('workspace-official-cutoff')).toContainText('(UTC)', { timeout: 30_000 })
  await expect(page.getByTestId('workspace-official-cutoff')).toContainText('UTC')
  await expect(page.getByTestId('workspace-official-cutoff-zone-note')).toHaveText(UTC_NOTE)
})
