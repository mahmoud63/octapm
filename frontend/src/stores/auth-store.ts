import type {
  ActiveWorkspace,
  AuthUser,
  WorkspaceMembership,
} from '@/services/auth/types'
import { create } from 'zustand'

/** What goes after `/o/` for a workspace: its slug, or its id while it has none. */
export const workspaceSegment = (
  workspace: Pick<WorkspaceMembership, 'slug' | 'orgId'> | null | undefined
) => (workspace ? workspace.slug || workspace.orgId : '')

/**
 * The workspace a profile says its token is bound to (workspace switching doc
 * §1). `GET /auth/me` names it in `active` and describes it in `memberships`;
 * an identity from before the membership backfill has `active.orgId` and no
 * membership row, and is described from its own columns.
 */
export const workspaceFromProfile = (
  user: AuthUser | null | undefined
): ActiveWorkspace | null => {
  if (!user?.active?.orgId) return null
  const memberships = user.memberships ?? []
  const membership = memberships.find(
    (entry) => entry.orgId === user.active?.orgId
  )
  const base: WorkspaceMembership = membership ?? {
    orgId: user.active.orgId,
    membershipId: user.active.membershipId ?? null,
    slug: null,
    name: null,
    kind: 'company',
    role: user.role,
    isAdmin: Boolean(user.isCompanyAdmin),
    isOwner: false,
    status: 'active',
  }
  return { ...base, segment: workspaceSegment(base) }
}

/** A session issue's `workspace` entry as the store keeps it. */
export const activeWorkspaceOf = (
  workspace: WorkspaceMembership | null | undefined
): ActiveWorkspace | null =>
  workspace ? { ...workspace, segment: workspaceSegment(workspace) } : null

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    accessToken: string
    setAccessToken: (accessToken: string) => void
    /**
     * Installs a session. The workspace is taken from the session when the
     * server named one (a workspace session issue, a profile), and kept
     * otherwise (a refresh re-issues the same membership's token).
     */
    setSession: (
      user: AuthUser,
      accessToken: string,
      session?: {
        workspace?: WorkspaceMembership | null
        memberships?: WorkspaceMembership[]
      }
    ) => void
    /** The workspace the token is bound to, or null before a session is known. */
    workspace: ActiveWorkspace | null
    /** Every workspace the identity belongs to (identity-level; survives a switch). */
    memberships: WorkspaceMembership[]
    /** Whether `memberships` has been read from `GET /auth/me` for this identity. */
    membershipsLoaded: boolean
    /** True for the length of `switchWorkspace()`: queries and replay wait. */
    switching: boolean
    setSwitching: (switching: boolean) => void
    hasSession: () => boolean
    resetAccessToken: () => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set, get) => {
  return {
    auth: {
      user: null,
      setUser: (user) =>
        set((state) => {
          // A profile carries the identity's memberships and the token's
          // workspace; a bare user (a login response) carries neither, and
          // what the store already knows about them is kept.
          const fromProfile = user?.memberships
            ? {
                memberships: user.memberships,
                membershipsLoaded: true,
                workspace: workspaceFromProfile(user),
              }
            : user
              ? {}
              : { memberships: [], membershipsLoaded: false, workspace: null }
          return { ...state, auth: { ...state.auth, user, ...fromProfile } }
        }),
      accessToken: '',
      setAccessToken: (accessToken) =>
        set((state) => ({ ...state, auth: { ...state.auth, accessToken } })),
      setSession: (user, accessToken, session) =>
        set((state) => ({
          ...state,
          auth: {
            ...state.auth,
            user,
            accessToken,
            ...(session?.workspace
              ? { workspace: activeWorkspaceOf(session.workspace) }
              : {}),
            ...(session?.memberships
              ? { memberships: session.memberships, membershipsLoaded: true }
              : {}),
          },
        })),
      workspace: null,
      memberships: [],
      membershipsLoaded: false,
      switching: false,
      setSwitching: (switching) =>
        set((state) => ({ ...state, auth: { ...state.auth, switching } })),
      hasSession: () => {
        const { accessToken, user } = get().auth
        return Boolean(accessToken || user)
      },
      resetAccessToken: () =>
        set((state) => ({ ...state, auth: { ...state.auth, accessToken: '' } })),
      reset: () =>
        set((state) => ({
          ...state,
          auth: {
            ...state.auth,
            user: null,
            accessToken: '',
            workspace: null,
            memberships: [],
            membershipsLoaded: false,
            switching: false,
          },
        })),
    },
  }
})
