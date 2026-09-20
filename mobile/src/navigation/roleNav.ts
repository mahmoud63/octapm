/**
 * What this person's app looks like.
 *
 * Role decides what the app EMPHASISES; permission decides what they MAY do.
 * Nothing here authorises anything: every entry names the module and action
 * the server must already allow, and an entry whose permission is missing is
 * not drawn. Never branch on a role to grant a right — ask `allows()`.
 *
 * The resolver takes the whole context (role, permission matrix, company-admin
 * capability, whether a project is chosen) rather than a hard-coded screen
 * list, so a future per-project role or a second role needs a change here and
 * nowhere else.
 */
import type { PermissionMatrix } from '@/api/types'
import { allows } from '@/permissions/usePermissions'
import type { ActionId, RoleId } from '@/permissions/policy'

export interface NavSlot {
  /** The expo-router segment this tab owns, e.g. 'index', 'site', 'quality'. */
  name: string
  title: string
  icon: string
  /** The module/action the server must allow for this slot to be drawn. */
  module?: string
  action?: ActionId
  /** The centre capture action rather than a destination. */
  capture?: boolean
}

export interface NavContext {
  role: RoleId | string | null | undefined
  matrix: PermissionMatrix | undefined
  isCompanyAdmin?: boolean
  hasProject: boolean
}

const HOME: NavSlot = { name: 'index', title: 'Home', icon: 'home-outline' }
const TODAY: NavSlot = { name: 'index', title: 'Today', icon: 'today-outline' }
const NEEDS_YOU: NavSlot = { name: 'needs-you', title: 'Needs You', icon: 'hand-right-outline' }
const MORE: NavSlot = { name: 'more', title: 'More', icon: 'ellipsis-horizontal-outline' }
const CAPTURE: NavSlot = { name: 'capture', title: 'Capture', icon: 'add-circle', capture: true }

/**
 * The five slots each role gets, in order. The centre slot is Capture for the
 * roles whose day is spent recording what happened, and a second analytical
 * destination for the roles whose day is spent deciding.
 */
const BY_ROLE: Record<string, NavSlot[]> = {
  pm: [HOME, NEEDS_YOU, { name: 'project', title: 'Project', icon: 'business-outline' }, { name: 'controls', title: 'Controls', icon: 'speedometer-outline' }, MORE],
  site_engineer: [
    TODAY,
    { name: 'site', title: 'Site', icon: 'construct-outline', module: 'progress', action: 'read' },
    CAPTURE,
    { name: 'drawings', title: 'Drawings', icon: 'map-outline', module: 'document_control', action: 'read' },
    MORE,
  ],
  quality_engineer: [
    HOME,
    { name: 'quality', title: 'Inspections', icon: 'checkbox-outline', module: 'inspection', action: 'read' },
    CAPTURE,
    { name: 'issues', title: 'Issues', icon: 'warning-outline', module: 'ncr', action: 'read' },
    MORE,
  ],
  warehouse: [
    HOME,
    { name: 'scan', title: 'Scan', icon: 'scan-outline', module: 'inventory', action: 'read' },
    { name: 'receive', title: 'Receive', icon: 'cube-outline', module: 'inventory', action: 'create' },
    { name: 'inventory', title: 'Stock', icon: 'file-tray-stacked-outline', module: 'inventory', action: 'read' },
    MORE,
  ],
  procurement: [
    HOME,
    { name: 'procurement', title: 'Orders', icon: 'receipt-outline', module: 'procurement', action: 'read' },
    { name: 'deliveries', title: 'Deliveries', icon: 'car-outline', module: 'procurement', action: 'read' },
    { name: 'suppliers', title: 'Suppliers', icon: 'people-outline', module: 'procurement', action: 'read' },
    MORE,
  ],
  planning_eng: [
    HOME,
    { name: 'activities', title: 'Schedule', icon: 'git-branch-outline', module: 'schedule', action: 'read' },
    { name: 'lookahead', title: 'Lookahead', icon: 'calendar-outline', module: 'lookahead', action: 'read' },
    { name: 'progress', title: 'Progress', icon: 'trending-up-outline', module: 'progress', action: 'read' },
    MORE,
  ],
  // qs, cost_controller and finance share a commercial shape until UX2-I
  // gives each its own destination; their homes already differ.
  qs: [HOME, NEEDS_YOU, { name: 'commercial', title: 'Commercial', icon: 'cash-outline', module: 'change_order', action: 'read' }, { name: 'workflow', title: 'Approvals', icon: 'checkmark-done-outline', module: 'workflow', action: 'read' }, MORE],
  cost_controller: [HOME, NEEDS_YOU, { name: 'commercial', title: 'Commercial', icon: 'cash-outline', module: 'change_order', action: 'read' }, { name: 'workflow', title: 'Approvals', icon: 'checkmark-done-outline', module: 'workflow', action: 'read' }, MORE],
  finance: [HOME, NEEDS_YOU, { name: 'commercial', title: 'Commercial', icon: 'cash-outline', module: 'commitment', action: 'read' }, { name: 'workflow', title: 'Approvals', icon: 'checkmark-done-outline', module: 'workflow', action: 'read' }, MORE],
}

/** What a role we have never seen gets: the safe, general shape. */
const FALLBACK: NavSlot[] = [HOME, NEEDS_YOU, { name: 'projects', title: 'Projects', icon: 'business-outline' }, { name: 'search', title: 'Search', icon: 'search-outline' }, MORE]

/**
 * The tabs this person sees. A slot whose permission the server has not
 * granted is dropped and the bar simply gets shorter — it is never padded
 * with something the person cannot use.
 */
export function resolveTabs(context: NavContext): NavSlot[] {
  const base = BY_ROLE[String(context.role ?? '')] ?? FALLBACK
  return base.filter((slot) => {
    if (!slot.module || !slot.action) return true
    return allows(context.matrix, slot.module, slot.action)
  })
}

export interface CaptureAction {
  id: string
  title: string
  icon: string
  module: string
  action: ActionId
  route: string
}

/**
 * What the centre button offers. Ordered by how often the role reaches for it;
 * filtered, as always, by what the server allows.
 */
const CAPTURE_ACTIONS: readonly CaptureAction[] = [
  { id: 'photo', title: 'Site photo', icon: 'camera-outline', module: 'document_control', action: 'create', route: '/photos?add=1' },
  { id: 'progress', title: 'Update progress', icon: 'trending-up-outline', module: 'progress', action: 'submit', route: '/activities?today=1' },
  { id: 'daily-log', title: 'Daily report', icon: 'today-outline', module: 'progress', action: 'submit', route: '/site' },
  { id: 'rfi', title: 'Raise RFI', icon: 'help-circle-outline', module: 'rfi', action: 'create', route: '/rfi/new' },
  { id: 'punch', title: 'Punch item', icon: 'flag-outline', module: 'punch', action: 'create', route: '/quality/punch/new' },
  { id: 'ncr', title: 'Raise NCR', icon: 'alert-circle-outline', module: 'ncr', action: 'create', route: '/quality/ncr/new' },
  { id: 'safety', title: 'Safety observation', icon: 'shield-outline', module: 'safety', action: 'create', route: '/quality/safety/new' },
  { id: 'inspection', title: 'Inspection', icon: 'checkbox-outline', module: 'inspection', action: 'create', route: '/quality/inspections/new' },
  { id: 'goods-in', title: 'Goods receipt', icon: 'cube-outline', module: 'inventory', action: 'create', route: '/inventory/receive' },
  { id: 'task', title: 'Task', icon: 'checkmark-circle-outline', module: 'task', action: 'create', route: '/tasks' },
]

/** The role's preferred order; anything else it may do follows. */
const CAPTURE_ORDER: Record<string, string[]> = {
  site_engineer: ['progress', 'photo', 'rfi', 'daily-log', 'task', 'punch'],
  quality_engineer: ['inspection', 'photo', 'ncr', 'punch', 'safety'],
  warehouse: ['goods-in', 'photo', 'task'],
  procurement: ['photo', 'task', 'rfi'],
  pm: ['photo', 'rfi', 'task'],
  planning_eng: ['progress', 'photo', 'task'],
}

export function resolveCaptureActions(context: NavContext): CaptureAction[] {
  const allowed = CAPTURE_ACTIONS.filter((a) => allows(context.matrix, a.module, a.action))
  const order = CAPTURE_ORDER[String(context.role ?? '')]
  if (!order) return allowed
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i < 0 ? order.length + 1 : i
  }
  return allowed.slice().sort((a, b) => rank(a.id) - rank(b.id))
}

export interface MoreEntry {
  id: string
  title: string
  route: string
  module?: string
  action?: ActionId
}

export interface MoreGroup {
  title: string
  entries: MoreEntry[]
}

const MODULE_DIRECTORY: MoreEntry[] = [
  { id: 'site', title: 'Daily report', route: '/site', module: 'progress', action: 'read' },
  { id: 'activities', title: 'Schedule', route: '/activities', module: 'schedule', action: 'read' },
  { id: 'lookahead', title: 'Lookahead', route: '/activities/lookahead', module: 'lookahead', action: 'read' },
  { id: 'quality', title: 'Quality', route: '/quality', module: 'inspection', action: 'read' },
  { id: 'rfi', title: 'RFIs', route: '/rfi', module: 'rfi', action: 'read' },
  { id: 'tasks', title: 'Tasks', route: '/tasks', module: 'task', action: 'read' },
  { id: 'drawings', title: 'Drawings', route: '/drawings', module: 'document_control', action: 'read' },
  { id: 'documents', title: 'Documents', route: '/documents', module: 'document_control', action: 'read' },
  { id: 'photos', title: 'Photos', route: '/photos', module: 'document_control', action: 'read' },
  { id: 'inventory', title: 'Inventory', route: '/inventory', module: 'inventory', action: 'read' },
  { id: 'procurement', title: 'Procurement', route: '/procurement', module: 'procurement', action: 'read' },
  { id: 'commercial', title: 'Commercial', route: '/commercial', module: 'change_event', action: 'read' },
  { id: 'workflow', title: 'Approvals', route: '/workflow', module: 'workflow', action: 'read' },
  { id: 'timesheets', title: 'Timesheets', route: '/timesheets', module: 'timesheet', action: 'read' },
]

/** The "me" layer: mine wherever I am, and not a project module. */
const PERSONAL: MoreEntry[] = [
  { id: 'notifications', title: 'Notifications', route: '/notifications' },
  { id: 'outbox', title: 'Waiting to send', route: '/outbox' },
]

const ADMINISTRATION: MoreEntry[] = [
  { id: 'users', title: 'People and permissions', route: '/admin/users', module: 'user_management', action: 'read' },
  { id: 'parties', title: 'Companies on this project', route: '/admin/parties', module: 'project_parties', action: 'read' },
]

/**
 * More is the module directory plus, for a company administrator, the
 * administration group. The directory is navigation — it is never the
 * dashboard, and it never appears above a role's own content.
 */
export function resolveMore(context: NavContext): MoreGroup[] {
  const permitted = (entries: MoreEntry[]) => entries.filter((e) => !e.module || !e.action || allows(context.matrix, e.module, e.action))
  const groups: MoreGroup[] = [{ title: 'You', entries: PERSONAL }]
  const modules = context.hasProject ? permitted(MODULE_DIRECTORY) : []
  if (modules.length) groups.push({ title: 'Project modules', entries: modules })
  // The admin overlay: a capability on top of whatever role the person holds,
  // not a tenth role. Permission still decides each entry.
  if (context.isCompanyAdmin) {
    const admin = permitted(ADMINISTRATION)
    if (admin.length) groups.push({ title: 'Administration', entries: admin })
  }
  return groups
}

/** Every tab name the shell knows about, so the layout can hide the rest. */
export const ALL_SLOT_NAMES: readonly string[] = Array.from(new Set(Object.values(BY_ROLE).concat([FALLBACK]).flat().map((s) => s.name)))
