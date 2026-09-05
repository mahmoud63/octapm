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
  children,
}: {
  role?: string | null
  effectiveRole?: string | null
  partyAccess?: ProjectPermissionContextValue['partyAccess']
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
      },
    },
    children
  )
}

export const useProjectEffectiveRole = () => {
  const context = useContext(ProjectPermissionContext)
  return context?.effectiveRole ?? context?.role ?? null
}

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
  const normalized = String(role).trim().toLowerCase().replace(/[-\s]+/g, '_')
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
  const modulePolicy = permissionPolicy.partyPermissions?.[role]?.modules[
    moduleName
  ]
  if (!modulePolicy) return false
  if (transition) return modulePolicy.transitions?.includes(transition) ?? false
  return modulePolicy.actions.includes(action)
}

export const useCanPerform = (
  moduleName: PermissionModule,
  action: PermissionAction,
  transition?: string,
  projectRole?: string | null
) => {
  const authRole = useAuthStore((state) => state.auth.user?.role)
  const projectContext = useContext(ProjectPermissionContext)
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
