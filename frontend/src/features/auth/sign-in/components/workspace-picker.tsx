import { useState } from 'react'
import type { WorkspaceMembership } from '@/services/auth/types'
import { Building2, Clock3, Loader2, User } from 'lucide-react'
import { workspaceSegment } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { WorkspaceKindBadge } from '@/features/home/workspace-badge'
import { membershipStanding } from '@/features/home/workspace-standing'

/**
 * The second step of a sign-in with several workspaces (membership doc §6):
 * the identity is proven, the workspace is chosen. The one used last on this
 * browser (or the one a deep link names) is listed first and marked, so the
 * common case is one click; suspended memberships are listed with their
 * status and cannot be entered.
 */
export function WorkspacePicker({
  memberships,
  preferred,
  onPick,
  onBack,
}: {
  memberships: WorkspaceMembership[]
  preferred: WorkspaceMembership | null
  onPick: (membership: WorkspaceMembership) => Promise<void>
  onBack: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const ordered = [
    ...(preferred ? [preferred] : []),
    ...memberships.filter((entry) => entry.orgId !== preferred?.orgId),
  ]

  const pick = async (membership: WorkspaceMembership) => {
    setBusy(membership.orgId)
    try {
      await onPick(membership)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className='grid gap-3' data-testid='uat-sign-in-workspaces'>
      <div className='space-y-1'>
        <p className='text-sm font-medium'>Choose a workspace</p>
        <p className='text-sm text-muted-foreground'>
          You belong to {memberships.length} workspaces. Pick the one to open;
          you can switch at any time from the header.
        </p>
      </div>
      <ul className='divide-y rounded-lg border'>
        {ordered.map((membership) => {
          const segment = workspaceSegment(membership)
          const enterable = membership.status === 'active'
          const Icon = membership.kind === 'personal' ? User : Building2
          return (
            <li key={membership.orgId}>
              <button
                type='button'
                disabled={!enterable || busy !== null}
                onClick={() => void pick(membership)}
                data-testid={`uat-sign-in-workspace-${segment}`}
                className={cn(
                  'flex w-full items-center gap-3 p-3 text-start transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60',
                  membership.orgId === preferred?.orgId && 'bg-muted/40'
                )}
              >
                <div className='flex size-9 shrink-0 items-center justify-center rounded-md bg-muted'>
                  <Icon className='size-4 text-muted-foreground' />
                </div>
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='truncate text-sm font-medium'>
                      {membership.name ?? segment}
                    </span>
                    <WorkspaceKindBadge kind={membership.kind} />
                    {membership.orgId === preferred?.orgId && (
                      <span className='inline-flex items-center gap-1 text-[10px] text-muted-foreground uppercase'>
                        <Clock3 className='size-3' /> Last used
                      </span>
                    )}
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    {membershipStanding(membership)}
                  </p>
                </div>
                {busy === membership.orgId && (
                  <Loader2 className='size-4 animate-spin text-muted-foreground' />
                )}
              </button>
            </li>
          )
        })}
      </ul>
      <Button variant='ghost' size='sm' type='button' onClick={onBack} disabled={busy !== null}>
        Sign in as someone else
      </Button>
    </div>
  )
}
