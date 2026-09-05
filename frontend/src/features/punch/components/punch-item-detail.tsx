import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  FileText,
  History,
  Loader2,
  MapPin,
  Pencil,
  Send,
  Trash2,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { CommentThread } from '@/features/comments/components/comment-thread'
import { CustomFieldsPanel } from '@/features/custom-fields/components/custom-fields-panel'
import { RecordPins } from '@/features/drawings/components/record-pins'
import {
  ACTION_LABEL,
  ACTION_PERMISSION,
  ACTIONS_FOR_STATUS,
  REASON_REQUIRED,
  STATUS_LABEL,
  formatPunchDate,
  isPunchLocked,
  useDeletePunchItem,
  usePunchItem,
  useTransitionPunchItem,
  useUpdatePunchItem,
  type PunchAction,
  type PunchEvent,
  type PunchItem,
} from '../hooks/use-punch'
import { formToPayload, itemToForm, type PunchFormValue } from '../lib/form'
import { PunchPriorityBadge, PunchStatusBadge } from './punch-badges'
import { PunchItemForm } from './punch-item-form'

const humanize = (value: string) =>
  value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

function ActionButton({
  action,
  item,
  onRun,
  busy,
}: {
  action: PunchAction
  item: PunchItem
  onRun: (action: PunchAction) => void
  busy: boolean
}) {
  const currentUser = useAuthStore((state) => state.auth.user)
  const permission = ACTION_PERMISSION[action]
  const allowed = useCanPerform(
    'punch',
    permission.action,
    permission.transition
  )
  if (!allowed) return null
  const approverOnly =
    action === 'close' &&
    Boolean(item.finalApproverUserId) &&
    item.finalApproverUserId !== currentUser?.id
  return (
    <Button
      size='sm'
      variant={
        action === 'close' || action === 'open'
          ? 'default'
          : action === 'void'
            ? 'ghost'
            : 'outline'
      }
      disabled={busy || approverOnly}
      title={
        approverOnly
          ? `Only ${item.finalApproverUser?.name ?? 'the final approver'} can close this item`
          : undefined
      }
      onClick={() => onRun(action)}
      data-testid={`uat-punch-action-${action}`}
    >
      {ACTION_LABEL[action]}
    </Button>
  )
}

function Field({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='space-y-0.5'>
      <p className='flex items-center gap-1 text-xs text-muted-foreground'>
        {icon}
        {label}
      </p>
      <div className='text-sm'>{children}</div>
    </div>
  )
}

function Ledger({ events }: { events: PunchEvent[] }) {
  if (!events.length) {
    return <p className='text-sm text-muted-foreground'>Nothing yet.</p>
  }
  return (
    <ol className='space-y-2 text-sm' data-testid='uat-punch-ledger'>
      {events.map((event) => (
        <li key={event.id} className='flex gap-2'>
          <span className='mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/60' />
          <div className='min-w-0 flex-1'>
            <p>
              <span className='font-medium'>{humanize(event.action)}</span>
              {event.fromStatus && event.toStatus && (
                <span className='text-muted-foreground'>
                  {' '}
                  · {humanize(event.fromStatus)} → {humanize(event.toStatus)}
                </span>
              )}
            </p>
            {event.reason && (
              <p className='text-muted-foreground'>“{event.reason}”</p>
            )}
            <p className='text-xs text-muted-foreground'>
              {event.actorName ?? 'System'}
              {event.actorRole ? ` (${humanize(event.actorRole)})` : ''} ·{' '}
              {new Date(event.createdAt).toLocaleString()}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/**
 * One punch item: fields, the next steps its status allows (and the caller
 * may take), an edit form, the event ledger, evidence, pins on drawings,
 * discussion and history.
 */
export function PunchItemDetail({
  projectId,
  itemId,
  onOpenChange,
}: {
  projectId: string
  itemId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const { data: item, isLoading } = usePunchItem(projectId, itemId)
  const canUpdate = useCanPerform('punch', 'update')
  const canDelete = useCanPerform('punch', 'delete')
  const update = useUpdatePunchItem(projectId)
  const transition = useTransitionPunchItem(projectId)
  const remove = useDeletePunchItem(projectId)
  const [form, setForm] = useState<PunchFormValue | null>(null)
  const [reasonFor, setReasonFor] = useState<PunchAction | null>(null)
  const [reason, setReason] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const busy = update.isPending || transition.isPending || remove.isPending

  const perform = async (action: PunchAction, text?: string) => {
    if (!item) return
    try {
      const result = await transition.mutateAsync({
        itemId: item.id,
        action,
        reason: text,
      })
      toast.success(
        `${result.ref} ${STATUS_LABEL[result.status].toLowerCase()}`
      )
      setReasonFor(null)
      setReason('')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const run = (action: PunchAction) => {
    if (REASON_REQUIRED.includes(action)) {
      setReason('')
      setReasonFor(action)
      return
    }
    void perform(action)
  }

  const save = async () => {
    if (!item || !form) return
    try {
      await update.mutateAsync({
        itemId: item.id,
        payload: formToPayload(form, { mode: 'update' }),
      })
      toast.success(`${item.ref} updated`)
      setForm(null)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const destroy = async () => {
    if (!item) return
    try {
      await remove.mutateAsync(item.id)
      toast.success(`${item.ref} deleted`)
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const locked = item ? isPunchLocked(item.status) : true
  const editing = Boolean(form)

  return (
    <Dialog
      open={Boolean(itemId)}
      onOpenChange={(next) => (next ? undefined : onOpenChange(false))}
    >
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-4xl'
        data-testid='uat-punch-detail'
      >
        {isLoading || !item ? (
          <div className='flex items-center gap-2 py-8 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading item…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className='flex flex-wrap items-center gap-2'>
                <span className='font-mono'>{item.ref}</span>
                <span className='min-w-0 flex-1 truncate font-normal'>
                  {item.title}
                </span>
                <PunchStatusBadge status={item.status} />
                <PunchPriorityBadge priority={item.priority} />
                {item.kind === 'observation' && item.observationTypeLabel && (
                  <Badge variant='outline' data-testid='uat-observation-badge'>
                    {item.observationTypeLabel} observation
                  </Badge>
                )}
                {item.isOverdue && (
                  <Badge variant='destructive' className='gap-1'>
                    <AlertTriangle className='h-3 w-3' />
                    {item.daysOverdue} day{item.daysOverdue === 1 ? '' : 's'}{' '}
                    late
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                {item.ballInCourtUser
                  ? `Waiting on ${item.ballInCourtUser.name}`
                  : locked
                    ? 'No further action needed'
                    : 'Nobody is holding this item'}
                {item.reopenCount > 0
                  ? ` · reopened ${item.reopenCount} time${item.reopenCount === 1 ? '' : 's'}`
                  : ''}
                {item.legacyDefectId
                  ? ' · migrated from the defect register'
                  : ''}
              </DialogDescription>
            </DialogHeader>

            {!editing && (
              <div
                className='flex flex-wrap items-center gap-2'
                data-testid='uat-punch-actions'
              >
                {ACTIONS_FOR_STATUS[item.status].map((action) => (
                  <ActionButton
                    key={action}
                    action={action}
                    item={item}
                    onRun={run}
                    busy={busy}
                  />
                ))}
                {canUpdate && !locked && (
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => setForm(itemToForm(item))}
                    data-testid='uat-punch-edit'
                  >
                    <Pencil className='mr-1.5 h-4 w-4' /> Edit
                  </Button>
                )}
                {canDelete && item.status === 'draft' && (
                  <Button
                    size='sm'
                    variant='ghost'
                    className='text-destructive'
                    disabled={busy}
                    onClick={() =>
                      confirmDelete ? void destroy() : setConfirmDelete(true)
                    }
                  >
                    <Trash2 className='mr-1.5 h-4 w-4' />
                    {confirmDelete ? 'Really delete?' : 'Delete draft'}
                  </Button>
                )}
              </div>
            )}

            {item.status === 'in_dispute' && item.disputeReason && (
              <div className='rounded border border-destructive/40 bg-destructive/5 p-3 text-sm'>
                <p className='font-medium'>Disputed</p>
                <p className='text-muted-foreground'>{item.disputeReason}</p>
              </div>
            )}

            {editing && form ? (
              <div className='space-y-3 rounded border p-3'>
                <PunchItemForm
                  projectId={projectId}
                  value={form}
                  onChange={setForm}
                  disabled={busy}
                  idPrefix='punch-edit'
                />
                <div className='flex justify-end gap-2'>
                  <Button variant='ghost' onClick={() => setForm(null)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={save}
                    disabled={busy || !form.title.trim()}
                    data-testid='uat-punch-save'
                  >
                    {update.isPending && (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    )}
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className='grid gap-3 rounded border p-3 sm:grid-cols-2 lg:grid-cols-3'>
                {item.description && (
                  <div className='sm:col-span-2 lg:col-span-3'>
                    <Field label='Details'>
                      <p className='whitespace-pre-wrap'>{item.description}</p>
                    </Field>
                  </div>
                )}
                <Field
                  icon={<Building2 className='h-3 w-3' />}
                  label='Responsible company'
                >
                  {item.assigneeCompany?.name ?? '—'}
                </Field>
                <Field
                  icon={<UserRound className='h-3 w-3' />}
                  label='Assignee'
                >
                  {item.assigneeUser?.name ?? '—'}
                </Field>
                <Field icon={<UserRound className='h-3 w-3' />} label='Manager'>
                  {item.managerUser?.name ?? '—'}
                </Field>
                <Field
                  icon={<UserRound className='h-3 w-3' />}
                  label='Final approver'
                >
                  {item.finalApproverUser?.name ?? 'Anyone who may close'}
                </Field>
                <Field icon={<CalendarClock className='h-3 w-3' />} label='Due'>
                  <span className={item.isOverdue ? 'text-destructive' : ''}>
                    {formatPunchDate(item.dueDate)}
                  </span>
                </Field>
                <Field label='Trade'>{item.trade ?? '—'}</Field>
                {item.kind === 'observation' && (
                  <>
                    <Field label='Hazard'>{item.hazard ?? '—'}</Field>
                    <Field label='Contributing condition'>
                      {item.contributingCondition ?? '—'}
                    </Field>
                  </>
                )}
                {item.sourcePath && (
                  <Field label='Raised from'>
                    <Link
                      to={item.sourcePath}
                      className='underline-offset-2 hover:underline'
                      data-testid='uat-punch-source-link'
                    >
                      {item.sourceRecordType?.replace(/_/g, ' ') ?? 'record'}
                    </Link>
                  </Field>
                )}
                <Field icon={<MapPin className='h-3 w-3' />} label='Location'>
                  {[item.location?.name, item.locationText]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </Field>
                <Field label='Drawing'>
                  {item.sheet ? (
                    <Link
                      to='/projects/$projectId/$module/$child'
                      params={{
                        projectId,
                        module: 'doc-control',
                        child: 'drawings',
                      }}
                      search={{ recordId: item.sheet.id }}
                      className='underline-offset-2 hover:underline'
                    >
                      {item.sheet.number} · {item.sheet.title}
                    </Link>
                  ) : (
                    '—'
                  )}
                </Field>
                <Field label='Timeline'>
                  <span className='text-muted-foreground'>
                    Opened {formatPunchDate(item.openedAt)}
                    {item.readyAt
                      ? ` · ready ${formatPunchDate(item.readyAt)}`
                      : ''}
                    {item.closedAt
                      ? ` · closed ${formatPunchDate(item.closedAt)}`
                      : ''}
                  </span>
                </Field>
                {item.distributedAt && (
                  <Field icon={<Send className='h-3 w-3' />} label='Sent'>
                    {new Date(item.distributedAt).toLocaleString()}
                  </Field>
                )}
              </div>
            )}

            <RecordPins
              projectId={projectId}
              recordType='punch_item'
              recordId={item.id}
            />

            <div className='grid gap-4 lg:grid-cols-2'>
              <section className='space-y-2'>
                <h4 className='flex items-center gap-2 text-sm font-semibold'>
                  <History className='h-4 w-4' /> What happened
                </h4>
                <Ledger events={item.events ?? []} />
              </section>
              <div className='lg:col-span-2'>
                <CustomFieldsPanel
                  projectId={projectId}
                  recordType='punch_item'
                  recordId={item.id}
                  context={item as unknown as Record<string, unknown>}
                />
              </div>
              <section className='space-y-2'>
                <h4 className='flex items-center gap-2 text-sm font-semibold'>
                  <FileText className='h-4 w-4' /> Evidence
                </h4>
                <AttachmentPanel
                  projectId={projectId}
                  recordType='punch_item'
                  recordId={item.id}
                  compact
                />
              </section>
              <div className='lg:col-span-2'>
                <CommentThread
                  projectId={projectId}
                  recordType='punch_item'
                  recordId={item.id}
                />
              </div>
              <div className='lg:col-span-2'>
                <HistoryPanel
                  projectId={projectId}
                  entityType='punch_item'
                  entityId={item.id}
                  title={`${item.ref} History`}
                  limit={30}
                />
              </div>
            </div>
          </>
        )}
      </DialogContent>

      {reasonFor && (
        <Dialog
          open
          onOpenChange={(next) => (next ? undefined : setReasonFor(null))}
        >
          <DialogContent data-testid='uat-punch-reason'>
            <DialogHeader>
              <DialogTitle>{ACTION_LABEL[reasonFor]}</DialogTitle>
              <DialogDescription>
                {reasonFor === 'reopen'
                  ? 'Say what is still wrong so the assignee knows what to fix.'
                  : reasonFor === 'dispute'
                    ? 'Say why this item is not yours or not valid; the manager will decide.'
                    : 'Voided items stay in the record but drop off the list.'}
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-1'>
              <Label htmlFor='punch-reason'>Reason</Label>
              <Textarea
                id='punch-reason'
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={2000}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant='ghost' onClick={() => setReasonFor(null)}>
                Cancel
              </Button>
              <Button
                variant={reasonFor === 'void' ? 'destructive' : 'default'}
                disabled={!reason.trim() || busy}
                onClick={() => perform(reasonFor, reason.trim())}
                data-testid='uat-punch-reason-submit'
              >
                {ACTION_LABEL[reasonFor]}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  )
}
