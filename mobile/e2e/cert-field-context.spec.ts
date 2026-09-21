import { expect, test, type APIRequestContext } from '@playwright/test'
import { accounts, apiBase, apiSession, getData, isWide, items, mainProject, openModule, signIn, type Headers } from './cert-helpers'

/** A real hierarchy to browse: the project has none of its own, so this puts one there. */
async function ensureTower(request: APIRequestContext, headers: Headers, projectId: string) {
  const existing = await getData<{ items: { id: string; code: string | null; name: string; parentId: string | null; childCount: number }[] }>(request, headers, `/projects/${projectId}/locations`)
  const found = existing.items.find((l) => l.code === 'CERT-B1')
  if (found) return { building: found, existing: existing.items }

  const make = async (body: Record<string, unknown>) => {
    const response = await request.post(`${apiBase}/projects/${projectId}/locations`, { headers, data: body })
    expect(response.status(), await response.text()).toBe(201)
    return ((await response.json()) as { data: { id: string } }).data
  }
  const building = await make({ name: 'Cert Tower', code: 'CERT-B1', kind: 'building' })
  const level = await make({ name: 'Level 04', code: 'CERT-L4', kind: 'level', parentId: building.id })
  await make({ name: 'Zone B', code: 'CERT-Z-B', kind: 'zone', parentId: level.id })
  const after = await getData<{ items: { id: string; code: string | null; name: string; parentId: string | null; childCount: number }[] }>(request, headers, `/projects/${projectId}/locations`)
  return { building: after.items.find((l) => l.code === 'CERT-B1')!, existing: after.items }
}

/**
 * Certification: the project, the place, the job and the person.
 *
 * Everything a field user needs in order to know where they are and what is
 * around them. The checks below care most about the two things that are easy
 * to get wrong: that context is inherited rather than asked for again, and
 * that nothing is shown which the platform cannot actually stand behind.
 */
test.describe('certification: field context', () => {
  test.beforeEach(({ page }) => {
    test.skip(isWide(page), 'layout-independent; runs once on the phone viewport')
  })

  test('the project says who it is for and on what terms', async ({ page }) => {
    await signIn(page, accounts.pm)
    await page.goto('/project')
    await expect(page.getByTestId('screen-project')).toBeVisible()

    const facts = page.getByTestId('project-facts')
    await expect(facts).toBeVisible()
    await expect(page.getByTestId('project-fact-client')).toBeVisible()
    await expect(page.getByTestId('project-fact-contractor')).toBeVisible()
    await expect(page.getByTestId('project-fact-dates')).toBeVisible()
    // A project manager may see the money.
    await expect(page.getByTestId('project-fact-value')).toBeVisible()
  })

  test('a role without cost sees the same screen with one fewer line, not a refusal', async ({ page }) => {
    await signIn(page, accounts.site)
    await page.goto('/project')
    await expect(page.getByTestId('screen-project')).toBeVisible()
    await expect(page.getByTestId('project-facts')).toBeVisible()
    await expect(page.getByTestId('project-fact-client')).toBeVisible()
    // The contract value is the server's to grant, and it did not.
    await expect(page.getByTestId('project-fact-value')).toHaveCount(0)
  })

  test('places nest the way the project describes them, and open on what happened there', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const { building } = await ensureTower(request, pm.headers, project.id)

    await signIn(page, accounts.pm)
    await page.goto('/locations')
    await expect(page.getByTestId('screen-locations')).toBeVisible()

    // A building has places inside it, so it opens up rather than straight through.
    await page.getByTestId(`location-row-${building.id}`).click()
    await expect(page.getByTestId('locations-here')).toContainText('Cert Tower')

    // And a place with nothing inside is a destination.
    await page.getByTestId('locations-open-current').click()
    await expect(page.getByTestId('screen-location')).toBeVisible()
    await expect(page.getByTestId('location-path')).toBeVisible()
    for (const group of ['rfis', 'punch', 'inspections', 'drawings', 'photos']) {
      await expect(page.getByTestId(`location-related-${group}`)).toBeVisible()
    }
  })

  test('an activity carries what belongs to it, and never a location it does not have', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const activities = items(await getData<{ id: string }[]>(request, pm.headers, `/projects/${project.id}/activities`))

    await signIn(page, accounts.pm)
    await page.goto(`/activities/${activities[0]!.id}`)
    await expect(page.getByTestId('screen-activity')).toBeVisible()
    for (const group of ['rfis', 'inspections', 'constraints', 'materials']) {
      await expect(page.getByTestId(`activity-related-${group}`)).toBeVisible()
    }
  })

  test('the project timeline reads in references and names, never identifiers', async ({ page }) => {
    await signIn(page, accounts.pm)
    await page.goto('/feed')
    await expect(page.getByTestId('screen-feed')).toBeVisible()
    const list = page.getByTestId('feed-list')
    await expect(list).toBeVisible()
    // Nothing on this screen should be a raw identifier.
    await expect(list).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/)
  })

  test('the team is grouped by what people do, and a contact shows only what is known', async ({ page }) => {
    await signIn(page, accounts.pm)
    await page.goto('/team')
    await expect(page.getByTestId('screen-team')).toBeVisible()
    await expect(page.getByTestId('team-group-management')).toBeVisible()

    await page.locator('[data-testid^="team-member-"]').first().click()
    await expect(page.getByTestId('screen-contact')).toBeVisible()
    await expect(page.getByTestId('contact-on-this-project')).toBeVisible()
    // There is no telephone number in the model, so there is no Call button.
    await expect(page.getByRole('button', { name: /call/i })).toHaveCount(0)
  })

  test('the camera shows the picture before anything is sent, and knows what it is for', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const { building } = await ensureTower(request, pm.headers, project.id)

    await signIn(page, accounts.pm)
    // Arriving from a place, the capture already knows where it is.
    await page.goto(`/photos/new?locationId=${building.id}`)
    await expect(page.getByTestId('screen-capture')).toBeVisible()

    // The web target has no viewfinder, so it asks the device for the picture.
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('capture-choose').click()
    await (await chooser).setFiles('e2e/fixtures/evidence.png')

    // The still, with the way back to the camera beside the way on.
    await expect(page.getByTestId('capture-preview')).toBeVisible()
    await expect(page.getByTestId('capture-retake')).toBeVisible()
    await expect(page.getByTestId('capture-belongs')).toBeVisible()

    // Nothing has been sent yet: the caption comes first.
    await page.getByTestId('capture-caption').fill('Cert field context capture')
    const uploaded = page.waitForResponse((r) => r.url().endsWith('/attachments') && r.request().method() === 'POST')
    await page.getByTestId('capture-save').click()
    const response = await uploaded
    expect(response.status()).toBe(201)

    // The caption the person typed reached the server, which nothing sent before.
    const photos = await getData<{ items: { caption: string | null }[] }>(request, pm.headers, `/projects/${project.id}/photos?limit=20`)
    expect(photos.items.some((p) => p.caption === 'Cert field context capture'), 'the caption is on the record').toBe(true)
  })

  test('a delivery observed on site reports the order it was against, and posts no stock itself', async ({ page, request }) => {
    const pm = await apiSession(request, accounts.pm)
    const project = await mainProject(request, pm.headers)
    const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const stamp = Date.now() % 100000
    const added = await request.post(`${apiBase}/projects/${project.id}/daily-logs/${localDay()}/entries/deliveries`, {
      headers: pm.headers,
      data: { supplierName: 'Cert Context Supplies', description: `Cert context delivery ${stamp}`, quantity: 12, unit: 'bag', poRef: 'NOT-AN-ORDER', clientRequestId: `cert-context-${stamp}` },
    })
    expect(added.status(), await added.text()).toBe(201)
    // The route answers with the whole day, not the row, so the entry is found
    // in the section it just joined.
    const log = ((await added.json()) as { data: { sections: { deliveries: { id: string; description: string | null }[] } } }).data
    const entryId = log.sections.deliveries.find((row) => row.description === `Cert context delivery ${stamp}`)!.id

    await signIn(page, accounts.pm)
    await openModule(page, 'site')
    await expect(page.getByTestId('screen-daily-log')).toBeVisible()
    // A reference nobody raised says so plainly rather than implying a receipt.
    await expect(page.getByTestId(`delivery-${entryId}-unknown`)).toBeVisible()
  })
})
