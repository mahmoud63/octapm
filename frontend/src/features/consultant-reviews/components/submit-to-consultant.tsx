import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Send, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  type ReviewDetail,
  type SourceType,
  useResubmitReview,
  useReviewRecipients,
  useSourceReviews,
  useSubmitForReview,
} from '../hooks/use-external-reviews'
import { formatDay, formatDuration } from '../lib/duration'
import { ReviewSheet } from './review-sheet'

const toLocalInput = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const daysFromNow = (days: number) => {
  const date = new Date(Date.now() + days * 86_400_000)
  date.setHours(17, 0, 0, 0)
  return toLocalInput(date)
}

function DueField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const tooSoon = value && new Date(value).getTime() <= Date.now()
  return (
    <div className='space-y-1.5'>
      <Label htmlFor='review-due'>Due date</Label>
      <div className='flex flex-wrap items-center gap-2'>
        <Input id='review-due' type='datetime-local' className='w-auto' value={value} min={toLocalInput(new Date())} onChange={(event) => onChange(event.target.value)} />
        {[3, 7, 14].map((days) => <Button key={days} type='button' size='sm' variant='ghost' className='h-7 text-xs' onClick={() => onChange(daysFromNow(days))}>+{days} days</Button>)}
      </div>
      {tooSoon && <p className='text-xs text-destructive'>The due date must be after the submission.</p>}
      <p className='text-[11px] text-muted-foreground'>The consultant’s clock starts when you submit; the response period follows your contract.</p>
    </div>
  )
}

function FilesField({ documents, value, onChange }: { documents: Array<{ id: string; label: string }>; value: string[]; onChange: (value: string[]) => void }) {
  return (
    <div className='space-y-1.5'>
      <Label>Attachments being issued</Label>
      {documents.length === 0 ? (
        <p className='text-xs text-muted-foreground'>No files are attached to the record. Attach them on the record first if they must be issued.</p>
      ) : (
        <ul className='space-y-1'>
          {documents.map((doc) => (
            <li key={doc.id}>
              <label className='flex items-center gap-2 text-sm'>
                <Checkbox checked={value.includes(doc.id)} onCheckedChange={(checked) => onChange(checked ? [...value, doc.id] : value.filter((id) => id !== doc.id))} /> {doc.label}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Submit to Consultant: to, attention (responsible reviewer), CC, due date, cover note and the files issued — revision 1. */
function SubmitDialog({ projectId, sourceType, sourceId, label, documents, open, onClose, onSubmitted }: { projectId: string; sourceType: SourceType; sourceId: string; label: string; documents: Array<{ id: string; label: string }>; open: boolean; onClose: () => void; onSubmitted: (id: string) => void }) {
  const { data: directory, isLoading } = useReviewRecipients(projectId, open)
  const submit = useSubmitForReview(projectId)
  const [partyId, setPartyId] = useState('')
  const [reviewerId, setReviewerId] = useState('')
  const [cc, setCc] = useState<string[]>([])
  const [due, setDue] = useState(daysFromNow(7))
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<string[]>([])
  useEffect(() => {
    if (!open) return
    setPartyId('')
    setReviewerId('')
    setCc([])
    setDue(daysFromNow(7))
    setNote('')
    setFiles(documents.map((doc) => doc.id))
  }, [open, documents])
  const parties = directory?.parties ?? []
  const party = parties.find((row) => row.id === partyId)
  useEffect(() => {
    if (party) setReviewerId((party.members.find((member) => member.isPrimaryReviewer) ?? party.members[0])?.userId ?? '')
  }, [party])
  const others = useMemo(() => parties.flatMap((row) => row.members.filter((member) => member.userId !== reviewerId).map((member) => ({ ...member, partyName: row.name }))), [parties, reviewerId])
  const valid = partyId && reviewerId && due && new Date(due).getTime() > Date.now()
  return (
    <Dialog open={open} onOpenChange={(value) => !value && !submit.isPending && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl' data-testid='uat-submit-to-consultant'>
        <DialogHeader>
          <DialogTitle>Submit {label} to Consultant</DialogTitle>
          <DialogDescription>Issued as revision 1. Once submitted, the issued content and files are kept as they are; changes go into a new revision.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' /> Loading consultants…</p>
        ) : parties.length === 0 ? (
          <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>No consultant has accepted an invitation on this project yet. Invite one under Consultant Reviews → Consultants.</p>
        ) : (
          <div className='space-y-3'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label>To (consultant)</Label>
                <Select value={partyId} onValueChange={setPartyId}>
                  <SelectTrigger className='w-full' data-testid='uat-submit-party'><SelectValue placeholder='Choose the consultant' /></SelectTrigger>
                  <SelectContent>{parties.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className='space-y-1.5'>
                <Label>Attention (responsible reviewer)</Label>
                <Select value={reviewerId} onValueChange={setReviewerId} disabled={!party}>
                  <SelectTrigger className='w-full'><SelectValue placeholder='Choose the reviewer' /></SelectTrigger>
                  <SelectContent>{(party?.members ?? []).map((member) => <SelectItem key={member.userId} value={member.userId}>{member.name}{member.jobTitle ? ` — ${member.jobTitle}` : ''}{member.isPrimaryReviewer ? ' (primary)' : ''}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {others.length > 0 && (
              <div className='space-y-1.5'>
                <Label>CC / supporting reviewers</Label>
                <p className='text-[11px] text-muted-foreground'>They can read and comment; only the responsible reviewer issues the decision.</p>
                <div className='flex flex-wrap gap-x-4 gap-y-1'>
                  {others.map((member) => (
                    <label key={member.userId} className='flex items-center gap-2 text-sm'>
                      <Checkbox checked={cc.includes(member.userId)} onCheckedChange={(checked) => setCc(checked ? [...cc, member.userId] : cc.filter((id) => id !== member.userId))} />
                      {member.name} <span className='text-xs text-muted-foreground'>({member.partyName})</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <DueField value={due} onChange={setDue} />
            <div className='space-y-1.5'>
              <Label htmlFor='review-note'>Message / cover note</Label>
              <Textarea id='review-note' rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder='Please review and provide clarification.' />
            </div>
            <FilesField documents={documents} value={files} onChange={setFiles} />
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Cancel</Button>
          <Button
            disabled={!valid || submit.isPending}
            onClick={async () => {
              try {
                const created = await submit.mutateAsync({ sourceType, sourceId, partyId, responsibleUserId: reviewerId, ccUserIds: cc, dueAt: new Date(due).toISOString(), coverNote: note.trim() || undefined, documentIds: files })
                toast.success(`${label} submitted to ${party?.name} — the review clock has started`)
                onSubmitted(created.id)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
            data-testid='uat-submit-to-consultant-confirm'
          >
            {submit.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : <Send className='h-4 w-4' />} Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Resubmit the revised record as the next revision, in a new review cycle. */
export function ResubmitDialog({ projectId, review, open, onClose }: { projectId: string; review: ReviewDetail; open: boolean; onClose: () => void }) {
  const { data: source } = useSourceReviews(projectId, review.sourceType, open ? review.sourceId : null)
  const resubmit = useResubmitReview(projectId)
  const [due, setDue] = useState(daysFromNow(7))
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const documents = useMemo(() => source?.documents ?? review.cycles[review.cycles.length - 1].issuedFiles, [source, review])
  useEffect(() => {
    if (open) {
      setDue(daysFromNow(7))
      setNote('')
    }
  }, [open])
  useEffect(() => {
    if (open) setFiles(documents.map((doc) => doc.id))
  }, [open, documents])
  return (
    <Dialog open={open} onOpenChange={(value) => !value && !resubmit.isPending && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Resubmit {review.sourceRef} — revision {review.revision}</DialogTitle>
          <DialogDescription>To {review.party.name}, attention {review.responsible.name}. A new review cycle starts with its own clock; earlier cycles stay as they were.</DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <DueField value={due} onChange={setDue} />
          <div className='space-y-1.5'>
            <Label htmlFor='review-resubmit-note'>What changed (cover note)</Label>
            <Textarea id='review-resubmit-note' rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <FilesField documents={documents} value={files} onChange={setFiles} />
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Cancel</Button>
          <Button disabled={!due || new Date(due).getTime() <= Date.now() || resubmit.isPending} onClick={async () => {
            try {
              await resubmit.mutateAsync({ id: review.id, dueAt: new Date(due).toISOString(), coverNote: note.trim() || undefined, documentIds: files })
              toast.success(`Revision ${review.revision} resubmitted — review cycle ${review.cycle + 1} started`)
              onClose()
            } catch (error) {
              toast.error(getServerErrorMessage(error))
            }
          }} data-testid='uat-resubmit-confirm'>
            {resubmit.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : <Send className='h-4 w-4' />} Resubmit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The consultant review of one record, inside the record (RFI, submittal,
 * report, inspection, NCR, closeout deliverable): who has the action, how
 * long, due, and Submit to Consultant when it is not under review.
 */
export function ExternalReviewPanel({ projectId, sourceType, sourceId, label, className }: { projectId: string; sourceType: SourceType; sourceId: string; label: string; className?: string }) {
  const canRead = useCanPerform('external_review', 'read')
  const { data } = useSourceReviews(projectId, sourceType, canRead ? sourceId : null)
  const [submitting, setSubmitting] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  if (!canRead || !data) return null
  const live = data.items.find((row) => !['acknowledged', 'closed', 'withdrawn'].includes(row.status))
  const latest = live ?? data.items[0]
  return (
    <section className={cn('rounded-md border p-3', live?.overdue && 'border-destructive/50', className)} data-testid='uat-external-review-panel'>
      <div className='flex flex-wrap items-center gap-2'>
        <UserCheck className='h-4 w-4 text-muted-foreground' />
        <h3 className='text-sm font-semibold'>Consultant review</h3>
        {latest ? (
          <>
            <span className='text-xs text-muted-foreground'>{latest.ref} · revision {latest.revision} · cycle {latest.cycle}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', live?.overdue ? 'bg-destructive/15 text-destructive' : 'bg-muted')}>{live?.overdue ? 'OVERDUE' : latest.statusLabel}</span>
          </>
        ) : (
          <span className='text-xs text-muted-foreground'>Not submitted to a consultant</span>
        )}
        <div className='ms-auto flex gap-2'>
          {latest && <Button size='sm' variant='outline' className='h-7 text-xs' onClick={() => setOpenId(latest.id)} data-testid='uat-external-review-open'>Open review</Button>}
          {data.canSubmit && <Button size='sm' className='h-7 text-xs' onClick={() => setSubmitting(true)} data-testid='uat-submit-to-consultant-button'><Send className='h-3.5 w-3.5' /> Submit to Consultant</Button>}
        </div>
      </div>
      {latest && (
        <dl className='mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4'>
          <div><dt className='text-muted-foreground'>Action with</dt><dd className='font-medium'>{latest.actionWith.label}{latest.actionWith.reviewer ? ` · ${latest.actionWith.reviewer}` : ''}</dd></div>
          <div><dt className='text-muted-foreground'>{latest.awaitingConsultant ? 'Open for' : 'Response time'}</dt><dd className='font-semibold tabular-nums'>{formatDuration(latest.awaitingConsultant ? latest.openMs : latest.responseMs)}</dd></div>
          <div><dt className='text-muted-foreground'>Due</dt><dd>{formatDay(latest.dueAt)}</dd></div>
          <div><dt className='text-muted-foreground'>{latest.decisionLabel ? 'Decision' : 'Overdue'}</dt><dd className={cn(latest.overdue && 'font-semibold text-destructive')}>{latest.decisionLabel || (latest.overdue ? <span className='inline-flex items-center gap-1'><AlertTriangle className='h-3 w-3' /> {formatDuration(latest.overdueMs)}</span> : 'No')}</dd></div>
        </dl>
      )}
      <SubmitDialog projectId={projectId} sourceType={sourceType} sourceId={sourceId} label={label} documents={data.documents} open={submitting} onClose={() => setSubmitting(false)} onSubmitted={(id) => { setSubmitting(false); setOpenId(id) }} />
      {openId && <ReviewSheet projectId={projectId} reviewId={openId} onClose={() => setOpenId(null)} />}
    </section>
  )
}
