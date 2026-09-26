import type { WorkspaceMembership } from '@/services/auth/types'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

/** "Company" / "Personal" — the kind of a workspace, beside its name (switching doc §6). */
export function WorkspaceKindBadge({
  kind,
  className,
}: {
  kind: WorkspaceMembership['kind']
  className?: string
}) {
  return (
    <Badge
      variant='outline'
      className={cn('rounded-full px-1.5 py-0 text-[10px] uppercase', className)}
      data-testid='workspace-kind'
    >
      {kind === 'personal' ? 'Personal' : 'Company'}
    </Badge>
  )
}
