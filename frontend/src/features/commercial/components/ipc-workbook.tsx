import { useMemo, useState } from 'react'
import { formatShortDate } from '@/lib/dates'
import {
  AlertTriangle,
  Banknote,
  FileCheck2,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  hasMoneyPrecision,
  MONEY_INPUT_STEP,
  MONEY_PRECISION_MESSAGE,
  toMoneyNumber,
} from '@/lib/money'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import {
  useCertifyIpcPeriod,
  useCreateIpcPeriod,
  useIpcPeriod,
  useIpcPeriods,
  useIssueIpcInvoice,
  useRecordIpcPayment,
  useReleaseIpcRetention,
  useSubmitIpcPeriod,
  useUpdateIpcItem,
} from '../hooks/use-commercial'

const fmtUSD = (value: number) =>
  '$' +
  Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

function statusTone(status?: string) {
  if (status === 'paid' || status === 'released' || status === 'issued') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }
  if (
    status === 'submitted' ||
    status === 'certified' ||
    status === 'partially_paid'
  ) {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  return 'border-muted-foreground/30 bg-muted text-muted-foreground'
}

function StatusBadge({ label, value }: { label: string; value?: string }) {
  return (
    <Badge variant='outline' className={statusTone(value)}>
      {label}: {(value || 'none').replace(/_/g, ' ')}
    </Badge>
  )
}

export function IpcWorkbook({
  projectId,
  initialStatus,
  initialRecordId,
}: {
  projectId: string
  initialStatus?: string
  initialRecordId?: string
}) {
  const { data: periods = [], isLoading } = useIpcPeriods(projectId)
  const canCreateIpc = useCanPerform('ipc', 'create', 'period.create')
  const canUpdateIpc = useCanPerform('ipc', 'update', 'item.update')
  const canSubmitIpc = useCanPerform('ipc', 'submit', 'period.submit')
  const canCertifyIpc = useCanPerform('ipc', 'certify', 'period.certify')
  const canIssueInvoice = useCanPerform('ipc', 'approve', 'invoice.issue')
  const canRecordPayment = useCanPerform('ipc', 'approve', 'payment.record')
  const canReleaseRetention = useCanPerform(
    'ipc',
    'approve',
    'retention.release'
  )
  const createPeriod = useCreateIpcPeriod(projectId)
  const updateItem = useUpdateIpcItem(projectId)
  const submitPeriod = useSubmitIpcPeriod(projectId)
  const certifyPeriod = useCertifyIpcPeriod(projectId)
  const issueInvoice = useIssueIpcInvoice(projectId)
  const recordPayment = useRecordIpcPayment(projectId)
  const releaseRetention = useReleaseIpcRetention(projectId)

  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDueDate, setInvoiceDueDate] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [retentionAmount, setRetentionAmount] = useState('')
  const [retentionReference, setRetentionReference] = useState('')
  const [retentionReason, setRetentionReason] = useState('')
  const [certificationComment, setCertificationComment] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const dashboardPeriod =
    periods.find((period) => period.id === initialRecordId)?.period ||
    periods.find((period) => period.status === initialStatus)?.period ||
    ''
  const activePeriod =
    selectedPeriod || dashboardPeriod || periods[0]?.period || ''

  const { data: detail } = useIpcPeriod(projectId, activePeriod)
  // A member who may not read the BOQ is sent no line and no review: the
  // server withholds them and says why, and the workbook says so instead.
  const boqWithheld = detail?.boqWithheld
  const items = detail?.items ?? []

  const totals = useMemo(
    () => ({
      totalCert: detail?.totalCert || 0,
      totalRet: detail?.totalRet || 0,
      netPayable: detail?.netPayable || 0,
      amountPaid: detail?.amountPaid || 0,
      retentionReleased: detail?.retentionReleased || 0,
      balanceDue: detail?.balanceDue || 0,
    }),
    [
      detail?.amountPaid,
      detail?.balanceDue,
      detail?.netPayable,
      detail?.retentionReleased,
      detail?.totalCert,
      detail?.totalRet,
    ]
  )
  const issuedInvoice =
    detail?.invoices?.find((invoice) => invoice.status !== 'void') ||
    detail?.invoices?.[0]
  const retainedBalance = Math.max(
    0,
    totals.totalRet - totals.retentionReleased
  )
  // Retention, net payable and balance of a period not yet certified, where
  // the server withheld them with the contract value (the cap is a rate of
  // it): shown as "—" with the server's reason, never a zero.
  const figure = (key: 'totalRet' | 'netPayable' | 'balanceDue') => {
    const withheld = detail?.valueWithheld?.keys.includes(key) ? detail.valueWithheld : null
    return withheld ? (
      <span className='inline-flex flex-col' data-testid='ipc-total-withheld'>
        <span>—</span>
        <span className='text-[11px] font-normal text-muted-foreground'>{withheld.reason}</span>
      </span>
    ) : (
      fmtUSD(totals[key])
    )
  }
  const certificationReview = detail?.certificationReview
  const requiresOverride = Boolean(certificationReview?.requiresPmOverride)
  const hasReviewWarning = Boolean(
    requiresOverride || certificationReview?.hasMissingProgressEvidence
  )
  const canEditItems = Boolean(canUpdateIpc && detail?.status === 'draft')
  const showIssueInvoice = Boolean(
    detail &&
    canIssueInvoice &&
    ['certified', 'paid'].includes(detail.status) &&
    detail.invoiceStatus !== 'issued'
  )
  const showPaymentForm = Boolean(
    detail &&
    canRecordPayment &&
    detail.invoiceStatus === 'issued' &&
    totals.balanceDue > 0
  )
  const showRetentionForm = Boolean(
    detail &&
    canReleaseRetention &&
    detail.invoiceStatus === 'issued' &&
    retainedBalance > 0
  )

  if (isLoading) {
    return (
      <p className='py-8 text-center text-muted-foreground'>
        Loading IPC data…
      </p>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end justify-between gap-2'>
        <div className='space-y-1'>
          <p className='text-xs text-muted-foreground'>IPC Period</p>
          <select
            className='h-9 rounded-md border bg-background px-2 text-sm'
            value={activePeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            data-testid='uat-ipc-period-select'
            data-period-id={
              periods.find((period) => period.period === activePeriod)?.id ?? ''
            }
          >
            {periods.map((period) => (
              <option key={period.id} value={period.period}>
                {period.period} — {period.status}
              </option>
            ))}
          </select>
        </div>

        <div className='flex gap-2'>
          {canCreateIpc && (
            <Button
              size='sm'
              variant='outline'
              disabled={createPeriod.isPending}
              onClick={async () => {
                try {
                  const created = await createPeriod.mutateAsync({})
                  setSelectedPeriod(created.period)
                  toast.success(`Created ${created.period}`)
                } catch {
                  toast.error('Failed to create IPC period')
                }
              }}
            >
              <FileCheck2 className='mr-1.5 size-4' />
              New IPC Period
            </Button>
          )}

          {canSubmitIpc && detail && detail.status === 'draft' && (
            <Button
              size='sm'
              onClick={async () => {
                try {
                  await submitPeriod.mutateAsync(activePeriod)
                  toast.success('IPC submitted')
                } catch {
                  toast.error('Failed to submit IPC')
                }
              }}
            >
              <ShieldCheck className='mr-1.5 size-4' />
              Submit IPC
            </Button>
          )}

          {canCertifyIpc && detail && detail.status === 'submitted' && (
            <Button
              size='sm'
              disabled={
                certifyPeriod.isPending ||
                (requiresOverride && !overrideReason.trim())
              }
              onClick={async () => {
                try {
                  await certifyPeriod.mutateAsync({
                    period: activePeriod,
                    comment: certificationComment.trim() || undefined,
                    overrideReason: overrideReason.trim() || undefined,
                  })
                  setCertificationComment('')
                  setOverrideReason('')
                  toast.success('IPC certified')
                } catch {
                  toast.error('Failed to certify IPC')
                }
              }}
            >
              <FileCheck2 className='mr-1.5 size-4' />
              Certify IPC
            </Button>
          )}
        </div>
      </div>

      {detail && (
        <AuditHistoryPanel
          projectId={projectId}
          entityType='ipc_certificate'
          entityId={detail.id}
          title={`${activePeriod} Status History`}
        />
      )}

      {detail && (
        <div className='flex flex-wrap gap-2'>
          <StatusBadge label='Period' value={detail.status} />
          <StatusBadge label='Invoice' value={detail.invoiceStatus} />
          <StatusBadge label='Payment' value={detail.paymentStatus} />
          <StatusBadge label='Retention' value={detail.retentionStatus} />
          {!canEditItems && (
            <Badge variant='outline' className='gap-1 text-muted-foreground'>
              <LockKeyhole className='size-3.5' />
              Lines locked
            </Badge>
          )}
        </div>
      )}

      {detail && (certificationReview || boqWithheld) && (
        <div className='grid gap-3 rounded-md border p-3 lg:grid-cols-[repeat(5,minmax(0,1fr))]'>
          <div className='text-xs'>
            <p className='text-muted-foreground'>Earned Value Basis</p>
            <p className='text-lg font-semibold'>
              {certificationReview ? fmtUSD(certificationReview.earnedAmount) : '—'}
            </p>
          </div>
          <div className='text-xs'>
            <p className='text-muted-foreground'>Current Claimed</p>
            <p className='text-lg font-semibold'>
              {certificationReview ? fmtUSD(certificationReview.currentClaimedAmount) : '—'}
            </p>
          </div>
          <div className='text-xs'>
            <p className='text-muted-foreground'>Approved Limit</p>
            <p className='text-lg font-semibold'>
              {certificationReview ? fmtUSD(certificationReview.approvedLimitAmount) : '—'}
            </p>
          </div>
          <div className='text-xs'>
            <p className='text-muted-foreground'>Over Earned</p>
            <p className='text-lg font-semibold text-amber-600'>
              {certificationReview ? fmtUSD(certificationReview.overEarnedAmount) : '—'}
            </p>
          </div>
          <div className='text-xs'>
            <p className='text-muted-foreground'>Over Approved</p>
            <p className='text-lg font-semibold text-rose-600'>
              {certificationReview ? fmtUSD(certificationReview.overApprovedLimitAmount) : '—'}
            </p>
          </div>
          {boqWithheld && (
            <p
              className='text-xs text-muted-foreground lg:col-span-5'
              data-testid='ipc-review-withheld'
            >
              {boqWithheld.reason}
            </p>
          )}
          {detail.status === 'submitted' && (
            <div className='space-y-2 lg:col-span-5'>
              {hasReviewWarning && (
                <div className='flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300'>
                  <AlertTriangle className='mt-0.5 size-4 shrink-0' />
                  <span>
                    PM override is required when certification exceeds earned
                    progress or approved BOQ/variation value.
                  </span>
                </div>
              )}
              <div className='grid gap-2 md:grid-cols-2'>
                <Textarea
                  rows={2}
                  placeholder='Certification comment'
                  value={certificationComment}
                  onChange={(e) => setCertificationComment(e.target.value)}
                />
                <Textarea
                  rows={2}
                  placeholder='PM override reason'
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  disabled={!requiresOverride && !boqWithheld}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {detail && (
        <div className='grid gap-3 rounded-md border bg-muted/20 p-3 lg:grid-cols-3'>
          <div className='space-y-2'>
            <div className='flex items-center gap-2 text-sm font-medium'>
              <ReceiptText className='size-4 text-muted-foreground' />
              Invoice
            </div>
            {issuedInvoice ? (
              <div className='space-y-1 text-xs'>
                <p className='font-medium'>{issuedInvoice.invoiceNumber}</p>
                <p className='text-muted-foreground'>
                  {issuedInvoice.status} - Due{' '}
                  {issuedInvoice.dueDate
                    ? formatShortDate(issuedInvoice.dueDate)
                    : 'not set'}
                </p>
              </div>
            ) : (
              <div className='grid gap-2 sm:grid-cols-[1fr_9rem_auto]'>
                <Input
                  placeholder='Invoice #'
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  disabled={!showIssueInvoice || issueInvoice.isPending}
                />
                <Input
                  type='date'
                  value={invoiceDueDate}
                  onChange={(e) => setInvoiceDueDate(e.target.value)}
                  disabled={!showIssueInvoice || issueInvoice.isPending}
                />
                <Button
                  type='button'
                  size='sm'
                  disabled={!showIssueInvoice || issueInvoice.isPending}
                  onClick={async () => {
                    try {
                      await issueInvoice.mutateAsync({
                        period: activePeriod,
                        payload: {
                          invoiceNumber: invoiceNumber.trim() || undefined,
                          dueDate: invoiceDueDate || undefined,
                        },
                      })
                      setInvoiceNumber('')
                      setInvoiceDueDate('')
                      toast.success('IPC invoice issued')
                    } catch {
                      toast.error('Failed to issue IPC invoice')
                    }
                  }}
                >
                  <ReceiptText className='mr-1.5 size-4' />
                  Issue
                </Button>
              </div>
            )}
          </div>

          <div className='space-y-2'>
            <div className='flex items-center gap-2 text-sm font-medium'>
              <Banknote className='size-4 text-muted-foreground' />
              Payment
            </div>
            <div className='grid gap-2 sm:grid-cols-[1fr_1fr_9rem_auto]'>
              <Input
                type='number'
                min={0}
                step={MONEY_INPUT_STEP}
                placeholder='Amount'
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                disabled={!showPaymentForm || recordPayment.isPending}
              />
              <Input
                placeholder='Reference'
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                disabled={!showPaymentForm || recordPayment.isPending}
              />
              <Input
                type='date'
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                disabled={!showPaymentForm || recordPayment.isPending}
              />
              <Button
                type='button'
                size='sm'
                disabled={!showPaymentForm || recordPayment.isPending}
                onClick={async () => {
                  if (!hasMoneyPrecision(paymentAmount)) {
                    toast.error(MONEY_PRECISION_MESSAGE)
                    return
                  }
                  const amount = toMoneyNumber(paymentAmount)
                  if (amount <= 0 || amount > totals.balanceDue) {
                    toast.error('Payment must fit the outstanding balance')
                    return
                  }
                  try {
                    await recordPayment.mutateAsync({
                      period: activePeriod,
                      payload: {
                        amount,
                        paymentReference: paymentReference.trim() || undefined,
                        paymentDate: paymentDate || undefined,
                      },
                    })
                    setPaymentAmount('')
                    setPaymentReference('')
                    setPaymentDate('')
                    toast.success('Payment recorded')
                  } catch {
                    toast.error('Failed to record payment')
                  }
                }}
              >
                <Banknote className='mr-1.5 size-4' />
                Record
              </Button>
            </div>
          </div>

          <div className='space-y-2'>
            <div className='flex items-center gap-2 text-sm font-medium'>
              <ShieldCheck className='size-4 text-muted-foreground' />
              Retention Release
            </div>
            <div className='grid gap-2 sm:grid-cols-[1fr_1fr_auto]'>
              <Input
                type='number'
                min={0}
                step={MONEY_INPUT_STEP}
                placeholder='Amount'
                value={retentionAmount}
                onChange={(e) => setRetentionAmount(e.target.value)}
                disabled={!showRetentionForm || releaseRetention.isPending}
              />
              <Input
                placeholder='Reference'
                value={retentionReference}
                onChange={(e) => setRetentionReference(e.target.value)}
                disabled={!showRetentionForm || releaseRetention.isPending}
              />
              <Button
                type='button'
                size='sm'
                disabled={!showRetentionForm || releaseRetention.isPending}
                onClick={async () => {
                  if (!hasMoneyPrecision(retentionAmount)) {
                    toast.error(MONEY_PRECISION_MESSAGE)
                    return
                  }
                  const amount = toMoneyNumber(retentionAmount)
                  if (amount <= 0 || amount > retainedBalance) {
                    toast.error('Release must fit retained balance')
                    return
                  }
                  try {
                    await releaseRetention.mutateAsync({
                      period: activePeriod,
                      payload: {
                        amount,
                        releaseReference:
                          retentionReference.trim() || undefined,
                        reason: retentionReason.trim() || undefined,
                      },
                    })
                    setRetentionAmount('')
                    setRetentionReference('')
                    setRetentionReason('')
                    toast.success('Retention released')
                  } catch {
                    toast.error('Failed to release retention')
                  }
                }}
              >
                <ShieldCheck className='mr-1.5 size-4' />
                Release
              </Button>
            </div>
            <Textarea
              rows={2}
              placeholder='Release reason'
              value={retentionReason}
              onChange={(e) => setRetentionReason(e.target.value)}
              disabled={!showRetentionForm || releaseRetention.isPending}
            />
          </div>
        </div>
      )}

      {detail && (
        <div className='grid gap-3 lg:grid-cols-2'>
          <div className='rounded-md border p-3'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <p className='text-sm font-medium'>Payment History</p>
              <Badge variant='outline'>{detail.payments?.length || 0}</Badge>
            </div>
            <div className='space-y-2'>
              {detail.payments?.length ? (
                detail.payments.map((payment) => (
                  <div
                    key={payment.id}
                    className='flex items-center justify-between gap-2 rounded-md border p-2 text-xs'
                  >
                    <div>
                      <p className='font-medium'>{payment.paymentReference}</p>
                      <p className='text-muted-foreground'>
                        {formatShortDate(payment.paymentDate)}
                        {payment.paymentMethod
                          ? ` - ${payment.paymentMethod}`
                          : ''}
                      </p>
                    </div>
                    <p className='font-semibold'>{fmtUSD(payment.amount)}</p>
                  </div>
                ))
              ) : (
                <p className='rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground'>
                  No payments recorded
                </p>
              )}
            </div>
          </div>
          <div className='rounded-md border p-3'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <p className='text-sm font-medium'>Retention Release History</p>
              <Badge variant='outline'>
                {detail.retentionReleases?.length || 0}
              </Badge>
            </div>
            <div className='space-y-2'>
              {detail.retentionReleases?.length ? (
                detail.retentionReleases.map((release) => (
                  <div
                    key={release.id}
                    className='flex items-center justify-between gap-2 rounded-md border p-2 text-xs'
                  >
                    <div>
                      <p className='font-medium'>{release.releaseReference}</p>
                      <p className='text-muted-foreground'>
                        {formatShortDate(release.releaseDate)}
                        {release.reason ? ` - ${release.reason}` : ''}
                      </p>
                    </div>
                    <p className='font-semibold'>{fmtUSD(release.amount)}</p>
                  </div>
                ))
              ) : (
                <p className='rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground'>
                  No retention releases recorded
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Total Certified</p>
          <p className='text-xl font-bold'>{fmtUSD(totals.totalCert)}</p>
        </div>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Retention Held</p>
          <p className='text-xl font-bold text-amber-600'>
            {figure('totalRet')}
          </p>
        </div>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Net Payable</p>
          <p className='text-xl font-bold text-green-600'>
            {figure('netPayable')}
          </p>
        </div>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Paid</p>
          <p className='text-xl font-bold'>{fmtUSD(totals.amountPaid)}</p>
        </div>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Retention Released</p>
          <p className='text-xl font-bold text-sky-600'>
            {fmtUSD(totals.retentionReleased)}
          </p>
        </div>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Balance Due</p>
          <p className='text-xl font-bold text-rose-600'>
            {figure('balanceDue')}
          </p>
        </div>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm whitespace-nowrap'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left font-medium'>BOQ Ref</th>
              <th className='p-2 text-left font-medium'>Activity</th>
              <th className='p-2 text-left font-medium'>Approved Progress</th>
              <th className='p-2 text-right font-medium'>Earned Cap</th>
              <th className='p-2 text-left font-medium'>Review</th>
              <th className='p-2 text-left font-medium'>Description</th>
              <th className='p-2 text-left font-medium'>Unit</th>
              <th className='p-2 text-right font-medium'>Total Qty</th>
              <th className='p-2 text-right font-medium'>Rate</th>
              <th className='p-2 text-right font-medium'>Previous Cert</th>
              <th className='p-2 text-right font-medium'>Current Qty</th>
              <th className='p-2 text-right font-medium'>Current Cert</th>
              <th className='p-2 text-right font-medium'>Cumulative</th>
              <th className='p-2 text-right font-medium'>Retention %</th>
              <th className='p-2 text-right font-medium'>Retention</th>
              <th className='p-2 text-right font-medium'>Net Payable</th>
            </tr>
          </thead>
          <tbody>
            {detail && boqWithheld ? (
              <tr data-testid='ipc-lines-withheld'>
                <td
                  colSpan={16}
                  className='p-6 text-center text-muted-foreground'
                >
                  <p className='font-mono'>—</p>
                  <p>{boqWithheld.reason}</p>
                </td>
              </tr>
            ) : !detail || items.length === 0 ? (
              <tr>
                <td
                  colSpan={16}
                  className='p-6 text-center text-muted-foreground'
                >
                  {activePeriod
                    ? 'No IPC items available for this period.'
                    : 'Create a new IPC period to start workbook entries.'}
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className='border-b hover:bg-muted/25'>
                  <td className='p-2 font-mono text-xs'>
                    {item.boqItem.ref || '—'}
                  </td>
                  <td className='max-w-52 truncate p-2 text-xs'>
                    {item.allocation?.activity
                      ? `${item.allocation.activity.wbsCode || item.allocation.activity.p6ActivityId || item.allocation.activity.id.slice(0, 8)} - ${item.allocation.activity.name}`
                      : '-'}
                  </td>
                  <td className='p-2 text-xs'>
                    {item.progressLinks?.[0] ? (
                      <div className='flex flex-col gap-0.5'>
                        <span className='font-medium'>
                          {Number(
                            item.progressLinks[0].approvedPctComplete || 0
                          ).toFixed(1)}
                          %
                        </span>
                        <span className='text-muted-foreground'>
                          {item.progressLinks[0].cutoffDate
                            ? new Date(
                                item.progressLinks[0].cutoffDate
                              ).toLocaleDateString()
                            : 'approved'}
                        </span>
                      </div>
                    ) : (
                      <span className='text-muted-foreground'>Pending</span>
                    )}
                  </td>
                  <td className='p-2 text-right text-xs'>
                    {fmtUSD(item.certificationReview?.earnedAmount || 0)}
                  </td>
                  <td className='p-2 text-xs'>
                    {item.certificationReview?.requiresOverride ? (
                      <Badge
                        variant='outline'
                        className='border-amber-500/40 text-amber-700 dark:text-amber-300'
                      >
                        Override
                      </Badge>
                    ) : (
                      <span className='text-muted-foreground'>OK</span>
                    )}
                  </td>
                  <td
                    className='max-w-80 truncate p-2'
                    title={item.boqItem.description}
                  >
                    {item.boqItem.description}
                  </td>
                  <td className='p-2 text-xs'>{item.boqItem.unit || '—'}</td>
                  <td className='p-2 text-right text-xs'>
                    {item.allocation?.quantity ?? item.boqItem.qty}
                  </td>
                  <td className='p-2 text-right text-xs'>
                    {fmtUSD(item.rate)}
                  </td>
                  <td className='p-2 text-right text-xs'>
                    {fmtUSD(item.previousCert)}
                  </td>
                  <td className='p-2 text-right'>
                    <Input
                      type='number'
                      min={0}
                      className='h-8 w-24 text-right text-xs'
                      value={item.qty}
                      disabled={!canEditItems}
                      onChange={async (e) => {
                        try {
                          await updateItem.mutateAsync({
                            period: activePeriod,
                            itemId: item.id,
                            payload: { qty: Number(e.target.value) || 0 },
                          })
                        } catch {
                          toast.error('Failed to update quantity')
                        }
                      }}
                    />
                  </td>
                  <td className='p-2 text-right text-xs font-medium'>
                    {fmtUSD(item.currentCert)}
                  </td>
                  <td className='p-2 text-right text-xs'>
                    {fmtUSD(item.cumulativeCert)}
                  </td>
                  <td className='p-2 text-right'>
                    <Input
                      type='number'
                      min={0}
                      step={MONEY_INPUT_STEP}
                      className='h-8 w-20 text-right text-xs'
                      value={item.retentionRate}
                      disabled={!canEditItems}
                      onChange={async (e) => {
                        try {
                          await updateItem.mutateAsync({
                            period: activePeriod,
                            itemId: item.id,
                            payload: {
                              retentionRate: Number(e.target.value) || 0,
                            },
                          })
                        } catch {
                          toast.error('Failed to update retention rate')
                        }
                      }}
                    />
                  </td>
                  <td className='p-2 text-right text-xs font-medium text-amber-700'>
                    {fmtUSD(item.retention)}
                  </td>
                  <td className='p-2 text-right text-xs font-semibold text-green-700'>
                    {fmtUSD(item.netPayable)}
                  </td>
                </tr>
              ))
            )}
          </tbody>

          {detail && items.length > 0 && (
            <tfoot>
              <tr className='bg-muted/40'>
                <td
                  colSpan={11}
                  className='p-2 text-right text-xs font-semibold'
                >
                  Totals:
                </td>
                <td className='p-2 text-right text-xs font-semibold'>
                  {fmtUSD(totals.totalCert)}
                </td>
                <td className='p-2' />
                <td className='p-2' />
                <td className='p-2 text-right text-xs font-semibold'>
                  {figure('totalRet')}
                </td>
                <td className='p-2 text-right text-xs font-semibold'>
                  {figure('netPayable')}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
