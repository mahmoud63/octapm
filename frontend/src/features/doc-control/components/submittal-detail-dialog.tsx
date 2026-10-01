import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Send,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { UserPicker } from '@/components/user-picker'
import { useActivities } from '@/features/activities/hooks/use-activities'
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { CommentThread } from '@/features/comments/components/comment-thread'
import { CustomFieldsPanel } from '@/features/custom-fields/components/custom-fields-panel'
import { RecordPins } from '@/features/drawings/components/record-pins'
import {
  useApproveSubmittal,
  useDecideSubmittalStep,
  useRejectSubmittal,
  useSubmitSubmittal,
  useSubmittal,
  useSubmittalPackages,
  useSubmittalWorkflowTemplates,
  useUpdateSubmittal,
  useUpdateSubmittalPeople,
  type SubmittalDecision,
  type SubmittalDetail,
  type SubmittalResponseCode,
  type SubmittalStep,
  type SubmittalUpgradeFields,
} from '../hooks/use-doc-control'
import {
  APPROVE_CODES,
  REJECT_CODES,
  RESPONSE_CODE_LABELS,
  STEP_STATUS_LABEL,
  SUBMITTAL_STATUS_LABEL,
  daysFromNow,
  formatDate,
} from '../lib/submittal-workflow'
import { RaiseChangeEventButton } from '@/features/controls/exceptions/raise-change-event-button'
import { RfiPeopleList } from './rfi-people-list'

const NONE = '__none'

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='space-y-0.5'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <div className='text-sm'>{children}</div>
    </div>
  )
}

const statusTone = (status: string) =>
  ({
    approved: 'bg-emerald-600 text-white',
    under_review: 'bg-sky-600 text-white',
    resubmit: 'bg-amber-500 text-black',
    rejected: 'bg-red-600 text-white',
  })[status] ?? ''

const stepTone = (status: SubmittalStep['status'], isLate: boolean) =>
  status === 'approved'
    ? 'border-emerald-500'
    : status === 'rejected'
      ? 'border-red-500'
      : status === 'active'
        ? isLate
          ? 'border-amber-500'
          : 'border-sky-500'
        : 'border-muted'

type EditDraft = {
  title: string
  discipline: string
  specRef: string
  activityId: string
  requiredOnSite: string
  leadTimeWeeks: string
  workflowTemplateId: string
  packageId: string
  remarks: string
}

function EditForm({
  projectId,
  submittal,
  onDone,
}: {
  projectId: string
  submittal: SubmittalDetail
  onDone: () => void
}) {
  const update = useUpdateSubmittal(projectId)
  const { data: activities } = useActivities(projectId)
  const { data: templates } = useSubmittalWorkflowTemplates(projectId)
  const { data: packages } = useSubmittalPackages(projectId)
  const [draft, setDraft] = useState<EditDraft>({
    title: submittal.title,
    discipline: submittal.discipline ?? '',
    specRef: submittal.specRef ?? '',
    activityId: submittal.activityId ?? '',
    requiredOnSite: submittal.requiredOnSite?.slice(0, 10) ?? '',
    leadTimeWeeks:
      submittal.leadTimeWeeks != null ? String(submittal.leadTimeWeeks) : '',
    workflowTemplateId: submittal.workflowTemplateId ?? '',
    packageId: submittal.packageId ?? '',
    remarks: submittal.remarks ?? '',
  })
  const save = async () => {
    const payload: SubmittalUpgradeFields = {
      title: draft.title.trim(),
      discipline: draft.discipline.trim() || null,
      specRef: draft.specRef.trim() || null,
      activityId: draft.activityId || null,
      requiredOnSite: draft.requiredOnSite || null,
      leadTimeWeeks:
        draft.leadTimeWeeks === '' ? null : Number(draft.leadTimeWeeks),
      workflowTemplateId: draft.workflowTemplateId || null,
      packageId: draft.packageId || null,
      remarks: draft.remarks.trim() || null,
      comment: 'Details updated',
    }
    try {
      await update.mutateAsync({ submittalId: submittal.id, payload })
      toast.success('Submittal saved')
      onDone()
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <div
      className='space-y-3 rounded-md border p-3'
      data-testid='uat-sub-edit-form'
    >
      <div className='grid gap-3 md:grid-cols-2'>
        <div className='space-y-1 md:col-span-2'>
          <Label>Title</Label>
          <Input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className='space-y-1'>
          <Label>Discipline</Label>
          <Input
            value={draft.discipline}
            onChange={(e) => setDraft({ ...draft, discipline: e.target.value })}
          />
        </div>
        <div className='space-y-1'>
          <Label>Spec reference</Label>
          <Input
            value={draft.specRef}
            onChange={(e) => setDraft({ ...draft, specRef: e.target.value })}
          />
        </div>
        <div className='space-y-1'>
          <Label>Activity</Label>
          <Select
            value={draft.activityId || NONE}
            onValueChange={(value) =>
              setDraft({ ...draft, activityId: value === NONE ? '' : value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No activity</SelectItem>
              {activities?.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label>Required on site</Label>
          <Input
            type='date'
            value={draft.requiredOnSite}
            onChange={(e) =>
              setDraft({ ...draft, requiredOnSite: e.target.value })
            }
          />
        </div>
        <div className='space-y-1'>
          <Label>Lead time (weeks)</Label>
          <Input
            type='number'
            min={0}
            max={104}
            value={draft.leadTimeWeeks}
            onChange={(e) =>
              setDraft({ ...draft, leadTimeWeeks: e.target.value })
            }
          />
        </div>
        <div className='space-y-1'>
          <Label>Review workflow</Label>
          <Select
            value={draft.workflowTemplateId || NONE}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                workflowTemplateId: value === NONE ? '' : value,
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No workflow (manual review)</SelectItem>
              {templates?.items.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.name} · {row.reviewDays} d
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {submittal.status === 'under_review' && (
            <p className='text-xs text-muted-foreground'>
              Changing the workflow applies from the next submission.
            </p>
          )}
        </div>
        <div className='space-y-1'>
          <Label>Package</Label>
          <Select
            value={draft.packageId || NONE}
            onValueChange={(value) =>
              setDraft({ ...draft, packageId: value === NONE ? '' : value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No package</SelectItem>
              {packages?.items.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.ref} · {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1 md:col-span-2'>
          <Label>Notes</Label>
          <Textarea
            rows={2}
            value={draft.remarks}
            onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
          />
        </div>
      </div>
      <div className='flex justify-end gap-2'>
        <Button variant='outline' size='sm' onClick={onDone}>
          Cancel
        </Button>
        <Button
          size='sm'
          onClick={save}
          disabled={update.isPending || !draft.title.trim()}
          data-testid='uat-sub-save'
        >
          {update.isPending && (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          )}
          Save
        </Button>
      </div>
    </div>
  )
}

function DecisionForm({
  projectId,
  submittal,
  stepName,
  onDone,
}: {
  projectId: string
  submittal: SubmittalDetail
  stepName: string
  onDone: () => void
}) {
  const decide = useDecideSubmittalStep(projectId)
  const [decision, setDecision] =
    useState<SubmittalDecision['decision']>('approve')
  const [responseCode, setResponseCode] =
    useState<SubmittalResponseCode>('approved')
  const [responseCodeLabel, setResponseCodeLabel] = useState('')
  const [comment, setComment] = useState('')
  const codes = decision === 'approve' ? APPROVE_CODES : REJECT_CODES
  const problem =
    responseCode === 'custom' && !responseCodeLabel.trim()
      ? 'Name the custom response'
      : decision === 'reject' && !comment.trim()
        ? 'Say what needs to change'
        : null
  const submit = async () => {
    try {
      await decide.mutateAsync({
        submittalId: submittal.id,
        payload: {
          decision,
          responseCode,
          responseCodeLabel:
            responseCode === 'custom' ? responseCodeLabel.trim() : null,
          comment: comment.trim() || null,
        },
      })
      toast.success(
        decision === 'approve' ? 'Approval recorded' : 'Submittal returned'
      )
      onDone()
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  return (
    <div
      className='space-y-2 rounded-md border border-sky-500/50 p-3'
      data-testid='uat-sub-decide'
    >
      <p className='text-sm font-medium'>Your decision on “{stepName}”</p>
      <div className='grid gap-2 md:grid-cols-[max-content_minmax(0,1fr)]'>
        <div className='flex gap-1'>
          <Button
            type='button'
            size='sm'
            variant={decision === 'approve' ? 'default' : 'outline'}
            onClick={() => {
              setDecision('approve')
              setResponseCode('approved')
            }}
          >
            <CheckCircle2 className='mr-1 h-4 w-4' />
            Approve
          </Button>
          <Button
            type='button'
            size='sm'
            variant={decision === 'reject' ? 'destructive' : 'outline'}
            onClick={() => {
              setDecision('reject')
              setResponseCode('revise_resubmit')
            }}
          >
            <XCircle className='mr-1 h-4 w-4' />
            Return
          </Button>
        </div>
        <Select
          value={responseCode}
          onValueChange={(value) =>
            setResponseCode(value as SubmittalResponseCode)
          }
        >
          <SelectTrigger
            aria-label='Response code'
            data-testid='uat-sub-response-code'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {codes.map((code) => (
              <SelectItem key={code} value={code}>
                {RESPONSE_CODE_LABELS[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {responseCode === 'custom' && (
        <Input
          placeholder='Custom response label'
          value={responseCodeLabel}
          onChange={(e) => setResponseCodeLabel(e.target.value)}
        />
      )}
      <Textarea
        rows={2}
        placeholder={
          decision === 'reject'
            ? 'What needs to change (required)'
            : 'Comment (optional)'
        }
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className='flex items-center justify-end gap-2'>
        {problem && (
          <span className='mr-auto text-xs text-muted-foreground'>
            {problem}
          </span>
        )}
        <Button
          size='sm'
          onClick={submit}
          disabled={decide.isPending || Boolean(problem)}
          data-testid='uat-sub-decide-submit'
        >
          {decide.isPending && (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          )}
          Record decision
        </Button>
      </div>
    </div>
  )
}

function StepCard({
  step,
  currentUserId,
}: {
  step: SubmittalStep
  currentUserId?: string | null
}) {
  return (
    <li
      className={cn(
        'rounded-md border-l-4 bg-muted/30 p-2',
        stepTone(step.status, step.isLate)
      )}
      data-testid='uat-sub-step'
    >
      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <span className='font-medium'>
          {step.sortOrder + 1}. {step.name}
        </span>
        <Badge variant={step.status === 'active' ? 'default' : 'outline'}>
          {STEP_STATUS_LABEL[step.status] ?? step.status}
        </Badge>
        <span className='text-xs text-muted-foreground'>
          {step.mode === 'parallel' ? 'all must approve' : 'any one approves'} ·{' '}
          {step.days} d
        </span>
        {step.dueAt && step.status === 'active' && (
          <span
            className={cn(
              'text-xs',
              step.isLate ? 'text-amber-600' : 'text-muted-foreground'
            )}
          >
            <Clock className='mr-1 inline h-3 w-3' />
            {step.isLate
              ? `${Math.abs(daysFromNow(step.dueAt) ?? 0)} d late`
              : `due ${formatDate(step.dueAt)}`}
          </span>
        )}
      </div>
      <ul className='mt-1 space-y-0.5 text-xs'>
        {step.assignments.map((assignment) => (
          <li key={assignment.id} className='flex flex-wrap items-center gap-1'>
            <span
              className={cn(
                assignment.userId === currentUserId && 'font-semibold'
              )}
            >
              {assignment.user?.name ?? 'Reviewer'}
            </span>
            <span className='text-muted-foreground'>({assignment.role})</span>
            <Badge variant='outline' className='text-[10px]'>
              {STEP_STATUS_LABEL[assignment.status] ?? assignment.status}
            </Badge>
            {assignment.responseCodeLabel && (
              <span className='text-muted-foreground'>
                · {assignment.responseCodeLabel}
              </span>
            )}
            {assignment.comment && (
              <span className='text-muted-foreground italic'>
                “{assignment.comment}”
              </span>
            )}
          </li>
        ))}
      </ul>
    </li>
  )
}

/**
 * The submittal workspace: what it is, the review route with every step and
 * reviewer, the decision form for the caller when the ball is theirs, the
 * people, dates and lead time, plus pins, attachments, notes and history.
 */
export function SubmittalDetailDialog({
  projectId,
  submittalId,
  onOpenChange,
}: {
  projectId: string
  submittalId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const currentUser = useAuthStore((state) => state.auth.user)
  const { data: submittal, isLoading } = useSubmittal(projectId, submittalId)
  const submitSubmittal = useSubmitSubmittal(projectId)
  const approve = useApproveSubmittal(projectId)
  const reject = useRejectSubmittal(projectId)
  const updatePeople = useUpdateSubmittalPeople(projectId)
  const canUpdate = useCanPerform('submittal', 'update')
  const canSubmit = useCanPerform('submittal', 'submit', 'submittal.submit')
  const canReview = useCanPerform('submittal', 'submit', 'submittal.review')
  const canApprove = useCanPerform('submittal', 'submit', 'submittal.approve')
  const canReject = useCanPerform('submittal', 'submit', 'submittal.reject')
  const [editing, setEditing] = useState(false)
  const [peopleEditing, setPeopleEditing] = useState(false)
  const [managerDraft, setManagerDraft] = useState<string | null>(null)
  const [distributionDraft, setDistributionDraft] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [revisionCode, setRevisionCode] = useState('')
  const [submitComment, setSubmitComment] = useState('')
  const [manualComment, setManualComment] = useState('')

  const open = Boolean(submittalId)
  const activeStep = submittal?.activeStep ?? null
  const myAssignment = activeStep?.assignments.find(
    (row) => row.userId === currentUser?.id && row.status === 'pending'
  )
  const canDecide =
    Boolean(submittal && submittal.status === 'under_review' && activeStep) &&
    canReview &&
    (Boolean(myAssignment) || canApprove)
  const submittable = submittal
    ? ['pending', 'resubmit', 'rejected'].includes(submittal.status)
    : false
  const manualReview = Boolean(
    submittal && submittal.status === 'under_review' && !activeStep
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-5xl'
        data-testid='uat-sub-detail'
      >
        {isLoading || !submittal ? (
          <div className='flex items-center gap-2 p-6 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading submittal…
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className='flex flex-wrap items-center gap-2'>
                <DialogTitle className='text-base'>
                  {submittal.ref} · {submittal.title}
                </DialogTitle>
                <Badge
                  className={statusTone(submittal.status)}
                  data-testid='uat-sub-status'
                >
                  {SUBMITTAL_STATUS_LABEL[submittal.status] ?? submittal.status}
                </Badge>
                {submittal.responseCodeLabel && (
                  <Badge variant='outline' data-testid='uat-sub-response'>
                    {submittal.responseCodeLabel}
                  </Badge>
                )}
                <Badge variant='outline'>Rev {submittal.revision}</Badge>
                {(submittal.revisionNumber ?? 0) > 0 && (
                  <Badge variant='secondary'>
                    Cycle {(submittal.revisionNumber ?? 0) + 1}
                  </Badge>
                )}
                {submittal.isLate && (
                  <Badge variant='destructive'>
                    <AlertTriangle className='mr-1 h-3 w-3' /> Past submit-by
                  </Badge>
                )}
                {submittal.lateSteps > 0 && (
                  <Badge variant='destructive'>Review late</Badge>
                )}
                {(submittal.scheduleImpactDays ?? 0) > 0 && (
                  <Badge variant='destructive' data-testid='uat-sub-impact'>
                    {submittal.scheduleImpactDays} d schedule impact
                  </Badge>
                )}
              </div>
              <DialogDescription>
                {submittal.package
                  ? `${submittal.package.ref} ${submittal.package.name} · `
                  : ''}
                {submittal.workflowTemplate
                  ? `${submittal.workflowTemplate.name} (${submittal.workflowTemplate.reviewDays} review days)`
                  : 'Manual review'}
              </DialogDescription>
            </DialogHeader>

            <div className='flex flex-wrap gap-2' data-testid='uat-sub-actions'>
              {/* PC-7b: a draft change event prefilled from this submittal (typed link). */}
              <RaiseChangeEventButton
                projectId={projectId}
                source={{ type: 'submittal', id: submittal.id }}
                testId='uat-sub-raise-change-event'
              />
              {submittable && canSubmit && (
                <Button
                  size='sm'
                  onClick={() => setSubmitting((value) => !value)}
                  data-testid='uat-sub-submit'
                >
                  <Send className='mr-1 h-4 w-4' /> Submit for review
                </Button>
              )}
              {canUpdate && submittal.status !== 'approved' && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setEditing((value) => !value)}
                  data-testid='uat-sub-edit'
                >
                  <Pencil className='mr-1 h-4 w-4' /> Edit
                </Button>
              )}
            </div>

            {submitting && (
              <div
                className='space-y-2 rounded-md border p-3'
                data-testid='uat-sub-submit-form'
              >
                <p className='text-sm font-medium'>
                  Submit revision for review
                </p>
                <p className='text-xs text-muted-foreground'>
                  Attach the revision below first; the review route starts as
                  soon as it is submitted.
                </p>
                <div className='grid gap-2 md:grid-cols-[160px_minmax(0,1fr)]'>
                  <Input
                    placeholder={`Revision code (${submittal.revision})`}
                    value={revisionCode}
                    onChange={(e) => setRevisionCode(e.target.value)}
                  />
                  <Input
                    placeholder='Note to reviewers (optional)'
                    value={submitComment}
                    onChange={(e) => setSubmitComment(e.target.value)}
                  />
                </div>
                <div className='flex justify-end gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setSubmitting(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size='sm'
                    disabled={submitSubmittal.isPending}
                    data-testid='uat-sub-submit-confirm'
                    onClick={async () => {
                      try {
                        await submitSubmittal.mutateAsync({
                          submittalId: submittal.id,
                          payload: {
                            revision: revisionCode.trim() || submittal.revision,
                            comment: submitComment.trim() || undefined,
                          },
                        })
                        toast.success('Submitted for review')
                        setSubmitting(false)
                        setRevisionCode('')
                        setSubmitComment('')
                      } catch (error) {
                        toast.error(getServerErrorMessage(error))
                      }
                    }}
                  >
                    {submitSubmittal.isPending && (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    )}
                    Submit
                  </Button>
                </div>
              </div>
            )}

            {editing && (
              <EditForm
                key={submittal.updatedAt ?? submittal.id}
                projectId={projectId}
                submittal={submittal}
                onDone={() => setEditing(false)}
              />
            )}

            <div className='grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
              <div className='space-y-4'>
                <section className='space-y-2' data-testid='uat-sub-route'>
                  <p className='text-sm font-medium'>Review route</p>
                  {canDecide && activeStep && (
                    <DecisionForm
                      key={`${activeStep.id}-${submittal.updatedAt ?? ''}`}
                      projectId={projectId}
                      submittal={submittal}
                      stepName={activeStep.name}
                      onDone={() => undefined}
                    />
                  )}
                  {submittal.status === 'under_review' &&
                    activeStep &&
                    !canDecide && (
                      <p className='text-xs text-muted-foreground'>
                        Waiting on{' '}
                        {activeStep.assignments
                          .filter((row) => row.status === 'pending')
                          .map((row) => row.user?.name ?? 'a reviewer')
                          .join(', ') || 'the reviewers'}
                        .
                      </p>
                    )}
                  {submittal.currentRevisionSteps.length ? (
                    <ol className='space-y-2'>
                      {submittal.currentRevisionSteps.map((step) => (
                        <StepCard
                          key={step.id}
                          step={step}
                          currentUserId={currentUser?.id}
                        />
                      ))}
                    </ol>
                  ) : (
                    <p className='text-xs text-muted-foreground'>
                      {submittal.workflowTemplate
                        ? 'The route starts when the submittal is submitted.'
                        : 'No workflow: the project manager approves or returns it directly.'}
                    </p>
                  )}
                  {manualReview && (canApprove || canReject) && (
                    <div
                      className='space-y-2 rounded-md border p-3'
                      data-testid='uat-sub-manual'
                    >
                      <Textarea
                        rows={2}
                        placeholder='Comment'
                        value={manualComment}
                        onChange={(e) => setManualComment(e.target.value)}
                      />
                      <div className='flex justify-end gap-2'>
                        {canReject && (
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={reject.isPending || !manualComment.trim()}
                            onClick={async () => {
                              try {
                                await reject.mutateAsync({
                                  submittalId: submittal.id,
                                  reason: manualComment.trim(),
                                })
                                toast.success('Submittal returned')
                                setManualComment('')
                              } catch (error) {
                                toast.error(getServerErrorMessage(error))
                              }
                            }}
                          >
                            <XCircle className='mr-1 h-4 w-4' /> Return
                          </Button>
                        )}
                        {canApprove && (
                          <Button
                            size='sm'
                            disabled={
                              approve.isPending || !manualComment.trim()
                            }
                            onClick={async () => {
                              try {
                                await approve.mutateAsync({
                                  submittalId: submittal.id,
                                  comment: manualComment.trim(),
                                })
                                toast.success('Submittal approved')
                                setManualComment('')
                              } catch (error) {
                                toast.error(getServerErrorMessage(error))
                              }
                            }}
                          >
                            <CheckCircle2 className='mr-1 h-4 w-4' /> Approve
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {submittal.reviewSteps.some(
                    (step) =>
                      step.revisionNumber !== (submittal.revisionNumber ?? 0)
                  ) && (
                    <details className='text-xs'>
                      <summary className='cursor-pointer text-muted-foreground'>
                        Earlier cycles
                      </summary>
                      <ol className='mt-2 space-y-2'>
                        {submittal.reviewSteps
                          .filter(
                            (step) =>
                              step.revisionNumber !==
                              (submittal.revisionNumber ?? 0)
                          )
                          .map((step) => (
                            <StepCard
                              key={step.id}
                              step={step}
                              currentUserId={currentUser?.id}
                            />
                          ))}
                      </ol>
                    </details>
                  )}
                </section>

                <section
                  className='grid gap-3 sm:grid-cols-2'
                  data-testid='uat-sub-fields'
                >
                  <Field label='Discipline'>
                    {submittal.discipline || '—'}
                  </Field>
                  <Field label='Spec reference'>
                    {submittal.specRef || '—'}
                  </Field>
                  <Field label='Activity'>
                    {submittal.activity?.name || '—'}
                  </Field>
                  <Field label='Required on site'>
                    {formatDate(
                      submittal.requiredOnSite ?? submittal.activity?.startDate
                    )}
                    {!submittal.requiredOnSite && submittal.activity?.startDate
                      ? ' (activity start)'
                      : ''}
                  </Field>
                  <Field label='Lead time'>
                    {submittal.leadTimeWeeks != null
                      ? `${submittal.leadTimeWeeks} weeks`
                      : '—'}
                  </Field>
                  <Field label='Submit by'>
                    <span
                      className={cn(submittal.isLate && 'text-red-600')}
                      data-testid='uat-sub-submit-by'
                    >
                      {formatDate(submittal.submitBy)}
                    </span>
                  </Field>
                  <Field label='Due'>{formatDate(submittal.dueDate)}</Field>
                  <Field label='Distributed'>
                    {formatDate(submittal.distributedAt)}
                  </Field>
                  {submittal.remarks && (
                    <div className='sm:col-span-2'>
                      <Field label='Notes'>{submittal.remarks}</Field>
                    </div>
                  )}
                </section>

                <section className='space-y-2' data-testid='uat-sub-people'>
                  <div className='flex items-center justify-between'>
                    <p className='text-sm font-medium'>People</p>
                    {canUpdate && !peopleEditing && (
                      <Button
                        size='sm'
                        variant='ghost'
                        data-testid='uat-sub-people-edit'
                        onClick={() => {
                          setManagerDraft(submittal.managerUserId ?? null)
                          setDistributionDraft(
                            submittal.distributionUserIds ?? []
                          )
                          setPeopleEditing(true)
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                  {peopleEditing ? (
                    <div className='space-y-2 rounded-md border p-3'>
                      <div className='space-y-1'>
                        <Label>Submittal manager</Label>
                        <UserPicker
                          projectId={projectId}
                          value={managerDraft}
                          onChange={setManagerDraft}
                          allowNone
                        />
                      </div>
                      <RfiPeopleList
                        projectId={projectId}
                        label='Distribution'
                        value={distributionDraft}
                        onChange={setDistributionDraft}
                      />
                      <div className='flex justify-end gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => setPeopleEditing(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size='sm'
                          data-testid='uat-sub-people-save'
                          disabled={updatePeople.isPending}
                          onClick={async () => {
                            try {
                              await updatePeople.mutateAsync({
                                submittalId: submittal.id,
                                managerUserId: managerDraft,
                                distributionUserIds: distributionDraft,
                              })
                              toast.success('People updated')
                              setPeopleEditing(false)
                            } catch (error) {
                              toast.error(getServerErrorMessage(error))
                            }
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className='grid gap-2 text-sm sm:grid-cols-2'>
                      <Field label='Manager'>
                        {submittal.manager?.name ?? '—'}
                      </Field>
                      <Field label='Ball in court'>
                        {activeStep
                          ? activeStep.assignments
                              .filter((row) => row.status === 'pending')
                              .map((row) => row.user?.name ?? 'Reviewer')
                              .join(', ') || '—'
                          : submittal.ballInCourtUserId
                            ? 'Originator'
                            : '—'}
                      </Field>
                      <div className='sm:col-span-2'>
                        <Field label='Distribution'>
                          {submittal.distribution.length
                            ? submittal.distribution
                                .map((person) => person.name)
                                .join(', ')
                            : 'Nobody yet'}
                        </Field>
                      </div>
                    </div>
                  )}
                </section>

                <RecordPins
                  projectId={projectId}
                  recordType='submittal'
                  recordId={submittal.id}
                />
              </div>

              <div className='space-y-4'>
                <CustomFieldsPanel
                  projectId={projectId}
                  recordType='submittal'
                  recordId={submittal.id}
                  context={submittal as unknown as Record<string, unknown>}
                  compact
                />
                <AttachmentPanel
                  projectId={projectId}
                  recordType='submittal'
                  recordId={submittal.id}
                  compact
                />
                <HistoryPanel
                  projectId={projectId}
                  entityType='submittal'
                  entityId={submittal.id}
                  title={`${submittal.ref} History`}
                  limit={30}
                  showFilters={false}
                />
                <CommentThread
                  projectId={projectId}
                  recordType='submittal'
                  recordId={submittal.id}
                  title='Internal notes'
                />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
