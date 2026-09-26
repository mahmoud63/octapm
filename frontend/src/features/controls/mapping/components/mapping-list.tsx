import { useMemo, useState } from 'react'
import { Check, Pencil, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  hasMoneyPrecision,
  MONEY_INPUT_STEP,
  MONEY_PRECISION_MESSAGE,
  toMoneyNumber,
} from '@/lib/money'
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
import { Textarea } from '@/components/ui/textarea'
import {
  useApproveActivityBoqAllocation,
  useRejectActivityBoqAllocation,
  useSubmitActivityBoqAllocation,
  useUpdateActivityBoqAllocation,
} from '@/features/boq/hooks/use-boq'
import {
  ruleLabel,
  statusLabel,
  type AllocationStatus,
  type MappingAllocation,
  type MappingRule,
} from '../hooks/use-mapping'

/**
 * The list view: every allocation row with inline edit of a draft's
 * quantity or amount (no window.prompt), filters by status, source and the
 * item's mapping rule, and the lifecycle actions with a proper reject
 * dialog. A row's warnings from its last write are shown beside it.
 */

type Props = {
  projectId: string
  allocations: MappingAllocation[]
  currency: string
  isLoading: boolean
}

const fmtMoney = (currency: string, value: number) =>
  `${currency} ${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`

const fmtNumber = (value: number) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })

const statusVariant: Record<
  AllocationStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  submitted: 'secondary',
  approved: 'default',
  rejected: 'destructive',
}

const ALL = '__all__'

type EditState = { id: string; quantity: string; amount: string }

export function MappingList({
  projectId,
  allocations,
  currency,
  isLoading,
}: Props) {
  const updateAllocation = useUpdateActivityBoqAllocation(projectId)
  const submitAllocation = useSubmitActivityBoqAllocation(projectId)
  const approveAllocation = useApproveActivityBoqAllocation(projectId)
  const rejectAllocation = useRejectActivityBoqAllocation(projectId)
  const canUpdate = useCanPerform('boq', 'update', 'allocation.update')
  const canSubmit = useCanPerform('boq', 'submit', 'allocation.submit')
  const canApprove = useCanPerform('boq', 'approve', 'allocation.approve')
  const canReject = useCanPerform('boq', 'approve', 'allocation.reject')

  const [status, setStatus] = useState<string>(ALL)
  const [source, setSource] = useState<string>(ALL)
  const [rule, setRule] = useState<string>(ALL)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [rejecting, setRejecting] = useState<MappingAllocation | null>(null)
  const [reason, setReason] = useState('')

  const rows = useMemo(
    () =>
      allocations.filter(
        (row) =>
          (status === ALL || row.status === status) &&
          (source === ALL || row.source === source) &&
          (rule === ALL || row.boqItem?.mappingRule === rule)
      ),
    [allocations, status, source, rule]
  )

  const sources = useMemo(
    () => [...new Set(allocations.map((row) => row.source))].sort(),
    [allocations]
  )

  const startEdit = (row: MappingAllocation) =>
    setEditing({
      id: row.id,
      quantity: String(row.quantity),
      amount: String(row.amount),
    })

  const saveEdit = async (row: MappingAllocation) => {
    if (!editing) return
    const payload: { quantity?: number; amount?: number } = {}
    const qtyChanged = Number(editing.quantity) !== row.quantity
    const amountChanged = Number(editing.amount) !== row.amount
    if (amountChanged) {
      if (!hasMoneyPrecision(editing.amount)) {
        toast.error(MONEY_PRECISION_MESSAGE)
        return
      }
      payload.amount = toMoneyNumber(editing.amount)
    } else if (qtyChanged) {
      payload.quantity = Number(editing.quantity)
    }
    if (Object.keys(payload).length === 0) {
      setEditing(null)
      return
    }
    await updateAllocation.mutateAsync({ allocationId: row.id, data: payload })
    setEditing(null)
  }

  const submitReject = async () => {
    if (!rejecting || !reason.trim()) return
    await rejectAllocation.mutateAsync({
      allocationId: rejecting.id,
      reason: reason.trim(),
    })
    setRejecting(null)
    setReason('')
  }

  return (
    <div data-testid='uat-mapping-list'>
      <div className='flex flex-wrap items-center gap-2 border-b p-3'>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className='w-36' data-testid='uat-mapping-filter-status'>
            <SelectValue placeholder='Status' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(statusLabel) as AllocationStatus[]).map((key) => (
              <SelectItem key={key} value={key}>
                {statusLabel[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className='w-36'>
            <SelectValue placeholder='Source' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sources</SelectItem>
            {sources.map((key) => (
              <SelectItem key={key} value={key}>
                {key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={rule} onValueChange={setRule}>
          <SelectTrigger className='w-36'>
            <SelectValue placeholder='Rule' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All rules</SelectItem>
            {(Object.keys(ruleLabel) as MappingRule[]).map((key) => (
              <SelectItem key={key} value={key}>
                {ruleLabel[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className='ml-auto text-xs text-muted-foreground'>
          {rows.length} of {allocations.length} rows
        </span>
      </div>

      {isLoading ? (
        <div className='p-4 text-sm text-muted-foreground'>Loading...</div>
      ) : rows.length === 0 ? (
        <div className='p-4 text-sm text-muted-foreground'>
          No allocations match these filters.
        </div>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead className='border-b bg-muted/40 text-xs text-muted-foreground'>
              <tr>
                <th className='px-3 py-2 text-left font-medium'>BOQ</th>
                <th className='px-3 py-2 text-left font-medium'>Activity</th>
                <th className='px-3 py-2 text-right font-medium'>Qty</th>
                <th className='px-3 py-2 text-right font-medium'>Amount</th>
                <th className='px-3 py-2 text-right font-medium'>Weight</th>
                <th className='px-3 py-2 text-left font-medium'>Basis</th>
                <th className='px-3 py-2 text-left font-medium'>Source</th>
                <th className='px-3 py-2 text-center font-medium'>Status</th>
                <th className='px-3 py-2 text-right font-medium'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isEditing = editing?.id === row.id
                return (
                  <tr
                    key={row.id}
                    className='border-b last:border-b-0'
                    data-testid={`uat-mapping-row-${row.id}`}
                  >
                    <td className='max-w-64 px-3 py-2'>
                      <div className='flex items-center gap-1'>
                        <span className='truncate font-medium'>
                          {row.boqItem?.code || 'BOQ'}
                        </span>
                        {row.boqItem?.mappingRule &&
                          row.boqItem.mappingRule !== 'required' && (
                            <Badge variant='outline' className='text-[10px]'>
                              {ruleLabel[row.boqItem.mappingRule]}
                            </Badge>
                          )}
                      </div>
                      <div className='truncate text-xs text-muted-foreground'>
                        {row.boqItem?.description}
                      </div>
                    </td>
                    <td className='max-w-72 px-3 py-2'>
                      <div className='truncate font-medium'>
                        {row.activity?.activityId}
                      </div>
                      <div className='truncate text-xs text-muted-foreground'>
                        {row.activity?.name}
                      </div>
                    </td>
                    <td className='px-3 py-2 text-right tabular-nums'>
                      {isEditing ? (
                        <Input
                          type='number'
                          min='0'
                          step='0.001'
                          className='h-8 w-28 text-right'
                          value={editing.quantity}
                          onChange={(event) =>
                            setEditing({ ...editing, quantity: event.target.value })
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveEdit(row)
                            if (event.key === 'Escape') setEditing(null)
                          }}
                          data-testid='uat-mapping-edit-quantity'
                        />
                      ) : (
                        fmtNumber(row.quantity)
                      )}
                    </td>
                    <td className='px-3 py-2 text-right tabular-nums'>
                      {isEditing ? (
                        <Input
                          type='number'
                          min='0'
                          step={MONEY_INPUT_STEP}
                          className='h-8 w-32 text-right'
                          value={editing.amount}
                          onChange={(event) =>
                            setEditing({ ...editing, amount: event.target.value })
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveEdit(row)
                            if (event.key === 'Escape') setEditing(null)
                          }}
                          data-testid='uat-mapping-edit-amount'
                        />
                      ) : (
                        fmtMoney(currency, row.amount)
                      )}
                    </td>
                    <td className='px-3 py-2 text-right tabular-nums'>
                      {fmtNumber(row.weight)}%
                    </td>
                    <td className='px-3 py-2 text-xs'>{row.basis}</td>
                    <td className='px-3 py-2 text-xs'>
                      {row.source}
                      {row.suggestedBy && (
                        <span
                          className='ml-1 text-muted-foreground'
                          title={
                            row.confidence != null
                              ? `confidence ${Math.round(row.confidence * 100)}%`
                              : undefined
                          }
                        >
                          · {row.suggestedBy}
                        </span>
                      )}
                    </td>
                    <td className='px-3 py-2 text-center'>
                      <Badge variant={statusVariant[row.status]}>
                        {statusLabel[row.status] ?? row.status}
                      </Badge>
                      {row.warnings && row.warnings.length > 0 && (
                        <div
                          className='mt-1 text-[10px] text-amber-600'
                          title={row.warnings.map((w) => w.message).join('\n')}
                        >
                          {row.warnings.length} warning
                          {row.warnings.length === 1 ? '' : 's'}
                        </div>
                      )}
                    </td>
                    <td className='px-3 py-2'>
                      <div className='flex justify-end gap-1'>
                        {row.status === 'draft' && isEditing && (
                          <>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='size-8 text-green-600'
                              onClick={() => void saveEdit(row)}
                              disabled={updateAllocation.isPending}
                              title='Save'
                              data-testid='uat-mapping-edit-save'
                            >
                              <Check className='h-4 w-4' />
                            </Button>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='size-8'
                              onClick={() => setEditing(null)}
                              title='Cancel'
                            >
                              <X className='h-4 w-4' />
                            </Button>
                          </>
                        )}
                        {row.status === 'draft' && !isEditing && (
                          <>
                            {canUpdate && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='size-8'
                                onClick={() => startEdit(row)}
                                title='Edit allocation'
                                data-testid='uat-mapping-edit'
                              >
                                <Pencil className='h-4 w-4' />
                              </Button>
                            )}
                            {canSubmit && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='size-8'
                                onClick={() => submitAllocation.mutate(row.id)}
                                title='Submit allocation'
                                data-testid='uat-mapping-submit'
                              >
                                <Send className='h-4 w-4' />
                              </Button>
                            )}
                          </>
                        )}
                        {row.status === 'submitted' && (
                          <>
                            {canApprove && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='size-8 text-green-600'
                                onClick={() => approveAllocation.mutate(row.id)}
                                title='Approve allocation'
                                data-testid='uat-mapping-approve'
                              >
                                <Check className='h-4 w-4' />
                              </Button>
                            )}
                            {canReject && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='size-8 text-destructive'
                                onClick={() => setRejecting(row)}
                                title='Reject allocation'
                                data-testid='uat-mapping-reject'
                              >
                                <X className='h-4 w-4' />
                              </Button>
                            )}
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
      )}

      <Dialog
        open={Boolean(rejecting)}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null)
            setReason('')
          }
        }}
      >
        <DialogContent data-testid='uat-mapping-reject-dialog'>
          <DialogHeader>
            <DialogTitle>Reject allocation</DialogTitle>
            <DialogDescription>
              {rejecting?.boqItem?.code} → {rejecting?.activity?.activityId}.
              The row is retired and its value returns to the item's
              unallocated balance.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='mapping-reject-reason'>Reason</Label>
            <Textarea
              id='mapping-reject-reason'
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder='Why this allocation is wrong'
              className={cn('min-h-20')}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => void submitReject()}
              disabled={!reason.trim() || rejectAllocation.isPending}
              data-testid='uat-mapping-reject-confirm'
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
