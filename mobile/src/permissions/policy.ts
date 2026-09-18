/**
 * The permission policy the server enforces, read on the client.
 *
 * `policy.json` is copied from shared/permissions.json at build time, so what
 * the app hides is what the server refuses. That is the whole point: a control
 * the person cannot use is not shown, and a control that is shown will not be
 * refused. The server stays authoritative; this only decides what to draw.
 */
import policy from './generated/policy.json'

export type RoleId =
  | 'pm'
  | 'planning_eng'
  | 'qs'
  | 'cost_controller'
  | 'procurement'
  | 'warehouse'
  | 'site_engineer'
  | 'quality_engineer'
  | 'finance'

export type ActionId = 'read' | 'create' | 'update' | 'delete' | 'submit' | 'approve' | 'certify' | 'baseline' | 'export'

interface ModulePolicy {
  label: string
  actions: Partial<Record<ActionId, RoleId[]>>
  transitions?: Record<string, RoleId[]>
}

interface Policy {
  version?: number | string
  roles: { id: RoleId; label: string }[]
  modules: Record<string, ModulePolicy>
}

const POLICY = policy as unknown as Policy

export const ROLES: readonly { id: RoleId; label: string }[] = POLICY.roles

export const roleLabel = (role: string | null | undefined): string =>
  POLICY.roles.find((r) => r.id === role)?.label ?? 'Team member'

export const moduleLabel = (module: string): string => POLICY.modules[module]?.label ?? module

export const moduleIds = (): string[] => Object.keys(POLICY.modules)

/** May this role perform this action on this module, by the default policy? */
export function can(role: string | null | undefined, module: string, action: ActionId): boolean {
  if (!role) return false
  const roles = POLICY.modules[module]?.actions?.[action]
  return Array.isArray(roles) && roles.includes(role as RoleId)
}

/** May this role perform a named transition, such as "rfi.close"? */
export function canTransition(role: string | null | undefined, transition: string): boolean {
  if (!role) return false
  const [module] = transition.split('.')
  const roles = module ? POLICY.modules[module]?.transitions?.[transition] : undefined
  return Array.isArray(roles) && roles.includes(role as RoleId)
}

/** Every transition the policy names for a module, with who may perform it. */
export function transitionsOf(module: string): Record<string, RoleId[]> {
  return POLICY.modules[module]?.transitions ?? {}
}

/** The modules this role can read at all: what its navigation should contain. */
export function readableModules(role: string | null | undefined): string[] {
  return moduleIds().filter((module) => can(role, module, 'read'))
}
