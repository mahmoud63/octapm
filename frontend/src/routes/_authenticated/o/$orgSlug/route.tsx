import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { membershipForSegment, rememberWorkspace } from '@/lib/workspace/paths'
import { switchWorkspace } from '@/lib/workspace/switch'
import { WorkspaceGate } from '@/features/home/workspace-gate'

/**
 * The workspace segment of every authenticated URL (workspace switching doc
 * §1, §5). The URL is the source of truth: opening `/o/beta/…` while the
 * session is bound to `acme` switches the session to `beta` first and renders
 * after — which is what makes browser Back correct across a switch, since
 * Back lands on the previous `/o/acme/…` URL and this guard switches back.
 *
 * A segment that names none of the identity's workspaces is not silently
 * replaced by another one: the page says so and lists the workspaces the
 * person can open (deep-link rule §108).
 */
export const Route = createFileRoute('/_authenticated/o/$orgSlug')({
  beforeLoad: async ({ params, context }) => {
    const { auth } = useAuthStore.getState()
    const membership = membershipForSegment(auth.memberships, params.orgSlug)
    if (!membership || membership.status !== 'active') {
      return { workspace: null, membership }
    }
    if (auth.workspace?.orgId !== membership.orgId) {
      await switchWorkspace({
        queryClient: context.queryClient,
        orgId: membership.orgId,
      })
    }
    rememberWorkspace(params.orgSlug)
    return {
      workspace: useAuthStore.getState().auth.workspace,
      membership,
    }
  },
  component: WorkspaceRoute,
})

// eslint-disable-next-line react-refresh/only-export-components
function WorkspaceRoute() {
  const { workspace, membership } = Route.useRouteContext()
  const { orgSlug } = Route.useParams()
  if (!workspace) {
    return <WorkspaceGate segment={orgSlug} membership={membership ?? null} />
  }
  return <Outlet />
}
