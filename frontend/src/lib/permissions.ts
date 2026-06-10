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
  | 'ipc'
  | 'cost'
  | 'procurement'
  | 'user_management'
  | 'audit'
  | 'rfi'
  | 'submittal'
  | 'ncr'
  | 'safety'

type RoleId =
  | 'pm'
  | 'planning_eng'
  | 'qs'
  | 'cost_controller'
  | 'procurement'
  | 'warehouse'
  | 'site_engineer'
  | 'finance'

type PermissionPolicy = {
  version: string
  actions: PermissionAction[]
  roles: Array<{ id: RoleId; label: string }>
  modules: Record<
    PermissionModule,
    {
      label: string
      actions: Record<PermissionAction, RoleId[]>
      transitions?: Record<string, RoleId[]>
    }
  >
}

export const permissionPolicy = permissionPolicyJson as PermissionPolicy

export const canPerform = (
  role: string | null | undefined,
  moduleName: PermissionModule,
  action: PermissionAction,
  transition?: string
) => {
  if (!role) return false

  const modulePolicy = permissionPolicy.modules[moduleName]
  const allowedRoles =
    transition && modulePolicy.transitions?.[transition]
      ? modulePolicy.transitions[transition]
      : modulePolicy.actions[action]

  return allowedRoles.includes(role as RoleId)
}

export const useCanPerform = (
  moduleName: PermissionModule,
  action: PermissionAction,
  transition?: string
) => {
  const role = useAuthStore((state) => state.auth.user?.role)
  return canPerform(role, moduleName, action, transition)
}
