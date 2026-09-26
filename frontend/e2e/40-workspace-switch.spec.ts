import { test, expect, type Page } from '@playwright/test'
import { apiClient } from './support'
import {
  addMember,
  apiJson,
  createProject,
  dropLiveOrg,
  escapeRegExp,
  headerWorkspace,
  makeCompanyAdmin,
  registerLiveOrg,
  signInForm,
  workspaceToken,
  type LiveOrg,
} from './support-workspaces'

/**
 * Workspace switching on the web (ENT-4, workspace switching doc §8).
 *
 * One identity in two workspaces — a PM in A, a QS in B (the §51 persona).
 * A owns "Alpha Project", B owns "Beta Project" (the persona is on its team).
 *
 * What must hold:
 *   - signing in shows the picker; picking A opens `/o/{A}` with A's name
 *     in the header and only A's projects;
 *   - switching to B from the header clears the project context and shows
 *     only B's projects, under `/o/{B}`, with the role B gave the person;
 *   - a write queued offline in A is not sent while in B, and is sent once
 *     the person is back in A;
 *   - browser Back after a switch returns to A — and never shows B's data.
 *
 * The organisations are registered through the product's sign-up and
 * dropped afterwards; nothing here touches the E2E organisation.
 */

const persona = {
  email: `live-persona-${crypto.randomUUID()}@octapm-live.test`,
  name: 'Persona Switcher',
  id: '',
}
let orgA: LiveOrg
let orgB: LiveOrg
let alphaId = ''
let betaId = ''

const hrefOf = (page: Page) => new URL(page.url()).pathname

/**
 * The app's own outbox module instance, from inside the page. The dev server
 * may serve a module it has hot-updated under a `?t=` query; importing the
 * bare path then gives a second, empty instance, so the URL the app itself
 * loaded is used.
 */
const outboxInPage = async (page: Page) =>
  page.evaluateHandle(async () => {
    const loaded = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/lib/offline/outbox.ts'))
    const url = loaded ? new URL(loaded).pathname + new URL(loaded).search : '/src/lib/offline/outbox.ts'
    return (await import(/* @vite-ignore */ url)) as typeof import('../src/lib/offline/outbox')
  })

test.beforeAll(async () => {
  const client = await apiClient()
  try {
    orgA = await registerLiveOrg(client, 'a')
    orgB = await registerLiveOrg(client, 'b')
    // A QS in B who administers it (so B's projects are visible without a
    // team assignment), a PM in A, who sees every project there.
    persona.id = await addMember(client, orgB, { ...persona, role: 'qs' })
    const again = await addMember(client, orgA, { ...persona, role: 'pm' })
    expect(again).toBe(persona.id)
    await makeCompanyAdmin(client, orgB, persona.id)
    alphaId = await createProject(client, orgA.adminToken, 'Alpha Project')
    betaId = await createProject(client, orgB.adminToken, 'Beta Project')
  } finally {
    await client.dispose()
  }
})

test.afterAll(async () => {
  if (orgA) dropLiveOrg(orgA.orgId)
  if (orgB) dropLiveOrg(orgB.orgId)
})

test('sign in shows the picker, a switch shows only the other workspace, Back returns, the outbox stays put', async ({
  page,
}) => {
  // ── Sign in: two workspaces, so a picker; A is chosen ──────────────────
  await signInForm(page, persona.email)
  const picker = page.getByTestId('uat-sign-in-workspaces')
  await expect(picker).toBeVisible({ timeout: 15_000 })
  await expect(picker.getByText(orgA.name)).toBeVisible()
  await expect(picker.getByText(orgB.name)).toBeVisible()
  await page.getByTestId(`uat-sign-in-workspace-${orgA.segment}`).click()

  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(orgA.segment)}(/|$|\\?)`), { timeout: 30_000 })
  await expect(page.getByText('Workspace Control')).toBeVisible({ timeout: 30_000 })
  await expect(headerWorkspace(page)).toHaveText(orgA.name)

  // A's projects, and only A's.
  await page.goto(`/o/${orgA.segment}/projects`)
  await expect(page.getByText('Alpha Project')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Beta Project')).toHaveCount(0)

  // ── A write queued in A: the network refuses it, so it waits ───────────
  let patchAttempts = 0
  const patchRoute = /\/api\/v1\/projects\/[0-9a-f-]{36}$/
  await page.route(patchRoute, (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    patchAttempts += 1
    return route.abort('connectionfailed')
  })
  const queuedName = `Alpha Project (queued ${Date.now()})`
  const outbox = await outboxInPage(page)
  await page.evaluate(
    async ([outbox, { projectId, name }]) => {
      await outbox.enqueue({
        projectId,
        kind: 'project',
        label: 'Rename project',
        method: 'PATCH',
        url: `/projects/${projectId}`,
        body: { name },
        clientRequestId: outbox.newClientRequestId('e2e'),
      })
      await outbox.syncOutbox()
    },
    [outbox, { projectId: alphaId, name: queuedName }] as const,
  )
  expect(patchAttempts).toBe(1)
  const ownerInA = await page.evaluate(async (outbox) => {
    const state = outbox.getOutboxState()
    return { owner: state.ownerKey, items: state.items.map((item) => [item.status, item.ownerKey]) }
  }, outbox)
  expect(ownerInA.owner).toBe(`${persona.id}:${orgA.orgId}`)
  expect(ownerInA.items).toEqual([['queued', `${persona.id}:${orgA.orgId}`]])

  // ── Switch to B from the header ────────────────────────────────────────
  await page.getByTestId('workspace-switcher').click()
  await page.getByTestId(`workspace-option-${orgB.segment}`).click()
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(orgB.segment)}(/|$|\\?)`), { timeout: 30_000 })
  await expect(headerWorkspace(page)).toHaveText(orgB.name, { timeout: 30_000 })
  // The role is B's: a QS here, a PM in A.
  await page.getByTestId('workspace-switcher').click()
  await expect(page.getByTestId(`workspace-option-${orgB.segment}`)).toContainText('QS · Admin')
  await expect(page.getByTestId(`workspace-option-${orgA.segment}`)).toContainText('Project Manager')
  await page.keyboard.press('Escape')

  // B's projects, and only B's — the previous workspace's list is gone. An
  // in-app navigation, not a reload: a reload would empty the cache anyway,
  // and what is under test is that the switch itself emptied it.
  await page.locator('header nav a[href="/projects"]').first().click({ noWaitAfter: true })
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(orgB.segment)}/projects`), { timeout: 30_000 })
  await expect(page.getByText('Beta Project')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Alpha Project')).toHaveCount(0)

  // The item queued in A is locked here: replay is asked for and sends nothing.
  const inB = await page.evaluate(async (outbox) => {
    await outbox.syncOutbox()
    const state = outbox.getOutboxState()
    return { owner: state.ownerKey, items: state.items.length, locked: state.locked.map((item) => item.status) }
  }, outbox)
  expect(inB.owner).toBe(`${persona.id}:${orgB.orgId}`)
  expect(inB.items).toBe(0)
  expect(inB.locked).toEqual(['queued'])
  expect(patchAttempts).toBe(1)
  const client = await apiClient()
  try {
    const token = await workspaceToken(client, orgA.adminEmail, orgA.orgId)
    const alpha = await apiJson(client, 'get', `/projects/${alphaId}`, { token })
    expect((alpha.body!.data as { name: string }).name).toBe('Alpha Project')
  } finally {
    await client.dispose()
  }

  // ── Back: the previous workspace, its own data, never B's ──────────────
  // History: /o/A/projects → (switch) /o/B → /o/B/projects. Two steps back
  // lands on A's project list; the URL drives the switch back.
  await page.unroute(patchRoute)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(orgB.segment)}(/|$|\\?)`), { timeout: 30_000 })
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/o/${escapeRegExp(orgA.segment)}/projects`), { timeout: 30_000 })
  await expect(headerWorkspace(page)).toHaveText(orgA.name, { timeout: 30_000 })
  await expect(page.getByText(/Alpha Project/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Beta Project')).toHaveCount(0)

  // Back in A the queued write goes out under A's token.
  const afterReturn = await page.evaluate(async (outbox) => {
    await outbox.syncOutbox()
    const state = outbox.getOutboxState()
    return { owner: state.ownerKey, items: state.items.length, locked: state.locked.length }
  }, outbox)
  expect(afterReturn).toEqual({ owner: `${persona.id}:${orgA.orgId}`, items: 0, locked: 0 })
  const verify = await apiClient()
  try {
    const token = await workspaceToken(verify, orgA.adminEmail, orgA.orgId)
    await expect
      .poll(async () => ((await apiJson(verify, 'get', `/projects/${alphaId}`, { token })).body!.data as { name: string }).name, {
        timeout: 15_000,
      })
      .toBe(queuedName)
  } finally {
    await verify.dispose()
  }
  expect(hrefOf(page)).toContain(`/o/${orgA.segment}`)
})
