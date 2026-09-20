/**
 * What the signed-in person may do on the current project, as the server says.
 *
 * The matrix comes from `GET /auth/me/permissions?projectId=` and is the only
 * thing the app renders from. The shared policy file is a fallback for the
 * moments before the server has answered (a cold offline start), and even then
 * the server still decides when the request is made.
 */
import { useQuery } from '@tanstack/react-query'
import { getPermissions } from '@/api/endpoints'
import { keys } from '@/api/query'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { can as policyAllows, canTransition as policyAllowsTransition, type ActionId } from '@/permissions/policy'

export function allows(matrix: PermissionMatrix | undefined, module: string, action: ActionId): boolean {
  const entry = matrix?.modules[module]
  return !!entry && entry.visible !== false && entry.actions.includes(action)
}

export function allowsTransition(matrix: PermissionMatrix | undefined, module: string, transition: string): boolean {
  const entry = matrix?.modules[module]
  return !!entry && entry.visible !== false && entry.transitions.includes(transition)
}

export function visibleModules(matrix: PermissionMatrix | undefined): string[] {
  return Object.entries(matrix?.modules ?? {})
    .filter(([, entry]) => entry.visible !== false && entry.actions.includes('read'))
    .map(([key]) => key)
}

export function usePermissions(projectId: string | null) {
  const role = useAuthStore((s) => s.user?.role ?? null)
  const signedIn = useAuthStore((s) => s.status === 'signedIn')
  const query = useQuery({
    queryKey: projectId ? keys.permissions(projectId) : keys.orgPermissions,
    queryFn: ({ signal }) => getPermissions(projectId, signal),
    staleTime: 5 * 60_000,
    // Only ask once there is a session to ask with. A request sent while the
    // session is still being restored carries no bearer, and its 401 is
    // indistinguishable from an expired one: the client refreshes, retries,
    // is refused a second time and ends the session. Opening a screen that
    // reads permissions a moment too early used to sign the person out.
    enabled: signedIn,
  })
  const matrix = query.data
  return {
    matrix,
    isLoading: query.isPending,
    error: query.error,
    /** Server answer first; the shared policy only while there is none. */
    allows: (module: string, action: ActionId) => (matrix ? allows(matrix, module, action) : policyAllows(role, module, action)),
    allowsTransition: (module: string, transition: string) =>
      matrix ? allowsTransition(matrix, module, transition) : policyAllowsTransition(role, transition),
    refetch: query.refetch,
  }
}
