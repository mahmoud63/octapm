import { Clock3, History, Paperclip } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import {
  type AuditEntityType,
  type AuditEvent,
  useAuditEvents,
} from '../hooks/use-audit-events'

interface Props {
  projectId: string
  entityType?: AuditEntityType | string
  entityId?: string | null
  title?: string
  limit?: number
  className?: string
}

const ACTION_LABELS: Record<string, string> = {
  approved: 'Approved',
  baseline_locked: 'Baseline locked',
  certified: 'Certified',
  created: 'Created',
  deleted: 'Deleted',
  imported: 'Imported',
  rejected: 'Rejected',
  status_changed: 'Status changed',
  superseded: 'Superseded',
  updated: 'Updated',
}

const ACTION_CLASS: Record<string, string> = {
  approved: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  baseline_locked: 'border-blue-300 bg-blue-100 text-blue-800',
  certified: 'border-indigo-300 bg-indigo-100 text-indigo-800',
  created: 'border-slate-300 bg-slate-100 text-slate-700',
  deleted: 'border-rose-300 bg-rose-100 text-rose-800',
  imported: 'border-cyan-300 bg-cyan-100 text-cyan-800',
  rejected: 'border-rose-300 bg-rose-100 text-rose-800',
  status_changed: 'border-amber-300 bg-amber-100 text-amber-800',
  superseded: 'border-zinc-300 bg-zinc-100 text-zinc-700',
  updated: 'border-sky-300 bg-sky-100 text-sky-800',
}

const humanize = (value: string | null | undefined) =>
  String(value || '')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

const formatMoney = (value: unknown) =>
  typeof value === 'number'
    ? '$' +
      Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : null

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value.toLocaleString()
  if (typeof value === 'number') return Number(value).toLocaleString()
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function summaryPieces(event: AuditEvent) {
  const summary = event.summary || {}
  const pieces = [
    ['ref', summary.ref],
    ['code', summary.code],
    ['title', summary.title],
    ['subject', summary.subject],
    ['status', summary.status],
    ['period', summary.period],
    ['revision', summary.revisionNumber ?? summary.revision],
    ['activity', summary.activityName],
    ['progress', summary.pctComplete ? `${summary.pctComplete}%` : null],
    ['method', summary.method],
    ['amount', formatMoney(summary.amount)],
    ['actual', formatMoney(summary.actual)],
    ['committed', formatMoney(summary.committed)],
    ['forecast', formatMoney(summary.forecast)],
    ['value', formatMoney(summary.value)],
    ['certified', formatMoney(summary.totalCert)],
    ['net', formatMoney(summary.netPayable)],
    ['locked', summary.lockedActivities],
  ]

  return pieces
    .map(([label, value]) => {
      const formatted = formatValue(value)
      return formatted ? `${humanize(String(label))}: ${formatted}` : null
    })
    .filter((item): item is string => Boolean(item))
}

function TimelineItem({ event }: { event: AuditEvent }) {
  const label = ACTION_LABELS[event.action] ?? humanize(event.action)
  const actionClass = ACTION_CLASS[event.action] ?? ACTION_CLASS.updated
  const statusChanged = event.oldStatus || event.newStatus
  const pieces = summaryPieces(event)

  return (
    <li className='grid gap-3 border-b px-3 py-3 last:border-b-0 sm:grid-cols-[160px_minmax(0,1fr)]'>
      <div className='flex items-start gap-2 text-xs text-muted-foreground'>
        <Clock3 className='mt-0.5 h-3.5 w-3.5 shrink-0' />
        <span>{new Date(event.occurredAt).toLocaleString()}</span>
      </div>
      <div className='min-w-0 space-y-1.5'>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='outline' className={actionClass}>
            {label}
          </Badge>
          {statusChanged && (
            <span className='text-xs text-muted-foreground'>
              {event.oldStatus ? humanize(event.oldStatus) : 'New'} {'->'}{' '}
              {event.newStatus ? humanize(event.newStatus) : 'None'}
            </span>
          )}
          {event.attachments?.length > 0 && (
            <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
              <Paperclip className='h-3.5 w-3.5' />
              {event.attachments.length}
            </span>
          )}
        </div>
        {pieces.length > 0 && (
          <p className='text-xs text-muted-foreground'>{pieces.join(' - ')}</p>
        )}
        <div className='flex flex-wrap gap-x-4 gap-y-1 text-xs'>
          {event.actorId && (
            <span>
              <span className='text-muted-foreground'>Actor </span>
              <span className='font-mono'>{event.actorId}</span>
            </span>
          )}
          {event.reason && (
            <span className='min-w-0'>
              <span className='text-muted-foreground'>Reason </span>
              <span>{event.reason}</span>
            </span>
          )}
        </div>
      </div>
    </li>
  )
}

export function AuditHistoryPanel({
  projectId,
  entityType,
  entityId,
  title = 'Audit History',
  limit = 12,
  className = '',
}: Props) {
  const canReadAudit = useCanPerform('audit', 'read')
  const { data, isLoading } = useAuditEvents(projectId, {
    entityType,
    entityId,
    limit,
    order: 'desc',
  })

  if (!canReadAudit) return null

  const events = [...(data?.events ?? [])].reverse()

  return (
    <section className={`rounded-md border ${className}`}>
      <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
        <div className='flex items-center gap-2'>
          <History className='h-4 w-4 text-muted-foreground' />
          <h3 className='text-sm font-semibold'>{title}</h3>
        </div>
        <Badge variant='outline'>{events.length}</Badge>
      </div>
      {isLoading ? (
        <p className='px-3 py-4 text-sm text-muted-foreground'>
          Loading history...
        </p>
      ) : events.length === 0 ? (
        <p className='px-3 py-4 text-sm text-muted-foreground'>
          No history recorded.
        </p>
      ) : (
        <ol>
          {events.map((event) => (
            <TimelineItem key={event.id} event={event} />
          ))}
        </ol>
      )}
    </section>
  )
}
