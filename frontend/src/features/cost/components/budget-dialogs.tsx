import { useState } from 'react'
import { Loader2, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { FINANCIAL_TERMS } from '@/lib/financial-terms'
import { getServerErrorMessage } from '@/lib/handle-server-error'
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
import { useActivities } from '@/features/activities/hooks/use-activities'
import {
  BUDGET_COST_TYPES,
  COST_TYPE_LABEL,
  useAddBudgetRevision,
  useBudgetReconciliation,
  useBudgetSnapshot,
  useBudgetSnapshots,
  useCreateBudgetLine,
  useImportBudgetLines,
  useProjectCostCodes,
  useReportingPeriodOptions,
  useSelectProjectCostCodes,
  useSetBudgetLineAllocations,
  useSuggestBudgetLineAllocations,
  useTakeBudgetSnapshot,
  useTransferBudget,
  useUpdateBudgetLine,
  type BudgetCostType,
  type BudgetLine,
} from '../hooks/use-budget'

const NONE = '__none'

const parseMoney = (value: string) => {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Create or edit one budget line. */
export function BudgetLineDialog({
  projectId,
  open,
  onOpenChange,
  line,
  formatMoney,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  line?: BudgetLine | null
  formatMoney: (value: number) => string
}) {
  const { data: codes } = useProjectCostCodes(projectId)
  const create = useCreateBudgetLine(projectId)
  const update = useUpdateBudgetLine(projectId)
  const [costCodeId, setCostCodeId] = useState(line?.costCodeId ?? '')
  const [costType, setCostType] = useState<BudgetCostType>(
    line?.costType ?? 'material'
  )
  const [description, setDescription] = useState(line?.description ?? '')
  const [original, setOriginal] = useState(
    line ? String(line.originalBudget) : ''
  )
  const [committed, setCommitted] = useState(line ? String(line.committed) : '')
  // Actual cost is posted by the cost ledger and is shown here, never typed:
  // the API refuses a figure that differs from what was posted (Phase 21D).
  const actual = line ? String(line.actual) : '0'
  const [forecast, setForecast] = useState(
    line?.forecastIsManual ? String(line.forecast) : ''
  )
  const busy = create.isPending || update.isPending
  const available = codes?.available ?? []

  const save = async () => {
    try {
      const payload = {
        costType,
        description: description.trim() || null,
        originalBudget: parseMoney(original) ?? 0,
        committed: parseMoney(committed) ?? 0,
        forecast: parseMoney(forecast),
      }
      if (line) {
        await update.mutateAsync({ lineId: line.id, payload })
        toast.success('Budget line saved')
      } else {
        await create.mutateAsync({ ...payload, costCodeId })
        toast.success('Budget line added')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid='uat-budget-line-dialog'>
        <DialogHeader>
          <DialogTitle>
            {line ? `Edit ${line.costCode?.code ?? 'line'}` : 'New budget line'}
          </DialogTitle>
          <DialogDescription>
            One line per cost code and cost type. The revised budget adds
            approved change orders, revisions and transfers on top of the
            original.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          {!line && (
            <div className='space-y-1 sm:col-span-2'>
              <Label>Cost code</Label>
              <Select
                value={costCodeId || NONE}
                onValueChange={(value) =>
                  setCostCodeId(value === NONE ? '' : value)
                }
              >
                <SelectTrigger data-testid='uat-budget-line-code'>
                  <SelectValue placeholder='Pick a cost code' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Pick a cost code</SelectItem>
                  {available.map((code) => (
                    <SelectItem key={code.id} value={code.id}>
                      {code.code} · {code.name}
                      {code.selected ? '' : ' (not yet on this project)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className='space-y-1'>
            <Label>Cost type</Label>
            <Select
              value={costType}
              onValueChange={(value) => setCostType(value as BudgetCostType)}
            >
              <SelectTrigger data-testid='uat-budget-line-type'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUDGET_COST_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {COST_TYPE_LABEL[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='budget-original'>Original budget</Label>
            <Input
              id='budget-original'
              type='number'
              step='0.01'
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
              data-testid='uat-budget-line-original'
            />
          </div>
          <div className='space-y-1'>
            <Label
              htmlFor='budget-committed'
              title={FINANCIAL_TERMS.manualCommitted.hint}
            >
              {FINANCIAL_TERMS.manualCommitted.label}
            </Label>
            <Input
              id='budget-committed'
              type='number'
              step='0.01'
              value={committed}
              onChange={(e) => setCommitted(e.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='budget-actual'>Actual (posted from the cost ledger)</Label>
            <Input
              id='budget-actual'
              type='number'
              step='0.01'
              value={actual}
              readOnly
              disabled
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='budget-forecast'>
              Forecast (blank = automatic)
            </Label>
            <Input
              id='budget-forecast'
              type='number'
              step='0.01'
              value={forecast}
              onChange={(e) => setForecast(e.target.value)}
              placeholder={
                line ? formatMoney(line.forecast) : 'max(revised, actual)'
              }
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='budget-description'>Description</Label>
            <Textarea
              id='budget-description'
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={busy || (!line && !costCodeId)}
            data-testid='uat-budget-line-save'
          >
            {busy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {line ? 'Save' : 'Add line'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Spread a line across activities by weight; can start from the BOQ. */
export function BudgetAllocationDialog({
  projectId,
  line,
  onOpenChange,
  formatMoney,
}: {
  projectId: string
  line: BudgetLine | null
  onOpenChange: (open: boolean) => void
  formatMoney: (value: number) => string
}) {
  const { data: activities } = useActivities(projectId)
  const save = useSetBudgetLineAllocations(projectId)
  const suggest = useSuggestBudgetLineAllocations(projectId)
  const [rows, setRows] = useState<
    Array<{
      activityId: string
      weight: string
      source: 'manual' | 'boq' | 'even'
    }>
  >(() =>
    (line?.allocations ?? []).map((row) => ({
      activityId: row.activityId,
      weight: String(row.weight),
      source: row.source,
    }))
  )
  const [pick, setPick] = useState('')
  const total = rows.reduce((sum, row) => sum + (Number(row.weight) || 0), 0)
  const revised = line?.revisedBudget ?? 0
  const used = new Set(rows.map((row) => row.activityId))
  const nameOf = (activityId: string) => {
    const activity = activities?.find((row) => row.id === activityId)
    return activity
      ? `${activity.wbsCode ? `${activity.wbsCode} · ` : ''}${activity.name}`
      : activityId
  }

  return (
    <Dialog open={Boolean(line)} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'
        data-testid='uat-budget-allocation-dialog'
      >
        <DialogHeader>
          <DialogTitle>
            Allocate {line?.costCode?.code} ·{' '}
            {line ? COST_TYPE_LABEL[line.costType] : ''}
          </DialogTitle>
          <DialogDescription>
            Weights are percentages of the revised budget (
            {formatMoney(revised)}). They feed the activity view and the
            reconciliation report.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={suggest.isPending || !line}
            data-testid='uat-budget-allocation-suggest'
            onClick={async () => {
              if (!line) return
              try {
                const suggestion = await suggest.mutateAsync(line.id)
                setRows(
                  suggestion.items.map((item) => ({
                    activityId: item.activityId,
                    weight: String(item.weight),
                    source: suggestion.basis,
                  }))
                )
                toast.success(
                  suggestion.basis === 'boq'
                    ? 'Weights suggested from the BOQ allocations'
                    : 'No BOQ items match this code — spread by approved activity budget'
                )
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            <Sparkles className='mr-1 h-4 w-4' /> Suggest from BOQ
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={() =>
              setRows(
                rows.map((row) => ({
                  ...row,
                  weight: rows.length
                    ? String(Math.round((100 / rows.length) * 10000) / 10000)
                    : '0',
                }))
              )
            }
            disabled={!rows.length}
          >
            Split evenly
          </Button>
          <Badge
            variant={
              Math.abs(total - 100) < 0.01
                ? 'default'
                : total > 100
                  ? 'destructive'
                  : 'outline'
            }
            className='ml-auto'
          >
            {Math.round(total * 100) / 100}% allocated
          </Badge>
        </div>
        <div className='space-y-2'>
          {rows.map((row, index) => (
            <div key={row.activityId} className='flex items-center gap-2'>
              <span className='min-w-0 flex-1 truncate text-sm'>
                {nameOf(row.activityId)}
              </span>
              <Input
                type='number'
                step='0.01'
                min={0}
                max={100}
                className='w-24'
                value={row.weight}
                aria-label='Weight'
                onChange={(e) =>
                  setRows(
                    rows.map((entry, i) =>
                      i === index
                        ? { ...entry, weight: e.target.value, source: 'manual' }
                        : entry
                    )
                  )
                }
              />
              <span className='w-28 text-right text-xs text-muted-foreground tabular-nums'>
                {formatMoney((revised * (Number(row.weight) || 0)) / 100)}
              </span>
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
          {rows.length === 0 && (
            <p className='text-xs text-muted-foreground'>No activities yet.</p>
          )}
        </div>
        <div className='flex gap-2'>
          <Select
            value={pick || NONE}
            onValueChange={(value) => setPick(value === NONE ? '' : value)}
          >
            <SelectTrigger className='flex-1' aria-label='Add activity'>
              <SelectValue placeholder='Add an activity…' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Add an activity…</SelectItem>
              {(activities ?? [])
                .filter(
                  (activity) => !used.has(activity.id) && !activity.isMilestone
                )
                .map((activity) => (
                  <SelectItem key={activity.id} value={activity.id}>
                    {activity.wbsCode ? `${activity.wbsCode} · ` : ''}
                    {activity.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            variant='outline'
            disabled={!pick}
            onClick={() => {
              setRows([
                ...rows,
                {
                  activityId: pick,
                  weight: String(
                    Math.max(0, Math.round((100 - total) * 100) / 100)
                  ),
                  source: 'manual',
                },
              ])
              setPick('')
            }}
          >
            Add
          </Button>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || total > 100.0001 || !line}
            data-testid='uat-budget-allocation-save'
            onClick={async () => {
              if (!line) return
              try {
                await save.mutateAsync({
                  lineId: line.id,
                  allocations: rows.map((row) => ({
                    activityId: row.activityId,
                    weight: Number(row.weight) || 0,
                    source: row.source,
                  })),
                })
                toast.success('Allocations saved')
                onOpenChange(false)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {save.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Save allocations
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Move budget from one line to another. */
export function BudgetTransferDialog({
  projectId,
  lines,
  open,
  onOpenChange,
  formatMoney,
}: {
  projectId: string
  lines: BudgetLine[]
  open: boolean
  onOpenChange: (open: boolean) => void
  formatMoney: (value: number) => string
}) {
  const transfer = useTransferBudget(projectId)
  const [fromLineId, setFromLineId] = useState('')
  const [toLineId, setToLineId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const from = lines.find((line) => line.id === fromLineId)
  const label = (line: BudgetLine) =>
    `${line.costCode?.code ?? ''} · ${COST_TYPE_LABEL[line.costType]} (${formatMoney(line.revisedBudget)})`
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid='uat-budget-transfer-dialog'>
        <DialogHeader>
          <DialogTitle>Transfer budget</DialogTitle>
          <DialogDescription>
            Moves money between two lines and records both sides in their
            ledgers.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label>From</Label>
            <Select
              value={fromLineId || NONE}
              onValueChange={(value) =>
                setFromLineId(value === NONE ? '' : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder='Line to take from' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Line to take from</SelectItem>
                {lines.map((line) => (
                  <SelectItem key={line.id} value={line.id}>
                    {label(line)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label>To</Label>
            <Select
              value={toLineId || NONE}
              onValueChange={(value) =>
                setToLineId(value === NONE ? '' : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder='Line to add to' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Line to add to</SelectItem>
                {lines
                  .filter((line) => line.id !== fromLineId)
                  .map((line) => (
                    <SelectItem key={line.id} value={line.id}>
                      {label(line)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='budget-transfer-amount'>
              Amount{from ? ` (up to ${formatMoney(from.revisedBudget)})` : ''}
            </Label>
            <Input
              id='budget-transfer-amount'
              type='number'
              step='0.01'
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='budget-transfer-note'>Reason</Label>
            <Textarea
              id='budget-transfer-note'
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              transfer.isPending ||
              !fromLineId ||
              !toLineId ||
              !(Number(amount) > 0)
            }
            data-testid='uat-budget-transfer-save'
            onClick={async () => {
              try {
                await transfer.mutateAsync({
                  fromLineId,
                  toLineId,
                  amount: Number(amount),
                  note: note.trim() || null,
                })
                toast.success('Budget transferred')
                onOpenChange(false)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {transfer.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Signed revision on one line, with a reason. */
export function BudgetRevisionDialog({
  projectId,
  line,
  onOpenChange,
}: {
  projectId: string
  line: BudgetLine | null
  onOpenChange: (open: boolean) => void
}) {
  const revise = useAddBudgetRevision(projectId)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  return (
    <Dialog open={Boolean(line)} onOpenChange={onOpenChange}>
      <DialogContent data-testid='uat-budget-revision-dialog'>
        <DialogHeader>
          <DialogTitle>Revise {line?.costCode?.code}</DialogTitle>
          <DialogDescription>
            Positive to add, negative to reduce. Approved change orders land
            here automatically; use this for everything else.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label htmlFor='budget-revision-amount'>Amount</Label>
            <Input
              id='budget-revision-amount'
              type='number'
              step='0.01'
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='budget-revision-note'>Reason</Label>
            <Textarea
              id='budget-revision-note'
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              revise.isPending || !line || !Number(amount) || !note.trim()
            }
            onClick={async () => {
              if (!line) return
              try {
                await revise.mutateAsync({
                  lineId: line.id,
                  amount: Number(amount),
                  note: note.trim(),
                })
                toast.success('Revision recorded')
                onOpenChange(false)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {revise.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Record revision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "code, name, costType, originalBudget, description" per line; header optional. */
const parseCsv = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim()))
    .filter((cells) => cells[0] && cells[0].toLowerCase() !== 'code')
    .map(([code, name, costType, originalBudget, description]) => ({
      code,
      name: name || null,
      costType: (BUDGET_COST_TYPES as readonly string[]).includes(
        (costType || '').toLowerCase()
      )
        ? ((costType || '').toLowerCase() as BudgetCostType)
        : 'other',
      originalBudget: Number(originalBudget) || 0,
      description: description || null,
    }))

export function BudgetImportDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const importLines = useImportBudgetLines(projectId)
  const [csv, setCsv] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid='uat-budget-import-dialog'>
        <DialogHeader>
          <DialogTitle>Import budget lines</DialogTitle>
          <DialogDescription>
            One per line:{' '}
            <code>code, name, cost type, original budget, description</code>.
            Unknown codes with a name are added to the company library; existing
            lines are updated.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={10}
          className='font-mono text-xs'
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={
            '03-300, Cast-in-place concrete, material, 250000\n03-300, Cast-in-place concrete, labour, 120000, Formwork crew\n09-900, Painting, subcontract, 80000'
          }
          data-testid='uat-budget-import-csv'
        />
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={importLines.isPending || !parseCsv(csv).length}
            onClick={async () => {
              try {
                const result = await importLines.mutateAsync(parseCsv(csv))
                toast.success(
                  `${result.created} created, ${result.updated} updated${result.missingCodes.length ? `; unknown codes without a name: ${result.missingCodes.join(', ')}` : ''}`
                )
                setCsv('')
                onOpenChange(false)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {importLines.isPending ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Which of the organisation's cost codes the project budgets against. */
export function BudgetCostCodesDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data, isLoading } = useProjectCostCodes(projectId)
  const select = useSelectProjectCostCodes(projectId)
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const available = (data?.available ?? []).filter(
    (code) =>
      !search ||
      `${code.code} ${code.name}`.toLowerCase().includes(search.toLowerCase())
  )
  const isSelected = (code: { id: string; selected: boolean }) =>
    pending[code.id] ?? code.selected
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-xl'
        data-testid='uat-budget-cost-codes-dialog'
      >
        <DialogHeader>
          <DialogTitle>Project cost codes</DialogTitle>
          <DialogDescription>
            The subset of the company list this project budgets against. Codes
            with lines cannot be removed.
          </DialogDescription>
        </DialogHeader>
        <div className='flex gap-2'>
          <Input
            placeholder='Search code or name'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            variant='outline'
            disabled={select.isPending}
            onClick={async () => {
              try {
                await select.mutateAsync({ importAll: true })
                setPending({})
                toast.success('Every company cost code is now on the project')
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            Use all
          </Button>
        </div>
        {isLoading ? (
          <p className='text-sm text-muted-foreground'>Loading…</p>
        ) : (
          <div className='max-h-80 space-y-1 overflow-y-auto rounded-md border p-2'>
            {available.map((code) => (
              <label key={code.id} className='flex items-center gap-2 text-sm'>
                <Checkbox
                  checked={isSelected(code)}
                  onCheckedChange={(checked) =>
                    setPending({ ...pending, [code.id]: Boolean(checked) })
                  }
                />
                <span className='font-mono text-xs'>{code.code}</span>
                <span className='min-w-0 flex-1 truncate'>{code.name}</span>
                <Badge variant='outline'>{code.category}</Badge>
              </label>
            ))}
            {available.length === 0 && (
              <p className='text-xs text-muted-foreground'>
                No cost codes in the company list yet — add them under Company ›
                Cost codes.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={select.isPending || Object.keys(pending).length === 0}
            onClick={async () => {
              const add = Object.entries(pending)
                .filter(([, on]) => on)
                .map(([id]) => id)
              const remove = Object.entries(pending)
                .filter(([, on]) => !on)
                .map(([id]) => id)
              try {
                await select.mutateAsync({
                  costCodeIds: add,
                  removeCostCodeIds: remove,
                })
                setPending({})
                toast.success('Project cost codes updated')
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {select.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Activity-by-activity reconciliation. */
export function BudgetReconciliationDialog({
  projectId,
  open,
  onOpenChange,
  formatMoney,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  formatMoney: (value: number) => string
}) {
  const { data, isLoading } = useBudgetReconciliation(projectId)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-4xl'
        data-testid='uat-budget-reconciliation-dialog'
      >
        <DialogHeader>
          <DialogTitle>Budget reconciliation</DialogTitle>
          <DialogDescription>
            Activity budgets (approved BOQ allocations plus approved
            change-order impacts) against what the budget lines allocate to each
            activity.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <p className='text-sm text-muted-foreground'>Working it out…</p>
        ) : (
          <div className='space-y-3 text-sm'>
            <div className='flex flex-wrap gap-4'>
              <span>
                Σ activity budgets{' '}
                <strong>{formatMoney(data.totals.activityBudget)}</strong>
              </span>
              <span>
                Σ budget lines{' '}
                <strong>{formatMoney(data.totals.budgetLines)}</strong>
              </span>
              <span>
                Allocated to activities{' '}
                <strong>
                  {formatMoney(data.totals.allocatedToActivities)}
                </strong>
              </span>
              <Badge variant={data.balanced ? 'default' : 'destructive'}>
                {data.balanced
                  ? 'Balanced'
                  : `Off by ${formatMoney(data.totals.difference)}`}
              </Badge>
            </div>
            <div className='overflow-x-auto rounded-md border'>
              <table className='w-full text-xs'>
                <thead className='bg-muted/40'>
                  <tr>
                    <th className='p-2 text-left'>Activity</th>
                    <th className='p-2 text-right'>BOQ budget</th>
                    <th className='p-2 text-right'>Approved changes</th>
                    <th className='p-2 text-right'>Activity budget</th>
                    <th className='p-2 text-right'>From lines</th>
                    <th className='p-2 text-right'>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.activities.map((row) => (
                    <tr
                      key={row.activityId}
                      className={
                        Math.abs(row.difference) > 0.01
                          ? 'bg-destructive/5'
                          : ''
                      }
                    >
                      <td className='p-2'>
                        {row.code ? (
                          <span className='mr-1 font-mono'>{row.code}</span>
                        ) : null}
                        {row.name}
                      </td>
                      <td className='p-2 text-right tabular-nums'>
                        {formatMoney(row.boqBudget)}
                      </td>
                      <td className='p-2 text-right tabular-nums'>
                        {formatMoney(row.approvedChanges)}
                      </td>
                      <td className='p-2 text-right tabular-nums'>
                        {formatMoney(row.activityBudget)}
                      </td>
                      <td className='p-2 text-right tabular-nums'>
                        {formatMoney(row.budgetFromLines)}
                      </td>
                      <td
                        className={`p-2 text-right tabular-nums ${Math.abs(row.difference) > 0.01 ? 'font-medium text-destructive' : ''}`}
                      >
                        {formatMoney(row.difference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.underAllocatedLines.length > 0 && (
              <p className='text-xs text-muted-foreground'>
                Under-allocated lines:{' '}
                {data.underAllocatedLines
                  .map(
                    (line) =>
                      `${line.code} (${Math.round(line.allocatedWeight)}%)`
                  )
                  .join(', ')}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Take and browse snapshots. */
export function BudgetSnapshotsDialog({
  projectId,
  open,
  onOpenChange,
  canTake,
  formatMoney,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  canTake: boolean
  formatMoney: (value: number) => string
}) {
  const { data } = useBudgetSnapshots(projectId)
  const { data: periods } = useReportingPeriodOptions(projectId)
  const take = useTakeBudgetSnapshot(projectId)
  const [label, setLabel] = useState('')
  const [periodId, setPeriodId] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const { data: snapshot } = useBudgetSnapshot(projectId, openId)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'
        data-testid='uat-budget-snapshots-dialog'
      >
        <DialogHeader>
          <DialogTitle>Budget snapshots</DialogTitle>
          <DialogDescription>
            A frozen copy of every line, its allocations and the reconciliation.
            Locking a reporting period takes one automatically.
          </DialogDescription>
        </DialogHeader>
        {canTake && (
          <div className='grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto]'>
            <Input
              placeholder='Label (optional)'
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Select
              value={periodId || NONE}
              onValueChange={(value) =>
                setPeriodId(value === NONE ? '' : value)
              }
            >
              <SelectTrigger aria-label='Reporting period'>
                <SelectValue placeholder='No period' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No period</SelectItem>
                {(periods?.periods ?? [])
                  .filter((period) => period.id)
                  .map((period) => (
                    <SelectItem key={period.id} value={period.id}>
                      {period.code}
                      {period.label ? ` · ${period.label}` : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              disabled={take.isPending}
              data-testid='uat-budget-snapshot-take'
              onClick={async () => {
                try {
                  await take.mutateAsync({
                    label: label.trim() || null,
                    reportingPeriodId: periodId || null,
                  })
                  toast.success('Snapshot taken')
                  setLabel('')
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}
            >
              {take.isPending && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              Take snapshot
            </Button>
          </div>
        )}
        <ul className='divide-y rounded-md border text-sm'>
          {(data?.items ?? []).map((row) => (
            <li
              key={row.id}
              className='flex flex-wrap items-center gap-2 px-3 py-2'
            >
              <button
                type='button'
                className='font-medium underline-offset-2 hover:underline'
                onClick={() => setOpenId(row.id)}
              >
                {row.label}
              </button>
              {row.reportingPeriod && (
                <Badge variant='outline'>{row.reportingPeriod.code}</Badge>
              )}
              <span className='text-xs text-muted-foreground'>
                {row.takenAt ? new Date(row.takenAt).toLocaleString() : ''}
              </span>
              <span className='ml-auto text-xs tabular-nums'>
                {formatMoney(Number(row.totals?.revisedBudget ?? 0))}
              </span>
              {typeof row.reconciliation?.balanced === 'boolean' && (
                <Badge
                  variant={
                    row.reconciliation.balanced ? 'default' : 'destructive'
                  }
                >
                  {row.reconciliation.balanced ? 'Balanced' : 'Off'}
                </Badge>
              )}
            </li>
          ))}
          {(data?.items ?? []).length === 0 && (
            <li className='px-3 py-2 text-xs text-muted-foreground'>
              No snapshots yet.
            </li>
          )}
        </ul>
        {snapshot && (
          <div className='space-y-2 rounded-md border p-3 text-xs'>
            <div className='flex items-center justify-between'>
              <p className='font-medium'>{snapshot.label}</p>
              <Button size='sm' variant='ghost' onClick={() => setOpenId(null)}>
                Close
              </Button>
            </div>
            <div className='overflow-x-auto'>
              <table className='w-full'>
                <thead className='bg-muted/40'>
                  <tr>
                    <th className='p-1 text-left'>Code</th>
                    <th className='p-1 text-left'>Type</th>
                    <th className='p-1 text-right'>Original</th>
                    <th className='p-1 text-right'>Revised</th>
                    <th className='p-1 text-right'>Actual</th>
                    <th className='p-1 text-right'>Forecast</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot.lines ?? []).map((line) => (
                    <tr key={line.id}>
                      <td className='p-1 font-mono'>{line.costCode?.code}</td>
                      <td className='p-1'>{COST_TYPE_LABEL[line.costType]}</td>
                      <td className='p-1 text-right tabular-nums'>
                        {formatMoney(line.originalBudget)}
                      </td>
                      <td className='p-1 text-right tabular-nums'>
                        {formatMoney(line.revisedBudget)}
                      </td>
                      <td className='p-1 text-right tabular-nums'>
                        {formatMoney(line.actual)}
                      </td>
                      <td className='p-1 text-right tabular-nums'>
                        {formatMoney(line.forecast)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
