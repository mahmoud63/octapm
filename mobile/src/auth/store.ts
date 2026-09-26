/**
 * Who is signed in, right now, in memory — and in which workspace.
 *
 * The access token lives here and nowhere else: it is short-lived and is never
 * written to disk. The refresh token is the only thing persisted, and it goes
 * to the platform keychain through secure-storage. The store holds state; the
 * session module holds the behaviour.
 *
 * A session is bound to one workspace at a time (workspace switching doc §1):
 * the token in memory names a membership, `workspace` describes it, and
 * `memberships` lists every workspace the identity belongs to for the picker.
 * Switching replaces the token, the workspace, the caches and the project in
 * one sequence (session.switchWorkspace); `switching` is the freeze flag that
 * sequence raises so nothing is fetched or replayed halfway through.
 */
import { create } from 'zustand'
import type { RoleId } from '@/permissions/policy'

export type AuthStatus =
  /** The app has started and has not yet checked for a saved session. */
  | 'booting'
  | 'signedOut'
  /** A saved session exists and biometric unlock is on; nothing is shown until it is unlocked. */
  | 'locked'
  | 'signedIn'

export type WorkspaceKind = 'company' | 'personal' | string

/** One workspace the identity belongs to, as GET /auth/me lists it (membership doc §3). */
export interface WorkspaceMembership {
  orgId: string
  /** Null for an account seeded before memberships; the server then binds the session to the User row. */
  membershipId: string | null
  slug: string | null
  name: string | null
  kind: WorkspaceKind
  role: RoleId | string
  isAdmin: boolean
  isOwner: boolean
  /** active | suspended | invited — a suspended workspace is listed so the picker can explain, never entered. */
  status: string
}

export interface SessionUser {
  id: string
  orgId: string
  name: string
  email: string
  role: RoleId | string
  isCompanyAdmin: boolean
  isOwner?: boolean
  status: string
  mfaEnabled?: boolean
  /** Every workspace of the identity, when the server sent them (GET /auth/me, a workspace session). */
  memberships?: WorkspaceMembership[]
  /** The membership the token is bound to, when the server named it. */
  active?: { orgId: string; membershipId: string | null } | null
}

/** A sign-in that returned several workspaces and is waiting for the person to choose one (membership doc §6). */
export interface PendingWorkspaceChoice {
  /** Who is choosing, so the chooser can say so and the choice can be remembered per identity. */
  identity: string
  identityToken: string
  memberships: WorkspaceMembership[]
}

export interface SessionWorkspaces {
  workspace?: WorkspaceMembership | null
  memberships?: WorkspaceMembership[] | null
}

interface AuthState {
  status: AuthStatus
  user: SessionUser | null
  accessToken: string | null
  /** Epoch milliseconds when the access token stops working. */
  accessExpiresAt: number | null
  biometricEnabled: boolean
  /** Why the last session ended, for the sign-in screen to explain. */
  lastSignOutReason: 'user' | 'expired' | 'revoked' | null
  /** The workspace the session is bound to. Null only while nothing is signed in. */
  workspace: WorkspaceMembership | null
  /** Every workspace of the identity, for the switcher; empty until GET /auth/me has answered. */
  memberships: WorkspaceMembership[]
  /** A switch is in progress: queries and the outbox hold still until it is over. */
  switching: boolean
  /** A sign-in waiting for a workspace to be chosen. */
  pendingChoice: PendingWorkspaceChoice | null

  setBooting: () => void
  setSignedIn: (user: SessionUser, accessToken: string, expiresInSeconds: number, workspaces?: SessionWorkspaces) => void
  setAccessToken: (accessToken: string, expiresInSeconds: number) => void
  setLocked: () => void
  setSignedOut: (reason: AuthState['lastSignOutReason']) => void
  setBiometricEnabled: (enabled: boolean) => void
  setUser: (user: SessionUser) => void
  setWorkspace: (workspace: WorkspaceMembership | null, memberships?: WorkspaceMembership[] | null) => void
  setSwitching: (switching: boolean) => void
  setPendingChoice: (choice: PendingWorkspaceChoice | null) => void
}

/**
 * The workspace a session is in when the server named none (a login with a
 * single membership answers the user alone): the user's own columns, which
 * are the membership's as the server sees it. The list fills in when
 * GET /auth/me answers.
 */
export const workspaceFromUser = (user: SessionUser, memberships: WorkspaceMembership[] | null | undefined = user.memberships): WorkspaceMembership => {
  const orgId = user.active?.orgId ?? user.orgId
  const listed = memberships?.find((m) => m.orgId === orgId)
  if (listed) return listed
  return {
    orgId,
    membershipId: user.active?.membershipId ?? null,
    slug: null,
    name: null,
    kind: 'company',
    role: user.role,
    isAdmin: Boolean(user.isCompanyAdmin),
    isOwner: Boolean(user.isOwner),
    status: 'active',
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'booting',
  user: null,
  accessToken: null,
  accessExpiresAt: null,
  biometricEnabled: false,
  lastSignOutReason: null,
  workspace: null,
  memberships: [],
  switching: false,
  pendingChoice: null,

  setBooting: () => set({ status: 'booting' }),
  setSignedIn: (user, accessToken, expiresInSeconds, workspaces) =>
    set((s) => ({
      status: 'signedIn',
      user,
      accessToken,
      accessExpiresAt: Date.now() + expiresInSeconds * 1000,
      lastSignOutReason: null,
      pendingChoice: null,
      workspace: workspaces?.workspace ?? workspaceFromUser(user, workspaces?.memberships ?? s.memberships),
      memberships: workspaces?.memberships ?? user.memberships ?? s.memberships,
    })),
  setAccessToken: (accessToken, expiresInSeconds) => set({ accessToken, accessExpiresAt: Date.now() + expiresInSeconds * 1000 }),
  setLocked: () => set({ status: 'locked', accessToken: null, accessExpiresAt: null }),
  setSignedOut: (reason) =>
    set({ status: 'signedOut', user: null, accessToken: null, accessExpiresAt: null, lastSignOutReason: reason, workspace: null, memberships: [], switching: false, pendingChoice: null }),
  setBiometricEnabled: (biometricEnabled) => set({ biometricEnabled }),
  setUser: (user) => set({ user }),
  setWorkspace: (workspace, memberships) => set((s) => ({ workspace, memberships: memberships ?? s.memberships })),
  setSwitching: (switching) => set({ switching }),
  setPendingChoice: (pendingChoice) => set({ pendingChoice }),
}))

export const selectUser = (s: AuthState) => s.user
export const selectStatus = (s: AuthState) => s.status
export const selectRole = (s: AuthState) => s.user?.role ?? null
export const selectWorkspace = (s: AuthState) => s.workspace

/** The workspace the session is bound to, or null while nobody is signed in. */
export const useWorkspace = () => useAuthStore(selectWorkspace)
/** Every workspace of the identity, for a picker. */
export const useMemberships = () => useAuthStore((s) => s.memberships)

/** What a workspace is called on screen: its name, or a plain word when the server has not named it yet. */
export const workspaceLabel = (workspace: Pick<WorkspaceMembership, 'name' | 'kind'> | null | undefined) => workspace?.name ?? (workspace?.kind === 'personal' ? 'Personal workspace' : 'Your workspace')

/** The badge a workspace's kind wears. */
export const workspaceKindLabel = (kind: WorkspaceKind | null | undefined) => (kind === 'personal' ? 'Personal' : 'Company')

/**
 * Session readiness, as three answers rather than one boolean.
 *
 * `Boolean(accessToken)` cannot tell a session still being restored from a
 * person who is genuinely signed out, and the difference matters twice over.
 * A request sent before the token is in memory carries no bearer; the client
 * cannot tell that 401 from an expired one, so it refreshes, retries, is
 * refused and ends the session. And a screen that reads "not ready" as "no
 * data" tells the person their workspace is empty when it is merely still
 * arriving.
 *
 * So: queries that need a session run only when `authenticated`, and screens
 * render `restoring` as a loading state, never as empty.
 */
export type SessionReadiness = 'restoring' | 'authenticated' | 'unauthenticated'

export const sessionReadiness = (status: AuthStatus): SessionReadiness => {
  if (status === 'signedIn') return 'authenticated'
  // 'locked' holds a saved session behind a biometric prompt: not signed out,
  // and not something to send a request with either.
  if (status === 'booting' || status === 'locked') return 'restoring'
  return 'unauthenticated'
}

/** The readiness of the session right now. */
export const useSessionReadiness = (): SessionReadiness => useAuthStore((s) => sessionReadiness(s.status))

/**
 * True only when there is a session to make an authenticated request with.
 * A switch in progress is not one: the token in memory is about to be
 * replaced and the cache emptied, so a query started now would land its
 * answer from the old workspace in the new one's cache.
 */
export const selectAuthenticated = (s: Pick<AuthState, 'status' | 'switching'>): boolean => s.status === 'signedIn' && !s.switching
export const useAuthenticated = (): boolean => useAuthStore(selectAuthenticated)
