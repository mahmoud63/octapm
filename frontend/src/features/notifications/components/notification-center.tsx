import { Link } from '@tanstack/react-router'
import { Bell, CheckCheck, Circle, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type NotificationItem,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationSummary,
} from '../hooks/use-notifications'

function relativeTime(value: string) {
  const date = new Date(value)
  const diffMs = date.getTime() - Date.now()
  const minutes = Math.round(diffMs / 60_000)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')

  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')

  return rtf.format(Math.round(hours / 24), 'day')
}

function categoryLabel(category: NotificationItem['category']) {
  return category
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const markRead = useMarkNotificationRead()
  const unread = item.status === 'unread'
  const isUrgent = item.priority === 'urgent' || item.category === 'overdue'

  const content = (
    <div className='flex min-h-20 w-full gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent'>
      <Circle
        className={cn(
          'mt-1 size-2.5 shrink-0',
          unread ? 'fill-primary text-primary' : 'fill-transparent text-border'
        )}
      />
      <div className='min-w-0 flex-1 space-y-1'>
        <div className='flex items-start gap-2'>
          <p className='min-w-0 flex-1 text-sm leading-snug font-medium'>
            {item.title}
          </p>
          {isUrgent && (
            <Badge variant='destructive' className='rounded-sm px-1.5 py-0'>
              Urgent
            </Badge>
          )}
        </div>
        <p className='line-clamp-2 text-xs leading-relaxed text-muted-foreground'>
          {item.message}
        </p>
        <div className='flex items-center gap-2 text-[11px] text-muted-foreground'>
          <span>{categoryLabel(item.category)}</span>
          <span aria-hidden='true'>-</span>
          <span>{relativeTime(item.createdAt)}</span>
        </div>
      </div>
    </div>
  )

  if (item.actionUrl) {
    return (
      <a
        href={item.actionUrl}
        onClick={() => {
          if (unread) markRead.mutate({ id: item.id })
        }}
        className='block outline-none focus-visible:ring-2 focus-visible:ring-ring'
      >
        {content}
      </a>
    )
  }

  return (
    <button
      type='button'
      onClick={() => {
        if (unread) markRead.mutate({ id: item.id })
      }}
      className='block w-full outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      {content}
    </button>
  )
}

export function NotificationCenter() {
  const summary = useNotificationSummary()
  const markAllRead = useMarkAllNotificationsRead()
  const recent = summary.data?.recent ?? []
  const unread = summary.data?.unread ?? 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' className='relative size-9'>
          <Bell className='size-4' />
          {unread > 0 && (
            <span className='text-destructive-foreground absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-medium'>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
          <span className='sr-only'>Notifications</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-[360px] p-0'>
        <div className='flex items-center justify-between gap-3 px-3 py-2'>
          <DropdownMenuLabel className='p-0 text-sm font-semibold'>
            Notifications
          </DropdownMenuLabel>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-8'
            disabled={!unread || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            <CheckCheck className='size-4' />
            <span className='sr-only'>Mark all read</span>
          </Button>
        </div>
        <DropdownMenuSeparator />
        <ScrollArea className='max-h-96'>
          {summary.isLoading ? (
            <div className='space-y-3 p-3'>
              <Skeleton className='h-16 w-full' />
              <Skeleton className='h-16 w-full' />
              <Skeleton className='h-16 w-full' />
            </div>
          ) : recent.length ? (
            <div className='p-1'>
              {recent.map((item) => (
                <NotificationRow key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className='flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground'>
              <Inbox className='size-8' />
              <span>No notifications</span>
            </div>
          )}
        </ScrollArea>
        <DropdownMenuSeparator />
        <div className='p-2'>
          <Button
            variant='ghost'
            size='sm'
            className='w-full justify-center'
            asChild
          >
            <Link to='/settings/notifications'>Notification settings</Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
