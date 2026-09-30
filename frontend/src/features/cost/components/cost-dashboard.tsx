import { Fragment, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import {
  hasMoneyPrecision,
  MONEY_INPUT_STEP,
  MONEY_PRECISION_MESSAGE,
  toMoneyNumber,
} from '@/lib/money'
import { FINANCIAL_TERMS } from '@/lib/financial-terms'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import { DirectCostsPanel } from '@/features/direct-costs/components/direct-costs-panel'
import { useEquipmentUtilization } from '@/features/equipment/hooks/use-equipment'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import {
  type CostRecord,
  type CostRecordListQuery,
  useAddBurnRateEntry,
  useBurnRate,
  useCostRecords,
  useCostSummary,
  useUpdateCostRecord,
} from '../hooks/use-cost'
import { BudgetPanel } from './budget-panel'
import { TruthBadge } from './truth-badge'

const fmtUSD = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

const toNum = (value: string) => Number(value) || 0

// The server's reason beside a record budget it withholds (owner decision E1).
const MAPPING_DETAILS_WITHHELD = 'Mapping details unavailable to you'

const editableFields: Array<
  | 'labour'
  | 'material'
  | 'equipment'
  | 'subcontract'
  | 'indirect'
  | 'overhead'
  | 'contingency'
  | 'budget'
  | 'committed'
  | 'actual'
  | 'forecast'
> = [
  'labour',
  'material',
  'equipment',
  'subcontract',
  'indirect',
  'overhead',
  'contingency',
  'budget',
  'committed',
  'actual',
  'forecast',
]

const hasInvalidMoneyDraft = (draft: Partial<CostRecord>) =>
  editableFields.some(
    (field) =>
      draft[field] !== undefined && !hasMoneyPrecision(draft[field] as number)
  )

const toDateInputValue = (value?: string | null) =>
  value ? value.slice(0, 10) : ''

export function CostDashboard({
  projectId,
  activeTab,
  onTabChange,
  showTabList = true,
  initialTarget,
}: {
  projectId: string
  activeTab?: string
  onTabChange?: (value: string) => void
  showTabList?: boolean
  initialTarget?: ProjectSetupTarget
}) {
  const canUpdateCost = useCanPerform('cost', 'update', 'activity_cost.update')
  const canCreateBurnRate = useCanPerform('cost', 'create', 'burn_rate.create')
  const { data: summary, isLoading } = useCostSummary(projectId)
  const { data: burnRate } = useBurnRate(projectId)
  const { data: equipmentUtilization } = useEquipmentUtilization(projectId)
  const updateCostRecord = useUpdateCostRecord(projectId)
  const addBurnRateEntry = useAddBurnRateEntry(projectId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<CostRecord>>({})
  const [burnRateDate, setBurnRateDate] = useState('')
  const [burnRateAmount, setBurnRateAmount] = useState('')
  const [costSearch, setCostSearch] = useState('')
  const [costCategory, setCostCategory] = useState('all')
  const [costSortBy, setCostSortBy] = useState<CostRecordListQuery['sortBy']>(
    initialTarget?.source === 'cost_record.actual_through_date'
      ? 'actual'
      : 'activity'
  )
  const [costSortDir, setCostSortDir] = useState<
    CostRecordListQuery['sortDir']
  >(
    initialTarget?.source === 'cost_record.actual_through_date' ? 'desc' : 'asc'
  )
  const [costCursor, setCostCursor] = useState<string | null>(null)

  const costQuery = useMemo<CostRecordListQuery>(
    () => ({
      limit: 25,
      cursor: costCursor,
      search: costSearch,
      category: costCategory === 'all' ? undefined : costCategory,
      sortBy: costSortBy,
      sortDir: costSortDir,
    }),
    [costCategory, costCursor, costSearch, costSortBy, costSortDir]
  )
  const { data: costPage } = useCostRecords(projectId, costQuery)

  const rows = costPage?.rows || []
  const byPhase = useMemo(() => summary?.byPhase || [], [summary?.byPhase])
  const costCategories = useMemo(
    () => byPhase.map((phase) => phase.phase).filter(Boolean),
    [byPhase]
  )

  const totals = useMemo(() => summary?.totals, [summary?.totals])
  const eac = useMemo(() => summary?.eac, [summary?.eac])
  const budget = useMemo(() => summary?.budget, [summary?.budget])
  // Source / derived / projection per figure, as the server labels it (PC-7a).
  const truth = summary?.truth
  // What the summary adds up from the records' budgets (each activity's
  // approved BOQ allocation) — per phase, in total, and the forecast and EAC
  // that fall back to them — is withheld by the server from a member who may
  // not read the BOQ (owner decision E1): a dash and the server's reason,
  // never a figure read against 0.
  const activityBudgetsWithheld = Boolean(summary?.activityBudgetsWithheld)
  const withheldReason =
    summary?.activityBudgetsReason ?? MAPPING_DETAILS_WITHHELD
  const summaryFigure = (value: number | undefined) =>
    activityBudgetsWithheld || value === undefined ? '—' : fmtUSD(value)

  if (isLoading) {
    return (
      <p className='py-8 text-center text-muted-foreground'>
        Loading cost data…
      </p>
    )
  }

  if (!summary) {
    return (
      <p className='py-8 text-center text-muted-foreground'>
        No cost data available.
      </p>
    )
  }

  const tabsProps =
    activeTab !== undefined
      ? { value: activeTab, onValueChange: onTabChange }
      : { defaultValue: 'overview' }

  return (
    <div className='space-y-4'>
      <Tabs {...tabsProps} className='space-y-3'>
        {showTabList && (
          <TabsList className='flex-wrap'>
            <TabsTrigger value='overview'>Overview</TabsTrigger>
            <TabsTrigger value='activity'>By Activity</TabsTrigger>
            <TabsTrigger value='phase'>By Phase</TabsTrigger>
            <TabsTrigger value='equipment'>Equipment</TabsTrigger>
            <TabsTrigger value='burn'>Burn Rate</TabsTrigger>
            <TabsTrigger value='budget'>Budget</TabsTrigger>
            <TabsTrigger value='direct-costs'>Direct Costs</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value='direct-costs'>
          <DirectCostsPanel
            projectId={projectId}
            initialNew={initialTarget?.new === 'direct_cost'}
            initialRecordId={
              initialTarget?.source === 'direct_cost'
                ? initialTarget.recordId
                : undefined
            }
          />
        </TabsContent>

        <TabsContent value='overview' className='space-y-3'>
          {/* One budget vocabulary (Phase 22A): the same term means the same
              figure here, on the Budget tab and on the project header. */}
          <section
            className='rounded-lg border bg-card p-3'
            data-testid='cost-budget-summary'
          >
            <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
              {budget?.label ?? FINANCIAL_TERMS.budgetRegister.label}
              <TruthBadge truth={truth?.budget?.truth ?? 'derived'} />
            </p>
            <p className='text-xs text-muted-foreground'>
              As the budget register states it — original, approved changes,
              revisions, revised. Not the{' '}
              {FINANCIAL_TERMS.evBudgetAtCompletion.label} nor the{' '}
              {FINANCIAL_TERMS.contractWaterfall.label}.
            </p>
            <div className='mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4'>
              <CostFigure
                label='Original budget'
                truth='source'
                value={fmtUSD(budget?.originalBudget ?? 0)}
                hint='The approved starting budget'
              />
              <CostFigure
                label='Approved changes'
                truth='derived'
                value={fmtUSD(budget?.approvedChanges ?? 0)}
                hint='Approved change orders'
              />
              <CostFigure
                label='Revisions & transfers'
                truth='derived'
                value={fmtUSD(budget?.revisions ?? 0)}
                hint='Approved budget revisions and transfers'
              />
              <CostFigure
                label='Revised budget'
                truth='derived'
                value={fmtUSD(budget?.revisedBudget ?? 0)}
                hint='Original + approved changes + revisions'
                emphasis
              />
            </div>
          </section>

          <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
            <CostFigure
              label='Allocated to activities'
              truth={truth?.allocatedToActivities?.truth}
              value={summaryFigure(totals?.budget ?? 0)}
              hint={
                activityBudgetsWithheld
                  ? withheldReason
                  : 'Budget carried on activity cost records'
              }
              testId='uat-cost-allocated-to-activities'
            />
            <CostFigure
              label={FINANCIAL_TERMS.executedCommitments.label}
              value={fmtUSD(totals?.committed || 0)}
              truth={truth?.totals?.committed}
              hint={FINANCIAL_TERMS.executedCommitments.hint}
            />
            <CostFigure
              label='Actual cost'
              value={fmtUSD(totals?.actual || 0)}
              truth={truth?.totals?.actual}
              hint='Posted to the cost ledger to date'
            />
            <CostFigure
              label='Forecast (EAC)'
              truth={truth?.totals?.forecast}
              value={summaryFigure(eac?.mostLikely ?? totals?.forecast ?? 0)}
              hint={
                activityBudgetsWithheld
                  ? withheldReason
                  : 'Estimate at completion on activity cost records — never below actual cost'
              }
              testId='uat-cost-forecast-eac'
            />
          </div>

          {/* Estimate at completion: actual to date + cost to complete. The
              scenarios vary only the cost to complete, so they order
              optimistic ≤ most likely ≤ pessimistic and none sits below
              what has already been spent. */}
          <div
            className='grid grid-cols-1 gap-3 sm:grid-cols-3'
            data-testid='cost-eac-scenarios'
          >
            <ScenarioCard
              tone='good'
              label='Optimistic EAC'
              sub={activityBudgetsWithheld ? withheldReason : 'cost to complete −10%'}
              value={summaryFigure(eac?.optimistic ?? 0)}
            />
            <ScenarioCard
              tone='neutral'
              label='Most likely EAC'
              sub={
                activityBudgetsWithheld
                  ? withheldReason
                  : 'actual to date + cost to complete'
              }
              value={summaryFigure(eac?.mostLikely ?? 0)}
            />
            <ScenarioCard
              tone='risk'
              label='Pessimistic EAC'
              sub={activityBudgetsWithheld ? withheldReason : 'cost to complete +15%'}
              value={summaryFigure(eac?.pessimistic ?? 0)}
            />
          </div>
        </TabsContent>

        <TabsContent value='activity'>
          <div className='mb-2 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_repeat(3,max-content)]'>
            <Input
              placeholder='Search activity costs'
              value={costSearch}
              onChange={(e) => {
                setCostCursor(null)
                setCostSearch(e.target.value)
              }}
            />
            <Select
              value={costCategory}
              onValueChange={(value) => {
                setCostCursor(null)
                setCostCategory(value)
              }}
            >
              <SelectTrigger className='w-full md:w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All phases</SelectItem>
                {costCategories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={costSortBy}
              onValueChange={(value) => {
                setCostCursor(null)
                setCostSortBy(value as CostRecordListQuery['sortBy'])
              }}
            >
              <SelectTrigger className='w-full md:w-36'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='activity'>Activity</SelectItem>
                <SelectItem value='phase'>Phase</SelectItem>
                <SelectItem value='updated'>Updated</SelectItem>
                <SelectItem value='committed'>
                  {FINANCIAL_TERMS.executedCommitments.label}
                </SelectItem>
                <SelectItem value='actual'>Actual</SelectItem>
                <SelectItem value='forecast'>Forecast</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={costSortDir}
              onValueChange={(value) => {
                setCostCursor(null)
                setCostSortDir(value as CostRecordListQuery['sortDir'])
              }}
            >
              <SelectTrigger className='w-full md:w-28'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='asc'>Asc</SelectItem>
                <SelectItem value='desc'>Desc</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full text-sm whitespace-nowrap'>
              <thead className='border-b bg-muted/50'>
                <tr>
                  <th className='p-2 text-left font-medium'>Activity</th>
                  <th className='p-2 text-left font-medium'>Phase</th>
                  <th className='p-2 text-right font-medium'>Labour</th>
                  <th className='p-2 text-right font-medium'>Material</th>
                  <th className='p-2 text-right font-medium'>Equipment</th>
                  <th className='p-2 text-right font-medium'>Subcontract</th>
                  <th className='p-2 text-right font-medium'>Indirect</th>
                  <th className='p-2 text-right font-medium'>Overhead</th>
                  <th className='p-2 text-right font-medium'>Contingency</th>
                  <th className='p-2 text-right font-medium'>Budget</th>
                  <th
                    className='p-2 text-right font-medium'
                    title={FINANCIAL_TERMS.executedCommitments.hint}
                  >
                    {FINANCIAL_TERMS.executedCommitments.label}
                  </th>
                  <th className='p-2 text-right font-medium'>Actual</th>
                  <th className='p-2 text-right font-medium'>Actual Through</th>
                  <th className='p-2 text-right font-medium'>Forecast</th>
                  <th className='p-2 text-right font-medium'>Variance</th>
                  {canUpdateCost && (
                    <th className='p-2 text-right font-medium'>Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {!rows.length && (
                  <tr>
                    <td
                      className='p-4 text-center text-sm text-muted-foreground'
                      colSpan={canUpdateCost ? 16 : 15}
                    >
                      No cost records match the current filters.
                    </td>
                  </tr>
                )}
                {rows.map((row) => {
                  const isEditing = editingId === row.id
                  const current = isEditing
                    ? ({ ...row, ...draft } as CostRecord)
                    : row
                  // The record's budget is its activity's approved BOQ
                  // allocation: withheld by the server from a member who may
                  // not read the BOQ (owner decision E1). A dash and why —
                  // and no variance built from a budget this member was not
                  // given, never one read against 0.
                  const budgetWithheld = row.budget === undefined
                  const variance =
                    (Number(current.budget) || 0) -
                    (Number(current.forecast) || 0)

                  return (
                    <tr key={row.id} className='border-b hover:bg-muted/25'>
                      <td className='p-2 text-xs'>
                        {row.activity?.wbsCode
                          ? `${row.activity?.wbsCode} · `
                          : ''}
                        {row.activity?.name || '—'}
                      </td>
                      <td className='p-2 text-xs text-muted-foreground'>
                        {row.activity?.category || 'General'}
                      </td>
                      {editableFields.map((field) => (
                        <Fragment key={field}>
                          <td className='p-2 text-right'>
                            {field === 'budget' && budgetWithheld ? (
                              <span
                                className='text-xs text-muted-foreground'
                                data-testid='uat-cost-record-budget-withheld'
                              >
                                — {MAPPING_DETAILS_WITHHELD}
                              </span>
                            ) : isEditing &&
                            field !== 'actual' &&
                            !(field === 'committed' && row.committedDerived) ? (
                              <Input
                                type='number'
                                step={MONEY_INPUT_STEP}
                                className='h-8 w-24 text-right text-xs'
                                value={String(current[field] ?? 0)}
                                onChange={(e) =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    [field]: toNum(e.target.value),
                                  }))
                                }
                              />
                            ) : (
                              <span className='text-xs'>
                                {fmtUSD(Number(row[field] || 0))}
                              </span>
                            )}
                          </td>
                          {field === 'actual' && (
                            <td className='p-2 text-right'>
                              {isEditing ? (
                                <Input
                                  type='date'
                                  className='h-8 w-36 text-right text-xs'
                                  value={toDateInputValue(
                                    current.actualThroughDate
                                  )}
                                  onChange={(e) =>
                                    setDraft((prev) => ({
                                      ...prev,
                                      actualThroughDate: e.target.value || null,
                                    }))
                                  }
                                />
                              ) : (
                                <span className='text-xs text-muted-foreground'>
                                  {row.actualThroughDate
                                    ? new Date(
                                        row.actualThroughDate
                                      ).toLocaleDateString()
                                    : '-'}
                                </span>
                              )}
                            </td>
                          )}
                        </Fragment>
                      ))}
                      {budgetWithheld ? (
                        <td className='p-2 text-right text-xs text-muted-foreground'>
                          —
                        </td>
                      ) : (
                        <td
                          className={`p-2 text-right text-xs font-semibold ${variance < 0 ? 'text-red-600' : 'text-green-600'}`}
                        >
                          {fmtUSD(variance)}
                        </td>
                      )}
                      {canUpdateCost && (
                        <td className='p-2 text-right'>
                          {isEditing ? (
                            <div className='flex justify-end gap-1'>
                              <Button
                                size='sm'
                                variant='outline'
                                onClick={() => {
                                  setEditingId(null)
                                  setDraft({})
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size='sm'
                                disabled={updateCostRecord.isPending}
                                onClick={async () => {
                                  if (hasInvalidMoneyDraft(draft)) {
                                    toast.error(MONEY_PRECISION_MESSAGE)
                                    return
                                  }

                                  try {
                                    const moneyPayload = Object.fromEntries(
                                      editableFields
                                        .filter(
                                          (field) => draft[field] !== undefined
                                        )
                                        .map((field) => [
                                          field,
                                          toMoneyNumber(draft[field]),
                                        ])
                                    )
                                    await updateCostRecord.mutateAsync({
                                      costRecordId: row.id,
                                      payload: {
                                        ...moneyPayload,
                                        ...(draft.actualThroughDate !==
                                        undefined
                                          ? {
                                              actualThroughDate:
                                                draft.actualThroughDate,
                                            }
                                          : {}),
                                      },
                                    })
                                    toast.success('Cost record updated')
                                    setEditingId(null)
                                    setDraft({})
                                  } catch {
                                    toast.error('Failed to update cost record')
                                  }
                                }}
                              >
                                Save
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size='sm'
                              variant='ghost'
                              onClick={() => {
                                setEditingId(row.id)
                                setDraft({})
                              }}
                            >
                              Edit
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className='mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
            <span>{rows.length} cost records</span>
            <div className='flex gap-2'>
              {costCursor && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setCostCursor(null)}
                >
                  First page
                </Button>
              )}
              <Button
                size='sm'
                variant='outline'
                disabled={!costPage?.pagination?.nextCursor}
                onClick={() =>
                  setCostCursor(costPage?.pagination?.nextCursor ?? null)
                }
              >
                Next page
              </Button>
            </div>
          </div>
          <AuditHistoryPanel
            projectId={projectId}
            entityType='cost_record'
            title='Cost Record History'
            limit={8}
          />
        </TabsContent>

        <TabsContent value='phase'>
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full text-sm'>
              <thead className='border-b bg-muted/50'>
                <tr>
                  <th className='p-2 text-left font-medium'>Phase</th>
                  <th className='p-2 text-right font-medium'>Budget</th>
                  <th
                    className='p-2 text-right font-medium'
                    title={FINANCIAL_TERMS.executedCommitments.hint}
                  >
                    {FINANCIAL_TERMS.executedCommitments.label}
                  </th>
                  <th className='p-2 text-right font-medium'>Actual</th>
                  <th className='p-2 text-right font-medium'>Forecast</th>
                  <th className='p-2 text-right font-medium'>Variance $</th>
                  <th className='p-2 text-right font-medium'>Variance %</th>
                </tr>
              </thead>
              <tbody>
                {byPhase.map((phase) => {
                  // A phase's budget, forecast and variance are its
                  // activities' approved allocations: withheld from a member
                  // who may not read the BOQ (owner decision E1).
                  const withheld =
                    activityBudgetsWithheld || phase.budget === undefined
                  const dash = (
                    <span
                      className='text-muted-foreground'
                      title={withheldReason}
                      data-testid='uat-cost-phase-withheld'
                    >
                      —
                    </span>
                  )
                  return (
                    <tr
                      key={phase.phase}
                      className='border-b hover:bg-muted/25'
                    >
                      <td className='p-2 font-medium'>{phase.phase}</td>
                      <td className='p-2 text-right text-xs'>
                        {withheld ? dash : fmtUSD(phase.budget ?? 0)}
                      </td>
                      <td className='p-2 text-right text-xs'>
                        {fmtUSD(phase.committed)}
                      </td>
                      <td className='p-2 text-right text-xs'>
                        {fmtUSD(phase.actual)}
                      </td>
                      <td className='p-2 text-right text-xs'>
                        {withheld ? dash : fmtUSD(phase.forecast ?? 0)}
                      </td>
                      <td className='p-2 text-right text-xs'>
                        {withheld ? dash : fmtUSD(phase.variance ?? 0)}
                      </td>
                      <td className='p-2 text-right text-xs'>
                        {withheld
                          ? dash
                          : `${(phase.variancePct ?? 0).toFixed(1)}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {activityBudgetsWithheld && (
            <p
              className='mt-2 text-xs text-muted-foreground'
              data-testid='uat-cost-phase-withheld-reason'
            >
              — {withheldReason}: a phase&apos;s budget, forecast and
              variance are its activities&apos; BOQ allocations.
            </p>
          )}
        </TabsContent>

        <TabsContent value='equipment' className='space-y-3'>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-4'>
            <div className='rounded-md border bg-card p-3'>
              <p className='text-xs text-muted-foreground'>Approved Hours</p>
              <p className='mt-1 text-lg font-bold'>
                {Number(equipmentUtilization?.totals.hours || 0).toLocaleString(
                  undefined,
                  { maximumFractionDigits: 1 }
                )}
              </p>
            </div>
            <div className='rounded-md border bg-card p-3'>
              <p className='text-xs text-muted-foreground'>Posted Cost</p>
              <p className='mt-1 text-lg font-bold'>
                {fmtUSD(equipmentUtilization?.totals.costAmount || 0)}
              </p>
            </div>
            <div className='rounded-md border bg-card p-3'>
              <p className='text-xs text-muted-foreground'>Activities</p>
              <p className='mt-1 text-lg font-bold'>
                {equipmentUtilization?.totals.activityCount || 0}
              </p>
            </div>
            <div className='rounded-md border bg-card p-3'>
              <p className='text-xs text-muted-foreground'>Unpriced Hours</p>
              <p className='mt-1 text-lg font-bold'>
                {Number(
                  equipmentUtilization?.totals.unpricedHours || 0
                ).toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </p>
            </div>
          </div>

          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full text-sm'>
              <thead className='border-b bg-muted/50'>
                <tr>
                  <th className='p-2 text-left font-medium'>Activity</th>
                  <th className='p-2 text-left font-medium'>Equipment</th>
                  <th className='p-2 text-right font-medium'>Hours</th>
                  <th className='p-2 text-right font-medium'>Cost</th>
                  <th className='p-2 text-right font-medium'>Daily Reports</th>
                </tr>
              </thead>
              <tbody>
                {equipmentUtilization?.byActivity.length ? (
                  equipmentUtilization.byActivity.map((row) => (
                    <tr key={row.activityId} className='border-b'>
                      <td className='p-2 text-xs'>
                        {row.wbsCode ? `${row.wbsCode} - ` : ''}
                        {row.activityName}
                      </td>
                      <td className='p-2 text-xs text-muted-foreground'>
                        {Array.from(
                          new Set(
                            row.equipment.map((item) => item.equipmentName)
                          )
                        )
                          .slice(0, 3)
                          .join(', ') || '-'}
                      </td>
                      <td className='p-2 text-right text-xs'>
                        {Number(row.hours).toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}
                      </td>
                      <td className='p-2 text-right text-xs'>
                        {fmtUSD(row.costAmount)}
                      </td>
                      <td className='p-2 text-right text-xs'>
                        {row.usageCount}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      className='p-4 text-center text-sm text-muted-foreground'
                      colSpan={5}
                    >
                      No approved equipment usage has posted to cost yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <AuditHistoryPanel
            projectId={projectId}
            entityType='activity_equipment_usage'
            title='Equipment Usage History'
            limit={8}
          />
        </TabsContent>

        <TabsContent value='burn' className='space-y-3'>
          <div className='rounded-md border p-3'>
            <p className='mb-2 text-sm font-semibold'>Daily Burn Rate</p>
            <ResponsiveContainer width='100%' height={260}>
              <LineChart data={burnRate?.data || []}>
                <CartesianGrid strokeDasharray='3 3' />
                <XAxis dataKey='date' />
                <YAxis
                  tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
                />
                <Tooltip formatter={(v) => fmtUSD(Number(v || 0))} />
                <Line
                  dataKey='actual'
                  stroke='#EF4444'
                  name='Daily Spend'
                  strokeWidth={2}
                />
                <Line
                  dataKey='budget'
                  stroke='#3B82F6'
                  strokeDasharray='4 4'
                  name='Budget Rate'
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {canCreateBurnRate && (
            <div className='flex flex-wrap items-end gap-2 rounded-md border p-3'>
              <div>
                <p className='mb-1 text-xs text-muted-foreground'>Date</p>
                <Input
                  type='date'
                  value={burnRateDate}
                  onChange={(e) => setBurnRateDate(e.target.value)}
                />
              </div>
              <div>
                <p className='mb-1 text-xs text-muted-foreground'>Amount</p>
                <Input
                  type='number'
                  min={0}
                  step={MONEY_INPUT_STEP}
                  value={burnRateAmount}
                  onChange={(e) => setBurnRateAmount(e.target.value)}
                />
              </div>
              <Button
                disabled={addBurnRateEntry.isPending || !burnRateAmount}
                onClick={async () => {
                  if (!hasMoneyPrecision(burnRateAmount)) {
                    toast.error(MONEY_PRECISION_MESSAGE)
                    return
                  }

                  try {
                    await addBurnRateEntry.mutateAsync({
                      date: burnRateDate || undefined,
                      amount: toMoneyNumber(burnRateAmount),
                    })
                    setBurnRateAmount('')
                    toast.success('Burn rate entry added')
                  } catch {
                    toast.error('Failed to add burn rate entry')
                  }
                }}
              >
                Add Entry
              </Button>
            </div>
          )}
          <AuditHistoryPanel
            projectId={projectId}
            entityType='burn_rate_entry'
            title='Burn Rate History'
            limit={8}
          />
        </TabsContent>

        <TabsContent value='budget' className='space-y-3'>
          <BudgetPanel projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function CostFigure({
  label,
  value,
  hint,
  emphasis = false,
  testId,
  truth,
}: {
  label: string
  value: string
  hint?: string
  emphasis?: boolean
  testId?: string
  /** The server's truth label: source, derived or projection:<basis> (PC-7a). */
  truth?: string
}) {
  return (
    <div
      className={emphasis ? 'rounded-lg border-2 border-primary/40 bg-card p-3' : 'rounded-lg border bg-card p-3'}
      title={hint}
      data-testid={testId}
    >
      <p className='text-xs text-muted-foreground'>
        {label}
        <TruthBadge truth={truth} />
      </p>
      <p className='text-lg font-bold'>{value}</p>
      {hint && <p className='text-[11px] text-muted-foreground'>{hint}</p>}
    </div>
  )
}

function ScenarioCard({
  tone,
  label,
  sub,
  value,
}: {
  tone: 'good' | 'neutral' | 'risk'
  label: string
  sub: string
  value: string
}) {
  const toneClass =
    tone === 'good'
      ? 'border-green-300 bg-green-50 text-green-700'
      : tone === 'risk'
        ? 'border-red-300 bg-red-50 text-red-700'
        : 'border-border bg-card text-foreground'
  return (
    <div className={`rounded-lg border p-4 text-center ${toneClass}`}>
      <p className='text-xs'>{label}</p>
      <p className='text-2xl font-bold'>{value}</p>
      <p className='text-[11px] opacity-80'>{sub}</p>
    </div>
  )
}

