import { CloudOff, CloudUpload, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import {
  removeOutboxItem,
  retryOutboxItem,
  syncOutbox,
  type OutboxItem,
} from '@/lib/offline/outbox'
import { cn } from '@/lib/utils'
import { useOnline, useOutbox } from '@/hooks/use-online'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const KIND_LABEL: Record<string, string> = {
  punch: 'Punch item',
  observation: 'Observation',
  form: 'Inspection',
  attachment: 'Photos / files',
  daily_report: 'Daily report',
  site_diary: 'Site diary',
}

export function OutboxList({
  items,
  compact = false,
}: {
  items: OutboxItem[]
  compact?: boolean
}) {
  if (!items.length) {
    return (
      <p className='text-xs text-muted-foreground'>
        Nothing waiting to upload.
      </p>
    )
  }
  return (
    <ul
      className={cn('divide-y', compact && 'max-h-72 overflow-y-auto')}
      data-testid='uat-outbox-list'
    >
      {items.map((item) => (
        <li key={item.id} className='flex items-start gap-2 py-2 text-sm'>
          <div className='min-w-0 flex-1'>
            <p className='truncate font-medium'>{item.label}</p>
            <p className='text-xs text-muted-foreground'>
              {KIND_LABEL[item.kind] ?? item.kind} ·{' '}
              {new Date(item.createdAt).toLocaleString()}
              {item.files?.length
                ? ` · ${item.files.length} file${item.files.length === 1 ? '' : 's'}`
                : ''}
            </p>
            {item.status === 'failed' && (
              <p className='text-xs text-destructive'>
                {item.lastError || 'The server rejected this item.'}
              </p>
            )}
            {item.dependsOn && (
              <p className='text-xs text-muted-foreground'>
                Waits for its record to be created first.
              </p>
            )}
          </div>
          <Badge
            variant={item.status === 'failed' ? 'destructive' : 'outline'}
            className='shrink-0'
          >
            {item.status === 'syncing'
              ? 'Uploading'
              : item.status === 'failed'
                ? 'Failed'
                : 'Queued'}
          </Badge>
          {item.status === 'failed' && (
            <Button
              size='icon'
              variant='ghost'
              className='h-7 w-7'
              aria-label='Retry'
              onClick={() => void retryOutboxItem(item.id)}
            >
              <RefreshCw className='h-3.5 w-3.5' />
            </Button>
          )}
          <Button
            size='icon'
            variant='ghost'
            className='h-7 w-7'
            aria-label='Discard'
            onClick={() => {
              if (window.confirm('Discard this unsent item?'))
                void removeOutboxItem(item.id)
            }}
          >
            <Trash2 className='h-3.5 w-3.5' />
          </Button>
        </li>
      ))}
    </ul>
  )
}

/** Top-bar chip: offline state and the number of writes waiting to upload. */
export function OutboxStatus({ className }: { className?: string }) {
  const online = useOnline()
  const { items, syncing } = useOutbox()
  const pending = items.length
  if (online && pending === 0) return null
  const label = !online
    ? pending
      ? `Offline · ${pending} waiting`
      : 'Offline'
    : syncing
      ? 'Uploading…'
      : `${pending} waiting to upload`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          data-testid='uat-outbox-status'
          data-online={online ? 'true' : 'false'}
          data-pending={pending}
          title={label}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
            !online
              ? 'border-amber-500/60 text-amber-600'
              : 'text-muted-foreground',
            className
          )}
        >
          {!online ? (
            <CloudOff className='h-3.5 w-3.5' />
          ) : syncing ? (
            <Loader2 className='h-3.5 w-3.5 animate-spin' />
          ) : (
            <CloudUpload className='h-3.5 w-3.5' />
          )}
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-96'>
        <div className='mb-2 flex items-center justify-between'>
          <p className='text-sm font-medium'>Outbox</p>
          <Button
            size='sm'
            variant='outline'
            disabled={!online || syncing}
            onClick={() => void syncOutbox()}
            data-testid='uat-outbox-sync'
          >
            {syncing ? (
              <Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />
            ) : (
              <RefreshCw className='mr-1 h-3.5 w-3.5' />
            )}
            Sync now
          </Button>
        </div>
        <p className='mb-2 text-xs text-muted-foreground'>
          {online
            ? 'Items upload in order; anything the server rejects stays here for you to fix or discard.'
            : 'You are offline. Everything you save is kept on this device and uploads when signal returns.'}
        </p>
        <OutboxList items={items} compact />
      </PopoverContent>
    </Popover>
  )
}
