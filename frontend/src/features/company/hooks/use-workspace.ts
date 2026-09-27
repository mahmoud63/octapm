import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { ApiSuccess, WorkspaceMembership } from '@/services/auth/types'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Workspaces as things that are made and change kind (ENT-6).
 *
 * `POST /organisations` makes a further, company workspace for the signed-in
 * identity; `POST /organisations/:id/convert` turns the session's personal
 * workspace into a company one. Both answer the caller's membership and the
 * identity's full list of memberships, which is what the store keeps for the
 * switcher and the `/o/$orgSlug` guard — so after either call the new or
 * changed workspace is known to the app without a profile round trip.
 */

export interface OrganisationSummary {
  id: string
  name: string
  kind: 'personal' | 'company'
  slug: string | null
  plan: string
  status: string
}

export interface WorkspaceResult {
  organisation: OrganisationSummary
  workspace: WorkspaceMembership
  memberships: WorkspaceMembership[]
}

export const createWorkspace = async (
  name: string
): Promise<WorkspaceResult> => {
  const response = await apiClient.post<ApiSuccess<WorkspaceResult>>(
    '/organisations',
    { name }
  )
  return response.data.data
}

export const convertWorkspace = async (
  orgId: string,
  name?: string
): Promise<WorkspaceResult> => {
  const response = await apiClient.post<ApiSuccess<WorkspaceResult>>(
    `/organisations/${encodeURIComponent(orgId)}/convert`,
    name ? { name } : {}
  )
  return response.data.data
}

/** The identity's memberships as the server now lists them, kept on the session. */
const rememberMemberships = (
  memberships: WorkspaceMembership[],
  workspace?: WorkspaceMembership
) => {
  const { auth } = useAuthStore.getState()
  if (!auth.user) return
  auth.setSession(auth.user, auth.accessToken, {
    memberships,
    ...(workspace ? { workspace } : {}),
  })
}

/** Creates a company workspace; the caller then navigates to `/o/{segment}`, which performs the switch. */
export const useCreateWorkspace = () =>
  useMutation({
    mutationFn: (name: string) => createWorkspace(name),
    onSuccess: (result) => rememberMemberships(result.memberships),
  })

/**
 * Converts the active personal workspace. The session stays bound to the
 * same membership (its kind is the organisation's, read per request), so
 * only what the store says about the workspace changes; every cached query
 * of the workspace is refetched, since the dashboard and the header read
 * the kind.
 */
export const useConvertWorkspace = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orgId, name }: { orgId: string; name?: string }) =>
      convertWorkspace(orgId, name),
    onSuccess: async (result) => {
      rememberMemberships(result.memberships, result.workspace)
      await queryClient.invalidateQueries()
    },
  })
}
