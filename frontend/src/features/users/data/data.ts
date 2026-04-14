import {
  BarChart3,
  Calculator,
  HardHat,
  Package,
  Shield,
  Truck,
  UserCheck,
  Wallet,
} from 'lucide-react'
import { type UserStatus } from './schema'

export const callTypes = new Map<UserStatus, string>([
  ['active', 'bg-teal-100/30 text-teal-900 dark:text-teal-200 border-teal-200'],
  ['inactive', 'bg-neutral-300/40 border-neutral-300'],
])

export const roles = [
  {
    label: 'Project Manager',
    value: 'pm',
    icon: Shield,
  },
  {
    label: 'Planning Engineer',
    value: 'planning_eng',
    icon: BarChart3,
  },
  {
    label: 'Quantity Surveyor',
    value: 'qs',
    icon: Calculator,
  },
  {
    label: 'Cost Controller',
    value: 'cost_controller',
    icon: Wallet,
  },
  {
    label: 'Procurement',
    value: 'procurement',
    icon: Truck,
  },
  {
    label: 'Warehouse',
    value: 'warehouse',
    icon: Package,
  },
  {
    label: 'Site Engineer',
    value: 'site_engineer',
    icon: UserCheck,
  },
  {
    label: 'Finance',
    value: 'finance',
    icon: HardHat,
  },
] as const
