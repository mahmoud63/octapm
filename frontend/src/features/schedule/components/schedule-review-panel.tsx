import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  GitBranch,
  Loader2,
  Lock,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCanPerform } from '@/lib/permissions'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useProjectSetupReadiness } from '@/features/projects/hooks/use-projects'
import type { ScheduleRevision } from '../data/schema'
import {
  useScheduleRevisionWorkflow,
  type ScheduleRevisionStatus,
} from '../hooks/use-revisions'

interface Props {
  projectId: string
  revision: ScheduleRevision
}

type DialogMode = 'submit' | 'approve' | 'reject' | 'baseline' | null

const STATUS_META: Record<
  ScheduleRevisionStatus,
  { label: string; className: string }
> = {
  draft: {
    label: 'Draft',
    className: 'border-slate-300 bg-slate-100 text-slate-700',
  },
  under_review: {
    label: 'Under review',
    className: 'border-amber-300 bg-amber-100 text-amber-800',
  },
  approved: {
    label: 'Approved',
    className: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  },
  rejected: {
    label: 'Rejected',
    className: 'border-rose-300 bg-rose-100 text-rose-800',
  },
  baselined: {
    label: 'Baselined',
    className: 'border-blue-300 bg-blue-100 text-blue-800',
  },
  superseded: {
    label: 'Superseded',
    className: 'border-zinc-300 bg-zinc-100 text-zinc-700',
  },
}

const formatDateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : 'Not recorded'

const getApiErrorMessage = (error: unknown, fallback: string) =>
  (error as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message ?? fallback

function getNextActionLabel(status: ScheduleRevisionStatus, ready: boolean) {
  if (status === 'draft') return 'Next: submit for review'
  if (status === 'rejected') return 'Next: resubmit for review'
  if (status === 'under_review') {
    return ready ? 'Next: approve or reject' : 'Next: clear readiness blockers'
  }
  if (status === 'approved') {
    return ready ? 'Next: lock baseline' : 'Next: clear readiness blockers'
  }
  if (status === 'baselined') return 'Baseline locked'
  return 'No action available'
}

function WorkflowDialog({
  mode,
  open,
  isPending,
  value,
  onValueChange,
  onOpenChange,
  onConfirm,
}: {
  mode: DialogMode
  open: boolean
  isPending: boolean
  value: string
  onValueChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const copy = {
    submit: {
      title: 'Submit Schedule Review',
      description: 'Attach reviewer context for this revision.',
      label: 'Review comment',
      action: 'Submit',
    },
    approve: {
      title: 'Approve Schedule',
      description: 'Record the approval decision for this revision.',
      label: 'Approval comment',
      action: 'Approve',
    },
    reject: {
      title: 'Reject Schedule',
      description: 'Record the reason this revision needs more work.',
      label: 'Rejection reason',
      action: 'Reject',
    },
    baseline: {
      title: 'Lock Baseline',
      description: 'Approved CPM dates will become the project baseline.',
      label: 'Baseline comment',
      action: 'Lock baseline',
    },
  }

  if (!mode) return null

  const current = copy[mode]
  const requiresValue = mode === 'reject'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.description}</DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          <Label htmlFor='schedule-review-note'>{current.label}</Label>
          <Textarea
            id='schedule-review-note'
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            rows={4}
            maxLength={2000}
            placeholder={requiresValue ? 'Required' : 'Optional'}
          />
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type='button'
            onClick={onConfirm}
            disabled={isPending || (requiresValue && !value.trim())}
          >
            {isPending && <Loader2 className='h-4 w-4 animate-spin' />}
            {current.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ScheduleReviewPanel({ projectId, revision }: Props) {
  const status = (revision.status || 'draft') as ScheduleRevisionStatus
  const readiness = revision.readiness ?? null
  const { data: setupReadiness } = useProjectSetupReadiness(projectId)
  const explanation = revision.criticalPathExplanation ?? null
  const isReady = Boolean(readiness?.ready)
  const baselineGate = setupReadiness?.gates.baseline
  const baselineBlockers = baselineGate?.blockers ?? []
  const setupBaselineBlocked = Boolean(
    baselineGate && !baselineGate.ready && !baselineGate.alreadyLocked
  )
  const meta = STATUS_META[status]
  const workflow = useScheduleRevisionWorkflow(projectId)
  const canSubmitRevision = useCanPerform(
    'schedule',
    'submit',
    'revision.submit_review'
  )
  const canApproveRevision = useCanPerform(
    'schedule',
    'approve',
    'revision.approve'
  )
  const canRejectRevision = useCanPerform(
    'schedule',
    'approve',
    'revision.reject'
  )
  const canBaselineRevision = useCanPerform(
    'schedule',
    'baseline',
    'revision.baseline'
  )
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [note, setNote] = useState('')

  const openDialog = (mode: DialogMode) => {
    setDialogMode(mode)
    setNote('')
  }

  const closeDialog = () => {
    setDialogMode(null)
    setNote('')
  }

  const handleConfirm = async () => {
    if (!dialogMode) return

    try {
      if (dialogMode === 'submit') {
        await workflow.submitReview.mutateAsync({
          revisionId: revision.id,
          comment: note,
        })
        toast.success('Schedule submitted for review')
      } else if (dialogMode === 'approve') {
        await workflow.approve.mutateAsync({
          revisionId: revision.id,
          comment: note,
        })
        toast.success('Schedule approved')
      } else if (dialogMode === 'reject') {
        await workflow.reject.mutateAsync({
          revisionId: revision.id,
          reason: note,
        })
        toast.success('Schedule rejected')
      } else if (dialogMode === 'baseline') {
        await workflow.baseline.mutateAsync({
          revisionId: revision.id,
          comment: note,
        })
        toast.success('Baseline locked')
      }
      closeDialog()
    } catch (error) {
      // The server's reason, once (the workflow hook keeps the global handler
      // quiet), and the panel re-reads the revision and its readiness.
      toast.error(getApiErrorMessage(error, 'Schedule workflow action failed'))
      closeDialog()
    }
  }

  const canSubmit =
    canSubmitRevision && (status === 'draft' || status === 'rejected')
  const canReview =
    status === 'under_review' && (canApproveRevision || canRejectRevision)
  const canBaseline =
    canBaselineRevision && status === 'approved' && isReady && !setupBaselineBlocked

  return (
    <section
      className='rounded-lg border bg-card p-4'
      data-testid='uat-schedule-review'
      data-status={status}
    >
      <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
        <div className='min-w-0 space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <ClipboardCheck className='h-4 w-4 text-primary' />
            <h3 className='text-sm font-semibold'>Schedule Review</h3>
            <Badge variant='outline' className={meta.className}>
              {meta.label}
            </Badge>
            <span className='text-xs text-muted-foreground'>
              {getNextActionLabel(status, isReady)}
            </span>
          </div>
          <div className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
            <span>Revision: {revision.label || 'Current schedule'}</span>
            <span>Created: {formatDateTime(revision.createdAt)}</span>
            {revision.approvedAt && (
              <span>Approved: {formatDateTime(revision.approvedAt)}</span>
            )}
            {revision.baselinedAt && (
              <span>Baselined: {formatDateTime(revision.baselinedAt)}</span>
            )}
            {revision.rejectedAt && (
              <span>Rejected: {formatDateTime(revision.rejectedAt)}</span>
            )}
          </div>
          {revision.rejectionReason && status === 'rejected' && (
            <p className='text-xs font-medium text-rose-700 dark:text-rose-300'>
              Reason: {revision.rejectionReason}
            </p>
          )}
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {canSubmit && (
            <Button
              size='sm'
              onClick={() => openDialog('submit')}
              disabled={workflow.isPending}
            >
              <Send className='h-4 w-4' />
              Submit Review
            </Button>
          )}
          {canReview && (
            <>
              {canApproveRevision && (
                <Button
                  size='sm'
                  onClick={() => openDialog('approve')}
                  disabled={workflow.isPending || !isReady}
                >
                  <ShieldCheck className='h-4 w-4' />
                  Approve
                </Button>
              )}
              {canRejectRevision && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => openDialog('reject')}
                  disabled={workflow.isPending}
                >
                  <XCircle className='h-4 w-4' />
                  Reject
                </Button>
              )}
            </>
          )}
          {canBaselineRevision && status === 'approved' && (
            <Button
              size='sm'
              onClick={() => openDialog('baseline')}
              disabled={workflow.isPending || !canBaseline}
            >
              <Lock className='h-4 w-4' />
              Lock Baseline
            </Button>
          )}
        </div>
      </div>

      {status === 'approved' && setupBaselineBlocked && (
        <div className='mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100'>
          <div className='flex items-start gap-2'>
            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
            <div className='min-w-0'>
              <p className='font-semibold'>Baseline setup blockers</p>
              <p className='mt-1 text-xs opacity-90'>
                {baselineGate?.message}
              </p>
              <ul className='mt-2 list-inside list-disc space-y-1 text-xs'>
                {baselineBlockers.slice(0, 4).map((blocker) => (
                  <li key={`${blocker.stepKey}-${blocker.code}`}>
                    {blocker.stepLabel}: {blocker.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {explanation && (
        <div className='mt-4 rounded-md border'>
          <div className='flex items-center justify-between border-b px-3 py-2'>
            <div className='flex items-center gap-2 text-xs font-semibold'>
              <GitBranch className='h-4 w-4 text-primary' />
              Critical Path Explanation
            </div>
            {!explanation.error && (
              <span className='text-xs text-muted-foreground'>
                {(explanation.dependencyCount ?? 0).toLocaleString()} links
              </span>
            )}
          </div>
          {explanation.error ? (
            <div className='px-3 py-3 text-sm text-muted-foreground'>
              {explanation.error.message}
            </div>
          ) : (
            <div className='grid gap-3 p-3 lg:grid-cols-[1.25fr_1fr]'>
              <div className='min-w-0'>
                <p className='mb-2 text-xs font-semibold text-muted-foreground'>
                  Driving chain
                </p>
                <div className='space-y-2'>
                  {(explanation.chain ?? []).slice(0, 8).map((item, index) => (
                    <div
                      key={item.activityId}
                      className='grid grid-cols-[28px_1fr] gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-xs'
                    >
                      <span className='flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground'>
                        {index + 1}
                      </span>
                      <div className='min-w-0'>
                        <p className='truncate font-medium'>{item.name}</p>
                        <p className='truncate text-muted-foreground'>
                          {item.driver?.reason ?? 'No driving predecessor'} - TF{' '}
                          {item.totalFloat ?? '-'}d
                        </p>
                      </div>
                    </div>
                  ))}
                  {!explanation.chain?.length && (
                    <p className='text-xs text-muted-foreground'>
                      No critical chain available.
                    </p>
                  )}
                </div>
              </div>

              <div className='min-w-0'>
                <p className='mb-2 text-xs font-semibold text-muted-foreground'>
                  Float drivers
                </p>
                <div className='space-y-2'>
                  {(explanation.floatDrivers ?? []).slice(0, 5).map((item) => (
                    <div
                      key={item.activityId}
                      className='rounded-md bg-muted/30 px-2 py-1.5 text-xs'
                    >
                      <p className='truncate font-medium'>{item.name}</p>
                      <p className='truncate text-muted-foreground'>
                        TF {item.totalFloat ?? '-'}d -{' '}
                        {item.driver?.reason ?? 'Project finish controls float'}
                      </p>
                    </div>
                  ))}
                  {!explanation.floatDrivers?.length && (
                    <p className='text-xs text-muted-foreground'>
                      No non-critical float drivers.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className='mt-4 rounded-md border'>
        <div className='flex items-center justify-between border-b px-3 py-2'>
          <div className='flex items-center gap-2 text-xs font-semibold'>
            {isReady ? (
              <CheckCircle2 className='h-4 w-4 text-emerald-600' />
            ) : (
              <AlertTriangle className='h-4 w-4 text-amber-600' />
            )}
            Readiness
          </div>
          <span
            className='text-xs text-muted-foreground'
            data-testid='uat-schedule-review-blocking'
          >
            {readiness ? `${readiness.blockingCount} blocking` : 'Not checked'}
          </span>
        </div>
        <div className='divide-y'>
          {(readiness?.checks ?? []).map((check) => (
            <div
              key={check.key}
              className='grid gap-2 px-3 py-2 text-sm md:grid-cols-[220px_1fr_auto] md:items-center'
            >
              <div className='flex items-center gap-2 font-medium'>
                {check.passed ? (
                  <CheckCircle2 className='h-4 w-4 text-emerald-600' />
                ) : check.severity === 'warning' ? (
                  <Clock3 className='h-4 w-4 text-amber-600' />
                ) : (
                  <AlertTriangle className='h-4 w-4 text-rose-600' />
                )}
                {check.label}
              </div>
              <p className='text-xs text-muted-foreground'>{check.message}</p>
              <Badge
                variant={check.passed ? 'outline' : 'secondary'}
                className='w-fit'
              >
                {check.passed ? 'Passed' : check.severity}
              </Badge>
            </div>
          ))}
          {!readiness?.checks?.length && (
            <div className='px-3 py-3 text-sm text-muted-foreground'>
              Readiness unavailable.
            </div>
          )}
        </div>
      </div>

      <WorkflowDialog
        mode={dialogMode}
        open={Boolean(dialogMode)}
        isPending={workflow.isPending}
        value={note}
        onValueChange={setNote}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
        onConfirm={handleConfirm}
      />
    </section>
  )
}
