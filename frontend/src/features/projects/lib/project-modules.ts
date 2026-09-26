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
  | 'procurement'
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
  | 'controls'

export type ModuleWithChildren =
  | 'schedule'
  | 'cost'
  | 'commercial'
  | 'procurement'
  | 'quality'
  | 'docControl'
  | 'controls'

export const DEFAULT_MODULE: ModuleKey = 'schedule'

export const MODULE_SLUGS: Record<ModuleKey, string> = {
  capture: 'capture',
  schedule: 'schedule',
  siteReporting: 'site-reporting',
  cost: 'cost',
  commercial: 'commercial',
  procurement: 'procurement',
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
  controls: 'controls',
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
  procurement: 'purchase-orders',
  quality: 'ncr',
  docControl: 'rfi',
  controls: 'structure',
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
  procurement: ['procurement'],
  quality: ['ncr', 'safety', 'punch', 'inspection'],
  docControl: ['document_control', 'rfi', 'submittal'],
  meetings: ['meeting'],
  boq: ['boq'],
  bim: ['bim'],
  // Project Controls pages reuse boq read/update (integration doc §2): no
  // new catalogue module gates them.
  controls: ['boq'],
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

/**
 * Which permission module backs a sub-tab, where it differs from the module's
 * own set (Phase 22B). A sub-tab with no entry follows its module. A sub-tab
 * is offered when any of its backing modules is visible.
 */
export const CHILD_PERMISSIONS: Partial<
  Record<ModuleWithChildren, Record<string, PermissionModule[]>>
> = {
  commercial: {
    'client-billing': ['ipc'],
    'change-events': ['change_event'],
    'change-orders': ['change_order'],
    commitments: ['commitment'],
    'pay-apps': ['sub_pay_app'],
    bids: ['bid'],
    ipc: ['ipc'],
    'sub-valuations': ['sub_pay_app'],
    'budget-revisions': ['cost', 'change_order'],
    'cash-flow': ['cost', 'ipc'],
    eot: ['eot'],
    weather: ['eot'],
    contract: ['ipc', 'commitment'],
  },
  quality: {
    ncr: ['ncr'],
    itp: ['inspection'],
    defects: ['punch'],
    observations: ['inspection'],
    safety: ['safety'],
    tests: ['ncr'],
  },
  docControl: {
    rfi: ['rfi'],
    submittals: ['submittal'],
  },
}

export const isChildVisible = (
  matrix: PermissionMatrix | null | undefined,
  module: ModuleKey,
  child: string
) => {
  const backing = isModuleWithChildren(module)
    ? CHILD_PERMISSIONS[module]?.[child]
    : undefined
  if (!matrix || !backing?.length) return true
  return backing.some((permission) => {
    const entry = matrix.modules[permission]
    return entry ? entry.visible : true
  })
}
