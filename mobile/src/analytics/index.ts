/**
 * Product analytics, behind an allow-list.
 *
 * Only the event names below can be recorded, and only with the properties
 * named for them. Free text, financial values, record contents and photos
 * cannot get through this file because there is no field for them. Where the
 * events go is a separate decision: until a sink is configured they stay in
 * memory and are dropped.
 */
export type AnalyticsEvent =
  | { name: 'mobile_login'; method: 'password' | 'biometric' | 'restored' }
  | { name: 'mobile_logout' }
  | { name: 'project_opened'; widthClass: 'compact' | 'medium' | 'expanded' }
  | { name: 'needs_you_opened'; count: number }
  | { name: 'rfi_created'; offline: boolean }
  | { name: 'rfi_answered' }
  | { name: 'daily_log_submitted'; offline: boolean }
  | { name: 'inspection_completed'; result: 'pass' | 'fail' }
  | { name: 'ncr_created'; offline: boolean }
  | { name: 'punch_created'; offline: boolean }
  | { name: 'material_received' }
  | { name: 'material_issued' }
  | { name: 'task_completed' }
  | { name: 'photo_captured'; attachedTo: string }
  | { name: 'barcode_resolved'; kind: string }
  | { name: 'deep_link_opened'; recordType: string }
  | { name: 'notification_opened'; recordType: string }
  | { name: 'sync_completed'; sent: number; durationMs: number }
  | { name: 'sync_failed'; reason: 'offline' | 'auth' | 'server' | 'conflict' }
  | { name: 'sync_conflict'; recordType: string }
  | { name: 'permission_refused'; module: string }

type Sink = (event: AnalyticsEvent & { at: string; env: string; appVersion: string }) => void

let sink: Sink | null = null
const pending: (AnalyticsEvent & { at: string })[] = []

export const analytics = {
  track(event: AnalyticsEvent) {
    const stamped = { ...event, at: new Date().toISOString() }
    if (sink) {
      sink({ ...stamped, env: currentEnv, appVersion: currentVersion })
      return
    }
    pending.push(stamped)
    if (pending.length > 200) pending.shift()
  },
  /** Configure where events go. Until this is called, nothing leaves the device. */
  configure(next: Sink, meta: { env: string; appVersion: string }) {
    sink = next
    currentEnv = meta.env
    currentVersion = meta.appVersion
    for (const event of pending.splice(0)) sink({ ...event, env: meta.env, appVersion: meta.appVersion })
  },
  /** For tests and the diagnostics screen. */
  pending: () => pending.slice(),
}

let currentEnv = 'local'
let currentVersion = '0.0.0'
