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
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type CostRecord,
  type CostRecordListQuery,
  useAddBurnRateEntry,
  useBurnRate,
  useCostRecords,
  useCostSummary,
  useUpdateCostRecord,
} from '../hooks/use-cost'

const fmtUSD = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

const toNum = (value: string) => Number(value) || 0

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
}: {
  projectId: string
  activeTab?: string
  onTabChange?: (value: string) => void
  showTabList?: boolean
}) {
  const canUpdateCost = useCanPerform('cost', 'update', 'activity_cost.update')
  const canCreateBurnRate = useCanPerform('cost', 'create', 'burn_rate.create')
  const { data: summary, isLoading } = useCostSummary(projectId)
  const { data: burnRate } = useBurnRate(projectId)
  const updateCostRecord = useUpdateCostRecord(projectId)
  const addBurnRateEntry = useAddBurnRateEntry(projectId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<CostRecord>>({})
  const [burnRateDate, setBurnRateDate] = useState('')
  const [burnRateAmount, setBurnRateAmount] = useState('')
  const [costSearch, setCostSearch] = useState('')
  const [costCategory, setCostCategory] = useState('all')
  const [costSortBy, setCostSortBy] =
    useState<CostRecordListQuery['sortBy']>('activity')
  const [costSortDir, setCostSortDir] =
    useState<CostRecordListQuery['sortDir']>('asc')
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
            <TabsTrigger value='burn'>Burn Rate</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value='overview' className='space-y-3'>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
            <div className='rounded-lg border border-green-300 bg-green-50 p-4 text-center'>
              <p className='text-xs text-green-700'>Optimistic (-10%)</p>
              <p className='text-2xl font-bold text-green-700'>
                {fmtUSD(eac?.optimistic || 0)}
              </p>
            </div>
            <div className='rounded-lg border p-4 text-center'>
              <p className='text-xs text-muted-foreground'>Most Likely</p>
              <p className='text-2xl font-bold'>
                {fmtUSD(eac?.mostLikely || 0)}
              </p>
            </div>
            <div className='rounded-lg border border-red-300 bg-red-50 p-4 text-center'>
              <p className='text-xs text-red-700'>Pessimistic (+15%)</p>
              <p className='text-2xl font-bold text-red-700'>
                {fmtUSD(eac?.pessimistic || 0)}
              </p>
            </div>
          </div>

          <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
            <div className='rounded-lg border bg-card p-3'>
              <p className='text-xs text-muted-foreground'>Budget</p>
              <p className='text-lg font-bold'>{fmtUSD(totals?.budget || 0)}</p>
            </div>
            <div className='rounded-lg border bg-card p-3'>
              <p className='text-xs text-muted-foreground'>Committed</p>
              <p className='text-lg font-bold'>
                {fmtUSD(totals?.committed || 0)}
              </p>
            </div>
            <div className='rounded-lg border bg-card p-3'>
              <p className='text-xs text-muted-foreground'>Actual</p>
              <p className='text-lg font-bold'>{fmtUSD(totals?.actual || 0)}</p>
            </div>
            <div className='rounded-lg border bg-card p-3'>
              <p className='text-xs text-muted-foreground'>Forecast</p>
              <p className='text-lg font-bold'>
                {fmtUSD(totals?.forecast || 0)}
              </p>
            </div>
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
                <SelectItem value='committed'>Committed</SelectItem>
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
                  <th className='p-2 text-right font-medium'>Committed</th>
                  <th className='p-2 text-right font-medium'>Actual</th>
                  <th className='p-2 text-right font-medium'>
                    Actual Through
                  </th>
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
                            {isEditing ? (
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
                                      actualThroughDate:
                                        e.target.value || null,
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
                      <td
                        className={`p-2 text-right text-xs font-semibold ${variance < 0 ? 'text-red-600' : 'text-green-600'}`}
                      >
                        {fmtUSD(variance)}
                      </td>
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
                                          (field) =>
                                            draft[field] !== undefined
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
                  <th className='p-2 text-right font-medium'>Committed</th>
                  <th className='p-2 text-right font-medium'>Actual</th>
                  <th className='p-2 text-right font-medium'>Forecast</th>
                  <th className='p-2 text-right font-medium'>Variance $</th>
                  <th className='p-2 text-right font-medium'>Variance %</th>
                </tr>
              </thead>
              <tbody>
                {byPhase.map((phase) => (
                  <tr key={phase.phase} className='border-b hover:bg-muted/25'>
                    <td className='p-2 font-medium'>{phase.phase}</td>
                    <td className='p-2 text-right text-xs'>
                      {fmtUSD(phase.budget)}
                    </td>
                    <td className='p-2 text-right text-xs'>
                      {fmtUSD(phase.committed)}
                    </td>
                    <td className='p-2 text-right text-xs'>
                      {fmtUSD(phase.actual)}
                    </td>
                    <td className='p-2 text-right text-xs'>
                      {fmtUSD(phase.forecast)}
                    </td>
                    <td className='p-2 text-right text-xs'>
                      {fmtUSD(phase.variance)}
                    </td>
                    <td className='p-2 text-right text-xs'>
                      {phase.variancePct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      </Tabs>
    </div>
  )
}
