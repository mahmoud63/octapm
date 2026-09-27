/**
 * Deep links and universal links. Every way a link can reach the app ends
 * here: the `octapm://` scheme, an `https://app.octapm.com/...` universal
 * link, the web platform's own record paths (the same ones the server puts
 * in a notification's `actionUrl`), a push notification's data, and the
 * app's own routes. The result is an app route and, when the link names
 * them, the project the record belongs to and the workspace it lives in,
 * so the opener can switch both before the record is shown.
 *
 * A workspace is named by the web path's `/o/{slug}` segment, by an
 * `orgId` in a push payload or query, or by an `orgSlug`. The app's session
 * is bound to one workspace at a time, so a link into another workspace
 * always goes through the opener, which asks before switching (workspace
 * switching doc §5) — never a silent switch, never a silent drop.
 */
import { appRouteForRecord } from '@/navigation/links'

export interface ResolvedLink {
  /** The app route to open. */
  route: string
  /** The project the link names, when it does; the opener switches to it first. */
  projectId: string | null
  /** The workspace the link names by id, when it does (push payloads, app links). */
  orgId: string | null
  /** The workspace the link names by its URL handle, when it does (web paths under /o/{slug}). */
  orgSlug: string | null
}

/** What the app knows about the workspace it is in, for deciding whether a link leaves it. */
export interface ActiveWorkspace {
  orgId: string | null
  slug: string | null
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

/** The path and query of any link form, without scheme, host or expo-router group segments, and the workspace handle the path carried. */
export function normaliseLinkPath(input: string): { path: string; params: URLSearchParams; workspace: string | null } | null {
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
  // Web links carry the workspace first (`/o/{workspace}/projects/…`, ENT-4).
  // The handle is kept beside the path: the path underneath resolves as
  // before, and the opener compares the handle with the active workspace.
  let workspace: string | null = null
  if (segments[0] === 'o' && segments.length >= 2) {
    workspace = segments[1]!
    segments.splice(0, 2)
  }
  return { path: `/${segments.join('/')}`, params: new URLSearchParams(query), workspace }
}

const first = (params: URLSearchParams, ...names: string[]) => {
  for (const name of names) {
    const value = params.get(name)
    if (value && value.trim()) return value.trim()
  }
  return null
}

const link = (route: string, projectId: string | null, workspace: { orgId?: string | null; orgSlug?: string | null }): ResolvedLink => ({
  route,
  projectId,
  orgId: workspace.orgId ?? null,
  orgSlug: workspace.orgSlug ?? null,
})

/**
 * Resolve any link the app can receive. Returns null when the link names
 * nothing the app has a screen for; the caller then opens Home or hands the
 * link to the web.
 */
export function resolveLink(input: string): ResolvedLink | null {
  const parsed = normaliseLinkPath(input)
  if (!parsed) return null
  const { path, params } = parsed
  const workspace = { orgId: first(params, 'orgId'), orgSlug: parsed.workspace ?? first(params, 'orgSlug') }
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return link('/', null, workspace)
  const head = segments[0]!

  // The Projects tab itself; anything else under /projects must name a real project.
  if (head === 'projects' && segments.length === 1) return link('/projects', null, workspace)
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
      if (route) return link(route, projectId, workspace)
    }
    if (module === 'site-reporting' || module === 'daily-log' || module === 'daily-logs') {
      const date = first(params, 'date') ?? (child && DAY.test(child) ? child : null)
      return link(date ? `/site?date=${date}` : '/site', projectId, workspace)
    }
    const home = (child ? HOME_BY_MODULE[`${module}/${child}`] : null) ?? (module ? HOME_BY_MODULE[module] : null)
    if (home) return link(home, projectId, workspace)
    if (!module) return link('/', projectId, workspace)
    return null
  }

  // The web platform's project-less paths.
  if (head === 'tasks' && segments.length === 1) {
    const recordId = first(params, 'recordId', 'taskId', 'id')
    return link(recordId ? `/tasks/${recordId}` : '/tasks', null, workspace)
  }
  if (head === 'inventory' && segments.length === 1 && params.has('orderRef')) return link('/inventory/receive', null, workspace)

  // The app's own routes, from the scheme or from expo-router itself. The
  // workspace parameters are the opener's, not the screen's.
  if (APP_ROOTS.includes(head)) {
    const own = new URLSearchParams(params)
    own.delete('orgId')
    own.delete('orgSlug')
    const query = own.toString()
    return link(`${path}${query ? `?${query}` : ''}`, first(params, 'projectId'), workspace)
  }
  return null
}

export interface NotificationLinkData {
  entityType?: string | null
  entityId?: string | null
  projectId?: string | null
  url?: string | null
  actionUrl?: string | null
  orgId?: string | null
  orgSlug?: string | null
  membershipId?: string | null
}

/** A push notification's data, or a notification row, as the app route it names — with the workspace the payload carries. */
export function resolveNotificationData(data: NotificationLinkData | null | undefined): ResolvedLink | null {
  if (!data) return null
  const workspace = { orgId: data.orgId ?? null, orgSlug: data.orgSlug ?? null }
  const direct = appRouteForRecord(data.entityType, data.entityId)
  if (direct) return link(direct, data.projectId ?? null, workspace)
  const url = data.url ?? data.actionUrl
  const resolved = url ? resolveLink(url) : null
  if (!resolved) return null
  // The payload's own naming of the workspace wins over what the URL carries.
  return { ...resolved, orgId: workspace.orgId ?? resolved.orgId, orgSlug: workspace.orgSlug ?? resolved.orgSlug }
}

/**
 * Whether a link names a workspace other than the active one. A link that
 * names none belongs to the active workspace, as every link did before the
 * app knew workspaces. Ids are compared when both sides have one, handles
 * otherwise; a link that names a workspace while the app does not know its
 * own is taken to another, so the opener asks the server rather than guess.
 */
export function linkLeavesWorkspace(target: Pick<ResolvedLink, 'orgId' | 'orgSlug'>, active: ActiveWorkspace | null | undefined): boolean {
  if (!target.orgId && !target.orgSlug) return false
  if (target.orgId && active?.orgId) return target.orgId !== active.orgId
  if (target.orgSlug && active?.slug) return target.orgSlug !== active.slug
  return true
}

const openerRoute = (link: ResolvedLink) => {
  const query = new URLSearchParams({ to: link.route })
  if (link.projectId) query.set('projectId', link.projectId)
  if (link.orgId) query.set('orgId', link.orgId)
  if (link.orgSlug) query.set('orgSlug', link.orgSlug)
  return `/open?${query.toString()}`
}

/**
 * The route the app navigates to for a resolved link: the opener when the
 * workspace or the project must change, the record otherwise. Without an
 * `active` workspace the caller does not know, and only the project decides.
 */
export function routeForResolvedLink(link: ResolvedLink, currentProjectId: string | null, active?: ActiveWorkspace | null): string {
  if (active !== undefined && linkLeavesWorkspace(link, active)) return openerRoute(link)
  if (link.projectId && link.projectId !== currentProjectId) return openerRoute({ ...link, orgId: null, orgSlug: null })
  return link.route
}
