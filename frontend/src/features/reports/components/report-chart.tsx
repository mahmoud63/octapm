import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  ReportChart as ChartConfig,
  ReportResult,
} from '../hooks/use-report-builder'

const PALETTE = [
  '#2563eb',
  '#16a34a',
  '#f59e0b',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#ea580c',
  '#475569',
]

/** Chart of the grouped result: one bar / point / slice per group on the chosen metric. */
export function ReportChart({
  result,
  chart,
}: {
  result: ReportResult
  chart: ChartConfig | null | undefined
}) {
  if (!chart || chart.type === 'none') return null
  if (!result.groups?.length) {
    return (
      <p className='rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground'>
        Group the rows to chart them.
      </p>
    )
  }
  const metric = chart.metric || 'count'
  const label =
    result.aggregates.find((item) => item.key === metric)?.label ?? 'Count'
  const data = result.groups
    .slice(0, 40)
    .map((group) => ({ name: group.label, value: Number(group[metric] ?? 0) }))
  return (
    <div className='h-64 rounded-md border p-2' data-testid='uat-report-chart'>
      <ResponsiveContainer width='100%' height='100%'>
        {chart.type === 'pie' ? (
          <PieChart>
            <Pie
              data={data}
              dataKey='value'
              nameKey='name'
              outerRadius={90}
              label={(entry) => entry.name}
            >
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={PALETTE[index % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => [String(value ?? ''), label]} />
          </PieChart>
        ) : chart.type === 'line' ? (
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray='3 3'
              stroke='currentColor'
              opacity={0.15}
            />
            <XAxis dataKey='name' tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={48} />
            <Tooltip formatter={(value) => [String(value ?? ''), label]} />
            <Line type='monotone' dataKey='value' stroke='#2563eb' dot />
          </LineChart>
        ) : (
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray='3 3'
              stroke='currentColor'
              opacity={0.15}
            />
            <XAxis dataKey='name' tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={48} />
            <Tooltip formatter={(value) => [String(value ?? ''), label]} />
            <Bar dataKey='value' radius={[2, 2, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={PALETTE[index % PALETTE.length]} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
