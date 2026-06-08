import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ScheduleActivity, ScheduleRevision } from '../data/schema'
import {
  useScheduleRevision,
  useScheduleRevisions,
  type ScheduleRevisionDetail,
} from '../hooks/use-revisions'

interface Props {
  projectId: string
  currentRevision: ScheduleRevision
  currentActivities: ScheduleActivity[]
}

function fmtUSD(n: number) {
  return (
    '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
  )
}

function getSnapshotActivities(detail?: ScheduleRevisionDetail | null) {
  const raw = detail?.snapshotJson
  if (!raw || typeof raw !== 'object') return [] as Array<{ name: string }>

  const activities = (raw as { activities?: unknown }).activities
  if (!Array.isArray(activities)) return []

  return activities
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const name = String((item as { name?: unknown }).name || '').trim()
      return name ? { name } : null
    })
    .filter((item): item is { name: string } => Boolean(item))
}

export function RevisionHistoryPanel({
  projectId,
  currentRevision,
  currentActivities,
}: Props) {
  const { data: revisions, isLoading } = useScheduleRevisions(projectId)
  const [viewRevisionId, setViewRevisionId] = useState<string | null>(null)
  const [compareRevisionId, setCompareRevisionId] = useState<string | null>(
    null
  )

  const { data: viewedRevision, isLoading: loadingViewed } =
    useScheduleRevision(projectId, viewRevisionId)
  const { data: comparedRevision, isLoading: loadingCompared } =
    useScheduleRevision(projectId, compareRevisionId)

  const currentNames = useMemo(() => {
    return new Set(
      currentActivities
        .map((a) => a.name?.trim())
        .filter((name): name is string => Boolean(name))
    )
  }, [currentActivities])

  const diff = useMemo(() => {
    if (!comparedRevision) {
      return {
        added: [] as string[],
        removed: [] as string[],
      }
    }

    const selectedNames = new Set(
      getSnapshotActivities(comparedRevision)
        .map((a) => a.name)
        .filter(Boolean)
    )

    const added = [...currentNames].filter((name) => !selectedNames.has(name))
    const removed = [...selectedNames].filter((name) => !currentNames.has(name))

    return { added, removed }
  }, [comparedRevision, currentNames])

  return (
    <div className='space-y-4'>
      <div className='rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left font-medium'>Date</th>
              <th className='p-2 text-left font-medium'>Label</th>
              <th className='p-2 text-right font-medium'>Activities</th>
              <th className='p-2 text-right font-medium'>Critical</th>
              <th className='p-2 text-right font-medium'>Budget</th>
              <th className='p-2 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={6}
                  className='p-3 text-center text-muted-foreground'
                >
                  Loading revisions...
                </td>
              </tr>
            ) : !revisions?.length ? (
              <tr>
                <td
                  colSpan={6}
                  className='p-3 text-center text-muted-foreground'
                >
                  No revisions yet.
                </td>
              </tr>
            ) : (
              revisions.map((rev) => (
                <tr
                  key={rev.id}
                  className={[
                    'border-b hover:bg-muted/25',
                    rev.id === currentRevision.id ? 'bg-primary/5' : '',
                  ].join(' ')}
                >
                  <td className='p-2 text-xs'>
                    {new Date(rev.createdAt).toLocaleString()}
                  </td>
                  <td className='p-2'>
                    <span className='font-medium'>
                      {rev.label || 'AI Generated'}
                    </span>
                    {rev.id === currentRevision.id && (
                      <span className='ms-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary'>
                        Current
                      </span>
                    )}
                  </td>
                  <td className='p-2 text-right font-mono text-xs'>
                    {rev.activityCount}
                  </td>
                  <td className='p-2 text-right font-mono text-xs'>
                    {rev.criticalCount}
                  </td>
                  <td className='p-2 text-right text-xs'>
                    {fmtUSD(rev.totalBudget)}
                  </td>
                  <td className='p-2 text-right'>
                    <div className='inline-flex gap-2'>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => setViewRevisionId(rev.id)}
                      >
                        View
                      </Button>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => setCompareRevisionId(rev.id)}
                        disabled={rev.id === currentRevision.id}
                      >
                        Compare
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        <div className='rounded-lg border p-4'>
          <p className='mb-2 text-sm font-semibold'>Selected Snapshot</p>
          {!viewRevisionId ? (
            <p className='text-sm text-muted-foreground'>
              Choose View on a revision to inspect its saved snapshot.
            </p>
          ) : loadingViewed ? (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Loader2 className='h-4 w-4 animate-spin' />
              Loading snapshot...
            </div>
          ) : viewedRevision ? (
            <div className='space-y-2 text-sm'>
              <p>
                <span className='text-muted-foreground'>Label:</span>{' '}
                <strong>{viewedRevision.label || 'AI Generated'}</strong>
              </p>
              <p>
                <span className='text-muted-foreground'>Activities:</span>{' '}
                <strong>{viewedRevision.activityCount}</strong>
              </p>
              <p>
                <span className='text-muted-foreground'>Critical:</span>{' '}
                <strong>{viewedRevision.criticalCount}</strong>
              </p>
              <p>
                <span className='text-muted-foreground'>Budget:</span>{' '}
                <strong>{fmtUSD(viewedRevision.totalBudget)}</strong>
              </p>

              <div className='mt-3 rounded-md border bg-muted/20 p-2'>
                <p className='mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
                  Activity Names
                </p>
                <div className='max-h-40 space-y-1 overflow-auto'>
                  {getSnapshotActivities(viewedRevision)
                    .slice(0, 20)
                    .map((a) => (
                      <p key={a.name} className='text-xs'>
                        {a.name}
                      </p>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <p className='text-sm text-muted-foreground'>Revision not found.</p>
          )}
        </div>

        <div className='rounded-lg border p-4'>
          <p className='mb-2 text-sm font-semibold'>
            Comparison Against Current
          </p>
          {!compareRevisionId ? (
            <p className='text-sm text-muted-foreground'>
              Choose Compare on a revision to see deltas.
            </p>
          ) : loadingCompared ? (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Loader2 className='h-4 w-4 animate-spin' />
              Building comparison...
            </div>
          ) : comparedRevision ? (
            <div className='space-y-3 text-sm'>
              <div className='grid grid-cols-3 gap-2'>
                <div className='rounded-md border bg-muted/20 p-2'>
                  <p className='text-xs text-muted-foreground'>
                    Activity Delta
                  </p>
                  <p className='text-lg font-semibold'>
                    {currentRevision.activityCount -
                      comparedRevision.activityCount}
                  </p>
                </div>
                <div className='rounded-md border bg-muted/20 p-2'>
                  <p className='text-xs text-muted-foreground'>
                    Critical Delta
                  </p>
                  <p className='text-lg font-semibold'>
                    {currentRevision.criticalCount -
                      comparedRevision.criticalCount}
                  </p>
                </div>
                <div className='rounded-md border bg-muted/20 p-2'>
                  <p className='text-xs text-muted-foreground'>Budget Delta</p>
                  <p className='text-lg font-semibold'>
                    {fmtUSD(
                      currentRevision.totalBudget - comparedRevision.totalBudget
                    )}
                  </p>
                </div>
              </div>

              <div className='grid gap-3 md:grid-cols-2'>
                <div className='rounded-md border p-2'>
                  <p className='mb-1 text-xs font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300'>
                    Added in Current ({diff.added.length})
                  </p>
                  <div className='max-h-40 space-y-1 overflow-auto'>
                    {diff.added.length === 0 ? (
                      <p className='text-xs text-muted-foreground'>
                        No added activities
                      </p>
                    ) : (
                      diff.added.slice(0, 30).map((name) => (
                        <p key={name} className='text-xs'>
                          {name}
                        </p>
                      ))
                    )}
                  </div>
                </div>

                <div className='rounded-md border p-2'>
                  <p className='mb-1 text-xs font-semibold tracking-wide text-rose-700 uppercase dark:text-rose-300'>
                    Removed from Current ({diff.removed.length})
                  </p>
                  <div className='max-h-40 space-y-1 overflow-auto'>
                    {diff.removed.length === 0 ? (
                      <p className='text-xs text-muted-foreground'>
                        No removed activities
                      </p>
                    ) : (
                      diff.removed.slice(0, 30).map((name) => (
                        <p key={name} className='text-xs'>
                          {name}
                        </p>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className='text-sm text-muted-foreground'>Revision not found.</p>
          )}
        </div>
      </div>
    </div>
  )
}
