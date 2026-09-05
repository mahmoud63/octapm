import { cn } from '@/lib/utils'
import { useRealtimeStatus } from '@/hooks/use-realtime'

const labels = {
  connected: 'Live updates on',
  connecting: 'Reconnecting live updates…',
  disconnected: 'Live updates off',
} as const

export function RealtimeStatus({ className }: { className?: string }) {
  const status = useRealtimeStatus()

  return (
    <span
      role='status'
      aria-label={labels[status]}
      title={labels[status]}
      data-testid='realtime-status'
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground',
        className
      )}
    >
      <span
        aria-hidden='true'
        className={cn(
          'size-2 rounded-full',
          status === 'connected' && 'bg-emerald-500',
          status === 'connecting' && 'animate-pulse bg-amber-500',
          status === 'disconnected' && 'bg-muted-foreground/40'
        )}
      />
      <span className='hidden lg:inline'>
        {status === 'connected'
          ? 'Live'
          : status === 'connecting'
            ? 'Syncing'
            : 'Offline'}
      </span>
    </span>
  )
}
