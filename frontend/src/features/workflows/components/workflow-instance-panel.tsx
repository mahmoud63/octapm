import { useState } from 'react'
import {
  Ban,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  ShieldAlert,
  Split,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  INSTANCE_STATUS_LABEL,
  formatWorkflowDate,
  targetLabel,
  useCancelWorkflow,
  useRespondWorkflow,
  useStartWorkflow,
  useWorkflowInstances,
  useWorkflowTemplates,
  type WorkflowInstance,
  type WorkflowInstanceStep,
  type WorkflowResponse,
  type WorkflowToolKey,
} from '../hooks/use-workflow-engine'

const statusTone = (status: WorkflowInstance['status']) =>
  status === 'succeeded'
    ? 'border-green-500/50 text-green-700 dark:text-green-400'
    : status === 'failed'
      ? 'border-red-500/50 text-red-700 dark:text-red-400'
      : status === 'cancelled'
        ? 'text-muted-foreground'
        : 'border-primary/50 text-primary'

export function WorkflowStatusBadge({
  instance,
}: {
  instance: WorkflowInstance
}) {
  return (
    <Badge variant='outline' className={statusTone(instance.status)}>
      {INSTANCE_STATUS_LABEL[instance.status]}
    </Badge>
  )
}

/** Response buttons + optional comment; used on the record and the dashboard. */
export function WorkflowResponseForm({
  responses,
  isPending,
  compact = false,
  onRespond,
}: {
  responses: WorkflowResponse[]
  isPending: boolean
  compact?: boolean
  onRespond: (response: string, comment: string) => Promise<void>
}) {
  const [comment, setComment] = useState('')
  const [chosen, setChosen] = useState<WorkflowResponse | null>(null)
  const needsComment = (response: WorkflowResponse) =>
    Boolean(response.requireComment) || response.tone === 'negative'

  const send = async (response: WorkflowResponse) => {
    if (needsComment(response) && !comment.trim()) {
      setChosen(response)
      toast.error(`"${response.label}" needs a comment`)
      return
    }
    try {
      await onRespond(response.key ?? response.label, comment.trim())
      setComment('')
      setChosen(null)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div className={cn('space-y-2', compact && 'space-y-1.5')}>
      <Textarea
        rows={compact ? 1 : 2}
        placeholder={
          chosen ? `Comment for "${chosen.label}"` : 'Comment (optional)'
        }
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        data-testid='uat-workflow-comment'
      />
      <div className='flex flex-wrap gap-1.5'>
        {responses.map((response) => (
          <Button
            key={response.key ?? response.label}
            type='button'
            size='sm'
            variant={
              response.tone === 'negative'
                ? 'destructive'
                : response.tone === 'positive'
                  ? 'default'
                  : 'outline'
            }
            disabled={isPending}
            data-testid={`uat-workflow-respond-${response.key ?? 'x'}`}
            onClick={() => send(response)}
          >
            {isPending && chosen?.key === response.key && (
              <Loader2 className='mr-1 h-3 w-3 animate-spin' />
            )}
            {response.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function StepIcon({ step }: { step: WorkflowInstanceStep }) {
  if (step.type === 'condition') return <Split className='h-4 w-4' />
  if (step.status === 'active')
    return <Clock3 className='h-4 w-4 text-primary' />
  if (step.status === 'done') {
    const negative =
      step.type === 'response' &&
      step.responses?.find((response) => response.key === step.result)?.tone ===
        'negative'
    return negative ? (
      <XCircle className='h-4 w-4 text-red-600' />
    ) : (
      <CheckCircle2 className='h-4 w-4 text-green-600' />
    )
  }
  return <Clock3 className='h-4 w-4 text-muted-foreground' />
}

function StepRow({
  step,
  steps,
}: {
  step: WorkflowInstanceStep
  steps: WorkflowInstanceStep[]
}) {
  const resultLabel =
    step.type === 'condition'
      ? step.status === 'done'
        ? step.result
          ? `true → ${targetLabel(step.whenTrue, steps)}`
          : `false → ${targetLabel(step.whenFalse, steps)}`
        : null
      : step.type === 'response' && step.status === 'done'
        ? (step.responses?.find((response) => response.key === step.result)
            ?.label ?? String(step.result ?? ''))
        : null
  return (
    <li
      className={cn(
        'flex gap-2 text-sm',
        step.status === 'pending' && 'text-muted-foreground'
      )}
      data-testid={`uat-workflow-step-${step.status}`}
    >
      <span className='mt-0.5 shrink-0'>
        <StepIcon step={step} />
      </span>
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-x-2'>
          <span className='font-medium'>{step.name}</span>
          {resultLabel && (
            <span className='text-xs text-muted-foreground'>{resultLabel}</span>
          )}
          {step.status === 'active' && step.dueAt && (
            <span className='text-xs text-muted-foreground'>
              due {formatWorkflowDate(step.dueAt)}
            </span>
          )}
        </div>
        {step.assignments.length > 0 && (
          <ul className='mt-0.5 space-y-0.5 text-xs'>
            {step.assignments.map((assignment) => (
              <li
                key={assignment.id}
                className='flex flex-wrap items-center gap-x-1.5'
              >
                <span>
                  {assignment.user?.name ??
                    assignment.user?.email ??
                    'Team member'}
                </span>
                {assignment.isOverride && (
                  <Badge variant='secondary' className='px-1 py-0 text-[10px]'>
                    on behalf
                  </Badge>
                )}
                <span className='text-muted-foreground'>
                  {assignment.status === 'responded'
                    ? `${assignment.responseLabel ?? assignment.response} · ${formatWorkflowDate(assignment.respondedAt)}`
                    : assignment.status === 'skipped'
                      ? 'not needed'
                      : assignment.overdue
                        ? 'overdue'
                        : 'waiting'}
                </span>
                {assignment.escalatedAt && assignment.status === 'pending' && (
                  <Badge
                    variant='outline'
                    className='px-1 py-0 text-[10px] text-amber-700'
                  >
                    escalated
                  </Badge>
                )}
                {assignment.comment && (
                  <span className='w-full text-muted-foreground italic'>
                    “{assignment.comment}”
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

function InstanceCard({
  projectId,
  instance,
  canManage,
}: {
  projectId: string
  instance: WorkflowInstance
  canManage: boolean
}) {
  const respond = useRespondWorkflow(projectId)
  const cancel = useCancelWorkflow(projectId)
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [onBehalf, setOnBehalf] = useState(false)
  const running = instance.status === 'running'
  const current = instance.currentStep
  const responses =
    instance.myAssignment?.responses ??
    (onBehalf && current?.type === 'response' ? (current.responses ?? []) : [])

  return (
    <div
      className='space-y-3 rounded-md border p-3'
      data-testid={`uat-workflow-instance-${instance.status}`}
    >
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-sm font-medium'>
          {instance.template.name ?? 'Workflow'}
        </span>
        <WorkflowStatusBadge instance={instance} />
        {instance.escalationLevel > 0 && (
          <Badge variant='outline' className='text-amber-700'>
            escalated ×{instance.escalationLevel}
          </Badge>
        )}
        <span className='text-xs text-muted-foreground'>
          started {formatWorkflowDate(instance.startedAt)}
          {instance.completedAt
            ? ` · ended ${formatWorkflowDate(instance.completedAt)}`
            : ''}
        </span>
        {running && canManage && !cancelling && (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            className='ml-auto'
            onClick={() => setCancelling(true)}
          >
            <Ban className='mr-1 h-3 w-3' />
            Cancel
          </Button>
        )}
      </div>

      {instance.applyStatus === 'failed' && (
        <p className='flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs'>
          <ShieldAlert className='mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700' />
          <span>
            The decision was recorded but could not be written to the record:{' '}
            {instance.applyError}. Apply it from the record itself.
          </span>
        </p>
      )}
      {instance.status === 'cancelled' && instance.cancelReason && (
        <p className='text-xs text-muted-foreground'>
          Cancelled: {instance.cancelReason}
        </p>
      )}

      <ol className='space-y-2'>
        {instance.steps.map((step) => (
          <StepRow key={step.key} step={step} steps={instance.steps} />
        ))}
      </ol>

      {running && (instance.myAssignment || onBehalf) && (
        <div className='rounded border border-primary/40 p-2'>
          <p className='mb-1.5 text-xs font-medium'>
            {instance.myAssignment
              ? `Your decision on “${current?.name ?? 'this step'}”`
              : `Deciding on behalf of the assignees of “${current?.name ?? 'this step'}”`}
          </p>
          <WorkflowResponseForm
            responses={responses}
            isPending={respond.isPending}
            compact
            onRespond={async (response, comment) => {
              await respond.mutateAsync({
                instanceId: instance.id,
                response,
                comment,
              })
              toast.success('Response recorded')
              setOnBehalf(false)
            }}
          />
        </div>
      )}
      {running &&
        !instance.myAssignment &&
        !onBehalf &&
        canManage &&
        current?.type === 'response' && (
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => setOnBehalf(true)}
          >
            Decide on behalf of the assignees
          </Button>
        )}

      {cancelling && (
        <div className='space-y-1.5 rounded border p-2'>
          <Textarea
            rows={2}
            placeholder='Why is this workflow being cancelled?'
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
          />
          <div className='flex gap-1.5'>
            <Button
              type='button'
              size='sm'
              variant='destructive'
              disabled={cancel.isPending}
              onClick={async () => {
                try {
                  await cancel.mutateAsync({
                    instanceId: instance.id,
                    reason: cancelReason.trim() || null,
                  })
                  toast.success('Workflow cancelled')
                  setCancelling(false)
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}
            >
              Cancel workflow
            </Button>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={() => setCancelling(false)}
            >
              Keep running
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Workflow runs on one record: the running one with its steps and the
 * signed-in user's response controls, a manual start for managers, and the
 * finished runs on request.
 */
export function WorkflowInstancePanel({
  projectId,
  tool,
  recordId,
  className,
}: {
  projectId: string
  tool: WorkflowToolKey
  recordId: string
  className?: string
}) {
  const canRead = useCanPerform('workflow', 'read')
  const canManage = useCanPerform('workflow', 'update', 'workflow.manage')
  const { data, isLoading } = useWorkflowInstances(
    projectId,
    { tool, recordId },
    { enabled: canRead }
  )
  const { data: templates = [] } = useWorkflowTemplates(
    projectId,
    { tool },
    { enabled: canRead && canManage }
  )
  const start = useStartWorkflow(projectId)
  const [templateId, setTemplateId] = useState<string>('auto')
  const [showFinished, setShowFinished] = useState(false)
  if (!canRead) return null
  const instances = data ?? []
  const running = instances.find((instance) => instance.status === 'running')
  const finished = instances.filter((instance) => instance.status !== 'running')

  return (
    <section
      className={cn('space-y-2', className)}
      data-testid='uat-workflow-panel'
    >
      <div className='flex items-center justify-between'>
        <h4 className='text-sm font-semibold'>Workflow</h4>
        {finished.length > 0 && (
          <button
            type='button'
            className='text-xs text-muted-foreground underline-offset-2 hover:underline'
            onClick={() => setShowFinished((prev) => !prev)}
          >
            {showFinished
              ? 'Hide earlier runs'
              : `${finished.length} earlier run${finished.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
      {isLoading ? (
        <p className='text-xs text-muted-foreground'>Loading…</p>
      ) : running ? (
        <InstanceCard
          projectId={projectId}
          instance={running}
          canManage={canManage}
        />
      ) : (
        <div className='space-y-2 rounded-md border border-dashed p-3'>
          <p className='text-xs text-muted-foreground'>
            No workflow is running on this record
            {templates.length === 0 && canManage
              ? ' and no route exists for this tool yet — add one under Company › Workflows.'
              : '.'}
          </p>
          {canManage && templates.length > 0 && (
            <div className='flex flex-wrap items-center gap-2'>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger
                  className='w-60'
                  aria-label='Workflow route'
                  data-testid='uat-workflow-start-template'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='auto'>
                    Pick by rules (or the default)
                  </SelectItem>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                      {template.scope === 'company' ? ' · company' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={start.isPending}
                data-testid='uat-workflow-start'
                onClick={async () => {
                  try {
                    await start.mutateAsync({
                      tool,
                      recordId,
                      templateId: templateId === 'auto' ? null : templateId,
                    })
                    toast.success('Workflow started')
                  } catch (error) {
                    toast.error(getServerErrorMessage(error))
                  }
                }}
              >
                <Play className='mr-1 h-3 w-3' />
                Start workflow
              </Button>
            </div>
          )}
        </div>
      )}
      {showFinished &&
        finished.map((instance) => (
          <InstanceCard
            key={instance.id}
            projectId={projectId}
            instance={instance}
            canManage={canManage}
          />
        ))}
    </section>
  )
}
