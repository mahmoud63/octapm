import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  shiftDate,
  todayKey,
  useManpowerReport,
  type ManpowerReport as ManpowerReportData,
} from '../hooks/use-daily-log'

const GROUPS: Array<{ value: ManpowerReportData['groupBy']; label: string }> = [
  { value: 'company', label: 'By company' },
  { value: 'trade', label: 'By trade' },
  { value: 'company_trade', label: 'By company and trade' },
  { value: 'activity', label: 'By activity' },
]

/** Manpower across days from the daily log (OCTA-FLD-DAILY-022 acceptance 1). */
export function ManpowerReport({ projectId }: { projectId: string }) {
  const [from, setFrom] = useState(shiftDate(todayKey(), -30))
  const [to, setTo] = useState(todayKey())
  const [groupBy, setGroupBy] =
    useState<ManpowerReportData['groupBy']>('company')
  const { data, isLoading } = useManpowerReport(projectId, {
    from,
    to,
    groupBy,
  })

  return (
    <div className='space-y-3' data-testid='uat-manpower-report'>
      <div className='flex flex-wrap items-end gap-3'>
        <div className='space-y-1'>
          <Label htmlFor='mp-from'>From</Label>
          <Input
            id='mp-from'
            type='date'
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='mp-to'>To</Label>
          <Input
            id='mp-to'
            type='date'
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className='space-y-1'>
          <Label>Group</Label>
          <Select
            value={groupBy}
            onValueChange={(value) =>
              setGroupBy(value as ManpowerReportData['groupBy'])
            }
          >
            <SelectTrigger className='w-52' data-testid='uat-manpower-groupby'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUPS.map((group) => (
                <SelectItem key={group.value} value={group.value}>
                  {group.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {data && (
          <p className='ml-auto text-sm text-muted-foreground'>
            {data.totals.days} days · {data.totals.workers} worker-days ·{' '}
            {data.totals.manHours.toLocaleString()} man-hours
          </p>
        )}
      </div>
      {isLoading ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          Loading…
        </p>
      ) : !data || data.items.length === 0 ? (
        <p className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>
          No manpower logged in this range.
        </p>
      ) : (
        <>
          <div className='h-56 rounded-md border p-2'>
            <ResponsiveContainer width='100%' height='100%'>
              <BarChart
                data={data.byDate}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray='3 3'
                  stroke='currentColor'
                  opacity={0.15}
                />
                <XAxis
                  dataKey='date'
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value: string) => value.slice(5)}
                />
                <YAxis tick={{ fontSize: 11 }} width={36} />
                <Tooltip
                  formatter={(value) => [String(value ?? ''), 'Workers']}
                />
                <Bar
                  dataKey='workers'
                  name='workers'
                  fill='currentColor'
                  className='text-primary'
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full text-sm'>
              <thead className='bg-muted/40 text-xs'>
                <tr>
                  <th className='p-2 text-left'>
                    {groupBy === 'trade'
                      ? 'Trade'
                      : groupBy === 'activity'
                        ? 'Activity'
                        : 'Company'}
                  </th>
                  {groupBy === 'company_trade' && (
                    <th className='p-2 text-left'>Trade</th>
                  )}
                  <th className='p-2 text-right'>Days</th>
                  <th className='p-2 text-right'>Worker-days</th>
                  <th className='p-2 text-right'>Avg / day</th>
                  <th className='p-2 text-right'>Man-hours</th>
                  <th className='p-2 text-right'>Share</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr
                    key={row.key}
                    className='border-t'
                    data-testid='uat-manpower-row'
                  >
                    <td className='p-2'>
                      {groupBy === 'company_trade'
                        ? row.companyName
                        : row.label}
                    </td>
                    {groupBy === 'company_trade' && (
                      <td className='p-2'>{row.trade}</td>
                    )}
                    <td className='p-2 text-right tabular-nums'>{row.days}</td>
                    <td className='p-2 text-right tabular-nums'>
                      {row.workers}
                    </td>
                    <td className='p-2 text-right tabular-nums'>
                      {row.avgWorkersPerDay}
                    </td>
                    <td className='p-2 text-right tabular-nums'>
                      {row.manHours.toLocaleString()}
                    </td>
                    <td className='p-2 text-right tabular-nums'>
                      {data.totals.manHours
                        ? `${Math.round((row.manHours / data.totals.manHours) * 100)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
