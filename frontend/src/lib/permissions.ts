import { createContext, createElement, useContext, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import permissionPolicyJson from '../../../shared/permissions.json'

export type PermissionAction =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'submit'
  | 'approve'
  | 'certify'
  | 'baseline'
  | 'export'

export type PermissionModule =
  | 'schedule'
  | 'progress'
  | 'boq'
  | 'ipc'
  | 'cost'
  | 'procurement'
  | 'risk'
  | 'user_management'
  | 'project_parties'
  | 'audit'
  | 'document_control'
  | 'rfi'
  | 'submittal'
  | 'ncr'
  | 'safety'
  | 'change_order'
  | 'eot'
  | 'meeting'
  | 'task'
  | 'location'
  | 'punch'
  | 'inspection'
  | 'commitment'
  | 'sub_pay_app'
  | 'report'
  | 'portfolio'
  | 'workflow'
  | 'custom_field'
  | 'bid'
  | 'assistant'
  | 'timesheet'
  | 'change_event'
  | 'lookahead'
  | 'conversation'
  | 'email'
  | 'bim'

export type RoleId =
  | 'pm'
  | 'planning_eng'
  | 'qs'
  | 'cost_controller'
  | 'procurement'
  | 'warehouse'
  | 'site_engineer'
  | 'finance'

export type ProjectPartyRole =
  | 'owner'
  | 'consultant'
  | 'contractor'
  | 'subcontractor'

export type PermissionLevel = 'none' | 'read_only' | 'standard' | 'admin'

/**
 * Effective permission matrix returned by `GET /auth/me/permissions`.
 * When present it is the source of truth: it already folds in permission
 * templates, party templates, assignment roles and company-admin status.
 */
export type PermissionMatrix = {
  orgId?: string | null
  projectId?: string | null
  userId?: string | null
  isCompanyAdmin: boolean
  source: 'template' | 'party_template' | 'assignment' | 'party' | 'org'
  role?: string | null
  partyRoles?: string[]
  template?: { id: string; name: string } | null
  modules: Partial<
    Record<
      PermissionModule,
      {
        label?: string
        level: PermissionLevel
        visible: boolean
        actions: PermissionAction[]
        transitions: string[]
      }
    >
  >
}

type PermissionPolicy = {
  version: string
  actions: PermissionAction[]
  roles: Array<{ id: RoleId; label: string }>
  partyRoles?: Array<{ id: ProjectPartyRole; label: string }>
  modules: Record<
    PermissionModule,
    {
      label: string
      actions: Record<PermissionAction, RoleId[]>
      transitions?: Record<string, RoleId[]>
    }
  >
  partyPermissions?: Record<
    ProjectPartyRole,
    {
      modules: Partial<
        Record<
          PermissionModule,
          {
            actions: PermissionAction[]
            transitions?: string[]
          }
        >
      >
    }
  >
}

export const permissionPolicy = permissionPolicyJson as PermissionPolicy
const roleAliases: Record<string, RoleId> = {
  pm: 'pm',
  project_manager: 'pm',
  project_manager_role: 'pm',
  'project manager': 'pm',
  planning_eng: 'planning_eng',
  planning_engineer: 'planning_eng',
  'planning engineer': 'planning_eng',
  qs: 'qs',
  quantity_surveyor: 'qs',
  'quantity surveyor': 'qs',
  cost_controller: 'cost_controller',
  'cost controller': 'cost_controller',
  procurement: 'procurement',
  warehouse: 'warehouse',
  site_engineer: 'site_engineer',
  'site engineer': 'site_engineer',
  finance: 'finance',
}

type ProjectPermissionContextValue = {
  role?: string | null
  effectiveRole?: string | null
  partyAccess?: Array<{
    role?: string | null
    projectPartyId?: string | null
    companyId?: string | null
  }>
  matrix?: PermissionMatrix | null
}

const ProjectPermissionContext =
  createContext<ProjectPermissionContextValue | null>(null)

export const normalizeRoleId = (role: string | null | undefined) => {
  if (!role) return null

  const trimmed = String(role).trim()
  const normalized = trimmed.toLowerCase().replace(/[-\s]+/g, '_')

  return roleAliases[normalized] ?? roleAliases[trimmed.toLowerCase()] ?? role
}

export const resolveEffectiveRole = ({
  authRole,
  projectRole,
  effectiveRole,
}: {
  authRole?: string | null
  projectRole?: string | null
  effectiveRole?: string | null
}) => normalizeRoleId(effectiveRole ?? projectRole ?? authRole)

export function ProjectPermissionProvider({
  role,
  effectiveRole,
  partyAccess,
  matrix,
  children,
}: {
  role?: string | null
  effectiveRole?: string | null
  partyAccess?: ProjectPermissionContextValue['partyAccess']
  matrix?: PermissionMatrix | null
  children: ReactNode
}) {
  const resolvedEffectiveRole = resolveEffectiveRole({
    projectRole: role,
    effectiveRole,
  })

  return createElement(
    ProjectPermissionContext.Provider,
    {
      value: {
        role: normalizeRoleId(role),
        effectiveRole: resolvedEffectiveRole,
        partyAccess,
        matrix: matrix ?? null,
      },
    },
    children
  )
}

export const useProjectEffectiveRole = () => {
  const context = useContext(ProjectPermissionContext)
  return context?.effectiveRole ?? context?.role ?? null
}

export const useProjectPermissionMatrix = () =>
  useContext(ProjectPermissionContext)?.matrix ?? null

/** The viewer's party memberships on the open project (empty for staff). */
export const useProjectPartyAccess = () =>
  useContext(ProjectPermissionContext)?.partyAccess ?? []

export const canPerform = (
  role: string | null | undefined,
  moduleName: PermissionModule,
  action: PermissionAction,
  transition?: string
) => {
  const roleId = normalizeRoleId(role)
  if (!roleId) return false

  const modulePolicy = permissionPolicy.modules[moduleName]
  const allowedRoles =
    transition && modulePolicy.transitions?.[transition]
      ? modulePolicy.transitions[transition]
      : modulePolicy.actions[action]

  return allowedRoles.includes(roleId as RoleId)
}

export const normalizePartyRoleId = (role: string | null | undefined) => {
  if (!role) return null
  const normalized = String(role)
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_')
  if (normalized === 'client') return 'owner'
  if (normalized === 'main_contractor') return 'contractor'
  return normalized as ProjectPartyRole
}

export const canPartyPerform = (
  partyRole: string | null | undefined,
  moduleName: PermissionModule,
  action: PermissionAction,
  transition?: string
) => {
  const role = normalizePartyRoleId(partyRole)
  if (!role) return false
  const modulePolicy =
    permissionPolicy.partyPermissions?.[role]?.modules[moduleName]
  if (!modulePolicy) return false
  if (transition) return modulePolicy.transitions?.includes(transition) ?? false
  return modulePolicy.actions.includes(action)
}

/** Decide from a server matrix; `null` when the matrix has no entry. */
export const canPerformWithMatrix = (
  matrix: PermissionMatrix | null | undefined,
  moduleName: PermissionModule,
  action: PermissionAction,
  transition?: string
): boolean | null => {
  const entry = matrix?.modules?.[moduleName]
  if (!entry) return null
  if (transition) return entry.transitions.includes(transition)
  return entry.actions.includes(action)
}

export const getModuleLevel = (
  matrix: PermissionMatrix | null | undefined,
  moduleName: PermissionModule
): PermissionLevel | null => matrix?.modules?.[moduleName]?.level ?? null

export const useCanPerform = (
  moduleName: PermissionModule,
  action: PermissionAction,
  transition?: string,
  projectRole?: string | null
) => {
  const authRole = useAuthStore((state) => state.auth.user?.role)
  const projectContext = useContext(ProjectPermissionContext)

  // A resolved matrix (templates, party templates, company admin) wins.
  const decided = canPerformWithMatrix(
    projectContext?.matrix,
    moduleName,
    action,
    transition
  )
  if (decided !== null && !projectRole) return decided

  const projectEffectiveRole =
    projectContext?.effectiveRole ?? projectContext?.role ?? null
  const role = resolveEffectiveRole({
    authRole,
    projectRole: projectRole ?? projectEffectiveRole,
  })

  if (canPerform(role, moduleName, action, transition)) return true

  return (projectContext?.partyAccess ?? []).some((party) =>
    canPartyPerform(party.role, moduleName, action, transition)
  )
}

/**
 * Module-level access for navigation: hidden when the resolved matrix says
 * `none`; otherwise falls back to whether the role can read the module.
 */
export const useModuleAccess = (moduleName: PermissionModule) => {
  const authRole = useAuthStore((state) => state.auth.user?.role)
  const projectContext = useContext(ProjectPermissionContext)
  const entry = projectContext?.matrix?.modules?.[moduleName]
  if (entry) {
    return { level: entry.level, visible: entry.visible }
  }
  const role = resolveEffectiveRole({
    authRole,
    projectRole: projectContext?.effectiveRole ?? projectContext?.role,
  })
  const visible =
    canPerform(role, moduleName, 'read') ||
    (projectContext?.partyAccess ?? []).some((party) =>
      canPartyPerform(party.role, moduleName, 'read')
    )
  return { level: visible ? ('standard' as const) : ('none' as const), visible }
}

/** Company admins and project managers administer users, parties and templates. */
export const useIsCompanyAdmin = () => {
  const user = useAuthStore((state) => state.auth.user)
  return Boolean(user?.isCompanyAdmin) || normalizeRoleId(user?.role) === 'pm'
}
