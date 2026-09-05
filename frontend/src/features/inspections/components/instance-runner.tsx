import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  FileText,
  Flag,
  History,
  Loader2,
  MessageSquare,
  PenLine,
  Play,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import { CommentThread } from '@/features/comments/components/comment-thread'
import { RecordPins } from '@/features/drawings/components/record-pins'
import {
  SIGNATURE_ROLES,
  completionProblemsFrom,
  downloadFormPdf,
  formatFormDate,
  isFormOpen,
  useFormInstance,
  useFormInstanceAction,
  useRaiseFormDeficiency,
  useSaveFormResponses,
  useSignFormInstance,
  type CompletionProblem,
  type FormInstanceItem,
  type NumberOptions,
  type SignatureRole,
} from '../hooks/use-forms'
import { FormStatusBadge, FormTypeBadge } from './form-badges'
import { SignaturePad } from './signature-pad'

const PROBLEM_TEXT: Record<CompletionProblem['reason'], string> = {
  answer: 'needs an answer',
  photo: 'needs a photo',
  signature: 'needs a signature',
  signature_role: 'is required before completing',
}

function ChoiceButtons({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Array<{
    value: string
    label: string
    tone?: 'good' | 'bad' | 'muted'
  }>
  value: string | null
  onChange: (next: string | null) => void
  disabled: boolean
}) {
  return (
    <div className='flex flex-wrap gap-1'>
      {options.map((option) => {
        const active = value === option.value
        return (
          <Button
            key={option.value}
            type='button'
            size='sm'
            variant={active ? 'default' : 'outline'}
            disabled={disabled}
            className={cn(
              'h-8',
              active &&
                option.tone === 'good' &&
                'bg-emerald-600 hover:bg-emerald-600/90',
              active &&
                option.tone === 'bad' &&
                'bg-destructive hover:bg-destructive/90',
              active &&
                option.tone === 'muted' &&
                'bg-muted-foreground hover:bg-muted-foreground/90'
            )}
            onClick={() => onChange(active ? null : option.value)}
            data-testid={`uat-inspection-answer-${option.value}`}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}

function SignDialog({
  instanceId,
  projectId,
  open,
  role: initialRole,
  itemId,
  onOpenChange,
}: {
  instanceId: string
  projectId: string
  open: boolean
  role: SignatureRole
  itemId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const currentUser = useAuthStore((state) => state.auth.user)
  const sign = useSignFormInstance(projectId)
  const [role, setRole] = useState<SignatureRole>(initialRole)
  const [signerName, setSignerName] = useState(currentUser?.name ?? '')
  const [signerCompany, setSignerCompany] = useState('')
  const [image, setImage] = useState<string | null>(null)

  const submit = async () => {
    if (!image) return
    try {
      await sign.mutateAsync({
        instanceId,
        role,
        image,
        signerName,
        signerCompany,
        itemId,
      })
      toast.success('Signed')
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid='uat-inspection-sign'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <PenLine className='h-4 w-4' /> Sign
          </DialogTitle>
          <DialogDescription>
            The signature is stored as an image with your name, the time and the
            device address.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1'>
            <Label>Signing as</Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as SignatureRole)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIGNATURE_ROLES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='sign-name'>Name</Label>
            <Input
              id='sign-name'
              value={signerName}
              onChange={(event) => setSignerName(event.target.value)}
              maxLength={200}
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='sign-company'>Company</Label>
            <Input
              id='sign-company'
              value={signerCompany}
              onChange={(event) => setSignerCompany(event.target.value)}
              placeholder='Optional'
              maxLength={200}
            />
          </div>
          <div className='sm:col-span-2'>
            <SignaturePad onChange={setImage} disabled={sign.isPending} />
          </div>
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!image || !signerName.trim() || sign.isPending}
            data-testid='uat-inspection-sign-submit'
          >
            {sign.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Save signature
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ItemRow({
  projectId,
  item,
  index,
  editable,
  canRaise,
  problem,
  onSave,
  onSign,
  onRaise,
  saving,
}: {
  projectId: string
  item: FormInstanceItem
  index: number
  editable: boolean
  canRaise: boolean
  problem: CompletionProblem | undefined
  onSave: (itemId: string, value: string | null, note?: string | null) => void
  onSign: (itemId: string) => void
  onRaise: (itemId: string, target: 'punch_item' | 'observation') => void
  saving: boolean
}) {
  const response = item.response
  const [draft, setDraft] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const [showNote, setShowNote] = useState(false)
  const [showPhotos, setShowPhotos] = useState(false)
  const value = draft ?? response?.value ?? ''
  const note = noteDraft ?? response?.note ?? ''
  const numberOptions =
    item.responseType === 'number' &&
    item.options &&
    !Array.isArray(item.options)
      ? (item.options as NumberOptions)
      : null
  const deficient = Boolean(response?.isDeficient)
  const answered =
    Boolean(response?.value) ||
    (response?.photoCount ?? 0) > 0 ||
    Boolean(item.signature)

  const commitText = () => {
    if (draft === null) return
    if (draft !== (response?.value ?? ''))
      onSave(item.id, draft || null, note || null)
    setDraft(null)
  }
  const commitNote = () => {
    if (noteDraft === null) return
    if (noteDraft !== (response?.note ?? ''))
      onSave(item.id, response?.value ?? null, noteDraft || null)
    setNoteDraft(null)
  }

  let control: React.ReactNode = null
  switch (item.responseType) {
    case 'pass_fail':
      control = (
        <ChoiceButtons
          options={[
            { value: 'pass', label: 'Pass', tone: 'good' },
            { value: 'fail', label: 'Fail', tone: 'bad' },
            { value: 'na', label: 'N/A', tone: 'muted' },
          ]}
          value={response?.value ?? null}
          onChange={(next) => onSave(item.id, next, note || null)}
          disabled={!editable || saving}
        />
      )
      break
    case 'yes_no':
      control = (
        <ChoiceButtons
          options={[
            { value: 'yes', label: 'Yes', tone: 'good' },
            { value: 'no', label: 'No', tone: 'bad' },
            { value: 'na', label: 'N/A', tone: 'muted' },
          ]}
          value={response?.value ?? null}
          onChange={(next) => onSave(item.id, next, note || null)}
          disabled={!editable || saving}
        />
      )
      break
    case 'checkbox':
      control = (
        <label className='flex items-center gap-2 text-sm'>
          <Checkbox
            checked={response?.value === 'checked'}
            disabled={!editable || saving}
            onCheckedChange={(checked) =>
              onSave(
                item.id,
                checked === true ? 'checked' : 'unchecked',
                note || null
              )
            }
          />
          Done
        </label>
      )
      break
    case 'text':
      control = (
        <Textarea
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitText}
          rows={2}
          disabled={!editable}
          placeholder='Type the answer'
          className='max-w-xl'
        />
      )
      break
    case 'number':
      control = (
        <div className='flex items-center gap-2'>
          <Input
            type='number'
            inputMode='decimal'
            value={value}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitText}
            disabled={!editable}
            className='w-32'
            step='any'
          />
          {numberOptions?.unit && (
            <span className='text-sm text-muted-foreground'>
              {numberOptions.unit}
            </span>
          )}
          {numberOptions &&
            (numberOptions.min !== null || numberOptions.max !== null) && (
              <span className='text-xs text-muted-foreground'>
                {numberOptions.min ?? '…'} – {numberOptions.max ?? '…'}
              </span>
            )}
        </div>
      )
      break
    case 'choice':
      control = (
        <Select
          value={response?.value ?? ''}
          onValueChange={(next) => onSave(item.id, next, note || null)}
          disabled={!editable || saving}
        >
          <SelectTrigger className='w-64'>
            <SelectValue placeholder='Choose' />
          </SelectTrigger>
          <SelectContent>
            {(Array.isArray(item.options) ? item.options : []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
      break
    case 'date':
      control = (
        <Input
          type='date'
          value={value}
          onChange={(event) => {
            setDraft(event.target.value)
            onSave(item.id, event.target.value || null, note || null)
          }}
          disabled={!editable}
          className='w-44'
        />
      )
      break
    case 'photo':
      control = response ? (
        <span className='text-sm text-muted-foreground'>
          {response.photoCount} photo{response.photoCount === 1 ? '' : 's'}
        </span>
      ) : (
        <Button
          size='sm'
          variant='outline'
          disabled={!editable || saving}
          onClick={() => {
            onSave(item.id, 'provided', null)
            setShowPhotos(true)
          }}
        >
          <Camera className='mr-1.5 h-4 w-4' /> Add photo
        </Button>
      )
      break
    case 'signature':
      control = item.signature ? (
        <span className='flex items-center gap-1 text-sm'>
          <CheckCircle2 className='h-4 w-4 text-emerald-600' /> Signed by{' '}
          {item.signature.signerName} ·{' '}
          {new Date(item.signature.signedAt).toLocaleString()}
        </span>
      ) : (
        <Button
          size='sm'
          variant='outline'
          disabled={!editable}
          onClick={() => onSign(item.id)}
          data-testid='uat-inspection-item-sign'
        >
          <PenLine className='mr-1.5 h-4 w-4' /> Sign
        </Button>
      )
      break
  }

  return (
    <div
      className={cn(
        'space-y-2 rounded border p-3',
        deficient && 'border-destructive/50 bg-destructive/5',
        problem && 'border-amber-500/60 bg-amber-50/60 dark:bg-amber-950/20'
      )}
      data-testid='uat-inspection-item'
    >
      <div className='flex flex-wrap items-start gap-2'>
        <span className='mt-0.5 w-6 text-right font-mono text-xs text-muted-foreground'>
          {index}
        </span>
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-medium'>
            {item.label}
            {item.required && <span className='ml-1 text-destructive'>*</span>}
          </p>
          {item.description && (
            <p className='text-xs text-muted-foreground'>{item.description}</p>
          )}
          <div className='mt-1 flex flex-wrap gap-1'>
            {item.isHoldPoint && (
              <Badge variant='destructive' className='gap-1'>
                <Flag className='h-3 w-3' /> Hold point
              </Badge>
            )}
            {!item.isHoldPoint && item.inspectionPointType && (
              <Badge variant='outline'>{item.inspectionPointType} point</Badge>
            )}
            {item.photoRequired && (
              <Badge variant='outline' className='gap-1'>
                <Camera className='h-3 w-3' /> Photo required
              </Badge>
            )}
            {item.reference && (
              <Badge variant='outline'>{item.reference}</Badge>
            )}
            {answered && response?.answeredAt && (
              <span className='text-xs text-muted-foreground'>
                answered {new Date(response.answeredAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className='shrink-0'>{control}</div>
      </div>
      {problem && (
        <p className='pl-8 text-xs text-amber-700 dark:text-amber-300'>
          This item {PROBLEM_TEXT[problem.reason]}.
        </p>
      )}
      <div className='flex flex-wrap items-center gap-2 pl-8'>
        <Button
          size='sm'
          variant='ghost'
          className='h-7 px-2 text-xs'
          onClick={() => setShowNote((open) => !open)}
        >
          <MessageSquare className='mr-1 h-3.5 w-3.5' />
          {note ? 'Note' : 'Add note'}
        </Button>
        {(response || item.responseType !== 'photo') && (
          <Button
            size='sm'
            variant='ghost'
            className='h-7 px-2 text-xs'
            disabled={!response}
            title={response ? undefined : 'Answer first, then add photos'}
            onClick={() => setShowPhotos((open) => !open)}
            data-testid='uat-inspection-item-photos'
          >
            <Camera className='mr-1 h-3.5 w-3.5' />
            Photos{response?.photoCount ? ` (${response.photoCount})` : ''}
          </Button>
        )}
        {deficient && !response?.deficiencyRecordId && canRaise && (
          <Button
            size='sm'
            variant='outline'
            className='h-7 px-2 text-xs text-destructive'
            disabled={saving}
            onClick={() => onRaise(item.id, 'punch_item')}
            data-testid='uat-inspection-raise-punch'
          >
            <AlertTriangle className='mr-1 h-3.5 w-3.5' /> Raise punch item
          </Button>
        )}
        {deficient && !response?.deficiencyRecordId && canRaise && (
          <Button
            size='sm'
            variant='outline'
            className='h-7 px-2 text-xs'
            disabled={saving}
            onClick={() => onRaise(item.id, 'observation')}
            data-testid='uat-inspection-raise-observation'
          >
            <AlertTriangle className='mr-1 h-3.5 w-3.5' /> Raise observation
          </Button>
        )}
        {response?.deficiencyRecordId && response.deficiencyPath && (
          <Link
            to={response.deficiencyPath}
            className='text-xs underline-offset-2 hover:underline'
          >
            {response.deficiencyRecordType === 'observation'
              ? 'Observation'
              : 'Punch item'}{' '}
            raised →
          </Link>
        )}
      </div>
      {showNote && (
        <div className='pl-8'>
          <Textarea
            value={note}
            onChange={(event) => setNoteDraft(event.target.value)}
            onBlur={commitNote}
            rows={2}
            disabled={!editable}
            placeholder='What you saw'
            maxLength={2000}
          />
        </div>
      )}
      {showPhotos && response && (
        <div className='pl-8'>
          <AttachmentPanel
            projectId={projectId}
            recordType='form_response'
            recordId={response.id}
            compact
          />
        </div>
      )}
      {!showNote && note && (
        <p className='pl-8 text-xs text-muted-foreground'>“{note}”</p>
      )}
    </div>
  )
}

/**
 * Fill in an inspection: answer items, attach photos, sign, complete;
 * approvers close or reopen. Deficient answers become punch items.
 */
export function InstanceRunner({
  projectId,
  instanceId,
  onOpenChange,
}: {
  projectId: string
  instanceId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const { data: instance, isLoading } = useFormInstance(projectId, instanceId)
  const save = useSaveFormResponses(projectId)
  const act = useFormInstanceAction(projectId)
  const raise = useRaiseFormDeficiency(projectId)
  const canAnswer = useCanPerform('inspection', 'submit', 'inspection.start')
  const canComplete = useCanPerform(
    'inspection',
    'submit',
    'inspection.complete'
  )
  const canSign = useCanPerform('inspection', 'submit', 'inspection.sign')
  const canClose = useCanPerform('inspection', 'approve', 'inspection.close')
  const canReopen = useCanPerform('inspection', 'approve', 'inspection.reopen')
  const canVoid = useCanPerform('inspection', 'approve', 'inspection.void')
  const canExport = useCanPerform('inspection', 'export')
  const canCreatePunch = useCanPerform('punch', 'create')
  const [problems, setProblems] = useState<CompletionProblem[]>([])
  const [reasonFor, setReasonFor] = useState<'reopen' | 'void' | null>(null)
  const [reason, setReason] = useState('')
  const [signing, setSigning] = useState<{
    role: SignatureRole
    itemId: string | null
    seed: number
  } | null>(null)
  const [exporting, setExporting] = useState(false)

  const open = instance ? isFormOpen(instance.status) : false
  const editable = open && canAnswer
  const busy = save.isPending || act.isPending || raise.isPending

  const onSave = (
    itemId: string,
    value: string | null,
    note?: string | null
  ) => {
    if (!instance) return
    save.mutate(
      {
        instanceId: instance.id,
        responses: [{ itemId, value, note: note ?? undefined }],
      },
      { onError: (error) => toast.error(getServerErrorMessage(error)) }
    )
  }

  const run = async (
    action: 'start' | 'complete' | 'close' | 'reopen' | 'void',
    text?: string
  ) => {
    if (!instance) return
    try {
      const result = await act.mutateAsync({
        instanceId: instance.id,
        action,
        reason: text,
      })
      setProblems([])
      setReasonFor(null)
      setReason('')
      toast.success(
        action === 'complete'
          ? `${result.ref} complete — ${result.outcome === 'fail' ? 'failed' : 'passed'}${result.nextInstance ? ` · next: ${result.nextInstance.ref}` : ''}`
          : `${result.ref} ${result.status.replace(/_/g, ' ')}`
      )
    } catch (error) {
      const listed = completionProblemsFrom(error)
      if (listed.length) {
        setProblems(listed)
        toast.error(
          `${listed.length} item${listed.length === 1 ? '' : 's'} still need attention`
        )
      } else {
        toast.error(getServerErrorMessage(error))
      }
    }
  }

  const onRaise = async (
    itemId: string,
    target: 'punch_item' | 'observation'
  ) => {
    if (!instance) return
    try {
      const result = await raise.mutateAsync({
        instanceId: instance.id,
        itemId,
        payload: { target },
      })
      toast.success(`${result.record.ref} raised`)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const exportPdf = async () => {
    if (!instance) return
    setExporting(true)
    try {
      const fileName = await downloadFormPdf(projectId, instance.id, {
        includePhotos: true,
      })
      toast.success(`Downloaded ${fileName}`)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  const problemFor = (itemId: string) =>
    problems.find((problem) => problem.itemId === itemId)
  const roleProblems = problems.filter(
    (problem) => problem.reason === 'signature_role'
  )
  const requiredRoles = instance?.template?.settings.requireSignatures ?? []
  const missingRoles = requiredRoles.filter(
    (role) =>
      !(instance?.signatures ?? []).some(
        (signature) => signature.role === role && !signature.itemId
      )
  )
  let itemIndex = 0

  return (
    <Dialog
      open={Boolean(instanceId)}
      onOpenChange={(next) => (next ? undefined : onOpenChange(false))}
    >
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-5xl'
        data-testid='uat-inspection-runner'
      >
        {isLoading || !instance ? (
          <div className='flex items-center gap-2 py-8 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className='flex flex-wrap items-center gap-2'>
                <span className='font-mono'>{instance.ref}</span>
                <span className='min-w-0 flex-1 truncate font-normal'>
                  {instance.title}
                </span>
                <FormTypeBadge type={instance.type} />
                <FormStatusBadge
                  status={instance.status}
                  outcome={instance.outcome}
                />
                {instance.isOverdue && (
                  <Badge variant='destructive' className='gap-1'>
                    <AlertTriangle className='h-3 w-3' /> Overdue
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription className='flex flex-wrap gap-x-3 gap-y-1'>
                {instance.template && (
                  <span>
                    {instance.template.name} v{instance.templateVersion}
                  </span>
                )}
                {instance.activity && (
                  <span>Activity: {instance.activity.name}</span>
                )}
                {instance.location && <span>{instance.location.name}</span>}
                {instance.sheet && <span>Sheet {instance.sheet.number}</span>}
                {instance.assigneeCompany && (
                  <span>{instance.assigneeCompany.name}</span>
                )}
                {instance.assigneeUser && (
                  <span>Assignee {instance.assigneeUser.name}</span>
                )}
                {instance.inspectorUser && (
                  <span>Inspector {instance.inspectorUser.name}</span>
                )}
                {instance.approverUser && (
                  <span>Approver {instance.approverUser.name}</span>
                )}
                <span>
                  {instance.scheduledFor
                    ? `Scheduled ${formatFormDate(instance.scheduledFor)}`
                    : ''}
                  {instance.dueDate
                    ? ` · due ${formatFormDate(instance.dueDate)}`
                    : ''}
                </span>
                {instance.ballInCourtUser && (
                  <span>Waiting on {instance.ballInCourtUser.name}</span>
                )}
              </DialogDescription>
            </DialogHeader>

            {instance.template?.settings.instructions && (
              <p className='rounded border bg-muted/40 p-3 text-sm'>
                {instance.template.settings.instructions}
              </p>
            )}

            {instance.summary && (
              <div className='space-y-1'>
                <div className='flex items-center justify-between text-xs text-muted-foreground'>
                  <span>
                    {instance.summary.answered}/{instance.summary.total}{' '}
                    answered
                    {instance.summary.deficient
                      ? ` · ${instance.summary.deficient} deficient`
                      : ''}
                    {instance.summary.holdPoints
                      ? ` · ${instance.summary.holdPointsOpen} of ${instance.summary.holdPoints} hold points open`
                      : ''}
                  </span>
                  <span>
                    {Math.round(
                      (instance.summary.answered /
                        Math.max(1, instance.summary.total)) *
                        100
                    )}
                    %
                  </span>
                </div>
                <div className='h-1.5 w-full overflow-hidden rounded bg-muted'>
                  <div
                    className={cn(
                      'h-full rounded',
                      instance.summary.deficient
                        ? 'bg-destructive'
                        : 'bg-primary'
                    )}
                    style={{
                      width: `${(instance.summary.answered / Math.max(1, instance.summary.total)) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {(instance.holdPoints?.length ?? 0) > 0 && (
              <div
                className='rounded border border-amber-500/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20'
                data-testid='uat-inspection-holdpoints'
              >
                <p className='flex items-center gap-2 font-medium'>
                  <Flag className='h-4 w-4 text-destructive' /> Progress on{' '}
                  {instance.activity?.name ?? 'the activity'} is held until
                  these pass
                </p>
                <ul className='mt-1 list-disc pl-6 text-muted-foreground'>
                  {instance.holdPoints!.map((point) => (
                    <li key={point.itemId}>
                      {point.label} — {point.state}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div
              className='flex flex-wrap items-center gap-2'
              data-testid='uat-inspection-actions'
            >
              {instance.status === 'scheduled' && canAnswer && (
                <Button
                  size='sm'
                  onClick={() => run('start')}
                  disabled={busy}
                  data-testid='uat-inspection-start'
                >
                  <Play className='mr-1.5 h-4 w-4' /> Start
                </Button>
              )}
              {open && canComplete && (
                <Button
                  size='sm'
                  onClick={() => run('complete')}
                  disabled={busy}
                  data-testid='uat-inspection-complete'
                >
                  <CheckCircle2 className='mr-1.5 h-4 w-4' /> Complete
                </Button>
              )}
              {instance.status === 'complete' && canClose && (
                <Button
                  size='sm'
                  onClick={() => run('close')}
                  disabled={busy}
                  data-testid='uat-inspection-close'
                >
                  <ShieldCheck className='mr-1.5 h-4 w-4' /> Close
                </Button>
              )}
              {(instance.status === 'complete' ||
                instance.status === 'closed') &&
                canReopen && (
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setReasonFor('reopen')}
                    disabled={busy}
                    data-testid='uat-inspection-reopen'
                  >
                    <RotateCcw className='mr-1.5 h-4 w-4' /> Reopen
                  </Button>
                )}
              {instance.status !== 'closed' &&
                instance.status !== 'void' &&
                canVoid && (
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => setReasonFor('void')}
                    disabled={busy}
                  >
                    <XCircle className='mr-1.5 h-4 w-4' /> Void
                  </Button>
                )}
              {open && canSign && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() =>
                    setSigning((current) => ({
                      role: missingRoles[0] ?? 'inspector',
                      itemId: null,
                      seed: (current?.seed ?? 0) + 1,
                    }))
                  }
                  data-testid='uat-inspection-add-signature'
                >
                  <PenLine className='mr-1.5 h-4 w-4' /> Sign
                </Button>
              )}
              {canExport && (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={exportPdf}
                  disabled={exporting}
                  data-testid='uat-inspection-export'
                >
                  {exporting ? (
                    <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
                  ) : (
                    <Download className='mr-1.5 h-4 w-4' />
                  )}
                  PDF
                </Button>
              )}
            </div>

            {problems.length > 0 && (
              <div
                className='rounded border border-amber-500/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20'
                data-testid='uat-inspection-problems'
              >
                <p className='font-medium'>Before this can be completed:</p>
                <ul className='mt-1 list-disc pl-6'>
                  {problems.map((problem, index) => (
                    <li key={`${problem.itemId ?? problem.role}-${index}`}>
                      {problem.label} {PROBLEM_TEXT[problem.reason]}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className='space-y-4'>
              {(instance.sections ?? []).map((section) => (
                <section
                  key={section.id}
                  className='space-y-2'
                  data-testid='uat-inspection-section'
                >
                  <h4 className='text-sm font-semibold'>{section.title}</h4>
                  {section.description && (
                    <p className='text-xs text-muted-foreground'>
                      {section.description}
                    </p>
                  )}
                  {section.items.map((item) => {
                    itemIndex += 1
                    return (
                      <ItemRow
                        key={item.id}
                        projectId={projectId}
                        item={item}
                        index={itemIndex}
                        editable={editable}
                        canRaise={canCreatePunch && canComplete}
                        problem={problemFor(item.id)}
                        onSave={onSave}
                        onSign={(itemId) =>
                          setSigning((current) => ({
                            role: 'inspector',
                            itemId,
                            seed: (current?.seed ?? 0) + 1,
                          }))
                        }
                        onRaise={onRaise}
                        saving={save.isPending}
                      />
                    )
                  })}
                </section>
              ))}
            </div>

            <section className='space-y-2'>
              <h4 className='flex items-center gap-2 text-sm font-semibold'>
                <PenLine className='h-4 w-4' /> Signatures
                {requiredRoles.length > 0 && (
                  <span className='font-normal text-muted-foreground'>
                    required: {requiredRoles.join(', ')}
                  </span>
                )}
              </h4>
              {(instance.signatures?.length ?? 0) === 0 ? (
                <p className='text-sm text-muted-foreground'>
                  Nobody has signed yet.
                </p>
              ) : (
                <ul className='space-y-1 text-sm'>
                  {instance.signatures!.map((signature) => (
                    <li
                      key={signature.id}
                      className='flex flex-wrap items-center gap-2'
                    >
                      <Badge variant='outline'>{signature.role}</Badge>
                      <span>{signature.signerName}</span>
                      {signature.signerCompany && (
                        <span className='text-muted-foreground'>
                          {signature.signerCompany}
                        </span>
                      )}
                      <span className='text-xs text-muted-foreground'>
                        {new Date(signature.signedAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {roleProblems.length > 0 && (
                <p className='text-xs text-amber-700 dark:text-amber-300'>
                  Missing:{' '}
                  {roleProblems.map((problem) => problem.role).join(', ')}
                </p>
              )}
            </section>

            <RecordPins
              projectId={projectId}
              recordType='form_instance'
              recordId={instance.id}
            />

            <div className='grid gap-4 lg:grid-cols-2'>
              <section className='space-y-2'>
                <h4 className='flex items-center gap-2 text-sm font-semibold'>
                  <FileText className='h-4 w-4' /> Evidence
                </h4>
                <AttachmentPanel
                  projectId={projectId}
                  recordType='form_instance'
                  recordId={instance.id}
                  compact
                />
              </section>
              <section className='space-y-2'>
                <h4 className='flex items-center gap-2 text-sm font-semibold'>
                  <History className='h-4 w-4' /> History
                </h4>
                <HistoryPanel
                  projectId={projectId}
                  entityType='form_instance'
                  entityId={instance.id}
                  title={`${instance.ref} History`}
                  limit={30}
                  showFilters={false}
                />
              </section>
              <div className='lg:col-span-2'>
                <CommentThread
                  projectId={projectId}
                  recordType='form_instance'
                  recordId={instance.id}
                />
              </div>
            </div>
          </>
        )}
      </DialogContent>

      {reasonFor && (
        <Dialog
          open
          onOpenChange={(next) => (next ? undefined : setReasonFor(null))}
        >
          <DialogContent data-testid='uat-inspection-reason'>
            <DialogHeader>
              <DialogTitle>
                {reasonFor === 'reopen' ? 'Reopen' : 'Void'}
              </DialogTitle>
              <DialogDescription>
                {reasonFor === 'reopen'
                  ? 'The result is cleared and the inspector can answer again.'
                  : 'Voided inspections stay in the record but drop off the list and release any hold points.'}
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-1'>
              <Label htmlFor='inspection-reason'>Reason</Label>
              <Textarea
                id='inspection-reason'
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={2000}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant='ghost' onClick={() => setReasonFor(null)}>
                Cancel
              </Button>
              <Button
                variant={reasonFor === 'void' ? 'destructive' : 'default'}
                disabled={!reason.trim() || busy}
                onClick={() => run(reasonFor, reason.trim())}
                data-testid='uat-inspection-reason-submit'
              >
                {reasonFor === 'reopen' ? 'Reopen' : 'Void'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {signing && instance && (
        <SignDialog
          key={`sign-${signing.seed}`}
          instanceId={instance.id}
          projectId={projectId}
          open
          role={signing.role}
          itemId={signing.itemId}
          onOpenChange={(next) => {
            if (!next) setSigning(null)
          }}
        />
      )}
    </Dialog>
  )
}
