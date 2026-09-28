import { useMemo, useState } from 'react'
import {
  Archive,
  ArrowLeftRight,
  Camera,
  CheckCircle2,
  ListTree,
  Pencil,
  PieChart,
  Plus,
  Scale,
  Upload,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { FINANCIAL_TERMS } from '@/lib/financial-terms'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import { useProject } from '@/features/projects/hooks/use-projects'
import {
  BUDGET_COST_TYPES,
  COST_TYPE_LABEL,
  useArchiveBudgetLine,
  useBudgetLines,
  useBudgetReconciliation,
  type BudgetCostType,
  type BudgetLine,
} from '../hooks/use-budget'
import {
  BudgetAllocationDialog,
  BudgetCostCodesDialog,
  BudgetImportDialog,
  BudgetLineDialog,
  BudgetReconciliationDialog,
  BudgetRevisionDialog,
  BudgetSnapshotsDialog,
  BudgetTransferDialog,
} from './budget-dialogs'

const money = (currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    })
  } catch {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
  }
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad'
}) {
  return (
    <div className='rounded-lg border p-3'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p
        className={cn(
          'text-lg font-semibold tabular-nums',
          tone === 'good' && 'text-emerald-600',
          tone === 'bad' && 'text-destructive'
        )}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * Budget by cost code (OCTA-FIN-COSTCODE-019): lines per cost code and
 * cost type with original, approved changes, revised, committed, actual,
 * forecast and variance; allocations to activities; reconciliation against
 * the activity budgets; transfers, revisions, import and snapshots.
 */
export function BudgetPanel({ projectId }: { projectId: string }) {
  const { data: project } = useProject(projectId)
  const formatter = useMemo(
    () => money(project?.currency || 'USD'),
    [project?.currency]
  )
  const formatMoney = (value: number) => formatter.format(Number(value) || 0)
  const canCreate = useCanPerform('cost', 'create')
  const canUpdate = useCanPerform('cost', 'update')
  const canApprove = useCanPerform('cost', 'approve')
  const canDelete = useCanPerform('cost', 'delete')
  const [search, setSearch] = useState('')
  const [costType, setCostType] = useState<BudgetCostType | 'all'>('all')
  const [includeArchived, setIncludeArchived] = useState(false)
  const { data, isLoading } = useBudgetLines(projectId, {
    search,
    costType,
    includeArchived,
  })
  const { data: reconciliation } = useBudgetReconciliation(projectId)
  const archive = useArchiveBudgetLine(projectId)
  const [dialog, setDialog] = useState<
    | 'line'
    | 'import'
    | 'transfer'
    | 'codes'
    | 'reconciliation'
    | 'snapshots'
    | null
  >(null)
  const [editing, setEditing] = useState<BudgetLine | null>(null)
  const [allocating, setAllocating] = useState<BudgetLine | null>(null)
  const [revising, setRevising] = useState<BudgetLine | null>(null)
  const [nonce, setNonce] = useState(0)
  const openDialog = (kind: typeof dialog) => {
    setNonce((value) => value + 1)
    setDialog(kind)
  }
  const lines = data?.items ?? []
  const totals = data?.summary.totals

  return (
    <div className='space-y-3' data-testid='uat-budget-panel'>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8'>
        <Stat
          label='Original'
          value={formatMoney(totals?.originalBudget ?? 0)}
        />
        <Stat
          label='Approved changes'
          value={formatMoney(totals?.approvedChanges ?? 0)}
        />
        <Stat label='Revisions' value={formatMoney(totals?.revisions ?? 0)} />
        <Stat label='Revised' value={formatMoney(totals?.revisedBudget ?? 0)} />
        <Stat
          label={FINANCIAL_TERMS.executedCommitments.label}
          value={formatMoney(totals?.committed ?? 0)}
        />
        <Stat label='Actual' value={formatMoney(totals?.actual ?? 0)} />
        <Stat
          label='Forecast (budget lines)'
          value={formatMoney(totals?.forecast ?? 0)}
        />
        <Stat
          label='Variance'
          value={formatMoney(totals?.variance ?? 0)}
          tone={(totals?.variance ?? 0) < 0 ? 'bad' : 'good'}
        />
      </div>

      <div
        className='flex flex-wrap items-center gap-2 rounded-lg border p-3'
        data-testid='uat-budget-reconciliation'
      >
        <Scale className='h-4 w-4 text-muted-foreground' />
        {reconciliation ? (
          <>
            <Badge
              variant={reconciliation.balanced ? 'default' : 'destructive'}
              data-testid='uat-budget-balanced'
              data-balanced={reconciliation.balanced ? 'true' : 'false'}
            >
              {reconciliation.balanced ? (
                <>
                  <CheckCircle2 className='mr-1 h-3 w-3' /> Balanced
                </>
              ) : (
                <>
                  <XCircle className='mr-1 h-3 w-3' /> Off by{' '}
                  {formatMoney(reconciliation.totals.difference)}
                </>
              )}
            </Badge>
            <span className='text-sm text-muted-foreground'>
              Σ activity budgets{' '}
              {formatMoney(reconciliation.totals.activityBudget)} · Σ budget
              lines {formatMoney(reconciliation.totals.budgetLines)}
              {reconciliation.mismatches?.length
                ? ` · ${reconciliation.mismatches.length} activit${reconciliation.mismatches.length === 1 ? 'y' : 'ies'} differ`
                : ''}
              {/* Which activities differ is read off each one's BOQ
                  allocation: withheld by the server from a member who may
                  not read the BOQ (owner decision E1) — said, not shown as
                  none. */}
              {reconciliation.activityBudgetsWithheld
                ? ` · activity budgets: — ${reconciliation.activityBudgetsReason ?? 'Mapping details unavailable to you'}`
                : ''}
              {data?.summary.underAllocated
                ? ` · ${data.summary.underAllocated} line${data.summary.underAllocated === 1 ? '' : 's'} under-allocated`
                : ''}
            </span>
          </>
        ) : (
          <span className='text-sm text-muted-foreground'>Reconciling…</span>
        )}
        <div className='ml-auto flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => openDialog('reconciliation')}
            data-testid='uat-budget-reconciliation-open'
          >
            View report
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() => openDialog('snapshots')}
            data-testid='uat-budget-snapshots-open'
          >
            <Camera className='mr-1 h-4 w-4' /> Snapshots
          </Button>
        </div>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Input
          placeholder='Search code, name or description'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <Select
          value={costType}
          onValueChange={(value) =>
            setCostType(value as BudgetCostType | 'all')
          }
        >
          <SelectTrigger className='w-40' aria-label='Cost type'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All cost types</SelectItem>
            {BUDGET_COST_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {COST_TYPE_LABEL[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className='flex items-center gap-1'>
          <Switch
            id='budget-archived'
            checked={includeArchived}
            onCheckedChange={setIncludeArchived}
          />
          <Label htmlFor='budget-archived' className='text-xs'>
            Archived
          </Label>
        </div>
        <div className='ml-auto flex flex-wrap gap-2'>
          {canUpdate && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => openDialog('codes')}
              data-testid='uat-budget-codes'
            >
              <ListTree className='mr-1 h-4 w-4' /> Cost codes
            </Button>
          )}
          {canCreate && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => openDialog('import')}
              data-testid='uat-budget-import'
            >
              <Upload className='mr-1 h-4 w-4' /> Import
            </Button>
          )}
          {canApprove && lines.length > 1 && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => openDialog('transfer')}
              data-testid='uat-budget-transfer'
            >
              <ArrowLeftRight className='mr-1 h-4 w-4' /> Transfer
            </Button>
          )}
          {canCreate && (
            <Button
              size='sm'
              data-testid='uat-budget-line-new'
              onClick={() => {
                setEditing(null)
                openDialog('line')
              }}
            >
              <Plus className='mr-1 h-4 w-4' /> Add line
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          Loading budget…
        </p>
      ) : lines.length === 0 ? (
        <p className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          No budget lines yet. Add lines by cost code, or import them from a
          list.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm' data-testid='uat-budget-lines'>
            <thead className='bg-muted/40 text-xs'>
              <tr>
                <th className='p-2 text-left'>Cost code</th>
                <th className='p-2 text-left'>Type</th>
                <th className='p-2 text-right'>Original</th>
                <th className='p-2 text-right'>Changes</th>
                <th className='p-2 text-right'>Revised</th>
                <th
                  className='p-2 text-right'
                  title={FINANCIAL_TERMS.executedCommitments.hint}
                >
                  {FINANCIAL_TERMS.executedCommitments.label}
                </th>
                <th className='p-2 text-right'>Actual</th>
                <th className='p-2 text-right'>Forecast</th>
                <th className='p-2 text-right'>Variance</th>
                <th className='p-2 text-right'>Allocated</th>
                <th className='p-2' />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.id}
                  className={cn(
                    'border-t',
                    line.status === 'archived' && 'text-muted-foreground'
                  )}
                  data-testid='uat-budget-line-row'
                >
                  <td className='p-2'>
                    <div className='font-mono text-xs'>
                      {line.costCode?.code}
                    </div>
                    <div className='text-xs text-muted-foreground'>
                      {line.costCode?.name}
                      {line.description ? ` — ${line.description}` : ''}
                    </div>
                  </td>
                  <td className='p-2'>
                    <Badge variant='outline'>
                      {COST_TYPE_LABEL[line.costType]}
                    </Badge>
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(line.originalBudget)}
                  </td>
                  <td
                    className='p-2 text-right tabular-nums'
                    title={`Approved change orders ${formatMoney(line.approvedChanges)} · revisions and transfers ${formatMoney(line.revisions)}`}
                  >
                    {formatMoney(line.approvedChanges + line.revisions)}
                  </td>
                  <td className='p-2 text-right font-medium tabular-nums'>
                    {formatMoney(line.revisedBudget)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(line.committed)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(line.actual)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(line.forecast)}
                    {!line.forecastIsManual && (
                      <span className='ml-1 text-[10px] text-muted-foreground'>
                        auto
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'p-2 text-right tabular-nums',
                      line.variance < 0
                        ? 'text-destructive'
                        : 'text-emerald-600'
                    )}
                  >
                    {formatMoney(line.variance)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    <button
                      type='button'
                      className='underline-offset-2 hover:underline'
                      onClick={() => setAllocating(line)}
                      disabled={!canUpdate}
                      data-testid='uat-budget-allocate'
                    >
                      {Math.round(line.allocatedWeight)}%
                    </button>
                    {line.allocatedWeight < 99.99 &&
                      line.status === 'active' &&
                      line.revisedBudget !== 0 && (
                        <PieChart
                          className='ml-1 inline h-3 w-3 text-amber-500'
                          aria-label='Under-allocated'
                        />
                      )}
                  </td>
                  <td className='p-2 text-right whitespace-nowrap'>
                    {canUpdate && line.status === 'active' && (
                      <Button
                        size='icon'
                        variant='ghost'
                        className='h-7 w-7'
                        aria-label='Edit line'
                        onClick={() => {
                          setEditing(line)
                          openDialog('line')
                        }}
                      >
                        <Pencil className='h-3.5 w-3.5' />
                      </Button>
                    )}
                    {canApprove && line.status === 'active' && (
                      <Button
                        size='sm'
                        variant='ghost'
                        className='h-7 px-2 text-xs'
                        onClick={() => setRevising(line)}
                        data-testid='uat-budget-revise'
                      >
                        Revise
                      </Button>
                    )}
                    {canDelete && line.status === 'active' && (
                      <Button
                        size='icon'
                        variant='ghost'
                        className='h-7 w-7'
                        aria-label='Archive line'
                        disabled={archive.isPending}
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `Archive ${line.costCode?.code} · ${COST_TYPE_LABEL[line.costType]}?`
                            )
                          )
                            return
                          try {
                            await archive.mutateAsync(line.id)
                            toast.success('Line archived')
                          } catch (error) {
                            toast.error(getServerErrorMessage(error))
                          }
                        }}
                      >
                        <Archive className='h-3.5 w-3.5' />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot className='border-t bg-muted/20 text-xs font-medium'>
                <tr>
                  <td className='p-2' colSpan={2}>
                    {lines.length} line{lines.length === 1 ? '' : 's'}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(totals.originalBudget)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(totals.approvedChanges + totals.revisions)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(totals.revisedBudget)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(totals.committed)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(totals.actual)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(totals.forecast)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(totals.variance)}
                  </td>
                  <td className='p-2 text-right tabular-nums'>
                    {formatMoney(totals.allocatedAmount)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {data && data.summary.byType.length > 0 && (
        <div
          className='grid grid-cols-2 gap-2 sm:grid-cols-4'
          data-testid='uat-budget-by-type'
        >
          {data.summary.byType.map((row) => (
            <div
              key={row.costType}
              className='rounded-md border px-3 py-2 text-xs'
            >
              <p className='font-medium'>{COST_TYPE_LABEL[row.costType]}</p>
              <p className='text-muted-foreground'>
                Revised {formatMoney(row.revisedBudget)} · Actual{' '}
                {formatMoney(row.actual)}
              </p>
            </div>
          ))}
        </div>
      )}

      <AuditHistoryPanel
        projectId={projectId}
        entityType='budget_line'
        title='Budget history'
        limit={8}
      />

      {dialog === 'line' && (
        <BudgetLineDialog
          key={`line-${nonce}`}
          projectId={projectId}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          line={editing}
          formatMoney={formatMoney}
        />
      )}
      {dialog === 'import' && (
        <BudgetImportDialog
          key={`import-${nonce}`}
          projectId={projectId}
          open
          onOpenChange={(open) => !open && setDialog(null)}
        />
      )}
      {dialog === 'transfer' && (
        <BudgetTransferDialog
          key={`transfer-${nonce}`}
          projectId={projectId}
          lines={lines.filter((line) => line.status === 'active')}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          formatMoney={formatMoney}
        />
      )}
      {dialog === 'codes' && (
        <BudgetCostCodesDialog
          key={`codes-${nonce}`}
          projectId={projectId}
          open
          onOpenChange={(open) => !open && setDialog(null)}
        />
      )}
      {dialog === 'reconciliation' && (
        <BudgetReconciliationDialog
          key={`rec-${nonce}`}
          projectId={projectId}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          formatMoney={formatMoney}
        />
      )}
      {dialog === 'snapshots' && (
        <BudgetSnapshotsDialog
          key={`snap-${nonce}`}
          projectId={projectId}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          canTake={canApprove}
          formatMoney={formatMoney}
        />
      )}
      <BudgetAllocationDialog
        key={allocating?.id ?? 'none'}
        projectId={projectId}
        line={allocating}
        onOpenChange={(open) => !open && setAllocating(null)}
        formatMoney={formatMoney}
      />
      <BudgetRevisionDialog
        key={`rev-${revising?.id ?? 'none'}`}
        projectId={projectId}
        line={revising}
        onOpenChange={(open) => !open && setRevising(null)}
      />
    </div>
  )
}
