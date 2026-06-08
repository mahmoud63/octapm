import type { ScheduleActivity } from '../data/schema'

interface Props {
  projectName: string
  projectStartDate?: string | null
  activities: ScheduleActivity[]
}

function toDateLabel(
  projectStartDate: string | null | undefined,
  day: number | null
) {
  if (!projectStartDate || day === null) return '—'
  const d = new Date(projectStartDate)
  d.setDate(d.getDate() + day)
  return d.toLocaleDateString('en-GB')
}

export function PrintReport({
  projectName,
  projectStartDate,
  activities,
}: Props) {
  const criticalCount = activities.filter((item) => item.isCritical).length
  const avgProgress = activities.length
    ? Math.round(
        activities.reduce(
          (sum, item) => sum + Number(item.pctComplete || 0),
          0
        ) / activities.length
      )
    : 0

  return (
    <div id='print-report' className='hidden p-8 text-sm print:block'>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-report, #print-report * { visibility: visible; }
          #print-report { position: fixed; top: 0; left: 0; width: 100%; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #d1d5db; padding: 4px 6px; font-size: 10px; }
          th { background: #1e3a5f; color: #fff; }
          .critical-row td { background: #fff0f0; }
          .page-break { page-break-after: always; }
        }
      `}</style>

      <div className='mb-8 text-center'>
        <h1 className='text-2xl font-bold'>{projectName || 'Project'}</h1>
        <p className='mt-1 text-gray-600'>
          Schedule Report - {new Date().toLocaleDateString('en-GB')}
        </p>
        <div className='mt-4 grid grid-cols-3 gap-4 text-center'>
          <div>
            <p className='text-xl font-bold'>{activities.length}</p>
            <p className='text-xs'>Total Activities</p>
          </div>
          <div>
            <p className='text-xl font-bold text-red-600'>{criticalCount}</p>
            <p className='text-xs'>Critical Activities</p>
          </div>
          <div>
            <p className='text-xl font-bold'>{avgProgress}%</p>
            <p className='text-xs'>Avg Progress</p>
          </div>
        </div>
      </div>

      <div className='page-break' />

      <h2 className='mb-2 text-lg font-bold'>Master Schedule</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Activity Name</th>
            <th>Duration</th>
            <th>Early Start</th>
            <th>Early Finish</th>
            <th>TF</th>
            <th>%</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((item) => (
            <tr key={item.id} className={item.isCritical ? 'critical-row' : ''}>
              <td>{item.wbsCode || item.id.slice(0, 8)}</td>
              <td>{item.name}</td>
              <td>{item.duration}d</td>
              <td>{toDateLabel(projectStartDate, item.earlyStart)}</td>
              <td>{toDateLabel(projectStartDate, item.earlyFinish)}</td>
              <td>{item.totalFloat ?? '—'}</td>
              <td>{item.pctComplete}%</td>
              <td>{item.status.replace('_', ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className='page-break' />

      <h2 className='mb-2 text-lg font-bold'>Critical Path</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Activity Name</th>
            <th>Duration</th>
            <th>Early Start</th>
            <th>Early Finish</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {activities
            .filter((item) => item.isCritical)
            .map((item) => (
              <tr key={item.id}>
                <td>{item.wbsCode || item.id.slice(0, 8)}</td>
                <td>{item.name}</td>
                <td>{item.duration}d</td>
                <td>{toDateLabel(projectStartDate, item.earlyStart)}</td>
                <td>{toDateLabel(projectStartDate, item.earlyFinish)}</td>
                <td>{item.pctComplete}%</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
