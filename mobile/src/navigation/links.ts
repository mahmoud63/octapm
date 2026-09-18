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
