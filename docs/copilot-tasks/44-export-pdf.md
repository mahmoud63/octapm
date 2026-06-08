# Task 44 — PDF Export (BR-010)

## Gap Covered
- PDF export of project schedule report via browser print / Puppeteer

## BRD Refs
- BR-010: Export to XLSX and PDF

## DB Schema Changes
None.

## Backend Changes

### Option A — Browser-side print (recommended, no extra deps)
No backend changes needed. Frontend generates a print-optimised view and calls `window.print()`.

### Option B — Server-side PDF via Puppeteer (if stakeholders need server-generated PDFs)
```bash
npm install puppeteer --workspace=backend
```

For Phase 1 use Option A (browser print). Option B can be added later.

### New endpoint (Option B, for reference): `GET /projects/:projectId/export/pdf`
Skip implementing for now — add TODO comment in `backend/src/routes/export.js`:

```js
// TODO (Phase 2): PDF export via Puppeteer
// router.get('/pdf', asyncHandler(async (req, res) => { ... }));
```

## Frontend Changes

### New file: `frontend/src/features/projects/components/print-report.tsx`

```tsx
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

interface Props { projectId: string }

/**
 * A hidden print-optimized view injected into the DOM on demand.
 * Triggered by PrintReportButton — renders schedule table then calls window.print().
 */
export function PrintReport({ projectId, project }: Props & { project: any }) {
  const { data: scheduleData } = useQuery({
    queryKey: ['activities', projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/activities`).then(r => r.data.data),
  })

  const activities = scheduleData?.activities ?? []
  const criticalCount = activities.filter((a: any) => a.isCritical).length

  return (
    <div id='print-report' className='hidden print:block p-8 font-sans text-sm'>
      {/* Print CSS */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-report, #print-report * { visibility: visible; }
          #print-report { position: fixed; top: 0; left: 0; width: 100%; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ccc; padding: 4px 6px; font-size: 10px; }
          th { background: #1e3a5f; color: white; }
          .critical-row td { background: #fff0f0; }
          .page-break { page-break-after: always; }
        }
      `}</style>

      {/* Cover */}
      <div className='text-center mb-8'>
        <h1 className='text-2xl font-bold'>{project?.name ?? 'Project'}</h1>
        <p className='text-gray-500 mt-1'>Schedule Report — {new Date().toLocaleDateString('en-GB')}</p>
        <div className='grid grid-cols-3 gap-4 mt-4 text-center'>
          <div><p className='text-xl font-bold'>{activities.length}</p><p className='text-xs'>Total Activities</p></div>
          <div><p className='text-xl font-bold text-red-600'>{criticalCount}</p><p className='text-xs'>Critical Activities</p></div>
          <div>
            <p className='text-xl font-bold'>
              {activities.length ? Math.round(activities.reduce((s: number, a: any) => s + (a.percentComplete ?? 0), 0) / activities.length) : 0}%
            </p>
            <p className='text-xs'>Avg. Progress</p>
          </div>
        </div>
      </div>

      <div className='page-break' />

      {/* Master Schedule table */}
      <h2 className='text-lg font-bold mb-2'>Master Schedule</h2>
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
          {activities.map((a: any) => (
            <tr key={a.id} className={a.isCritical ? 'critical-row' : ''}>
              <td>{a.activityId}</td>
              <td>{a.name}</td>
              <td>{a.duration}d</td>
              <td>{a.earlyStart ? new Date(a.earlyStart).toLocaleDateString('en-GB') : '—'}</td>
              <td>{a.earlyFinish ? new Date(a.earlyFinish).toLocaleDateString('en-GB') : '—'}</td>
              <td>{a.totalFloat}</td>
              <td>{a.percentComplete ?? 0}%</td>
              <td>{a.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className='page-break' />

      {/* Critical Path table */}
      <h2 className='text-lg font-bold mb-2'>Critical Path</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Activity Name</th><th>Duration</th><th>Early Start</th><th>Early Finish</th><th>%</th>
          </tr>
        </thead>
        <tbody>
          {activities.filter((a: any) => a.isCritical).map((a: any) => (
            <tr key={a.id}>
              <td>{a.activityId}</td>
              <td>{a.name}</td>
              <td>{a.duration}d</td>
              <td>{a.earlyStart ? new Date(a.earlyStart).toLocaleDateString('en-GB') : '—'}</td>
              <td>{a.earlyFinish ? new Date(a.earlyFinish).toLocaleDateString('en-GB') : '—'}</td>
              <td>{a.percentComplete ?? 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

### New file: `frontend/src/features/projects/components/print-report-button.tsx`

```tsx
import { Button } from '@/components/ui/button'

interface Props { onClick: () => void }

export function PrintReportButton({ onClick }: Props) {
  return (
    <Button variant='outline' onClick={onClick}>
      ↓ Export PDF
    </Button>
  )
}
```

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
Add print logic to the schedule dashboard:

```tsx
// Add state
const [showPrint, setShowPrint] = useState(false)

// Add button in toolbar alongside Export XLSX
<PrintReportButton onClick={() => { setShowPrint(true); setTimeout(() => window.print(), 300) }} />

// Add PrintReport component (rendered but hidden unless printing)
{showPrint && <PrintReport projectId={projectId} project={project} />}
```

The `setTimeout` gives React time to render the print DOM before `window.print()` fires.

## Acceptance Criteria
- [ ] "Export PDF" button appears in schedule dashboard toolbar
- [ ] Clicking prints a formatted report with cover page, Master Schedule table, Critical Path table
- [ ] Critical activities shown with red background in print view
- [ ] Columns: ID, Activity Name, Duration, Early Start, Early Finish, TF, %, Status
- [ ] Print view hidden in normal UI (only visible during print)
- [ ] Page breaks between sections
