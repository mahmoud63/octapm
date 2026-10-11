import type { ReactNode } from 'react'
import type { PageInfo } from '@/services/platform-admin/api'
import { AlertTriangle, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtNumber, humanize } from '../lib/format'

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className='mb-6 flex flex-wrap items-end justify-between gap-3'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>{title}</h1>
        {description ? (
          <p className='mt-1 max-w-3xl text-sm text-muted-foreground'>
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  )
}

export function KpiTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'warning' | 'danger' | 'good'
}) {
  return (
    <Card className='gap-1 py-4'>
      <CardContent className='px-4'>
        <div className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
          {label}
        </div>
        <div
          className={cn(
            'mt-1 text-2xl font-semibold tabular-nums',
            tone === 'warning' && 'text-amber-600 dark:text-amber-400',
            tone === 'danger' && 'text-red-600 dark:text-red-400',
            tone === 'good' && 'text-emerald-600 dark:text-emerald-400'
          )}
        >
          {value}
        </div>
        {hint ? (
          <div className='mt-1 text-xs text-muted-foreground'>{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function Section({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('gap-3', className)}>
      <CardHeader>
        <CardTitle className='text-base'>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function Note({
  children,
  tone = 'info',
}: {
  children: ReactNode
  tone?: 'info' | 'warning'
}) {
  const Icon = tone === 'warning' ? AlertTriangle : Info
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
        tone === 'warning'
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
          : 'bg-muted/40 text-muted-foreground'
      )}
    >
      <Icon className='mt-0.5 size-4 shrink-0' aria-hidden />
      <div>{children}</div>
    </div>
  )
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className='space-y-2' aria-busy='true'>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className='h-8 w-full' />
      ))}
    </div>
  )
}

export function ErrorBlock({ error }: { error: unknown }) {
  const status = (error as { response?: { status?: number } })?.response?.status
  return (
    <Note tone='warning'>
      {status === 403
        ? 'Your platform access was refused. It may have been revoked.'
        : 'This view could not be loaded. Try again; if it persists, check System Health.'}
    </Note>
  )
}

export function Pager({
  page,
  onPage,
}: {
  page: PageInfo | undefined
  onPage: (page: number) => void
}) {
  if (!page) return null
  return (
    <div className='mt-3 flex items-center justify-between text-sm text-muted-foreground'>
      <span>
        {fmtNumber(page.total)} total · page {page.page} of {page.totalPages}
      </span>
      <div className='flex gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={page.page <= 1}
          onClick={() => onPage(page.page - 1)}
        >
          <ChevronLeft className='size-4' /> Previous
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={page.page >= page.totalPages}
          onClick={() => onPage(page.page + 1)}
        >
          Next <ChevronRight className='size-4' />
        </Button>
      </div>
    </div>
  )
}

const FLAG_LABELS: Record<string, string> = {
  organisation_inactive: 'Inactive',
  no_subscription: 'No subscription',
  payment_past_due: 'Past due',
  subscription_ended: 'Subscription ended',
  plan_unrecognized: 'Unknown plan',
  members_exceed_seats: 'Over seats',
  server_errors_7d: '5xx errors (7d)',
  no_activity_90d: 'No activity (90d)',
  no_members: 'No members',
}

export function Flags({ flags }: { flags: string[] }) {
  if (!flags.length)
    return <span className='text-xs text-muted-foreground'>—</span>
  return (
    <div className='flex flex-wrap gap-1'>
      {flags.map((flag) => (
        <Badge
          key={flag}
          variant='outline'
          className='border-amber-400 text-amber-700 dark:text-amber-300'
        >
          {FLAG_LABELS[flag] ?? humanize(flag)}
        </Badge>
      ))}
    </div>
  )
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className='text-muted-foreground'>—</span>
  const tone =
    value === 'active' ||
    value === 'trialing' ||
    value === 'succeeded' ||
    value === 'delivered'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
      : value === 'past_due' ||
          value === 'incomplete' ||
          value === 'queued' ||
          value === 'pending'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
        : value === 'canceled' ||
            value === 'expired' ||
            value === 'failed' ||
            value === 'dead' ||
            value === 'suspended'
          ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
          : 'bg-muted text-muted-foreground'
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', tone)}>
      {humanize(value)}
    </span>
  )
}
