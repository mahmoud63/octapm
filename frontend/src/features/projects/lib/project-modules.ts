import type { PermissionMatrix, PermissionModule } from '@/lib/permissions'

/**
 * Project workspace modules and their URL slugs (OCTA-FE-ROUTES-008).
 * The workspace lives at `/projects/$projectId/$module/$child`; every module
 * and sub-tab is a bookmarkable address, and each module loads as its own
 * chunk.
 */
export type ModuleKey =
  | 'capture'
  | 'schedule'
  | 'siteReporting'
  | 'cost'
  | 'commercial'
  | 'quality'
  | 'docControl'
  | 'meetings'
  | 'activities'
  | 'equipment'
  | 'locations'
  | 'photos'
  | 'team'
  | 'reports'
  | 'overview'
  | 'boq'
  | 'bim'

export type ModuleWithChildren =
  | 'schedule'
  | 'cost'
  | 'commercial'
  | 'quality'
  | 'docControl'

export const DEFAULT_MODULE: ModuleKey = 'schedule'

export const MODULE_SLUGS: Record<ModuleKey, string> = {
  capture: 'capture',
  schedule: 'schedule',
  siteReporting: 'site-reporting',
  cost: 'cost',
  commercial: 'commercial',
  quality: 'quality',
  docControl: 'doc-control',
  meetings: 'meetings',
  activities: 'activities',
  equipment: 'equipment',
  locations: 'locations',
  photos: 'photos',
  team: 'team',
  reports: 'reports',
  overview: 'overview',
  boq: 'boq',
  bim: 'bim',
}

const MODULE_BY_SLUG: Record<string, ModuleKey> = Object.fromEntries(
  (Object.entries(MODULE_SLUGS) as Array<[ModuleKey, string]>).map(
    ([key, slug]) => [slug, key]
  )
)

export const DEFAULT_CHILD: Record<ModuleWithChildren, string> = {
  schedule: 'gantt',
  cost: 'overview',
  commercial: 'change-orders',
  quality: 'ncr',
  docControl: 'rfi',
}

export const isModuleKey = (value: unknown): value is ModuleKey =>
  typeof value === 'string' && value in MODULE_SLUGS

export const isModuleWithChildren = (
  module: ModuleKey
): module is ModuleWithChildren => module in DEFAULT_CHILD

/** Accepts either a URL slug or a legacy module key (`?module=docControl`). */
export const moduleFromSlug = (
  value: string | null | undefined
): ModuleKey | null => {
  if (!value) return null
  if (MODULE_BY_SLUG[value]) return MODULE_BY_SLUG[value]
  if (isModuleKey(value)) return value
  return null
}

export const slugForModule = (module: ModuleKey) => MODULE_SLUGS[module]

/**
 * Which permission modules back each workspace module. A workspace module is
 * hidden when the resolved permission matrix marks every backing module as
 * not visible (level `none`). Modules with no entry are always shown.
 */
export const MODULE_PERMISSIONS: Partial<
  Record<ModuleKey, PermissionModule[]>
> = {
  capture: ['punch', 'inspection', 'progress'],
  schedule: ['schedule'],
  siteReporting: ['progress'],
  cost: ['cost'],
  commercial: ['change_order', 'ipc', 'eot', 'commitment', 'sub_pay_app'],
  quality: ['ncr', 'safety', 'punch', 'inspection'],
  docControl: ['document_control', 'rfi', 'submittal'],
  meetings: ['meeting'],
  boq: ['boq'],
  bim: ['bim'],
  activities: ['schedule'],
  equipment: ['schedule', 'cost'],
  locations: ['location'],
  photos: ['document_control'],
  reports: ['schedule'],
}

export const isModuleVisible = (
  matrix: PermissionMatrix | null | undefined,
  key: ModuleKey
) => {
  const backing = MODULE_PERMISSIONS[key]
  if (!matrix || !backing?.length) return true
  return backing.some((module) => {
    const entry = matrix.modules[module]
    return entry ? entry.visible : true
  })
}
