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
  const record = useAiDrawer((state) => state.record)
  // `/projects/{id}/{module-slug}/{child}` (OCTA-FE-ROUTES-008); a link may
  // still carry them as `?module=…&child=…`.
  const match = /^(?:\/o\/[^/]+)?\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(location.pathname)
  const search = (location.search ?? {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
  const projectId = match?.[1] ?? null
  const module = projectId
    ? ((match?.[2] ? moduleFromSlug(decodeURIComponent(match[2])) : null) ?? text(search.module) ?? 'overview')
    : null
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
  label: screen.record?.label ?? null,
  recordType: screen.record?.recordType ?? null,
  recordId: screen.record?.recordId ?? null,
})
