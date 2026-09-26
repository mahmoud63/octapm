import type { QueryClient } from '@tanstack/react-query'
import { notFound, redirect, type ParsedLocation } from '@tanstack/react-router'
import axios from 'axios'
import { resolveProjectWorkspace } from '@/services/auth/api'
import { useAuthStore } from '@/stores/auth-store'
import { membershipForSegment, workspaceSegment } from './paths'

/**
 * Legacy (workspace-less) URLs (workspace switching doc §5).
 *
 * Every authenticated route keeps its old path as a redirect: `/tasks` opens
 * `/o/{workspace}/tasks`, `/projects/:id/…` opens the same path under the
 * workspace that owns the project. The old routes stay in the tree so the
 * hundreds of typed `to='/projects/$projectId/…'` navigations across the
 * product, every bookmark and every notification link minted before this
 * wave keep working; the address bar shows the workspace-prefixed URL.
 */

const currentHref = (location: ParsedLocation) =>
  `${location.pathname}${location.searchStr || ''}${location.hash ? `#${location.hash}` : ''}`

/**
 * The redirect itself, as a route target rather than an href. A redirect
 * that only carries an `href` is followed by `navigate`, but a link's
 * intent preload rebuilds the location without it and lands on the same
 * legacy route again, without end — the tab hung on the first hover. With
 * `to` + `params` the router resolves the workspace route both ways. The
 * pathname is concrete (ids, not `$` patterns), so it matches as it stands.
 */
const workspaceRedirect = (segment: string, location: ParsedLocation): never => {
  throw redirect({
    to: `/o/$orgSlug${location.pathname === '/' ? '' : location.pathname}` as '/o/$orgSlug',
    params: { orgSlug: segment },
    search: location.search as Record<string, unknown>,
    hash: location.hash || undefined,
    replace: true,
  })
}

/**
 * Sends a legacy workspace-level path (`/tasks`, `/settings/account`, …) to
 * the active workspace. With no workspace known (an identity token, which
 * binds to none) the identity home lists the workspaces to pick from.
 */
export const legacyWorkspaceRedirect = ({
  location,
}: {
  location: ParsedLocation
}): never => {
  const { auth } = useAuthStore.getState()
  const segment = auth.workspace?.segment
  if (!segment) {
    throw redirect({ to: '/home', replace: true })
  }
  return workspaceRedirect(segment, location)
}

/**
 * Projects already resolved on this tab: `projectId` → the workspace that
 * owns it. In-app navigation between a project's modules goes through the
 * legacy route dozens of times a session; the workspace of a project cannot
 * change (ownership doc), so one answer per project per page load is enough.
 * The answer is only which workspace owns the project — whether that is the
 * active one is decided again on every visit, since the person may have
 * switched in between.
 */
type ResolvedProject = { segment: string; workspaceName: string | null; projectName?: string }
const resolvedProjects = new Map<string, ResolvedProject>()

/** What the active workspace's cached project list says, without a request. */
const projectInActiveWorkspace = (
  queryClient: QueryClient,
  projectId: string
) => {
  const cached = queryClient.getQueryData<{ items?: Array<{ id: string }> }>([
    'projects',
  ])
  return Boolean(cached?.items?.some((project) => project.id === projectId))
}

/**
 * Sends a legacy `/projects/:id/…` link to the workspace that owns the
 * project (deep-link rule §108):
 *   - the active workspace → straight there, no request when the project is
 *     already known here;
 *   - another of the caller's workspaces → the switch is offered, never made
 *     silently, so the person sees which workspace they are about to enter —
 *     on every visit, including a link resolved earlier under the workspace
 *     that owns it and opened again after a switch away from it;
 *   - none of them → not found, the same page as a project that does not exist.
 */
export const legacyProjectRedirect = async ({
  projectId,
  location,
  queryClient,
}: {
  projectId: string
  location: ParsedLocation
  queryClient: QueryClient
}): Promise<never> => {
  const { auth } = useAuthStore.getState()
  const active = auth.workspace
  const href = currentHref(location)
  const go = (owner: ResolvedProject): never => {
    resolvedProjects.set(projectId, owner)
    return workspaceRedirect(owner.segment, location)
  }
  const offer = (owner: ResolvedProject): never => {
    resolvedProjects.set(projectId, owner)
    throw redirect({
      to: '/switch',
      search: {
        to: owner.segment,
        next: href,
        name: owner.workspaceName ?? owner.segment,
        project: owner.projectName,
      },
      replace: true,
    })
  }

  // Known on this tab: straight in when its workspace is the active one (or
  // none is active yet — an identity token binds to none); otherwise the
  // offer, from what is known, without a request.
  const known = resolvedProjects.get(projectId)
  if (known && (!active || known.segment === active.segment)) return go(known)
  if (active && projectInActiveWorkspace(queryClient, projectId)) {
    return go({
      segment: active.segment,
      workspaceName: active.name,
      projectName: known?.projectName,
    })
  }
  if (known) return offer(known)

  try {
    const resolution = await resolveProjectWorkspace(projectId)
    const segment = resolution.workspace.segment || workspaceSegment(resolution.workspace)
    const owner: ResolvedProject = {
      segment,
      workspaceName:
        resolution.workspace.name ??
        membershipForSegment(auth.memberships, segment)?.name ??
        null,
      projectName: resolution.project.name,
    }
    if (!active || resolution.workspace.orgId === active.orgId) return go(owner)
    return offer(owner)
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      throw notFound()
    }
    throw error
  }
}
