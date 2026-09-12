import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { API, apiClient, apiToken, signIn } from './support'

/**
 * P21-011: a record deep link into the quality module opens the record it
 * names. An ITP id used to be sent to `/forms/{id}` and a defect id to
 * `/punch/{id}` — both 404 — because the two legacy registers share a page
 * with the inspections and punch modules.
 *
 * Creates two ITPs, two defects and one punch item on the seeded project
 * through the API, opens the deep links as the PM, and asserts:
 *   - no request for the wrong record type (no /forms/<itp id>, no
 *     /punch/<defect id>) and no 404 at all;
 *   - the register is open with the NAMED record selected and its sibling
 *     not selected — for each of the two, so a register that merely selects
 *     its first row cannot pass;
 *   - a punch-item deep link still opens the item (the branch is by `source`,
 *     so the existing behaviour is untouched).
 * The five records are deleted at the end and the run fails if that fails.
 */

type Row = Record<string, unknown>
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const row = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {})

type Made = { kind: 'itp' | 'defects' | 'punch'; id: string; ref: string }
let client: APIRequestContext
let projectId = ''
const created: Made[] = []
const stamp = Date.now().toString(36).toUpperCase()

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

async function make(kind: Made['kind'], data: Record<string, unknown>): Promise<Made> {
  const record = await call('post', `/projects/${projectId}/${kind}`, data)
  const made = { kind, id: str(record.id), ref: str(record.ref) }
  expect(made.id && made.ref, `${kind} created`).toBeTruthy()
  created.push(made)
  return made
}

const of = (kind: Made['kind']) => created.filter((r) => r.kind === kind)

test.beforeAll(async () => {
  client = await apiClient()
  const projects = await call('get', '/projects?limit=100')
  const rows = (row(projects).items ?? row(projects).rows ?? []) as Row[]
  const seeded = rows.find((p) => p.name === 'Riverside Tower')
  expect(seeded, 'the seeded project is present').toBeTruthy()
  projectId = str(seeded?.id)

  await make('itp', { title: `E2E deep link ITP A ${stamp}`, pointType: 'hold', status: 'pending' })
  await make('itp', { title: `E2E deep link ITP B ${stamp}`, pointType: 'witness', status: 'pending' })
  await make('defects', { title: `E2E deep link defect A ${stamp}`, severity: 'minor', status: 'open' })
  await make('defects', { title: `E2E deep link defect B ${stamp}`, severity: 'major', status: 'open' })
  await make('punch', { title: `E2E deep link punch ${stamp}`, kind: 'punch', priority: 'normal', clientRequestId: `E2E-DL-${stamp}` })
})

test.afterAll(async () => {
  const failures: string[] = []
  for (const record of created) {
    const token = await apiToken(client, 'pm')
    const response = await client.delete(`${API}/projects/${projectId}/${record.kind}/${record.id}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!response.ok()) failures.push(`${record.kind} ${record.ref}: ${response.status()}`)
  }
  await client.dispose()
  if (failures.length) {
    // eslint-disable-next-line no-console
    console.log(`CLEANUP FAILED: ${failures.join('; ')}`)
    throw new Error(`quality deep-link records were not retired: ${failures.join('; ')}`)
  }
})

/** Every API response the page provoked while a deep link was opened. */
function watchResponses(page: Page) {
  const seen: Array<{ status: number; url: string }> = []
  page.on('response', (response) => {
    const url = response.url()
    if (url.includes('/api/v1/')) seen.push({ status: response.status(), url: url.replace(/^.*\/api\/v1/, '') })
  })
  return seen
}

/** Open the link to `target`; the named row is selected and its sibling is not. */
async function expectRegisterOpensOn(page: Page, child: 'itp' | 'defects', source: 'itp' | 'defect', target: Made, sibling: Made) {
  await page.goto(`/projects/${projectId}/quality/${child}?recordId=${target.id}&source=${source}`)
  const targetRow = page.getByTestId(`uat-record-row-${target.id}`)
  await expect(targetRow, `${target.ref} is on screen`).toBeVisible({ timeout: 30_000 })
  await expect(targetRow).toHaveAttribute('data-selected', 'true')
  await expect(targetRow).toContainText(target.ref)
  await expect(page.getByTestId(`uat-record-row-${sibling.id}`), `${sibling.ref} is not the selected one`).toHaveAttribute('data-selected', 'false')
}

test.describe('quality deep links open the record they name (P21-011)', () => {
  test('an ITP deep link opens the ITP register on that ITP, and fetches no form instance', async ({ page }) => {
    const [a, b] = of('itp')
    await signIn(page, 'pm')
    const responses = watchResponses(page)
    await expectRegisterOpensOn(page, 'itp', 'itp', b, a)
    await expectRegisterOpensOn(page, 'itp', 'itp', a, b)
    expect(responses.filter((r) => r.url.includes(`/forms/${a.id}`) || r.url.includes(`/forms/${b.id}`)), 'no form instance was fetched for an ITP id').toHaveLength(0)
    expect(responses.filter((r) => r.status === 404), 'nothing 404ed').toHaveLength(0)
  })

  test('a defect deep link opens the defect register on that defect, and fetches no punch item', async ({ page }) => {
    const [a, b] = of('defects')
    await signIn(page, 'pm')
    const responses = watchResponses(page)
    await expectRegisterOpensOn(page, 'defects', 'defect', b, a)
    await expectRegisterOpensOn(page, 'defects', 'defect', a, b)
    expect(responses.filter((r) => r.url.includes(`/punch/${a.id}`) || r.url.includes(`/punch/${b.id}`)), 'no punch item was fetched for a defect id').toHaveLength(0)
    expect(responses.filter((r) => r.status === 404), 'nothing 404ed').toHaveLength(0)
  })

  test('a punch-item deep link still opens the item', async ({ page }) => {
    const [punch] = of('punch')
    await signIn(page, 'pm')
    await page.goto(`/projects/${projectId}/quality/defects?recordId=${punch.id}&source=punch_item`)
    const dialog = page.getByRole('dialog')
    await expect(dialog, 'the punch item detail opens').toBeVisible({ timeout: 30_000 })
    await expect(dialog).toContainText(punch.ref)
  })
})
