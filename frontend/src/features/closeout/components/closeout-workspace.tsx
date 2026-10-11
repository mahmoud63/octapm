import { useEffect, useState } from 'react'
import { CheckCircle2, CircleDashed, Loader2, Lock, ShieldAlert, ShieldCheck } from 'lucide-react'
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { useProjectParties } from '@/features/projects/hooks/use-projects'
import {
  type CloseoutCheck,
  type CloseoutDeliverable,
  type CloseoutOverview,
  type DeliverableInput,
  type DeliverableStatus,
  type MilestoneKey,
  useAddStandardDeliverables,
  useCloseoutDeliverables,
  useCloseoutOverview,
  useCloseoutWarranties,
  useCreateDeliverable,
  useDeleteDeliverable,
  useRecordMilestone,
  useReopenDeliverable,
  useReopenMilestone,
  useReviewDeliverable,
  useSubmitDeliverable,
  useUpdateDeliverable,
  useWaiveCheck,
  useWaiveDeliverable,
} from '../hooks/use-project-closeout'

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '—')
const today = () => new Date().toISOString().slice(0, 10)

const STATUS_STYLE: Record<DeliverableStatus, { label: string; tone: string }> = {
  outstanding: { label: 'Outstanding', tone: 'bg-muted text-muted-foreground' },
  submitted: { label: 'Submitted', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  accepted: { label: 'Accepted', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  rejected: { label: 'Rejected', tone: 'bg-destructive/15 text-destructive' },
  waived: { label: 'Waived', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  not_applicable: { label: 'Not applicable', tone: 'bg-muted text-muted-foreground' },
}
const CHECK_STYLE: Record<CloseoutCheck['status'], { label: string; tone: string }> = {
  clear: { label: 'Clear', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  open: { label: 'Open', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  waived: { label: 'Waived', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  restricted: { label: 'No access', tone: 'bg-muted text-muted-foreground' },
}
const WARRANTY_STYLE: Record<string, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  expiring: { label: 'Expiring', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  expired: { label: 'Expired', tone: 'bg-destructive/15 text-destructive' },
  not_started: { label: 'Not started', tone: 'bg-muted text-muted-foreground' },
  open_ended: { label: 'No end date', tone: 'bg-muted text-muted-foreground' },
}
const CLOSEOUT_STATUS: Record<CloseoutOverview['status'], string> = {
  in_progress: 'In progress',
  substantially_complete: 'Substantially complete',
  handed_over: 'Handed over',
  final_complete: 'Final completion',
}

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', className)}>{children}</span>
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className='rounded-md border bg-card px-3 py-2'>
      <p className='text-[11px] tracking-wide text-muted-foreground uppercase'>{label}</p>
      <p className='mt-0.5 text-lg font-semibold tabular-nums'>{value}</p>
      {hint && <p className='text-[11px] text-muted-foreground'>{hint}</p>}
    </div>
  )
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

/** One dialog for every action that must say why: waivers, rejections, reopening. */
function ReasonDialog({
  open,
  title,
  description,
  label = 'Reason',
  confirm,
  onClose,
  onConfirm,
  pending,
}: {
  open: boolean
  title: string
  description: string
  label?: string
  confirm: string
  onClose: () => void
  onConfirm: (reason: string) => void
  pending: boolean
}) {
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
        <div className='space-y-1.5'>
          <Label htmlFor='closeout-reason'>{label}</Label>
          <Textarea id='closeout-reason' value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Cancel</Button>
          <Button disabled={!reason.trim() || pending} onClick={() => onConfirm(reason.trim())}>
            {pending && <Loader2 className='h-4 w-4 animate-spin' />} {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Readiness ────────────────────────────────────────────────────────────

function MilestoneDialog({ projectId, milestone, data, onClose }: { projectId: string; milestone: MilestoneKey | null; data: CloseoutOverview; onClose: () => void }) {
  const record = useRecordMilestone(projectId)
  const canOverride = useCanPerform('closeout', 'update', 'closeout.override')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [override, setOverride] = useState('')
  useEffect(() => {
    if (milestone) {
      setDate(today())
      setNote('')
      setOverride('')
    }
  }, [milestone])
  if (!milestone) return null
  const gate = data.gates?.[milestone]
  const label = data.milestones.find((row) => row.key === milestone)?.label ?? milestone
  const blocked = Boolean(gate && !gate.ready)
  const submit = async () => {
    if (await run(record.mutateAsync({ milestone, date, note: note.trim() || null, override: blocked ? override.trim() : null }), `${label} recorded`)) onClose()
  }
  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Record {label.toLowerCase()}</DialogTitle>
          <DialogDescription>Records the date it happened. Nothing in another module is closed, certified or released by this.</DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          {blocked && (
            <div className='rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm'>
              <p className='flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300'><ShieldAlert className='h-4 w-4' /> {gate!.outstanding.length} item{gate!.outstanding.length === 1 ? ' is' : 's are'} outstanding</p>
              <ul className='mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto ps-5 text-xs'>
                {gate!.outstanding.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='milestone-date'>Date</Label>
              <Input id='milestone-date' type='date' max={today()} value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='milestone-note'>Note</Label>
            <Textarea id='milestone-note' rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder='e.g. Certificate of substantial completion issued by the engineer' />
          </div>
          {blocked && (
            canOverride ? (
              <div className='space-y-1.5'>
                <Label htmlFor='milestone-override'>Override reason (kept in the audit with the outstanding list)</Label>
                <Textarea id='milestone-override' rows={2} value={override} onChange={(event) => setOverride(event.target.value)} />
              </div>
            ) : (
              <p className='text-xs text-muted-foreground'>Clear the outstanding items first, or ask someone allowed to override closeout.</p>
            )
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Cancel</Button>
          <Button disabled={record.isPending || !date || (blocked && (!canOverride || !override.trim()))} onClick={submit} data-testid='uat-closeout-milestone-confirm'>
            {record.isPending && <Loader2 className='h-4 w-4 animate-spin' />} {blocked ? 'Record with override' : 'Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReadinessTab({ projectId, onOpen }: { projectId: string; onOpen: (tab: string) => void }) {
  const { data, isLoading } = useCloseoutOverview(projectId)
  const canMilestone = useCanPerform('closeout', 'update', 'closeout.milestone')
  const canWaive = useCanPerform('closeout', 'update', 'closeout.waive')
  const waive = useWaiveCheck(projectId)
  const reopen = useReopenMilestone(projectId)
  const [milestone, setMilestone] = useState<MilestoneKey | null>(null)
  const [waiving, setWaiving] = useState<CloseoutCheck | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  if (isLoading || !data) return <p className='flex items-center gap-2 py-6 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' /> Reading the project's records…</p>
  const d = data.deliverables
  const latestRecorded = [...data.milestones].reverse().find((row) => row.at)
  return (
    <div className='space-y-4' data-testid='uat-closeout-readiness'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5'>
        <Tile label='Status' value={CLOSEOUT_STATUS[data.status]} />
        <Tile label='Turnover package' value={`${d.settledPct}%`} hint={`${d.requiredSettled} of ${d.required} required settled`} />
        <Tile label='Overdue deliverables' value={d.overdue} />
        <Tile label='Readiness checks open' value={data.readiness.open} hint={`${data.readiness.clear} clear · ${data.readiness.waived} waived${data.readiness.restricted ? ` · ${data.readiness.restricted} not visible to you` : ''}`} />
        <Tile label='Warranties' value={data.warranties.total} hint={`${data.warranties.expiring} expiring · ${data.warranties.expired} expired`} />
      </div>

      <section className='rounded-md border'>
        <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
          <h3 className='text-sm font-semibold'>Milestones</h3>
          <span className='text-xs text-muted-foreground'>Recorded by a person, in order. Handover needs the turnover package settled; final completion needs every check clear too.</span>
          {canMilestone && latestRecorded && (
            <Button size='sm' variant='ghost' className='ms-auto h-7 text-xs' onClick={() => setWithdrawing(true)}>Withdraw {latestRecorded.label.toLowerCase()}</Button>
          )}
        </div>
        <ol className='grid gap-2 p-3 md:grid-cols-3'>
          {data.milestones.map((row) => {
            const gate = data.gates?.[row.key]
            return (
              <li key={row.key} className={cn('rounded-md border p-3', row.at && 'border-emerald-500/40 bg-emerald-500/5')} data-testid={`uat-closeout-milestone-${row.key}`}>
                <p className='flex items-center gap-1.5 text-sm font-medium'>
                  {row.at ? <CheckCircle2 className='h-4 w-4 text-emerald-600' /> : <CircleDashed className='h-4 w-4 text-muted-foreground' />}
                  {row.label}
                </p>
                {row.at ? (
                  <p className='mt-1 text-xs text-muted-foreground'>{day(row.at)} · {row.by || '—'}{row.note ? ` · ${row.note}` : ''}</p>
                ) : gate ? (
                  <p className={cn('mt-1 text-xs', gate.ready ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                    {gate.ready ? 'Ready to record' : `${gate.outstanding.length} outstanding`}
                  </p>
                ) : null}
                {!row.at && canMilestone && gate && (
                  <Button size='sm' variant={gate.ready ? 'default' : 'outline'} className='mt-2 h-7 text-xs' onClick={() => setMilestone(row.key)} data-testid={`uat-closeout-record-${row.key}`}>
                    Record…
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      </section>

      <section className='rounded-md border'>
        <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
          <h3 className='text-sm font-semibold'>Readiness checks</h3>
          <span className='text-xs text-muted-foreground'>Read live from the project's records; they clear when the records do. A waiver needs a reason.</span>
        </div>
        {data.readiness.note && <p className='px-3 pt-2 text-xs text-muted-foreground'>{data.readiness.note}</p>}
        <ul className='divide-y'>
          {data.readiness.checks.map((check) => (
            <li key={check.key} className='flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm' data-testid={`uat-closeout-check-${check.key}`}>
              <Pill className={CHECK_STYLE[check.status].tone}>{CHECK_STYLE[check.status].label}</Pill>
              <span className='font-medium'>{check.label}</span>
              <span className='text-xs text-muted-foreground'>{check.detail}{check.refs.length ? ` — ${check.refs.join(', ')}` : ''}</span>
              {check.waiver && <span className='text-xs text-sky-700 dark:text-sky-400'>Waived: {check.waiver.reason}</span>}
              {canWaive && check.visible && (check.waiver ? (
                <Button size='sm' variant='ghost' className='ms-auto h-7 text-xs' onClick={() => run(waive.mutateAsync({ key: check.key, reason: null }), 'Waiver removed')}>Remove waiver</Button>
              ) : check.status === 'open' ? (
                <Button size='sm' variant='ghost' className='ms-auto h-7 text-xs' onClick={() => setWaiving(check)}>Waive…</Button>
              ) : null)}
            </li>
          ))}
        </ul>
      </section>

      <div className='flex flex-wrap gap-2'>
        <Button size='sm' variant='outline' onClick={() => onOpen('deliverables')}>Open the turnover package</Button>
        <Button size='sm' variant='outline' onClick={() => onOpen('warranties')}>Open warranties</Button>
      </div>

      <MilestoneDialog projectId={projectId} milestone={milestone} data={data} onClose={() => setMilestone(null)} />
      <ReasonDialog
        open={Boolean(waiving)}
        title={`Waive "${waiving?.label ?? ''}"`}
        description='The check stays visible with your reason; the waiver is audited and does not change the records it reads.'
        confirm='Waive'
        pending={waive.isPending}
        onClose={() => setWaiving(null)}
        onConfirm={async (reason) => {
          if (waiving && (await run(waive.mutateAsync({ key: waiving.key, reason }), 'Check waived'))) setWaiving(null)
        }}
      />
      <ReasonDialog
        open={withdrawing}
        title={`Withdraw ${latestRecorded?.label.toLowerCase() ?? 'milestone'}`}
        description='Clears the latest recorded milestone. The record of it stays in the audit.'
        confirm='Withdraw'
        pending={reopen.isPending}
        onClose={() => setWithdrawing(false)}
        onConfirm={async (reason) => {
          if (await run(reopen.mutateAsync(reason), 'Milestone withdrawn')) setWithdrawing(false)
        }}
      />
    </div>
  )
}

// ─── Deliverables ─────────────────────────────────────────────────────────

const NONE = '__none__'

function DeliverableForm({
  projectId,
  categories,
  value,
  onChange,
  disabled = false,
  canReassign = true,
}: {
  projectId: string
  categories: Record<string, string>
  value: DeliverableInput
  onChange: (value: DeliverableInput) => void
  disabled?: boolean
  canReassign?: boolean
}) {
  const { data: parties } = useProjectParties(projectId)
  const companies = [...new Map((parties?.items ?? []).filter((party) => party.company).map((party) => [party.companyId, `${party.company?.name ?? ''}${party.roleLabel ? ` (${party.roleLabel})` : ''}`])).entries()]
  const set = (patch: Partial<DeliverableInput>) => onChange({ ...value, ...patch })
  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      <div className='space-y-1.5 sm:col-span-2'>
        <Label htmlFor='deliverable-title'>Title</Label>
        <Input id='deliverable-title' disabled={disabled} value={value.title ?? ''} onChange={(event) => set({ title: event.target.value })} />
      </div>
      <div className='space-y-1.5'>
        <Label>Category</Label>
        <Select disabled={disabled} value={value.category ?? ''} onValueChange={(category) => set({ category })}>
          <SelectTrigger><SelectValue placeholder='Choose…' /></SelectTrigger>
          <SelectContent>
            {Object.entries(categories).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className='space-y-1.5'>
        <Label>Responsible company</Label>
        <Select disabled={disabled || !canReassign} value={value.responsibleCompanyId ?? NONE} onValueChange={(id) => set({ responsibleCompanyId: id === NONE ? null : id })}>
          <SelectTrigger><SelectValue placeholder='Not assigned' /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not assigned</SelectItem>
            {companies.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='deliverable-due'>Due date</Label>
        <Input id='deliverable-due' type='date' disabled={disabled} value={value.dueDate?.slice(0, 10) ?? ''} onChange={(event) => set({ dueDate: event.target.value || null })} />
      </div>
      <label className='flex items-center gap-2 self-end pb-2 text-sm'>
        <Checkbox disabled={disabled || !canReassign} checked={value.required !== false} onCheckedChange={(checked) => set({ required: checked === true })} />
        Required for handover
      </label>
      {value.category === 'warranty' && (
        <>
          <div className='space-y-1.5'>
            <Label htmlFor='warranty-start'>Warranty start</Label>
            <Input id='warranty-start' type='date' disabled={disabled} value={value.warrantyStart?.slice(0, 10) ?? ''} onChange={(event) => set({ warrantyStart: event.target.value || null })} />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='warranty-months'>Period (months)</Label>
            <Input id='warranty-months' type='number' min={0} disabled={disabled} value={value.warrantyMonths ?? ''} onChange={(event) => set({ warrantyMonths: event.target.value === '' ? null : Number(event.target.value) })} />
          </div>
          <p className='text-xs text-muted-foreground sm:col-span-2'>The end date is the start plus the period.</p>
        </>
      )}
      <div className='space-y-1.5 sm:col-span-2'>
        <Label htmlFor='deliverable-description'>Description</Label>
        <Textarea id='deliverable-description' rows={2} disabled={disabled} value={value.description ?? ''} onChange={(event) => set({ description: event.target.value })} />
      </div>
    </div>
  )
}

const inputOf = (row: CloseoutDeliverable): DeliverableInput => ({
  title: row.title,
  category: row.category,
  description: row.description,
  required: row.required,
  responsibleCompanyId: row.responsibleCompanyId,
  dueDate: row.dueDate,
  warrantyStart: row.warrantyStart,
  warrantyMonths: row.warrantyMonths,
})

/** Only the fields that changed, so a party member never sends the reassignment fields they may not touch. */
const changed = (before: DeliverableInput, after: DeliverableInput): DeliverableInput =>
  Object.fromEntries(Object.entries(after).filter(([field, next]) => (before as Record<string, unknown>)[field] !== next)) as DeliverableInput

function DeliverableSheet({ projectId, row, categories, onClose }: { projectId: string; row: CloseoutDeliverable | null; categories: Record<string, string>; onClose: () => void }) {
  const canUpdate = useCanPerform('closeout', 'update')
  const canSubmit = useCanPerform('closeout', 'submit')
  const canApprove = useCanPerform('closeout', 'approve')
  const canWaive = useCanPerform('closeout', 'update', 'closeout.waive')
  const canDelete = useCanPerform('closeout', 'delete')
  const canReassign = useCanPerform('closeout', 'create')
  const update = useUpdateDeliverable(projectId)
  const submit = useSubmitDeliverable(projectId)
  const review = useReviewDeliverable(projectId)
  const waive = useWaiveDeliverable(projectId)
  const reopen = useReopenDeliverable(projectId)
  const remove = useDeleteDeliverable(projectId)
  const [form, setForm] = useState<DeliverableInput>({})
  const [reason, setReason] = useState<null | 'reject' | 'waived' | 'not_applicable' | 'reopen'>(null)
  useEffect(() => {
    if (row) setForm(inputOf(row))
  }, [row])
  if (!row) return null
  const locked = ['accepted', 'waived', 'not_applicable'].includes(row.status)
  const editable = canUpdate && !locked
  const dirty = Object.keys(changed(inputOf(row), form)).length > 0
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-2xl' data-testid='uat-closeout-deliverable-sheet'>
        <SheetHeader>
          <SheetTitle className='flex flex-wrap items-center gap-2'>
            {row.ref} · {row.title}
            <Pill className={STATUS_STYLE[row.status].tone}>{STATUS_STYLE[row.status].label}</Pill>
          </SheetTitle>
          <SheetDescription>{row.categoryLabel}{row.required ? '' : ' · optional'}{row.responsibleCompany ? ` · ${row.responsibleCompany}` : ''}</SheetDescription>
        </SheetHeader>
        <div className='space-y-4 px-4 pb-6'>
          {(row.reviewComment || row.waivedReason || row.submittedAt) && (
            <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-muted/30 p-3 text-sm'>
              {row.submittedAt && <><dt className='text-muted-foreground'>Submitted</dt><dd>{day(row.submittedAt)} by {row.submittedBy || '—'} · {row.submittedDocumentIds.length} file(s)</dd></>}
              {row.reviewedAt && <><dt className='text-muted-foreground'>Reviewed</dt><dd>{day(row.reviewedAt)} by {row.reviewedBy || '—'}</dd></>}
              {row.reviewComment && <><dt className='text-muted-foreground'>Comment</dt><dd>{row.reviewComment}</dd></>}
              {row.waivedReason && <><dt className='text-muted-foreground'>Reason</dt><dd>{row.waivedReason}</dd></>}
            </dl>
          )}

          <div className='flex flex-wrap gap-2'>
            {canSubmit && ['outstanding', 'rejected'].includes(row.status) && (
              <Button size='sm' disabled={submit.isPending || !row.documents.length} title={row.documents.length ? undefined : 'Attach the evidence below first'} onClick={() => run(submit.mutateAsync({ id: row.id }), `${row.ref} submitted`)} data-testid='uat-closeout-submit'>
                Submit for review
              </Button>
            )}
            {canApprove && row.status === 'submitted' && (
              <>
                <Button size='sm' disabled={review.isPending} onClick={() => run(review.mutateAsync({ id: row.id, decision: 'accept' }), `${row.ref} accepted`)} data-testid='uat-closeout-accept'>Accept</Button>
                <Button size='sm' variant='outline' onClick={() => setReason('reject')}>Reject…</Button>
              </>
            )}
            {canWaive && !['accepted', 'waived', 'not_applicable'].includes(row.status) && (
              <>
                <Button size='sm' variant='outline' onClick={() => setReason('waived')}>Waive…</Button>
                <Button size='sm' variant='outline' onClick={() => setReason('not_applicable')}>Not applicable…</Button>
              </>
            )}
            {canApprove && row.status !== 'outstanding' && (
              <Button size='sm' variant='ghost' onClick={() => setReason('reopen')}>Reopen…</Button>
            )}
            {canDelete && row.status === 'outstanding' && !row.documents.length && (
              <Button size='sm' variant='ghost' className='text-destructive' disabled={remove.isPending} onClick={async () => { if (await run(remove.mutateAsync(row.id), `${row.ref} deleted`)) onClose() }}>Delete</Button>
            )}
          </div>

          <section className='space-y-3 rounded-md border p-3'>
            <div className='flex items-center gap-2'>
              <h3 className='text-sm font-semibold'>Details</h3>
              {locked && <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'><Lock className='h-3 w-3' /> Settled — reopen to change</span>}
            </div>
            <DeliverableForm projectId={projectId} categories={categories} value={form} onChange={setForm} disabled={!editable} canReassign={canReassign} />
            {editable && (
              <Button size='sm' disabled={!dirty || update.isPending} onClick={() => run(update.mutateAsync({ id: row.id, input: changed(inputOf(row), form) }), 'Saved')}>
                {update.isPending && <Loader2 className='h-4 w-4 animate-spin' />} Save
              </Button>
            )}
            {row.warranty && (
              <p className='text-xs text-muted-foreground'>
                Warranty {day(row.warrantyStart)} → {day(row.warrantyEnd)} · <Pill className={WARRANTY_STYLE[row.warranty.state].tone}>{WARRANTY_STYLE[row.warranty.state].label}</Pill>
                {row.warranty.daysLeft !== null && row.warranty.state !== 'expired' ? ` · ${row.warranty.daysLeft} days left` : ''}
              </p>
            )}
          </section>

          <AttachmentPanel projectId={projectId} recordType='closeout_deliverable' recordId={row.id} compact />
          <HistoryPanel projectId={projectId} entityType='closeout_deliverable' entityId={row.id} title={`${row.ref} History`} limit={30} showFilters={false} />
        </div>

        <ReasonDialog
          open={reason !== null}
          title={reason === 'reject' ? `Reject ${row.ref}` : reason === 'reopen' ? `Reopen ${row.ref}` : reason === 'waived' ? `Waive ${row.ref}` : `Mark ${row.ref} not applicable`}
          description={reason === 'reject' ? 'The responsible party sees your reason and resubmits.' : reason === 'reopen' ? 'Puts the deliverable back to outstanding; its files stay.' : 'Settles the deliverable without evidence. The reason is kept and audited.'}
          confirm={reason === 'reject' ? 'Reject' : reason === 'reopen' ? 'Reopen' : 'Confirm'}
          pending={review.isPending || waive.isPending || reopen.isPending}
          onClose={() => setReason(null)}
          onConfirm={async (text) => {
            const action =
              reason === 'reject'
                ? review.mutateAsync({ id: row.id, decision: 'reject', comment: text })
                : reason === 'reopen'
                  ? reopen.mutateAsync({ id: row.id, reason: text })
                  : waive.mutateAsync({ id: row.id, status: reason as 'waived' | 'not_applicable', reason: text })
            if (await run(action, 'Saved')) setReason(null)
          }}
        />
      </SheetContent>
    </Sheet>
  )
}

function NewDeliverableDialog({ projectId, categories, open, onClose }: { projectId: string; categories: Record<string, string>; open: boolean; onClose: () => void }) {
  const create = useCreateDeliverable(projectId)
  const [form, setForm] = useState<DeliverableInput>({ category: 'other', required: true })
  useEffect(() => {
    if (open) setForm({ category: 'other', required: true })
  }, [open])
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className='max-w-xl'>
        <DialogHeader>
          <DialogTitle>New turnover deliverable</DialogTitle>
          <DialogDescription>Something the owner receives at handover. The responsible party attaches the evidence and submits it for review.</DialogDescription>
        </DialogHeader>
        <DeliverableForm projectId={projectId} categories={categories} value={form} onChange={setForm} />
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Cancel</Button>
          <Button disabled={!form.title?.trim() || !form.category || create.isPending} onClick={async () => { if (await run(create.mutateAsync(form), 'Deliverable added')) onClose() }}>
            {create.isPending && <Loader2 className='h-4 w-4 animate-spin' />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ALL = '__all__'

function DeliverablesTab({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const { data, isLoading } = useCloseoutDeliverables(projectId, { status, category })
  const canCreate = useCanPerform('closeout', 'create')
  const standard = useAddStandardDeliverables(projectId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const categories = data?.categories ?? {}
  const selected = data?.items.find((row) => row.id === selectedId) ?? null
  return (
    <div className='space-y-3' data-testid='uat-closeout-deliverables'>
      <div className='flex flex-wrap items-center gap-2'>
        <Select value={status || ALL} onValueChange={(value) => setStatus(value === ALL ? '' : value)}>
          <SelectTrigger className='h-8 w-40'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(STATUS_STYLE) as DeliverableStatus[]).map((key) => <SelectItem key={key} value={key}>{STATUS_STYLE[key].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={category || ALL} onValueChange={(value) => setCategory(value === ALL ? '' : value)}>
          <SelectTrigger className='h-8 w-56'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {Object.entries(categories).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        {canCreate && (
          <div className='ms-auto flex gap-2'>
            <Button size='sm' variant='outline' disabled={standard.isPending} onClick={async () => { try { const result = await standard.mutateAsync(); toast.success(result.added ? `Added ${result.added} standard deliverables` : 'The standard list is already on the project') } catch (error) { toast.error(getServerErrorMessage(error)) } }} data-testid='uat-closeout-standard'>
              {standard.isPending && <Loader2 className='h-4 w-4 animate-spin' />} Add standard turnover list
            </Button>
            <Button size='sm' onClick={() => setCreating(true)}>New deliverable</Button>
          </div>
        )}
      </div>
      {isLoading || !data ? (
        <p className='flex items-center gap-2 py-6 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' /> Loading…</p>
      ) : !data.items.length ? (
        <p className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          {status || category ? 'Nothing matches these filters.' : 'No turnover deliverables yet. Start from the standard list, then adjust it to the contract.'}
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead className='text-xs text-muted-foreground'>
              <tr className='border-b'>
                <th className='px-3 py-2 text-left font-medium'>Ref</th>
                <th className='px-3 py-2 text-left font-medium'>Deliverable</th>
                <th className='px-3 py-2 text-left font-medium'>Responsible</th>
                <th className='px-3 py-2 text-left font-medium'>Due</th>
                <th className='px-3 py-2 text-right font-medium'>Files</th>
                <th className='px-3 py-2 text-left font-medium'>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id} className='cursor-pointer border-b last:border-0 hover:bg-muted/40' onClick={() => setSelectedId(row.id)} data-testid={`uat-closeout-row-${row.ref}`}>
                  <td className='px-3 py-2 font-mono text-xs'>{row.ref}</td>
                  <td className='px-3 py-2'>
                    <p className='font-medium'>{row.title}{!row.required && <span className='ms-1 text-xs font-normal text-muted-foreground'>(optional)</span>}</p>
                    <p className='text-xs text-muted-foreground'>{row.categoryLabel}</p>
                  </td>
                  <td className='px-3 py-2 text-xs'>{row.responsibleCompany || row.responsibleUser || <span className='text-muted-foreground'>Not assigned</span>}</td>
                  <td className={cn('px-3 py-2 text-xs tabular-nums', row.overdue && 'font-medium text-destructive')}>{day(row.dueDate)}{row.overdue ? ' · overdue' : ''}</td>
                  <td className='px-3 py-2 text-right tabular-nums'>{row.documents.length}</td>
                  <td className='px-3 py-2'><Pill className={STATUS_STYLE[row.status].tone}>{STATUS_STYLE[row.status].label}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DeliverableSheet projectId={projectId} row={selected} categories={categories} onClose={() => setSelectedId(null)} />
      <NewDeliverableDialog projectId={projectId} categories={categories} open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

// ─── Warranties ───────────────────────────────────────────────────────────

function WarrantiesTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useCloseoutWarranties(projectId)
  if (isLoading || !data) return <p className='flex items-center gap-2 py-6 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' /> Loading…</p>
  const s = data.summary
  return (
    <div className='space-y-3' data-testid='uat-closeout-warranties'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        <Tile label='Active' value={s.active} />
        <Tile label={`Expiring (${s.expiringDays} days)`} value={s.expiring} />
        <Tile label='Expired' value={s.expired} />
        <Tile label='Not started' value={s.notStarted} />
      </div>
      {!data.items.length ? (
        <p className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>No warranties recorded. Add a deliverable in the Warranties category with its start date and period.</p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead className='text-xs text-muted-foreground'>
              <tr className='border-b'>
                <th className='px-3 py-2 text-left font-medium'>Ref</th>
                <th className='px-3 py-2 text-left font-medium'>Warranty</th>
                <th className='px-3 py-2 text-left font-medium'>Warrantor</th>
                <th className='px-3 py-2 text-left font-medium'>Start</th>
                <th className='px-3 py-2 text-left font-medium'>End</th>
                <th className='px-3 py-2 text-left font-medium'>State</th>
                <th className='px-3 py-2 text-left font-medium'>Handover</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id} className='border-b last:border-0'>
                  <td className='px-3 py-2 font-mono text-xs'>{row.ref}</td>
                  <td className='px-3 py-2'>{row.title}{row.warrantyMonths ? <span className='text-xs text-muted-foreground'> · {row.warrantyMonths} months</span> : null}</td>
                  <td className='px-3 py-2 text-xs'>{row.responsibleCompany || '—'}</td>
                  <td className='px-3 py-2 text-xs tabular-nums'>{day(row.warrantyStart)}</td>
                  <td className='px-3 py-2 text-xs tabular-nums'>{day(row.warrantyEnd)}</td>
                  <td className='px-3 py-2'>
                    {row.warranty && <Pill className={WARRANTY_STYLE[row.warranty.state].tone}>{WARRANTY_STYLE[row.warranty.state].label}</Pill>}
                    {row.warranty?.daysLeft !== null && row.warranty?.daysLeft !== undefined && row.warranty.state !== 'expired' && <span className='ms-1 text-xs text-muted-foreground'>{row.warranty.daysLeft} d</span>}
                  </td>
                  <td className='px-3 py-2'><Pill className={STATUS_STYLE[row.status].tone}>{STATUS_STYLE[row.status].label}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function CloseoutWorkspace({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState('readiness')
  return (
    <div className='space-y-3' data-testid='uat-closeout'>
      <div className='flex flex-wrap items-baseline gap-2'>
        <h2 className='text-lg font-semibold'>Closeout / Turnover</h2>
        <p className='text-xs text-muted-foreground'>
          Readiness from the project's own records, the turnover package with its evidence, warranties, and the completion milestones.
        </p>
        <span className='ms-auto inline-flex items-center gap-1 text-xs text-muted-foreground'>
          <ShieldCheck className='h-3.5 w-3.5' /> Nothing here closes, certifies, pays or releases another module's records
        </span>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className='h-auto flex-wrap'>
          <TabsTrigger value='readiness'>Readiness</TabsTrigger>
          <TabsTrigger value='deliverables'>Turnover package</TabsTrigger>
          <TabsTrigger value='warranties'>Warranties</TabsTrigger>
        </TabsList>
        <TabsContent value='readiness'><ReadinessTab projectId={projectId} onOpen={setTab} /></TabsContent>
        <TabsContent value='deliverables'><DeliverablesTab projectId={projectId} /></TabsContent>
        <TabsContent value='warranties'><WarrantiesTab projectId={projectId} /></TabsContent>
      </Tabs>
    </div>
  )
}
