import { selectAuthenticated, sessionReadiness, useAuthStore, workspaceFromUser, workspaceKindLabel, workspaceLabel, type SessionUser, type WorkspaceMembership } from './store'

/**
 * The auth store's workspace state (workspace switching doc §1): the session
 * is bound to one workspace, taken from what the server sent, derived from
 * the user when the server sent none, and cleared with the session.
 */
const acme: WorkspaceMembership = { orgId: 'org-a', membershipId: 'm-a', slug: 'acme', name: 'Acme Contracting', kind: 'company', role: 'pm', isAdmin: true, isOwner: true, status: 'active' }
const beta: WorkspaceMembership = { orgId: 'org-b', membershipId: 'm-b', slug: 'beta', name: 'Beta Build', kind: 'personal', role: 'qs', isAdmin: false, isOwner: false, status: 'active' }
const user: SessionUser = { id: 'u1', orgId: 'org-a', name: 'Dana', email: 'dana@example.test', role: 'pm', isCompanyAdmin: true, status: 'active' }

const reset = () => useAuthStore.setState({ status: 'signedOut', user: null, accessToken: null, accessExpiresAt: null, workspace: null, memberships: [], switching: false, pendingChoice: null })

beforeEach(reset)

describe('the workspace a session is bound to', () => {
  it('is the one the server named, with the memberships for the switcher', () => {
    useAuthStore.getState().setSignedIn(user, 'token', 900, { workspace: beta, memberships: [acme, beta] })
    const state = useAuthStore.getState()
    expect(state.status).toBe('signedIn')
    expect(state.workspace).toEqual(beta)
    expect(state.memberships).toEqual([acme, beta])
    expect(state.pendingChoice).toBeNull()
  })

  it('is derived from the user when a plain login named none, and found in the list when GET /auth/me has answered', () => {
    expect(workspaceFromUser(user)).toEqual({ orgId: 'org-a', membershipId: null, slug: null, name: null, kind: 'company', role: 'pm', isAdmin: true, isOwner: false, status: 'active' })
    expect(workspaceFromUser({ ...user, active: { orgId: 'org-b', membershipId: 'm-b' }, memberships: [acme, beta] })).toEqual(beta)
    // `active` names the membership even when the list does not carry it.
    expect(workspaceFromUser({ ...user, active: { orgId: 'org-b', membershipId: 'm-b' } })).toMatchObject({ orgId: 'org-b', membershipId: 'm-b' })
    useAuthStore.getState().setSignedIn(user, 'token', 900)
    expect(useAuthStore.getState().workspace).toMatchObject({ orgId: 'org-a', role: 'pm', isAdmin: true })
    expect(useAuthStore.getState().memberships).toEqual([])
    // The list arrives later and the active workspace is replaced by its listed form.
    useAuthStore.getState().setWorkspace(acme, [acme, beta])
    expect(useAuthStore.getState().workspace).toEqual(acme)
    expect(useAuthStore.getState().memberships).toHaveLength(2)
  })

  it('keeps the memberships already known when a later sign-in does not repeat them', () => {
    useAuthStore.getState().setSignedIn(user, 'token', 900, { workspace: acme, memberships: [acme, beta] })
    useAuthStore.getState().setSignedIn(user, 'token-2', 900, { workspace: beta })
    expect(useAuthStore.getState().workspace).toEqual(beta)
    expect(useAuthStore.getState().memberships).toEqual([acme, beta])
  })

  it('goes with the session: signing out clears the workspace, the list, the freeze flag and any pending choice', () => {
    useAuthStore.getState().setSignedIn(user, 'token', 900, { workspace: acme, memberships: [acme, beta] })
    useAuthStore.getState().setSwitching(true)
    useAuthStore.getState().setPendingChoice({ identity: 'dana@example.test', identityToken: 'id', memberships: [acme, beta] })
    useAuthStore.getState().setSignedOut('user')
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedOut', workspace: null, memberships: [], switching: false, pendingChoice: null })
  })

  it('freezes the session while a switch runs: signed in, but not something to fetch with', () => {
    useAuthStore.getState().setSignedIn(user, 'token', 900, { workspace: acme })
    expect(sessionReadiness(useAuthStore.getState().status)).toBe('authenticated')
    expect(selectAuthenticated(useAuthStore.getState())).toBe(true)
    useAuthStore.getState().setSwitching(true)
    expect(useAuthStore.getState().switching).toBe(true)
    // Frozen: the queries' gate says no, so nothing is fetched under a token about to be replaced.
    expect(selectAuthenticated(useAuthStore.getState())).toBe(false)
    // setSignedIn with the new workspace's tokens does not lift the freeze; the switch does, at its end.
    useAuthStore.getState().setSignedIn(user, 'token-b', 900, { workspace: beta })
    expect(useAuthStore.getState().switching).toBe(true)
    expect(selectAuthenticated(useAuthStore.getState())).toBe(false)
    useAuthStore.getState().setSwitching(false)
    expect(useAuthStore.getState().switching).toBe(false)
    expect(selectAuthenticated(useAuthStore.getState())).toBe(true)
  })

  it('names a workspace for the screen even before the server has', () => {
    expect(workspaceLabel(acme)).toBe('Acme Contracting')
    expect(workspaceLabel({ name: null, kind: 'personal' })).toBe('Personal workspace')
    expect(workspaceLabel(null)).toBe('Your workspace')
    expect(workspaceKindLabel('personal')).toBe('Personal')
    expect(workspaceKindLabel('company')).toBe('Company')
    expect(workspaceKindLabel(undefined)).toBe('Company')
  })
})
