import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiClient } from './support'
import {
  addMember,
  apiJson,
  createProject,
  dropLiveOrg,
  registerLiveOrg,
  signInForm,
  workspaceToken,
  type LiveOrg,
} from './support-workspaces'

/**
 * PC-7b integration fixer, item 2 — the web change-event dialog for a member
 * without BOQ read, on a change event raised from a BOQ-derived exception.
 *
 * The API leaves out of such an event what it took from the exception (the
 * mapped activity, the cost code, the quantity delta, its unit, the unit cost)
 * and names each in `sourceWithheld.keys` with the reason. The dialog shows
 * each as "—" with the server's reason — never the literal "undefined", never
 * a recomputed 0 — shows the line's STORED amount, and never sends a withheld
 * field back: a quantity surveyor without BOQ read opens the event, edits the
 * title, saves, and the stored quantity, unit, unit cost, activity and cost
 * code are byte-identical afterwards (the server would refuse one sent: 409
 * CHANGE_EVENT_FIELD_WITHHELD).
 *
 * A throwaway "LiveTest <uuid>" organisation, built through the API; the one
 * exception is seeded directly in that organisation (the engine is not
 * needed), and the raise is the product's own POST.
 */

let org: LiveOrg | null = null
const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url))

/** Runs a small Prisma script in the backend, refused for any organisation that is not a LiveTest one. */
const inLiveOrg = (orgId: string, body: string, ...args: string[]) => {
  const code = `
const { prisma } = require('./src/config/db');
(async () => {
  const [orgId, ...args] = process.argv.slice(1);
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { name: true } });
  if (!org || !/^LiveTest [0-9a-f-]{36}$/.test(org.name)) throw new Error('refusing: not a LiveTest organisation');
  const out = await (async () => { ${body} })();
  process.stdout.write(JSON.stringify(out ?? null));
  await prisma.$disconnect();
})().catch(async (error) => { console.error(error); process.exit(1); });`
  const run = spawnSync(process.execPath, ['-e', code, orgId, ...args], { cwd: backendDir, env: process.env, encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`prisma script failed (exit ${run.status}): ${run.stderr || run.stdout}`)
  return JSON.parse(run.stdout.trim().split('\n').pop() || 'null')
}

test.afterAll(() => {
  if (!org) return
  try {
    inLiveOrg(
      org.orgId,
      `for (const model of ['notification', 'backgroundJob', 'outboundEvent', 'auditEvent', 'approvalWorkflowEvent', 'projectException']) await prisma[model]?.deleteMany?.({ where: { orgId } }).catch(() => {});`,
    )
  } catch (error) {
    process.stderr.write(`[e2e 69] ${String(error)}\n`)
  }
  dropLiveOrg(org.orgId)
})

const withApi = async <T,>(work: (client: APIRequestContext) => Promise<T>) => {
  const client = await apiClient()
  try {
    return await work(client)
  } finally {
    await client.dispose()
  }
}

const call = async (
  client: APIRequestContext,
  method: 'get' | 'post' | 'put' | 'patch',
  route: string,
  { data, token = org!.adminToken, status = 200 }: { data?: unknown; token?: string; status?: number } = {},
) => {
  const moved = await apiJson(client, method, route, { token, data })
  expect(moved.status, `${method} ${route} -> ${JSON.stringify(moved.body?.error)}`).toBe(status)
  return moved.body!.data as Record<string, unknown>
}

/** What the raise took from the exception onto the line (the BOQ item here carries no cost code). */
const WITHHELD = ['activityId', 'quantity', 'unit', 'unitCost']

type Line = { id: string; description: string; romAmount: number }
type Event = { id: string; ref: string; title: string; lines: Line[]; sourceWithheld?: { keys: string[]; reason: string } }

/** The stored figures of the event and its line, straight from the database. */
const storedOf = (eventId: string) =>
  inLiveOrg(
    org!.orgId,
    `const event = await prisma.changeEvent.findFirst({ where: { id: args[0], orgId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
     return { title: event.title, activityId: event.activityId, lines: event.lines.map((line) => ({ id: line.id, activityId: line.activityId, costCodeId: line.costCodeId, quantity: line.quantity, unit: line.unit, unitCost: String(line.unitCost), romAmount: String(line.romAmount) })) };`,
    eventId,
  ) as { title: string; activityId: string | null; lines: Array<Record<string, unknown>> }

test('a member without BOQ read opens and saves a change event raised from a BOQ-derived exception: "—" with the reason, the stored amount, nothing withheld sent, the stored figures unchanged', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const fixture = await withApi(async (client) => {
    org = await registerLiveOrg(client, 'pc7bfix')
    const projectId = await createProject(client, org.adminToken, `Withheld save ${Date.now()}`)
    const qsEmail = `live-pc7bfix-qs-${crypto.randomUUID()}@octapm-live.test`
    const qsId = await addMember(client, org, { name: 'No BOQ Surveyor', email: qsEmail, role: 'qs' })
    const joined = await apiJson(client, 'post', `/projects/${projectId}/team`, { token: org.adminToken, data: { userId: qsId } })
    expect(joined.status, JSON.stringify(joined.body?.error)).toBeLessThan(300)
    const template = await call(client, 'post', '/permissions/templates', {
      data: { name: `No BOQ surveyor ${Date.now()}`, baseRole: 'qs', tools: [{ module: 'boq', level: 'none' }] },
      status: 201,
    })
    await call(client, 'put', `/projects/${projectId}/team/${qsId}/permissions`, { data: { templateId: template.id } })

    const activity = await call(client, 'post', `/projects/${projectId}/activities`, {
      data: { engineerIds: [org.adminId], name: 'Piling', activityCode: 'PIL1', duration: 3, startDate: '2026-02-02', endDate: '2026-02-04' },
      status: 201,
    })
    const item = await call(client, 'post', `/projects/${projectId}/boq/items`, {
      data: { code: 'P1.1', description: 'Piling', quantity: 40, unit: 'm', rate: 31.17 },
      status: 201,
    })
    const allocation = await call(client, 'post', `/projects/${projectId}/activity-boq-allocations`, {
      data: { boqItemId: (item.item as { id: string }).id, activityId: activity.id, quantity: 40 },
      status: 201,
    })
    for (const step of ['submit', 'approve']) {
      await call(client, 'post', `/projects/${projectId}/activity-boq-allocations/${allocation.id as string}/${step}`)
    }
    const exceptionId = inLiveOrg(
      org.orgId,
      `const row = await prisma.projectException.create({ data: { orgId, projectId: args[0], kind: 'quantity_over_allocation', severity: 'critical', subjectType: 'allocation', subjectId: args[1], measured: 45, limit: 40, unitCode: 'm', measuredBasis: 'seeded (measured)', limitBasis: 'seeded (limit)' } });
       return row.id;`,
      projectId,
      allocation.id as string,
    ) as string
    const raised = (await call(client, 'post', `/projects/${projectId}/controls/exceptions/${exceptionId}/raise-change-event`, { status: 201 })) as {
      changeEvent: Event & { activityId: string; lines: Array<Line & { activityId: string; costCodeId: string | null; quantity: number; unit: string; unitCost: number }> }
    }
    const event = raised.changeEvent
    const line = event.lines[0]
    // The PM prices the line's amount (a BOQ reader): the quantity, unit and activity stay as taken.
    await call(client, 'patch', `/projects/${projectId}/change-events/${event.id}`, {
      data: { lines: [{ id: line.id, description: line.description, activityId: line.activityId, costCodeId: line.costCodeId, quantity: line.quantity, unit: line.unit, unitCost: line.unitCost, romAmount: 250 }] },
    })
    const qsToken = await workspaceToken(client, qsEmail, org.orgId)
    const theirs = (await call(client, 'get', `/projects/${projectId}/change-events/${event.id}`, { token: qsToken })) as unknown as Event
    return { projectId, qsEmail, event, lineId: line.id, theirs }
  })
  const { projectId, qsEmail, event, lineId, theirs } = fixture
  const reason = theirs.sourceWithheld?.reason
  expect(reason, 'the API withholds from the surveyor, with a reason').toBeTruthy()
  for (const field of WITHHELD) {
    expect(theirs.sourceWithheld!.keys, `lines[].${field} withheld`).toContain(`lines[${lineId}].${field}`)
  }
  expect(theirs.sourceWithheld!.keys).toContain('activityId')
  const before = storedOf(event.id)
  expect(before.lines[0]).toMatchObject({ quantity: 5, unit: 'm', romAmount: '250' })

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, qsEmail)
  await page.goto(`/o/${org!.segment}/projects/${projectId}/commercial/change-events`)
  await expect(page.getByTestId('uat-change-events-rows')).toBeVisible({ timeout: 45_000 })
  await page.getByTestId('uat-change-events-rows').getByText(event.ref, { exact: true }).click()
  const dialog = page.getByTestId('uat-change-event')
  await expect(dialog.getByTestId('uat-change-event-title')).toHaveValue(event.title, { timeout: 30_000 })

  // Each withheld field reads "—" with the server's reason; never "undefined".
  const row = dialog.getByTestId(`uat-change-event-line-${lineId}`)
  await expect(row).toHaveAttribute('data-withheld', /activityId/)
  const dashes = row.getByTestId('uat-change-event-withheld')
  await expect(dashes).toHaveCount(WITHHELD.length)
  for (let index = 0; index < WITHHELD.length; index += 1) {
    await expect(dashes.nth(index)).toHaveText('—')
    await expect(dashes.nth(index)).toHaveAttribute('data-reason', reason!)
  }
  await expect(dialog.getByTestId('uat-change-event-activity-withheld')).toHaveAttribute('data-reason', reason!)
  await expect(dialog.getByTestId('uat-change-event-source-withheld')).toContainText(`— ${reason}`)
  await expect(dialog).not.toContainText('undefined')
  await expect(dialog).not.toContainText('NaN')
  // The line's stored amount, not quantity × unit cost.
  await expect(row.getByTestId(`uat-change-event-line-amount-${lineId}`).locator('input')).toHaveValue('250')

  // Save an edit of the title: nothing withheld is sent back.
  await dialog.getByTestId('uat-change-event-title').fill('LiveTest saved by the surveyor')
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith(`/change-events/${event.id}`))
  await dialog.getByTestId('uat-change-event-save').click()
  const response = await saved
  expect(response.status(), JSON.stringify(await response.json().catch(() => null))).toBe(200)
  const sent = response.request().postDataJSON() as Record<string, unknown> & { lines: Array<Record<string, unknown>> }
  expect(Object.keys(sent), 'the event activity is not sent').not.toContain('activityId')
  expect(sent.lines).toHaveLength(1)
  for (const field of WITHHELD) {
    expect(Object.keys(sent.lines[0]), `lines[0].${field} is not sent`).not.toContain(field)
  }
  expect(sent.lines[0].romAmount, 'the stored amount is carried').toBe(250)

  const after = storedOf(event.id)
  expect(after.title).toBe('LiveTest saved by the surveyor')
  expect(JSON.stringify({ activityId: after.activityId, lines: after.lines }), 'the stored figures are byte-identical').toBe(
    JSON.stringify({ activityId: before.activityId, lines: before.lines }),
  )
})
