import { test, expect, type Page } from '@playwright/test'
import { apiClient } from './support'
import {
  apiJson,
  createProject,
  dropLiveOrg,
  escapeRegExp,
  headerWorkspace,
  LIVE_PASSWORD,
  registerLiveOrg,
  signInForm,
  type LiveOrg,
} from './support-workspaces'

/**
 * Personal workspaces and conversion on the web (ENT-6).
 *
 * One identity registers through the product's sign-up and so owns a
 * PERSONAL workspace with one project. What must hold:
 *   - the workspace dashboard is the personal variant: titled as the
 *     person's, with the personal note, the team sections (workflow
 *     queues, project watchlist) hidden, and a Personal badge in the header;
 *   - the switcher offers "Create workspace"; creating one lands in the new
 *     company workspace, which the switcher now lists beside the personal one;
 *   - the owner converts the personal workspace from its settings, reading
 *     the consequences first; the header then says Company, the dashboard is
 *     the company variant, and a second member can be seated where the
 *     personal workspace refused one.
 *
 * The workspaces are registered through sign-up and dropped afterwards;
 * nothing here touches the E2E organisation.
 */

let personal: LiveOrg
let createdOrgId = ''
const companyName = `LiveTest ${crypto.randomUUID()}`

const openSwitcher = async (page: Page) => {
  await page.getByTestId('workspace-switcher').click()
  await expect(page.getByTestId('workspace-create')).toBeVisible()
}

test.beforeAll(async () => {
  const client = await apiClient()
  try {
    personal = await registerLiveOrg(client, 'solo', { personal: true })
    await createProject(client, personal.adminToken, 'Solo Project')
    // The personal workspace refuses a second member before anything is written.
    const refused = await apiJson(client, 'post', '/users', {
      token: personal.adminToken,
      data: { name: 'Colleague', email: `live-colleague-${crypto.randomUUID()}@octapm-live.test`, password: LIVE_PASSWORD, role: 'qs' },
    })
    expect(refused.status).toBe(409)
    expect(refused.body?.error?.code).toBe('PERSONAL_WORKSPACE_CONVERT_REQUIRED')
  } catch (error) {
    if (personal) dropLiveOrg(personal.orgId)
    throw error
  } finally {
    await client.dispose()
  }
})

test.afterAll(async () => {
  if (createdOrgId) dropLiveOrg(createdOrgId)
  if (personal) dropLiveOrg(personal.orgId)
})

test('the dashboard is the personal variant, the switcher creates a company workspace, and the owner converts', async ({
  page,
}) => {
  // ── Sign in: one workspace, so straight to its dashboard ───────────────
  await signInForm(page, personal.adminEmail)
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(personal.segment)}(/|$|\\?)`), { timeout: 30_000 })
  await expect(headerWorkspace(page)).toHaveText(personal.name)
  await expect(page.getByTestId('workspace-switcher').getByTestId('workspace-kind')).toHaveText('Personal')

  const dashboard = page.getByTestId('workspace-dashboard')
  await expect(dashboard).toBeVisible({ timeout: 30_000 })
  await expect(dashboard).toHaveAttribute('data-workspace-kind', 'personal')
  await expect(page.getByTestId('dashboard-title')).toHaveText('My Workspace')
  await expect(page.getByTestId('dashboard-personal-note')).toBeVisible()
  await expect(page.getByTestId('dashboard-personal-convert')).toBeVisible()
  await expect(page.getByTestId('dashboard-workflow-queues')).toHaveCount(0)
  await expect(page.getByTestId('dashboard-project-watchlist')).toHaveCount(0)
  // The person's own sections are still there.
  await expect(page.getByRole('heading', { name: 'Official KPIs' })).toBeVisible()

  // ── Create a company workspace from the switcher ───────────────────────
  await openSwitcher(page)
  await expect(page.getByTestId('workspace-convert-link')).toBeVisible()
  await page.getByTestId('workspace-create').click()
  const dialog = page.getByTestId('create-workspace-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('create-workspace-name').fill(companyName)
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/organisations') && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await dialog.getByTestId('create-workspace-submit').click()
  const response = await created
  expect(response.status()).toBe(201)
  const body = (await response.json()) as { data: { organisation: { id: string; slug: string | null; kind: string } } }
  createdOrgId = body.data.organisation.id
  expect(body.data.organisation.kind).toBe('company')
  const companySegment = body.data.organisation.slug ?? createdOrgId

  // The app lands in the new workspace: the guard switched the session there.
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(companySegment)}(/|$|\\?)`), { timeout: 30_000 })
  await expect(headerWorkspace(page)).toHaveText(companyName)
  await expect(page.getByTestId('workspace-switcher').getByTestId('workspace-kind')).toHaveText('Company')
  await expect(page.getByTestId('dashboard-title')).toHaveText('Workspace Control', { timeout: 30_000 })
  await openSwitcher(page)
  await expect(page.getByTestId(`workspace-option-${companySegment}`)).toBeVisible()
  await expect(page.getByTestId(`workspace-option-${personal.segment}`)).toBeVisible()
  // A company workspace has nothing to convert.
  await expect(page.getByTestId('workspace-convert-link')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // ── Back in the personal workspace: convert it ─────────────────────────
  await page.goto(`/o/${personal.segment}/company/workspace`)
  await expect(headerWorkspace(page)).toHaveText(personal.name, { timeout: 30_000 })
  const settings = page.getByTestId('workspace-settings')
  await expect(settings).toBeVisible({ timeout: 30_000 })
  await expect(settings.getByTestId('workspace-kind')).toHaveText('Personal')
  const convertCard = page.getByTestId('workspace-convert-card')
  await expect(convertCard).toContainText('Nothing moves, is copied or re-keyed')
  await expect(convertCard).toContainText('You stay the owner')
  await page.getByTestId('workspace-convert').click()
  const confirm = page.getByTestId('workspace-convert-confirm')
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText('cannot be turned back')
  const converted = page.waitForResponse(
    (r) => r.url().endsWith(`/organisations/${personal.orgId}/convert`) && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await confirm.getByTestId('workspace-convert-submit').click()
  expect((await converted).status()).toBe(200)

  // The header and the settings say Company; the convert card is gone.
  await expect(page.getByTestId('workspace-switcher').getByTestId('workspace-kind')).toHaveText('Company', { timeout: 15_000 })
  await expect(settings.getByTestId('workspace-kind')).toHaveText('Company')
  await expect(page.getByTestId('workspace-convert-card')).toHaveCount(0)
  await openSwitcher(page)
  await expect(page.getByTestId('workspace-convert-link')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // The dashboard is now the company variant, with the team sections.
  await page.goto(`/o/${personal.segment}`)
  await expect(page.getByTestId('workspace-dashboard')).toHaveAttribute('data-workspace-kind', 'company', { timeout: 30_000 })
  await expect(page.getByTestId('dashboard-title')).toHaveText('Workspace Control')
  await expect(page.getByTestId('dashboard-personal-note')).toHaveCount(0)
  await expect(page.getByTestId('dashboard-workflow-queues')).toBeVisible()
  await expect(page.getByTestId('dashboard-project-watchlist')).toBeVisible()

  // And the server agrees: a second member is seated where it was refused.
  const client = await apiClient()
  try {
    const seated = await apiJson(client, 'post', '/users', {
      token: personal.adminToken,
      data: { name: 'Colleague', email: `live-colleague-${crypto.randomUUID()}@octapm-live.test`, password: LIVE_PASSWORD, role: 'qs' },
    })
    expect(seated.status, JSON.stringify(seated.body?.error)).toBe(201)
    const me = await apiJson(client, 'get', '/auth/me', { token: personal.adminToken })
    const memberships = me.body!.data!.memberships as Array<{ orgId: string; kind: string }>
    expect(memberships.find((entry) => entry.orgId === personal.orgId)?.kind).toBe('company')
    expect(memberships.find((entry) => entry.orgId === createdOrgId)?.kind).toBe('company')
  } finally {
    await client.dispose()
  }
})
