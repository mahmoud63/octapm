import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Download,
  FileClock,
  FileText,
  GitBranch,
  History,
  Info,
  Paperclip,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'

export interface WorkflowAttachment {
  id?: string
  fileName?: string | null
  filename?: string | null
  fileUrl?: string | null
  url?: string | null
  storageKey?: string | null
  mimeType?: string | null
  description?: string | null
  /** Set when the row comes from the unified Attachment table. */
  attachmentId?: string | null
  documentId?: string | null
}

export interface WorkflowActivityLink {
  id?: string
  activityId: string
  relationType?: string | null
  scheduleImpactDays?: number | null
  notes?: string | null
  activity?: {
    id: string
    name?: string | null
    p6ActivityId?: string | null
    wbsCode?: string | null
    isCritical?: boolean | null
    totalFloat?: number | null
  } | null
}

export interface WorkflowHistoryEntry {
  id?: string
  oldStatus?: string | null
  newStatus?: string | null
  comment?: string | null
  createdBy?: string | null
  actorRole?: string | null
  createdAt?: string | null
}

export interface WorkflowApprovalEntry {
  id?: string | null
  action?: string | null
  decision?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  oldStatus?: string | null
  newStatus?: string | null
  actorId?: string | null
  actorRole?: string | null
  reason?: string | null
  comment?: string | null
  createdAt?: string | null
  occurredAt?: string | null
}

export interface WorkflowRevision {
  id?: string
  projectDocumentId?: string | null
  revision: string
  status?: string | null
  title?: string | null
  documentNumber?: string | null
  category?: string | null
  folderPath?: string | null
  folderKey?: string | null
  discipline?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  fileName?: string | null
  fileUrl?: string | null
  downloadUrl?: string | null
  previewUrl?: string | null
  isLatest?: boolean | null
  readOnly?: boolean | null
  issuedAt?: string | null
  submittedAt?: string | null
  reviewDueAt?: string | null
  approvedAt?: string | null
  supersededAt?: string | null
  notes?: string | null
}

export interface WorkflowDueAlert {
  severity: 'overdue' | 'due_soon'
  days: number
}

export interface WorkflowUserRef {
  id: string
  name: string | null
  email?: string | null
}

export interface WorkflowRecordMeta {
  owner?: string | null
  reviewer?: string | null
  approver?: string | null
  responsible?: string | null
  ownerUserId?: string | null
  reviewerUserId?: string | null
  approverUserId?: string | null
  assigneeUserId?: string | null
  assigneeCompanyId?: string | null
  ballInCourtUserId?: string | null
  ownerUser?: WorkflowUserRef | null
  reviewerUser?: WorkflowUserRef | null
  approverUser?: WorkflowUserRef | null
  assigneeUser?: WorkflowUserRef | null
  ballInCourtUser?: WorkflowUserRef | null
  assigneeCompany?: { id: string; name: string | null } | null
  dueDate?: string | null
  dueAlert?: WorkflowDueAlert | null
  attachmentRefs?: WorkflowAttachment[]
  attachments?: WorkflowAttachment[]
  activityLinks?: WorkflowActivityLink[]
  history?: WorkflowHistoryEntry[]
  approvalHistory?: WorkflowApprovalEntry[]
  revisions?: WorkflowRevision[]
}

interface WorkflowRecordListProps<
  T extends WorkflowRecordMeta & { id: string },
> {
  rows?: T[]
  emptyText: string
  getTitle: (row: T) => string
  getSubtitle?: (row: T) => string | null | undefined
  getRef: (row: T) => string
  getStatus: (row: T) => string
  renderMeta?: (row: T) => ReactNode
  renderActions?: (row: T) => ReactNode
  projectId?: string
  recordType?: string | ((row: T) => string)
}

const formatDate = (value?: string | null) => {
  if (!value) return 'Unscheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unscheduled'
  return date.toLocaleDateString()
}

const statusLabel = (value?: string | null) =>
  value ? String(value).replace(/_/g, ' ') : ''

const attachmentLabel = (attachment: WorkflowAttachment) =>
  attachment.fileName ||
  attachment.filename ||
  attachment.description ||
  attachment.storageKey ||
  'Attachment'

const attachmentUrl = (attachment: WorkflowAttachment) =>
  attachment.fileUrl || attachment.url || null

function AssignmentGrid({ row }: { row: WorkflowRecordMeta }) {
  // Referenced users win over legacy free text; the company shows under the
  // assignee when one is routed.
  const assignments: Array<
    [string, string | null | undefined, string | null | undefined]
  > = [
    [
      'Responsible',
      row.assigneeUser?.name || row.responsible,
      row.assigneeUserId,
    ],
    ['Owner', row.ownerUser?.name || row.owner, row.ownerUserId],
    ['Reviewer', row.reviewerUser?.name || row.reviewer, row.reviewerUserId],
    ['Approver', row.approverUser?.name || row.approver, row.approverUserId],
  ]
  const ballInCourt = row.ballInCourtUserId

  return (
    <div className='grid gap-2 sm:grid-cols-4'>
      {assignments.map(([label, value, userId]) => {
        const holdsBall = Boolean(
          ballInCourt && userId && ballInCourt === userId
        )
        return (
          <div
            key={label}
            className={`min-w-0 rounded border px-3 py-2 ${holdsBall ? 'border-primary/50 bg-primary/5' : ''}`}
          >
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
              <UserRound className='h-3.5 w-3.5' />
              <span>{label}</span>
              {holdsBall && (
                <span className='ms-auto rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase'>
                  Ball in court
                </span>
              )}
            </div>
            <p className='mt-1 truncate text-sm font-medium'>
              {value || 'Open'}
            </p>
            {label === 'Responsible' && row.assigneeCompany?.name && (
              <p className='truncate text-xs text-muted-foreground'>
                {row.assigneeCompany.name}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DueBadge({ row }: { row: WorkflowRecordMeta }) {
  const alert = row.dueAlert
  const label =
    alert?.severity === 'overdue'
      ? `${alert.days}d overdue`
      : alert?.severity === 'due_soon'
        ? `Due in ${alert.days}d`
        : formatDate(row.dueDate)

  return (
    <Badge
      variant={alert?.severity === 'overdue' ? 'destructive' : 'outline'}
      className={cn(
        alert?.severity === 'due_soon' && 'border-amber-500 text-amber-600'
      )}
    >
      <CalendarClock className='mr-1 h-3 w-3' />
      {label}
    </Badge>
  )
}

function ActivityLinks({ links = [] }: { links?: WorkflowActivityLink[] }) {
  if (!links.length) {
    return <p className='text-sm text-muted-foreground'>No linked activities</p>
  }

  return (
    <div className='space-y-2'>
      {links.map((link) => (
        <div
          key={link.id || `${link.activityId}-${link.relationType}`}
          className='flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-sm'
        >
          <GitBranch className='h-4 w-4 text-muted-foreground' />
          <span className='font-medium'>
            {link.activity?.p6ActivityId ||
              link.activity?.wbsCode ||
              link.activityId}
          </span>
          <span className='min-w-0 flex-1 truncate'>
            {link.activity?.name || 'Linked activity'}
          </span>
          {link.activity?.isCritical && (
            <Badge variant='destructive'>Critical</Badge>
          )}
          <Badge variant='outline'>{statusLabel(link.relationType)}</Badge>
        </div>
      ))}
    </div>
  )
}

function AttachmentList({
  attachments = [],
}: {
  attachments?: WorkflowAttachment[]
}) {
  if (!attachments.length) {
    return <p className='text-sm text-muted-foreground'>No evidence attached</p>
  }

  return (
    <div className='space-y-2'>
      {attachments.map((attachment, index) => {
        const url = attachmentUrl(attachment)
        const label = attachmentLabel(attachment)
        return (
          <div
            key={attachment.id || `${label}-${index}`}
            className='flex min-w-0 items-center gap-2 rounded border px-3 py-2 text-sm'
          >
            <Paperclip className='h-4 w-4 text-muted-foreground' />
            {url ? (
              <a
                className='truncate font-medium underline-offset-4 hover:underline'
                href={url}
              >
                {label}
              </a>
            ) : (
              <span className='truncate font-medium'>{label}</span>
            )}
            {attachment.mimeType && (
              <Badge variant='outline' className='ml-auto'>
                {attachment.mimeType.split('/').pop()}
              </Badge>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RevisionList({ revisions = [] }: { revisions?: WorkflowRevision[] }) {
  if (!revisions.length) {
    return (
      <p className='text-sm text-muted-foreground'>No revision snapshots</p>
    )
  }

  return (
    <div className='space-y-2'>
      {revisions.map((revision) => {
        const downloadUrl = revision.downloadUrl || revision.fileUrl
        const isSuperseded =
          revision.readOnly || statusLabel(revision.status) === 'superseded'

        return (
          <div
            key={revision.id || revision.revision}
            className='flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-sm'
          >
            <FileClock className='h-4 w-4 text-muted-foreground' />
            <span className='font-medium'>Rev {revision.revision}</span>
            {revision.isLatest && <Badge>Latest</Badge>}
            {revision.status && (
              <Badge variant={isSuperseded ? 'secondary' : 'outline'}>
                {statusLabel(revision.status)}
              </Badge>
            )}
            {isSuperseded && <Badge variant='outline'>Read-only</Badge>}
            <span className='min-w-0 flex-1 truncate'>
              {revision.title || revision.fileName || 'Revision snapshot'}
            </span>
            <span className='text-xs text-muted-foreground'>
              {formatDate(revision.approvedAt || revision.issuedAt)}
            </span>
            {downloadUrl && (
              <Button asChild variant='outline' size='sm'>
                <a href={downloadUrl} download>
                  <Download className='mr-2 h-4 w-4' />
                  Download
                </a>
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function HistoryList({ history = [] }: { history?: WorkflowHistoryEntry[] }) {
  if (!history.length) {
    return <p className='text-sm text-muted-foreground'>No status history</p>
  }

  return (
    <div className='space-y-2'>
      {history.map((entry, index) => (
        <div
          key={entry.id || `${entry.newStatus}-${index}`}
          className='rounded border px-3 py-2 text-sm'
        >
          <div className='flex flex-wrap items-center gap-2'>
            <History className='h-4 w-4 text-muted-foreground' />
            <span className='font-medium'>
              {statusLabel(entry.oldStatus) || 'created'}
            </span>
            <span className='text-muted-foreground'>to</span>
            <Badge variant='outline'>{statusLabel(entry.newStatus)}</Badge>
            <span className='ml-auto text-xs text-muted-foreground'>
              {formatDate(entry.createdAt)}
            </span>
          </div>
          {entry.comment && (
            <p className='mt-1 text-muted-foreground'>{entry.comment}</p>
          )}
        </div>
      ))}
    </div>
  )
}

function ApprovalList({ history = [] }: { history?: WorkflowApprovalEntry[] }) {
  if (!history.length) {
    return (
      <p className='text-sm text-muted-foreground'>No approval decisions</p>
    )
  }

  return (
    <div className='space-y-2'>
      {history.map((entry, index) => {
        const fromStatus = entry.fromStatus ?? entry.oldStatus
        const toStatus = entry.toStatus ?? entry.newStatus
        const note = entry.reason || entry.comment
        return (
          <div
            key={entry.id || `${entry.action}-${index}`}
            className='rounded border px-3 py-2 text-sm'
          >
            <div className='flex flex-wrap items-center gap-2'>
              <ShieldCheck className='h-4 w-4 text-muted-foreground' />
              <Badge variant='outline'>{statusLabel(entry.action)}</Badge>
              {entry.decision && <Badge>{statusLabel(entry.decision)}</Badge>}
              <span className='text-xs text-muted-foreground'>
                {statusLabel(fromStatus) || 'created'} {'->'}{' '}
                {statusLabel(toStatus) || 'open'}
              </span>
              <span className='ml-auto text-xs text-muted-foreground'>
                {formatDate(entry.createdAt || entry.occurredAt)}
              </span>
            </div>
            <div className='mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground'>
              {entry.actorRole && <span>{statusLabel(entry.actorRole)}</span>}
              {entry.actorId && (
                <span className='font-mono'>{entry.actorId}</span>
              )}
            </div>
            {note && <p className='mt-1 text-muted-foreground'>{note}</p>}
          </div>
        )
      })}
    </div>
  )
}

export function WorkflowRecordList<
  T extends WorkflowRecordMeta & { id: string },
>({
  rows,
  emptyText,
  getTitle,
  getSubtitle,
  getRef,
  getStatus,
  renderMeta,
  renderActions,
  projectId,
  recordType,
}: WorkflowRecordListProps<T>) {
  const [selectedId, setSelectedId] = useState<string | null>(
    rows?.[0]?.id || null
  )
  const selected = useMemo(
    () => rows?.find((row) => row.id === selectedId) || rows?.[0],
    [rows, selectedId]
  )

  if (!rows?.length) {
    return (
      <div className='rounded border p-4 text-sm text-muted-foreground'>
        {emptyText}
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {rows.map((row) => {
        const attachments = row.attachments || row.attachmentRefs || []
        const isSelected = selected?.id === row.id
        return (
          <div
            key={row.id}
            className={cn(
              'rounded border bg-background',
              isSelected && 'border-primary/60'
            )}
          >
            <div className='flex flex-col gap-3 p-3 sm:flex-row sm:items-center'>
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Badge variant='outline'>{getRef(row)}</Badge>
                  <Badge>{statusLabel(getStatus(row))}</Badge>
                  {row.dueAlert?.severity === 'overdue' && (
                    <Badge variant='destructive'>
                      <AlertTriangle className='mr-1 h-3 w-3' />
                      Overdue
                    </Badge>
                  )}
                </div>
                <p className='mt-2 truncate font-medium'>{getTitle(row)}</p>
                {getSubtitle?.(row) && (
                  <p className='mt-1 line-clamp-2 text-sm text-muted-foreground'>
                    {getSubtitle(row)}
                  </p>
                )}
              </div>
              <div className='flex flex-wrap items-center gap-2'>
                {renderActions?.(row)}
                <DueBadge row={row} />
                <Badge variant='outline'>
                  <GitBranch className='mr-1 h-3 w-3' />
                  {row.activityLinks?.length || 0}
                </Badge>
                <Badge variant='outline'>
                  <Paperclip className='mr-1 h-3 w-3' />
                  {attachments.length}
                </Badge>
                <Badge variant='outline'>
                  <ShieldCheck className='mr-1 h-3 w-3' />
                  {row.approvalHistory?.length || 0}
                </Badge>
                <Button
                  variant={isSelected ? 'default' : 'outline'}
                  size='sm'
                  onClick={() => setSelectedId(row.id)}
                >
                  <Info className='mr-2 h-4 w-4' />
                  Details
                </Button>
              </div>
            </div>

            {isSelected && (
              <div className='space-y-4 border-t p-3'>
                {renderMeta?.(row)}
                <AssignmentGrid row={row} />
                <div className='grid gap-4 lg:grid-cols-2'>
                  <section className='space-y-2'>
                    <h4 className='flex items-center gap-2 text-sm font-semibold'>
                      <GitBranch className='h-4 w-4' />
                      Activities
                    </h4>
                    <ActivityLinks links={row.activityLinks} />
                  </section>
                  <section className='space-y-2'>
                    <h4 className='flex items-center gap-2 text-sm font-semibold'>
                      <FileText className='h-4 w-4' />
                      Evidence
                    </h4>
                    {projectId && recordType ? (
                      <AttachmentPanel
                        projectId={projectId}
                        recordType={
                          typeof recordType === 'function'
                            ? recordType(row)
                            : recordType
                        }
                        recordId={row.id}
                        legacyAttachments={attachments.filter(
                          (attachment) => !attachment.attachmentId
                        )}
                        compact
                      />
                    ) : (
                      <AttachmentList attachments={attachments} />
                    )}
                  </section>
                  <section className='space-y-2'>
                    <h4 className='flex items-center gap-2 text-sm font-semibold'>
                      <FileClock className='h-4 w-4' />
                      Revisions
                    </h4>
                    <RevisionList revisions={row.revisions} />
                  </section>
                  {projectId && recordType ? (
                    <div className='lg:col-span-2'>
                      <HistoryPanel
                        projectId={projectId}
                        entityType={
                          typeof recordType === 'function'
                            ? recordType(row)
                            : recordType
                        }
                        entityId={row.id}
                        title={`${getRef(row)} History`}
                        limit={30}
                      />
                    </div>
                  ) : (
                    <>
                      <section className='space-y-2'>
                        <h4 className='flex items-center gap-2 text-sm font-semibold'>
                          <History className='h-4 w-4' />
                          History
                        </h4>
                        <HistoryList history={row.history} />
                      </section>
                      <section className='space-y-2'>
                        <h4 className='flex items-center gap-2 text-sm font-semibold'>
                          <ShieldCheck className='h-4 w-4' />
                          Approvals
                        </h4>
                        <ApprovalList history={row.approvalHistory} />
                      </section>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
