import * as React from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Building2,
  Check,
  ChevronsUpDown,
  Plus,
  Settings2,
  User,
} from 'lucide-react'
import { useAuthStore, workspaceSegment } from '@/stores/auth-store'
import { useIsCompanyAdmin } from '@/lib/permissions'
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
import { CreateWorkspaceDialog } from '@/features/company/components/create-workspace-dialog'
import { WorkspaceKindBadge } from '@/features/home/workspace-badge'
import { membershipStanding } from '@/features/home/workspace-standing'

/**
 * Header workspace switcher (workspace switching doc §6): the workspace the
 * session is bound to, its kind, and every workspace the identity belongs
 * to with their standing in each. Picking one navigates to its home — the
 * `/o/{workspace}` route performs the switch, so the URL stays the source
 * of truth and browser Back reverses it.
 *
 * "Create workspace" makes a further company workspace for the identity
 * and "Convert to company" opens the workspace settings of a personal one
 * for its owner (ENT-6).
 */
export function WorkspaceSwitcher({ className }: { className?: string }) {
  const navigate = useNavigate()
  const workspace = useAuthStore((state) => state.auth.workspace)
  const memberships = useAuthStore((state) => state.auth.memberships)
  const switching = useAuthStore((state) => state.auth.switching)
  const isAdmin = useIsCompanyAdmin()
  const [open, setOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)

  const select = (segment: string) => {
    setOpen(false)
    if (segment === workspace?.segment) return
    navigate({ to: '/o/$orgSlug', params: { orgSlug: segment } })
  }

  const Icon = workspace?.kind === 'personal' ? User : Building2

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          aria-label='Switch workspace'
          data-testid='workspace-switcher'
          className={cn(
            'h-8 max-w-64 justify-between gap-2 px-2.5 font-medium',
            className
          )}
        >
          <Icon className='size-4 shrink-0 text-muted-foreground' />
          <span className='truncate' data-testid='workspace-switcher-name'>
            {switching
              ? 'Switching…'
              : (workspace?.name ?? workspace?.segment ?? 'Workspace')}
          </span>
          {workspace && (
            <WorkspaceKindBadge
              kind={workspace.kind}
              className='hidden lg:inline-flex'
            />
          )}
          <ChevronsUpDown className='size-3.5 shrink-0 opacity-60' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-72'>
        <DropdownMenuLabel className='text-xs text-muted-foreground'>
          Workspaces
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {memberships.map((membership) => {
            const segment = workspaceSegment(membership)
            const current = membership.orgId === workspace?.orgId
            const disabled = membership.status !== 'active'
            return (
              <DropdownMenuItem
                key={membership.orgId}
                disabled={disabled}
                onSelect={() => select(segment)}
                className='gap-2'
                data-testid={`workspace-option-${segment}`}
              >
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    current ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <span className='truncate'>
                      {membership.name ?? segment}
                    </span>
                    <WorkspaceKindBadge kind={membership.kind} />
                  </div>
                  <p className='truncate text-[11px] text-muted-foreground'>
                    {membershipStanding(membership)}
                  </p>
                </div>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {memberships.length > 1 && (
            <DropdownMenuItem asChild>
              <Link to='/home' onClick={() => setOpen(false)}>
                <User className='size-4' />
                My Work — all workspaces
              </Link>
            </DropdownMenuItem>
          )}
          {isAdmin && workspace && (
            <DropdownMenuItem asChild>
              <Link
                to='/o/$orgSlug/company/directory'
                params={{ orgSlug: workspace.segment }}
                onClick={() => setOpen(false)}
              >
                <Settings2 className='size-4' />
                Workspace settings
              </Link>
            </DropdownMenuItem>
          )}
          {/* A further company workspace for this identity (ENT-6); the
              dialog lives outside the menu so closing the menu keeps it. */}
          <DropdownMenuItem
            onSelect={() => {
              setOpen(false)
              setCreating(true)
            }}
            data-testid='workspace-create'
          >
            <Plus className='size-4' />
            Create workspace
          </DropdownMenuItem>
          {workspace?.kind === 'personal' && workspace.isOwner && (
            <DropdownMenuItem asChild>
              <Link
                to='/o/$orgSlug/company/workspace'
                params={{ orgSlug: workspace.segment }}
                onClick={() => setOpen(false)}
                data-testid='workspace-convert-link'
              >
                <Building2 className='size-4' />
                Convert to company
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </DropdownMenu>
  )
}
