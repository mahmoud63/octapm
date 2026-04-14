import { useMemo, useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type CostRecord,
  useAddBurnRateEntry,
  useBurnRate,
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
  const { data: summary, isLoading } = useCostSummary(projectId)
  const { data: burnRate } = useBurnRate(projectId)
  const updateCostRecord = useUpdateCostRecord(projectId)
  const addBurnRateEntry = useAddBurnRateEntry(projectId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<CostRecord>>({})
  const [burnRateDate, setBurnRateDate] = useState('')
  const [burnRateAmount, setBurnRateAmount] = useState('')

  const rows = summary?.records || []
  const byPhase = summary?.byPhase || []

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
                  <th className='p-2 text-right font-medium'>Forecast</th>
                  <th className='p-2 text-right font-medium'>Variance</th>
                  <th className='p-2 text-right font-medium'>Actions</th>
                </tr>
              </thead>
              <tbody>
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
                        <td key={field} className='p-2 text-right'>
                          {isEditing ? (
                            <Input
                              type='number'
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
                      ))}
                      <td
                        className={`p-2 text-right text-xs font-semibold ${variance < 0 ? 'text-red-600' : 'text-green-600'}`}
                      >
                        {fmtUSD(variance)}
                      </td>
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
                                try {
                                  await updateCostRecord.mutateAsync({
                                    costRecordId: row.id,
                                    payload: draft,
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
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
                value={burnRateAmount}
                onChange={(e) => setBurnRateAmount(e.target.value)}
              />
            </div>
            <Button
              disabled={addBurnRateEntry.isPending || !burnRateAmount}
              onClick={async () => {
                try {
                  await addBurnRateEntry.mutateAsync({
                    date: burnRateDate || undefined,
                    amount: Number(burnRateAmount) || 0,
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
        </TabsContent>
      </Tabs>
    </div>
  )
}
