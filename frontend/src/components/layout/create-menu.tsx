import * as React from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { FolderPlus, Plus, UserPlus } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { canPerform, normalizeRoleId, useIsCompanyAdmin, useWorkspaceRole } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { QUICK_ACTIONS, QUICK_ACTIONS_PROJECT_KEY } from '@/features/dashboard/quick-actions'
import { useProjects } from '@/features/projects/hooks/use-projects'

const rememberedProject = () => {
  try {
    return window.localStorage.getItem(QUICK_ACTIONS_PROJECT_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * "+ Create" (workspace switching doc §6, §21-§22): the primary entry for
 * creating anything. Company-level items at workspace level — a project, an
 * invitation — and the record quick actions the dashboard already offers,
 * each landing in its module with the create dialog open. Inside a project
 * the records are created there; at workspace level, in the project the
 * person last chose on the dashboard, else their first active one. Only
 * what the person's role may create is offered, and nothing is offered that
 * has no route of its own. Offering is not authorisation: every target
 * checks again.
 */
export function CreateMenu({ className }: { className?: string }) {
  const params = useParams({ strict: false }) as { projectId?: string }
  const workspace = useAuthStore((state) => state.auth.workspace)
  const role = useWorkspaceRole()
  const isAdmin = useIsCompanyAdmin()
  const { data } = useProjects()
  const [open, setOpen] = React.useState(false)

  const projects = React.useMemo(
    () => (data?.items ?? []).filter((project) => project.status === 'active'),
    [data]
  )
  const remembered = rememberedProject()
  const projectId =
    params.projectId ??
    (projects.some((project) => project.id === remembered)
      ? remembered
      : (projects[0]?.id ?? ''))
  const projectName =
    (data?.items ?? []).find((project) => project.id === projectId)?.name ?? null

  const roleId = normalizeRoleId(role)
  const canCreateProject = roleId === 'pm' || roleId === 'planning_eng'
  const records = QUICK_ACTIONS.filter((action) =>
    canPerform(role, action.module, 'create')
  )
  if (!workspace || (!canCreateProject && !isAdmin && !records.length)) {
    return null
  }
  const close = () => setOpen(false)
  const personal = workspace.kind === 'personal'

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size='sm'
          variant='outline'
          className={cn('h-8 gap-1 px-2.5', className)}
          aria-label='Create'
          data-testid='create-menu'
        >
          <Plus className='size-4' />
          <span className='hidden lg:inline'>Create</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-60'>
        {(canCreateProject || isAdmin) && (
          <>
            <DropdownMenuLabel className='text-xs text-muted-foreground'>
              {workspace.name ?? 'Workspace'}
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {canCreateProject && (
                <DropdownMenuItem asChild>
                  <Link
                    to='/o/$orgSlug/projects'
                    params={{ orgSlug: workspace.segment }}
                    onClick={close}
                    data-testid='create-menu-project'
                  >
                    <FolderPlus className='size-4' />
                    Project
                  </Link>
                </DropdownMenuItem>
              )}
              {isAdmin && (
                <DropdownMenuItem asChild>
                  {/* A personal workspace seats one member (ENT-6): inviting
                      people starts with the conversion, so the entry opens
                      the workspace settings, where it is explained. */}
                  <Link
                    to={
                      personal
                        ? '/o/$orgSlug/company/workspace'
                        : '/o/$orgSlug/users'
                    }
                    params={{ orgSlug: workspace.segment }}
                    onClick={close}
                    data-testid='create-menu-invite'
                  >
                    <UserPlus className='size-4' />
                    Invite people
                    {personal && (
                      <span className='ms-auto text-[10px] text-muted-foreground'>
                        convert first
                      </span>
                    )}
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </>
        )}
        {records.length > 0 && (
          <>
            {(canCreateProject || isAdmin) && <DropdownMenuSeparator />}
            <DropdownMenuLabel className='truncate text-xs text-muted-foreground'>
              {projectName ? `In ${projectName}` : 'Records'}
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {records.map((action) => {
                const needsProject = action.key !== 'task'
                const disabled = needsProject && !projectId
                const target = action.to(projectId)
                const Icon = action.icon
                if (disabled) {
                  return (
                    <DropdownMenuItem key={action.key} disabled>
                      <Icon className='size-4' />
                      {action.label}
                      <span className='ms-auto text-[10px] text-muted-foreground'>
                        no project
                      </span>
                    </DropdownMenuItem>
                  )
                }
                return (
                  <DropdownMenuItem key={action.key} asChild>
                    <Link
                      to={target.to}
                      params={target.params}
                      search={target.search}
                      onClick={close}
                      data-testid={`create-menu-${action.key}`}
                    >
                      <Icon className='size-4' />
                      {action.label}
                    </Link>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
