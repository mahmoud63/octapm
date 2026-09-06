import { useEffect, useState } from 'react'
import { Loader2, Plus, Receipt } from 'lucide-react'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useVendors } from '@/features/company/hooks/use-company'
import {
  DIRECT_COST_STATUS_LABEL,
  DIRECT_COST_TYPE_LABEL,
  useCreateDirectCost,
  useDirectCosts,
  type DirectCostStatus,
  type DirectCostType,
} from '../hooks/use-direct-costs'
import { DC_STATUS_CLASS, DirectCostDialog } from './direct-cost-dialog'

const ALL = '__all__'
const NONE = '__none__'
const money = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 0 })
const today = () => new Date().toISOString().slice(0, 10)

function NewDirectCostDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const create = useCreateDirectCost(projectId)
  const { data: vendors } = useVendors({}, { enabled: open })
  const [type, setType] = useState<DirectCostType>('invoice')
  const [description, setDescription] = useState('')
  const [vendorCompanyId, setVendorCompanyId] = useState(NONE)
  const [vendorName, setVendorName] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [costDate, setCostDate] = useState(today())
  const [dueDate, setDueDate] = useState('')
  useEffect(() => {
    if (!open) return
    setType('invoice')
    setDescription('')
    setVendorCompanyId(NONE)
    setVendorName('')
    setInvoiceNumber('')
    setCostDate(today())
    setDueDate('')
  }, [open])
  const submit = async () => {
    try {
      const created = await create.mutateAsync({
        type,
        description: description.trim(),
        vendorCompanyId: vendorCompanyId === NONE ? null : vendorCompanyId,
        vendorName: vendorName.trim() || null,
        invoiceNumber: invoiceNumber.trim() || null,
        costDate,
        dueDate: dueDate || null,
      })
      onOpenChange(false)
      onCreated(created.id)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg' data-testid='uat-direct-cost-new'>
        <DialogHeader>
          <DialogTitle>New direct cost</DialogTitle>
          <DialogDescription>
            An invoice, expense or payroll cost that does not run through a
            commitment. Add the lines next.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1'>
            <Label>Type</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as DirectCostType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DIRECT_COST_TYPE_LABEL) as DirectCostType[]).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {DIRECT_COST_TYPE_LABEL[value]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>Vendor (directory)</Label>
            <Select value={vendorCompanyId} onValueChange={setVendorCompanyId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— not in the directory —</SelectItem>
                {(vendors?.items ?? []).map((vendor) => (
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
              value={vendorName}
              onChange={(event) => setVendorName(event.target.value)}
              placeholder='If not in the directory'
            />
          </div>
          <div className='space-y-1'>
            <Label>Invoice number</Label>
            <Input
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
            />
          </div>
          <div className='space-y-1'>
            <Label>Cost date</Label>
            <Input
              type='date'
              value={costDate}
              onChange={(event) => setCostDate(event.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label>Due date</Label>
            <Input
              type='date'
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!description.trim() || !costDate || create.isPending}
            onClick={submit}
            data-testid='uat-direct-cost-create'
          >
            {create.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Cost Control › Direct Costs: the register with balances and the cost workspace. */
export function DirectCostsPanel({
  projectId,
  initialRecordId,
}: {
  projectId: string
  initialRecordId?: string
}) {
  const canCreate = useCanPerform('cost', 'create')
  const [status, setStatus] = useState(ALL)
  const [type, setType] = useState(ALL)
  const [q, setQ] = useState('')
  const { data, isLoading } = useDirectCosts(projectId, {
    status: status === ALL ? undefined : status,
    type: type === ALL ? undefined : type,
    q,
  })
  const [openId, setOpenId] = useState<string | null>(initialRecordId ?? null)
  const [creating, setCreating] = useState(false)
  const summary = data?.summary

  return (
    <div className='space-y-3' data-testid='uat-direct-costs'>
      <div className='flex flex-wrap items-center gap-2'>
        <Receipt className='h-5 w-5' />
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>Direct costs</p>
          <p className='text-xs text-muted-foreground'>
            Invoices, expenses and payroll outside commitments — approved costs
            post to the budget lines and activities; payments feed the cash
            flow.
          </p>
        </div>
        {canCreate && (
          <Button
            size='sm'
            onClick={() => setCreating(true)}
            data-testid='uat-direct-costs-new'
          >
            <Plus className='mr-2 h-4 w-4' /> New direct cost
          </Button>
        )}
      </div>

      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'>
        {(
          [
            ['Recorded', summary ? money(summary.total) : '—', 'all but void'],
            [
              'Waiting',
              summary ? String(summary.pendingApproval) : '—',
              'for approval',
            ],
            [
              'Approved',
              summary
                ? money(
                    summary.byStatus.approved.total +
                      summary.byStatus.paid.total
                  )
                : '—',
              'posted to budget',
            ],
            ['Paid', summary ? money(summary.paid) : '—', 'to date'],
            [
              'Unpaid',
              summary ? money(summary.unpaid) : '—',
              'approved balance',
            ],
            [
              'Overdue',
              summary ? money(summary.overdue) : '—',
              'past due date',
            ],
          ] as const
        ).map(([label, value, hint]) => (
          <div key={label} className='rounded border p-3'>
            <p className='text-xs text-muted-foreground'>{label}</p>
            <p className='text-2xl font-bold tabular-nums'>{value}</p>
            <p className='text-[11px] text-muted-foreground'>{hint}</p>
          </div>
        ))}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Input
          className='w-56'
          placeholder='Search ref, vendor, invoice'
          value={q}
          onChange={(event) => setQ(event.target.value)}
          data-testid='uat-direct-costs-search'
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className='w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(DIRECT_COST_STATUS_LABEL) as DirectCostStatus[]).map(
              (value) => (
                <SelectItem key={value} value={value}>
                  {DIRECT_COST_STATUS_LABEL[value]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className='w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {(Object.keys(DIRECT_COST_TYPE_LABEL) as DirectCostType[]).map(
              (value) => (
                <SelectItem key={value} value={value}>
                  {DIRECT_COST_TYPE_LABEL[value]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading…
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
          No direct cost recorded yet.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50 text-xs text-muted-foreground'>
              <tr>
                <th className='px-2 py-1 text-left'>Ref</th>
                <th className='px-2 py-1 text-left'>Type</th>
                <th className='px-2 py-1 text-left'>Vendor</th>
                <th className='px-2 py-1 text-left'>Invoice</th>
                <th className='px-2 py-1 text-left'>Description</th>
                <th className='px-2 py-1 text-left'>Date</th>
                <th className='px-2 py-1 text-left'>Due</th>
                <th className='px-2 py-1 text-right'>Total</th>
                <th className='px-2 py-1 text-right'>Balance</th>
                <th className='px-2 py-1 text-left'>Status</th>
              </tr>
            </thead>
            <tbody data-testid='uat-direct-costs-rows'>
              {data!.items.map((cost) => (
                <tr
                  key={cost.id}
                  className='cursor-pointer border-t hover:bg-muted/40'
                  onClick={() => setOpenId(cost.id)}
                >
                  <td className='px-2 py-1 font-mono text-xs'>{cost.ref}</td>
                  <td className='px-2 py-1 text-xs'>
                    {DIRECT_COST_TYPE_LABEL[cost.type]}
                  </td>
                  <td className='px-2 py-1'>{cost.vendorName ?? '—'}</td>
                  <td className='px-2 py-1 font-mono text-xs'>
                    {cost.invoiceNumber ?? '—'}
                  </td>
                  <td className='max-w-64 truncate px-2 py-1'>
                    {cost.description}
                  </td>
                  <td className='px-2 py-1 font-mono text-xs'>
                    {cost.costDate}
                  </td>
                  <td
                    className={`px-2 py-1 font-mono text-xs ${cost.overdue ? 'text-rose-600 dark:text-rose-300' : ''}`}
                  >
                    {cost.dueDate ?? '—'}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {money(cost.total)}
                  </td>
                  <td className='px-2 py-1 text-right tabular-nums'>
                    {cost.status === 'approved' || cost.status === 'paid'
                      ? money(cost.balance)
                      : '·'}
                  </td>
                  <td className='px-2 py-1'>
                    <Badge
                      variant='outline'
                      className={DC_STATUS_CLASS[cost.status]}
                    >
                      {DIRECT_COST_STATUS_LABEL[cost.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewDirectCostDialog
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => setOpenId(id)}
      />
      <DirectCostDialog
        projectId={projectId}
        directCostId={openId}
        open={Boolean(openId)}
        onOpenChange={(value) => {
          if (!value) setOpenId(null)
        }}
      />
    </div>
  )
}
