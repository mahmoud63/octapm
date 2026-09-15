import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  CircleDollarSign,
  FileQuestion,
  GitPullRequestArrow,
  ListTodo,
  type LucideIcon,
} from 'lucide-react'
import { canPerform, type PermissionModule } from '@/lib/permissions'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useProjects } from '@/features/projects/hooks/use-projects'

const REMEMBER_KEY = 'octa.quickActions.projectId'

type QuickAction = {
  key: string
  label: string
  module: PermissionModule
  icon: LucideIcon
  /** Build the destination; the module opens its own create dialog on `?new=`. */
  to: (projectId: string) => { to: string; params?: Record<string, string>; search: Record<string, string> }
}

const ACTIONS: QuickAction[] = [
  {
    key: 'rfi',
    label: 'New RFI',
    module: 'rfi',
    icon: FileQuestion,
    to: (projectId) => ({
      to: '/projects/$projectId/$module/$child',
      params: { projectId, module: 'doc-control', child: 'rfi' },
      search: { new: 'rfi' },
    }),
  },
  {
    key: 'change_order',
    label: 'New change order',
    module: 'change_order',
    icon: GitPullRequestArrow,
    to: (projectId) => ({
      to: '/projects/$projectId/$module/$child',
      params: { projectId, module: 'commercial', child: 'change-orders' },
      search: { new: 'change_order' },
    }),
  },
  {
    key: 'direct_cost',
    label: 'New direct cost',
    module: 'cost',
    icon: CircleDollarSign,
    to: (projectId) => ({
      to: '/projects/$projectId/$module/$child',
      params: { projectId, module: 'cost', child: 'direct-costs' },
      search: { new: 'direct_cost' },
    }),
  },
  {
    key: 'task',
    label: 'New task',
    module: 'task',
    icon: ListTodo,
    to: () => ({ to: '/tasks', search: { new: 'task' } }),
  },
]

const remembered = () => {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * The few things people create most, one click from the workspace — each
 * lands in the module with its own create dialog already open, so no
 * creation flow is duplicated here. Only actions the person's role can
 * perform are shown (Phase 22A, from the Phase 22 audit UX22-08).
 */
export function QuickActions() {
  const role = useAuthStore((state) => state.auth.user?.role)
  const { data } = useProjects()
  const projects = useMemo(
    () => (data?.items || []).filter((project) => project.status === 'active'),
    [data]
  )
  const [chosen, setChosen] = useState(remembered)
  // The remembered project when it is still one of the person's active
  // projects, else the first of them — derived, so no effect re-renders.
  const projectId = projects.some((project) => project.id === chosen)
    ? chosen
    : (projects[0]?.id ?? '')
  const choose = (next: string) => {
    setChosen(next)
    try {
      window.localStorage.setItem(REMEMBER_KEY, next)
    } catch {
      /* per-viewer convenience only */
    }
  }

  const allowed = ACTIONS.filter((action) => canPerform(role, action.module, 'create'))
  if (!allowed.length) return null

  return (
    <section
      className='flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2'
      data-testid='workspace-quick-actions'
      aria-label='Quick actions'
    >
      <span className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
        Quick actions
      </span>
      {projects.length > 1 && (
        <Select value={projectId} onValueChange={choose}>
          <SelectTrigger className='h-8 w-56' aria-label='Create in project'>
            <SelectValue placeholder='In project…' />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {allowed.map((action) => {
        const Icon = action.icon
        const needsProject = action.key !== 'task'
        const target = action.to(projectId)
        const disabled = needsProject && !projectId
        return (
          <Button
            key={action.key}
            asChild={!disabled}
            size='sm'
            variant='outline'
            disabled={disabled}
            data-testid={`quick-action-${action.key}`}
          >
            {disabled ? (
              <span>
                <Icon className='size-4' />
                {action.label}
              </span>
            ) : (
              <Link to={target.to} params={target.params} search={target.search}>
                <Icon className='size-4' />
                {action.label}
              </Link>
            )}
          </Button>
        )
      })}
    </section>
  )
}
