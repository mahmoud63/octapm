import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useCanPerform } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type { ScheduleActivity, ScheduleRevision } from '../data/schema'
import {
  useScheduleRevision,
  useScheduleRevisionMapping,
  useScheduleRevisionWorkflow,
  useScheduleRevisions,
  type ScheduleRevisionDetail,
} from '../hooks/use-revisions'

interface Props {
  projectId: string
  currentRevision: ScheduleRevision
  currentActivities: ScheduleActivity[]
}

// A budget withheld from this member (no BOQ or cost access) is absent from
// the answer and reads as a dash, never as $0.
function fmtUSD(n: number | null | undefined) {
  if (n === undefined) return '—'
  return (
    '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
  )
}

const getApiErrorMessage = (error: unknown, fallback: string) =>
  typeof error === 'object' &&
  error !== null &&
  'response' in error &&
  typeof (error as { response?: { data?: { error?: { message?: unknown } } } })
    .response?.data?.error?.message === 'string'
    ? String(
        (error as { response?: { data?: { error?: { message?: unknown } } } })
          .response?.data?.error?.message
      )
    : fallback

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  baselined: 'Baselined',
  superseded: 'Superseded',
}

const STATUS_CLASS: Record<string, string> = {
  draft: 'border-slate-300 bg-slate-100 text-slate-700',
  under_review: 'border-amber-300 bg-amber-100 text-amber-800',
  approved: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  rejected: 'border-rose-300 bg-rose-100 text-rose-800',
  baselined: 'border-blue-300 bg-blue-100 text-blue-800',
  superseded: 'border-zinc-300 bg-zinc-100 text-zinc-700',
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
  const canActivateRevision = useCanPerform(
    'schedule',
    'approve',
    'revision.activate'
  )
  const canRollbackRevision = useCanPerform(
    'schedule',
    'approve',
    'revision.rollback'
  )
  const { data: revisions, isLoading } = useScheduleRevisions(projectId)
  const [viewRevisionId, setViewRevisionId] = useState<string | null>(null)
  const [compareRevisionId, setCompareRevisionId] = useState<string | null>(
    null
  )
  const [activateRevisionId, setActivateRevisionId] = useState<string | null>(
    null
  )
  const [rollbackRevisionId, setRollbackRevisionId] = useState<string | null>(
    null
  )
  const [removalReason, setRemovalReason] = useState('')
  const [rollbackReason, setRollbackReason] = useState('')

  const { data: viewedRevision, isLoading: loadingViewed } =
    useScheduleRevision(projectId, viewRevisionId)
  const { data: comparedRevision, isLoading: loadingCompared } =
    useScheduleRevision(projectId, compareRevisionId)
  const { data: activationMapping, isLoading: loadingActivationMapping } =
    useScheduleRevisionMapping(projectId, activateRevisionId)
  const workflow = useScheduleRevisionWorkflow(projectId)

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

  const closeActivation = () => {
    setActivateRevisionId(null)
    setRemovalReason('')
  }

  const closeRollback = () => {
    setRollbackRevisionId(null)
    setRollbackReason('')
  }

  const handleActivate = async () => {
    if (!activateRevisionId || !activationMapping) return
    const reason = removalReason.trim()
    if (activationMapping.unmappedExisting.length > 0 && !reason) {
      toast.error('Removal reason is required')
      return
    }

    try {
      await workflow.activate.mutateAsync({
        revisionId: activateRevisionId,
        mappings: activationMapping.suggestedMappings.map((mapping) => ({
          oldActivityId: mapping.oldActivityId,
          newActivityKey: mapping.newActivityKey,
        })),
        unmappedRemovals: activationMapping.unmappedExisting
          .filter((activity) => activity.id)
          .map((activity) => ({
            oldActivityId: String(activity.id),
            reason,
          })),
        comment: reason || 'Approved schedule activation',
      })
      toast.success('Schedule revision activated')
      closeActivation()
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to activate revision'))
    }
  }

  const handleRollback = async () => {
    if (!rollbackRevisionId) return
    const reason = rollbackReason.trim()
    if (!reason) {
      toast.error('Rollback reason is required')
      return
    }

    try {
      await workflow.rollback.mutateAsync({
        revisionId: rollbackRevisionId,
        reason,
      })
      toast.success('Schedule revision rolled back')
      closeRollback()
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to roll back revision'))
    }
  }

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
              <th className='p-2 text-left font-medium'>Status</th>
              <th className='p-2 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={7}
                  className='p-3 text-center text-muted-foreground'
                >
                  Loading revisions...
                </td>
              </tr>
            ) : !revisions?.length ? (
              <tr>
                <td
                  colSpan={7}
                  className='p-3 text-center text-muted-foreground'
                >
                  No revisions yet.
                </td>
              </tr>
            ) : (
              revisions.map((rev) => {
                const status = rev.status || 'draft'
                const statusDate =
                  rev.baselinedAt ||
                  rev.approvedAt ||
                  rev.rejectedAt ||
                  rev.submittedAt ||
                  null

                return (
                  <tr
                    key={rev.id}
                    className={[
                      'border-b hover:bg-muted/25',
                      rev.isActive || rev.id === currentRevision.id
                        ? 'bg-primary/5'
                        : '',
                    ].join(' ')}
                  >
                    <td className='p-2 text-xs'>
                      {new Date(rev.createdAt).toLocaleString()}
                    </td>
                    <td className='p-2'>
                      <span className='font-medium'>
                        {rev.label || 'AI Generated'}
                      </span>
                      {(rev.isActive || rev.id === currentRevision.id) && (
                        <span className='ms-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary'>
                          Active
                        </span>
                      )}
                      {rev.rejectionReason && (
                        <p className='mt-1 max-w-72 truncate text-xs text-rose-600'>
                          {rev.rejectionReason}
                        </p>
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
                    <td className='p-2'>
                      <Badge
                        variant='outline'
                        className={STATUS_CLASS[status] ?? STATUS_CLASS.draft}
                      >
                        {STATUS_LABELS[status] ?? 'Draft'}
                      </Badge>
                      {statusDate && (
                        <p className='mt-1 text-[11px] text-muted-foreground'>
                          {new Date(statusDate).toLocaleString()}
                        </p>
                      )}
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
                        {canActivateRevision &&
                          rev.status === 'approved' &&
                          !rev.isActive && (
                            <Button
                              size='sm'
                              onClick={() => setActivateRevisionId(rev.id)}
                            >
                              Activate
                            </Button>
                          )}
                        {canRollbackRevision &&
                          rev.isActive &&
                          rev.previousActiveRevisionId && (
                            <Button
                              size='sm'
                              variant='outline'
                              onClick={() => setRollbackRevisionId(rev.id)}
                            >
                              Rollback
                            </Button>
                          )}
                      </div>
                    </td>
                  </tr>
                )
              })
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
              <p>
                <span className='text-muted-foreground'>Status:</span>{' '}
                <strong>
                  {STATUS_LABELS[viewedRevision.status || 'draft'] ?? 'Draft'}
                </strong>
                {viewedRevision.isActive ? ' · Active' : ''}
              </p>
              {viewedRevision.activatedAt && (
                <p>
                  <span className='text-muted-foreground'>Activated:</span>{' '}
                  {new Date(viewedRevision.activatedAt).toLocaleString()}
                </p>
              )}
              {viewedRevision.rejectionReason && (
                <p className='text-rose-700 dark:text-rose-300'>
                  <span className='text-muted-foreground'>Reason:</span>{' '}
                  {viewedRevision.rejectionReason}
                </p>
              )}

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
              <HistoryPanel
                projectId={projectId}
                entityType='schedule_revision'
                entityId={viewedRevision.id}
                title='Revision History'
                limit={30}
              />
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
                    {currentRevision.totalBudget !== undefined &&
                    comparedRevision.totalBudget !== undefined
                      ? fmtUSD(
                          currentRevision.totalBudget -
                            comparedRevision.totalBudget
                        )
                      : '—'}
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

      <Dialog
        open={Boolean(activateRevisionId)}
        onOpenChange={(open) => {
          if (!open) closeActivation()
        }}
      >
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Activate Revision</DialogTitle>
          </DialogHeader>
          {loadingActivationMapping ? (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Loader2 className='h-4 w-4 animate-spin' />
              Loading mapping...
            </div>
          ) : activationMapping ? (
            <div className='space-y-4'>
              <div className='grid grid-cols-3 gap-2 text-sm'>
                <div className='rounded-md border p-2'>
                  <p className='text-xs text-muted-foreground'>Mapped</p>
                  <p className='text-lg font-semibold'>
                    {activationMapping.counts.suggestedMappings}
                  </p>
                </div>
                <div className='rounded-md border p-2'>
                  <p className='text-xs text-muted-foreground'>New</p>
                  <p className='text-lg font-semibold'>
                    {activationMapping.counts.newActivities}
                  </p>
                </div>
                <div className='rounded-md border p-2'>
                  <p className='text-xs text-muted-foreground'>Retiring</p>
                  <p className='text-lg font-semibold'>
                    {activationMapping.counts.unmappedExisting}
                  </p>
                </div>
              </div>

              <div className='max-h-44 overflow-auto rounded-md border'>
                <table className='w-full text-xs'>
                  <thead className='border-b bg-muted/50'>
                    <tr>
                      <th className='p-2 text-left font-medium'>Current</th>
                      <th className='p-2 text-left font-medium'>Staged</th>
                      <th className='p-2 text-left font-medium'>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activationMapping.suggestedMappings
                      .slice(0, 12)
                      .map((mapping) => (
                        <tr key={mapping.oldActivityId} className='border-b'>
                          <td className='p-2'>{mapping.oldActivity.name}</td>
                          <td className='p-2'>{mapping.newActivity.name}</td>
                          <td className='p-2'>
                            {mapping.matchType.replace(/_/g, ' ')}
                          </td>
                        </tr>
                      ))}
                    {activationMapping.suggestedMappings.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className='p-3 text-center text-muted-foreground'
                        >
                          No mapped activities
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {activationMapping.unmappedExisting.length > 0 && (
                <div className='space-y-2'>
                  <p className='text-sm font-medium'>
                    Removal reason for unmapped activities
                  </p>
                  <Textarea
                    value={removalReason}
                    onChange={(event) => setRemovalReason(event.target.value)}
                    rows={3}
                  />
                  <div className='max-h-24 overflow-auto rounded-md border p-2 text-xs text-muted-foreground'>
                    {activationMapping.unmappedExisting
                      .slice(0, 12)
                      .map((activity) => (
                        <p key={activity.id}>{activity.name}</p>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className='text-sm text-muted-foreground'>
              Mapping unavailable.
            </p>
          )}
          <DialogFooter>
            <Button variant='outline' onClick={closeActivation}>
              Cancel
            </Button>
            <Button
              onClick={handleActivate}
              disabled={
                workflow.activate.isPending ||
                loadingActivationMapping ||
                !activationMapping
              }
            >
              {workflow.activate.isPending ? 'Activating...' : 'Activate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(rollbackRevisionId)}
        onOpenChange={(open) => {
          if (!open) closeRollback()
        }}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>Rollback Revision</DialogTitle>
          </DialogHeader>
          <div className='space-y-2'>
            <p className='text-sm font-medium'>Rollback reason</p>
            <Textarea
              value={rollbackReason}
              onChange={(event) => setRollbackReason(event.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={closeRollback}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleRollback}
              disabled={workflow.rollback.isPending}
            >
              {workflow.rollback.isPending ? 'Rolling back...' : 'Rollback'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
