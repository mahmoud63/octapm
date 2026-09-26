import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { __resetOfflineForTests } from '@/offline'
import { __resetOutboxForTests, enqueue, hydrateOutbox, registerSender, useOutbox } from '@/offline/outbox'
import { cacheKey } from '@/offline/persist'
import { __useStoreForTests, memoryStore, type KeyValueStore } from '@/offline/storage'
import { useProjectStore } from '@/projects/store'
import { envelope, failure, fakeServer, type Call } from '@/testing/fake-server'
import { STORAGE_KEYS, secureStorage } from './secure-storage'
import { enterWorkspace, refreshSession, rememberedWorkspace, signIn, switchWorkspace } from './session'
import { useAuthStore, type WorkspaceMembership } from './store'

/**
 * The session across workspaces, against a fake server that answers as the
 * real one does for a native client: the login with several workspaces
 * (membership doc §6), the workspace session, and the switch sequence
 * (workspace switching doc §3) — what is cleared, what is kept, in what
 * order, and that a failed switch leaves everything as it was.
 */
const ORG_A = '0f6f1a2e-0000-4000-8000-00000000000a'
const ORG_B = '0f6f1a2e-0000-4000-8000-00000000000b'
const P_A = 'a2153ef4-0bbb-4b9a-875c-44a0f69f9a12'
const acme: WorkspaceMembership = { orgId: ORG_A, membershipId: 'm-a', slug: 'acme', name: 'Acme Contracting', kind: 'company', role: 'pm', isAdmin: true, isOwner: true, status: 'active' }
const beta: WorkspaceMembership = { orgId: ORG_B, membershipId: 'm-b', slug: 'beta', name: 'Beta Build', kind: 'company', role: 'qs', isAdmin: false, isOwner: false, status: 'active' }
const identity = { id: 'u1', name: 'Dana Okafor', email: 'dana@octapm.demo', status: 'active' }
const userIn = (workspace: WorkspaceMembership) => ({ ...identity, orgId: workspace.orgId, role: workspace.role, isCompanyAdmin: workspace.isAdmin, isOwner: workspace.isOwner })
const tokens = (suffix: string) => ({ accessToken: `access-${suffix}`, expiresIn: 900, refreshToken: `refresh-${suffix}`, refreshTokenExpiresAt: '2030-01-01T00:00:00Z' })
const sessionFor = (workspace: WorkspaceMembership, suffix: string) => envelope({ user: userIn(workspace), tokens: tokens(suffix), workspace, memberships: [acme, beta] })
const chooser = () => ({ status: 200, body: envelope({ chooseWorkspace: true, identityToken: 'identity-token', memberships: [acme, beta] }) })
const meIn = (workspace: WorkspaceMembership) => envelope({ ...userIn(workspace), memberships: [acme, beta], active: { orgId: workspace.orgId, membershipId: workspace.membershipId } })

let store: KeyValueStore

beforeEach(async () => {
  store = memoryStore()
  __useStoreForTests(store)
  __resetOfflineForTests()
  __resetOutboxForTests()
  await hydrateOutbox()
  registerSender('punch.create', async () => ({ resultId: 'srv' }))
  queryClient.clear()
  useAuthStore.setState({ status: 'signedOut', user: null, accessToken: null, accessExpiresAt: null, biometricEnabled: false, lastSignOutReason: null, workspace: null, memberships: [], switching: false, pendingChoice: null })
  useProjectStore.setState({ currentProjectId: null, currentProjectOrgId: null, hydrated: true })
  await secureStorage.remove(STORAGE_KEYS.lastWorkspace)
  await secureStorage.remove(STORAGE_KEYS.currentProject)
})

afterAll(() => __useStoreForTests(null))

const workspaceSessionPath = (orgId: string) => `POST /auth/workspaces/${orgId}/session`

describe('signing in with several workspaces', () => {
  it('shows the chooser: nothing is signed in until a workspace is chosen, and the choice completes the sign-in with the identity token', async () => {
    const calls = fakeServer({
      'POST /auth/login': chooser,
      [workspaceSessionPath(ORG_B)]: () => ({ status: 200, body: sessionFor(beta, 'b') }),
    })
    const outcome = await signIn('dana@octapm.demo', 'DemoPassw0rd!')
    expect(outcome).toEqual({ kind: 'chooseWorkspace', memberships: [acme, beta] })
    expect(useAuthStore.getState().status).toBe('signedOut')
    expect(useAuthStore.getState().pendingChoice).toMatchObject({ identity: 'dana@octapm.demo', identityToken: 'identity-token' })
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBeNull()

    await enterWorkspace(ORG_B)
    const state = useAuthStore.getState()
    expect(state.status).toBe('signedIn')
    expect(state.workspace).toEqual(beta)
    expect(state.memberships).toEqual([acme, beta])
    expect(state.pendingChoice).toBeNull()
    expect(state.accessToken).toBe('access-b')
    const issue = calls.find((c) => c.path === `/auth/workspaces/${ORG_B}/session`)
    expect(issue?.headers.authorization).toBe('Bearer identity-token')
    expect(issue?.headers['x-octapm-client']).toBe('mobile')
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-b')
    // The workspace is remembered for this identity on this device, and the outbox is owned per workspace.
    expect(await rememberedWorkspace('dana@octapm.demo')).toBe(ORG_B)
    expect(await rememberedWorkspace('someone@else.test')).toBeNull()
    expect(useOutbox.getState()).toMatchObject({ owner: 'u1', activeOrgId: ORG_B, locked: false })
  })

  it('enters the workspace the identity last worked in without asking, and asks when the remembered one is gone', async () => {
    await secureStorage.set(STORAGE_KEYS.lastWorkspace, JSON.stringify({ identity: 'dana@octapm.demo', orgId: ORG_A }))
    fakeServer({
      'POST /auth/login': chooser,
      [workspaceSessionPath(ORG_A)]: () => ({ status: 200, body: sessionFor(acme, 'a') }),
    })
    expect(await signIn('dana@octapm.demo', 'DemoPassw0rd!')).toEqual({ kind: 'signedIn' })
    expect(useAuthStore.getState().workspace).toEqual(acme)

    // Another identity's hint is not this person's.
    useAuthStore.getState().setSignedOut('user')
    await secureStorage.set(STORAGE_KEYS.lastWorkspace, JSON.stringify({ identity: 'other@octapm.demo', orgId: ORG_A }))
    fakeServer({ 'POST /auth/login': chooser })
    expect((await signIn('dana@octapm.demo', 'DemoPassw0rd!')).kind).toBe('chooseWorkspace')

    // A remembered workspace the person has since left: ask.
    useAuthStore.getState().setSignedOut('user')
    await secureStorage.set(STORAGE_KEYS.lastWorkspace, JSON.stringify({ identity: 'dana@octapm.demo', orgId: 'gone' }))
    fakeServer({ 'POST /auth/login': chooser })
    expect((await signIn('dana@octapm.demo', 'DemoPassw0rd!')).kind).toBe('chooseWorkspace')
  })

  it('a single workspace signs in directly, as it always did, and the list arrives from GET /auth/me behind the screen', async () => {
    fakeServer({
      'POST /auth/login': () => ({ status: 200, body: envelope({ user: userIn(acme), tokens: tokens('a') }) }),
      'GET /auth/me': () => ({ status: 200, body: meIn(acme) }),
    })
    expect(await signIn('dana@octapm.demo', 'DemoPassw0rd!')).toEqual({ kind: 'signedIn' })
    expect(useAuthStore.getState().workspace).toMatchObject({ orgId: ORG_A, role: 'pm' })
    await new Promise((r) => setTimeout(r, 20))
    expect(useAuthStore.getState().workspace).toEqual(acme)
    expect(useAuthStore.getState().memberships).toEqual([acme, beta])
  })

  it('an identity with no workspace to enter is told so, and nothing is signed in', async () => {
    fakeServer({ 'POST /auth/login': () => ({ status: 200, body: envelope({ needsWorkspace: true, identityToken: 'identity-token', memberships: [] }) }) })
    expect(await signIn('dana@octapm.demo', 'DemoPassw0rd!')).toEqual({ kind: 'noWorkspace' })
    expect(useAuthStore.getState().status).toBe('signedOut')
  })
})

describe('switching workspace', () => {
  const signedInAs = async (workspace: WorkspaceMembership) => {
    fakeServer({ [workspaceSessionPath(workspace.orgId)]: () => ({ status: 200, body: sessionFor(workspace, workspace.slug ?? 'x') }) })
    useAuthStore.getState().setPendingChoice({ identity: 'dana@octapm.demo', identityToken: 'identity-token', memberships: [acme, beta] })
    await enterWorkspace(workspace.orgId)
  }

  it('replaces the tokens, clears the project and the cache, restores the target workspace’s cache, and hands the queue to the new owner — in that order, as one step', async () => {
    await signedInAs(acme)
    await useProjectStore.getState().select(P_A)
    queryClient.setQueryData(['projects'], [{ id: P_A, name: 'Riverside' }])
    // A document B had on disk from an earlier session, and one A is writing now.
    await store.set(cacheKey('u1', ORG_B), JSON.stringify({ queries: [{ queryKey: ['projects'], queryHash: '["projects"]', state: { data: [{ id: 'p-b', name: 'Beta Tower' }], status: 'success', dataUpdatedAt: Date.now(), error: null, fetchStatus: 'idle' } }] }))
    // Captured in A while the signal was down: stays A's, and is not sent before the switch.
    useOutbox.setState({ locked: false })
    network.__reset(false)
    const queued = await enqueue({ projectId: P_A, kind: 'punch.create', summary: 'Chipped tile', payload: {}, clientRequestId: 'a-1' })
    network.__reset(true)
    expect(queued.orgId).toBe(ORG_A)

    const order: string[] = []
    const unsubscribeAuth = useAuthStore.subscribe((s, prev) => {
      if (s.switching !== prev.switching) order.push(s.switching ? 'freeze' : 'unfreeze')
      if (s.accessToken !== prev.accessToken) order.push(`token:${s.accessToken}`)
      if (s.workspace?.orgId !== prev.workspace?.orgId) order.push(`workspace:${s.workspace?.slug}`)
    })
    const unsubscribeProject = useProjectStore.subscribe((s, prev) => {
      if (s.currentProjectId !== prev.currentProjectId) order.push(`project:${s.currentProjectId}`)
    })
    const unsubscribeOutbox = useOutbox.subscribe((s, prev) => {
      if (s.locked !== prev.locked) order.push(s.locked ? 'outbox:locked' : 'outbox:unlocked')
      if (s.activeOrgId !== prev.activeOrgId) order.push(`outbox:${s.activeOrgId === ORG_B ? 'beta' : s.activeOrgId}`)
    })
    const calls: Call[] = fakeServer({ [workspaceSessionPath(ORG_B)]: () => ({ status: 200, body: sessionFor(beta, 'b') }) })

    await switchWorkspace(ORG_B)

    unsubscribeAuth()
    unsubscribeProject()
    unsubscribeOutbox()
    expect(order).toEqual(['freeze', 'outbox:locked', `token:access-b`, 'workspace:beta', 'project:null', 'outbox:beta', 'outbox:unlocked', 'unfreeze'])
    // The switch presented the session's own token, on the native channel.
    const issue = calls.find((c) => c.path === `/auth/workspaces/${ORG_B}/session`)
    expect(issue?.headers.authorization).toBe('Bearer access-acme')
    const state = useAuthStore.getState()
    expect(state).toMatchObject({ status: 'signedIn', accessToken: 'access-b', switching: false })
    expect(state.workspace).toEqual(beta)
    expect(state.user).toMatchObject({ orgId: ORG_B, role: 'qs' })
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-b')
    expect(await rememberedWorkspace('dana@octapm.demo')).toBe(ORG_B)
    // The project is gone, on the device too; A's cache is gone from memory and B's document is back.
    expect(useProjectStore.getState().currentProjectId).toBeNull()
    expect(await secureStorage.get(STORAGE_KEYS.currentProject)).toBeNull()
    expect(queryClient.getQueryData(['projects'])).toEqual([{ id: 'p-b', name: 'Beta Tower' }])
    // A's queued item is still there, A's, and was not sent under B.
    const outbox = useOutbox.getState()
    expect(outbox).toMatchObject({ owner: 'u1', activeOrgId: ORG_B, locked: false })
    expect(outbox.items.map((i) => [i.clientRequestId, i.orgId, i.status])).toEqual([['a-1', ORG_A, 'waiting']])
    expect(JSON.parse((await secureStorage.get(STORAGE_KEYS.profile)) ?? '{}').workspace).toEqual(beta)
  })

  it('leaves the previous session exactly as it was when the server refuses the switch', async () => {
    await signedInAs(acme)
    await useProjectStore.getState().select(P_A)
    queryClient.setQueryData(['projects'], [{ id: P_A, name: 'Riverside' }])
    fakeServer({ [workspaceSessionPath(ORG_B)]: () => failure(404, 'WORKSPACE_NOT_FOUND', 'You are not a member of this workspace') })
    await expect(switchWorkspace(ORG_B)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const state = useAuthStore.getState()
    expect(state).toMatchObject({ status: 'signedIn', accessToken: 'access-acme', switching: false })
    expect(state.workspace).toEqual(acme)
    expect(useProjectStore.getState().currentProjectId).toBe(P_A)
    expect(queryClient.getQueryData(['projects'])).toEqual([{ id: P_A, name: 'Riverside' }])
    expect(useOutbox.getState()).toMatchObject({ activeOrgId: ORG_A, locked: false })
    expect(await secureStorage.get(STORAGE_KEYS.refreshToken)).toBe('refresh-acme')
  })

  it('does nothing for the workspace the session is already in, and refuses a switch while one runs', async () => {
    await signedInAs(acme)
    const calls = fakeServer({})
    await switchWorkspace(ORG_A)
    expect(calls).toHaveLength(0)
    useAuthStore.getState().setSwitching(true)
    await expect(switchWorkspace(ORG_B)).rejects.toMatchObject({ code: 'CONFLICT' })
    useAuthStore.getState().setSwitching(false)
  })
})

describe('a restart', () => {
  it('comes back in the workspace the device knew, named, while the token is still bound to it — and derives it when the token has moved on', async () => {
    fakeServer({ [workspaceSessionPath(ORG_B)]: () => ({ status: 200, body: sessionFor(beta, 'b') }) })
    useAuthStore.getState().setPendingChoice({ identity: 'dana@octapm.demo', identityToken: 'identity-token', memberships: [acme, beta] })
    await enterWorkspace(ORG_B)
    // The app restarts: nothing in memory, the refresh token and the profile on the device.
    useAuthStore.setState({ status: 'booting', user: null, accessToken: null, workspace: null, memberships: [] })
    const refreshes = fakeServer({ 'POST /auth/refresh': () => ({ status: 200, body: envelope({ user: userIn(beta), tokens: tokens('b2') }) }) })
    expect(await refreshSession()).toBe('access-b2')
    // The stored refresh token is what was presented — reading the workspace must not disturb the request itself.
    expect(refreshes.find((c) => c.path === '/auth/refresh')?.body).toEqual({ refreshToken: 'refresh-b' })
    expect(useAuthStore.getState().workspace).toEqual(beta)

    // The same device, a token that now names A: the stored B is not A's name.
    useAuthStore.setState({ status: 'booting', user: null, accessToken: null, workspace: null, memberships: [] })
    fakeServer({ 'POST /auth/refresh': () => ({ status: 200, body: envelope({ user: userIn(acme), tokens: tokens('a2') }) }) })
    expect(await refreshSession()).toBe('access-a2')
    expect(useAuthStore.getState().workspace).toMatchObject({ orgId: ORG_A, name: null })
  })
})
