import { cn } from '@/lib/utils'

/**
 * Whose move it is.
 *
 * Derived on the server from the record's state and the permission policy that
 * governs the next transition — never typed onto a screen, so it cannot drift
 * away from what the system will actually let somebody do.
 *
 * Two readings, and the difference matters more than it looks. "Your action" is
 * a prompt: the reader can do the next thing and should. Anything else is
 * information: it says who to chase, and is deliberately quieter, because a
 * screen that shouts about work belonging to somebody else trains people to
 * ignore it.
 */
export type BallInCourt = {
  state: 'yours' | 'awaiting' | 'none'
  label: string | null
  party: { kind: string; label: string; role: string | null } | null
  isYou: boolean
  action: { transition: string; roles: string[] } | null
}

export function BallInCourtBadge({
  ballInCourt,
  className,
  testId,
}: {
  ballInCourt?: BallInCourt | null
  className?: string
  testId?: string
}) {
  if (!ballInCourt || ballInCourt.state === 'none' || !ballInCourt.label) return null

  const yours = ballInCourt.state === 'yours'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        yours
          ? 'bg-primary/10 text-primary ring-primary/20 ring-1'
          : 'text-muted-foreground bg-surface',
        className
      )}
      data-testid={testId ?? 'uat-ball-in-court'}
      data-state={ballInCourt.state}
      // The party is on the element rather than in the text: a test or a
      // screen reader can get at it without the label having to spell out
      // "awaiting procurement (procurement)".
      data-party={ballInCourt.party?.label ?? ''}
      title={
        yours && ballInCourt.party
          ? `You can act on this as ${ballInCourt.party.label}`
          : undefined
      }
    >
      {yours && (
        <span
          aria-hidden
          className='bg-primary inline-block size-1.5 shrink-0 rounded-full'
        />
      )}
      {ballInCourt.label}
    </span>
  )
}
