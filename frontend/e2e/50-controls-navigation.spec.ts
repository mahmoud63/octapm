import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiClient } from './support'
import {
  addMember,
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
 *   the row's change order → its register row → browser Back → the row again
 *   Gantt row → the activity's detail → one of its BOQ allocations → the
 *     row's drawer → back to the activity
 *   a change order reached from the activity → its own register, open
 *
 * and every related-record link either drawer shows opens THAT record where
 * it lives — the change order's register row, the commitment's dialog, the
 * IPC certificate selected in the workbook, the NCR selected in its list, the
 * purchase order's dialog, the other drawer — not just a page that renders.
 * A link without a record (a register's "view all") must still resolve. The
 * open drawer lives in the address bar (?recordId=&source=boq_item|activity),
 * so a readiness item's or a notification's link lands on it.
 *
 * A cost controller whose template refuses the BOQ opens the same activity:
 * the change order that reaches it through an allocation is not listed, and
 * the drawer says so ("—" with the server's reason), never "none".
 *
 * Built in a throwaway "LiveTest <uuid>" organisation through the API; the
 * approved progress, the approved change order with an allocation link, the
 * certified IPC line, the executed commitment, the NCR, the purchase order
 * and the no-BOQ template are written by a script that refuses any
 * organisation not named "LiveTest <uuid>".
 */

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url))

type Fixtures = {
  changeOrderId: string
  ipcCertificateId: string
  commitmentId: string
  commitmentRef: string
  ncrId: string
  orderId: string
  orderRef: string
}

/** The records the walk links to — LiveTest organisations only. */
const storeFixtures = (
  orgId: string,
  projectId: string,
  activityId: string,
  allocationId: string,
  boqItemId: string,
  noBoqUserId: string,
) => {
  const script = `
require('./src/utils/data-script-guard').exitUnlessDataScriptAllowed('e2e:controls-navigation');
const { prisma } = require('./src/config/db');
const commitmentService = require('./src/services/commitment.service');
const [orgId, projectId, activityId, allocationId, boqItemId, noBoqUserId] = process.argv.slice(1);
(async () => {
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { name: true } });
  if (!org || !/^LiveTest [0-9a-f-]{36}$/.test(org.name)) throw new Error('refusing: not a LiveTest organisation');
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
  if (!project) throw new Error('refusing: the project is not in that organisation');
  const activity = await prisma.activity.findFirst({ where: { id: activityId, projectId }, select: { id: true } });
  const allocation = await prisma.activityBoqAllocation.findFirst({ where: { id: allocationId, projectId, boqItemId }, select: { id: true } });
  const member = await prisma.user.findFirst({ where: { id: noBoqUserId, orgId }, select: { id: true } });
  if (!activity || !allocation || !member) throw new Error('refusing: the activity, allocation or member is not in that project');
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
  const certificate = await prisma.ipcCertificate.create({ data: { projectId, period: 'IPC-PC5-E2E' }, select: { id: true } });
  await prisma.ipcItem.create({
    data: { projectId, boqItemId, allocationId, ipcCertificateId: certificate.id, ipcPeriod: 'IPC-PC5-E2E', qty: 20, rate: 10, currentCert: 200, cumulativeCert: 200, status: 'certified' },
  });
  const commitment = await prisma.commitment.create({
    data: {
      orgId, projectId, number: 1, ref: 'SC-PC5-E2E', title: 'Slab subcontract', status: 'executed',
      lines: { create: [{ orgId, projectId, lineNumber: 1, description: 'Slabs', boqItemId, activityId, qty: 60, rate: 9, amount: 540 }] },
    },
    select: { id: true, ref: true },
  });
  // The certified writer of CostRecord.committed, as the commitment's own transition calls it.
  await commitmentService.recomputeCommitted({ orgId, projectId });
  const ncr = await prisma.ncrRecord.create({ data: { projectId, activityId, ref: 'NCR-PC5-E2E', severity: 'minor', description: 'Honeycombing' }, select: { id: true } });
  const po = await prisma.procurementOrder.create({ data: { projectId, activityId, ref: 'PO-PC5-E2E', item: 'Ready-mix concrete' }, select: { id: true, ref: true } });
  await prisma.procurementPoLine.create({
    data: { projectId, orderId: po.id, activityId, boqItemId, lineNumber: 1, description: 'Ready-mix C30', unit: 'm3', orderedQty: 60 },
  });
  // A cost controller on the project whose template refuses the BOQ.
  const template = await prisma.permissionTemplate.create({
    data: { orgId, name: 'LiveTest cost, no BOQ ' + Date.now(), baseRole: 'cost_controller', tools: { create: [{ module: 'boq', level: 'none' }] } },
    select: { id: true },
  });
  await prisma.projectAssignment.create({ data: { projectId, userId: noBoqUserId, role: 'cost_controller', orgId } });
  await prisma.projectUserPermission.create({ data: { orgId, projectId, userId: noBoqUserId, templateId: template.id } });
  process.stdout.write(JSON.stringify({
    changeOrderId: order.id, ipcCertificateId: certificate.id, commitmentId: commitment.id, commitmentRef: commitment.ref,
    ncrId: ncr.id, orderId: po.id, orderRef: po.ref,
  }));
})()
  .catch((error) => { process.stderr.write(String(error && error.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
`
  const result = spawnSync(process.execPath, ['-e', script, orgId, projectId, activityId, allocationId, boqItemId, noBoqUserId], {
    cwd: backendDir,
    env: process.env,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`store fixtures (exit ${result.status}): ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout) as Fixtures
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
  const noBoqEmail = `pc5-cost-noboq-${Date.now()}@octapm-live.test`
  const noBoqUserId = await addMember(client, org, { name: 'Cost without BOQ', email: noBoqEmail, role: 'cost_controller' })
  const fixtures = storeFixtures(org.orgId, projectId, acts.X, allocations.AX, rows.A, noBoqUserId)
  return { projectId, rows, acts, allocations, noBoqEmail, ...fixtures }
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

/**
 * The record a link names is open where it lives: each destination's own
 * selection (a highlighted register row, a record dialog, the workbook's
 * selected certificate, the other drawer). A link to a record type this map
 * does not know fails — a new link needs a check here.
 */
const expectRecordSelected = async (page: Page, source: string, recordId: string, built: Fixtures) => {
  switch (source) {
    case 'change_order':
      await expect(page.getByTestId(`uat-record-row-${recordId}`)).toBeVisible({ timeout: 30_000 })
      return
    case 'ncr':
      await expect(page.getByTestId(`uat-record-row-${recordId}`)).toHaveAttribute('data-selected', 'true', { timeout: 30_000 })
      return
    case 'commitment':
      expect(recordId).toBe(built.commitmentId)
      await expect(page.getByRole('dialog').filter({ hasText: built.commitmentRef })).toBeVisible({ timeout: 30_000 })
      return
    case 'procurement_order':
      expect(recordId).toBe(built.orderId)
      await expect(page.getByRole('dialog').filter({ hasText: built.orderRef })).toBeVisible({ timeout: 30_000 })
      return
    case 'ipc_certificate':
      await expect(page.getByTestId('uat-ipc-period-select')).toHaveAttribute('data-period-id', recordId, { timeout: 30_000 })
      return
    case 'activity':
    case 'boq_item':
      await expectOpen(page, source, recordId)
      return
    default:
      throw new Error(`No record check for a ${source} link (${recordId}): add one`)
  }
}

/** Every server-built link a drawer shows opens its record (or, for a register link, a page that exists). */
const expectLinksResolve = async (page: Page, drawerTestId: string, back: string, built: Fixtures, seen: Set<string>) => {
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
    const url = new URL(href, 'http://local')
    const recordId = url.searchParams.get('recordId')
    const source = url.searchParams.get('source')
    if (recordId && source) {
      await expectRecordSelected(page, source, recordId, built)
      seen.add(source)
    }
  }
  await page.goto(back)
}

test('a BOQ item leads to its activities and back, an activity to its BOQ rows and back, and every link opens its record', async ({ page, browser }) => {
  test.setTimeout(420_000)
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
  // A BOQ reader is told nothing is withheld.
  await expect(page.getByTestId('activity-detail-change-orders-boq-withheld')).toHaveCount(0)

  // ── ← back to row A ───────────────────────────────────────────────────
  await page.getByTestId('detail-drawer-back').click()
  drawer = await expectOpen(page, 'boq_item', rows.A)
  await expect(page.getByTestId('boq-detail-title')).toContainText('N5.1')
  await expect(page.getByTestId('detail-drawer-back')).toHaveCount(0)

  // ── → row A's change order, its register row → browser Back → row A ───
  await drawer.getByTestId(`boq-detail-change-order-${changeOrderId}`).click()
  await page.waitForURL(
    (url) =>
      url.pathname.endsWith(`/projects/${projectId}/commercial/change-orders`) &&
      url.searchParams.get('recordId') === changeOrderId &&
      url.searchParams.get('source') === 'change_order',
    { timeout: 45_000 },
  )
  await expect(page.getByTestId(`uat-record-row-${changeOrderId}`)).toBeVisible({ timeout: 30_000 })
  await page.goBack()
  await expectOpen(page, 'boq_item', rows.A)
  await expect(page.getByTestId('boq-detail-title')).toContainText('N5.1')

  // Every link the row's drawer shows opens its record.
  const seen = new Set<string>()
  await expectLinksResolve(page, 'boq-detail-drawer', projectPath(projectId, `boq?recordId=${rows.A}&source=boq_item`), built, seen)
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
  await expectLinksResolve(page, 'activity-detail-drawer', projectPath(projectId, `schedule/gantt?recordId=${acts.X}&source=activity`), built, seen)
  drawer = await expectOpen(page, 'activity', acts.X)
  // Each fixture's record was reached through a drawer link and found open.
  for (const source of ['change_order', 'commitment', 'ipc_certificate', 'ncr', 'procurement_order', 'activity', 'boq_item']) {
    expect(seen.has(source), `a ${source} link was followed`).toBe(true)
  }

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
  await expect(page.getByTestId(`uat-record-row-${changeOrderId}`)).toBeVisible({ timeout: 30_000 })

  // ── A record link lands on its drawer: the activity register and Mapping ─
  await page.goto(projectPath(projectId, `activities?recordId=${acts.Y}&source=activity`))
  await expectOpen(page, 'activity', acts.Y)
  await page.goto(projectPath(projectId, `controls/mapping?recordId=${rows.A}&source=boq_item`))
  await expectOpen(page, 'boq_item', rows.A)
  // Closing the drawer takes the record out of the address bar.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('boq-detail-drawer')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('recordId')).toBeNull()

  // ── A cost controller without BOQ read: withheld, never "none" ─────────
  const context = await browser.newContext()
  const other = await context.newPage()
  await signInForm(other, built.noBoqEmail)
  await other.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 45_000 })
  await other.goto(projectPath(projectId, `activities?recordId=${acts.X}&source=activity`))
  await expectOpen(other, 'activity', acts.X)
  await expect(other.getByTestId('activity-detail-change-orders-boq-withheld')).toContainText(
    '— Change orders reached through BOQ allocations are available only to members who may read the BOQ',
  )
  await expect(other.getByTestId('activity-detail-changes')).not.toContainText('No change order touches this activity')
  await expect(other.getByTestId(`activity-detail-change-order-${changeOrderId}`)).toHaveCount(0)
  await expect(other.getByTestId('activity-detail-history-boq-withheld')).toBeVisible()
  await context.close()
})
