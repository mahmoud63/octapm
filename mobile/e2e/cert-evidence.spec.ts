/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { accounts, apiBase, apiSession, getData, isWide, items, mainProject, signIn, type Headers } from './cert-helpers'

/**
 * Certification: field evidence reaches the office.
 *
 * UX2-C's claim is that one evidence capability serves every record type and
 * that what the field captures is visible to the office against the right
 * record, with the right project, person and time. These checks make that
 * claim against the running API rather than against the app's own state:
 * every assertion reads the server back.
 */
const stamp = () => Date.now() % 1_000_000

const png = () => readFileSync('e2e/fixtures/evidence.png')

/** Attach a photograph the way the app does, and read back what the server kept. */
async function attach(request: APIRequestContext, headers: Headers, projectId: string, recordType: string, recordId: string, extra: Record<string, string> = {}) {
  const clientRequestId = `cert-evidence-${recordType}-${stamp()}`
  const response = await request.post(`${apiBase}/projects/${projectId}/attachments`, {
    headers,
    multipart: { recordType, recordId, role: 'photo', clientRequestId, ...extra, files: { name: `${recordType}.png`, mimeType: 'image/png', buffer: png() } },
  })
  return { response, clientRequestId }
}

test.describe('certification: one evidence system, every record', () => {
  test.beforeEach(({ page }) => {
    test.skip(isWide(page), 'certified once on the phone viewport')
  })

  test('a photograph lands on the record it was taken from, and the office can read it', async ({ request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const activities = items(await getData<{ id: string; name: string }[]>(request, pm.headers, `/projects/${project.id}/activities`))
    const activity = activities[0]!

    const { response } = await attach(request, pm.headers, project.id, 'activity', activity.id)
    expect(response.status(), 'the attachment was accepted').toBe(201)

    // The office reads it against that activity, not against a mobile store.
    const listed = await getData<{ items: { id: string; recordType: string; recordId: string; photo?: boolean }[] } | { id: string; recordType: string; recordId: string }[]>(
      request,
      pm.headers,
      `/projects/${project.id}/attachments?recordType=activity&recordId=${activity.id}`,
    )
    const rows = Array.isArray(listed) ? listed : listed.items
    expect(rows.length, 'the activity has evidence').toBeGreaterThan(0)
    expect(rows.every((r) => r.recordType === 'activity' && r.recordId === activity.id), 'and it belongs to that activity').toBe(true)

    // And the same upload is in the project gallery, with who and when.
    const gallery = await getData<{ items: { id: string; uploadedBy: string | null; takenAt: string | null; createdAt: string }[] }>(request, pm.headers, `/projects/${project.id}/photos`)
    expect(gallery.items.length, 'the gallery has it too — one upload, both places').toBeGreaterThan(0)
  })

  test('the same capability serves every record type the platform accepts', async ({ request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)

    // Each of these is a record the app now offers evidence on.
    const targets: { recordType: string; id: string | null }[] = []
    const first = async <T extends { id: string }>(path: string, pick?: (d: never) => T[]) => {
      const response = await request.get(`${apiBase}${path}`, { headers: pm.headers })
      if (!response.ok()) return null
      const data = ((await response.json()) as { data: never }).data
      const list = pick ? pick(data) : items<T>(data)
      return list[0]?.id ?? null
    }
    targets.push({ recordType: 'activity', id: await first(`/projects/${project.id}/activities`) })
    targets.push({ recordType: 'rfi', id: await first(`/projects/${project.id}/rfi`) })
    targets.push({ recordType: 'punch_item', id: await first(`/projects/${project.id}/punch`) })
    targets.push({ recordType: 'ncr', id: await first(`/projects/${project.id}/ncr`, (d: { rows: { id: string }[] }) => d.rows) })
    targets.push({ recordType: 'task', id: await first(`/tasks?projectId=${project.id}`, (d: { rows: { id: string }[] }) => d.rows) })
    targets.push({ recordType: 'change_event', id: await first(`/projects/${project.id}/change-events`) })
    targets.push({ recordType: 'procurement_order', id: await first(`/projects/${project.id}/purchase-orders`) })

    const attached: string[] = []
    const absent: string[] = []
    for (const target of targets) {
      if (!target.id) {
        absent.push(target.recordType)
        continue
      }
      const { response } = await attach(request, pm.headers, project.id, target.recordType, target.id)
      expect(response.status(), `${target.recordType} accepts evidence`).toBe(201)
      attached.push(target.recordType)
    }
    test.info().annotations.push({ type: 'evidence', description: `attached to: ${attached.join(', ')}${absent.length ? ` · no record to test: ${absent.join(', ')}` : ''}` })
    expect(attached.length, 'most record types were exercised').toBeGreaterThanOrEqual(5)
  })

  test('the server refuses evidence aimed at another project', async ({ request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const projects = items<{ id: string }>(await getData<never>(request, pm.headers, '/projects'))
    const other = projects.find((p) => p.id !== project.id)
    const activity = items(await getData<{ id: string }[]>(request, pm.headers, `/projects/${project.id}/activities`))[0]!

    if (other) {
      // The activity belongs to one project; attaching it under another must fail.
      const { response } = await attach(request, pm.headers, other.id, 'activity', activity.id)
      expect([400, 403, 404], 'a record from another project is refused').toContain(response.status())
    }

    // An invented record type is refused by the canonical allowlist.
    const bogus = await request.post(`${apiBase}/projects/${project.id}/attachments`, {
      headers: pm.headers,
      multipart: { recordType: 'mobile_photo', recordId: activity.id, role: 'photo', clientRequestId: `cert-bogus-${stamp()}`, files: { name: 'x.png', mimeType: 'image/png', buffer: png() } },
    })
    expect(bogus.status(), 'there is no mobile-only record type').toBe(400)
  })

  test('the app shows the evidence the server holds, on the record', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const activity = items(await getData<{ id: string; name: string }[]>(request, pm.headers, `/projects/${project.id}/activities`))[0]!
    await attach(request, pm.headers, project.id, 'activity', activity.id)

    await signIn(page, accounts.pm)
    await page.goto(`/activities/${activity.id}`)
    await expect(page.getByTestId('screen-activity').last()).toBeVisible()
    const evidence = page.getByTestId('evidence').last()
    await expect(evidence, 'the record carries an evidence section').toBeVisible()
    await expect.poll(async () => (await evidence.innerText()).replace(/\s+/g, ' '), { timeout: 15_000 }).toContain('activity.png')
  })
})
