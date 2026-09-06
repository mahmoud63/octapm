import { useEffect, useMemo, useState } from 'react'
import {
  Ban,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  Wallet,
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
import { useActivities } from '@/features/activities/hooks/use-activities'
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { useVendors } from '@/features/company/hooks/use-company'
import {
  COST_TYPE_LABEL,
  useBudgetLines,
  useProjectCostCodes,
} from '@/features/cost/hooks/use-budget'
import {
  DIRECT_COST_STATUS_LABEL,
  DIRECT_COST_TYPE_LABEL,
  useDeleteDirectCost,
  useDirectCost,
  useDirectCostAction,
  useRecordDirectCostPayment,
  useUpdateDirectCost,
  type DirectCost,
  type DirectCostCostType,
  type DirectCostLinePayload,
  type DirectCostStatus,
  type DirectCostType,
} from '../hooks/use-direct-costs'

const NONE = '__none__'
const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })

export const DC_STATUS_CLASS: Record<DirectCostStatus, string> = {
  draft: 'border-slate-300 text-slate-700 dark:text-slate-200',
  pending: 'border-blue-300 text-blue-700 dark:text-blue-200',
  approved: 'border-violet-300 text-violet-700 dark:text-violet-200',
  paid: 'border-emerald-300 text-emerald-700 dark:text-emerald-200',
  void: 'border-rose-300 text-rose-700 dark:text-rose-200',
}

type LineRow = {
  key: string
  description: string
  costCodeId: string
  budgetLineId: string
  activityId: string
  costType: string
  quantity: string
  unit: string
  unitCost: string
  amount: string
  postedAmount: number
}

const rowsFrom = (cost: DirectCost): LineRow[] =>
  (cost.lines ?? []).map((line) => ({
    key: line.id,
    description: line.description,
    costCodeId: line.costCodeId ?? '',
    budgetLineId: line.budgetLineId ?? '',
    activityId: line.activityId ?? '',
    costType: line.costType ?? '',
    quantity: String(line.quantity),
    unit: line.unit ?? '',
    unitCost: String(line.unitCost),
    amount: String(line.amount),
    postedAmount: line.postedAmount,
  }))

const lineAmount = (row: LineRow) =>
  row.amount.trim() !== ''
    ? Number(row.amount) || 0
    : (Number(row.quantity) || 0) * (Number(row.unitCost) || 0)

function PaymentForm({
  projectId,
  cost,
}: {
  projectId: string
  cost: DirectCost
}) {
  const record = useRecordDirectCostPayment(projectId)
  const [amount, setAmount] = useState(String(cost.balance))
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState('transfer')
  const [reference, setReference] = useState('')
  const submit = async () => {
    try {
      await record.mutateAsync({
        id: cost.id,
        amount: Number(amount) || 0,
        paidAt: paidAt || null,
        method: method || null,
        reference: reference.trim() || null,
      })
      toast.success('Payment recorded')
      setReference('')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <div
      className='grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_1.2fr_auto]'
      data-testid='uat-direct-cost-payment'
    >
      <div className='space-y-1'>
        <Label>Amount</Label>
        <Input
          type='number'
          min={0}
          step={0.01}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      <div className='space-y-1'>
        <Label>Paid on</Label>
        <Input
          type='date'
          value={paidAt}
          onChange={(event) => setPaidAt(event.target.value)}
        />
      </div>
      <div className='space-y-1'>
        <Label>Method</Label>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['transfer', 'cheque', 'card', 'cash', 'other'].map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className='space-y-1'>
        <Label>Reference</Label>
        <Input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder='Transaction / cheque no'
        />
      </div>
      <div className='flex items-end'>
        <Button
          size='sm'
          disabled={!(Number(amount) > 0) || record.isPending}
          onClick={submit}
          data-testid='uat-direct-cost-pay'
        >
          {record.isPending ? (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          ) : (
            <Wallet className='mr-2 h-4 w-4' />
          )}
          Record
        </Button>
      </div>
    </div>
  )
}

/** One direct cost: header, lines with cost code / budget line / activity, attachments, approval, payments. */
export function DirectCostDialog({
  projectId,
  directCostId,
  open,
  onOpenChange,
}: {
  projectId: string
  directCostId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: cost, isLoading } = useDirectCost(
    projectId,
    open ? directCostId : null
  )
  const { data: costCodes } = useProjectCostCodes(projectId)
  const { data: budgetLines } = useBudgetLines(projectId)
  const { data: activities } = useActivities(projectId)
  const { data: vendors } = useVendors({}, { enabled: open })
  const update = useUpdateDirectCost(projectId)
  const remove = useDeleteDirectCost(projectId)
  const action = useDirectCostAction(projectId)
  const canUpdate = useCanPerform('cost', 'update')
  const canDelete = useCanPerform('cost', 'delete')
  const canSubmit = useCanPerform('cost', 'submit', 'direct_cost.submit')
  const canApprove = useCanPerform('cost', 'approve', 'direct_cost.approve')
  const canPay = useCanPerform('cost', 'approve', 'direct_cost.pay')
  const canVoid = useCanPerform('cost', 'approve', 'direct_cost.void')

  const [header, setHeader] = useState({
    type: 'invoice' as DirectCostType,
    description: '',
    vendorCompanyId: NONE,
    vendorName: '',
    invoiceNumber: '',
    costDate: '',
    dueDate: '',
    receivedDate: '',
    tax: '0',
    paymentTerms: '',
    notes: '',
  })
  const [rows, setRows] = useState<LineRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!cost) return
    setHeader({
      type: cost.type,
      description: cost.description,
      vendorCompanyId: cost.vendorCompanyId ?? NONE,
      vendorName: cost.vendorName ?? '',
      invoiceNumber: cost.invoiceNumber ?? '',
      costDate: cost.costDate,
      dueDate: cost.dueDate ?? '',
      receivedDate: cost.receivedDate ?? '',
      tax: String(cost.tax),
      paymentTerms: cost.paymentTerms ?? '',
      notes: cost.notes ?? '',
    })
    setRows(rowsFrom(cost))
    setDirty(false)
    setRejecting(false)
    setReason('')
  }, [cost])

  const editable =
    Boolean(cost) &&
    canUpdate &&
    (cost?.status === 'draft' || cost?.status === 'pending')
  const codeOptions = (costCodes?.items ?? []).filter(
    (code) => code.status === 'active'
  )
  const lineOptions = (budgetLines?.items ?? []).filter(
    (line) => line.status === 'active'
  )
  const activityOptions = activities ?? []
  const vendorOptions = vendors?.items ?? []
  const totals = useMemo(() => {
    const subtotal = rows.reduce((sum, row) => sum + lineAmount(row), 0)
    return { subtotal, total: subtotal + (Number(header.tax) || 0) }
  }, [rows, header.tax])
  const unCoded = rows.filter(
    (row) => !row.costCodeId && !row.budgetLineId
  ).length

  const setField = <K extends keyof typeof header>(
    field: K,
    value: (typeof header)[K]
  ) => {
    setHeader((current) => ({ ...current, [field]: value }))
    setDirty(true)
  }
  const patchRow = (key: string, changes: Partial<LineRow>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...changes } : row))
    )
    setDirty(true)
  }

  const save = async () => {
    if (!cost) return false
    const lines: DirectCostLinePayload[] = rows.map((row) => ({
      description: row.description.trim(),
      costCodeId: row.costCodeId || null,
      budgetLineId: row.budgetLineId || null,
      activityId: row.activityId || null,
      costType: (row.costType || null) as DirectCostCostType | null,
      quantity: Number(row.quantity) || 0,
      unit: row.unit.trim() || null,
      unitCost: Number(row.unitCost) || 0,
      amount: row.amount.trim() === '' ? null : Number(row.amount) || 0,
    }))
    try {
      await update.mutateAsync({
        id: cost.id,
        type: header.type,
        description: header.description.trim(),
        vendorCompanyId:
          header.vendorCompanyId === NONE ? null : header.vendorCompanyId,
        vendorName: header.vendorName.trim() || null,
        invoiceNumber: header.invoiceNumber.trim() || null,
        costDate: header.costDate,
        dueDate: header.dueDate || null,
        receivedDate: header.receivedDate || null,
        tax: Number(header.tax) || 0,
        paymentTerms: header.paymentTerms.trim() || null,
        notes: header.notes.trim() || null,
        lines,
      })
      setDirty(false)
      toast.success('Direct cost saved')
      return true
    } catch (error) {
      toast.error(getServerErrorMessage(error))
      return false
    }
  }

  const act = async (
    kind: 'submit' | 'approve' | 'reject' | 'void',
    body?: Record<string, unknown>
  ) => {
    if (!cost) return
    if (dirty && editable && !(await save())) return
    try {
      const result = await action.mutateAsync({
        id: cost.id,
        action: kind,
        body,
      })
      toast.success(
        kind === 'submit'
          ? 'Submitted for approval'
          : kind === 'approve'
            ? `Approved — ${money(result.total)} posted to the budget`
            : kind === 'reject'
              ? 'Returned to draft'
              : 'Voided — postings reversed'
      )
      setRejecting(false)
      if (kind === 'void') onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const busy = update.isPending || action.isPending || remove.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-5xl'
        data-testid='uat-direct-cost'
      >
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2'>
            {cost ? (
              <>
                <span className='font-mono'>{cost.ref}</span>
                <span>
                  {DIRECT_COST_TYPE_LABEL[cost.type]}
                  {cost.vendorName ? ` · ${cost.vendorName}` : ''}
                </span>
                <Badge
                  variant='outline'
                  className={DC_STATUS_CLASS[cost.status]}
                >
                  {DIRECT_COST_STATUS_LABEL[cost.status]}
                </Badge>
                {cost.overdue && <Badge variant='destructive'>overdue</Badge>}
              </>
            ) : (
              'Direct cost'
            )}
          </DialogTitle>
          <DialogDescription>
            A cost outside any commitment. Approval posts each line to its
            budget line and activity; payments are recorded against the approved
            amount and flow into the cash flow.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !cost ? (
          <div className='flex items-center gap-2 py-6 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading…
          </div>
        ) : (
          <div className='space-y-4'>
            {cost.status === 'draft' && cost.rejectedReason && (
              <p className='rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200'>
                Returned: {cost.rejectedReason}
              </p>
            )}
            {cost.status === 'void' && cost.voidReason && (
              <p className='rounded-md border px-3 py-2 text-sm text-muted-foreground'>
                Void: {cost.voidReason}
              </p>
            )}

            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              <div className='space-y-1'>
                <Label>Type</Label>
                <Select
                  value={header.type}
                  onValueChange={(value) =>
                    setField('type', value as DirectCostType)
                  }
                  disabled={!editable}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(DIRECT_COST_TYPE_LABEL) as DirectCostType[]
                    ).map((value) => (
                      <SelectItem key={value} value={value}>
                        {DIRECT_COST_TYPE_LABEL[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1'>
                <Label>Vendor (directory)</Label>
                <Select
                  value={header.vendorCompanyId}
                  onValueChange={(value) => setField('vendorCompanyId', value)}
                  disabled={!editable}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      — not in the directory —
                    </SelectItem>
                    {vendorOptions.map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1'>
                <Label>Vendor name</Label>
                <Input
                  value={header.vendorName}
                  onChange={(e) => setField('vendorName', e.target.value)}
                  disabled={!editable}
                  placeholder='As on the invoice'
                />
              </div>
              <div className='space-y-1'>
                <Label>Invoice number</Label>
                <Input
                  value={header.invoiceNumber}
                  onChange={(e) => setField('invoiceNumber', e.target.value)}
                  disabled={!editable}
                />
              </div>
              <div className='space-y-1 sm:col-span-2'>
                <Label>Description</Label>
                <Input
                  value={header.description}
                  onChange={(e) => setField('description', e.target.value)}
                  disabled={!editable}
                />
              </div>
              <div className='space-y-1'>
                <Label>Cost date</Label>
                <Input
                  type='date'
                  value={header.costDate}
                  onChange={(e) => setField('costDate', e.target.value)}
                  disabled={!editable}
                />
              </div>
              <div className='space-y-1'>
                <Label>Due date</Label>
                <Input
                  type='date'
                  value={header.dueDate}
                  onChange={(e) => setField('dueDate', e.target.value)}
                  disabled={!editable}
                />
              </div>
              <div className='space-y-1'>
                <Label>Received on</Label>
                <Input
                  type='date'
                  value={header.receivedDate}
                  onChange={(e) => setField('receivedDate', e.target.value)}
                  disabled={!editable}
                />
              </div>
              <div className='space-y-1'>
                <Label>Payment terms</Label>
                <Input
                  value={header.paymentTerms}
                  onChange={(e) => setField('paymentTerms', e.target.value)}
                  disabled={!editable}
                  placeholder='Net 30'
                />
              </div>
              <div className='space-y-1'>
                <Label>Tax</Label>
                <Input
                  type='number'
                  min={0}
                  step={0.01}
                  value={header.tax}
                  onChange={(e) => setField('tax', e.target.value)}
                  disabled={!editable}
                />
              </div>
            </div>

            <div className='space-y-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <p className='font-medium'>Lines</p>
                <span className='text-xs text-muted-foreground'>
                  subtotal {money(totals.subtotal)} · tax{' '}
                  {money(Number(header.tax) || 0)} · total {money(totals.total)}
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
                          description: '',
                          costCodeId: '',
                          budgetLineId: '',
                          activityId: '',
                          costType: '',
                          quantity: '1',
                          unit: '',
                          unitCost: '0',
                          amount: '',
                          postedAmount: 0,
                        },
                      ])
                      setDirty(true)
                    }}
                    data-testid='uat-direct-cost-add-line'
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
                      <th className='px-2 py-1 text-left'>Budget line</th>
                      <th className='px-2 py-1 text-left'>Cost code</th>
                      <th className='px-2 py-1 text-left'>Cost type</th>
                      <th className='px-2 py-1 text-left'>Activity</th>
                      <th className='px-2 py-1 text-right'>Qty</th>
                      <th className='px-2 py-1 text-right'>Unit cost</th>
                      <th className='px-2 py-1 text-right'>Amount</th>
                      {cost.status !== 'draft' && cost.status !== 'pending' && (
                        <th className='px-2 py-1 text-right'>Posted</th>
                      )}
                      {editable && <th className='px-2 py-1' />}
                    </tr>
                  </thead>
                  <tbody data-testid='uat-direct-cost-lines'>
                    {rows.map((row) => {
                      const saved = cost.lines?.find(
                        (line) => line.id === row.key
                      )
                      return (
                        <tr
                          key={row.key}
                          className={cn(
                            'border-t align-top',
                            editable &&
                              !row.costCodeId &&
                              !row.budgetLineId &&
                              'bg-amber-50/60 dark:bg-amber-950/20'
                          )}
                        >
                          <td className='px-2 py-1'>
                            {editable ? (
                              <Input
                                className='h-8 min-w-44'
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
                            {editable ? (
                              <Select
                                value={row.budgetLineId || NONE}
                                onValueChange={(value) =>
                                  patchRow(row.key, {
                                    budgetLineId: value === NONE ? '' : value,
                                  })
                                }
                              >
                                <SelectTrigger className='h-8 w-44'>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>
                                    — by cost code —
                                  </SelectItem>
                                  {lineOptions.map((line) => (
                                    <SelectItem key={line.id} value={line.id}>
                                      {line.costCode?.code}{' '}
                                      {COST_TYPE_LABEL[line.costType]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className='text-xs'>
                                {saved?.budgetLine
                                  ? `${saved.costCode?.code ?? ''} ${saved.budgetLine.costType}`
                                  : '—'}
                              </span>
                            )}
                          </td>
                          <td className='px-2 py-1'>
                            {editable ? (
                              <Select
                                value={row.costCodeId || NONE}
                                onValueChange={(value) =>
                                  patchRow(row.key, {
                                    costCodeId: value === NONE ? '' : value,
                                  })
                                }
                                disabled={Boolean(row.budgetLineId)}
                              >
                                <SelectTrigger className='h-8 w-36'>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>— none —</SelectItem>
                                  {codeOptions.map((code) => (
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
                                {saved?.costCode?.code ?? '—'}
                              </span>
                            )}
                          </td>
                          <td className='px-2 py-1'>
                            {editable ? (
                              <Select
                                value={row.costType || NONE}
                                onValueChange={(value) =>
                                  patchRow(row.key, {
                                    costType: value === NONE ? '' : value,
                                  })
                                }
                                disabled={Boolean(row.budgetLineId)}
                              >
                                <SelectTrigger className='h-8 w-32'>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>by type</SelectItem>
                                  {(
                                    Object.keys(
                                      COST_TYPE_LABEL
                                    ) as DirectCostCostType[]
                                  ).map((value) => (
                                    <SelectItem key={value} value={value}>
                                      {COST_TYPE_LABEL[value]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className='text-xs'>
                                {saved?.costType ?? '—'}
                              </span>
                            )}
                          </td>
                          <td className='px-2 py-1'>
                            {editable ? (
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
                                  {activityOptions.map((activity) => (
                                    <SelectItem
                                      key={activity.id}
                                      value={activity.id}
                                    >
                                      {activity.wbsCode
                                        ? `${activity.wbsCode} · `
                                        : ''}
                                      {activity.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className='text-xs'>
                                {saved?.activity?.name ?? '—'}
                              </span>
                            )}
                          </td>
                          <td className='px-2 py-1 text-right'>
                            {editable ? (
                              <Input
                                type='number'
                                min={0}
                                step={0.01}
                                className='h-8 w-20 text-right'
                                value={row.quantity}
                                onChange={(e) =>
                                  patchRow(row.key, {
                                    quantity: e.target.value,
                                  })
                                }
                              />
                            ) : (
                              row.quantity
                            )}
                          </td>
                          <td className='px-2 py-1 text-right'>
                            {editable ? (
                              <Input
                                type='number'
                                min={0}
                                step={0.01}
                                className='h-8 w-24 text-right'
                                value={row.unitCost}
                                onChange={(e) =>
                                  patchRow(row.key, {
                                    unitCost: e.target.value,
                                  })
                                }
                              />
                            ) : (
                              money(Number(row.unitCost))
                            )}
                          </td>
                          <td className='px-2 py-1 text-right'>
                            {editable ? (
                              <Input
                                type='number'
                                min={0}
                                step={0.01}
                                className='h-8 w-28 text-right'
                                placeholder={money(
                                  (Number(row.quantity) || 0) *
                                    (Number(row.unitCost) || 0)
                                )}
                                value={row.amount}
                                onChange={(e) =>
                                  patchRow(row.key, { amount: e.target.value })
                                }
                              />
                            ) : (
                              <span className='tabular-nums'>
                                {money(lineAmount(row))}
                              </span>
                            )}
                          </td>
                          {cost.status !== 'draft' &&
                            cost.status !== 'pending' && (
                              <td className='px-2 py-1 text-right tabular-nums'>
                                {money(row.postedAmount)}
                              </td>
                            )}
                          {editable && (
                            <td className='px-2 py-1'>
                              <button
                                type='button'
                                className='text-destructive'
                                title='Remove line'
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
                            </td>
                          )}
                        </tr>
                      )
                    })}
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={10}
                          className='px-2 py-3 text-center text-muted-foreground'
                        >
                          No lines yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {editable && unCoded > 0 && (
                <p className='text-xs text-amber-700 dark:text-amber-300'>
                  {unCoded} line{unCoded === 1 ? ' has' : 's have'} no cost code
                  or budget line — every line needs one before submission.
                </p>
              )}
            </div>

            <div className='space-y-1'>
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={header.notes}
                onChange={(e) => setField('notes', e.target.value)}
                disabled={!editable}
              />
            </div>

            <AttachmentPanel
              projectId={projectId}
              recordType='direct_cost'
              recordId={cost.id}
              compact
            />

            {(cost.status === 'approved' || cost.status === 'paid') && (
              <div className='space-y-2'>
                <div className='flex flex-wrap items-center gap-2'>
                  <p className='font-medium'>Payments</p>
                  <span className='text-xs text-muted-foreground'>
                    paid {money(cost.paidTotal)} of {money(cost.total)} ·
                    balance {money(cost.balance)}
                  </span>
                </div>
                {(cost.payments?.length ?? 0) > 0 && (
                  <ul
                    className='divide-y rounded-md border text-sm'
                    data-testid='uat-direct-cost-payments'
                  >
                    {cost.payments!.map((payment) => (
                      <li
                        key={payment.id}
                        className='flex flex-wrap items-center gap-2 px-3 py-1.5'
                      >
                        <span className='font-medium tabular-nums'>
                          {money(payment.amount)}
                        </span>
                        <span className='text-xs text-muted-foreground'>
                          {new Date(payment.paidAt).toLocaleDateString()}
                          {payment.method ? ` · ${payment.method}` : ''}
                          {payment.reference ? ` · ${payment.reference}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {cost.status === 'approved' && canPay && (
                  <PaymentForm projectId={projectId} cost={cost} />
                )}
              </div>
            )}

            {rejecting && (
              <div className='space-y-1 rounded-md border p-3'>
                <Label>Why is it returned?</Label>
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <div className='flex gap-2'>
                  <Button
                    size='sm'
                    variant='destructive'
                    disabled={!reason.trim() || busy}
                    onClick={() => act('reject', { reason: reason.trim() })}
                    data-testid='uat-direct-cost-reject-confirm'
                  >
                    Return to draft
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => setRejecting(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className='flex flex-wrap items-center gap-2'>
              {editable && (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={!dirty || busy}
                  onClick={save}
                  data-testid='uat-direct-cost-save'
                >
                  <Save className='mr-2 h-4 w-4' /> Save
                </Button>
              )}
              {cost.status === 'draft' && canSubmit && (
                <Button
                  size='sm'
                  disabled={busy || rows.length === 0}
                  onClick={() => act('submit')}
                  data-testid='uat-direct-cost-submit'
                >
                  <Send className='mr-2 h-4 w-4' /> Submit for approval
                </Button>
              )}
              {cost.status === 'pending' && canApprove && (
                <>
                  <Button
                    size='sm'
                    disabled={busy}
                    onClick={() => act('approve')}
                    data-testid='uat-direct-cost-approve'
                  >
                    <CheckCircle2 className='mr-2 h-4 w-4' /> Approve and post
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={busy}
                    onClick={() => setRejecting(true)}
                    data-testid='uat-direct-cost-reject'
                  >
                    <XCircle className='mr-2 h-4 w-4' /> Return
                  </Button>
                </>
              )}
              {cost.status !== 'void' &&
                canVoid &&
                (cost.payments?.length ?? 0) === 0 && (
                  <Button
                    size='sm'
                    variant='ghost'
                    className='text-destructive'
                    disabled={busy}
                    onClick={() => {
                      const why = window.prompt(
                        'Void this direct cost? Reason:'
                      )
                      if (!why) return
                      act('void', { reason: why })
                    }}
                    data-testid='uat-direct-cost-void'
                  >
                    <Ban className='mr-2 h-4 w-4' /> Void
                  </Button>
                )}
              {cost.status === 'draft' && canDelete && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='ml-auto text-destructive'
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm('Delete this draft?')) return
                    remove.mutate(cost.id, {
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
              entityType='direct_cost'
              entityId={cost.id}
              title='History'
              limit={6}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
