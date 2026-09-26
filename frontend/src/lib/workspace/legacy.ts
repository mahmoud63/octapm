import type { QueryClient } from '@tanstack/react-query'
import { notFound, redirect, type ParsedLocation } from '@tanstack/react-router'
import axios from 'axios'
import { resolveProjectWorkspace } from '@/services/auth/api'
import { useAuthStore } from '@/stores/auth-store'
import { workspaceSegment } from './paths'

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
 * Projects already resolved on this tab: `projectId` → workspace segment.
 * In-app navigation between a project's modules goes through the legacy
 * route dozens of times a session; the workspace of a project cannot change
 * (ownership doc), so one answer per project per page load is enough.
 */
const resolvedProjects = new Map<string, string>()

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
 *     silently, so the person sees which workspace they are about to enter;
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
  const go = (segment: string): never => {
    resolvedProjects.set(projectId, segment)
    return workspaceRedirect(segment, location)
  }

  const known = resolvedProjects.get(projectId)
  if (known) return go(known)
  if (active && projectInActiveWorkspace(queryClient, projectId)) {
    return go(active.segment)
  }

  try {
    const resolution = await resolveProjectWorkspace(projectId)
    const segment = resolution.workspace.segment || workspaceSegment(resolution.workspace)
    if (!active || resolution.workspace.orgId === active.orgId) return go(segment)
    throw redirect({
      to: '/switch',
      search: {
        to: segment,
        next: href,
        name: resolution.workspace.name ?? segment,
        project: resolution.project.name,
      },
      replace: true,
    })
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      throw notFound()
    }
    throw error
  }
}
