import { useNavigate } from '@tanstack/react-router'
import { ArrowLeftRight } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { membershipForSegment, workspaceHref } from '@/lib/workspace/paths'
import { Button } from '@/components/ui/button'
import { Main } from '@/components/layout/main'
import { WorkspaceKindBadge } from './workspace-badge'

/**
 * A link into another of the person's workspaces (deep-link rule §108): the
 * page names the workspace and the project the link opens, and the person
 * chooses. "Switch" navigates to the workspace-prefixed URL; the `/o/`
 * guard performs the switch itself, so Back from there returns here and
 * the current workspace's session is untouched until they say so.
 */
export function SwitchOffer({
  to,
  next,
  name,
  project,
}: {
  to: string
  next: string
  name?: string
  project?: string
}) {
  const navigate = useNavigate()
  const current = useAuthStore((state) => state.auth.workspace)
  const memberships = useAuthStore((state) => state.auth.memberships)
  const target = membershipForSegment(memberships, to)
  const targetName = target?.name ?? name ?? to

  return (
    <Main className='mx-auto max-w-lg space-y-6' data-testid='switch-offer'>
      <div className='space-y-2 text-center'>
        <div className='mx-auto flex size-12 items-center justify-center rounded-full bg-muted'>
          <ArrowLeftRight className='size-6 text-muted-foreground' />
        </div>
        <h1 className='text-xl font-semibold'>This link is in another workspace</h1>
        <p className='text-sm text-muted-foreground'>
          {project ? `“${project}” belongs` : 'It belongs'} to{' '}
          <span className='font-medium text-foreground'>{targetName}</span>
          {target && <WorkspaceKindBadge kind={target.kind} className='ms-1.5' />}
          {current ? (
            <>
              . You are signed in to{' '}
              <span className='font-medium text-foreground'>
                {current.name ?? current.segment}
              </span>
              .
            </>
          ) : (
            '.'
          )}
        </p>
      </div>
      <div className='flex justify-center gap-3'>
        <Button
          variant='outline'
          onClick={() =>
            current
              ? navigate({ to: '/o/$orgSlug', params: { orgSlug: current.segment } })
              : navigate({ to: '/home' })
          }
          data-testid='switch-offer-stay'
        >
          Stay in {current?.name ?? 'this workspace'}
        </Button>
        <Button
          onClick={() => navigate({ href: workspaceHref(to, next) })}
          data-testid='switch-offer-switch'
        >
          Switch to {targetName}
        </Button>
      </div>
    </Main>
  )
}
