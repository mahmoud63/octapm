import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
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
 * Schedule and BOQ as one story (PC-5): the owner's complaint was that they
 * felt like two products. A reviewer walks
 *
 *   BOQ grid → a row's detail → one of its activities → back to the row
 *   Gantt row → the activity's detail → one of its BOQ allocations → the
 *     row's drawer → back to the activity
 *   a change order reached from the activity → its own register, open
 *
 * and every related-record link either drawer shows resolves to a page that
 * exists (no 404, no dead end). The open drawer lives in the address bar
 * (?recordId=&source=boq_item|activity), so a readiness item's or a
 * notification's link lands on it.
 *
 * Built in a throwaway "LiveTest <uuid>" organisation through the API; the
 * approved progress and the approved change order with an allocation link
 * are written by a script that refuses any organisation not named
 * "LiveTest <uuid>".
 */

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url))

/** Approved progress on one activity and an approved change order on one allocation — LiveTest organisations only. */
const storeProgressAndChange = (orgId: string, projectId: string, activityId: string, allocationId: string, boqItemId: string) => {
  const script = `
require('./src/utils/data-script-guard').exitUnlessDataScriptAllowed('e2e:controls-navigation');
const { prisma } = require('./src/config/db');
const [orgId, projectId, activityId, allocationId, boqItemId] = process.argv.slice(1);
(async () => {
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { name: true } });
  if (!org || !/^LiveTest [0-9a-f-]{36}$/.test(org.name)) throw new Error('refusing: not a LiveTest organisation');
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
  if (!project) throw new Error('refusing: the project is not in that organisation');
  const activity = await prisma.activity.findFirst({ where: { id: activityId, projectId }, select: { id: true } });
  const allocation = await prisma.activityBoqAllocation.findFirst({ where: { id: allocationId, projectId, boqItemId }, select: { id: true } });
  if (!activity || !allocation) throw new Error('refusing: the activity or allocation is not in that project');
  await prisma.activityProgress.create({
    data: { activityId, pctComplete: 40, status: 'approved', source: 'manual', approvedAt: new Date() },
  });
  const order = await prisma.changeOrder.create({
    data: {
      projectId, ref: 'CO-PC5-E2E', description: 'Extra slab thickening', value: 80, status: 'approved', approvedAt: new Date(),
      allocationLinks: { create: [{ projectId, allocationId, boqItemId, quantity: 8, amount: 80 }] },
    },
    select: { id: true },
  });
  process.stdout.write(JSON.stringify({ changeOrderId: order.id }));
})()
  .catch((error) => { process.stderr.write(String(error && error.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
`
  const result = spawnSync(process.execPath, ['-e', script, orgId, projectId, activityId, allocationId, boqItemId], {
    cwd: backendDir,
    env: process.env,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`store progress/change (exit ${result.status}): ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout) as { changeOrderId: string }
}

const ok = (response: { status: number; body: { error?: unknown } | null }, expected: number, what: string) =>
  expect(response.status, `${what} -> ${JSON.stringify(response.body?.error)}`).toBe(expected)

const build = async (client: APIRequestContext) => {
  org = await registerLiveOrg(client, 'pc5nav')
  const token = org.adminToken
  const projectId = await createProject(client, token, `Controls navigation ${Date.now()}`)
  const rows: Record<string, string> = {}
  for (const [key, data] of Object.entries({
    A: { code: 'N5.1', description: 'Concrete to slabs', quantity: 100, unit: 'm3', rate: 10 },
    B: { code: 'N5.2', description: 'Formwork to slabs', quantity: 50, unit: 'm2', rate: 20 },
  })) {
    const created = await apiJson(client, 'post', `/projects/${projectId}/boq/items`, { token, data })
    ok(created, 201, `boq ${key}`)
    rows[key] = (created.body!.data as { item: { id: string } }).item.id
  }
  const acts: Record<string, string> = {}
  for (const [key, code] of [['X', 'N5X'], ['Y', 'N5Y']]) {
    const created = await apiJson(client, 'post', `/projects/${projectId}/activities`, {
      token,
      data: { name: `Pour slab ${key}`, activityCode: code, duration: 5, startDate: '2026-02-02', endDate: '2026-02-06', engineerIds: [org.adminId] },
    })
    ok(created, 201, `activity ${key}`)
    acts[key] = created.body!.data!.id as string
  }
  // Row A on two activities; activity X carrying two rows.
  const allocations: Record<string, string> = {}
  for (const [key, boqItemId, activityId, quantity] of [
    ['AX', rows.A, acts.X, 60],
    ['AY', rows.A, acts.Y, 40],
    ['BX', rows.B, acts.X, 50],
  ] as const) {
    const created = await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
      token,
      data: { boqItemId, activityId, quantity },
    })
    ok(created, 201, `allocation ${key}`)
    allocations[key] = created.body!.data!.id as string
    for (const step of ['submit', 'approve']) {
      ok(await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations/${allocations[key]}/${step}`, { token, data: {} }), 200, `${key} ${step}`)
    }
  }
  const { changeOrderId } = storeProgressAndChange(org.orgId, projectId, acts.X, allocations.AX, rows.A)
  return { projectId, rows, acts, allocations, changeOrderId }
}

const projectPath = (projectId: string, rest: string) => `/o/${org!.segment}/projects/${projectId}/${rest}`

const expectOpen = async (page: Page, source: 'boq_item' | 'activity', recordId: string) => {
  const drawer = page.getByTestId(source === 'boq_item' ? 'boq-detail-drawer' : 'activity-detail-drawer')
  await expect(drawer).toBeVisible({ timeout: 30_000 })
  await expect(drawer).toHaveAttribute(source === 'boq_item' ? 'data-item-id' : 'data-activity-id', recordId)
  await expect
    .poll(() => {
      const url = new URL(page.url())
      return `${url.searchParams.get('source')}:${url.searchParams.get('recordId')}`
    })
    .toBe(`${source}:${recordId}`)
  return drawer
}

/** Every server-built link a drawer shows opens a page that exists. */
const expectLinksResolve = async (page: Page, drawerTestId: string, back: string) => {
  const hrefs = await page
    .getByTestId(drawerTestId)
    .locator('a[href]')
    .evaluateAll((anchors) => [...new Set(anchors.map((anchor) => anchor.getAttribute('href') || ''))])
  expect(hrefs.length).toBeGreaterThan(0)
  for (const href of hrefs) {
    // Always inside the workspace — never a legacy /projects/… path.
    expect(href, href).toMatch(/^\/o\/[^/]+\/projects\/[^/]+\//)
    await page.goto(href)
    await expect(page.getByTestId('project-module-content').or(page.locator('main')).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Oops! Page Not Found!'), href).toHaveCount(0)
  }
  await page.goto(back)
}

test('a BOQ item leads to its activities and back, an activity to its BOQ rows and back, and every link resolves', async ({ page }) => {
  test.setTimeout(300_000)
  const client = await apiClient()
  const built = await build(client)
  const { projectId, rows, acts, changeOrderId } = built

  await signInForm(page, org!.adminEmail)
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 45_000 })

  // ── BOQ grid → row A's detail ─────────────────────────────────────────
  await page.goto(projectPath(projectId, 'boq'))
  await page.getByTestId(`boq-row-open-detail-${rows.A}`).click()
  let drawer = await expectOpen(page, 'boq_item', rows.A)
  await expect(page.getByTestId('boq-detail-title')).toContainText('N5.1')
  // Figures carry their truth; what no service proves yet names its wave.
  await expect(page.getByTestId('boq-detail-qty-current').locator('[data-truth="source"]')).toBeVisible()
  await expect(page.getByTestId('boq-detail-qty-mapped')).toContainText('100')
  await expect(page.getByTestId('boq-detail-qty-authorised')).toContainText('108')
  // The value slot itself says so — no figure is drawn for it.
  const installed = page.getByTestId('boq-detail-qty-installed')
  await expect(installed.locator('[data-not-available="PC-6"]')).toHaveText('Not available yet (PC-6)')
  await expect(installed.locator('[data-value]')).toHaveCount(0)
  const forecast = page.getByTestId('boq-detail-money-forecast')
  await expect(forecast.locator('[data-not-available="PC-7"]')).toHaveText('Not available yet (PC-7)')
  await expect(forecast.locator('[data-value]')).toHaveCount(0)
  await expect(drawer.getByTestId(`boq-detail-change-order-${changeOrderId}`)).toBeVisible()
  // Its two activities.
  await expect(drawer.getByTestId(`boq-detail-activity-${acts.Y}`)).toContainText('N5Y')
  await drawer.getByTestId(`boq-detail-activity-${acts.X}`).click()

  // ── → activity X, which carries rows A and B ──────────────────────────
  drawer = await expectOpen(page, 'activity', acts.X)
  await expect(page.getByTestId('activity-detail-title')).toContainText('N5X')
  await expect(drawer.getByTestId(`activity-detail-boq-${rows.B}`)).toContainText('N5.2')
  await expect(page.getByTestId('activity-detail-mapped-qty')).toContainText('110')
  await expect(page.getByTestId('activity-detail-progress-source')).toContainText('manual')
  await expect(page.getByTestId('activity-detail-pct')).toContainText('40%')
  await expect(page.getByTestId('activity-detail-generated-budget').locator('[data-truth="projection"]')).toBeVisible()
  await expect(drawer.getByTestId(`activity-detail-change-order-${changeOrderId}`)).toBeVisible()

  // ── ← back to row A ───────────────────────────────────────────────────
  await page.getByTestId('detail-drawer-back').click()
  await expectOpen(page, 'boq_item', rows.A)
  await expect(page.getByTestId('boq-detail-title')).toContainText('N5.1')
  await expect(page.getByTestId('detail-drawer-back')).toHaveCount(0)

  // Every link the row's drawer shows resolves.
  await expectLinksResolve(page, 'boq-detail-drawer', projectPath(projectId, `boq?recordId=${rows.A}&source=boq_item`))
  await expectOpen(page, 'boq_item', rows.A)

  // ── Gantt row → activity X → its row B → back ─────────────────────────
  await page.goto(projectPath(projectId, 'schedule/gantt'))
  await page.getByTestId(`gantt-open-detail-${acts.X}`).click()
  drawer = await expectOpen(page, 'activity', acts.X)
  await drawer.getByTestId(`activity-detail-boq-${rows.B}`).click()
  await expectOpen(page, 'boq_item', rows.B)
  await expect(page.getByTestId('boq-detail-title')).toContainText('N5.2')
  await page.getByTestId('detail-drawer-back').click()
  await expectOpen(page, 'activity', acts.X)
  await expectLinksResolve(page, 'activity-detail-drawer', projectPath(projectId, `schedule/gantt?recordId=${acts.X}&source=activity`))
  drawer = await expectOpen(page, 'activity', acts.X)

  // ── → the change order, open in its own register ──────────────────────
  await drawer.getByTestId(`activity-detail-change-order-${changeOrderId}`).click()
  await page.waitForURL(
    (url) =>
      url.pathname.endsWith(`/projects/${projectId}/commercial/change-orders`) &&
      url.searchParams.get('recordId') === changeOrderId &&
      url.searchParams.get('source') === 'change_order',
    { timeout: 45_000 },
  )
  await expect(page.getByText('Oops! Page Not Found!')).toHaveCount(0)

  // ── A record link lands on its drawer: the activity register and Mapping ─
  await page.goto(projectPath(projectId, `activities?recordId=${acts.Y}&source=activity`))
  await expectOpen(page, 'activity', acts.Y)
  await page.goto(projectPath(projectId, `controls/mapping?recordId=${rows.A}&source=boq_item`))
  await expectOpen(page, 'boq_item', rows.A)
  // Closing the drawer takes the record out of the address bar.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('boq-detail-drawer')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('recordId')).toBeNull()
})
