import { useState } from 'react'
import { CheckCircle2, Loader2, Lock, Send } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type {
  BoqBaselineState,
  BoqRevisionStatus,
  BoqRevisionSummary,
} from '../data/schema'
import {
  useApproveBoqRevision,
  useLockBoqBaseline,
  useSubmitBoqRevision,
} from '../hooks/use-boq'

interface Props {
  projectId: string
  revisions: BoqRevisionSummary[]
  baseline?: BoqBaselineState
  currentRevisionId?: string | null
  currency: string
}

const STATUS_LABELS: Record<BoqRevisionStatus, string> = {
  imported: 'Imported',
  comparison_only: 'Comparison only',
  under_review: 'Under review',
  approved: 'Approved',
  baselined: 'Baselined',
  superseded: 'Superseded',
}

const STATUS_CLASS: Record<BoqRevisionStatus, string> = {
  imported: 'border-slate-300 bg-slate-100 text-slate-700',
  comparison_only: 'border-zinc-300 bg-zinc-100 text-zinc-700',
  under_review: 'border-amber-300 bg-amber-100 text-amber-800',
  approved: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  baselined: 'border-blue-300 bg-blue-100 text-blue-800',
  superseded: 'border-zinc-300 bg-zinc-100 text-zinc-700',
}

const fmtMoney = (value: number, currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

const fmtDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : '—'

/**
 * The bill's revisions and where each one stands in its review.
 *
 * Submit, approve and lock appear only for the step a revision is at and
 * only when the policy allows the person that action; the API decides
 * again on every call, so a button is a convenience, never the permission.
 * The lock is irreversible — a locked bill has no unlock, as a baselined
 * schedule has none — so it asks before it acts.
 */
export function BoqRevisionPanel({
  projectId,
  revisions,
  baseline,
  currentRevisionId,
  currency,
}: Props) {
  const canSubmit = useCanPerform('boq', 'submit')
  const canApprove = useCanPerform('boq', 'approve')
  const submit = useSubmitBoqRevision(projectId)
  const approve = useApproveBoqRevision(projectId)
  const lock = useLockBoqBaseline(projectId)
  const [lockTarget, setLockTarget] = useState<BoqRevisionSummary | null>(null)
  const [lockComment, setLockComment] = useState('')

  const locked = Boolean(baseline?.locked)
  const busy = submit.isPending || approve.isPending || lock.isPending

  const closeLock = () => {
    setLockTarget(null)
    setLockComment('')
  }

  const handleLock = async () => {
    if (!lockTarget) return
    try {
      await lock.mutateAsync({ revisionId: lockTarget.id, comment: lockComment })
      closeLock()
    } catch {
      // the hook has already shown the API's reason
    }
  }

  if (revisions.length === 0) return null

  return (
    <div className='rounded-lg border bg-card'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3'>
        <div>
          <h3 className='text-sm font-semibold'>BOQ Revisions</h3>
          <p className='text-xs text-muted-foreground'>
            Each upload is a revision. Submit it for review, approve it, then
            lock the baseline; a locked bill accepts later uploads for
            comparison only.
          </p>
        </div>
        {locked ? (
          <Badge
            variant='outline'
            className='border-blue-300 bg-blue-50 text-blue-800'
            data-testid='boq-baseline-lock'
          >
            <Lock className='size-3' />
            Baseline locked
            {baseline?.source === 'schedule_baseline'
              ? ' by the schedule baseline'
              : baseline?.revisionNumber
                ? ` on revision ${baseline.revisionNumber}`
                : ''}
            {baseline?.lockedAt ? ` · ${fmtDate(baseline.lockedAt)}` : ''}
          </Badge>
        ) : (
          <Badge variant='outline' data-testid='boq-baseline-lock'>
            Baseline open
          </Badge>
        )}
      </div>

      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/40 text-xs text-muted-foreground'>
            <tr>
              <th className='px-4 py-2 text-left font-medium'>Rev</th>
              <th className='px-4 py-2 text-left font-medium'>Label</th>
              <th className='px-4 py-2 text-left font-medium'>Status</th>
              <th className='px-4 py-2 text-right font-medium'>Rows</th>
              <th className='px-4 py-2 text-right font-medium'>
                Added / Updated / Removed
              </th>
              <th className='px-4 py-2 text-right font-medium'>Total</th>
              <th className='px-4 py-2 text-left font-medium'>Uploaded</th>
              <th className='px-4 py-2 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {revisions.map((revision) => {
              const isCurrent = revision.id === currentRevisionId
              const showSubmit = canSubmit && revision.status === 'imported'
              const showApprove =
                canApprove && revision.status === 'under_review'
              const showLock =
                canApprove && revision.status === 'approved' && !locked
              return (
                <tr
                  key={revision.id}
                  className='border-t'
                  data-testid={`boq-revision-${revision.revisionNumber}`}
                  data-status={revision.status}
                >
                  <td className='px-4 py-2 font-medium'>
                    {revision.revisionNumber}
                    {isCurrent && (
                      <span className='ml-1 text-xs text-muted-foreground'>
                        current
                      </span>
                    )}
                  </td>
                  <td className='px-4 py-2'>{revision.label || '—'}</td>
                  <td className='px-4 py-2'>
                    <Badge
                      variant='outline'
                      className={cn(STATUS_CLASS[revision.status])}
                    >
                      {revision.baselineLocked && <Lock className='size-3' />}
                      {STATUS_LABELS[revision.status]}
                    </Badge>
                  </td>
                  <td className='px-4 py-2 text-right tabular-nums'>
                    {revision.itemCount}
                  </td>
                  <td className='px-4 py-2 text-right tabular-nums'>
                    <span className='text-emerald-700'>
                      +{revision.addedCount}
                    </span>
                    {' / '}
                    <span className='text-amber-700'>
                      ~{revision.updatedCount}
                    </span>
                    {' / '}
                    <span className='text-rose-700'>
                      −{revision.removedCount}
                    </span>
                  </td>
                  <td className='px-4 py-2 text-right tabular-nums'>
                    {fmtMoney(Number(revision.totalAmount), currency)}
                  </td>
                  <td className='px-4 py-2 text-muted-foreground'>
                    {fmtDate(revision.createdAt)}
                  </td>
                  <td className='px-4 py-2'>
                    <div className='flex justify-end gap-1'>
                      {showSubmit && (
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={busy}
                          onClick={() =>
                            submit.mutate({ revisionId: revision.id })
                          }
                        >
                          <Send className='size-3.5' />
                          Submit
                        </Button>
                      )}
                      {showApprove && (
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={busy}
                          onClick={() =>
                            approve.mutate({ revisionId: revision.id })
                          }
                        >
                          <CheckCircle2 className='size-3.5' />
                          Approve
                        </Button>
                      )}
                      {showLock && (
                        <Button
                          size='sm'
                          disabled={busy}
                          onClick={() => setLockTarget(revision)}
                        >
                          <Lock className='size-3.5' />
                          Lock baseline
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(lockTarget)} onOpenChange={(open) => !open && closeLock()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Lock the BOQ baseline on revision {lockTarget?.revisionNumber}?
            </DialogTitle>
            <DialogDescription>
              Rows can no longer be edited and later uploads are saved for
              comparison only. There is no unlock.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={lockComment}
            onChange={(event) => setLockComment(event.target.value)}
            placeholder='Comment (optional)'
            rows={3}
          />
          <DialogFooter>
            <Button variant='outline' onClick={closeLock} disabled={lock.isPending}>
              Cancel
            </Button>
            <Button onClick={handleLock} disabled={lock.isPending}>
              {lock.isPending ? (
                <Loader2 className='size-3.5 animate-spin' />
              ) : (
                <Lock className='size-3.5' />
              )}
              Lock baseline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
