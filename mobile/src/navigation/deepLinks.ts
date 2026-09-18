/**
 * Deep links and universal links. Every way a link can reach the app ends
 * here: the `octapm://` scheme, an `https://app.octapm.com/...` universal
 * link, the web platform's own record paths (the same ones the server puts
 * in a notification's `actionUrl`), a push notification's data, and the
 * app's own routes. The result is an app route and, when the link names
 * one, the project the record belongs to, so the opener can switch the
 * project before the record is shown.
 */
import { appRouteForRecord } from '@/navigation/links'

export interface ResolvedLink {
  /** The app route to open. */
  route: string
  /** The project the link names, when it does; the opener switches to it first. */
  projectId: string | null
}

/** Route groups the app owns; a path under one of them is already an app route. */
const APP_ROOTS = ['rfi', 'tasks', 'drawings', 'documents', 'activities', 'site', 'photos', 'timesheets', 'quality', 'inventory', 'procurement', 'commercial', 'workflow', 'needs-you', 'search', 'notifications', 'more', 'outbox', 'sign-in', 'open']

/** Web-platform module and child slugs, mapped to the record type their `recordId` names. */
const RECORD_TYPE_BY_SLUG: Record<string, string> = {
  rfi: 'rfi',
  rfis: 'rfi',
  tasks: 'task',
  drawings: 'sheet',
  sheets: 'sheet',
  activities: 'activity',
  schedule: 'activity',
  progress: 'activity',
  photos: 'photo',
  timesheets: 'timesheet',
  inspections: 'form_instance',
  forms: 'form_instance',
  itp: 'form_instance',
  defects: 'punch_item',
  punch: 'punch_item',
  'punch-list': 'punch_item',
  observations: 'observation',
  ncr: 'ncr',
  ncrs: 'ncr',
  safety: 'safety_incident',
  incidents: 'safety_incident',
  tests: 'material_test',
  'material-tests': 'material_test',
  items: 'inventory_item',
  'purchase-orders': 'purchase_order',
  orders: 'purchase_order',
  transfers: 'stock_transfer',
  'change-events': 'change_event',
  'change-orders': 'change_order',
  commitments: 'commitment',
  'pay-apps': 'sub_pay_app',
  packages: 'procurement_package',
}

/** Web modules whose landing page has an app home of its own. */
const HOME_BY_MODULE: Record<string, string> = {
  quality: '/quality',
  inventory: '/inventory',
  procurement: '/procurement',
  commercial: '/commercial',
  'site-reporting': '/site',
  'daily-log': '/site',
  'daily-logs': '/site',
  schedule: '/activities',
  activities: '/activities',
  photos: '/photos',
  drawings: '/drawings',
  documents: '/documents',
  'doc-control': '/documents',
  rfi: '/rfi',
  rfis: '/rfi',
  tasks: '/tasks',
  timesheets: '/timesheets',
  workflow: '/workflow',
  approvals: '/workflow',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The path and query of any link form, without scheme, host or expo-router group segments. */
export function normaliseLinkPath(input: string): { path: string; params: URLSearchParams } | null {
  const raw = input.trim()
  if (!raw) return null
  let pathAndQuery = raw
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i)
  if (scheme) {
    const [, protocol, host, rest] = scheme
    // octapm://rfi/abc carries the first segment as the "host"; an https link carries a real host.
    pathAndQuery = /^https?$/i.test(protocol!) ? rest || '/' : `/${host}${rest ?? ''}`
  }
  if (!pathAndQuery.startsWith('/')) pathAndQuery = `/${pathAndQuery}`
  const hash = pathAndQuery.indexOf('#')
  if (hash >= 0) pathAndQuery = pathAndQuery.slice(0, hash)
  const [pathPart, query = ''] = pathAndQuery.split('?', 2) as [string, string?]
  const segments = pathPart
    .split('/')
    .filter((s) => s.length > 0 && !(s.startsWith('(') && s.endsWith(')')))
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
  return { path: `/${segments.join('/')}`, params: new URLSearchParams(query) }
}

const first = (params: URLSearchParams, ...names: string[]) => {
  for (const name of names) {
    const value = params.get(name)
    if (value && value.trim()) return value.trim()
  }
  return null
}

/**
 * Resolve any link the app can receive. Returns null when the link names
 * nothing the app has a screen for; the caller then opens Home or hands the
 * link to the web.
 */
export function resolveLink(input: string): ResolvedLink | null {
  const parsed = normaliseLinkPath(input)
  if (!parsed) return null
  const { path, params } = parsed
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return { route: '/', projectId: null }
  const head = segments[0]!

  // The Projects tab itself; anything else under /projects must name a real project.
  if (head === 'projects' && segments.length === 1) return { route: '/projects', projectId: null }
  if (head === 'projects' && !(segments[1] && UUID.test(segments[1]))) return null

  // The web platform's project-scoped paths: /projects/:projectId/:module[/:child][?recordId=&source=]
  if (head === 'projects' && segments[1] && UUID.test(segments[1])) {
    const projectId = segments[1]
    const module = segments[2] ?? null
    const child = segments[3] ?? null
    const recordId = first(params, 'recordId', 'id')
    const source = first(params, 'source', 'recordType', 'type')
    if (recordId) {
      const type = source ?? (child ? RECORD_TYPE_BY_SLUG[child] : null) ?? (module ? RECORD_TYPE_BY_SLUG[module] : null)
      const route = appRouteForRecord(type, recordId)
      if (route) return { route, projectId }
    }
    if (module === 'site-reporting' || module === 'daily-log' || module === 'daily-logs') {
      const date = first(params, 'date') ?? (child && DAY.test(child) ? child : null)
      return { route: date ? `/site?date=${date}` : '/site', projectId }
    }
    const home = (child ? HOME_BY_MODULE[`${module}/${child}`] : null) ?? (module ? HOME_BY_MODULE[module] : null)
    if (home) return { route: home, projectId }
    if (!module) return { route: '/', projectId }
    return null
  }

  // The web platform's project-less paths.
  if (head === 'tasks' && segments.length === 1) {
    const recordId = first(params, 'recordId', 'taskId', 'id')
    return { route: recordId ? `/tasks/${recordId}` : '/tasks', projectId: null }
  }
  if (head === 'inventory' && segments.length === 1 && params.has('orderRef')) return { route: '/inventory/receive', projectId: null }

  // The app's own routes, from the scheme or from expo-router itself.
  if (APP_ROOTS.includes(head)) {
    const query = params.toString()
    return { route: `${path}${query ? `?${query}` : ''}`, projectId: first(params, 'projectId') }
  }
  return null
}

/** A push notification's data, or a notification row, as the app route it names. */
export function resolveNotificationData(data: { entityType?: string | null; entityId?: string | null; projectId?: string | null; url?: string | null; actionUrl?: string | null } | null | undefined): ResolvedLink | null {
  if (!data) return null
  const direct = appRouteForRecord(data.entityType, data.entityId)
  if (direct) return { route: direct, projectId: data.projectId ?? null }
  const url = data.url ?? data.actionUrl
  return url ? resolveLink(url) : null
}

/** The route the app navigates to for a resolved link: the opener when a project switch is needed, the record otherwise. */
export function routeForResolvedLink(link: ResolvedLink, currentProjectId: string | null): string {
  if (link.projectId && link.projectId !== currentProjectId) {
    return `/open?to=${encodeURIComponent(link.route)}&projectId=${encodeURIComponent(link.projectId)}`
  }
  return link.route
}
