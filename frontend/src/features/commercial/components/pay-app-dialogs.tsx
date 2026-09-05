import { useState } from 'react'
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Download,
  Loader2,
  RotateCcw,
  Send,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { CommentThread } from '@/features/comments/components/comment-thread'
import { WorkflowInstancePanel } from '@/features/workflows/components/workflow-instance-panel'
import { useCommitments } from '../hooks/use-commitments'
import {
  PAY_APP_STATUS_LABEL,
  REJECTION_CODES,
  REJECTION_LABEL,
  downloadPayAppPdf,
  useCreatePayApp,
  usePayApp,
  usePayAppAction,
  useRecordPayAppPayment,
  useUpdatePayApp,
  useVoidPayApp,
  type PayApp,
  type RejectionCode,
} from '../hooks/use-pay-apps'

const NONE = '__none'
const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : '—'

const statusTone = (status: PayApp['status']) =>
  ({
    draft: '',
    submitted: 'bg-sky-600 text-white',
    under_review: 'bg-indigo-600 text-white',
    approved: 'bg-emerald-600 text-white',
    paid: 'bg-slate-700 text-white',
    rejected: 'bg-red-600 text-white',
    void: 'bg-red-600 text-white',
  })[status]

/** Start an application against an executed commitment. */
export function PayAppCreateDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (payApp: PayApp) => void
}) {
  const { data: commitments } = useCommitments(projectId, {
    status: 'executed',
  })
  const create = useCreatePayApp(projectId)
  const [commitmentId, setCommitmentId] = useState('')
  const [periodLabel, setPeriodLabel] = useState(
    new Date().toISOString().slice(0, 7)
  )
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [waiverRequired, setWaiverRequired] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid='uat-payapp-create'>
        <DialogHeader>
          <DialogTitle>New payment application</DialogTitle>
          <DialogDescription>
            Lines come from the commitment's schedule of values with what was
            claimed before and the approved progress cap on each activity.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label>Commitment</Label>
            <Select
              value={commitmentId || NONE}
              onValueChange={(value) =>
                setCommitmentId(value === NONE ? '' : value)
              }
            >
              <SelectTrigger data-testid='uat-payapp-commitment'>
                <SelectValue placeholder='Executed commitment' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Pick a commitment</SelectItem>
                {(commitments?.items ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.ref} · {item.title}
                    {item.vendor ? ` · ${item.vendor.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-3 sm:grid-cols-3'>
            <div className='space-y-1'>
              <Label htmlFor='payapp-period'>Period</Label>
              <Input
                id='payapp-period'
                value={periodLabel}
                onChange={(e) => setPeriodLabel(e.target.value)}
                data-testid='uat-payapp-period'
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='payapp-start'>From</Label>
              <Input
                id='payapp-start'
                type='date'
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='payapp-end'>To</Label>
              <Input
                id='payapp-end'
                type='date'
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <Switch
              checked={waiverRequired}
              onCheckedChange={setWaiverRequired}
              id='payapp-waiver'
            />
            <Label htmlFor='payapp-waiver' className='text-sm'>
              Lien waiver required before approval
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending || !commitmentId || !periodLabel.trim()}
            data-testid='uat-payapp-create-submit'
            onClick={async () => {
              try {
                const created = await create.mutateAsync({
                  commitmentId,
                  periodLabel: periodLabel.trim(),
                  periodStart: periodStart || null,
                  periodEnd: periodEnd || null,
                  waiverRequired,
                })
                toast.success(`${created.ref} started`)
                onOpenChange(false)
                onCreated?.(created)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {create.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Start application
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LinesEditor({
  projectId,
  payApp,
  canEdit,
  formatMoney,
}: {
  projectId: string
  payApp: PayApp
  canEdit: boolean
  formatMoney: (value: number) => string
}) {
  const update = useUpdatePayApp(projectId)
  const [drafts, setDrafts] = useState<
    Record<string, { thisPeriod: string; mos: string }>
  >(() =>
    Object.fromEntries(
      payApp.lines.map((line) => [
        line.sovLineId,
        {
          thisPeriod: String(line.thisPeriodAmount),
          mos: String(line.materialsOnSite),
        },
      ])
    )
  )
  const [backCharges, setBackCharges] = useState(String(payApp.backCharges))
  const [backChargesNote, setBackChargesNote] = useState(
    payApp.backChargesNote ?? ''
  )
  const dirty =
    payApp.lines.some(
      (line) =>
        drafts[line.sovLineId]?.thisPeriod !== String(line.thisPeriodAmount) ||
        drafts[line.sovLineId]?.mos !== String(line.materialsOnSite)
    ) ||
    backCharges !== String(payApp.backCharges) ||
    backChargesNote !== (payApp.backChargesNote ?? '')
  const editable =
    canEdit && ['draft', 'submitted', 'under_review'].includes(payApp.status)
  return (
    <div className='space-y-2' data-testid='uat-payapp-lines'>
      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-xs'>
          <thead className='bg-muted/40'>
            <tr>
              <th className='p-1 text-left'>#</th>
              <th className='p-1 text-left'>Description</th>
              <th className='p-1 text-right'>Scheduled</th>
              <th className='p-1 text-right'>Previous</th>
              <th className='p-1 text-right'>This period</th>
              <th className='p-1 text-right'>To date</th>
              <th className='p-1 text-right'>Approved</th>
              <th className='p-1 text-right'>Materials on site</th>
              <th className='p-1 text-right'>Balance</th>
            </tr>
          </thead>
          <tbody>
            {payApp.lines.map((line) => {
              const draft = drafts[line.sovLineId] ?? {
                thisPeriod: '0',
                mos: '0',
              }
              const cumulative =
                line.previousAmount + (Number(draft.thisPeriod) || 0)
              const over =
                line.capAmount !== null && cumulative > line.capAmount + 0.01
              return (
                <tr
                  key={line.id}
                  className={cn('border-t', over && 'bg-destructive/5')}
                  data-testid='uat-payapp-line'
                >
                  <td className='p-1 tabular-nums'>{line.lineNumber ?? ''}</td>
                  <td className='p-1'>
                    <div>{line.description}</div>
                    <div className='text-[10px] text-muted-foreground'>
                      {line.costCode ? `${line.costCode} · ` : ''}
                      {line.activity
                        ? `${line.activity.code ? `${line.activity.code} ` : ''}${line.activity.name}`
                        : 'no activity'}
                    </div>
                  </td>
                  <td className='p-1 text-right tabular-nums'>
                    {formatMoney(line.scheduledAmount)}
                  </td>
                  <td className='p-1 text-right tabular-nums'>
                    {formatMoney(line.previousAmount)}
                  </td>
                  <td className='p-1 text-right'>
                    <Input
                      type='number'
                      step='0.01'
                      min={0}
                      className='h-7 w-28 text-right text-xs'
                      value={draft.thisPeriod}
                      disabled={!editable}
                      onChange={(e) =>
                        setDrafts({
                          ...drafts,
                          [line.sovLineId]: {
                            ...draft,
                            thisPeriod: e.target.value,
                          },
                        })
                      }
                    />
                  </td>
                  <td
                    className={cn(
                      'p-1 text-right tabular-nums',
                      over && 'font-medium text-destructive'
                    )}
                  >
                    {formatMoney(cumulative)}
                    <span className='ml-1 text-[10px] text-muted-foreground'>
                      {line.scheduledAmount > 0
                        ? `${Math.round((cumulative / line.scheduledAmount) * 100)}%`
                        : ''}
                    </span>
                  </td>
                  <td className='p-1 text-right tabular-nums'>
                    {line.approvedPct === null ? (
                      <span className='text-muted-foreground'>—</span>
                    ) : (
                      `${line.approvedPct}%`
                    )}
                    {over && (
                      <AlertTriangle
                        className='ml-1 inline h-3 w-3 text-destructive'
                        aria-label='Over approved progress'
                      />
                    )}
                  </td>
                  <td className='p-1 text-right'>
                    <Input
                      type='number'
                      step='0.01'
                      min={0}
                      className='h-7 w-24 text-right text-xs'
                      value={draft.mos}
                      disabled={!editable}
                      onChange={(e) =>
                        setDrafts({
                          ...drafts,
                          [line.sovLineId]: { ...draft, mos: e.target.value },
                        })
                      }
                    />
                  </td>
                  <td className='p-1 text-right tabular-nums'>
                    {formatMoney(line.scheduledAmount - cumulative)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className='flex flex-wrap items-end gap-2'>
          <div className='space-y-1'>
            <Label htmlFor='payapp-backcharges' className='text-xs'>
              Back-charges
            </Label>
            <Input
              id='payapp-backcharges'
              type='number'
              step='0.01'
              min={0}
              className='w-32'
              value={backCharges}
              onChange={(e) => setBackCharges(e.target.value)}
            />
          </div>
          <div className='min-w-40 flex-1 space-y-1'>
            <Label htmlFor='payapp-backcharges-note' className='text-xs'>
              Back-charge note
            </Label>
            <Input
              id='payapp-backcharges-note'
              value={backChargesNote}
              onChange={(e) => setBackChargesNote(e.target.value)}
            />
          </div>
          <Button
            size='sm'
            disabled={!dirty || update.isPending}
            data-testid='uat-payapp-lines-save'
            onClick={async () => {
              try {
                await update.mutateAsync({
                  payAppId: payApp.id,
                  payload: {
                    backCharges: Number(backCharges) || 0,
                    backChargesNote: backChargesNote.trim() || null,
                    lines: payApp.lines.map((line) => ({
                      sovLineId: line.sovLineId,
                      thisPeriodAmount:
                        Number(drafts[line.sovLineId]?.thisPeriod) || 0,
                      materialsOnSite: Number(drafts[line.sovLineId]?.mos) || 0,
                    })),
                  },
                })
                toast.success('Claims saved')
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {update.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Save claims
          </Button>
        </div>
      )}
    </div>
  )
}

/** The payment-application workspace. */
export function PayAppDetailDialog({
  projectId,
  payAppId,
  onOpenChange,
  formatMoney,
}: {
  projectId: string
  payAppId: string | null
  onOpenChange: (open: boolean) => void
  formatMoney: (value: number) => string
}) {
  const { data: payApp, isLoading } = usePayApp(projectId, payAppId)
  const act = usePayAppAction(projectId)
  const update = useUpdatePayApp(projectId)
  const voidApp = useVoidPayApp(projectId)
  const pay = useRecordPayAppPayment(projectId)
  const canUpdate = useCanPerform('sub_pay_app', 'update')
  const canSubmit = useCanPerform('sub_pay_app', 'submit', 'sub_pay_app.submit')
  const canReview = useCanPerform('sub_pay_app', 'submit', 'sub_pay_app.review')
  const canReject = useCanPerform('sub_pay_app', 'submit', 'sub_pay_app.reject')
  const canApprove = useCanPerform(
    'sub_pay_app',
    'approve',
    'sub_pay_app.approve'
  )
  const canPay = useCanPerform('sub_pay_app', 'certify', 'sub_pay_app.pay')
  const canVoid = useCanPerform('sub_pay_app', 'delete', 'sub_pay_app.void')
  const canExport = useCanPerform('sub_pay_app', 'export')
  const [rejecting, setRejecting] = useState(false)
  const [rejectCode, setRejectCode] = useState<RejectionCode>(
    'INCORRECT_QUANTITIES'
  )
  const [rejectReason, setRejectReason] = useState('')
  const [approving, setApproving] = useState(false)
  const [complianceReason, setComplianceReason] = useState('')
  const [overClaimReason, setOverClaimReason] = useState('')
  const [paying, setPaying] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payReference, setPayReference] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [waiverDoc, setWaiverDoc] = useState<string | null>(null)

  const run = async (
    action: 'submit' | 'review' | 'reopen',
    body?: Record<string, unknown>
  ) => {
    if (!payApp) return
    try {
      await act.mutateAsync({ payAppId: payApp.id, action, body })
      toast.success(
        {
          submit: 'Application submitted',
          review: 'Marked under review',
          reopen: 'Back in draft',
        }[action]
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const complianceProblems = payApp
    ? [
        !payApp.commitment?.insuranceReady && 'insurance on the commitment',
        payApp.waiverRequired && !payApp.waiverDocumentId && 'lien waiver',
      ].filter(Boolean)
    : []

  return (
    <Dialog open={Boolean(payAppId)} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-5xl'
        data-testid='uat-payapp-detail'
      >
        {isLoading || !payApp ? (
          <div className='flex items-center gap-2 p-6 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading application…
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className='flex flex-wrap items-center gap-2'>
                <DialogTitle className='text-base'>
                  {payApp.ref} · {payApp.periodLabel}
                </DialogTitle>
                <Badge
                  className={statusTone(payApp.status)}
                  data-testid='uat-payapp-status'
                >
                  {PAY_APP_STATUS_LABEL[payApp.status]}
                </Badge>
                {payApp.overClaimAmount > 0 && (
                  <Badge
                    variant='destructive'
                    data-testid='uat-payapp-overclaim'
                  >
                    Over approved progress by{' '}
                    {formatMoney(payApp.overClaimAmount)}
                  </Badge>
                )}
                {complianceProblems.length > 0 &&
                  ['submitted', 'under_review'].includes(payApp.status) && (
                    <Badge variant='destructive'>
                      Compliance: {complianceProblems.join(', ')}
                    </Badge>
                  )}
              </div>
              <DialogDescription>
                {payApp.commitment?.ref} {payApp.commitment?.title} ·{' '}
                {payApp.commitment?.vendor?.name ?? 'no vendor'} · retention{' '}
                {payApp.retentionRate}%
              </DialogDescription>
            </DialogHeader>

            <div
              className='grid grid-cols-2 gap-2 sm:grid-cols-6'
              data-testid='uat-payapp-values'
            >
              {[
                ['Work this period', payApp.workThisPeriod],
                ['Materials on site', payApp.materialsOnSite],
                ['Gross', payApp.grossThisPeriod],
                ['Retention', payApp.retentionThisPeriod],
                ['Back-charges', payApp.backCharges],
                ['Net payable', payApp.netThisPeriod],
              ].map(([label, value]) => (
                <div key={label as string} className='rounded-md border p-2'>
                  <p className='text-xs text-muted-foreground'>
                    {label as string}
                  </p>
                  <p className='font-semibold tabular-nums'>
                    {formatMoney(value as number)}
                  </p>
                </div>
              ))}
            </div>

            <div
              className='flex flex-wrap gap-2'
              data-testid='uat-payapp-actions'
            >
              {payApp.status === 'draft' && canSubmit && (
                <Button
                  size='sm'
                  onClick={() => run('submit')}
                  data-testid='uat-payapp-submit'
                >
                  <Send className='mr-1 h-4 w-4' /> Submit
                </Button>
              )}
              {payApp.status === 'submitted' && canReview && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() =>
                    run('review', {
                      note:
                        window.prompt('Review note (optional)') ?? undefined,
                    })
                  }
                >
                  Mark under review
                </Button>
              )}
              {['submitted', 'under_review'].includes(payApp.status) &&
                canApprove && (
                  <Button
                    size='sm'
                    onClick={() => setApproving((v) => !v)}
                    data-testid='uat-payapp-approve'
                  >
                    <CheckCircle2 className='mr-1 h-4 w-4' /> Approve
                  </Button>
                )}
              {['submitted', 'under_review'].includes(payApp.status) &&
                canReject && (
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setRejecting((v) => !v)}
                    data-testid='uat-payapp-reject'
                  >
                    <XCircle className='mr-1 h-4 w-4' /> Reject
                  </Button>
                )}
              {payApp.status === 'rejected' && canUpdate && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => run('reopen')}
                >
                  <RotateCcw className='mr-1 h-4 w-4' /> Back to draft
                </Button>
              )}
              {['approved', 'paid'].includes(payApp.status) &&
                canPay &&
                payApp.outstanding > 0 && (
                  <Button
                    size='sm'
                    onClick={() => setPaying((v) => !v)}
                    data-testid='uat-payapp-pay'
                  >
                    <Banknote className='mr-1 h-4 w-4' /> Record payment
                  </Button>
                )}
              {['draft', 'rejected'].includes(payApp.status) && canVoid && (
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={async () => {
                    const reason =
                      window.prompt('Why void this application?') ?? ''
                    if (!reason.trim()) return
                    try {
                      await voidApp.mutateAsync({ payAppId: payApp.id, reason })
                      toast.success('Application voided')
                    } catch (error) {
                      toast.error(getServerErrorMessage(error))
                    }
                  }}
                >
                  Void
                </Button>
              )}
              {canExport && (
                <Button
                  size='sm'
                  variant='outline'
                  className='ml-auto'
                  onClick={() =>
                    downloadPayAppPdf(projectId, payApp.id).catch((error) =>
                      toast.error(getServerErrorMessage(error))
                    )
                  }
                  data-testid='uat-payapp-export'
                >
                  <Download className='mr-1 h-4 w-4' /> Statement PDF
                </Button>
              )}
            </div>

            {approving && (
              <div
                className='space-y-2 rounded-md border p-3'
                data-testid='uat-payapp-approve-form'
              >
                <p className='text-sm font-medium'>Approve {payApp.ref}</p>
                {complianceProblems.length > 0 && (
                  <div className='space-y-1'>
                    <p className='text-xs text-destructive'>
                      Compliance outstanding: {complianceProblems.join(', ')}.
                      Approve anyway with a reason:
                    </p>
                    <Input
                      placeholder='Compliance override reason'
                      value={complianceReason}
                      onChange={(e) => setComplianceReason(e.target.value)}
                    />
                  </div>
                )}
                {payApp.overClaimAmount > 0 && (
                  <div className='space-y-1'>
                    <p className='text-xs text-destructive'>
                      Claims exceed approved progress by{' '}
                      {formatMoney(payApp.overClaimAmount)}. Approve anyway with
                      a reason:
                    </p>
                    <Input
                      placeholder='Over-claim override reason'
                      value={overClaimReason}
                      onChange={(e) => setOverClaimReason(e.target.value)}
                    />
                  </div>
                )}
                <div className='flex justify-end gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setApproving(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size='sm'
                    disabled={
                      act.isPending ||
                      (complianceProblems.length > 0 &&
                        !complianceReason.trim()) ||
                      (payApp.overClaimAmount > 0 && !overClaimReason.trim())
                    }
                    data-testid='uat-payapp-approve-confirm'
                    onClick={async () => {
                      try {
                        await act.mutateAsync({
                          payAppId: payApp.id,
                          action: 'approve',
                          body: {
                            complianceOverrideReason:
                              complianceReason.trim() || null,
                            overClaimOverrideReason:
                              overClaimReason.trim() || null,
                          },
                        })
                        toast.success('Application approved')
                        setApproving(false)
                      } catch (error) {
                        toast.error(getServerErrorMessage(error))
                      }
                    }}
                  >
                    Approve
                  </Button>
                </div>
              </div>
            )}

            {rejecting && (
              <div
                className='space-y-2 rounded-md border p-3'
                data-testid='uat-payapp-reject-form'
              >
                <Select
                  value={rejectCode}
                  onValueChange={(value) =>
                    setRejectCode(value as RejectionCode)
                  }
                >
                  <SelectTrigger aria-label='Reason code'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REJECTION_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {REJECTION_LABEL[code]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  rows={2}
                  placeholder='What must change'
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className='flex justify-end gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setRejecting(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size='sm'
                    variant='destructive'
                    disabled={act.isPending || !rejectReason.trim()}
                    onClick={async () => {
                      try {
                        await act.mutateAsync({
                          payAppId: payApp.id,
                          action: 'reject',
                          body: {
                            code: rejectCode,
                            reason: rejectReason.trim(),
                          },
                        })
                        toast.success('Application rejected')
                        setRejecting(false)
                      } catch (error) {
                        toast.error(getServerErrorMessage(error))
                      }
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            )}

            {paying && (
              <div
                className='grid gap-2 rounded-md border p-3 md:grid-cols-[140px_140px_minmax(0,1fr)_auto]'
                data-testid='uat-payapp-pay-form'
              >
                <Input
                  type='number'
                  step='0.01'
                  min={0}
                  placeholder={`up to ${formatMoney(payApp.outstanding)}`}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
                <Input
                  type='date'
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
                <Input
                  placeholder='Reference'
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                />
                <Button
                  size='sm'
                  disabled={pay.isPending || !(Number(payAmount) > 0)}
                  data-testid='uat-payapp-pay-confirm'
                  onClick={async () => {
                    try {
                      const result = await pay.mutateAsync({
                        payAppId: payApp.id,
                        payload: {
                          amount: Number(payAmount),
                          paidAt: payDate || null,
                          reference: payReference.trim() || null,
                        },
                      })
                      toast.success(
                        result.status === 'paid'
                          ? 'Paid in full'
                          : `Payment recorded · ${formatMoney(result.outstanding)} outstanding`
                      )
                      setPaying(false)
                      setPayAmount('')
                    } catch (error) {
                      toast.error(getServerErrorMessage(error))
                    }
                  }}
                >
                  Record
                </Button>
              </div>
            )}

            {payApp.rejectedReason && (
              <p className='rounded-md border border-destructive/40 p-2 text-sm'>
                <span className='font-medium'>
                  Rejected (
                  {payApp.rejectionCode
                    ? REJECTION_LABEL[payApp.rejectionCode]
                    : 'Other'}
                  ):
                </span>{' '}
                {payApp.rejectedReason}
              </p>
            )}
            {payApp.reviewNote && (
              <p className='text-sm text-muted-foreground'>
                Review note: {payApp.reviewNote}
              </p>
            )}

            <div className='grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
              <div className='space-y-4'>
                <LinesEditor
                  key={payApp.updatedAt ?? payApp.id}
                  projectId={projectId}
                  payApp={payApp}
                  canEdit={canUpdate}
                  formatMoney={formatMoney}
                />
                <div className='grid gap-2 text-sm sm:grid-cols-3'>
                  <div>
                    <p className='text-xs text-muted-foreground'>
                      Retention held to date
                    </p>
                    <p className='font-medium tabular-nums'>
                      {formatMoney(payApp.retentionCumulative)}
                    </p>
                  </div>
                  <div>
                    <p className='text-xs text-muted-foreground'>Paid</p>
                    <p className='font-medium tabular-nums'>
                      {formatMoney(payApp.paidAmount)}
                    </p>
                  </div>
                  <div>
                    <p className='text-xs text-muted-foreground'>Outstanding</p>
                    <p className='font-medium tabular-nums'>
                      {formatMoney(payApp.outstanding)}
                    </p>
                  </div>
                </div>
                <div className='space-y-1' data-testid='uat-payapp-compliance'>
                  <p className='text-sm font-medium'>Compliance</p>
                  <p className='text-xs text-muted-foreground'>
                    Insurance on {payApp.commitment?.ref}:{' '}
                    {payApp.commitment?.insuranceReady
                      ? 'in order'
                      : 'missing or expired'}{' '}
                    · Lien waiver:{' '}
                    {payApp.waiverRequired ? (
                      payApp.waiverDocument ? (
                        <a
                          className='underline'
                          href={payApp.waiverDocument.fileUrl}
                          target='_blank'
                          rel='noreferrer'
                        >
                          {payApp.waiverDocument.fileName}
                        </a>
                      ) : (
                        'required, not on file'
                      )
                    ) : (
                      'not required'
                    )}
                  </p>
                  {canUpdate &&
                    payApp.waiverRequired &&
                    !['paid', 'void'].includes(payApp.status) && (
                      <div className='flex gap-2'>
                        <Input
                          placeholder='Waiver document id (upload it under Evidence first)'
                          value={waiverDoc ?? payApp.waiverDocumentId ?? ''}
                          onChange={(e) => setWaiverDoc(e.target.value)}
                          className='max-w-md'
                        />
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={update.isPending || waiverDoc === null}
                          onClick={async () => {
                            try {
                              await update.mutateAsync({
                                payAppId: payApp.id,
                                payload: {
                                  waiverDocumentId:
                                    (waiverDoc ?? '').trim() || null,
                                },
                              })
                              toast.success('Waiver recorded')
                              setWaiverDoc(null)
                            } catch (error) {
                              toast.error(getServerErrorMessage(error))
                            }
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    )}
                </div>
                {payApp.payments.length > 0 && (
                  <div className='space-y-1'>
                    <p className='text-sm font-medium'>Payments</p>
                    <ul className='text-sm'>
                      {payApp.payments.map((payment) => (
                        <li key={payment.id} className='flex gap-2'>
                          <span>{formatDate(payment.paidAt)}</span>
                          <span className='min-w-0 flex-1 truncate text-muted-foreground'>
                            {payment.reference || payment.method || '—'}
                          </span>
                          <span className='tabular-nums'>
                            {formatMoney(payment.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className='space-y-4'>
                <WorkflowInstancePanel
                  projectId={projectId}
                  tool='sub_pay_app'
                  recordId={payApp.id}
                />
                <AttachmentPanel
                  projectId={projectId}
                  recordType='sub_pay_app'
                  recordId={payApp.id}
                  compact
                />
                <HistoryPanel
                  projectId={projectId}
                  entityType='sub_pay_app'
                  entityId={payApp.id}
                  title={`${payApp.ref} History`}
                  limit={30}
                  showFilters={false}
                />
                <CommentThread
                  projectId={projectId}
                  recordType='sub_pay_app'
                  recordId={payApp.id}
                  title='Review comments'
                />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
