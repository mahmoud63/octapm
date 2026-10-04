import { useEffect } from 'react'
import { useLocation } from '@tanstack/react-router'
import { apiClient } from '@/services/api/client'
import { useAuthStore } from '@/stores/auth-store'
import { stripWorkspacePrefix } from '@/lib/workspace/paths'

/**
 * Product usage: which screens people open (docs/platform/OCTAPM_SUPERADMIN_DESIGN.md §5).
 *
 * Sends only a catalogue name (`boq.opened`) and the project id from the URL —
 * never page content, search text or query strings. The server drops unknown
 * names and projects outside the caller's workspace. Batched (at most 20 per
 * call, every 10 s), the same screen counted once per 5 minutes, and every
 * failure swallowed: usage reporting can never disturb the app.
 */

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const FLUSH_MS = 10_000
const DEDUPE_MS = 5 * 60_000
const MAX_BATCH = 20

// Project workspace module slug (+ optional child) → catalogue module.
const PROJECT_MODULES: Record<
  string,
  string | ((child: string | undefined) => string)
> = {
  boq: 'boq',
  schedule: 'schedule',
  activities: 'schedule',
  controls: (child) => (child === 'mapping' ? 'mapping' : 'projects'),
  capture: 'progress',
  'site-reporting': 'daily_reports',
  cost: 'cost',
  commercial: (child) =>
    child === 'change-orders' || child === 'change-events'
      ? 'changes'
      : 'commercial',
  procurement: 'procurement',
  quality: 'quality',
  'doc-control': (child) =>
    child === 'rfi' || child === undefined
      ? 'rfi'
      : child === 'submittals'
        ? 'submittals'
        : child === 'drawings'
          ? 'drawings'
          : 'documents',
  photos: 'documents',
  meetings: 'meetings',
  reports: 'reports',
  overview: 'projects',
  team: 'projects',
  locations: 'projects',
}

// Workspace-level pages.
const WORKSPACE_PAGES: Record<string, string> = {
  '': 'dashboard',
  projects: 'projects',
  tasks: 'tasks',
  inventory: 'inventory',
  reports: 'reports',
  company: 'company_admin',
}

export type ScreenEvent = { name: string; projectId?: string }

/** `/o/acme/projects/<id>/doc-control/rfi` → { name: 'rfi.opened', projectId }. */
export const screenEventForPath = (pathname: string): ScreenEvent | null => {
  const segments = stripWorkspacePrefix(pathname).split('/').filter(Boolean)
  if (segments[0] === 'projects' && segments[1] && UUID.test(segments[1])) {
    const entry = PROJECT_MODULES[segments[2] ?? 'overview']
    if (!entry) return null
    const module = typeof entry === 'function' ? entry(segments[3]) : entry
    return { name: `${module}.opened`, projectId: segments[1] }
  }
  if (segments.length > 1) return null
  const module = WORKSPACE_PAGES[segments[0] ?? '']
  return module ? { name: `${module}.opened` } : null
}

const queue: ScreenEvent[] = []
const lastSent = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | null = null

const flush = () => {
  timer = null
  if (!queue.length) return
  const events = queue.splice(0, MAX_BATCH)
  apiClient.post('/telemetry/events', { events }).catch(() => undefined)
  if (queue.length) timer = setTimeout(flush, FLUSH_MS)
}

export const recordScreenOpen = (event: ScreenEvent, now = Date.now()) => {
  const key = `${event.name}:${event.projectId ?? ''}`
  const previous = lastSent.get(key)
  if (previous !== undefined && now - previous < DEDUPE_MS) return false
  lastSent.set(key, now)
  queue.push(event)
  if (queue.length >= MAX_BATCH) flush()
  else if (!timer) timer = setTimeout(flush, FLUSH_MS)
  return true
}

/** Mounted once in the signed-in layout. */
export function useScreenOpenTracking() {
  const { pathname } = useLocation()
  const signedIn = useAuthStore((s) =>
    Boolean(s.auth.accessToken && s.auth.user?.orgId)
  )
  useEffect(() => {
    if (!signedIn) return
    try {
      const event = screenEventForPath(pathname)
      if (event) recordScreenOpen(event)
    } catch {
      // Usage reporting never surfaces to the person.
    }
  }, [pathname, signedIn])
}
