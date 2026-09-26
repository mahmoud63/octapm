/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test, type Page, type Request } from '@playwright/test'
import { currentProjectId } from './cert-helpers'

/**
 * Certification: workspace switching on the field app (ENT-5, workspace
 * switching doc §1-§5, acceptance §9-§12). One identity that belongs to
 * two throwaway LiveTest workspaces, each with a project the person is on:
 *
 *   - a sign-in with several workspaces shows the chooser and signs
 *     nothing in until one is chosen;
 *   - the switch sheet moves the session, and the project chosen in A is
 *     gone from the device once B is active;
 *   - an item queued in A is held while B is active — never sent under B's
 *     token, shown under A's name — and sent once when A is active again;
 *   - a link into the other workspace offers the switch and never makes
 *     it silently; a link into a workspace the person is not in ends in
 *     one sentence.
 *
 * The persona is made by backend/scripts/e2e/workspace-switch-fixture.js
 * before the suite and dropped after it; nothing here reads or writes the
 * demo or E2E organisations. Runs against a web export of this checkout
 * pointed at an API of its own (MOBILE_WEB_URL, MOBILE_API_URL).
 */
interface Workspace {
  orgId: string
  slug: string
  name: string
  membershipId: string
  projectId: string
  projectName: string
}
interface Persona {
  email: string
  password: string
  userId: string
  a: Workspace
  b: Workspace
}

const backend = path.resolve(__dirname, '..', '..', 'backend')
const fixture = (...args: string[]) =>
  execFileSync(process.execPath, [path.join('scripts', 'e2e', 'workspace-switch-fixture.js'), ...args], { cwd: backend, encoding: 'utf8', timeout: 5 * 60_000, stdio: ['ignore', 'pipe', 'inherit'] })

let persona: Persona

test.beforeAll(() => {
  const lines = fixture('create').trim().split(/\r?\n/)
  persona = JSON.parse(lines[lines.length - 1]!) as Persona
})

test.afterAll(() => {
  // B holds only a membership row for the person; A holds their User row, so B goes first.
  if (persona) fixture('drop', persona.b.orgId, persona.a.orgId)
})

/** Sign in and take the chooser to the given workspace; lands on Home. */
async function signInInto(page: Page, workspace: Workspace) {
  await page.goto('/sign-in')
  await page.getByTestId('sign-in-email').fill(persona.email)
  await page.getByTestId('sign-in-password').fill(persona.password)
  await page.getByTestId('sign-in-submit').click()
  await expect(page.getByTestId('screen-choose-workspace')).toBeVisible()
  await page.getByTestId(`choose-workspace-${workspace.orgId}`).click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
}

/** Open the sheet from More and switch to the given workspace; lands on Home. */
async function switchTo(page: Page, workspace: Workspace) {
  await page.goto('/more')
  await expect(page.getByTestId('screen-more')).toBeVisible()
  await page.getByTestId('screen-more').getByTestId('workspace-switch').click()
  await expect(page.getByTestId('workspace-sheet')).toBeVisible()
  await page.getByTestId(`workspace-option-${workspace.orgId}`).click()
  await expect(page.getByTestId('workspace-sheet')).toBeHidden()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  await expect(page.getByTestId('screen-home').getByText(/Choose a project/).first()).toBeVisible()
}

/** The workspace the More tab names after a reload: it must come back named, not as a placeholder. */
const expectWorkspaceOnMore = async (page: Page, name: string) => {
  await page.goto('/more')
  await expect(page.getByTestId('screen-more')).toBeVisible()
  await expect(page.getByTestId('screen-more').getByTestId('workspace-name')).toHaveText(name)
}

/** The claims of a bearer token, read without verifying it: the server has already verified it by answering. */
const claimsOf = (authorization: string | undefined): { sub?: string; orgId?: string; mid?: string | null } =>
  authorization ? (JSON.parse(Buffer.from(authorization.replace(/^Bearer /, '').split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: string; orgId?: string; mid?: string | null }) : {}

const isSessionRequest = (request: Request, orgId: string) => request.method() === 'POST' && request.url().includes(`/auth/workspaces/${orgId}/session`)

test.describe('certification: workspace switching', () => {
  test('a sign-in with several workspaces shows the chooser, with each workspace’s kind and role, and signs nothing in until one is chosen', async ({ page }) => {
    const sessions: Request[] = []
    page.on('request', (request) => {
      if (isSessionRequest(request, persona.a.orgId) || isSessionRequest(request, persona.b.orgId)) sessions.push(request)
    })
    await page.goto('/sign-in')
    await page.getByTestId('sign-in-email').fill(persona.email)
    await page.getByTestId('sign-in-password').fill(persona.password)
    await page.getByTestId('sign-in-submit').click()
    await expect(page.getByTestId('screen-choose-workspace')).toBeVisible()
    for (const workspace of [persona.a, persona.b]) {
      const row = page.getByTestId(`choose-workspace-${workspace.orgId}`)
      await expect(row).toContainText(workspace.name)
      await expect(row).toContainText('Company')
      await expect(row).toContainText('Project Manager')
    }
    // Nothing is signed in yet: no workspace session was requested, no refresh token is on the device.
    expect(sessions).toHaveLength(0)
    expect(await page.evaluate(() => sessionStorage.getItem('octapm.session.refresh'))).toBeNull()

    await page.getByTestId(`choose-workspace-${persona.b.orgId}`).click()
    await expect(page.getByTestId('screen-home')).toBeVisible()
    expect(sessions.map((r) => r.url().includes(persona.b.orgId))).toEqual([true])
    expect(sessions[0]!.headers()['x-octapm-client']).toBe('mobile')
    expect(await page.evaluate(() => sessionStorage.getItem('octapm.session.refresh'))).toBeTruthy()
    await expectWorkspaceOnMore(page, persona.b.name)
    // B's project is the one on offer; A's is not listed here.
    await page.goto('/')
    await expect(page.getByTestId(`choose-${persona.b.projectId}`)).toBeVisible()
    await expect(page.getByTestId(`choose-${persona.a.projectId}`)).toHaveCount(0)
  })

  test('the switch sheet moves the session to the other workspace, and the project chosen in A is cleared from the screen and the device', async ({ page }) => {
    await signInInto(page, persona.a)
    await page.getByTestId(`choose-${persona.a.projectId}`).click()
    await expect(page.getByTestId('project-switch')).toContainText(persona.a.projectName)
    expect(await currentProjectId(page)).toContain(persona.a.projectId)

    await page.goto('/more')
    await page.getByTestId('screen-more').getByTestId('workspace-switch').click()
    const sheet = page.getByTestId('workspace-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId(`workspace-option-${persona.a.orgId}`).getByTestId('workspace-active')).toBeVisible()
    await expect(sheet.getByTestId(`workspace-option-${persona.b.orgId}`).getByTestId('workspace-active')).toHaveCount(0)
    // Creating a workspace is not offered on the app (ENT-6 builds it on the web).
    await expect(sheet.getByText(/Create workspace/i)).toHaveCount(0)
    await sheet.getByTestId(`workspace-option-${persona.b.orgId}`).click()
    await expect(sheet).toBeHidden()

    await expect(page.getByTestId('screen-home')).toBeVisible()
    await expect(page.getByTestId('screen-home').getByText(/Choose a project/).first()).toBeVisible()
    await expect(page.getByTestId('project-switch')).not.toContainText(persona.a.projectName)
    await expect(page.getByTestId(`choose-${persona.b.projectId}`)).toBeVisible()
    await expect(page.getByTestId(`choose-${persona.a.projectId}`)).toHaveCount(0)
    expect(await currentProjectId(page)).toBeNull()
    await expectWorkspaceOnMore(page, persona.b.name)
    // B's project is chosen on its own. The read cache B writes is B's own
    // document, and nothing A read is in it: A's records are never drawn in B.
    await page.goto('/')
    await page.getByTestId(`choose-${persona.b.projectId}`).click()
    await expect(page.getByTestId('project-switch')).toContainText(persona.b.projectName)
    const documentOf = (orgId: string) => page.evaluate((key) => localStorage.getItem(key), `octapm.offline.cache:v1:${persona.userId}:${orgId}`)
    await expect.poll(() => documentOf(persona.b.orgId), { timeout: 20_000 }).toContain(persona.b.projectId)
    const inB = (await documentOf(persona.b.orgId)) ?? ''
    expect(inB).not.toContain(persona.a.projectId)
    expect(inB).not.toContain(persona.a.projectName)
  })

  test('an item queued in A is held while B is active — never sent under B — and is sent once when A is active again', async ({ page }) => {
    test.setTimeout(120_000)
    const posts: { at: number; token: string | undefined }[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/punch$/.test(request.url())) posts.push({ at: Date.now(), token: request.headers()['authorization'] })
    })
    await signInInto(page, persona.a)
    await page.getByTestId(`choose-${persona.a.projectId}`).click()
    await expect(page.getByTestId('project-switch')).toContainText(persona.a.projectName)

    // The server cannot be reached for this one write: the app queues it and keeps retrying with back-off.
    await page.route(/\/punch$/, (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()))
    await page.goto('/quality/punch/new')
    await expect(page.getByTestId('screen-punch-new')).toBeVisible()
    const title = `Live switch tile ${Date.now() % 100000}`
    await page.getByTestId('punch-title').fill(title)
    await page.getByTestId('punch-raise').click()
    await expect(page.getByTestId('screen-outbox')).toBeVisible()
    const item = page.locator('[data-testid^="outbox-item-"]').first()
    await expect(item).toContainText(title)
    await expect(item).toContainText('Waiting')
    const attemptsInA = posts.length
    expect(attemptsInA).toBeGreaterThan(0)

    await switchTo(page, persona.b)
    const switchedAt = Date.now()
    // A project of B's is chosen while in B; it is B's context, and it must not outlive the switch back.
    await page.getByTestId(`choose-${persona.b.projectId}`).click()
    await expect(page.getByTestId('project-switch')).toContainText(persona.b.projectName)
    // The server is reachable again — for B. A's item is due, and must not go.
    await page.unroute(/\/punch$/)
    await page.goto('/outbox')
    await expect(page.getByTestId('screen-outbox')).toBeVisible()
    const held = page.getByTestId(`outbox-elsewhere-${persona.a.orgId}`)
    await expect(held).toBeVisible()
    await expect(held).toContainText(title)
    await expect(held).toContainText(`Waiting in ${persona.a.name}`)
    await expect(held).toContainText('Held')
    await expect(page.getByTestId('outbox-send-now')).toHaveCount(0)
    // Past every back-off the item could have been on (5 s, 10 s), and after
    // the signal drops and returns — which drains the queue at once — nothing
    // was sent under B.
    await page.waitForTimeout(12_000)
    await page.context().setOffline(true)
    await page.waitForTimeout(3_000)
    await page.context().setOffline(false)
    await page.waitForTimeout(4_000)
    expect(posts.filter((p) => p.at >= switchedAt)).toEqual([])
    expect(posts.filter((p) => claimsOf(p.token).orgId !== persona.a.orgId)).toEqual([])
    // The queue on the device still says the item is A's and waiting.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('octapm.offline.outbox:v1:items') ?? '[]') as { orgId: string; projectId: string; status: string; summary: string; clientRequestId: string }[])
    const queued = stored.find((i) => i.summary === title)
    expect(queued).toMatchObject({ orgId: persona.a.orgId, projectId: persona.a.projectId, status: 'waiting' })
    expect(queued?.clientRequestId).toMatch(/[0-9a-f-]{20,}/)

    // Back in A, from the outbox itself: the item goes once, under A's token, and the office has it.
    const posted = page.waitForResponse((r) => /\/punch$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 })
    await held.getByTestId(`outbox-switch-${persona.a.orgId}`).click()
    const response = await posted
    expect(response.status()).toBe(201)
    expect((response.request().postDataJSON() as { title: string; clientRequestId: string }).clientRequestId).toBe(queued!.clientRequestId)
    await expect(page.locator('[data-testid^="outbox-item-"]').filter({ hasText: title })).toContainText('Sent')
    // The switch itself dropped B's project — here, on the outbox, where no Home screen re-checks the list.
    await expect(page.getByTestId('screen-outbox')).toBeVisible()
    expect(await currentProjectId(page)).toBeNull()
    expect(posts.filter((p) => p.at >= switchedAt)).toHaveLength(1)
    // Sent under A's session, never B's: the access token that went with it is bound to A's membership.
    expect(claimsOf(response.request().headers()['authorization'])).toMatchObject({ sub: persona.userId, orgId: persona.a.orgId, mid: persona.a.membershipId })
    // Every attempt made for the item, in A before the switch and after it, carried A's token.
    expect(posts.map((p) => claimsOf(p.token).orgId)).toEqual(posts.map(() => persona.a.orgId))
    await expectWorkspaceOnMore(page, persona.a.name)
    // Once: the server holds one punch item with this title in A's project.
    const login = await page.request.post(`${process.env.MOBILE_API_URL ?? 'http://localhost:5000/api/v1'}/auth/login`, { headers: { 'x-octapm-client': 'mobile' }, data: { email: persona.email, password: persona.password } })
    expect(login.status()).toBe(200)
    const identityToken = ((await login.json()) as { data: { identityToken: string } }).data.identityToken
    const session = await page.request.post(`${process.env.MOBILE_API_URL ?? 'http://localhost:5000/api/v1'}/auth/workspaces/${persona.a.orgId}/session`, { headers: { authorization: `Bearer ${identityToken}`, 'x-octapm-client': 'mobile' } })
    expect(session.status()).toBe(200)
    const access = ((await session.json()) as { data: { tokens: { accessToken: string } } }).data.tokens.accessToken
    const list = await page.request.get(`${process.env.MOBILE_API_URL ?? 'http://localhost:5000/api/v1'}/projects/${persona.a.projectId}/punch`, { headers: { authorization: `Bearer ${access}`, 'x-octapm-client': 'mobile' } })
    expect(list.status()).toBe(200)
    const body = (await list.json()) as { data: { items?: { title: string }[] } | { title: string }[] }
    const rows = Array.isArray(body.data) ? body.data : (body.data.items ?? [])
    expect(rows.filter((r) => r.title === title)).toHaveLength(1)
  })

  test('a link into the other workspace offers the switch and never makes it silently; a link into a workspace the person is not in ends in one sentence', async ({ page }) => {
    const sessions: Request[] = []
    page.on('request', (request) => {
      if (isSessionRequest(request, persona.b.orgId)) sessions.push(request)
    })
    await signInInto(page, persona.a)
    await page.getByTestId(`choose-${persona.a.projectId}`).click()
    await expect(page.getByTestId('project-switch')).toContainText(persona.a.projectName)

    // The web platform's own link into B's project, as a notification or an email carries it.
    await page.goto(`/open?link=${encodeURIComponent(`/o/${persona.b.slug}/projects/${persona.b.projectId}/rfi`)}`)
    const offer = page.getByTestId('open-workspace-offer')
    await expect(offer).toBeVisible()
    await expect(offer).toContainText(`This link belongs to ${persona.b.name}`)
    await expect(offer).toContainText(`You are working in ${persona.a.name}`)
    // Nothing has been switched behind the person: no session for B was requested, A's project is still theirs.
    expect(sessions).toHaveLength(0)
    expect(await currentProjectId(page)).toContain(persona.a.projectId)

    await page.getByTestId('open-switch-workspace').click()
    await expect(page.getByTestId('screen-rfis')).toBeVisible()
    expect(sessions).toHaveLength(1)
    expect(await currentProjectId(page)).toContain(persona.b.projectId)
    await expectWorkspaceOnMore(page, persona.b.name)
    await page.goto('/')
    await expect(page.getByTestId('project-switch')).toContainText(persona.b.projectName)

    // A workspace the person is not in: one sentence, no switch, still B.
    await page.goto(`/open?link=${encodeURIComponent(`/o/not-their-workspace-${Date.now()}/projects/${persona.a.projectId}/rfi`)}`)
    await expect(page.getByText('You are not in that workspace')).toBeVisible()
    await expect(page.getByTestId('open-workspace-offer')).toHaveCount(0)
    expect(sessions).toHaveLength(1)
    await expectWorkspaceOnMore(page, persona.b.name)

    // Staying is a choice too: the offer for A, declined, leaves B as it is.
    await page.goto(`/open?to=${encodeURIComponent('/rfi')}&orgId=${persona.a.orgId}&orgSlug=${persona.a.slug}`)
    await expect(page.getByTestId('open-workspace-offer')).toBeVisible()
    await page.getByTestId('open-stay').click()
    await expect(page.getByTestId('screen-home')).toBeVisible()
    await expectWorkspaceOnMore(page, persona.b.name)
  })
})
