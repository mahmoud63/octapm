import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Download, FileText, Loader2, Lock, MessageSquare, RotateCcw, Send, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { AiAction } from '@/features/ai/components/ai-action'
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { downloadFromApi } from '@/features/bim/hooks/use-bim-5d'
import {
  type Decision,
  type ReviewCycle,
  type ReviewDetail,
  reviewFileUrl,
  useAcknowledgeReview,
  useAddReviewMessage,
  useChangeReviewDue,
  useCloseReview,
  useCreateReviewRevision,
  useDecideReview,
  useReassignReview,
  useReviewDetail,
  useWithdrawReview,
} from '../hooks/use-external-reviews'
import { formatDay, formatDuration, formatDurationLong, formatStamp, tick } from '../lib/duration'
import { ResubmitDialog } from './submit-to-consultant'

export const STATUS_TONE: Record<string, string> = {
  submitted: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  under_review: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  returned: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  revising: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  responded: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  acknowledged: 'bg-muted text-muted-foreground',
  closed: 'bg-muted text-muted-foreground',
  withdrawn: 'bg-muted text-muted-foreground',
}
const DECISION_TONE: Record<string, string> = {
  approved: 'text-emerald-700 dark:text-emerald-400',
  approved_with_comments: 'text-emerald-700 dark:text-emerald-400',
  returned: 'text-amber-800 dark:text-amber-300',
  rejected: 'text-destructive',
}

export function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap', className)}>{children}</span>
}

const run = async (promise: Promise<unknown>, done: string) => {
  try {
    await promise
    toast.success(done)
    return true
  } catch (error) {
    toast.error(getServerErrorMessage(error))
    return false
  }
}

function Fact({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: string }) {
  return (
    <div className='min-w-0 rounded-md border bg-card px-3 py-2'>
      <p className='text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'>{label}</p>
      <p className={cn('mt-0.5 text-base font-semibold tabular-nums', tone)}>{value}</p>
      {hint && <p className='text-[11px] text-muted-foreground'>{hint}</p>}
    </div>
  )
}

function FileList({ projectId, reviewId, files }: { projectId: string; reviewId: string; files: Array<{ id: string; label: string }> }) {
  if (!files.length) return <p className='text-xs text-muted-foreground'>No files.</p>
  return (
    <ul className='flex flex-wrap gap-1.5'>
      {files.map((file) => (
        <li key={file.id}>
          <Button size='sm' variant='outline' className='h-7 gap-1 px-2 text-xs' onClick={() => downloadFromApi(reviewFileUrl(projectId, reviewId, file.id), file.label).catch((error) => toast.error(getServerErrorMessage(error)))}>
            <FileText className='h-3.5 w-3.5' /> {file.label} <Download className='h-3 w-3 opacity-60' />
          </Button>
        </li>
      ))}
    </ul>
  )
}

function IssuedContent({ projectId, review, cycle }: { projectId: string; review: ReviewDetail; cycle: ReviewCycle }) {
  return (
    <div className='space-y-2'>
      <dl className='grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1 text-sm'>
        {(cycle.snapshot.fields || []).map((field) => (
          <div key={field.label} className='contents'>
            <dt className='text-muted-foreground'>{field.label}</dt>
            <dd className='min-w-0 break-words whitespace-pre-wrap'>{field.value}</dd>
          </div>
        ))}
      </dl>
      {cycle.coverNote && <p className='rounded-md bg-muted/40 p-2 text-sm'><span className='font-medium'>Cover note: </span>{cycle.coverNote}</p>}
      <div>
        <p className='mb-1 text-xs font-medium text-muted-foreground'>Files issued with revision {cycle.revision}</p>
        <FileList projectId={projectId} reviewId={review.id} files={cycle.issuedFiles} />
      </div>
    </div>
  )
}

function ReasonDialog({ open, title, description, confirm, onClose, onConfirm, pending, extra }: { open: boolean; title: string; description: string; confirm: string; onClose: () => void; onConfirm: (reason: string) => void; pending: boolean; extra?: React.ReactNode }) {
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (open) setReason('')
  }, [open])
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {extra}
        <div className='space-y-1.5'>
          <Label htmlFor='review-reason'>Reason</Label>
          <Textarea id='review-reason' rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Cancel</Button>
          <Button disabled={!reason.trim() || pending} onClick={() => onConfirm(reason.trim())}>{pending && <Loader2 className='h-4 w-4 animate-spin' />} {confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The consultant's authoritative response: decision, required comments where the decision needs them, and response files. */
function RespondPanel({ projectId, review }: { projectId: string; review: ReviewDetail }) {
  const decide = useDecideReview(projectId)
  const [decision, setDecision] = useState<Decision | ''>('')
  const [comment, setComment] = useState('')
  const cycle = review.cycles[review.cycles.length - 1]
  const chosen = review.decisions.find((row) => row.value === decision)
  const needsComment = Boolean(chosen?.commentRequired)
  return (
    <section className='space-y-3 rounded-md border-2 border-primary/40 p-3' data-testid='uat-review-respond'>
      <h3 className='text-sm font-semibold'>Your response — revision {cycle.revision}</h3>
      <RadioGroup value={decision} onValueChange={(value) => setDecision(value as Decision)} className='grid gap-2 sm:grid-cols-2'>
        {review.decisions.map((option) => (
          <label key={option.value} className={cn('flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm', decision === option.value && 'border-primary bg-primary/5')}>
            <RadioGroupItem value={option.value} /> <span className={cn('font-medium', DECISION_TONE[option.value])}>{option.label}</span>
          </label>
        ))}
      </RadioGroup>
      <div className='space-y-1.5'>
        <Label htmlFor='review-comment'>Comments{needsComment ? ' (required)' : ''}</Label>
        <Textarea id='review-comment' rows={4} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={decision === 'returned' || decision === 'rejected' ? 'Say what must change before it can be accepted.' : 'Comments for the contractor.'} />
      </div>
      {review.actions.attachResponse && (
        <div>
          <p className='mb-1 text-xs font-medium text-muted-foreground'>Response files (markups, letters, annotated PDFs) — fixed once you respond</p>
          <AttachmentPanel projectId={projectId} recordType='external_review_cycle' recordId={cycle.id} compact />
        </div>
      )}
      <div className='flex flex-wrap items-center gap-2'>
        <Button disabled={!decision || (needsComment && !comment.trim()) || decide.isPending} onClick={() => decision && run(decide.mutateAsync({ id: review.id, decision, comment: comment.trim() || undefined }), `Response sent: ${chosen?.label}`)} data-testid='uat-review-respond-submit'>
          {decide.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : <Send className='h-4 w-4' />} Submit response
        </Button>
        <span className='text-xs text-muted-foreground'>The contractor is notified; your response, comments and files are kept as given.</span>
      </div>
    </section>
  )
}

function Correspondence({ projectId, review }: { projectId: string; review: ReviewDetail }) {
  const add = useAddReviewMessage(projectId)
  const [body, setBody] = useState('')
  const [tab, setTab] = useState<'shared' | 'internal'>('shared')
  const shared = review.messages.filter((message) => message.visibility === 'shared')
  const internal = review.messages.filter((message) => message.visibility === 'internal')
  const list = tab === 'shared' ? shared : internal
  const canPost = tab === 'shared' ? review.actions.commentShared : review.actions.commentInternal
  return (
    <section className='space-y-2 rounded-md border p-3'>
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'shared' | 'internal')}>
        <TabsList className='h-8'>
          <TabsTrigger value='shared' className='text-xs'><MessageSquare className='me-1 h-3.5 w-3.5' /> Consultant correspondence ({shared.length})</TabsTrigger>
          {review.viewerSide === 'contractor' && <TabsTrigger value='internal' className='text-xs'><Lock className='me-1 h-3.5 w-3.5' /> Internal notes ({internal.length})</TabsTrigger>}
        </TabsList>
        <TabsContent value={tab} className='mt-2 space-y-2'>
          <p className='text-[11px] text-muted-foreground'>{tab === 'shared' ? 'Visible to the contractor and the consultant participants on this review.' : 'Only the contractor’s own people can see these. Never shown to a consultant.'}</p>
          {list.length === 0 && <p className='text-xs text-muted-foreground'>Nothing yet.</p>}
          <ul className='space-y-1.5'>
            {list.map((message) => (
              <li key={message.id} className={cn('rounded-md border p-2 text-sm', message.visibility === 'internal' && 'border-amber-500/40 bg-amber-500/5')}>
                <p className='text-[11px] text-muted-foreground'>{message.author || '—'} · {message.side} · {formatStamp(message.at)} · cycle {message.cycle}</p>
                <p className='whitespace-pre-wrap'>{message.body}</p>
              </li>
            ))}
          </ul>
          {canPost && (
            <div className='flex gap-2'>
              <Textarea rows={2} value={body} onChange={(event) => setBody(event.target.value)} placeholder={tab === 'shared' ? 'Write to the other party…' : 'Internal note (contractor only)…'} />
              <Button size='sm' className='self-end' disabled={!body.trim() || add.isPending} onClick={async () => { if (await run(add.mutateAsync({ id: review.id, body: body.trim(), visibility: tab }), tab === 'shared' ? 'Sent' : 'Internal note saved')) setBody('') }}>
                {tab === 'internal' ? <Lock className='h-4 w-4' /> : <Send className='h-4 w-4' />}
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}

function CycleCard({ projectId, review, cycle, current }: { projectId: string; review: ReviewDetail; cycle: ReviewCycle; current: boolean }) {
  const [open, setOpen] = useState(current)
  return (
    <li className={cn('rounded-md border', current && 'border-primary/40')}>
      <button type='button' className='flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm' onClick={() => setOpen((value) => !value)}>
        <span className='font-semibold'>Cycle {cycle.cycle} · Revision {cycle.revision}</span>
        <span className='text-xs text-muted-foreground'>submitted {formatStamp(cycle.submittedAt)} by {cycle.submittedBy || '—'}</span>
        {cycle.respondedAt ? (
          <span className={cn('text-xs font-medium', DECISION_TONE[cycle.decision || ''])}>{cycle.decisionLabel} · {formatStamp(cycle.respondedAt)} · consultant time {formatDuration(cycle.responseMs)}{cycle.respondedLate ? ` · late by ${formatDuration(cycle.overdueMs)}` : ' · on time'}</span>
        ) : cycle.withdrawnAt ? (
          <span className='text-xs text-muted-foreground'>Withdrawn {formatStamp(cycle.withdrawnAt)}</span>
        ) : (
          <span className='text-xs font-medium text-sky-700 dark:text-sky-400'>Open {formatDuration(cycle.openMs)}{cycle.overdue ? ` · overdue ${formatDuration(cycle.overdueMs)}` : ''}</span>
        )}
        {cycle.contractorMsBefore !== null && <span className='text-xs text-muted-foreground'>contractor revision time before: {formatDuration(cycle.contractorMsBefore)}</span>}
      </button>
      {open && (
        <div className='space-y-3 border-t px-3 py-3'>
          <dl className='grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4'>
            <div><dt className='text-muted-foreground'>Submitted</dt><dd>{formatStamp(cycle.submittedAt)}</dd></div>
            <div><dt className='text-muted-foreground'>Due</dt><dd>{formatStamp(cycle.dueAt)}</dd></div>
            <div><dt className='text-muted-foreground'>First opened</dt><dd>{cycle.firstOpenedAt ? `${formatStamp(cycle.firstOpenedAt)}${cycle.firstOpenedBy ? ` · ${cycle.firstOpenedBy}` : ''}` : 'Not yet'}</dd></div>
            <div><dt className='text-muted-foreground'>Responsible</dt><dd>{cycle.responsible.name || '—'}</dd></div>
            <div><dt className='text-muted-foreground'>Responded</dt><dd>{cycle.respondedAt ? `${formatStamp(cycle.respondedAt)} · ${cycle.respondedBy || '—'}` : '—'}</dd></div>
            <div><dt className='text-muted-foreground'>Acknowledged</dt><dd>{cycle.acknowledgedAt ? `${formatStamp(cycle.acknowledgedAt)} · ${cycle.acknowledgedBy || '—'}` : '—'}</dd></div>
          </dl>
          <div>
            <p className='mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase'>What was issued</p>
            <IssuedContent projectId={projectId} review={review} cycle={cycle} />
          </div>
          {cycle.respondedAt && (
            <div className='space-y-1.5 rounded-md bg-muted/30 p-2'>
              <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>Response</p>
              <p className={cn('text-sm font-semibold', DECISION_TONE[cycle.decision || ''])}>{cycle.decisionLabel}</p>
              {cycle.responseComment && <p className='text-sm whitespace-pre-wrap'>{cycle.responseComment}</p>}
              <FileList projectId={projectId} reviewId={review.id} files={cycle.responseFiles} />
            </div>
          )}
          {cycle.withdrawReason && <p className='text-sm'><span className='font-medium'>Withdrawn: </span>{cycle.withdrawReason}</p>}
        </div>
      )}
    </li>
  )
}

/** One review, for the contractor or the consultant: who has the action, how long, when due, what was issued and answered, every cycle. */
export function ReviewSheet({ projectId, reviewId, onClose }: { projectId: string; reviewId: string | null; onClose: () => void }) {
  const { data: review, isLoading, dataUpdatedAt } = useReviewDetail(projectId, reviewId)
  const acknowledge = useAcknowledgeReview(projectId)
  const revise = useCreateReviewRevision(projectId)
  const withdraw = useWithdrawReview(projectId)
  const close = useCloseReview(projectId)
  const reassign = useReassignReview(projectId)
  const changeDue = useChangeReviewDue(projectId)
  const [dialog, setDialog] = useState<null | 'withdraw' | 'close' | 'reassign' | 'due' | 'resubmit'>(null)
  const [newReviewer, setNewReviewer] = useState('')
  const [newDue, setNewDue] = useState('')
  const [, force] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => force((value) => value + 1), 30_000)
    return () => clearInterval(timer)
  }, [])
  if (!reviewId) return null
  const serverNow = dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined
  const current = review?.cycles[review.cycles.length - 1]
  const running = Boolean(review?.awaitingConsultant)
  const openMs = review ? tick(review.openMs, serverNow, running) : 0
  const overdueMs = review ? tick(review.overdueMs, serverNow, running && review.overdue) : 0
  const reviewers = review?.reassignTo ?? []
  const consultantAi = review?.viewerSide === 'consultant'
  const recordContext = review ? { recordType: 'external_submission', recordId: review.id, label: `${review.sourceRef} (${review.sourceLabel})` } : null

  return (
    <Sheet open onOpenChange={(value) => !value && onClose()}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-3xl' data-testid='uat-review-sheet'>
        {isLoading || !review || !current ? (
          <>
            <SheetHeader className='sr-only'><SheetTitle>Consultant review</SheetTitle><SheetDescription>Loading the review</SheetDescription></SheetHeader>
            <p className='flex items-center gap-2 p-6 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' /> Loading the review…</p>
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className='flex flex-wrap items-center gap-2 pe-6'>
                <span className='font-mono text-sm text-muted-foreground'>{review.sourceLabel}</span>
                {review.sourceRef} · {review.title}
              </SheetTitle>
              <SheetDescription className='flex flex-wrap items-center gap-2'>
                <Pill className={STATUS_TONE[review.status]}>{review.statusLabel}</Pill>
                {review.overdue && <Pill className='bg-destructive/15 text-destructive'><AlertTriangle className='h-3 w-3' /> OVERDUE</Pill>}
                <span>Review {review.ref} · Revision {review.revision} · Review cycle {review.cycle}{review.cycles.length > 1 ? ` of ${review.cycles.length}` : ''}</span>
              </SheetDescription>
            </SheetHeader>
            <div className='space-y-4 px-4 pb-8'>
              <div className='grid grid-cols-2 gap-2 lg:grid-cols-4' data-testid='uat-review-facts'>
                <Fact label='Current action with' value={<span className='flex items-center gap-1'><UserRound className='h-4 w-4' />{review.actionWith.label}</span>} hint={review.actionWith.side === 'consultant' ? `Reviewer: ${review.actionWith.reviewer || '—'}` : review.actionWith.side === 'contractor' ? (review.status === 'returned' || review.status === 'revising' ? 'Returned for revision' : 'Response received') : '—'} tone={review.actionWith.side === 'consultant' ? 'text-sky-700 dark:text-sky-400' : review.actionWith.side === 'contractor' ? 'text-amber-800 dark:text-amber-300' : undefined} />
                {running ? (
                  <Fact label='Open for' value={formatDurationLong(openMs)} hint={`since submission ${formatStamp(review.submittedAt)}`} tone='text-sky-700 dark:text-sky-400' />
                ) : (
                  <Fact label='Consultant response time' value={review.responseMs !== null ? formatDurationLong(review.responseMs) : '—'} hint={review.respondedAt ? `responded ${formatStamp(review.respondedAt)}` : review.status === 'revising' ? 'revision in preparation' : '—'} />
                )}
                <Fact label='Due' value={formatDay(review.dueAt)} hint={formatStamp(review.dueAt)} />
                <Fact label={review.overdue ? 'Overdue by' : review.respondedLate ? 'Responded late by' : 'Overdue'} value={review.overdue || review.respondedLate ? formatDurationLong(overdueMs) : 'No'} tone={review.overdue || review.respondedLate ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'} hint={`Total elapsed ${formatDuration(tick(review.totalElapsedMs, serverNow, !review.closedAt))} since first submission`} />
              </div>
              <p className='text-xs text-muted-foreground'>
                To {review.party.name}; responsible reviewer <span className='font-medium text-foreground'>{review.responsible.name || '—'}</span>
                {review.recipients.filter((row) => row.role === 'cc').length > 0 && <> · CC {review.recipients.filter((row) => row.role === 'cc').map((row) => `${row.name}${row.party ? ` (${row.party})` : ''}`).join(', ')}</>}
                {' · '}Clock starts at the formal submission; calendar time, not contract working days.
              </p>

              <div className='flex flex-wrap gap-1.5'>
                {consultantAi ? (
                  <>
                    <AiAction label={`Summarize this ${review.sourceLabel}`} question={`Summarize this ${review.sourceLabel.toLowerCase()} as issued to me: what is asked, what was issued with it, and what changed between revisions.`} record={recordContext} variant='ghost' className='h-7 text-xs' />
                    <AiAction label='Summarize Related Documents' question='Summarize the files issued with this submission and how they relate to what is asked. Use only what was issued.' record={recordContext} variant='ghost' className='h-7 text-xs' />
                    <AiAction label='Draft Review Comment' question='Draft a review comment I could send for this submission, based only on what was issued. Mark it as a draft; I decide and send the response myself.' record={recordContext} variant='ghost' className='h-7 text-xs' />
                  </>
                ) : (
                  <>
                    <AiAction label={`Summarize ${review.sourceLabel} Review History`} question={`Summarize the review history of ${review.sourceRef}: each cycle, what was issued, the consultant's decision and comments, and the time each took.`} record={recordContext} variant='ghost' className='h-7 text-xs' />
                    <AiAction label='Summarize Consultant Response' question='Summarize the consultant’s latest response and comments, and what we need to do next.' record={recordContext} variant='ghost' className='h-7 text-xs' />
                  </>
                )}
              </div>

              {review.actions.decide && <RespondPanel projectId={projectId} review={review} />}

              {review.viewerSide === 'contractor' && (
                <div className='flex flex-wrap gap-2' data-testid='uat-review-contractor-actions'>
                  {review.actions.acknowledge && <Button size='sm' disabled={acknowledge.isPending} onClick={() => run(acknowledge.mutateAsync(review.id), 'Response acknowledged')} data-testid='uat-review-acknowledge'><CheckCircle2 className='h-4 w-4' /> Acknowledge Response</Button>}
                  {review.actions.createRevision && <Button size='sm' variant='outline' disabled={revise.isPending} onClick={() => run(revise.mutateAsync({ id: review.id }), `Revision ${review.revision + 1} created — edit the ${review.sourceLabel.toLowerCase()}, then resubmit`)} data-testid='uat-review-create-revision'><RotateCcw className='h-4 w-4' /> Create Revision {review.revision + 1}</Button>}
                  {review.actions.resubmit && <Button size='sm' onClick={() => setDialog('resubmit')} data-testid='uat-review-resubmit'><Send className='h-4 w-4' /> Resubmit Revision {review.revision}</Button>}
                  {review.actions.changeDueDate && <Button size='sm' variant='outline' onClick={() => { setNewDue(review.dueAt.slice(0, 16)); setDialog('due') }}><Clock className='h-4 w-4' /> Change due date</Button>}
                  {review.actions.reassign && <Button size='sm' variant='outline' onClick={() => setDialog('reassign')}>Reassign reviewer</Button>}
                  {review.actions.withdraw && <Button size='sm' variant='ghost' onClick={() => setDialog('withdraw')}>Withdraw</Button>}
                  {review.actions.close && <Button size='sm' variant='ghost' onClick={() => setDialog('close')}>Close</Button>}
                  {review.status === 'revising' && <p className='w-full text-xs text-amber-800 dark:text-amber-300'>Revision {review.revision} is in preparation: edit the {review.sourceLabel.toLowerCase()} itself, then resubmit. Revision {review.revision - 1} and its response stay as they were.</p>}
                </div>
              )}
              {review.viewerSide === 'consultant' && review.actions.reassign && <Button size='sm' variant='outline' onClick={() => setDialog('reassign')}>Reassign within {review.party.name}</Button>}

              <section className='space-y-2'>
                <h3 className='text-sm font-semibold'>Review cycles</h3>
                <ol className='space-y-2'>
                  {[...review.cycles].reverse().map((cycle) => <CycleCard key={cycle.id} projectId={projectId} review={review} cycle={cycle} current={cycle.id === current.id} />)}
                </ol>
              </section>

              <Correspondence projectId={projectId} review={review} />

              <section className='space-y-1.5 rounded-md border p-3'>
                <h3 className='text-sm font-semibold'>History</h3>
                <ol className='space-y-1 text-xs'>
                  {review.timeline.map((event) => (
                    <li key={event.id} className='flex flex-wrap gap-x-2'>
                      <span className='font-mono text-muted-foreground tabular-nums'>{formatStamp(event.at)}</span>
                      <span className='font-medium'>{event.actor}</span>
                      <span>{event.label}</span>
                      {event.cycle !== null && <span className='text-muted-foreground'>· cycle {event.cycle}, revision {event.revision}</span>}
                      {event.detail && <span className='text-muted-foreground'>— {event.detail}</span>}
                      {event.reason && event.action !== 'external_review.decided' && <span className='text-muted-foreground'>(reason: {event.reason})</span>}
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <ResubmitDialog projectId={projectId} review={review} open={dialog === 'resubmit'} onClose={() => setDialog(null)} />
            <ReasonDialog open={dialog === 'withdraw'} title={`Withdraw ${review.sourceRef}`} description='The submission is kept with its history; the consultant is told it was withdrawn. A response already given is never erased.' confirm='Withdraw' pending={withdraw.isPending} onClose={() => setDialog(null)} onConfirm={async (reason) => { if (await run(withdraw.mutateAsync({ id: review.id, reason }), 'Withdrawn')) setDialog(null) }} />
            <ReasonDialog open={dialog === 'close'} title={`Close ${review.ref}`} description='Closes the review without resubmitting. Every cycle and response stays in its history.' confirm='Close' pending={close.isPending} onClose={() => setDialog(null)} onConfirm={async (reason) => { if (await run(close.mutateAsync({ id: review.id, reason }), 'Closed')) setDialog(null) }} />
            <ReasonDialog
              open={dialog === 'due'}
              title='Change the due date'
              description='The change and its reason are kept in the history; the consultant is notified. The review clock keeps its start.'
              confirm='Change due date'
              pending={changeDue.isPending}
              onClose={() => setDialog(null)}
              extra={<div className='space-y-1.5'><Label htmlFor='review-new-due'>New due date</Label><Input id='review-new-due' type='datetime-local' value={newDue} onChange={(event) => setNewDue(event.target.value)} /></div>}
              onConfirm={async (reason) => { if (newDue && (await run(changeDue.mutateAsync({ id: review.id, dueAt: new Date(newDue).toISOString(), reason }), 'Due date changed'))) setDialog(null) }}
            />
            <ReasonDialog
              open={dialog === 'reassign'}
              title='Reassign the responsible reviewer'
              description={`Another member of ${review.party.name}. The original submission time is kept; the change is in the history.`}
              confirm='Reassign'
              pending={reassign.isPending}
              onClose={() => setDialog(null)}
              extra={
                <div className='space-y-1.5'>
                  <Label>New responsible reviewer</Label>
                  {reviewers.length ? (
                    <Select value={newReviewer} onValueChange={setNewReviewer}>
                      <SelectTrigger><SelectValue placeholder='Choose…' /></SelectTrigger>
                      <SelectContent>{reviewers.map((member) => <SelectItem key={member.userId} value={member.userId}>{member.name}{member.jobTitle ? ` — ${member.jobTitle}` : ''}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <p className='text-xs text-muted-foreground'>{review.party.name} has no other active member to reassign to.</p>
                  )}
                </div>
              }
              onConfirm={async (reason) => { if (newReviewer && (await run(reassign.mutateAsync({ id: review.id, responsibleUserId: newReviewer, reason }), 'Reassigned'))) setDialog(null) }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
