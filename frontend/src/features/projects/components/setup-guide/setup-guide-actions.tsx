import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  permissionPolicy,
  useCanPerform,
  type PermissionAction,
  type PermissionModule,
} from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import {
  useApproveBoqRevision,
  useLockBoqBaseline,
  useSubmitBoqRevision,
} from '@/features/boq/hooks/use-boq'
import { useScheduleRevisionWorkflow } from '@/features/schedule/hooks/use-revisions'
import type { ProjectSetupReadiness } from '../../data/schema'

/**
 * Who normally holds a permission, in the policy's own role names — said to
 * a viewer who does not ("Ask Project Manager or QS"). The server decides;
 * this only names whom to ask.
 */
function rolesFor(module: PermissionModule, action: PermissionAction, transition?: string) {
  const policy = permissionPolicy.modules[module]
  const ids = (transition && policy.transitions?.[transition]) || policy.actions[action] || []
  return ids
    .map((id) => permissionPolicy.roles.find((role) => role.id === id)?.label ?? id)
    .join(' or ')
}

const errorMessage = (error: unknown, fallback: string) =>
  (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
    ?.message ?? fallback

type GuideActionProps = {
  testId: string
  label: string
  /** What the person asked for, said when they may not do it. */
  what: string
  allowed: boolean
  askRoles: string
  pending: boolean
  /** Irreversible steps (a lock) ask once more before they run. */
  confirm?: boolean
  onRun: () => Promise<unknown>
}

/**
 * One action inside the guide: offered only when the viewer's permissions
 * allow it; otherwise the guide says whom to ask, never a button that the
 * server would refuse.
 */
function GuideAction({ testId, label, what, allowed, askRoles, pending, confirm, onRun }: GuideActionProps) {
  const [confirming, setConfirming] = useState(false)
  if (!allowed) {
    return (
      <p className='text-xs text-muted-foreground' data-testid={`${testId}-ask`}>
        Ask {askRoles} to {what}.
      </p>
    )
  }
  const run = async () => {
    setConfirming(false)
    await onRun()
  }
  if (confirm && confirming) {
    return (
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs text-muted-foreground'>This cannot be undone.</span>
        <Button size='sm' onClick={() => void run()} disabled={pending} data-testid={`${testId}-confirm`}>
          {pending && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
          Confirm {label.toLowerCase()}
        </Button>
        <Button size='sm' variant='ghost' onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    )
  }
  return (
    <Button
      size='sm'
      variant='outline'
      disabled={pending}
      data-testid={testId}
      onClick={() => (confirm ? setConfirming(true) : void run())}
    >
      {pending && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
      {label}
    </Button>
  )
}

/**
 * The bill's revision review from inside the guide (stage 5): submit →
 * approve → lock, through the BOQ page's own hooks, which invalidate the one
 * readiness query.
 */
export function BoqRevisionActions({
  projectId,
  readiness,
}: {
  projectId: string
  readiness: ProjectSetupReadiness
}) {
  const revision = readiness.context?.boqRevision ?? null
  const canSubmit = useCanPerform('boq', 'submit')
  const canApprove = useCanPerform('boq', 'approve')
  const submit = useSubmitBoqRevision(projectId)
  const approve = useApproveBoqRevision(projectId)
  const lock = useLockBoqBaseline(projectId)
  if (!revision) return null
  const pending = submit.isPending || approve.isPending || lock.isPending
  const input = { revisionId: revision.id }
  // The hooks toast their own outcome; a refusal is already said there.
  const quiet = (promise: Promise<unknown>) => promise.catch(() => undefined)

  if (revision.status === 'imported') {
    return (
      <GuideAction
        testId='setup-guide-action-boq-submit'
        label='Submit BOQ revision'
        what='submit the BOQ revision for review'
        allowed={canSubmit}
        askRoles={rolesFor('boq', 'submit')}
        pending={pending}
        onRun={() => quiet(submit.mutateAsync(input))}
      />
    )
  }
  if (revision.status === 'under_review') {
    return (
      <GuideAction
        testId='setup-guide-action-boq-approve'
        label='Approve BOQ revision'
        what='approve the BOQ revision'
        allowed={canApprove}
        askRoles={rolesFor('boq', 'approve')}
        pending={pending}
        onRun={() => quiet(approve.mutateAsync(input))}
      />
    )
  }
  if (revision.status === 'approved' && !revision.baselineLocked) {
    return (
      <GuideAction
        testId='setup-guide-action-boq-lock'
        label='Lock BOQ baseline'
        what='lock the BOQ baseline'
        allowed={canApprove}
        askRoles={rolesFor('boq', 'approve')}
        pending={pending}
        confirm
        onRun={() => quiet(lock.mutateAsync(input))}
      />
    )
  }
  return null
}

/**
 * The schedule revision's review (stage 8) and the baseline lock (stage 9),
 * through the review panel's own workflow hook. The lock is offered only
 * where the review panel offers it: an approved, active revision whose
 * baseline gate is ready — never looser than the gate.
 */
export function ScheduleRevisionActions({
  projectId,
  readiness,
  stage,
}: {
  projectId: string
  readiness: ProjectSetupReadiness
  stage: 'validation' | 'baseline'
}) {
  const revision = readiness.context?.currentRevision ?? null
  const workflow = useScheduleRevisionWorkflow(projectId)
  const canSubmit = useCanPerform('schedule', 'submit', 'revision.submit_review')
  const canApprove = useCanPerform('schedule', 'approve', 'revision.approve')
  const canBaseline = useCanPerform('schedule', 'baseline', 'revision.baseline')
  if (!revision) return null

  const run = async (
    mutation: Promise<unknown>,
    success: string,
    failure: string
  ) => {
    try {
      await mutation
      toast.success(success)
    } catch (error) {
      // The server's reason, once: the workflow hook keeps the global
      // handler quiet and re-reads the readiness either way.
      toast.error(errorMessage(error, failure))
    }
  }
  const input = { revisionId: revision.id }

  if (stage === 'validation') {
    if (revision.status === 'draft' || revision.status === 'rejected') {
      return (
        <GuideAction
          testId='setup-guide-action-schedule-submit'
          label='Submit schedule for review'
          what='submit the schedule revision for review'
          allowed={canSubmit}
          askRoles={rolesFor('schedule', 'submit', 'revision.submit_review')}
          pending={workflow.isPending}
          onRun={() =>
            run(workflow.submitReview.mutateAsync(input), 'Schedule submitted for review', 'Could not submit the schedule')
          }
        />
      )
    }
    if (revision.status === 'under_review') {
      return (
        <GuideAction
          testId='setup-guide-action-schedule-approve'
          label='Approve schedule'
          what='approve the schedule revision'
          allowed={canApprove}
          askRoles={rolesFor('schedule', 'approve', 'revision.approve')}
          pending={workflow.isPending}
          onRun={() =>
            run(workflow.approve.mutateAsync(input), 'Schedule approved', 'Could not approve the schedule')
          }
        />
      )
    }
    return null
  }

  const gate = readiness.gates.baseline
  if (revision.status === 'approved' && revision.isActive && gate.ready && !gate.alreadyLocked) {
    return (
      <GuideAction
        testId='setup-guide-action-baseline-lock'
        label='Lock baseline'
        what='lock the schedule baseline'
        allowed={canBaseline}
        askRoles={rolesFor('schedule', 'baseline', 'revision.baseline')}
        pending={workflow.isPending}
        confirm
        onRun={() => run(workflow.baseline.mutateAsync(input), 'Baseline locked', 'Could not lock the baseline')}
      />
    )
  }
  return null
}
