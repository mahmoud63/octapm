import { useState } from 'react'
import {
  CheckCircle2,
  Download,
  FileSignature,
  Loader2,
  Plus,
  RotateCcw,
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
import { useActivities } from '@/features/activities/hooks/use-activities'
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { CommentThread } from '@/features/comments/components/comment-thread'
import { useVendors } from '@/features/company/hooks/use-company'
import { useProjectCostCodes } from '@/features/cost/hooks/use-budget'
import { WorkflowInstancePanel } from '@/features/workflows/components/workflow-instance-panel'
import {
  COMMITMENT_STATUS_LABEL,
  INSURANCE_LABEL,
  INSURANCE_TYPES,
  downloadCommitmentPdf,
  useCommitment,
  useCommitmentAction,
  useCommitmentChangeOrderAction,
  useCreateCommitment,
  useCreateCommitmentChangeOrder,
  useExecuteCommitment,
  useReplaceCommitmentLines,
  useSetCommitmentInsurance,
  useUpdateCommitment,
  useVoidCommitment,
  type Commitment,
  type CommitmentInsurance,
  type CommitmentLineInput,
  type CommitmentType,
  type InsuranceType,
} from '../hooks/use-commitments'

const NONE = '__none'

const statusTone = (status: Commitment['status']) =>
  ({
    draft: '',
    pending: 'bg-sky-600 text-white',
    approved: 'bg-indigo-600 text-white',
    executed: 'bg-emerald-600 text-white',
    closed: 'bg-slate-600 text-white',
    void: 'bg-red-600 text-white',
  })[status]

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : '—'

type LineDraft = {
  description: string
  costCodeId: string
  activityId: string
  unit: string
  qty: string
  rate: string
  amount: string
}

const emptyLine = (): LineDraft => ({
  description: '',
  costCodeId: '',
  activityId: '',
  unit: '',
  qty: '1',
  rate: '',
  amount: '',
})

const lineAmount = (line: LineDraft) => {
  if (line.amount.trim() !== '') return Number(line.amount) || 0
  return (Number(line.qty) || 0) * (Number(line.rate) || 0)
}

const toLineInput = (line: LineDraft, index: number): CommitmentLineInput => ({
  lineNumber: index + 1,
  description: line.description.trim(),
  costCodeId: line.costCodeId || null,
  activityId: line.activityId || null,
  unit: line.unit.trim() || null,
  qty: Number(line.qty) || 1,
  rate: line.rate.trim() === '' ? null : Number(line.rate),
  amount: line.amount.trim() === '' ? null : Number(line.amount),
})

function SovEditor({
  projectId,
  lines,
  onChange,
  formatMoney,
  readOnly = false,
}: {
  projectId: string
  lines: LineDraft[]
  onChange: (next: LineDraft[]) => void
  formatMoney: (value: number) => string
  readOnly?: boolean
}) {
  const { data: codes } = useProjectCostCodes(projectId)
  const { data: activities } = useActivities(projectId)
  const total = lines.reduce((sum, line) => sum + lineAmount(line), 0)
  const set = (index: number, patch: Partial<LineDraft>) =>
    onChange(
      lines.map((line, i) => (i === index ? { ...line, ...patch } : line))
    )
  return (
    <div className='space-y-2' data-testid='uat-commitment-sov'>
      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-xs'>
          <thead className='bg-muted/40'>
            <tr>
              <th className='p-1 text-left'>#</th>
              <th className='p-1 text-left'>Description</th>
              <th className='p-1 text-left'>Cost code</th>
              <th className='p-1 text-left'>Activity</th>
              <th className='p-1 text-right'>Qty</th>
              <th className='p-1 text-left'>Unit</th>
              <th className='p-1 text-right'>Rate</th>
              <th className='p-1 text-right'>Amount</th>
              {!readOnly && <th />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className='border-t align-top'>
                <td className='p-1 tabular-nums'>{index + 1}</td>
                <td className='p-1'>
                  <Input
                    className='h-7 min-w-40 text-xs'
                    value={line.description}
                    disabled={readOnly}
                    onChange={(e) =>
                      set(index, { description: e.target.value })
                    }
                    placeholder='Scope item'
                  />
                </td>
                <td className='p-1'>
                  <Select
                    value={line.costCodeId || NONE}
                    disabled={readOnly}
                    onValueChange={(value) =>
                      set(index, { costCodeId: value === NONE ? '' : value })
                    }
                  >
                    <SelectTrigger
                      className='h-7 w-40 text-xs'
                      aria-label='Cost code'
                    >
                      <SelectValue placeholder='—' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {(codes?.available ?? []).map((code) => (
                        <SelectItem key={code.id} value={code.id}>
                          {code.code} · {code.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className='p-1'>
                  <Select
                    value={line.activityId || NONE}
                    disabled={readOnly}
                    onValueChange={(value) =>
                      set(index, { activityId: value === NONE ? '' : value })
                    }
                  >
                    <SelectTrigger
                      className='h-7 w-44 text-xs'
                      aria-label='Activity'
                    >
                      <SelectValue placeholder='—' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {(activities ?? [])
                        .filter((activity) => !activity.isMilestone)
                        .map((activity) => (
                          <SelectItem key={activity.id} value={activity.id}>
                            {activity.wbsCode ? `${activity.wbsCode} · ` : ''}
                            {activity.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className='p-1'>
                  <Input
                    type='number'
                    step='0.01'
                    className='h-7 w-20 text-right text-xs'
                    value={line.qty}
                    disabled={readOnly}
                    onChange={(e) => set(index, { qty: e.target.value })}
                  />
                </td>
                <td className='p-1'>
                  <Input
                    className='h-7 w-16 text-xs'
                    value={line.unit}
                    disabled={readOnly}
                    onChange={(e) => set(index, { unit: e.target.value })}
                  />
                </td>
                <td className='p-1'>
                  <Input
                    type='number'
                    step='0.01'
                    className='h-7 w-24 text-right text-xs'
                    value={line.rate}
                    disabled={readOnly}
                    onChange={(e) =>
                      set(index, { rate: e.target.value, amount: '' })
                    }
                  />
                </td>
                <td className='p-1'>
                  <Input
                    type='number'
                    step='0.01'
                    className='h-7 w-28 text-right text-xs'
                    value={line.amount}
                    disabled={readOnly}
                    placeholder={formatMoney(lineAmount(line))}
                    onChange={(e) => set(index, { amount: e.target.value })}
                  />
                </td>
                {!readOnly && (
                  <td className='p-1'>
                    <Button
                      size='icon'
                      variant='ghost'
                      className='h-7 w-7'
                      aria-label='Remove line'
                      onClick={() =>
                        onChange(lines.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 className='h-3.5 w-3.5' />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className='border-t bg-muted/20 font-medium'>
              <td className='p-1' colSpan={7}>
                {lines.length} line{lines.length === 1 ? '' : 's'}
              </td>
              <td className='p-1 text-right tabular-nums'>
                {formatMoney(total)}
              </td>
              {!readOnly && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
      {!readOnly && (
        <Button
          size='sm'
          variant='outline'
          onClick={() => onChange([...lines, emptyLine()])}
          data-testid='uat-commitment-line-add'
        >
          <Plus className='mr-1 h-4 w-4' /> Add line
        </Button>
      )}
    </div>
  )
}

/** New subcontract or purchase-order commitment with its schedule of values. */
export function CommitmentCreateDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
  formatMoney,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (commitment: Commitment) => void
  formatMoney: (value: number) => string
}) {
  const create = useCreateCommitment(projectId)
  const { data: vendors } = useVendors({}, { enabled: open })
  const [type, setType] = useState<CommitmentType>('subcontract')
  const [title, setTitle] = useState('')
  const [vendorCompanyId, setVendorCompanyId] = useState('')
  const [retentionRate, setRetentionRate] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const validLines = lines.filter((line) => line.description.trim())
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-4xl'
        data-testid='uat-commitment-create'
      >
        <DialogHeader>
          <DialogTitle>New commitment</DialogTitle>
          <DialogDescription>
            Saved as a draft. Submit it for approval once the schedule of values
            and vendor are set; execute it with the signed agreement.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 md:grid-cols-3'>
          <div className='space-y-1'>
            <Label>Type</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as CommitmentType)}
            >
              <SelectTrigger data-testid='uat-commitment-type'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='subcontract'>Subcontract</SelectItem>
                <SelectItem value='purchase_order'>Purchase order</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1 md:col-span-2'>
            <Label htmlFor='cm-title'>Title</Label>
            <Input
              id='cm-title'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. Concrete works package'
              data-testid='uat-commitment-title'
            />
          </div>
          <div className='space-y-1 md:col-span-2'>
            <Label>Vendor</Label>
            <Select
              value={vendorCompanyId || NONE}
              onValueChange={(value) =>
                setVendorCompanyId(value === NONE ? '' : value)
              }
            >
              <SelectTrigger data-testid='uat-commitment-vendor'>
                <SelectValue placeholder='Pick a vendor from the company list' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No vendor yet</SelectItem>
                {(vendors?.items ?? []).map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                    {vendor.trades?.length
                      ? ` · ${vendor.trades.slice(0, 2).join(', ')}`
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='cm-retention'>Retention %</Label>
            <Input
              id='cm-retention'
              type='number'
              step='0.5'
              min={0}
              max={100}
              value={retentionRate}
              onChange={(e) => setRetentionRate(e.target.value)}
              placeholder='project default'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='cm-start'>Start</Label>
            <Input
              id='cm-start'
              type='date'
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='cm-end'>End</Label>
            <Input
              id='cm-end'
              type='date'
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='cm-terms'>Payment terms</Label>
            <Input
              id='cm-terms'
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder='e.g. 30 days from certification'
            />
          </div>
          <div className='space-y-1 md:col-span-3'>
            <Label htmlFor='cm-description'>Scope</Label>
            <Textarea
              id='cm-description'
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className='space-y-1'>
          <Label>Schedule of values</Label>
          <SovEditor
            projectId={projectId}
            lines={lines}
            onChange={setLines}
            formatMoney={formatMoney}
          />
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending || !title.trim()}
            data-testid='uat-commitment-create-submit'
            onClick={async () => {
              try {
                const created = await create.mutateAsync({
                  type,
                  title: title.trim(),
                  vendorCompanyId: vendorCompanyId || null,
                  retentionRate:
                    retentionRate.trim() === '' ? null : Number(retentionRate),
                  paymentTerms: paymentTerms.trim() || null,
                  startDate: startDate || null,
                  endDate: endDate || null,
                  description: description.trim() || null,
                  lines: validLines.map(toLineInput),
                })
                toast.success(`${created.ref} created`)
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
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InsuranceEditor({
  projectId,
  commitment,
  canEdit,
}: {
  projectId: string
  commitment: Commitment
  canEdit: boolean
}) {
  const save = useSetCommitmentInsurance(projectId)
  const [rows, setRows] = useState<CommitmentInsurance[]>(commitment.insurance)
  const [editing, setEditing] = useState(false)
  const statusTone = (status?: string) =>
    status === 'ok'
      ? 'default'
      : status === 'optional'
        ? 'outline'
        : 'destructive'
  if (!editing) {
    return (
      <div className='space-y-1' data-testid='uat-commitment-insurance'>
        <div className='flex items-center justify-between'>
          <p className='text-sm font-medium'>Insurance and bonds</p>
          {canEdit && (
            <Button size='sm' variant='ghost' onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        {commitment.insurance.length === 0 ? (
          <p className='text-xs text-muted-foreground'>
            No requirements set — execution will not wait for certificates.
          </p>
        ) : (
          <ul className='space-y-1 text-sm'>
            {commitment.insurance.map((entry, index) => (
              <li key={index} className='flex flex-wrap items-center gap-2'>
                <span>{entry.label || INSURANCE_LABEL[entry.type]}</span>
                <Badge variant={statusTone(entry.status)}>{entry.status}</Badge>
                {entry.expiresAt && (
                  <span className='text-xs text-muted-foreground'>
                    expires {formatDate(entry.expiresAt)}
                  </span>
                )}
                {!entry.documentId && entry.required && (
                  <span className='text-xs text-muted-foreground'>
                    · attach the certificate under Evidence, then set its
                    document id here
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  return (
    <div
      className='space-y-2 rounded-md border p-3'
      data-testid='uat-commitment-insurance-edit'
    >
      <p className='text-sm font-medium'>Insurance and bonds</p>
      {rows.map((row, index) => (
        <div
          key={index}
          className='grid gap-2 md:grid-cols-[160px_minmax(0,1fr)_auto_140px_auto] md:items-center'
        >
          <Select
            value={row.type}
            onValueChange={(value) =>
              setRows(
                rows.map((r, i) =>
                  i === index ? { ...r, type: value as InsuranceType } : r
                )
              )
            }
          >
            <SelectTrigger className='h-8 text-xs' aria-label='Cover'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INSURANCE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {INSURANCE_LABEL[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className='h-8 text-xs'
            placeholder='Document id (from Evidence)'
            value={row.documentId ?? ''}
            onChange={(e) =>
              setRows(
                rows.map((r, i) =>
                  i === index
                    ? { ...r, documentId: e.target.value.trim() || null }
                    : r
                )
              )
            }
          />
          <div className='flex items-center gap-1'>
            <Switch
              checked={row.required}
              onCheckedChange={(checked) =>
                setRows(
                  rows.map((r, i) =>
                    i === index ? { ...r, required: checked } : r
                  )
                )
              }
            />
            <span className='text-xs'>required</span>
          </div>
          <Input
            className='h-8 text-xs'
            type='date'
            value={row.expiresAt?.slice(0, 10) ?? ''}
            onChange={(e) =>
              setRows(
                rows.map((r, i) =>
                  i === index ? { ...r, expiresAt: e.target.value || null } : r
                )
              )
            }
          />
          <Button
            size='icon'
            variant='ghost'
            className='h-7 w-7'
            aria-label='Remove'
            onClick={() => setRows(rows.filter((_, i) => i !== index))}
          >
            <Trash2 className='h-3.5 w-3.5' />
          </Button>
        </div>
      ))}
      <div className='flex gap-2'>
        <Button
          size='sm'
          variant='outline'
          onClick={() =>
            setRows([
              ...rows,
              {
                type: 'general_liability',
                label: null,
                required: true,
                documentId: null,
                expiresAt: null,
                note: null,
              },
            ])
          }
        >
          <Plus className='mr-1 h-4 w-4' /> Add cover
        </Button>
        <div className='ml-auto flex gap-2'>
          <Button size='sm' variant='outline' onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            size='sm'
            disabled={save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync({
                  commitmentId: commitment.id,
                  insurance: rows,
                })
                toast.success('Insurance requirements saved')
                setEditing(false)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

function LinesSection({
  projectId,
  commitment,
  canEdit,
  formatMoney,
}: {
  projectId: string
  commitment: Commitment
  canEdit: boolean
  formatMoney: (value: number) => string
}) {
  const replace = useReplaceCommitmentLines(projectId)
  const [editing, setEditing] = useState(false)
  const [lines, setLines] = useState<LineDraft[]>([])
  const editable = canEdit && ['draft', 'pending'].includes(commitment.status)
  if (!editing) {
    return (
      <div className='space-y-1'>
        <div className='flex items-center justify-between'>
          <p className='text-sm font-medium'>Schedule of values</p>
          {editable && (
            <Button
              size='sm'
              variant='ghost'
              data-testid='uat-commitment-lines-edit'
              onClick={() => {
                setLines(
                  commitment.lines.length
                    ? commitment.lines.map((line) => ({
                        description: line.description,
                        costCodeId: line.costCodeId ?? '',
                        activityId: line.activityId ?? '',
                        unit: line.unit ?? '',
                        qty: String(line.qty),
                        rate: String(line.rate),
                        amount: '',
                      }))
                    : [emptyLine()]
                )
                setEditing(true)
              }}
            >
              Edit lines
            </Button>
          )}
        </div>
        {commitment.lines.length === 0 ? (
          <p className='text-xs text-muted-foreground'>No lines yet.</p>
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full text-xs'>
              <thead className='bg-muted/40'>
                <tr>
                  <th className='p-1 text-left'>#</th>
                  <th className='p-1 text-left'>Description</th>
                  <th className='p-1 text-left'>Cost code</th>
                  <th className='p-1 text-left'>Activity</th>
                  <th className='p-1 text-right'>Qty</th>
                  <th className='p-1 text-right'>Rate</th>
                  <th className='p-1 text-right'>Amount</th>
                </tr>
              </thead>
              <tbody>
                {commitment.lines.map((line) => (
                  <tr key={line.id ?? line.lineNumber} className='border-t'>
                    <td className='p-1 tabular-nums'>{line.lineNumber}</td>
                    <td className='p-1'>{line.description}</td>
                    <td className='p-1 font-mono'>
                      {line.costCode?.code ?? '—'}
                    </td>
                    <td className='p-1'>
                      {line.activity
                        ? `${line.activity.code ? `${line.activity.code} · ` : ''}${line.activity.name}`
                        : '—'}
                    </td>
                    <td className='p-1 text-right tabular-nums'>
                      {line.qty} {line.unit ?? ''}
                    </td>
                    <td className='p-1 text-right tabular-nums'>
                      {formatMoney(line.rate)}
                    </td>
                    <td className='p-1 text-right tabular-nums'>
                      {formatMoney(line.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!editable &&
          commitment.status !== 'draft' &&
          commitment.status !== 'pending' && (
            <p className='text-xs text-muted-foreground'>
              Lines are fixed once approved — raise a change order for changes.
            </p>
          )}
      </div>
    )
  }
  return (
    <div className='space-y-2'>
      <SovEditor
        projectId={projectId}
        lines={lines}
        onChange={setLines}
        formatMoney={formatMoney}
      />
      <div className='flex justify-end gap-2'>
        <Button size='sm' variant='outline' onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button
          size='sm'
          disabled={replace.isPending}
          data-testid='uat-commitment-lines-save'
          onClick={async () => {
            try {
              await replace.mutateAsync({
                commitmentId: commitment.id,
                lines: lines
                  .filter((line) => line.description.trim())
                  .map(toLineInput),
              })
              toast.success('Schedule of values saved')
              setEditing(false)
            } catch (error) {
              toast.error(getServerErrorMessage(error))
            }
          }}
        >
          Save lines
        </Button>
      </div>
    </div>
  )
}

function ChangeOrdersSection({
  projectId,
  commitment,
  canCreate,
  canSubmit,
  canApprove,
  formatMoney,
}: {
  projectId: string
  commitment: Commitment
  canCreate: boolean
  canSubmit: boolean
  canApprove: boolean
  formatMoney: (value: number) => string
}) {
  const create = useCreateCommitmentChangeOrder(projectId)
  const act = useCommitmentChangeOrderAction(projectId)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [value, setValue] = useState('')
  const run = async (
    changeOrderId: string,
    action: 'submit' | 'approve' | 'reject' | 'void'
  ) => {
    let reason: string | undefined
    if (action === 'reject' || action === 'void') {
      reason =
        window.prompt(
          action === 'reject' ? 'Why is it rejected?' : 'Why void it?'
        ) ?? ''
      if (!reason.trim()) return
    }
    try {
      await act.mutateAsync({ changeOrderId, action, reason })
      toast.success(
        `Change order ${action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'voided'}`
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <div className='space-y-2' data-testid='uat-commitment-change-orders'>
      <div className='flex items-center justify-between'>
        <p className='text-sm font-medium'>Change orders</p>
        {canCreate && !['void', 'closed'].includes(commitment.status) && (
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setAdding((v) => !v)}
            data-testid='uat-commitment-co-new'
          >
            <Plus className='mr-1 h-4 w-4' /> New
          </Button>
        )}
      </div>
      {adding && (
        <div className='grid gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_140px_auto]'>
          <Input
            placeholder='Title'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            type='number'
            step='0.01'
            placeholder='Value'
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            size='sm'
            disabled={create.isPending || !title.trim() || !Number(value)}
            onClick={async () => {
              try {
                await create.mutateAsync({
                  commitmentId: commitment.id,
                  payload: { title: title.trim(), value: Number(value) },
                })
                toast.success('Change order drafted')
                setTitle('')
                setValue('')
                setAdding(false)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            Add
          </Button>
        </div>
      )}
      {commitment.changeOrders.length === 0 ? (
        <p className='text-xs text-muted-foreground'>None yet.</p>
      ) : (
        <ul className='divide-y rounded-md border text-sm'>
          {commitment.changeOrders.map((co) => (
            <li
              key={co.id}
              className='flex flex-wrap items-center gap-2 px-3 py-2'
            >
              <span className='font-mono text-xs'>{co.ref}</span>
              <span className='min-w-0 flex-1 truncate'>{co.title}</span>
              {co.primeChangeOrder && (
                <Badge variant='outline'>from {co.primeChangeOrder.ref}</Badge>
              )}
              <Badge
                variant={
                  co.status === 'approved'
                    ? 'default'
                    : co.status === 'rejected' || co.status === 'void'
                      ? 'destructive'
                      : 'outline'
                }
              >
                {co.status}
              </Badge>
              <span className='tabular-nums'>{formatMoney(co.value)}</span>
              {co.status === 'draft' && canSubmit && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => run(co.id, 'submit')}
                >
                  Submit
                </Button>
              )}
              {co.status === 'pending' && canApprove && (
                <>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => run(co.id, 'approve')}
                  >
                    Approve
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => run(co.id, 'reject')}
                  >
                    Reject
                  </Button>
                </>
              )}
              {['draft', 'pending'].includes(co.status) && canCreate && (
                <Button
                  size='icon'
                  variant='ghost'
                  className='h-7 w-7'
                  aria-label='Void'
                  onClick={() => run(co.id, 'void')}
                >
                  <Trash2 className='h-3.5 w-3.5' />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The commitment workspace. */
export function CommitmentDetailDialog({
  projectId,
  commitmentId,
  onOpenChange,
  formatMoney,
}: {
  projectId: string
  commitmentId: string | null
  onOpenChange: (open: boolean) => void
  formatMoney: (value: number) => string
}) {
  const { data: commitment, isLoading } = useCommitment(projectId, commitmentId)
  const update = useUpdateCommitment(projectId)
  const action = useCommitmentAction(projectId)
  const execute = useExecuteCommitment(projectId)
  const voidCommitment = useVoidCommitment(projectId)
  const canUpdate = useCanPerform('commitment', 'update')
  const canCreate = useCanPerform('commitment', 'create')
  const canSubmit = useCanPerform('commitment', 'submit', 'commitment.submit')
  const canApprove = useCanPerform(
    'commitment',
    'approve',
    'commitment.approve'
  )
  const canExecute = useCanPerform(
    'commitment',
    'approve',
    'commitment.execute'
  )
  const canClose = useCanPerform('commitment', 'approve', 'commitment.close')
  const canVoid = useCanPerform('commitment', 'delete', 'commitment.void')
  const canCoSubmit = useCanPerform(
    'commitment',
    'submit',
    'commitment_co.submit'
  )
  const canCoApprove = useCanPerform(
    'commitment',
    'approve',
    'commitment_co.approve'
  )
  const canExport = useCanPerform('commitment', 'export')
  const [executing, setExecuting] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [override, setOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [notesDraft, setNotesDraft] = useState<string | null>(null)

  const run = async (kind: 'submit' | 'approve' | 'return' | 'close') => {
    if (!commitment) return
    let reason: string | undefined
    if (kind === 'return') {
      reason = window.prompt('What needs to change?') ?? ''
      if (!reason.trim()) return
    }
    try {
      await action.mutateAsync({
        commitmentId: commitment.id,
        action: kind,
        reason,
      })
      toast.success(
        {
          submit: 'Submitted for approval',
          approve: 'Approved',
          return: 'Returned to draft',
          close: 'Closed',
        }[kind]
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={Boolean(commitmentId)} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-5xl'
        data-testid='uat-commitment-detail'
      >
        {isLoading || !commitment ? (
          <div className='flex items-center gap-2 p-6 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading commitment…
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className='flex flex-wrap items-center gap-2'>
                <DialogTitle className='text-base'>
                  {commitment.ref} · {commitment.title}
                </DialogTitle>
                <Badge
                  className={statusTone(commitment.status)}
                  data-testid='uat-commitment-status'
                >
                  {COMMITMENT_STATUS_LABEL[commitment.status]}
                </Badge>
                <Badge variant='outline'>
                  {commitment.type === 'purchase_order'
                    ? 'Purchase order'
                    : 'Subcontract'}
                </Badge>
                {!commitment.insuranceReady &&
                  commitment.status === 'approved' && (
                    <Badge
                      variant='destructive'
                      data-testid='uat-commitment-insurance-gate'
                    >
                      Insurance outstanding
                    </Badge>
                  )}
              </div>
              <DialogDescription>
                {commitment.vendor?.name ?? 'No vendor'} · retention{' '}
                {commitment.retentionRate}% · {formatDate(commitment.startDate)}{' '}
                → {formatDate(commitment.endDate)}
              </DialogDescription>
            </DialogHeader>

            <div
              className='grid grid-cols-2 gap-2 sm:grid-cols-5'
              data-testid='uat-commitment-values'
            >
              {[
                ['Original', commitment.original],
                ['Approved changes', commitment.approvedChanges],
                ['Revised', commitment.revised],
                ['Retention held', commitment.retentionOnRevised],
                ['Drawn by POs', commitment.drawnDown],
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
              data-testid='uat-commitment-actions'
            >
              {commitment.status === 'draft' && canSubmit && (
                <Button
                  size='sm'
                  onClick={() => run('submit')}
                  data-testid='uat-commitment-submit'
                >
                  <Send className='mr-1 h-4 w-4' /> Submit for approval
                </Button>
              )}
              {commitment.status === 'pending' && canApprove && (
                <>
                  <Button
                    size='sm'
                    onClick={() => run('approve')}
                    data-testid='uat-commitment-approve'
                  >
                    <CheckCircle2 className='mr-1 h-4 w-4' /> Approve
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => run('return')}
                  >
                    <RotateCcw className='mr-1 h-4 w-4' /> Return
                  </Button>
                </>
              )}
              {commitment.status === 'approved' && canExecute && (
                <Button
                  size='sm'
                  onClick={() => setExecuting((v) => !v)}
                  data-testid='uat-commitment-execute'
                >
                  <FileSignature className='mr-1 h-4 w-4' /> Execute
                </Button>
              )}
              {commitment.status === 'approved' && canApprove && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => run('return')}
                >
                  <RotateCcw className='mr-1 h-4 w-4' /> Return to draft
                </Button>
              )}
              {commitment.status === 'executed' && canClose && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => run('close')}
                >
                  Close
                </Button>
              )}
              {['draft', 'pending', 'approved'].includes(commitment.status) &&
                canVoid && (
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={async () => {
                      const reason =
                        window.prompt('Why void this commitment?') ?? ''
                      if (!reason.trim()) return
                      try {
                        await voidCommitment.mutateAsync({
                          commitmentId: commitment.id,
                          reason,
                        })
                        toast.success('Commitment voided')
                      } catch (error) {
                        toast.error(getServerErrorMessage(error))
                      }
                    }}
                  >
                    <XCircle className='mr-1 h-4 w-4' /> Void
                  </Button>
                )}
              {canExport && (
                <Button
                  size='sm'
                  variant='outline'
                  className='ml-auto'
                  onClick={() =>
                    downloadCommitmentPdf(projectId, commitment.id).catch(
                      (error) => toast.error(getServerErrorMessage(error))
                    )
                  }
                  data-testid='uat-commitment-export'
                >
                  <Download className='mr-1 h-4 w-4' /> Statement PDF
                </Button>
              )}
            </div>

            {executing && (
              <div
                className='space-y-2 rounded-md border p-3'
                data-testid='uat-commitment-execute-form'
              >
                <p className='text-sm font-medium'>Execute {commitment.ref}</p>
                <p className='text-xs text-muted-foreground'>
                  Attach the signed agreement. Required insurance must be on
                  file{canVoid ? ' unless you override with a reason' : ''}.
                  Executing posts the committed cost to the budget lines and
                  activities.
                </p>
                <Input
                  type='file'
                  accept='.pdf,.doc,.docx,image/*'
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {!commitment.insuranceReady && canVoid && (
                  <div className='space-y-1'>
                    <div className='flex items-center gap-2'>
                      <Switch
                        checked={override}
                        onCheckedChange={setOverride}
                      />
                      <span className='text-xs'>
                        Execute without the outstanding insurance
                      </span>
                    </div>
                    {override && (
                      <Input
                        placeholder='Reason for the override'
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                      />
                    )}
                  </div>
                )}
                <div className='flex justify-end gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setExecuting(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size='sm'
                    disabled={
                      execute.isPending ||
                      (!file && !commitment.executedDocument)
                    }
                    data-testid='uat-commitment-execute-confirm'
                    onClick={async () => {
                      try {
                        await execute.mutateAsync({
                          commitmentId: commitment.id,
                          file,
                          override,
                          overrideReason: overrideReason.trim() || null,
                        })
                        toast.success(
                          `${commitment.ref} executed — committed cost posted`
                        )
                        setExecuting(false)
                        setFile(null)
                      } catch (error) {
                        toast.error(getServerErrorMessage(error))
                      }
                    }}
                  >
                    {execute.isPending && (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    )}
                    Mark executed
                  </Button>
                </div>
              </div>
            )}

            {commitment.executedDocument && (
              <p className='text-xs text-muted-foreground'>
                Executed agreement:{' '}
                <a
                  className='underline'
                  href={commitment.executedDocument.fileUrl}
                  target='_blank'
                  rel='noreferrer'
                >
                  {commitment.executedDocument.fileName}
                </a>{' '}
                · {formatDate(commitment.executedAt)}
              </p>
            )}

            <div className='grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
              <div className='space-y-4'>
                <LinesSection
                  projectId={projectId}
                  commitment={commitment}
                  canEdit={canUpdate}
                  formatMoney={formatMoney}
                />
                <ChangeOrdersSection
                  projectId={projectId}
                  commitment={commitment}
                  canCreate={canCreate}
                  canSubmit={canCoSubmit}
                  canApprove={canCoApprove}
                  formatMoney={formatMoney}
                />
                {commitment.procurementOrders.length > 0 && (
                  <div className='space-y-1'>
                    <p className='text-sm font-medium'>
                      Purchase orders drawing on this commitment
                    </p>
                    <ul className='text-sm'>
                      {commitment.procurementOrders.map((po) => (
                        <li key={po.id} className='flex gap-2'>
                          <span className='font-mono text-xs'>{po.ref}</span>
                          <span className='min-w-0 flex-1 truncate'>
                            {po.item}
                          </span>
                          <Badge variant='outline'>{po.status}</Badge>
                          <span className='tabular-nums'>
                            {formatMoney(po.value)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <InsuranceEditor
                  key={commitment.updatedAt ?? commitment.id}
                  projectId={projectId}
                  commitment={commitment}
                  canEdit={canUpdate}
                />
                <div className='space-y-1'>
                  <div className='flex items-center justify-between'>
                    <p className='text-sm font-medium'>Notes</p>
                    {canUpdate && notesDraft === null && (
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => setNotesDraft(commitment.notes ?? '')}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                  {notesDraft === null ? (
                    <p
                      className={cn(
                        'text-sm',
                        !commitment.notes && 'text-muted-foreground'
                      )}
                    >
                      {commitment.notes || 'No notes.'}
                    </p>
                  ) : (
                    <div className='space-y-2'>
                      <Textarea
                        rows={3}
                        value={notesDraft}
                        onChange={(e) => setNotesDraft(e.target.value)}
                      />
                      <div className='flex justify-end gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => setNotesDraft(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size='sm'
                          disabled={update.isPending}
                          onClick={async () => {
                            try {
                              await update.mutateAsync({
                                commitmentId: commitment.id,
                                payload: { notes: notesDraft.trim() || null },
                              })
                              setNotesDraft(null)
                            } catch (error) {
                              toast.error(getServerErrorMessage(error))
                            }
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className='space-y-4'>
                <WorkflowInstancePanel
                  projectId={projectId}
                  tool='commitment'
                  recordId={commitment.id}
                />
                <AttachmentPanel
                  projectId={projectId}
                  recordType='commitment'
                  recordId={commitment.id}
                  compact
                />
                <HistoryPanel
                  projectId={projectId}
                  entityType='commitment'
                  entityId={commitment.id}
                  title={`${commitment.ref} History`}
                  limit={30}
                  showFilters={false}
                />
                <CommentThread
                  projectId={projectId}
                  recordType='commitment'
                  recordId={commitment.id}
                  title='Internal notes'
                />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
