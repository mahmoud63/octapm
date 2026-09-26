import type { WorkspaceMembership } from '@/services/auth/types'
import { workspaceSegment } from '@/stores/auth-store'

/**
 * URL shapes of the workspace-prefixed app (workspace switching doc §5).
 * Every authenticated page lives under `/o/{segment}`; the segment is the
 * organisation's slug, or its id while it has none. Legacy paths without the
 * prefix are redirected by the route tree, so links minted before this wave
 * — and the hundreds of in-app `to='/projects/…'` navigations — keep working.
 */

const WORKSPACE_PREFIX = /^\/o\/([^/?#]+)(\/[^?#]*)?/

/** `/o/acme/projects/1` → `{ segment: 'acme', path: '/projects/1' }`; a legacy path → `{ segment: null, path }`. */
export const splitWorkspacePath = (pathname: string) => {
  const match = WORKSPACE_PREFIX.exec(pathname)
  if (!match) return { segment: null as string | null, path: pathname }
  let segment = match[1]
  try {
    segment = decodeURIComponent(segment)
  } catch {
    // an undecodable segment matches no workspace; keep it as typed
  }
  return { segment, path: match[2] || '/' }
}

/** The path without its workspace prefix, for comparing against nav items written as `/tasks`. */
export const stripWorkspacePrefix = (pathname: string) =>
  splitWorkspacePath(pathname).path

/** Puts a legacy app path (with its search string) under a workspace. */
export const workspaceHref = (segment: string, pathWithSearch: string) => {
  if (!segment) return pathWithSearch
  if (/^\/o\//.test(pathWithSearch)) return pathWithSearch
  const path = pathWithSearch === '/' ? '' : pathWithSearch
  return `/o/${encodeURIComponent(segment)}${path.startsWith('/') ? path : `/${path}`}`
}

/** The membership a URL segment names: by slug first, then by organisation id. */
export const membershipForSegment = (
  memberships: WorkspaceMembership[],
  segment: string | null | undefined
) => {
  if (!segment) return null
  return (
    memberships.find((entry) => entry.slug === segment) ??
    memberships.find((entry) => entry.orgId === segment) ??
    null
  )
}

export { workspaceSegment }

// ── Last workspace (per-viewer convenience, workspace switching doc §1) ────

export const LAST_WORKSPACE_KEY = 'octa.lastWorkspace'

export const rememberWorkspace = (segment: string) => {
  try {
    window.localStorage.setItem(LAST_WORKSPACE_KEY, segment)
  } catch {
    // per-viewer convenience only
  }
}

export const lastWorkspace = (): string | null => {
  try {
    return window.localStorage.getItem(LAST_WORKSPACE_KEY)
  } catch {
    return null
  }
}

export const forgetLastWorkspace = () => {
  try {
    window.localStorage.removeItem(LAST_WORKSPACE_KEY)
  } catch {
    // nothing to forget
  }
}

/**
 * The workspace a sign-in should open first: the one the redirect target
 * names, else the one used last on this browser, else the first active one.
 */
export const preferredMembership = (
  memberships: WorkspaceMembership[],
  redirectTo?: string | null
) => {
  const active = memberships.filter((entry) => entry.status === 'active')
  const fromRedirect = redirectTo
    ? membershipForSegment(active, splitWorkspacePath(redirectTo).segment)
    : null
  return (
    fromRedirect ??
    membershipForSegment(active, lastWorkspace()) ??
    active[0] ??
    null
  )
}
