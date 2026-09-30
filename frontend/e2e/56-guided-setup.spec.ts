import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Page, type Response as PwResponse } from '@playwright/test'
import { API, apiClient } from './support'
import {
  addMember,
  apiJson,
  createProject,
  dropLiveOrg,
  registerLiveOrg,
  signInForm,
  workspaceToken,
  LIVE_PASSWORD,
  type LiveOrg,
} from './support-workspaces'

/**
 * Guided setup (PC-8, owner §32/§33) over the readiness engine, walked on a
 * greenfield project in a throwaway "LiveTest <uuid>" organisation:
 *
 *   fresh: ten stages, the BOQ stage is current and blocked, the baseline
 *      stage refuses Continue (its gate blocks), a warning stage (Locations)
 *      offers "Continue with warning" and moves on; the strip's figures are
 *      the engine's own (GET /setup-readiness)
 *   a planning engineer (no schedule approval) sees "Ask Project Manager …"
 *      where the PM sees Approve; Validation on the staged revision shows no
 *      active-schedule check (none a FAIL the approval ignores) and links to
 *      its own review; the PM approves through the guide
 *   activated and fully mapped: Mapping PASS, the baseline gate ready — the
 *      baseline stage continues with a warning and offers the lock
 *   value left unmapped again (a new priced row; no route removes an approved
 *      allocation): Mapping back to Blocked, the baseline stage refuses
 *      Continue and names the gate's blockers; Ready for Execution continues
 *      into Progress with a warning and says official reporting is blocked
 *      and who may override it
 *
 * the three schedule states (R5-4) — none, staged, active — on the guide's
 * strip, the readiness card's line, its step cards and the controls tiles: a
 * staged revision's import reads complete, nothing counts a schedule that is
 * not active (no "Critical unmapped 0", no "Activities: 0" chip, no "No
 * activities" badge), and a rejected staged revision is said to need
 * resubmission by the tile as by the headline — never "waiting for
 * activation";
 *
 * a member without BOQ access: the strip's mapping figures read "—" with the
 * server's reason, the bill's quantity and value are absent, nothing reads
 * zero;
 *
 * and the import previews: a BOQ workbook and a schedule workbook are
 * previewed through the server's dry run on screen, the figures shown are the
 * dry run's own, and the project's rows are counted before and after — the
 * preview writes nothing.
 */

let org: LiveOrg | null = null

test.afterAll(() => {
  if (org) dropLiveOrg(org.orgId)
})

const XER = [
  'ERMHDR\t19.12',
  '%T\tPROJWBS',
  '%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num',
  '%R\tW1\t\tCIV\tCivil\t1',
  '%T\tTASK',
  '%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct',
  '%R\tT1\tS100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0',
  '%R\tT2\tS200\tPour\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0',
  '%T\tTASKPRED',
  '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
  '%R\tP1\tT2\tT1\tPR_FS\t0',
  '%E',
  '',
].join('\n')

const withApi = async <T,>(work: (client: APIRequestContext) => Promise<T>) => {
  const client = await apiClient()
  try {
    return await work(client)
  } finally {
    await client.dispose()
  }
}

const post = async (client: APIRequestContext, projectId: string, route: string, data: unknown, expected = 200) => {
  const moved = await apiJson(client, 'post', `/projects/${projectId}${route}`, { token: org!.adminToken, data })
  expect(moved.status, `${route} -> ${JSON.stringify(moved.body?.error)}`).toBe(expected)
  return moved.body!.data as Record<string, unknown>
}

type Headline = { key: string; label?: string; value: string }
const engineHeadline = (projectId: string) =>
  withApi(async (client) => {
    const readiness = await apiJson(client, 'get', `/projects/${projectId}/setup-readiness`, { token: org!.adminToken })
    expect(readiness.status).toBe(200)
    return ((readiness.body!.data as { summary: { headline: Headline[] } }).summary.headline ?? []) as Headline[]
  })

/** Every figure on the strip is the engine's, entry for entry. */
const expectStripIsEngine = async (page: Page, projectId: string) => {
  const headline = await engineHeadline(projectId)
  expect(headline.length).toBeGreaterThan(0)
  await expect(page.getByTestId('setup-guide-strip').locator('> li')).toHaveCount(headline.length)
  for (const entry of headline) {
    const shown = page.getByTestId(`setup-guide-strip-${entry.key}`)
    await expect(shown).toHaveAttribute('data-value', entry.value)
    await expect(shown).toContainText(`${entry.label ?? ''}${entry.value}`)
  }
  return headline
}

const openGuide = async (page: Page, base: string) => {
  await page.goto(base)
  const toggle = page.getByTestId('setup-guide-toggle')
  await expect(toggle).toBeVisible({ timeout: 45_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(page.getByTestId('setup-guide-stepper')).toBeVisible()
}

const stage = (page: Page, key: string) => page.getByTestId(`setup-guide-stage-${key}`)
const panel = (page: Page) => page.getByTestId('setup-guide-panel')

test('guided setup walks the readiness engine: warnings continue, the baseline gate refuses, actions follow permissions', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const { projectId, plannerEmail } = await withApi(async (client) => {
    org = await registerLiveOrg(client, 'pc8guide')
    const project = await createProject(client, org.adminToken, `Guided setup ${Date.now()}`)
    const email = `live-pc8guide-pe-${crypto.randomUUID()}@octapm-live.test`
    const plannerId = await addMember(client, org, { name: 'Planning Engineer', email, role: 'planning_eng' })
    const joined = await apiJson(client, 'post', `/projects/${project}/team`, {
      token: org.adminToken,
      data: { userId: plannerId },
    })
    expect(joined.status, JSON.stringify(joined.body?.error)).toBeLessThan(300)
    return { projectId: project, plannerEmail: email }
  })
  const base = `/o/${org!.segment}/projects/${projectId}`

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)

  // ── Fresh: ten stages; the BOQ stage is current and blocked.
  await openGuide(page, base)
  await expect(page.getByTestId('setup-guide-stepper').locator('> li')).toHaveCount(10)
  await expect(stage(page, 'boq')).toHaveAttribute('data-current', 'true')
  await expect(stage(page, 'boq')).toHaveAttribute('data-status', 'blocked')
  await expect(panel(page)).toHaveAttribute('data-stage', 'boq')
  await expect(page.getByTestId('setup-guide-blockers-NO_BOQ')).toBeVisible()
  await expectStripIsEngine(page, projectId)

  // The baseline stage refuses Continue: its gate blocks. Its badge says so
  // too, though the engine's baseline step is only waiting (a warning): a
  // stage never reads milder than its own gate.
  await stage(page, 'baseline').click()
  await expect(panel(page)).toHaveAttribute('data-stage', 'baseline')
  await expect(page.getByTestId('setup-guide-continue')).toHaveAttribute('data-mode', 'block')
  await expect(page.getByTestId('setup-guide-continue')).toBeDisabled()
  await expect(page.getByTestId('setup-guide-member-baseline_readiness')).toHaveAttribute('data-status', 'attention')
  await expect(stage(page, 'baseline')).toHaveAttribute('data-status', 'blocked')
  await expect(stage(page, 'baseline')).toContainText('Blocked')
  await expect(page.getByTestId('setup-guide-panel-status')).toHaveText('Blocked')

  // A warning stage offers Continue with warning, and Continue moves on.
  await stage(page, 'locations').click()
  await expect(stage(page, 'locations')).toHaveAttribute('data-status', 'attention')
  await expect(page.getByTestId('setup-guide-warnings-NO_LOCATIONS')).toBeVisible()
  const onward = page.getByTestId('setup-guide-continue')
  await expect(onward).toHaveAttribute('data-mode', 'warn')
  await expect(onward).toHaveText(/Continue with warning/)
  await onward.click()
  await expect(panel(page)).toHaveAttribute('data-stage', 'cost_codes')

  // ── The bill and the schedule, staged and under review.
  const { revisionId, items } = await withApi(async (client) => {
    const rows: Array<{ id: string; quantity: number }> = []
    for (const [code, description, quantity, rate] of [
      ['1.1', 'Excavation', 10, 100],
      ['1.2', 'Concrete', 20, 50],
    ] as const) {
      const created = await post(client, projectId, '/boq/items', { code, description, quantity, unit: 'm3', rate }, 201)
      rows.push({ id: (created as { item: { id: string } }).item.id, quantity })
    }
    const imported = await client.post(`${API}/projects/${projectId}/import/xer`, {
      headers: { authorization: `Bearer ${org!.adminToken}` },
      multipart: { file: { name: 'guided.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
    })
    const body = await imported.json()
    expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
    const revision = body.data.revisionId as string
    await post(client, projectId, `/schedule/revisions/${revision}/submit-review`, {})
    return { revisionId: revision, items: rows }
  })

  // ── A planning engineer may not approve: the guide says whom to ask.
  const plannerContext = await browser.newContext()
  try {
    const plannerPage = await plannerContext.newPage()
    await plannerPage.routeWebSocket(/socket\.io/, () => {})
    await signInForm(plannerPage, plannerEmail, LIVE_PASSWORD)
    await openGuide(plannerPage, base)
    await stage(plannerPage, 'validation').click()
    await expect(plannerPage.getByTestId('setup-guide-action-schedule-approve-ask')).toHaveText(
      'Ask Project Manager to approve the schedule revision.',
      { timeout: 30_000 },
    )
    await expect(plannerPage.getByTestId('setup-guide-action-schedule-approve')).toHaveCount(0)
  } finally {
    await plannerContext.close()
  }

  // ── Validation on a staged revision: the engine's schedule checks are the
  // ACTIVE activities' (none yet), not what this revision's approval judges,
  // so the guide shows none of them — no FAIL the approval below ignores —
  // and sends the PM to the revision's own review.
  await openGuide(page, base)
  await stage(page, 'validation').click()
  await expect(panel(page)).toHaveAttribute('data-stage', 'validation')
  await expect(page.getByTestId('setup-guide-checks-staged')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('setup-guide-schedule-checks')).toHaveCount(0)
  await expect(panel(page)).not.toContainText('FAIL')
  await expect(page.getByTestId('setup-guide-checks-open-revisions')).toBeEnabled()

  // ── The PM approves through the guide; the one readiness query refreshes.
  await page.getByTestId('setup-guide-action-schedule-approve').click()
  await expect(page.getByText('Schedule approved')).toBeVisible({ timeout: 30_000 })
  await expect(stage(page, 'validation')).toHaveAttribute('data-status', 'complete', { timeout: 30_000 })

  // ── Activated and fully mapped: Mapping PASS, the baseline gate ready.
  await withApi(async (client) => {
    await post(client, projectId, `/schedule/revisions/${revisionId}/activate`, { mappings: [] })
    const activities = await apiJson(client, 'get', `/projects/${projectId}/activities`, { token: org!.adminToken })
    expect(activities.status).toBe(200)
    type Row = { id: string; activityCode?: string | null; p6ActivityId?: string | null }
    const data = activities.body!.data as unknown as Row[] | { activities?: Row[]; items?: Row[] }
    const list: Row[] = Array.isArray(data) ? data : (data.activities ?? data.items ?? [])
    const byCode = (code: string) => list.find((row) => (row.activityCode || row.p6ActivityId) === code)!.id
    for (const [item, code] of [
      [items[0], 'S100'],
      [items[1], 'S200'],
    ] as const) {
      const allocation = await post(
        client,
        projectId,
        '/activity-boq-allocations',
        { boqItemId: item.id, activityId: byCode(code), quantity: item.quantity },
        201,
      )
      for (const step of ['submit', 'approve']) {
        await post(client, projectId, `/activity-boq-allocations/${allocation.id}/${step}`, {})
      }
    }
  })
  await openGuide(page, base)
  await expect(stage(page, 'mapping')).toHaveAttribute('data-status', 'complete', { timeout: 30_000 })
  // Active and approved: the checks are the ones the baseline reads, each in
  // the review panel's verdicts (PASS / Before baseline / Warning /
  // Blocking), never a bare FAIL.
  await stage(page, 'validation').click()
  await expect(page.getByTestId('setup-guide-checks-staged')).toHaveCount(0)
  const checks = page.getByTestId('setup-guide-schedule-checks').locator('> li')
  await expect(checks.first()).toBeVisible({ timeout: 30_000 })
  for (const verdict of await checks.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-verdict')))) {
    expect(['pass', 'before_baseline', 'warning', 'blocking']).toContain(verdict)
  }
  await expect(panel(page)).not.toContainText('FAIL')
  await stage(page, 'baseline').click()
  await expect(page.getByTestId('setup-guide-continue')).toHaveAttribute('data-mode', 'warn')
  await expect(page.getByTestId('setup-guide-continue')).toBeEnabled()
  await expect(page.getByTestId('setup-guide-action-baseline-lock')).toBeVisible()
  const mapped = await expectStripIsEngine(page, projectId)
  expect(mapped.find((entry) => entry.key === 'mapping')?.value).toBe('100%')

  // ── Value unmapped again: Mapping blocks, and Continue past the baseline is refused.
  await withApi((client) =>
    post(client, projectId, '/boq/items', { code: '1.3', description: 'Blinding', quantity: 5, unit: 'm2', rate: 40 }, 201),
  )
  await openGuide(page, base)
  await expect(stage(page, 'mapping')).toHaveAttribute('data-status', 'blocked', { timeout: 30_000 })
  await expect(stage(page, 'mapping')).toHaveAttribute('data-current', 'true')
  await stage(page, 'baseline').click()
  const refused = page.getByTestId('setup-guide-continue')
  await expect(refused).toHaveAttribute('data-mode', 'block')
  await expect(refused).toBeDisabled()
  await expect(page.getByTestId('setup-guide-gate-blockers-UNALLOCATED_BOQ')).toBeVisible()
  await expect(page.getByTestId('setup-guide-action-baseline-lock')).toHaveCount(0)
  const unmapped = await expectStripIsEngine(page, projectId)
  // The engine gives the unmapped quantity per unit; the strip shows it as given.
  expect(unmapped.find((entry) => entry.key === 'unmapped_quantity')?.value).toBe('5 m2')

  // Validation on the active, approved revision with value unmapped: the
  // failing check reads in the review panel's words, never a bare FAIL.
  await stage(page, 'validation').click()
  const failing = page.getByTestId('setup-guide-schedule-checks').locator('> li[data-passed="false"]')
  await expect(failing.first()).toBeVisible({ timeout: 30_000 })
  const VERDICT_WORDS: Record<string, string> = {
    before_baseline: 'Before baseline',
    warning: 'Warning',
    blocking: 'Blocking',
  }
  for (const row of await failing.all()) {
    const verdict = (await row.getAttribute('data-verdict')) ?? ''
    expect(Object.keys(VERDICT_WORDS)).toContain(verdict)
    await expect(row).toContainText(VERDICT_WORDS[verdict])
  }
  await expect(panel(page)).not.toContainText('FAIL')

  // ── Ready for Execution: progress is the warn gate (proceed with the
  // warning), official reporting a block gate the PM overrides with a reason
  // when locking a period — said, not offered here.
  await stage(page, 'execution').click()
  await expect(panel(page)).toHaveAttribute('data-stage', 'execution')
  const reporting = page.getByTestId('setup-guide-gate-reporting')
  await expect(reporting).toHaveAttribute('data-ready', 'false')
  await expect(reporting).toHaveAttribute('data-mode', 'block')
  await expect(reporting).toContainText('Blocked.')
  await expect(reporting).toContainText('Override: Project Manager, with a reason, when locking a period.')
  const progressGate = page.getByTestId('setup-guide-gate-progress')
  await expect(progressGate).toHaveAttribute('data-mode', 'warn')
  await expect(progressGate).toHaveAttribute('data-ready', 'false')
  const toProgress = progressGate.getByTestId('setup-guide-continue')
  await expect(toProgress).toHaveAttribute('data-mode', 'warn')
  await expect(toProgress).toHaveText(/Continue with warning/)
  await expect(toProgress).toBeEnabled()
  await toProgress.click()
  await expect(page).toHaveURL(new RegExp(`/o/${org!.segment}/projects/${projectId}/schedule/progress`), { timeout: 30_000 })
})

// ── Import previews ─────────────────────────────────────────────────────────

const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url))
const CONSTRUCTION_BOQ = fileURLToPath(new URL('../../docs/Construction_BOQ.xlsx', import.meta.url))
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Runs `body` (with prisma, orgId, projectId) in the backend, for one project
 * of a "LiveTest <uuid>" organisation only. Used read-only here: to count the
 * project's rows around a preview.
 */
const backendRead = (orgId: string, projectId: string, body: string) => {
  const script = `
require('./src/utils/data-script-guard').exitUnlessDataScriptAllowed('e2e:pc8-import-previews');
const { prisma } = require('./src/config/db');
const [orgId, projectId] = process.argv.slice(1);
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
  const result = spawnSync(process.execPath, ['-e', script, orgId, projectId], {
    cwd: backendDir,
    env: process.env,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`backend read (exit ${result.status}): ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout || 'null')
}

/** Every table an upload or an import writes to, counted for the one project. */
const countProjectRows = (orgId: string, projectId: string) =>
  backendRead(
    orgId,
    projectId,
    `const where = { projectId };
     return {
       boqItems: await prisma.boqItem.count({ where }),
       boqRevisions: await prisma.boqRevision.count({ where }),
       documents: await prisma.projectDocument.count({ where }),
       jobs: await prisma.backgroundJob.count({ where }),
       scheduleRevisions: await prisma.scheduleRevision.count({ where }),
       activities: await prisma.activity.count({ where }),
       wbsNodes: await prisma.wbsNode.count({ where }),
     };`,
  ) as Record<string, number>

/**
 * A three-activity programme workbook in the schedule parser's column
 * contract; A300 names a predecessor that is not in the file (one issue).
 */
const PROGRAMME_ROWS = [
  ['activity_code', 'name', 'wbs_code', 'duration_days', 'predecessors'],
  ['A100', 'Excavate', '1.1', 5, ''],
  ['A200', 'Pour', '1.1', 10, 'A100'],
  ['A300', 'Cure', '1.2', 3, 'A200, A999'],
]

const scheduleWorkbook = (rows: Array<Array<string | number>> = PROGRAMME_ROWS) => {
  const script = `
const XLSX = require('@e965/xlsx');
const rows = JSON.parse(process.argv[1]);
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Programme');
process.stdout.write(XLSX.write(book, { type: 'base64', bookType: 'xlsx' }));
`
  const result = spawnSync(process.execPath, ['-e', script, JSON.stringify(rows)], { cwd: backendDir, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`workbook (exit ${result.status}): ${result.stderr}`)
  return Buffer.from(result.stdout, 'base64')
}

const dryRun = async (client: APIRequestContext, projectId: string, route: string, name: string, buffer: Buffer) => {
  const response = await client.post(`${API}/projects/${projectId}${route}?dryRun=true`, {
    headers: { authorization: `Bearer ${org!.adminToken}` },
    multipart: { file: { name, mimeType: XLSX_MIME, buffer } },
  })
  const body = await response.json()
  expect(response.status(), `${route} dry run -> ${JSON.stringify(body?.error)}`).toBe(200)
  expect(body.data.dryRun).toBe(true)
  return body.data
}

/**
 * Holds back the answer to the first request matching `pattern` (the server
 * has already answered it) until `release()`; later requests pass straight
 * through.
 */
const holdFirstAnswer = async (page: Page, pattern: RegExp) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let held = false
  await page.route(pattern, async (route) => {
    if (held) return route.continue()
    held = true
    const response = await route.fetch()
    await gate
    await route.fulfill({ response })
  })
  return { isHeld: () => held, release, stop: () => page.unroute(pattern) }
}

/** Lets the page run whatever a just-finished response would set on screen. */
const settle = async (page: Page) => {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForTimeout(300)
}

test('the import previews show the dry run on screen and write nothing', async ({ page }) => {
  test.setTimeout(240_000)
  const boqFile = readFileSync(CONSTRUCTION_BOQ)
  const programme = scheduleWorkbook()
  // A second programme (A100 and A200 only), for the stale-preview case.
  const programmeB = scheduleWorkbook(PROGRAMME_ROWS.slice(0, 3))

  const { projectId, templateBytes, boqReport, scheduleReport } = await withApi(async (client) => {
    if (!org) org = await registerLiveOrg(client, 'pc8guide')
    const project = await createProject(client, org.adminToken, `Import previews ${Date.now()}`)
    // A bill already uploaded (the product's own template), so the preview
    // has something to compare against. The API runs with no job worker, so
    // the queued AI job never runs and never moves the counts below.
    const template = await client.get(`${API}/projects/${project}/boq/template`, {
      headers: { authorization: `Bearer ${org.adminToken}` },
    })
    expect(template.status()).toBe(200)
    const templateBody = await template.body()
    const uploaded = await client.post(`${API}/projects/${project}/boq/upload`, {
      headers: { authorization: `Bearer ${org.adminToken}` },
      multipart: { file: { name: 'boq-template.xlsx', mimeType: XLSX_MIME, buffer: templateBody } },
    })
    expect(uploaded.status(), JSON.stringify((await uploaded.json())?.error)).toBe(200)
    // The server's own dry runs of the two files: the figures the screen must show.
    return {
      projectId: project,
      templateBytes: templateBody,
      boqReport: await dryRun(client, project, '/boq/upload', 'Construction_BOQ.xlsx', boqFile),
      scheduleReport: await dryRun(client, project, '/import/xlsx', 'programme.xlsx', programme),
    }
  })
  const summary = boqReport.comparison.summary as Record<string, number>
  expect(summary.added + summary.updated + summary.unchanged + summary.removed).toBeGreaterThan(0)
  expect(scheduleReport.activityCount).toBe(3)
  expect(scheduleReport.issueCount).toBe(1)

  const before = countProjectRows(org!.orgId, projectId)
  expect(before.boqItems, 'the template bill is in place').toBeGreaterThan(0)
  const base = `/o/${org!.segment}/projects/${projectId}`

  // Any upload or import that is not a dry run would be a write.
  const writes: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (request.method() === 'POST' && /\/(boq\/upload|import\/[a-z0-9]+)(\?|$)/.test(url) && !/[?&]dryRun=true/.test(url)) {
      writes.push(url)
    }
  })
  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)

  // ── BOQ: choosing a workbook previews it against the current bill.
  await page.goto(`${base}/boq`)
  const boqInput = page.locator("input[type=file][accept='.xlsx,.xls']")
  await expect(boqInput).toHaveCount(1, { timeout: 45_000 })
  const boqPreviewed = page.waitForResponse((r) => r.url().includes('/boq/upload') && r.request().method() === 'POST')
  await boqInput.setInputFiles({ name: 'Construction_BOQ.xlsx', mimeType: XLSX_MIME, buffer: boqFile })
  expect((await boqPreviewed).status()).toBe(200)
  // Counted as soon as the preview has answered: nothing was written.
  expect(countProjectRows(org!.orgId, projectId), 'the BOQ preview wrote nothing').toEqual(before)

  const boqPanel = page.getByTestId('boq-upload-preview')
  await expect(boqPanel).toBeVisible()
  await expect(boqPanel).toHaveAttribute('data-mode', boqReport.mode)
  for (const key of ['added', 'updated', 'unchanged', 'removed', 'blocked']) {
    await expect(page.getByTestId(`boq-upload-preview-${key}`)).toHaveAttribute('data-value', String(summary[key]))
  }
  await expect(boqPanel).toContainText('nothing has been saved yet')
  await expect(page.getByTestId('boq-upload-preview-confirm')).toBeEnabled()
  await page.getByTestId('boq-upload-preview-cancel').click()
  await expect(boqPanel).toHaveCount(0)

  // ── A stale BOQ answer never replaces a later choice. While a preview runs
  // the zone takes no click or drop, but its input stays enabled: the first
  // file's answer is held until the second file's preview is on screen, then
  // let through — the panel stays on the second file.
  const boqHold = await holdFirstAnswer(page, /\/boq\/upload\?dryRun=true/)
  const isBoqAnswer = (r: PwResponse) =>
    r.url().includes('/boq/upload') && r.request().method() === 'POST'
  await boqInput.setInputFiles({ name: 'Construction_BOQ.xlsx', mimeType: XLSX_MIME, buffer: boqFile })
  await expect.poll(boqHold.isHeld).toBe(true)
  const laterAnswered = page.waitForResponse(isBoqAnswer)
  await boqInput.setInputFiles({ name: 'boq-later-choice.xlsx', mimeType: XLSX_MIME, buffer: templateBytes })
  expect((await laterAnswered).status()).toBe(200)
  await expect(boqPanel).toContainText('boq-later-choice.xlsx')
  const staleBoq = page.waitForResponse(isBoqAnswer)
  boqHold.release()
  await (await staleBoq).finished()
  await settle(page)
  await expect(boqPanel).toContainText('boq-later-choice.xlsx')
  await expect(boqPanel).not.toContainText('Construction_BOQ.xlsx')
  await boqHold.stop()
  await page.getByTestId('boq-upload-preview-cancel').click()
  await expect(boqPanel).toHaveCount(0)

  // ── Schedule: the Excel option, and Import waits for its preview.
  await page.goto(`${base}/schedule`)
  await page.getByRole('button', { name: /Import Schedule/ }).click({ timeout: 45_000 })
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Excel (.xlsx)').check()
  await dialog.locator('#import-schedule-file').setInputFiles({ name: 'programme.xlsx', mimeType: XLSX_MIME, buffer: programme })
  await expect(dialog.getByTestId('schedule-import-confirm')).toBeDisabled()
  const schedulePreviewed = page.waitForResponse((r) => r.url().includes('/import/xlsx') && r.request().method() === 'POST')
  await dialog.getByTestId('schedule-import-preview-run').click()
  const scheduleAnswer = await schedulePreviewed
  expect(countProjectRows(org!.orgId, projectId), 'the schedule preview wrote nothing').toEqual(before)
  expect(scheduleAnswer.status()).toBe(200)

  await expect(dialog.getByTestId('schedule-import-preview')).toBeVisible()
  for (const [key, value] of [
    ['activities', scheduleReport.activityCount],
    ['dependencies', scheduleReport.dependencyCount],
    ['wbs', scheduleReport.wbsNodeCount],
    ['critical', scheduleReport.criticalActivities],
    ['issues', scheduleReport.issueCount],
  ] as const) {
    await expect(dialog.getByTestId(`schedule-import-preview-${key}`)).toHaveAttribute('data-value', String(value))
  }
  await expect(dialog.getByText(/Predecessor "A999" of "A300"/)).toBeVisible()
  await expect(dialog.getByTestId('schedule-import-confirm')).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // ── A stale schedule answer never enables Import for another file. The
  // file input stays open while a preview runs: the first file's answer is
  // held until a second file is chosen, then let through.
  const scheduleHold = await holdFirstAnswer(page, /\/import\/xlsx\?dryRun=true/)
  const isScheduleAnswer = (r: PwResponse) =>
    r.url().includes('/import/xlsx') && r.request().method() === 'POST'
  await page.getByRole('button', { name: /Import Schedule/ }).click()
  const raced = page.getByRole('dialog')
  await raced.getByLabel('Excel (.xlsx)').check()
  const racedFile = raced.locator('#import-schedule-file')
  const racedPreview = raced.getByTestId('schedule-import-preview-run')
  await racedFile.setInputFiles({ name: 'programme.xlsx', mimeType: XLSX_MIME, buffer: programme })
  const staleSchedule = page.waitForResponse(isScheduleAnswer)
  await racedPreview.click()
  await expect.poll(scheduleHold.isHeld).toBe(true)
  await racedFile.setInputFiles({ name: 'programme-b.xlsx', mimeType: XLSX_MIME, buffer: programmeB })
  scheduleHold.release()
  expect((await staleSchedule).status()).toBe(200)
  // The first file's preview has settled (Preview is offered again) …
  await expect(racedPreview).toHaveText('Preview')
  await expect(racedPreview).toBeEnabled()
  await settle(page)
  // … and it neither shows nor enables Import for the second file.
  await expect(raced.getByTestId('schedule-import-preview')).toHaveCount(0)
  await expect(raced.getByTestId('schedule-import-confirm')).toBeDisabled()
  // The second file's own preview does.
  await scheduleHold.stop()
  const ownSchedule = page.waitForResponse(isScheduleAnswer)
  await racedPreview.click()
  expect((await ownSchedule).status()).toBe(200)
  await expect(raced.getByTestId('schedule-import-preview-activities')).toHaveAttribute('data-value', '2')
  await expect(raced.getByTestId('schedule-import-preview-issues')).toHaveAttribute('data-value', '0')
  await expect(raced.getByTestId('schedule-import-confirm')).toBeEnabled()
  await raced.getByRole('button', { name: 'Cancel' }).click()

  expect(writes, 'no upload or import was sent without dryRun').toEqual([])
  expect(countProjectRows(org!.orgId, projectId), 'still nothing written').toEqual(before)
})

// ── The three schedule states (owner decision R5-4) ─────────────────────────

const WAITING_FOR_ACTIVE_SCHEDULE = 'Waiting for active schedule'

const stepCard = (view: Page, key: string) => view.getByTestId(`uat-setup-step-${key}`)
/**
 * No step card of the Setup Readiness card counts the active schedule while
 * none is active: its chips carry no "Activities: 0", "Critical: 0" and the
 * like — counts of a schedule that is not there.
 */
const expectNoActiveScheduleChips = async (view: Page, who: string) => {
  for (const key of ['schedule_generation', 'engineer_assignment', 'progress_method_configuration', 'progress_readiness']) {
    const card = stepCard(view, key)
    await expect(card, `${who} / ${key}`).toBeVisible()
    for (const chip of ['Activities: ', 'Progress acts: ', 'Critical: ', 'Milestones: ', 'Assigned: ', 'Methods: ']) {
      await expect(card, `${who} / ${key}`).not.toContainText(chip)
    }
  }
}

test('the headline tells no schedule, a staged schedule and an active schedule apart — and never counts on a schedule that is not active', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const email = `live-pc8guide-r54-${crypto.randomUUID()}@octapm-live.test`
  const projectId = await withApi(async (client) => {
    if (!org) org = await registerLiveOrg(client, 'pc8guide')
    const project = await createProject(client, org.adminToken, `Headline states ${Date.now()}`)
    // A member whose own template sets the BOQ tool to none on this project.
    const memberId = await addMember(client, org, { name: 'No BOQ Planner R5-4', email, role: 'planning_eng' })
    const joined = await apiJson(client, 'post', `/projects/${project}/team`, {
      token: org.adminToken,
      data: { userId: memberId },
    })
    expect(joined.status, JSON.stringify(joined.body?.error)).toBeLessThan(300)
    const template = await apiJson(client, 'post', '/permissions/templates', {
      token: org.adminToken,
      data: { name: `No BOQ planner R5-4 ${Date.now()}`, baseRole: 'planning_eng', tools: [{ module: 'boq', level: 'none' }] },
    })
    expect(template.status, JSON.stringify(template.body?.error)).toBe(201)
    const applied = await apiJson(client, 'put', `/projects/${project}/team/${memberId}/permissions`, {
      token: org.adminToken,
      data: { templateId: template.body!.data!.id },
    })
    expect(applied.status, JSON.stringify(applied.body?.error)).toBe(200)
    // A priced row, unmapped throughout: on the active schedule both
    // critical activities have no approved allocation.
    await post(client, project, '/boq/items', { code: '1.1', description: 'Excavation', quantity: 12, unit: 'm3', rate: 100 }, 201)
    return project
  })
  const base = `/o/${org!.segment}/projects/${projectId}`

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)
  const memberContext = await browser.newContext()
  try {
    const memberPage = await memberContext.newPage()
    await memberPage.routeWebSocket(/socket\.io/, () => {})
    await signInForm(memberPage, email, LIVE_PASSWORD)

    const guideEntry = (view: Page, key: string) => view.getByTestId(`setup-guide-strip-${key}`)
    const cardEntry = (view: Page, key: string) => view.getByTestId(`uat-setup-headline-${key}`)
    const figure = (view: Page) => view.getByTestId('uat-controls-figure-critical')
    const open = async (view: Page) => {
      await openGuide(view, base)
      // The Setup Readiness card's own line, when this browser kept it collapsed.
      const expand = view.getByTestId('uat-setup-readiness-expand')
      if (await expand.isVisible().catch(() => false)) await expand.click()
      await expect(view.getByTestId('uat-setup-headline')).toBeVisible({ timeout: 30_000 })
    }
    /**
     * No active schedule: the critical entry waits, in the engine's words, on
     * the guide's strip, the readiness card's line and the controls tile —
     * no count, no zero, no done tone, and nothing said to be withheld.
     */
    const expectWaiting = async (view: Page, who: string) => {
      for (const shown of [guideEntry(view, 'critical_unmapped'), cardEntry(view, 'critical_unmapped')]) {
        await expect(shown, who).toContainText(`Critical unmapped activities${WAITING_FOR_ACTIVE_SCHEDULE}`)
        await expect(shown, who).toHaveAttribute('data-waiting', 'true')
        await expect(shown, who).toHaveAttribute('data-tone', 'neutral')
        await expect(shown, who).not.toContainText(/\d/)
      }
      await expect(guideEntry(view, 'critical_unmapped'), who).toHaveAttribute('data-value', WAITING_FOR_ACTIVE_SCHEDULE)
      await expect(guideEntry(view, 'critical_unmapped'), who).not.toHaveAttribute('data-withheld', 'true')
      await expect(view.getByTestId('setup-guide-strip-critical_unmapped-withheld'), who).toHaveCount(0)
      await expect(view.getByTestId('uat-setup-headline-critical_unmapped-withheld'), who).toHaveCount(0)
      await expect(view.getByTestId('uat-controls-figure-critical-value'), who).toHaveText('—')
      await expect(view.getByTestId('uat-controls-figure-critical-truth'), who).toHaveText('no figure')
      await expect(view.getByTestId('uat-controls-figure-critical-basis'), who).toContainText(WAITING_FOR_ACTIVE_SCHEDULE)
      await expect(figure(view), who).toHaveAttribute('data-tone', 'neutral')
      await expect(figure(view), who).not.toContainText(/\d/)
    }
    /** The member's mapping share stays withheld in every state. */
    const expectMappingWithheld = async (view: Page) => {
      await expect(guideEntry(view, 'mapping')).toHaveAttribute('data-withheld', 'true')
      await expect(guideEntry(view, 'mapping')).toHaveAttribute('data-value', '—')
      await expect(view.getByTestId('setup-guide-strip-mapping-withheld')).toHaveText('(Mapping details unavailable to you)')
      await expect(guideEntry(view, 'unmapped_quantity')).toHaveCount(0)
      await expect(guideEntry(view, 'unmapped_boq')).toHaveCount(0)
    }
    const views: Array<[string, Page]> = [
      ['pm', page],
      ['member', memberPage],
    ]

    // ── No schedule: "No schedule yet", not a failed import.
    for (const [who, view] of views) {
      await open(view)
      for (const shown of [guideEntry(view, 'schedule_imported'), cardEntry(view, 'schedule_imported')]) {
        await expect(shown, who).toContainText('ScheduleNo schedule yet')
        await expect(shown, who).toHaveAttribute('data-tone', 'blocked')
      }
      await expectWaiting(view, `no schedule / ${who}`)
      await expectNoActiveScheduleChips(view, `no schedule / ${who}`)
      await expect(stepCard(view, 'schedule_generation'), who).not.toContainText('Revision activities')
    }
    await expectMappingWithheld(memberPage)
    await expectStripIsEngine(page, projectId)
    await expect(page.getByTestId('uat-controls-schedule')).toHaveText('No schedule')

    // ── Imported and staged — a draft, then under review, then approved:
    // the import reads complete at each, and nothing is counted.
    const revisionId = await withApi(async (client) => {
      const imported = await client.post(`${API}/projects/${projectId}/import/xer`, {
        headers: { authorization: `Bearer ${org!.adminToken}` },
        multipart: { file: { name: 'states.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
      })
      const body = await imported.json()
      expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
      return body.data.revisionId as string
    })
    const expectStaged = async (label: string) => {
      for (const [who, view] of views) {
        await open(view)
        for (const shown of [guideEntry(view, 'schedule_imported'), cardEntry(view, 'schedule_imported')]) {
          await expect(shown, `${label} / ${who}`).toContainText('Schedule importedPASS (waiting for activation)')
          await expect(shown, `${label} / ${who}`).toHaveAttribute('data-tone', 'info')
        }
        await expectWaiting(view, `${label} / ${who}`)
        // The tile names the import, not "0 activities".
        const tile = view.getByTestId('uat-controls-schedule-tile')
        await expect(tile, `${label} / ${who}`).toContainText('Imported · XER Import · waiting for activation')
        await expect(tile, `${label} / ${who}`).not.toContainText('0 activities')
        // The step cards under the headline: the revision's two activities,
        // named as the revision's — never "Activities: 0 · Critical: 0".
        await expectNoActiveScheduleChips(view, `${label} / ${who}`)
        await expect(stepCard(view, 'schedule_generation'), `${label} / ${who}`).toContainText('Revision activities: 2')
        // And the Progress method tile does not say there are no activities
        // beside an import that has two.
        const methods = view.getByTestId('uat-controls-methods')
        await expect(methods, `${label} / ${who}`).toContainText(WAITING_FOR_ACTIVE_SCHEDULE)
        await expect(methods, `${label} / ${who}`).not.toContainText('No activities')
      }
      await expectMappingWithheld(memberPage)
      await expectStripIsEngine(page, projectId)
    }
    await expectStaged('staged draft')
    await withApi(async (client) => {
      for (const step of ['submit-review', 'approve']) {
        await post(client, projectId, `/schedule/revisions/${revisionId}/${step}`, {})
      }
    })
    await expectStaged('staged approved')

    // ── Active: the PM reads the count the engine assessed; the member is
    // told the mapping's details are withheld — no count, not "waiting".
    await withApi((client) => post(client, projectId, `/schedule/revisions/${revisionId}/activate`, { mappings: [] }))
    const engine = await engineHeadline(projectId)
    expect(engine.find((entry) => entry.key === 'critical_unmapped')?.value).toBe('2')

    await open(page)
    for (const shown of [guideEntry(page, 'schedule_imported'), cardEntry(page, 'schedule_imported')]) {
      await expect(shown).toContainText('Schedule importedPASS')
      await expect(shown).not.toContainText('waiting for activation')
      await expect(shown).toHaveAttribute('data-tone', 'done')
    }
    for (const shown of [guideEntry(page, 'critical_unmapped'), cardEntry(page, 'critical_unmapped')]) {
      await expect(shown).toContainText('Critical unmapped activities2')
      await expect(shown).toHaveAttribute('data-tone', 'review')
      await expect(shown).not.toHaveAttribute('data-waiting', 'true')
    }
    await expect(page.getByTestId('uat-controls-figure-critical-value')).toHaveText('2')
    await expect(page.getByTestId('uat-controls-figure-critical-truth')).toHaveText('derived')
    await expect(page.getByTestId('uat-controls-figure-critical-basis')).toContainText('2 without an approved allocation')
    await expectStripIsEngine(page, projectId)
    // In force: the cards count the active schedule, and the tile its activities.
    for (const [who, view] of views) {
      if (view !== page) await open(view)
      const card = stepCard(view, 'schedule_generation')
      for (const chip of ['Activities: 2', 'Progress acts: 2', 'Critical: 2']) await expect(card, who).toContainText(chip)
      await expect(card, who).not.toContainText('Revision activities')
      await expect(stepCard(view, 'engineer_assignment'), who).toContainText('Progress acts: 2')
      const tile = view.getByTestId('uat-controls-schedule-tile')
      await expect(tile, who).toContainText('2 activities · XER Import')
      await expect(tile, who).not.toContainText('Imported')
      await expect(view.getByTestId('uat-controls-methods'), who).not.toContainText(WAITING_FOR_ACTIVE_SCHEDULE)
    }

    await open(memberPage)
    for (const shown of [guideEntry(memberPage, 'schedule_imported'), cardEntry(memberPage, 'schedule_imported')]) {
      await expect(shown).toContainText('Schedule importedPASS')
      await expect(shown).not.toContainText('waiting for activation')
    }
    for (const [shown, reason] of [
      [guideEntry(memberPage, 'critical_unmapped'), memberPage.getByTestId('setup-guide-strip-critical_unmapped-withheld')],
      [cardEntry(memberPage, 'critical_unmapped'), memberPage.getByTestId('uat-setup-headline-critical_unmapped-withheld')],
    ] as const) {
      await expect(shown).toContainText('Critical unmapped activities—')
      await expect(shown).toHaveAttribute('data-tone', 'neutral')
      await expect(shown).not.toHaveAttribute('data-waiting', 'true')
      await expect(shown).not.toContainText(/\d/)
      await expect(shown).not.toContainText(WAITING_FOR_ACTIVE_SCHEDULE)
      await expect(reason).toHaveText('(Mapping details unavailable to you)')
    }
    await expect(guideEntry(memberPage, 'critical_unmapped')).toHaveAttribute('data-withheld', 'true')
    // The critical activities are the schedule's and the member's; how many
    // of them are unmapped is not.
    await expect(memberPage.getByTestId('uat-controls-figure-critical-value')).toHaveText('2')
    await expect(memberPage.getByTestId('uat-controls-figure-critical-basis')).toContainText('Mapping details unavailable to you')
    await expect(figure(memberPage)).not.toContainText('without an approved allocation')
    await expectMappingWithheld(memberPage)
  } finally {
    await memberContext.close()
  }
})

test('a rejected staged revision is not waiting for activation: the Schedule tile says what the headline says', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const { projectId, revisionId } = await withApi(async (client) => {
    if (!org) org = await registerLiveOrg(client, 'pc8guide')
    const project = await createProject(client, org.adminToken, `Rejected staged ${Date.now()}`)
    await post(client, project, '/boq/items', { code: '1.1', description: 'Excavation', quantity: 12, unit: 'm3', rate: 100 }, 201)
    const imported = await client.post(`${API}/projects/${project}/import/xer`, {
      headers: { authorization: `Bearer ${org.adminToken}` },
      multipart: { file: { name: 'rejected.xer', mimeType: 'application/octet-stream', buffer: Buffer.from(XER) } },
    })
    const body = await imported.json()
    expect(imported.status(), JSON.stringify(body?.error)).toBe(201)
    return { projectId: project, revisionId: body.data.revisionId as string }
  })
  const base = `/o/${org!.segment}/projects/${projectId}`
  const tile = page.getByTestId('uat-controls-schedule-tile')
  const open = async () => {
    await openGuide(page, base)
    const expand = page.getByTestId('uat-setup-readiness-expand')
    if (await expand.isVisible().catch(() => false)) await expand.click()
    await expect(page.getByTestId('uat-setup-headline')).toBeVisible({ timeout: 30_000 })
  }
  type Engine = {
    summary: { scheduleState: string; headline: Array<{ key: string; value: string; tone: string; raw: unknown }> }
    steps: Array<{ key: string; blockers: Array<{ code: string }>; counts: Record<string, unknown> }>
    context: { currentRevision: { status: string } | null }
  }
  const engine = () =>
    withApi(async (client) => {
      const readiness = await apiJson(client, 'get', `/projects/${projectId}/setup-readiness`, { token: org!.adminToken })
      expect(readiness.status).toBe(200)
      return readiness.body!.data as unknown as Engine
    })

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, org!.adminEmail)

  // Under review: the engine passes the import, and the tile says it waits.
  await withApi((client) => post(client, projectId, `/schedule/revisions/${revisionId}/submit-review`, {}))
  await open()
  await expect(page.getByTestId('uat-controls-schedule')).toHaveText('Under review')
  await expect(tile).toContainText('Imported · XER Import · waiting for activation')

  // Rejected: still staged, and the engine fails the import.
  await withApi((client) =>
    post(client, projectId, `/schedule/revisions/${revisionId}/reject`, { reason: 'Logic incomplete: resubmit with the pour sequence.' })
  )
  const answer = await engine()
  expect(answer.summary.scheduleState).toBe('staged')
  expect(answer.context.currentRevision?.status).toBe('rejected')
  expect(answer.summary.headline.find((entry) => entry.key === 'schedule_imported')).toMatchObject({
    value: 'FAIL',
    tone: 'blocked',
    raw: false,
  })
  const scheduleStep = answer.steps.find((step) => step.key === 'schedule_generation')!
  expect(scheduleStep.blockers.map((blocker) => blocker.code)).toEqual(['SCHEDULE_REJECTED'])
  expect(scheduleStep.counts).toEqual({ revisionId, revisionStatus: 'rejected', revisionActivities: 2 })

  await open()
  for (const shown of [page.getByTestId('setup-guide-strip-schedule_imported'), page.getByTestId('uat-setup-headline-schedule_imported')]) {
    await expect(shown).toContainText('Schedule importedFAIL')
    await expect(shown).toHaveAttribute('data-tone', 'blocked')
  }
  // The tile agrees with the headline beside it: rejected, to be resubmitted
  // — not "waiting for activation", and no count of activities.
  await expect(page.getByTestId('uat-controls-schedule')).toHaveText('Rejected')
  await expect(tile).toContainText('Imported · XER Import · rejected — needs resubmission')
  await expect(tile).not.toContainText('waiting for activation')
  await expect(tile).not.toContainText('0 activities')
  // Nothing is assessed on a rejected revision either.
  await expect(page.getByTestId('uat-controls-figure-critical-value')).toHaveText('—')
  await expect(page.getByTestId('uat-setup-headline-critical_unmapped')).toContainText(WAITING_FOR_ACTIVE_SCHEDULE)
  await expectNoActiveScheduleChips(page, 'rejected')
  await expect(stepCard(page, 'schedule_generation')).toContainText('Revision activities: 2')
  await expect(stepCard(page, 'schedule_generation')).toContainText('Status: rejected')
  await expectStripIsEngine(page, projectId)
})

// ── The withheld view ───────────────────────────────────────────────────────

test('a member without BOQ access sees the guide with the mapping withheld: "—" with the reason, never zero', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const email = `live-pc8guide-noboq-${crypto.randomUUID()}@octapm-live.test`
  const { projectId, memberToken } = await withApi(async (client) => {
    if (!org) org = await registerLiveOrg(client, 'pc8guide')
    const project = await createProject(client, org.adminToken, `Guide withheld ${Date.now()}`)
    const memberId = await addMember(client, org, { name: 'No BOQ Planner', email, role: 'planning_eng' })
    const joined = await apiJson(client, 'post', `/projects/${project}/team`, {
      token: org.adminToken,
      data: { userId: memberId },
    })
    expect(joined.status, JSON.stringify(joined.body?.error)).toBeLessThan(300)
    // The member's own template sets the BOQ tool to none on this project.
    const template = await apiJson(client, 'post', '/permissions/templates', {
      token: org.adminToken,
      data: { name: `No BOQ planner ${Date.now()}`, baseRole: 'planning_eng', tools: [{ module: 'boq', level: 'none' }] },
    })
    expect(template.status, JSON.stringify(template.body?.error)).toBe(201)
    const applied = await apiJson(client, 'put', `/projects/${project}/team/${memberId}/permissions`, {
      token: org.adminToken,
      data: { templateId: template.body!.data!.id },
    })
    expect(applied.status, JSON.stringify(applied.body?.error)).toBe(200)
    // A priced, unmapped row: the PM's strip has a mapping share and an
    // unmapped quantity and value to show — the member's must not.
    await post(client, project, '/boq/items', { code: '1.1', description: 'Excavation', quantity: 12, unit: 'm3', rate: 100 }, 201)
    return { projectId: project, memberToken: await workspaceToken(client, email, org.orgId) }
  })
  const base = `/o/${org!.segment}/projects/${projectId}`

  // The PM's engine answer carries the figures (the test is not vacuous).
  const pmHeadline = await engineHeadline(projectId)
  expect(pmHeadline.find((entry) => entry.key === 'unmapped_quantity')?.value).toBe('12 m3')
  expect(pmHeadline.find((entry) => entry.key === 'unmapped_boq')).toBeTruthy()
  // The member's answer withholds them: the mapping share is "—" and
  // withheld, the bill's quantity and value are left out. This project has
  // no schedule, so the critical-unmapped entry is waiting for one (R5-4) —
  // for the member as for the PM, with no count; its withholding on an
  // active schedule is the three-states test above.
  const memberHeadline = await withApi(async (client) => {
    const readiness = await apiJson(client, 'get', `/projects/${projectId}/setup-readiness`, { token: memberToken })
    expect(readiness.status).toBe(200)
    return (readiness.body!.data as {
      summary: { headline: Array<Headline & { withheld?: boolean; reason?: string; waiting?: boolean }> }
    }).summary.headline
  })
  const withheldKeys = ['mapping']
  for (const key of withheldKeys) {
    const entry = memberHeadline.find((row) => row.key === key)
    expect(entry, key).toMatchObject({ value: '—', withheld: true })
  }
  const memberCritical = memberHeadline.find((row) => row.key === 'critical_unmapped')
  expect(memberCritical).toMatchObject({ value: WAITING_FOR_ACTIVE_SCHEDULE, waiting: true })
  expect(memberCritical?.withheld).toBeUndefined()
  expect(memberHeadline.find((row) => row.key === 'unmapped_quantity')).toBeUndefined()
  expect(memberHeadline.find((row) => row.key === 'unmapped_boq')).toBeUndefined()

  await page.routeWebSocket(/socket\.io/, () => {})
  await signInForm(page, email, LIVE_PASSWORD)
  await openGuide(page, base)

  const strip = page.getByTestId('setup-guide-strip')
  await expect(strip.locator('> li')).toHaveCount(memberHeadline.length)
  for (const key of withheldKeys) {
    const shown = page.getByTestId(`setup-guide-strip-${key}`)
    await expect(shown).toHaveAttribute('data-withheld', 'true')
    await expect(shown).toHaveAttribute('data-value', '—')
    await expect(page.getByTestId(`setup-guide-strip-${key}-withheld`)).toHaveText('(Mapping details unavailable to you)')
  }
  await expect(page.getByTestId('setup-guide-strip-critical_unmapped')).toHaveAttribute('data-waiting', 'true')
  await expect(page.getByTestId('setup-guide-strip-critical_unmapped')).toHaveAttribute(
    'data-value',
    WAITING_FOR_ACTIVE_SCHEDULE,
  )
  await expect(page.getByTestId('setup-guide-strip-unmapped_quantity')).toHaveCount(0)
  await expect(page.getByTestId('setup-guide-strip-unmapped_boq')).toHaveCount(0)
  // Nothing withheld reads as zero.
  for (const value of await strip.locator('> li').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-value')))) {
    expect(value).not.toBe('0')
    expect(value).not.toBe('0%')
  }

  // The Mapping stage says it is withheld, and shows no figure.
  await stage(page, 'mapping').click()
  await expect(panel(page)).toHaveAttribute('data-stage', 'mapping')
  await expect(panel(page)).toContainText('Mapping details unavailable to you')
  await expect(panel(page)).not.toContainText('0%')
})
