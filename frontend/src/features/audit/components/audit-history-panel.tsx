import { useMemo, useState } from 'react'
import {
  Clock3,
  Download,
  FileClock,
  Filter,
  History,
  Paperclip,
  ShieldCheck,
} from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  type AuditEntityType,
  type AuditEvent,
  type AuditHistorySource,
  useAuditEvents,
} from '../hooks/use-audit-events'

interface Props {
  projectId: string
  entityType?: AuditEntityType | string
  entityId?: string | null
  title?: string
  limit?: number
  className?: string
  showFilters?: boolean
}

const ACTION_LABELS: Record<string, string> = {
  answered: 'Answered',
  approved: 'Approved',
  baseline_locked: 'Baseline locked',
  certified: 'Certified',
  closed: 'Closed',
  created: 'Created',
  archived: 'Archived',
  deleted: 'Deleted',
  imported: 'Imported',
  paid: 'Paid',
  rejected: 'Rejected',
  reopened: 'Reopened',
  resubmit_required: 'Resubmit required',
  reviewed: 'Reviewed',
  status_changed: 'Status changed',
  submitted: 'Submitted',
  superseded: 'Superseded',
  updated: 'Updated',
}

const ACTION_CLASS: Record<string, string> = {
  approved: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  baseline_locked: 'border-blue-300 bg-blue-100 text-blue-800',
  certified: 'border-indigo-300 bg-indigo-100 text-indigo-800',
  closed: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  created: 'border-slate-300 bg-slate-100 text-slate-700',
  archived: 'border-zinc-300 bg-zinc-100 text-zinc-800',
  deleted: 'border-rose-300 bg-rose-100 text-rose-800',
  imported: 'border-cyan-300 bg-cyan-100 text-cyan-800',
  paid: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  rejected: 'border-rose-300 bg-rose-100 text-rose-800',
  resubmit_required: 'border-amber-300 bg-amber-100 text-amber-800',
  status_changed: 'border-amber-300 bg-amber-100 text-amber-800',
  submitted: 'border-blue-300 bg-blue-100 text-blue-800',
  superseded: 'border-zinc-300 bg-zinc-100 text-zinc-700',
  updated: 'border-sky-300 bg-sky-100 text-sky-800',
}

const SOURCE_LABELS: Record<string, string> = {
  all: 'All sources',
  approval: 'Approvals',
  audit: 'Audit',
  status: 'Status',
}

const SOURCE_CLASS: Record<string, string> = {
  approval: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  audit: 'border-sky-500/40 text-sky-700 dark:text-sky-300',
  status: 'border-amber-500/40 text-amber-700 dark:text-amber-300',
}

const ACTION_FILTERS = [
  'all',
  'created',
  'updated',
  'status_changed',
  'submitted',
  'reviewed',
  'approved',
  'rejected',
  'certified',
  'closed',
  'paid',
  'baseline_locked',
  'superseded',
]

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

const attachmentName = (attachment: Record<string, unknown>) =>
  String(
    attachment.fileName ||
      attachment.filename ||
      attachment.originalName ||
      attachment.description ||
      attachment.storageKey ||
      'Attachment'
  )

const attachmentUrl = (attachment: Record<string, unknown>) =>
  typeof attachment.fileUrl === 'string'
    ? attachment.fileUrl
    : typeof attachment.url === 'string'
      ? attachment.url
      : null

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
    ['decision', event.decision ?? summary.decision],
    ['comment', event.comment ?? summary.comment],
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

function toCsvValue(value: unknown) {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

function exportHistoryCsv(events: AuditEvent[], title: string) {
  if (typeof window === 'undefined' || events.length === 0) return

  const rows = [
    [
      'source',
      'recordType',
      'recordId',
      'action',
      'decision',
      'actorId',
      'actorRole',
      'occurredAt',
      'fromStatus',
      'toStatus',
      'reason',
      'comment',
      'attachments',
    ],
    ...events.map((event) => [
      event.source || 'audit',
      event.recordType || event.entityType,
      event.recordId || event.entityId,
      event.action,
      event.decision || '',
      event.actorId || '',
      event.actorRole || '',
      event.occurredAt,
      event.fromStatus || event.oldStatus || '',
      event.toStatus || event.newStatus || '',
      event.reason || '',
      event.comment || '',
      event.attachments?.map(attachmentName).join('; ') || '',
    ]),
  ]
  const csv = rows.map((row) => row.map(toCsvValue).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'history'}.csv`
  link.click()
  window.URL.revokeObjectURL(url)
}

function TimelineItem({ event }: { event: AuditEvent }) {
  const label = ACTION_LABELS[event.action] ?? humanize(event.action)
  const actionClass = ACTION_CLASS[event.action] ?? ACTION_CLASS.updated
  const source = event.source || 'audit'
  const statusChanged =
    event.fromStatus || event.toStatus || event.oldStatus || event.newStatus
  const fromStatus = event.fromStatus ?? event.oldStatus
  const toStatus = event.toStatus ?? event.newStatus
  const pieces = summaryPieces(event)
  const note = event.reason || event.comment

  return (
    <li className='grid gap-3 border-b px-3 py-3 last:border-b-0 sm:grid-cols-[170px_minmax(0,1fr)]'>
      <div className='flex items-start gap-2 text-xs text-muted-foreground'>
        <Clock3 className='mt-0.5 h-3.5 w-3.5 shrink-0' />
        <span>{new Date(event.occurredAt).toLocaleString()}</span>
      </div>
      <div className='min-w-0 space-y-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='outline' className={actionClass}>
            {label}
          </Badge>
          <Badge
            variant='outline'
            className={SOURCE_CLASS[source] ?? SOURCE_CLASS.audit}
          >
            {SOURCE_LABELS[source] ?? humanize(source)}
          </Badge>
          {event.decision && (
            <Badge variant='outline'>
              <ShieldCheck className='mr-1 h-3 w-3' />
              {humanize(event.decision)}
            </Badge>
          )}
          {statusChanged && (
            <span className='text-xs text-muted-foreground'>
              {fromStatus ? humanize(fromStatus) : 'New'} {'->'}{' '}
              {toStatus ? humanize(toStatus) : 'None'}
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
          {event.actorRole && (
            <span>
              <span className='text-muted-foreground'>Role </span>
              <span>{humanize(event.actorRole)}</span>
            </span>
          )}
          {event.actorId && (
            <span>
              <span className='text-muted-foreground'>Actor </span>
              <span className='font-mono'>{event.actorId}</span>
            </span>
          )}
          {note && (
            <span className='min-w-0'>
              <span className='text-muted-foreground'>
                {event.reason ? 'Reason ' : 'Comment '}
              </span>
              <span>{note}</span>
            </span>
          )}
        </div>
        {event.attachments?.length > 0 && (
          <div className='flex flex-wrap gap-2'>
            {event.attachments.slice(0, 4).map((attachment, index) => {
              const label = attachmentName(attachment)
              const url = attachmentUrl(attachment)
              return (
                <Badge
                  key={`${label}-${index}`}
                  variant='outline'
                  className='max-w-full gap-1'
                >
                  <Paperclip className='h-3 w-3 shrink-0' />
                  {url ? (
                    <a className='truncate hover:underline' href={url}>
                      {label}
                    </a>
                  ) : (
                    <span className='truncate'>{label}</span>
                  )}
                </Badge>
              )
            })}
          </div>
        )}
      </div>
    </li>
  )
}

export function HistoryPanel({
  projectId,
  entityType,
  entityId,
  title = 'History',
  limit = 20,
  className = '',
  showFilters = true,
}: Props) {
  const canReadAudit = useCanPerform('audit', 'read')
  const [source, setSource] = useState<AuditHistorySource>('all')
  const [action, setAction] = useState('all')
  const { data, isLoading } = useAuditEvents(projectId, {
    entityType,
    entityId,
    action: action === 'all' ? null : action,
    source,
    limit,
    order: 'desc',
  })

  const events = useMemo(
    () => [...(data?.events ?? [])].reverse(),
    [data?.events]
  )

  if (!canReadAudit) return null

  return (
    <section className={`rounded-md border ${className}`}>
      <div className='flex flex-col gap-2 border-b px-3 py-2 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex min-w-0 items-center gap-2'>
          <History className='h-4 w-4 shrink-0 text-muted-foreground' />
          <h3 className='truncate text-sm font-semibold'>{title}</h3>
          <Badge variant='outline'>{events.length}</Badge>
        </div>
        {showFilters && (
          <div className='flex flex-wrap items-center gap-2'>
            <Filter className='hidden h-4 w-4 text-muted-foreground sm:block' />
            <Select
              value={source}
              onValueChange={(value) => setSource(value as AuditHistorySource)}
            >
              <SelectTrigger className='h-8 w-[132px]'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['all', 'audit', 'approval', 'status'] as const).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {SOURCE_LABELS[value]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className='h-8 w-[150px]'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_FILTERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === 'all'
                      ? 'All actions'
                      : (ACTION_LABELS[value] ?? humanize(value))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type='button'
              size='icon'
              variant='outline'
              className='size-8'
              title='Export history'
              aria-label='Export history'
              disabled={events.length === 0}
              onClick={() => exportHistoryCsv(events, title)}
            >
              <Download className='h-4 w-4' />
            </Button>
          </div>
        )}
      </div>
      {isLoading ? (
        <p className='px-3 py-4 text-sm text-muted-foreground'>
          Loading history...
        </p>
      ) : events.length === 0 ? (
        <div className='flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground'>
          <FileClock className='h-4 w-4' />
          <span>No history recorded.</span>
        </div>
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

export function AuditHistoryPanel(props: Props) {
  const { title = 'Audit History', ...rest } = props
  return <HistoryPanel title={title} {...rest} />
}
