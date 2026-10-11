import { useLocation } from '@tanstack/react-router'
import { useAiDrawer, type AiRecordContext } from '@/stores/ai-drawer-store'
import { moduleFromSlug } from '@/features/projects/lib/project-modules'

/**
 * Where Ask OctaPM was opened from: the project, module and sub-tab in the
 * URL (`/projects/{id}?module=…&child=…&recordId=…`) and the record an AI
 * action named. Labels only: the server decides what the caller may read.
 */

const MODULE_LABELS: Record<string, string> = {
  overview: 'Overview',
  capture: 'Capture',
  schedule: 'Schedule',
  siteReporting: 'Site Reporting',
  cost: 'Cost Control',
  commercial: 'Commercial',
  procurement: 'Procurement',
  quality: 'Quality',
  docControl: 'Documents',
  meetings: 'Meetings',
  boq: 'BOQ',
  bim: 'BIM / 5D',
  closeout: 'Closeout / Turnover',
  reports: 'Reports',
  inventory: 'Inventory',
}

const pretty = (value: string) =>
  value
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (letter) => letter.toUpperCase())

export interface AiScreenContext {
  projectId: string | null
  module: string | null
  moduleLabel: string | null
  child: string | null
  childLabel: string | null
  route: string
  record: AiRecordContext | null
}

export const useAiScreenContext = (): AiScreenContext => {
  const location = useLocation()
  const namedRecord = useAiDrawer((state) => state.record)
  const recordPath = useAiDrawer((state) => state.recordPath)
  // A record an action named applies on its own page; navigate away and the
  // drawer follows the new screen instead.
  const record = namedRecord && recordPath === location.pathname ? namedRecord : null
  // `/projects/{id}/{module-slug}/{child}` (OCTA-FE-ROUTES-008); a link may
  // still carry them as `?module=…&child=…`.
  const match = /^(?:\/o\/[^/]+)?\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(location.pathname)
  const search = (location.search ?? {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
  const projectId = match?.[1] ?? null
  // A company screen outside any project (Inventory…).
  const companyScreen = projectId
    ? null
    : (/^(?:\/o\/[^/]+)?\/(inventory)(?:\/|$)/.exec(location.pathname)?.[1] ?? null)
  const module = projectId
    ? ((match?.[2] ? moduleFromSlug(decodeURIComponent(match[2])) : null) ?? text(search.module) ?? 'overview')
    : companyScreen
  const child = projectId ? ((match?.[3] ? decodeURIComponent(match[3]) : null) ?? text(search.child)) : null
  return {
    projectId,
    module,
    moduleLabel: module ? (MODULE_LABELS[module] ?? pretty(module)) : null,
    child,
    childLabel: child ? pretty(child) : null,
    route: location.pathname,
    record,
  }
}

/** The context sent with a question: labels and, when an action named one, the record. */
export const askContextOf = (screen: AiScreenContext) => ({
  module: screen.moduleLabel,
  moduleKey: screen.module,
  child: screen.childLabel,
  childKey: screen.child,
  label: screen.record?.label ?? null,
  recordType: screen.record?.recordType ?? null,
  recordId: screen.record?.recordId ?? null,
})
