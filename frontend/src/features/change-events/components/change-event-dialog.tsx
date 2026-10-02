import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRightCircle,
  Ban,
  CheckCircle2,
  Loader2,
  Mail,
  Plus,
  Save,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { useCommitments } from '@/features/commercial/hooks/use-commitments'
import { useProjectCostCodes } from '@/features/cost/hooks/use-budget'
import { workspaceLink } from '@/features/workflows/hooks/use-workflow-engine'
import {
  CHANGE_EVENT_STATUS_LABEL,
  CHANGE_EVENT_TYPE_LABEL,
  isChangeEventFieldWithheld,
  useChangeEvent,
  useChangeEventAction,
  useDeleteChangeEvent,
  useRfqAction,
  useSendRfqs,
  useUpdateChangeEvent,
  type ChangeEvent,
  type ChangeEventLinePayload,
  type ChangeEventType,
  type Rfq,
  type RfqStatus,
} from '../hooks/use-change-events'

export type ActivityOption = {
  id: string
  name: string
  wbsCode?: string | null
  activityCode?: string | null
}

const NONE = '__none__'
const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : '—'

const RFQ_STATUS_CLASS: Record<RfqStatus, string> = {
  sent: 'border-slate-300 text-slate-700 dark:text-slate-200',
  viewed: 'border-sky-300 text-sky-700 dark:text-sky-200',
  quoted: 'border-blue-300 text-blue-700 dark:text-blue-200',
  declined: 'border-zinc-300 text-zinc-600 dark:text-zinc-300',
  accepted: 'border-emerald-300 text-emerald-700 dark:text-emerald-200',
  rejected: 'border-rose-300 text-rose-700 dark:text-rose-200',
  cancelled: 'border-zinc-300 text-zinc-500 dark:text-zinc-400',
}

/** The line fields the server may withhold (PC-7b: taken from a BOQ-derived exception). */
const LINE_WITHHOLDABLE = [
  'activityId',
  'costCodeId',
  'quantity',
  'unit',
  'unitCost',
] as const
type LineField = (typeof LINE_WITHHOLDABLE)[number]

type LineRow = {
  key: string
  id: string | null
  description: string
  costCodeId: string
  activityId: string
  commitmentId: string
  quantity: string
  unit: string
  unitCost: string
  /** The stored amount — shown (and sent) for a line whose quantity or unit cost is withheld. */
  romAmount: string
  quotedAmount: number | null
  /** What the server left out of this line for this member: shown "—" with the reason, never sent back. */
  withheld: LineField[]
}

const rowsFrom = (event: ChangeEvent): LineRow[] =>
  (event.lines ?? []).map((line) => ({
    key: line.id,
    id: line.id,
    description: line.description,
    costCodeId: line.costCodeId ?? '',
    activityId: line.activityId ?? '',
    commitmentId: line.commitmentId ?? '',
    quantity: line.quantity === undefined ? '' : String(line.quantity),
    unit: line.unit ?? '',
    unitCost: line.unitCost === undefined ? '' : String(line.unitCost),
    romAmount: String(line.romAmount ?? 0),
    quotedAmount: line.quotedAmount,
    withheld: LINE_WITHHOLDABLE.filter((field) =>
      isChangeEventFieldWithheld(event, field, line.id)
    ),
  }))

/** A line's amount: its stored amount when the quantity or unit cost is withheld, else quantity × unit cost. */
const rowAmount = (row: LineRow) =>
  row.withheld.includes('quantity') || row.withheld.includes('unitCost')
    ? Number(row.romAmount) || 0
    : (Number(row.quantity) || 0) * (Number(row.unitCost) || 0)

/** A field the server withheld from this member: "—", with the server's reason. */
function WithheldValue({
  reason,
  testId,
}: {
  reason: string | undefined
  testId?: string
}) {
  return (
    <span
      className='cursor-help text-muted-foreground'
      title={reason}
      aria-label={reason ? `— ${reason}` : '—'}
      data-testid={testId ?? 'uat-change-event-withheld'}
      data-reason={reason}
    >
      —
    </span>
  )
}

function SendRfqDialog({
  projectId,
  event,
  open,
  onOpenChange,
}: {
  projectId: string
  event: ChangeEvent
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // a site engineer raises change events without reading the commitment register
  const canReadCommitments = useCanPerform('commitment', 'read')
  const { data: commitments } = useCommitments(
    projectId,
    {},
    { enabled: canReadCommitments }
  )
  const send = useSendRfqs(projectId)
  const [commitmentIds, setCommitmentIds] = useState<Set<string>>(new Set())
  const [adHoc, setAdHoc] = useState<
    Array<{ companyName: string; contactName: string; contactEmail: string }>
  >([])
  const [dueDate, setDueDate] = useState('')
  const [instructions, setInstructions] = useState('')
  const [lineIds, setLineIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!open) return
    setCommitmentIds(
      new Set(
        (event.lines ?? [])
          .map((line) => line.commitmentId)
          .filter((id): id is string => Boolean(id))
      )
    )
    setAdHoc([])
    setDueDate('')
    setInstructions('')
    setLineIds(new Set())
  }, [open, event])
  // A line whose quantity, unit or activity the server withheld from this
  // member is not theirs to send to a vendor (the portal shows them): it
  // cannot be picked, and "all lines" is not offered while one exists (the
  // server refuses either: 409 CHANGE_EVENT_LINE_WITHHELD).
  const lineBlocked = (lineId: string) =>
    (['quantity', 'unit', 'activityId'] as const).some((field) =>
      isChangeEventFieldWithheld(event, field, lineId)
    )
  const anyBlocked = (event.lines ?? []).some((line) => lineBlocked(line.id))
  const vendors = (commitments?.items ?? []).filter((commitment) =>
    ['approved', 'executed', 'draft', 'pending'].includes(commitment.status)
  )
  const recipients = [
    ...[...commitmentIds].map((commitmentId) => ({ commitmentId })),
    ...adHoc
      .filter((row) => row.contactEmail.trim())
      .map((row) => ({
        companyName: row.companyName.trim() || null,
        contactName: row.contactName.trim() || null,
        contactEmail: row.contactEmail.trim(),
      })),
  ]
  const submit = async () => {
    try {
      const result = await send.mutateAsync({
        id: event.id,
        recipients,
        dueDate: dueDate || null,
        instructions: instructions.trim() || null,
        lineIds: lineIds.size ? [...lineIds] : undefined,
      })
      toast.success(`${result.sent} RFQ${result.sent === 1 ? '' : 's'} sent`)
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'
        data-testid='uat-rfq-send'
      >
        <DialogHeader>
          <DialogTitle>Request quotations for {event.ref}</DialogTitle>
          <DialogDescription>
            Each vendor gets a personal link by email to price the scope lines
            online — no login. Commitments use the vendor&apos;s contact on
            file.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label>Commitment vendors</Label>
            <div className='max-h-40 space-y-1 overflow-auto rounded-md border p-2 text-sm'>
              {vendors.length === 0 && (
                <p className='text-xs text-muted-foreground'>
                  No commitments on this project.
                </p>
              )}
              {vendors.map((commitment) => (
                <label key={commitment.id} className='flex items-center gap-2'>
                  <Checkbox
                    checked={commitmentIds.has(commitment.id)}
                    onCheckedChange={(checked) =>
                      setCommitmentIds((current) => {
                        const next = new Set(current)
                        if (checked) next.add(commitment.id)
                        else next.delete(commitment.id)
                        return next
                      })
                    }
                  />
                  <span className='font-mono text-xs'>{commitment.ref}</span>
                  <span className='min-w-0 flex-1 truncate'>
                    {commitment.title}
                  </span>
                  <span className='text-xs text-muted-foreground'>
                    {commitment.vendor?.name ?? 'no vendor'}
                    {commitment.vendor?.email ? '' : ' · no email'}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <Label>Other vendors</Label>
              <Button
                size='sm'
                variant='ghost'
                className='h-7'
                onClick={() =>
                  setAdHoc((current) => [
                    ...current,
                    { companyName: '', contactName: '', contactEmail: '' },
                  ])
                }
              >
                <Plus className='mr-1 h-3.5 w-3.5' /> Add
              </Button>
            </div>
            {adHoc.map((row, index) => (
              <div
                key={index}
                className='grid gap-2 sm:grid-cols-[1fr_1fr_1.2fr_auto]'
              >
                <Input
                  placeholder='Company'
                  value={row.companyName}
                  onChange={(event) =>
                    setAdHoc((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, companyName: event.target.value }
                          : item
                      )
                    )
                  }
                />
                <Input
                  placeholder='Contact'
                  value={row.contactName}
                  onChange={(event) =>
                    setAdHoc((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, contactName: event.target.value }
                          : item
                      )
                    )
                  }
                />
                <Input
                  placeholder='email@vendor.com'
                  value={row.contactEmail}
                  onChange={(event) =>
                    setAdHoc((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, contactEmail: event.target.value }
                          : item
                      )
                    )
                  }
                />
                <Button
                  size='sm'
                  variant='ghost'
                  className='text-destructive'
                  onClick={() =>
                    setAdHoc((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </div>
            ))}
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label>Quotes due</Label>
              <Input
                type='date'
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label>Lines to quote</Label>
              <p
                className='text-xs text-muted-foreground'
                data-testid='uat-rfq-lines-scope'
              >
                {lineIds.size
                  ? `${lineIds.size} selected`
                  : anyBlocked
                    ? 'Choose the lines to quote — some are withheld from you'
                    : 'All lines'}
              </p>
            </div>
          </div>
          <div className='max-h-40 space-y-1 overflow-auto rounded-md border p-2 text-sm'>
            {(event.lines ?? []).map((line) => (
              <label
                key={line.id}
                className='flex items-center gap-2'
                title={
                  lineBlocked(line.id)
                    ? event.sourceWithheld?.reason
                    : undefined
                }
                data-testid={`uat-rfq-line-${line.id}`}
                data-blocked={lineBlocked(line.id) || undefined}
              >
                <Checkbox
                  disabled={lineBlocked(line.id)}
                  checked={lineIds.has(line.id)}
                  onCheckedChange={(checked) =>
                    setLineIds((current) => {
                      const next = new Set(current)
                      if (checked) next.add(line.id)
                      else next.delete(line.id)
                      return next
                    })
                  }
                />
                <span className='min-w-0 flex-1 truncate'>
                  {line.description}
                </span>
                <span className='text-xs text-muted-foreground'>
                  {isChangeEventFieldWithheld(event, 'quantity', line.id) ? (
                    <WithheldValue reason={event.sourceWithheld?.reason} />
                  ) : (
                    `${line.quantity ?? ''} ${line.unit ?? ''}`
                  )}
                </span>
              </label>
            ))}
          </div>
          <div className='space-y-1'>
            <Label>Instructions to vendors</Label>
            <Textarea
              rows={3}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder='Inclusions, exclusions, programme…'
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !recipients.length ||
              send.isPending ||
              (anyBlocked && lineIds.size === 0)
            }
            onClick={submit}
            data-testid='uat-rfq-send-submit'
          >
            {send.isPending ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Send className='mr-2 h-4 w-4' />
            )}
            Send {recipients.length || ''} RFQ
            {recipients.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RfqTable({
  projectId,
  event,
}: {
  projectId: string
  event: ChangeEvent
}) {
  const act = useRfqAction(projectId)
  const canSend = useCanPerform(
    'change_event',
    'submit',
    'change_event.rfq_send'
  )
  const canAccept = useCanPerform(
    'change_event',
    'approve',
    'change_event.quote_accept'
  )
  const rfqs = event.rfqs ?? []
  const lines = event.lines ?? []
  const editable = !['converted', 'closed', 'void'].includes(event.status)
  const run = async (
    rfq: Rfq,
    action: 'remind' | 'cancel' | 'accept' | 'reject',
    body?: Record<string, unknown>
  ) => {
    try {
      await act.mutateAsync({ rfqId: rfq.id, action, body })
      toast.success(
        action === 'accept'
          ? `${rfq.companyName}'s quote accepted`
          : action === 'reject'
            ? 'Quote rejected'
            : action === 'remind'
              ? 'Reminder sent with a fresh link'
              : 'RFQ withdrawn'
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  if (!rfqs.length)
    return <p className='text-xs text-muted-foreground'>No RFQ sent yet.</p>
  return (
    <div className='overflow-x-auto rounded-md border'>
      <table className='w-full text-sm' data-testid='uat-rfq-table'>
        <thead className='bg-muted/50 text-xs text-muted-foreground'>
          <tr>
            <th className='px-2 py-1 text-left'>RFQ</th>
            <th className='px-2 py-1 text-left'>Vendor</th>
            <th className='px-2 py-1 text-left'>Status</th>
            {lines.map((line) => (
              <th
                key={line.id}
                className='px-2 py-1 text-right'
                title={line.description}
              >
                {line.description.length > 18
                  ? `${line.description.slice(0, 18)}…`
                  : line.description}
              </th>
            ))}
            <th className='px-2 py-1 text-right'>Total</th>
            <th className='px-2 py-1 text-left'>Notes</th>
            <th className='px-2 py-1' />
          </tr>
        </thead>
        <tbody>
          {rfqs.map((rfq) => {
            const byLine = new Map(
              rfq.quoteLines.map((line) => [line.lineId, line])
            )
            return (
              <tr
                key={rfq.id}
                className={cn(
                  'border-t align-top',
                  rfq.status === 'accepted' &&
                    'bg-emerald-50/60 dark:bg-emerald-950/20'
                )}
              >
                <td className='px-2 py-1 font-mono text-xs'>{rfq.ref}</td>
                <td className='px-2 py-1'>
                  <div>{rfq.companyName}</div>
                  <div className='text-xs text-muted-foreground'>
                    {rfq.commitment?.ref ?? 'ad-hoc'}
                    {rfq.contactEmail ? ` · ${rfq.contactEmail}` : ''}
                  </div>
                  {rfq.commitmentChangeOrder && (
                    <div className='text-xs text-muted-foreground'>
                      → {rfq.commitmentChangeOrder.ref} (
                      {rfq.commitmentChangeOrder.status})
                    </div>
                  )}
                </td>
                <td className='px-2 py-1'>
                  <Badge
                    variant='outline'
                    className={RFQ_STATUS_CLASS[rfq.status]}
                  >
                    {rfq.status}
                  </Badge>
                  <div className='text-[11px] text-muted-foreground'>
                    {rfq.status === 'quoted' && rfq.quoteValidUntil
                      ? `valid to ${formatDate(rfq.quoteValidUntil)}`
                      : rfq.dueDate
                        ? `due ${formatDate(rfq.dueDate)}`
                        : ''}
                    {rfq.quoteLeadTimeDays
                      ? ` · ${rfq.quoteLeadTimeDays} d lead`
                      : ''}
                  </div>
                </td>
                {lines.map((line) => {
                  const quoted = byLine.get(line.id)
                  return (
                    <td
                      key={line.id}
                      className='px-2 py-1 text-right tabular-nums'
                      title={quoted?.note ?? undefined}
                    >
                      {quoted?.amount === null || quoted?.amount === undefined
                        ? '·'
                        : money(quoted.amount)}
                    </td>
                  )
                })}
                <td className='px-2 py-1 text-right font-medium tabular-nums'>
                  {money(rfq.quoteTotal)}
                </td>
                <td className='px-2 py-1 text-xs text-muted-foreground'>
                  {rfq.quoteNotes ??
                    rfq.declinedReason ??
                    rfq.rejectedReason ??
                    ''}
                </td>
                <td className='px-2 py-1'>
                  <div className='flex flex-wrap gap-1'>
                    {editable && rfq.status === 'quoted' && canAccept && (
                      <>
                        <Button
                          size='sm'
                          className='h-7'
                          disabled={act.isPending}
                          onClick={() =>
                            run(rfq, 'accept', {
                              createCommitmentChangeOrder: Boolean(
                                rfq.commitmentId
                              ),
                            })
                          }
                          data-testid='uat-rfq-accept'
                        >
                          <CheckCircle2 className='mr-1 h-3.5 w-3.5' /> Accept
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-7'
                          disabled={act.isPending}
                          onClick={() => {
                            const reason = window.prompt(
                              'Reject this quote? Reason (optional):'
                            )
                            if (reason === null) return
                            run(rfq, 'reject', { reason: reason || null })
                          }}
                        >
                          <XCircle className='mr-1 h-3.5 w-3.5' /> Reject
                        </Button>
                      </>
                    )}
                    {editable &&
                      ['sent', 'viewed'].includes(rfq.status) &&
                      canSend && (
                        <>
                          <Button
                            size='sm'
                            variant='outline'
                            className='h-7'
                            disabled={act.isPending}
                            onClick={() => run(rfq, 'remind')}
                            title={`${rfq.remindersSent} reminder${rfq.remindersSent === 1 ? '' : 's'} sent`}
                          >
                            <Mail className='mr-1 h-3.5 w-3.5' /> Remind
                          </Button>
                          <Button
                            size='sm'
                            variant='ghost'
                            className='h-7 text-destructive'
                            disabled={act.isPending}
                            onClick={() => run(rfq, 'cancel')}
                          >
                            Withdraw
                          </Button>
                        </>
                      )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** One change event: header, scope lines with ROM and quoted amounts, RFQs and quotes, conversion. */
export function ChangeEventDialog({
  projectId,
  activities,
  changeEventId,
  open,
  onOpenChange,
}: {
  projectId: string
  activities: ActivityOption[]
  changeEventId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: event, isLoading } = useChangeEvent(
    projectId,
    open ? changeEventId : null
  )
  const { data: costCodes } = useProjectCostCodes(projectId)
  const { data: commitments } = useCommitments(projectId)
  const update = useUpdateChangeEvent(projectId)
  const remove = useDeleteChangeEvent(projectId)
  const action = useChangeEventAction(projectId)
  const navigate = useNavigate()
  const canUpdate = useCanPerform('change_event', 'update')
  const canDelete = useCanPerform('change_event', 'delete')
  const canSend = useCanPerform(
    'change_event',
    'submit',
    'change_event.rfq_send'
  )
  const canConvert = useCanPerform(
    'change_event',
    'approve',
    'change_event.convert'
  )
  const canClose = useCanPerform(
    'change_event',
    'approve',
    'change_event.close'
  )
  const canVoid = useCanPerform('change_event', 'approve', 'change_event.void')

  const [header, setHeader] = useState({
    title: '',
    type: 'other' as ChangeEventType,
    description: '',
    activityId: NONE,
    scheduleImpactDays: '0',
    romAmount: '0',
    notes: '',
  })
  const [rows, setRows] = useState<LineRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!event) return
    setHeader({
      title: event.title,
      type: event.type,
      description: event.description ?? '',
      activityId: event.activityId ?? NONE,
      scheduleImpactDays: String(event.scheduleImpactDays),
      romAmount: String(event.romAmount),
      notes: event.notes ?? '',
    })
    setRows(rowsFrom(event))
    setDirty(false)
  }, [event])

  const editable =
    Boolean(event) &&
    canUpdate &&
    !['converted', 'closed', 'void'].includes(event?.status ?? '')
  const costCodeOptions = (costCodes?.items ?? []).filter(
    (code) => code.status === 'active'
  )
  const commitmentOptions = commitments?.items ?? []
  const withheldReason = event?.sourceWithheld?.reason
  const headerActivityWithheld = isChangeEventFieldWithheld(event, 'activityId')
  // Deleting the event would remove figures withheld from this member (the
  // server refuses it: 409 CHANGE_EVENT_FIELD_WITHHELD).
  const carriesWithheldField = (event?.sourceWithheld?.keys ?? []).some(
    (key) => key === 'activityId' || key.startsWith('lines[')
  )
  const totals = useMemo(() => {
    const rom = rows.reduce((sum, row) => sum + rowAmount(row), 0)
    const estimate = rows.reduce(
      (sum, row) => sum + (row.quotedAmount ?? rowAmount(row)),
      0
    )
    return { rom, estimate }
  }, [rows])

  const patchRow = (key: string, changes: Partial<LineRow>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...changes } : row))
    )
    setDirty(true)
  }
  const setHeaderField = <K extends keyof typeof header>(
    field: K,
    value: (typeof header)[K]
  ) => {
    setHeader((current) => ({ ...current, [field]: value }))
    setDirty(true)
  }

  const save = async () => {
    if (!event) return false
    // A field the server withheld from this member is never sent back: the
    // server keeps the stored value (and refuses one sent, 409
    // CHANGE_EVENT_FIELD_WITHHELD). A line whose quantity or unit cost is
    // withheld carries its amount instead.
    const lines: ChangeEventLinePayload[] = rows.map((row) => {
      const given = (field: LineField) => !row.withheld.includes(field)
      const line: ChangeEventLinePayload = {
        id: row.id,
        description: row.description.trim(),
        commitmentId: row.commitmentId || null,
      }
      if (given('costCodeId')) line.costCodeId = row.costCodeId || null
      if (given('activityId')) line.activityId = row.activityId || null
      if (given('quantity')) line.quantity = Number(row.quantity) || 0
      if (given('unit')) line.unit = row.unit.trim() || null
      if (given('unitCost')) line.unitCost = Number(row.unitCost) || 0
      if (!given('quantity') || !given('unitCost'))
        line.romAmount = Number(row.romAmount) || 0
      return line
    })
    try {
      await update.mutateAsync({
        id: event.id,
        title: header.title.trim(),
        type: header.type,
        description: header.description.trim() || null,
        ...(headerActivityWithheld
          ? {}
          : {
              activityId: header.activityId === NONE ? null : header.activityId,
            }),
        scheduleImpactDays: Number(header.scheduleImpactDays) || 0,
        romAmount: Number(header.romAmount) || 0,
        notes: header.notes.trim() || null,
        lines,
      })
      setDirty(false)
      toast.success('Change event saved')
      return true
    } catch (error) {
      toast.error(getServerErrorMessage(error))
      return false
    }
  }

  const convert = async () => {
    if (!event) return
    if (dirty && editable && !(await save())) return
    try {
      const result = await action.mutateAsync({
        id: event.id,
        action: 'convert',
        body: {},
      })
      if ('commitmentChangeOrders' in result) {
        const link = workspaceLink(result.changeOrder.path)
        toast.success(
          `${result.changeOrder.ref} created as a draft change order${result.commitmentChangeOrders.length ? ` with ${result.commitmentChangeOrders.length} commitment change order${result.commitmentChangeOrders.length === 1 ? '' : 's'}` : ''}`,
          {
            action: link
              ? {
                  label: 'Open',
                  onClick: () =>
                    navigate({
                      to: '/projects/$projectId',
                      params: { projectId: link.projectId },
                      search: link.search,
                    }),
                }
              : undefined,
          }
        )
      }
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const busy = update.isPending || action.isPending || remove.isPending
  const changeOrderLink = event?.changeOrder
    ? workspaceLink(event.changeOrder.path)
    : null
  const sourceLink = event?.sourcePath ? workspaceLink(event.sourcePath) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-5xl'
        data-testid='uat-change-event'
      >
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2'>
            {event ? (
              <>
                <span className='font-mono'>{event.ref}</span>
                <span>{event.title}</span>
                <Badge variant='outline'>
                  {CHANGE_EVENT_STATUS_LABEL[event.status]}
                </Badge>
              </>
            ) : (
              'Change event'
            )}
          </DialogTitle>
          <DialogDescription>
            Scope lines carry a rough order of magnitude until a quote is
            accepted; conversion creates the change order at the quoted value.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !event ? (
          <div className='flex items-center gap-2 py-6 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading…
          </div>
        ) : (
          <div className='space-y-4'>
            {(event.changeOrder || sourceLink || event.sourceWithheld) && (
              <div className='flex flex-wrap gap-3 text-sm'>
                {event.changeOrder && changeOrderLink && (
                  <Link
                    to='/projects/$projectId'
                    params={{ projectId: changeOrderLink.projectId }}
                    search={changeOrderLink.search}
                    className='underline-offset-2 hover:underline'
                  >
                    Change order {event.changeOrder.ref} ·{' '}
                    {event.changeOrder.status} ·{' '}
                    {money(event.changeOrder.value)}
                  </Link>
                )}
                {sourceLink && (
                  <Link
                    to='/projects/$projectId'
                    params={{ projectId: sourceLink.projectId }}
                    search={sourceLink.search}
                    className='text-muted-foreground underline-offset-2 hover:underline'
                  >
                    Raised from {event.sourceRecordType?.replace(/_/g, ' ')}
                  </Link>
                )}
                {!sourceLink && event.sourceWithheld && (
                  <span
                    className='text-muted-foreground'
                    data-testid='uat-change-event-source-withheld'
                    data-reason={event.sourceWithheld.reason}
                  >
                    Raised from — {event.sourceWithheld.reason}
                  </span>
                )}
              </div>
            )}

            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              <div className='space-y-1 sm:col-span-2'>
                <Label>Title</Label>
                <Input
                  value={header.title}
                  onChange={(e) => setHeaderField('title', e.target.value)}
                  disabled={!editable}
                  data-testid='uat-change-event-title'
                />
              </div>
              <div className='space-y-1'>
                <Label>Type</Label>
                <Select
                  value={header.type}
                  onValueChange={(value) =>
                    setHeaderField('type', value as ChangeEventType)
                  }
                  disabled={!editable}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(CHANGE_EVENT_TYPE_LABEL) as ChangeEventType[]
                    ).map((value) => (
                      <SelectItem key={value} value={value}>
                        {CHANGE_EVENT_TYPE_LABEL[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1'>
                <Label>Activity</Label>
                {headerActivityWithheld ? (
                  <p className='flex h-9 items-center text-sm'>
                    <WithheldValue
                      reason={withheldReason}
                      testId='uat-change-event-activity-withheld'
                    />
                  </p>
                ) : (
                  <Select
                    value={header.activityId}
                    onValueChange={(value) =>
                      setHeaderField('activityId', value)
                    }
                    disabled={!editable}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— none —</SelectItem>
                      {activities.map((activity) => (
                        <SelectItem key={activity.id} value={activity.id}>
                          {activity.activityCode || activity.wbsCode
                            ? `${activity.activityCode || activity.wbsCode} · `
                            : ''}
                          {activity.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className='space-y-1 sm:col-span-2'>
                <Label>Description</Label>
                <Textarea
                  rows={2}
                  value={header.description}
                  onChange={(e) =>
                    setHeaderField('description', e.target.value)
                  }
                  disabled={!editable}
                />
              </div>
              <div className='space-y-1'>
                <Label>Schedule impact (days)</Label>
                <Input
                  type='number'
                  min={0}
                  value={header.scheduleImpactDays}
                  onChange={(e) =>
                    setHeaderField('scheduleImpactDays', e.target.value)
                  }
                  disabled={!editable}
                />
              </div>
              <div className='space-y-1'>
                <Label>ROM (no lines)</Label>
                <Input
                  type='number'
                  min={0}
                  value={header.romAmount}
                  onChange={(e) => setHeaderField('romAmount', e.target.value)}
                  disabled={!editable || rows.length > 0}
                />
              </div>
            </div>

            <div className='space-y-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <p className='font-medium'>Scope lines</p>
                <span className='text-xs text-muted-foreground'>
                  ROM{' '}
                  <span data-testid='uat-change-event-rom-total'>
                    {money(
                      rows.length ? totals.rom : Number(header.romAmount) || 0
                    )}
                  </span>{' '}
                  · estimate{' '}
                  <span data-testid='uat-change-event-estimate-total'>
                    {money(
                      rows.length
                        ? totals.estimate
                        : Number(header.romAmount) || 0
                    )}
                  </span>
                  {event.totals.quoted !== null
                    ? ` · quoted ${money(event.totals.quoted)}`
                    : ''}
                </span>
                {editable && (
                  <Button
                    size='sm'
                    variant='outline'
                    className='ml-auto'
                    onClick={() => {
                      setRows((current) => [
                        ...current,
                        {
                          key: `new-${Date.now()}`,
                          id: null,
                          description: '',
                          costCodeId: '',
                          activityId:
                            headerActivityWithheld || header.activityId === NONE
                              ? ''
                              : header.activityId,
                          commitmentId: '',
                          quantity: '1',
                          unit: '',
                          unitCost: '0',
                          romAmount: '0',
                          quotedAmount: null,
                          withheld: [],
                        },
                      ])
                      setDirty(true)
                    }}
                    data-testid='uat-change-event-add-line'
                  >
                    <Plus className='mr-2 h-4 w-4' /> Add line
                  </Button>
                )}
              </div>
              <div className='overflow-x-auto rounded-md border'>
                <table className='w-full text-sm'>
                  <thead className='bg-muted/50 text-xs text-muted-foreground'>
                    <tr>
                      <th className='px-2 py-1 text-left'>Description</th>
                      <th className='px-2 py-1 text-left'>Cost code</th>
                      <th className='px-2 py-1 text-left'>Activity</th>
                      <th className='px-2 py-1 text-left'>
                        Vendor (commitment)
                      </th>
                      <th className='px-2 py-1 text-right'>Qty</th>
                      <th className='px-2 py-1 text-left'>Unit</th>
                      <th className='px-2 py-1 text-right'>Unit cost</th>
                      <th className='px-2 py-1 text-right'>ROM</th>
                      <th className='px-2 py-1 text-right'>Quoted</th>
                      {editable && <th className='px-2 py-1' />}
                    </tr>
                  </thead>
                  <tbody data-testid='uat-change-event-lines'>
                    {rows.map((row) => (
                      <tr
                        key={row.key}
                        className='border-t align-top'
                        data-testid={`uat-change-event-line-${row.key}`}
                        data-withheld={row.withheld.join(' ') || undefined}
                      >
                        <td className='px-2 py-1'>
                          {editable ? (
                            <Input
                              className='h-8 min-w-48'
                              value={row.description}
                              onChange={(e) =>
                                patchRow(row.key, {
                                  description: e.target.value,
                                })
                              }
                            />
                          ) : (
                            row.description
                          )}
                        </td>
                        <td className='px-2 py-1'>
                          {row.withheld.includes('costCodeId') ? (
                            <WithheldValue reason={withheldReason} />
                          ) : editable ? (
                            <Select
                              value={row.costCodeId || NONE}
                              onValueChange={(value) =>
                                patchRow(row.key, {
                                  costCodeId: value === NONE ? '' : value,
                                })
                              }
                            >
                              <SelectTrigger className='h-8 w-36'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>— none —</SelectItem>
                                {costCodeOptions.map((code) => (
                                  <SelectItem
                                    key={code.costCodeId}
                                    value={code.costCodeId}
                                  >
                                    {code.code} {code.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className='font-mono text-xs'>
                              {event.lines?.find((line) => line.id === row.id)
                                ?.costCode?.code ?? '—'}
                            </span>
                          )}
                        </td>
                        <td className='px-2 py-1'>
                          {row.withheld.includes('activityId') ? (
                            <WithheldValue reason={withheldReason} />
                          ) : editable ? (
                            <Select
                              value={row.activityId || NONE}
                              onValueChange={(value) =>
                                patchRow(row.key, {
                                  activityId: value === NONE ? '' : value,
                                })
                              }
                            >
                              <SelectTrigger className='h-8 w-44'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>— none —</SelectItem>
                                {activities.map((activity) => (
                                  <SelectItem
                                    key={activity.id}
                                    value={activity.id}
                                  >
                                    {activity.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            (event.lines?.find((line) => line.id === row.id)
                              ?.activity?.name ?? '—')
                          )}
                        </td>
                        <td className='px-2 py-1'>
                          {editable ? (
                            <Select
                              value={row.commitmentId || NONE}
                              onValueChange={(value) =>
                                patchRow(row.key, {
                                  commitmentId: value === NONE ? '' : value,
                                })
                              }
                            >
                              <SelectTrigger className='h-8 w-44'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>— none —</SelectItem>
                                {commitmentOptions.map((commitment) => (
                                  <SelectItem
                                    key={commitment.id}
                                    value={commitment.id}
                                  >
                                    {commitment.ref}{' '}
                                    {commitment.vendor?.name ??
                                      commitment.title}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            (event.lines?.find((line) => line.id === row.id)
                              ?.commitment?.vendorName ?? '—')
                          )}
                        </td>
                        <td className='px-2 py-1 text-right'>
                          {row.withheld.includes('quantity') ? (
                            <WithheldValue reason={withheldReason} />
                          ) : editable ? (
                            <Input
                              type='number'
                              min={0}
                              step={0.01}
                              className='h-8 w-20 text-right'
                              value={row.quantity}
                              onChange={(e) =>
                                patchRow(row.key, { quantity: e.target.value })
                              }
                            />
                          ) : (
                            row.quantity
                          )}
                        </td>
                        <td className='px-2 py-1'>
                          {row.withheld.includes('unit') ? (
                            <WithheldValue reason={withheldReason} />
                          ) : editable ? (
                            <Input
                              className='h-8 w-16'
                              value={row.unit}
                              onChange={(e) =>
                                patchRow(row.key, { unit: e.target.value })
                              }
                            />
                          ) : (
                            row.unit
                          )}
                        </td>
                        <td className='px-2 py-1 text-right'>
                          {row.withheld.includes('unitCost') ? (
                            <WithheldValue reason={withheldReason} />
                          ) : editable ? (
                            <Input
                              type='number'
                              min={0}
                              step={0.01}
                              className='h-8 w-24 text-right'
                              value={row.unitCost}
                              onChange={(e) =>
                                patchRow(row.key, { unitCost: e.target.value })
                              }
                            />
                          ) : (
                            money(Number(row.unitCost))
                          )}
                        </td>
                        <td
                          className='px-2 py-1 text-right tabular-nums'
                          data-testid={`uat-change-event-line-amount-${row.key}`}
                        >
                          {editable &&
                          (row.withheld.includes('quantity') ||
                            row.withheld.includes('unitCost')) ? (
                            <Input
                              type='number'
                              min={0}
                              step={0.01}
                              className='h-8 w-24 text-right'
                              value={row.romAmount}
                              title='The amount is priced directly: the quantity and unit cost are withheld from you'
                              onChange={(e) =>
                                patchRow(row.key, { romAmount: e.target.value })
                              }
                            />
                          ) : (
                            money(rowAmount(row))
                          )}
                        </td>
                        <td className='px-2 py-1 text-right tabular-nums'>
                          {row.quotedAmount === null
                            ? '·'
                            : money(row.quotedAmount)}
                        </td>
                        {editable && (
                          <td className='px-2 py-1'>
                            {/* A line carrying a field withheld from this member is not
                                theirs to remove (the server refuses it: 409
                                CHANGE_EVENT_LINE_WITHHELD) — no delete control, the reason. */}
                            {row.withheld.length ? (
                              <span
                                className='cursor-help text-muted-foreground'
                                title={`This line cannot be removed by you — ${withheldReason ?? ''}`}
                                aria-label={`This line cannot be removed by you — ${withheldReason ?? ''}`}
                                data-testid={`uat-change-event-line-keep-${row.key}`}
                                data-reason={withheldReason}
                              >
                                —
                              </span>
                            ) : (
                              <button
                                type='button'
                                className='text-destructive'
                                title='Remove line'
                                data-testid={`uat-change-event-line-remove-${row.key}`}
                                onClick={() => {
                                  setRows((current) =>
                                    current.filter(
                                      (item) => item.key !== row.key
                                    )
                                  )
                                  setDirty(true)
                                }}
                              >
                                <Trash2 className='h-4 w-4' />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={10}
                          className='px-2 py-3 text-center text-muted-foreground'
                        >
                          No lines — the header ROM is used until lines exist.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className='space-y-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <p className='font-medium'>Requests for quotation</p>
                <span className='text-xs text-muted-foreground'>
                  {event.rfqCounts.total
                    ? `${event.rfqCounts.quoted} quoted · ${event.rfqCounts.accepted} accepted · ${event.rfqCounts.open} open`
                    : 'Send the scope to vendors to price it'}
                </span>
                {editable && canSend && (
                  <Button
                    size='sm'
                    variant='outline'
                    className='ml-auto'
                    disabled={busy}
                    onClick={async () => {
                      if (dirty && !(await save())) return
                      setSending(true)
                    }}
                    data-testid='uat-change-event-send-rfq'
                  >
                    <Send className='mr-2 h-4 w-4' /> Send RFQs
                  </Button>
                )}
              </div>
              <RfqTable projectId={projectId} event={event} />
            </div>

            <div className='space-y-1'>
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={header.notes}
                onChange={(e) => setHeaderField('notes', e.target.value)}
                disabled={!editable}
              />
            </div>

            <div className='flex flex-wrap items-center gap-2'>
              {editable && (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={!dirty || busy}
                  onClick={save}
                  data-testid='uat-change-event-save'
                >
                  <Save className='mr-2 h-4 w-4' /> Save
                </Button>
              )}
              {editable && canConvert && (
                <Button
                  size='sm'
                  disabled={busy}
                  onClick={convert}
                  data-testid='uat-change-event-convert'
                  title='Creates a draft change order at the quoted value (else ROM) and links accepted commitment quotes'
                >
                  <ArrowRightCircle className='mr-2 h-4 w-4' /> Convert to
                  change order
                </Button>
              )}
              {editable && canClose && (
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt(
                      'Close without a change order? Reason (optional):'
                    )
                    if (reason === null) return
                    action.mutate(
                      {
                        id: event.id,
                        action: 'close',
                        body: { reason: reason || null },
                      },
                      {
                        onSuccess: () => toast.success('Change event closed'),
                        onError: (error) =>
                          toast.error(getServerErrorMessage(error)),
                      }
                    )
                  }}
                >
                  Close
                </Button>
              )}
              {editable && canVoid && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='text-destructive'
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt(
                      'Void this change event? Reason:'
                    )
                    if (!reason) return
                    action.mutate(
                      { id: event.id, action: 'void', body: { reason } },
                      {
                        onSuccess: () => toast.success('Change event voided'),
                        onError: (error) =>
                          toast.error(getServerErrorMessage(error)),
                      }
                    )
                  }}
                >
                  <Ban className='mr-2 h-4 w-4' /> Void
                </Button>
              )}
              {event.status === 'open' &&
                event.rfqCounts.total === 0 &&
                canDelete &&
                carriesWithheldField && (
                  <span
                    className='ml-auto cursor-help text-xs text-muted-foreground'
                    title={withheldReason}
                    data-testid='uat-change-event-delete-withheld'
                    data-reason={withheldReason}
                  >
                    Delete — {withheldReason}
                  </span>
                )}
              {event.status === 'open' &&
                event.rfqCounts.total === 0 &&
                canDelete &&
                !carriesWithheldField && (
                  <Button
                    size='sm'
                    variant='ghost'
                    className='ml-auto text-destructive'
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm('Delete this change event?')) return
                      remove.mutate(event.id, {
                        onSuccess: () => onOpenChange(false),
                        onError: (error) =>
                          toast.error(getServerErrorMessage(error)),
                      })
                    }}
                  >
                    <Trash2 className='mr-2 h-4 w-4' /> Delete
                  </Button>
                )}
              {busy && <Loader2 className='h-4 w-4 animate-spin' />}
            </div>

            <HistoryPanel
              projectId={projectId}
              entityType='change_event'
              entityId={event.id}
              title='History'
              limit={6}
            />
          </div>
        )}
        {event && (
          <SendRfqDialog
            projectId={projectId}
            event={event}
            open={sending}
            onOpenChange={setSending}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
