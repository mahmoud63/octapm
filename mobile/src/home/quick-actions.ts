/**
 * The quick actions on Home: the things a person on site does most.
 *
 * Each action names the module and action the server must allow, and the app
 * screen it opens. An action without a screen yet is not shown at all: the
 * app never offers a button that leads nowhere. The screens arrive with the
 * milestones in the implementation plan.
 */
import type { PermissionMatrix } from '@/api/types'
import { allows } from '@/permissions/usePermissions'
import type { ActionId } from '@/permissions/policy'

export interface QuickAction {
  id: string
  title: string
  icon: string
  module: string
  action: ActionId
  /** The expo-router route, once the screen exists. */
  route?: string
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: 'rfi', title: 'New RFI', icon: 'help-circle-outline', module: 'rfi', action: 'create', route: '/rfi/new' },
  { id: 'punch', title: 'Punch item', icon: 'flag-outline', module: 'punch', action: 'create' },
  { id: 'photo', title: 'Photo', icon: 'camera-outline', module: 'document_control', action: 'create' },
  { id: 'daily-log', title: 'Daily log', icon: 'today-outline', module: 'progress', action: 'submit' },
  { id: 'inspection', title: 'Inspection', icon: 'checkbox-outline', module: 'inspection', action: 'create' },
  { id: 'goods-in', title: 'Goods in', icon: 'cube-outline', module: 'inventory', action: 'create' },
]

/** The actions this person may take now, in the order they are shown. */
export function availableQuickActions(matrix: PermissionMatrix | undefined, actions: readonly QuickAction[] = QUICK_ACTIONS): QuickAction[] {
  return actions.filter((action) => !!action.route && allows(matrix, action.module, action.action))
}
