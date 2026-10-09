/**
 * expo-router calls this for every incoming link on a device: the `octapm://`
 * scheme, a universal link from `app.octapm.com`, and the web platform's own
 * record paths. The link is turned into an app route; when it names a
 * project, or a workspace other than the one the session is in, the opener
 * screen takes over first — and asks before any workspace switch.
 *
 * A web link the app has no screen for is not swallowed: it is handed to the
 * browser whole, query included, so an invitation, a password reset or an SSO
 * return the system routed here still reaches its page (owner decision Q14),
 * and the app opens Home behind it. The URL is never logged — its query can
 * carry a token.
 */
import * as WebBrowser from 'expo-web-browser'
import { useAuthStore } from '@/auth/store'
import { env } from '@/config/env'
import { resolveLink, routeForResolvedLink, webHandoffUrl } from '@/navigation/deepLinks'
import { useProjectStore } from '@/projects/store'

function handToBrowser(path: string) {
  try {
    const url = webHandoffUrl(path, env.webOrigin)
    if (url) void WebBrowser.openBrowserAsync(url).catch(() => undefined)
  } catch {
    // The browser could not be opened; the app still opens Home.
  }
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const resolved = resolveLink(path)
    if (!resolved) {
      handToBrowser(path)
      return '/'
    }
    const workspace = useAuthStore.getState().workspace
    return routeForResolvedLink(resolved, useProjectStore.getState().currentProjectId, workspace ? { orgId: workspace.orgId, slug: workspace.slug } : null)
  } catch {
    return '/'
  }
}
