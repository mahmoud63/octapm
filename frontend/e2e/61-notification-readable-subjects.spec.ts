import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiClient } from './support'
import {
  addMember,
  apiJson,
  createProject,
  dropLiveOrg,
  escapeRegExp,
  registerLiveOrg,
  signInForm,
  type LiveOrg,
} from './support-workspaces'

/**
 * A notification names its record in words, never by its database id
 * (owner, 2026-09-28: "BOQ allocation 0766b8b4-… needs approval" on the
 * field app's Notifications screen; the web bell reads the same rows).
 *
 *   the bell shows "BOQ allocation for Activity A120 needs approval" for a
 *     freshly submitted allocation, and a row stored before the rule (title
 *     "BOQ allocation <uuid> …", message "…: Workflow record. …") in words
 *     too — no UUID-shaped token anywhere in the list
 *   clicking the notification lands on the record's page for that project:
 *     the project's workspace page with the allocation pre-selected by id
 *
 * Everything is built in a throwaway "LiveTest <uuid>" organisation through
 * the API; the one stored legacy row is written by a backend script that
 * refuses any organisation not named "LiveTest <uuid>".
 */

const IDENTIFIER = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url))

/** Writes one legacy-shaped notification row, in a LiveTest organisation's project only. */
const storeLegacyRow = (orgId: string, projectId: string, row: Record<string, unknown>) => {
  const script = `
require('./src/utils/data-script-guard').exitUnlessDataScriptAllowed('e2e:notification-readable-subjects');
const { prisma } = require('./src/config/db');
const [orgId, projectId, rawRow] = process.argv.slice(1);
(async () => {
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { name: true } });
  if (!org || !/^LiveTest [0-9a-f-]{36}$/.test(org.name)) throw new Error('refusing: not a LiveTest organisation');
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
  if (!project) throw new Error('refusing: the project is not in that organisation');
  const created = await prisma.notification.create({ data: { ...JSON.parse(rawRow), orgId, projectId } });
  process.stdout.write(JSON.stringify({ id: created.id }));
})()
  .catch((error) => { process.stderr.write(String(error && error.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
`
  const result = spawnSync(process.execPath, ['-e', script, orgId, projectId, JSON.stringify(row)], {
    cwd: backendDir,
    env: process.env,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`store legacy row (exit ${result.status}): ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout) as { id: string }
}

const ok = (response: { status: number; body: { error?: unknown } | null }, expected: number, what: string) =>
  expect(response.status, `${what} -> ${JSON.stringify(response.body?.error)}`).toBe(expected)

const build = async (client: APIRequestContext) => {
  org = await registerLiveOrg(client, 'notif')
  const token = org.adminToken
  const projectName = `Readable notifications ${Date.now()}`
  const projectId = await createProject(client, token, projectName)
  // A second project manager, on the project's team, who is asked to approve.
  const reviewerEmail = `live-notif-reviewer-${crypto.randomUUID()}@octapm-live.test`
  const reviewerId = await addMember(client, org, { name: 'Notif Reviewer', email: reviewerEmail, role: 'pm' })
  ok(await apiJson(client, 'post', `/projects/${projectId}/team`, { token, data: { userId: reviewerId } }), 201, 'team')

  const item = await apiJson(client, 'post', `/projects/${projectId}/boq/items`, {
    token,
    data: { code: '1.1', description: 'Concrete Foundations', quantity: 10, unit: 'm3', rate: 100 },
  })
  ok(item, 201, 'boq item')
  const activity = await apiJson(client, 'post', `/projects/${projectId}/activities`, {
    token,
    data: { name: 'Pour foundations', activityCode: 'A120', duration: 5, startDate: '2026-08-03', endDate: '2026-08-07', engineerIds: [org.adminId] },
  })
  ok(activity, 201, 'activity')
  const allocation = await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
    token,
    data: { boqItemId: (item.body!.data as { item: { id: string } }).item.id, activityId: activity.body!.data!.id, quantity: 10 },
  })
  ok(allocation, 201, 'allocation')
  const allocationId = allocation.body!.data!.id as string
  ok(await apiJson(client, 'post', `/projects/${projectId}/activity-boq-allocations/${allocationId}/submit`, { token, data: {} }), 200, 'submit')

  // A row as the shared database holds 714 of them, written before the rule.
  const legacy = storeLegacyRow(org.orgId, projectId, {
    recipientUserId: reviewerId,
    type: 'workflow',
    category: 'approval',
    event: 'workflow.approved',
    title: `BOQ allocation ${allocationId} approved`,
    message: 'BOQ allocation: Workflow record. Status moved to approved.',
    priority: 'normal',
    inAppVisible: true,
    actionUrl: `/projects/${projectId}?recordId=${allocationId}&source=activity_boq_allocation`,
    entityType: 'activity_boq_allocation',
    entityId: allocationId,
    metadataJson: { action: 'approved', toStatus: 'approved' },
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  })
  return { projectId, projectName, allocationId, reviewerEmail, legacyId: legacy.id }
}

test('the bell names a BOQ allocation by its activity, never its id, and opens the record on its project', async ({ page }) => {
  test.setTimeout(240_000)
  const client = await apiClient()
  const built = await build(client)

  await signInForm(page, built.reviewerEmail)
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 45_000 })

  const bell = page.getByRole('button', { name: 'Notifications' })
  await bell.click()
  const menu = page.getByRole('menu')
  const fresh = menu.getByRole('link', { name: /BOQ allocation for Activity A120 needs approval/ })
  await expect(fresh).toBeVisible()
  await expect(fresh).toContainText('BOQ allocation: Activity A120. Status moved to submitted.')
  // The row stored before the rule reads in words too.
  const legacy = menu.getByRole('link', { name: /BOQ allocation for Activity A120 approved/ })
  await expect(legacy).toBeVisible()
  await expect(legacy).toContainText('BOQ allocation: Activity A120. Status moved to approved.')
  // Nothing the bell shows carries an identifier, or the old placeholder.
  const shown = await menu.innerText()
  expect(shown).not.toMatch(IDENTIFIER)
  expect(shown).not.toContain('Workflow record')

  // The link is the record's: the project's page, the allocation pre-selected.
  await expect(fresh).toHaveAttribute(
    'href',
    new RegExp(`^/o/[^/]+/projects/${built.projectId}\\?recordId=${built.allocationId}&source=activity_boq_allocation$`),
  )
  await fresh.click()
  await page.waitForURL(
    (url) => url.pathname.endsWith(`/projects/${built.projectId}`) && url.searchParams.get('recordId') === built.allocationId,
    { timeout: 45_000 },
  )
  await expect(page.getByText(new RegExp(escapeRegExp(built.projectName))).first()).toBeVisible({ timeout: 30_000 })
})
