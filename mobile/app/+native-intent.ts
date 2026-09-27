/**
 * expo-router calls this for every incoming link on a device: the `octapm://`
 * scheme, a universal link from `app.octapm.com`, and the web platform's own
 * record paths. The link is turned into an app route; when it names a
 * project, or a workspace other than the one the session is in, the opener
 * screen takes over first — and asks before any workspace switch.
 */
import { useAuthStore } from '@/auth/store'
import { resolveLink, routeForResolvedLink } from '@/navigation/deepLinks'
import { useProjectStore } from '@/projects/store'

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const resolved = resolveLink(path)
    if (!resolved) return '/'
    const workspace = useAuthStore.getState().workspace
    return routeForResolvedLink(resolved, useProjectStore.getState().currentProjectId, workspace ? { orgId: workspace.orgId, slug: workspace.slug } : null)
  } catch {
    return '/'
  }
}
