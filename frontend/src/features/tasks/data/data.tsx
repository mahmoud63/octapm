import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Circle,
  CheckCircle,
  AlertCircle,
  Timer,
  PauseCircle,
  ClipboardCheck,
  FileText,
  Hammer,
  ShieldCheck,
  Truck,
  BadgeDollarSign,
  CircleOff,
} from 'lucide-react'

export const labels = [
  {
    value: 'action',
    label: 'Action',
  },
  {
    value: 'field',
    label: 'Field',
  },
  {
    value: 'procurement',
    label: 'Procurement',
  },
  {
    value: 'quality',
    label: 'Quality',
  },
  {
    value: 'safety',
    label: 'Safety',
  },
  {
    value: 'commercial',
    label: 'Commercial',
  },
  {
    value: 'document',
    label: 'Document',
  },
]

export const statuses = [
  {
    label: 'Todo',
    value: 'todo' as const,
    icon: Circle,
  },
  {
    label: 'In Progress',
    value: 'in_progress' as const,
    icon: Timer,
  },
  {
    label: 'Blocked',
    value: 'blocked' as const,
    icon: PauseCircle,
  },
  {
    label: 'Done',
    value: 'done' as const,
    icon: CheckCircle,
  },
  {
    label: 'Canceled',
    value: 'canceled' as const,
    icon: CircleOff,
  },
]

export const labelIcons = {
  action: ClipboardCheck,
  field: Hammer,
  procurement: Truck,
  quality: ShieldCheck,
  safety: AlertCircle,
  commercial: BadgeDollarSign,
  document: FileText,
}

export const priorities = [
  {
    label: 'Low',
    value: 'low' as const,
    icon: ArrowDown,
  },
  {
    label: 'Medium',
    value: 'medium' as const,
    icon: ArrowRight,
  },
  {
    label: 'High',
    value: 'high' as const,
    icon: ArrowUp,
  },
  {
    label: 'Critical',
    value: 'critical' as const,
    icon: AlertCircle,
  },
]
