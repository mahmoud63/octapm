/**
 * Where a record lives, and how to get there.
 *
 * Until a record type has its own screen in the app, the person is handed
 * over to the web platform at the exact record: the same path the web uses,
 * built from the target the server describes. The map of record types to
 * app screens grows milestone by milestone; anything not in it hands over.
 */
import * as WebBrowser from 'expo-web-browser'
import { env } from '@/config/env'
import type { Notification, RecordTarget, SearchItem } from '@/api/types'

/** Legacy module keys the server still emits, mapped to the web's slugs. */
const MODULE_SLUGS: Record<string, string> = {
  docControl: 'doc-control',
  documentControl: 'doc-control',
  document_control: 'doc-control',
  siteReporting: 'site-reporting',
  site_reporting: 'site-reporting',
  costControl: 'cost',
  cost_control: 'cost',
  longLead: 'schedule',
  long_lead: 'schedule',
}

const CHILD_SLUGS: Record<string, string> = {
  longLead: 'longLead',
  changeOrders: 'change-orders',
  change_orders: 'change-orders',
  payApps: 'pay-apps',
  pay_apps: 'pay-apps',
  subValuations: 'sub-valuations',
}

const query = (pairs: Record<string, string | null | undefined>) => {
  const parts = Object.entries(pairs)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

/** The web path for a server-described target. */
export function webPathForTarget(target: RecordTarget): string {
  const module = MODULE_SLUGS[target.module] ?? target.module
  const child = target.child ? (CHILD_SLUGS[target.child] ?? target.child) : null
  if (module === 'tasks' || target.recordType === 'task') return `/tasks${query({ recordId: target.recordId })}`
  if (module === 'inventory') return `/inventory${query({ orderRef: target.recordId })}`
  const base = `/projects/${target.projectId}/${module}${child ? `/${child}` : ''}`
  return base + query({ recordId: target.recordId, source: target.source ?? target.recordType, status: target.status })
}

/** The web path for a notification: the server's own link, with its one known quirk repaired. */
export function webPathForNotification(notification: Notification): string | null {
  const url = notification.actionUrl
  if (!url) return null
  const task = url.match(/[?&]module=tasks&taskId=([^&]+)/)
  if (task) return `/tasks?recordId=${task[1]}`
  return url
}

export function webPathForSearchItem(item: SearchItem): string {
  return item.url
}

/** Open a web-platform path in the system browser. The web signs the person in itself. */
export async function openOnWeb(path: string): Promise<void> {
  await WebBrowser.openBrowserAsync(`${env.webOrigin}${path.startsWith('/') ? path : `/${path}`}`)
}

/**
 * Record types that have a screen in the app, and the route that shows them.
 * Everything else hands over to the web. Grows with the milestones.
 */
const IN_APP_ROUTES: Record<string, (recordId: string) => string> = {
  rfi: (id) => `/rfi/${id}`,
  task: (id) => `/tasks/${id}`,
  sheet: (id) => `/drawings/${id}`,
  activity: (id) => `/activities/${id}`,
  progress_submission: (id) => `/activities/${id}`,
  daily_log: (id) => (/^\d{4}-\d{2}-\d{2}$/.test(id) ? `/site?date=${id}` : '/site'),
  photo: (id) => `/photos/${id}`,
  timesheet: (id) => `/timesheets/${id}`,
  form_instance: (id) => `/quality/inspections/${id}`,
  itp: (id) => `/quality/inspections/${id}`,
  punch_item: (id) => `/quality/punch/${id}`,
  observation: (id) => `/quality/punch/${id}`,
  defect: (id) => `/quality/punch/${id}`,
  ncr: (id) => `/quality/ncr/${id}`,
  safety_incident: (id) => `/quality/safety/${id}`,
  material_test: (id) => `/quality/tests/${id}`,
  inventory_item: (id) => `/inventory/items/${id}`,
  purchase_order: (id) => `/procurement/orders/${id}`,
  procurement_order: (id) => `/procurement/orders/${id}`,
  stock_transfer: (id) => `/inventory/transfers/${id}`,
  change_event: (id) => `/commercial/change-events/${id}`,
  change_order: (id) => `/commercial/change-orders/${id}`,
  commitment: (id) => `/commercial/commitments/${id}`,
  sub_pay_app: (id) => `/commercial/pay-apps/${id}`,
  procurement_package: (id) => `/procurement/packages/${id}`,
}

export function appRouteForRecord(recordType: string | null | undefined, recordId: string | null | undefined): string | null {
  if (!recordType || !recordId) return null
  const route = IN_APP_ROUTES[recordType]
  return route ? route(recordId) : null
}

/** Where a server target goes: an app route when the screen exists, otherwise the web path. */
export function destinationForTarget(target: RecordTarget): { app: string } | { web: string } {
  const app = appRouteForRecord(target.recordType ?? target.source, target.recordId)
  return app ? { app } : { web: webPathForTarget(target) }
}

export function destinationForSearchItem(item: SearchItem): { app: string } | { web: string } {
  const app = appRouteForRecord(item.type, item.id)
  return app ? { app } : { web: webPathForSearchItem(item) }
}

export function destinationForNotification(notification: Notification): { app: string } | { web: string } | null {
  const app = appRouteForRecord(notification.entityType, notification.entityId)
  if (app) return { app }
  const web = webPathForNotification(notification)
  return web ? { web } : null
}
