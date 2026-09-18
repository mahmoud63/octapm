/**
 * expo-router calls this for every incoming link on a device: the `octapm://`
 * scheme, a universal link from `app.octapm.com`, and the web platform's own
 * record paths. The link is turned into an app route; when it names a
 * project, the opener screen switches to that project first.
 */
import { resolveLink, routeForResolvedLink } from '@/navigation/deepLinks'
import { useProjectStore } from '@/projects/store'

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const resolved = resolveLink(path)
    if (!resolved) return '/'
    return routeForResolvedLink(resolved, useProjectStore.getState().currentProjectId)
  } catch {
    return '/'
  }
}
