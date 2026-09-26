import { Link } from '@tanstack/react-router'
import type { WorkspaceMembership } from '@/services/auth/types'
import { Building2 } from 'lucide-react'
import { useAuthStore, workspaceSegment } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Main } from '@/components/layout/main'
import { WorkspaceKindBadge } from './workspace-badge'
import { membershipStanding } from './workspace-standing'

/**
 * "You are not a member of this workspace" (workspace switching doc §5): a
 * link into a workspace the identity does not belong to, or one it is
 * suspended in. Never a silent fallback to another workspace — the person
 * sees which URL failed and picks from the workspaces they can open.
 */
export function WorkspaceGate({
  segment,
  membership,
}: {
  segment: string
  membership: WorkspaceMembership | null
}) {
  const memberships = useAuthStore((state) => state.auth.memberships)
  const openable = memberships.filter((entry) => entry.status === 'active')
  const suspended = membership && membership.status !== 'active'

  return (
    <Main className='mx-auto max-w-xl space-y-6' data-testid='workspace-gate'>
      <div className='space-y-2 text-center'>
        <div className='mx-auto flex size-12 items-center justify-center rounded-full bg-muted'>
          <Building2 className='size-6 text-muted-foreground' />
        </div>
        <h1 className='text-xl font-semibold'>
          {suspended
            ? `Your access to ${membership.name ?? segment} is ${membership.status}`
            : 'You are not a member of this workspace'}
        </h1>
        <p className='text-sm text-muted-foreground'>
          {suspended
            ? 'An administrator of that workspace can restore it.'
            : `The link named a workspace (“${segment}”) that is not one of yours. Ask its administrator to add you, or open one of your workspaces below.`}
        </p>
      </div>

      {openable.length > 0 && (
        <ul className='divide-y rounded-lg border' data-testid='workspace-gate-list'>
          {openable.map((entry) => {
            const target = workspaceSegment(entry)
            return (
              <li key={entry.orgId} className='flex items-center gap-3 p-3'>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <span className='truncate font-medium'>
                      {entry.name ?? target}
                    </span>
                    <WorkspaceKindBadge kind={entry.kind} />
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    {membershipStanding(entry)}
                  </p>
                </div>
                <Button asChild size='sm' variant='outline'>
                  <Link to='/o/$orgSlug' params={{ orgSlug: target }} preload={false}>
                    Open
                  </Link>
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <div className='text-center'>
        <Button asChild variant='ghost'>
          <Link to='/home'>Home</Link>
        </Button>
      </div>
    </Main>
  )
}
