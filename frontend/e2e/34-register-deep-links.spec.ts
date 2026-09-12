import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { API, apiClient, apiToken, signIn } from './support'

/**
 * P21-015: every register opens on the record its deep link names.
 *
 * For each kind, two records are created on the seeded project through the
 * API; the link to B must select B and not A, then the link to A must select
 * A and not B — so a register that merely selects its first row cannot pass.
 * Nothing may 404 on the way. Kinds with their own shape are checked their
 * own way: a task opens in its drawer, a daily log opens on its day, an IPC
 * period is the one the workbook shows. Every record created is deleted at
 * the end and the run fails if that fails.
 */

type Row = Record<string, unknown>
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const row = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {})
const rows = (x: unknown): Row[] => {
  const r = row(x)
  const list = r.rows ?? r.items ?? r.orders ?? r.periods ?? (Array.isArray(x) ? x : [])
  return Array.isArray(list) ? list.map(row) : []
}

type Made = { kind: string; id: string; ref: string; deletePath: string }
let client: APIRequestContext
let projectId = ''
let activityId = ''
const created: Made[] = []
const stamp = Date.now().toString(36).toUpperCase()
const DAY = '2027-03-15'

async function call(method: 'get' | 'post' | 'delete', path: string, data?: unknown): Promise<Row> {
  const token = await apiToken(client, 'pm')
  const response = await client[method](`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(data === undefined ? {} : { data }),
  })
  const body = row(await response.json().catch(() => null))
  if (!response.ok()) {
    throw new Error(`${method.toUpperCase()} ${path} -> ${response.status()} ${str(row(body.error).code)}: ${str(row(body.error).message)}`)
  }
  return row(body.data)
}

async function make(kind: string, prefix: string, data: Record<string, unknown>, refKey = 'ref'): Promise<Made> {
  const record = await call('post', `/projects/${projectId}/${prefix}`, data)
  const made = { kind, id: str(record.id), ref: str(record[refKey] ?? record.ref ?? record.title ?? record.name), deletePath: `/projects/${projectId}/${prefix}/${str(record.id)}` }
  expect(made.id, `${kind} created`).toBeTruthy()
  created.push(made)
  return made
}

const pair = (kind: string) => created.filter((r) => r.kind === kind) as [Made, Made]

test.beforeAll(async () => {
  client = await apiClient()
  const projects = await call('get', '/projects?limit=100')
  const seeded = rows(projects).find((p) => p.name === 'Riverside Tower')
  expect(seeded, 'the seeded project is present').toBeTruthy()
  projectId = str(seeded?.id)
  const activities = rows(await call('get', `/projects/${projectId}/activities?limit=200`))
  activityId = str(activities[0]?.id)
  expect(activityId, 'the seeded project has an activity').toBeTruthy()

  for (const which of ['A', 'B']) {
    const tag = `E2E deep link ${which} ${stamp}`
    await make('ncr', 'ncr', { description: `${tag} NCR`, severity: 'minor', activityId })
    await make('safety', 'safety', { incidentType: 'near_miss', title: `${tag} near miss`, activityId })
    await make('material_test', 'material-tests', { testType: `${tag} cube test`, result: 'pending' })
    await make('transmittal', 'transmittals', { subject: `${tag} transmittal`, sender: 'Site office', recipient: 'Client', method: 'email' })
    await make('correspondence', 'correspondence', { direction: 'outgoing', type: 'letter', subject: `${tag} letter` })
    await make('drawing', 'drawings', { drawingNumber: `E2E-DL-${which}-${stamp}`, title: `${tag} drawing` }, 'drawingNumber')
    await make('weather_delay', 'weather-delays', { description: `${tag} rain`, date: '2027-03-01', delayDays: 1, contractual: true }, 'description')
    await make('location', 'locations', { name: `${tag} zone`, code: `E2E-${which}-${stamp}`, kind: 'zone' }, 'name')
    await make('meeting', 'meetings', { title: `${tag} meeting`, meetingType: 'progress', status: 'draft' }, 'title')
    await make('change_order', 'change-orders', { description: `${tag} change`, value: 100, activityId })
  }
  // Tasks are org-level; they are created and deleted at /tasks.
  for (const which of ['A', 'B']) {
    const record = await call('post', '/tasks', { title: `E2E deep link ${which} ${stamp} task`, projectId, status: 'todo', priority: 'low' })
    created.push({ kind: 'task', id: str(record.id), ref: str(record.title), deletePath: `/tasks/${str(record.id)}` })
  }
  // A daily log day: one note entry makes the day exist.
  // Adding an entry answers with the entry's id and the whole day.
  const note = await call('post', `/projects/${projectId}/daily-logs/${DAY}/entries/notes`, { kind: 'general', text: `E2E deep link ${stamp} note` })
  const noteId = str(note.entryId ?? row(note.entry).id ?? note.id)
  expect(noteId, `the note entry id came back: ${JSON.stringify(note).slice(0, 120)}`).toBeTruthy()
  created.push({ kind: 'daily_log_note', id: noteId, ref: DAY, deletePath: `/projects/${projectId}/daily-logs/${DAY}/entries/notes/${noteId}` })
})

test.afterAll(async () => {
  const failures: string[] = []
  for (const record of [...created].reverse()) {
    const token = await apiToken(client, 'pm')
    const response = await client.delete(`${API}${record.deletePath}`, { headers: { authorization: `Bearer ${token}` } })
    if (!response.ok()) failures.push(`${record.kind} ${record.ref}: ${response.status()}`)
  }
  await client.dispose()
  if (failures.length) {
    // eslint-disable-next-line no-console
    console.log(`CLEANUP FAILED: ${failures.join('; ')}`)
    throw new Error(`register deep-link records were not retired: ${failures.join('; ')}`)
  }
})

function watch404s(page: Page) {
  const seen: string[] = []
  page.on('response', (response) => {
    if (response.status() === 404 && response.url().includes('/api/v1/')) seen.push(response.url().replace(/^.*\/api\/v1/, ''))
  })
  return seen
}

/**
 * Open the link to `target`; its row is selected and the sibling's is not.
 * A register that narrows itself to the named record (the change-order
 * register says "Showing the selected dashboard record") shows no sibling at
 * all, which is the same proof.
 */
async function expectSelected(page: Page, url: string, target: Made, sibling: Made, { narrows = false } = {}) {
  await page.goto(url)
  // Every register stamps its rows `uat-record-row-<id>` as an element id.
  const rowOf = (id: string) => page.locator(`[id="uat-record-row-${id}"]`)
  const targetRow = rowOf(target.id)
  await expect(targetRow, `${target.kind} ${target.ref} is on screen`).toBeVisible({ timeout: 30_000 })
  await expect(targetRow).toHaveAttribute('data-selected', 'true')
  const siblingRow = rowOf(sibling.id)
  if (narrows) await expect(siblingRow, `${sibling.ref} is not shown beside the named record`).toHaveCount(0)
  else await expect(siblingRow, `${sibling.ref} is not the selected one`).toHaveAttribute('data-selected', 'false')
}

const REGISTERS: Array<{ kind: string; path: string; source: string; narrows?: boolean }> = [
  { kind: 'ncr', path: 'quality/ncr', source: 'ncr' },
  { kind: 'safety', path: 'quality/safety', source: 'safety_incident' },
  { kind: 'material_test', path: 'quality/tests', source: 'material_test' },
  { kind: 'transmittal', path: 'doc-control/transmittals', source: 'transmittal' },
  { kind: 'correspondence', path: 'doc-control/correspondence', source: 'correspondence' },
  { kind: 'drawing', path: 'doc-control/drawings', source: 'drawing' },
  { kind: 'weather_delay', path: 'commercial/weather', source: 'weather_delay' },
  { kind: 'change_order', path: 'commercial/change-orders', source: 'change_order', narrows: true },
  { kind: 'meeting', path: 'meetings', source: 'meeting' },
  { kind: 'location', path: 'locations', source: 'location' },
]

test.describe('register deep links open the record they name (P21-015)', () => {
  for (const register of REGISTERS) {
    test(`${register.kind}: the named record is selected, both ways round`, async ({ page }) => {
      test.slow()
      const [a, b] = pair(register.kind)
      await signIn(page, 'pm')
      const missing = watch404s(page)
      const link = (r: Made) => `/projects/${projectId}/${register.path}?recordId=${r.id}&source=${register.source}`
      await expectSelected(page, link(b), b, a, { narrows: register.narrows })
      await expectSelected(page, link(a), a, b, { narrows: register.narrows })
      expect(missing, 'nothing 404ed').toHaveLength(0)
    })
  }

  test('task: /tasks?recordId= opens the task in its drawer', async ({ page }) => {
    const [a, b] = pair('task')
    await signIn(page, 'pm')
    await page.goto(`/tasks?recordId=${b.id}`)
    const drawer = page.getByRole('dialog')
    await expect(drawer, 'the task drawer opens').toBeVisible({ timeout: 30_000 })
    await expect(drawer.locator('input[name="title"], textarea[name="title"]').first()).toHaveValue(b.ref)
    await page.goto(`/tasks?recordId=${a.id}`)
    await expect(page.getByRole('dialog').locator('input[name="title"], textarea[name="title"]').first()).toHaveValue(a.ref, { timeout: 30_000 })
  })

  test('daily log: ?source=daily_log&recordId=<day> opens that day', async ({ page }) => {
    await signIn(page, 'pm')
    await page.goto(`/projects/${projectId}/site-reporting?recordId=${DAY}&source=daily_log`)
    await expect(page.locator('input[type="date"]').first(), 'the day is open').toHaveValue(DAY, { timeout: 30_000 })
    await expect(page.getByText(`E2E deep link ${stamp} note`).first(), 'the day shows its note').toBeVisible({ timeout: 30_000 })
  })

  test('ipc: ?source=ipc&recordId=<period> is the period the workbook shows', async ({ page }) => {
    const periods = rows(await call('get', `/projects/${projectId}/ipc`))
    test.skip(periods.length === 0, 'the seeded project has no IPC period')
    const period = periods[periods.length - 1]
    await signIn(page, 'pm')
    await page.goto(`/projects/${projectId}/commercial/ipc?recordId=${str(period.id)}&source=ipc`)
    await expect(page.getByTestId('uat-ipc-period-select')).toHaveAttribute('data-period-id', str(period.id), { timeout: 30_000 })
  })
})
