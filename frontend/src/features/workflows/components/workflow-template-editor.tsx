import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { UserPicker } from '@/components/user-picker'
import {
  PARTY_ROLE_OPTIONS,
  PROJECT_ROLE_OPTIONS,
} from '@/features/doc-control/lib/submittal-workflow'
import {
  usePermissionTemplates,
  useProjectTeam,
} from '@/features/permissions/hooks/use-permissions'
import {
  CONDITION_OPS,
  END_FAIL,
  END_SUCCESS,
  STEP_TYPE_LABEL,
  targetLabel,
  useArchiveWorkflowTemplate,
  useCreateWorkflowTemplate,
  useSeedWorkflowDefaults,
  useUpdateWorkflowTemplate,
  useWorkflowTemplates,
  useWorkflowTools,
  type ConditionOp,
  type WorkflowAssignee,
  type WorkflowCondition,
  type WorkflowContextField,
  type WorkflowStep,
  type WorkflowStepType,
  type WorkflowTemplate,
  type WorkflowTool,
  type WorkflowToolKey,
} from '../hooks/use-workflow-engine'

// ─── draft model ───────────────────────────────────────────────────────────

type DraftCondition = { field: string; op: ConditionOp; value: string }

type DraftResponse = {
  key: string
  label: string
  next: string
  tone: 'positive' | 'negative' | 'neutral'
  requireComment: boolean
}

type DraftStep = {
  key: string
  name: string
  type: WorkflowStepType
  description: string
  assignees: WorkflowAssignee[]
  requireAll: boolean
  days: string
  escalateRoles: string[]
  responses: DraftResponse[]
  condition: DraftCondition
  whenTrue: string
  whenFalse: string
  notifyRoles: string[]
  message: string
  next: string
}

type Draft = {
  tool: WorkflowToolKey | ''
  name: string
  description: string
  isDefault: boolean
  priority: string
  rules: DraftCondition[]
  steps: DraftStep[]
}

let keyCounter = 0
const newKey = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${(keyCounter++).toString(36)}`

const valueToText = (value: unknown) =>
  Array.isArray(value)
    ? value.join(', ')
    : value === null || value === undefined
      ? ''
      : String(value)

const conditionToDraft = (
  condition?: WorkflowCondition | null
): DraftCondition => ({
  field: condition?.field ?? '',
  op: condition?.op ?? 'gte',
  value: valueToText(condition?.value),
})

const defaultResponses = (): DraftResponse[] => [
  {
    key: 'approve',
    label: 'Approve',
    next: END_SUCCESS,
    tone: 'positive',
    requireComment: false,
  },
  {
    key: 'reject',
    label: 'Reject',
    next: END_FAIL,
    tone: 'negative',
    requireComment: true,
  },
]

const emptyStep = (type: WorkflowStepType = 'response'): DraftStep => ({
  key: newKey('step'),
  name: '',
  type,
  description: '',
  assignees: [],
  requireAll: false,
  days: '5',
  escalateRoles: ['pm'],
  responses: defaultResponses(),
  condition: conditionToDraft(),
  whenTrue: END_SUCCESS,
  whenFalse: END_SUCCESS,
  notifyRoles: ['pm'],
  message: '',
  next: END_SUCCESS,
})

const stepToDraft = (step: WorkflowStep): DraftStep => ({
  ...emptyStep(step.type),
  key: step.key,
  name: step.name,
  description: step.description ?? '',
  assignees: [...(step.assignees ?? [])],
  requireAll: Boolean(step.requireAll),
  days: step.days === null || step.days === undefined ? '' : String(step.days),
  escalateRoles: step.escalateRoles ?? ['pm'],
  responses: step.responses?.length
    ? step.responses.map((response, index) => ({
        key: response.key ?? `response_${index + 1}`,
        label: response.label,
        next: response.next,
        tone: response.tone ?? 'neutral',
        requireComment: Boolean(response.requireComment),
      }))
    : defaultResponses(),
  condition: conditionToDraft(step.condition),
  whenTrue: step.whenTrue ?? END_SUCCESS,
  whenFalse: step.whenFalse ?? END_SUCCESS,
  notifyRoles: step.action?.roles ?? ['pm'],
  message: step.action?.message ?? '',
  next: step.next ?? END_SUCCESS,
})

const draftFrom = (
  template: WorkflowTemplate | null,
  tool: WorkflowToolKey | ''
): Draft => ({
  tool: template?.tool ?? tool,
  name: template?.name ?? '',
  description: template?.description ?? '',
  isDefault: template?.isDefault ?? false,
  priority: String(template?.priority ?? 0),
  rules: (template?.rules ?? []).map(conditionToDraft),
  steps: template?.steps?.length
    ? template.steps.map(stepToDraft)
    : [emptyStep()],
})

const conditionValue = (
  condition: DraftCondition,
  fields: WorkflowContextField[]
): unknown => {
  const op = CONDITION_OPS.find((item) => item.id === condition.op)
  if (!op?.needsValue) return null
  const field = fields.find((item) => item.key === condition.field)
  const raw = condition.value.trim()
  if (condition.op === 'in' || condition.op === 'nin') {
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) =>
        field?.type === 'number' && Number.isFinite(Number(part))
          ? Number(part)
          : part
      )
  }
  if (field?.type === 'number') {
    const numeric = Number(raw.replace(/,/g, ''))
    return Number.isFinite(numeric) ? numeric : raw
  }
  if (field?.type === 'boolean') return raw === 'true'
  return raw
}

const toCondition = (
  condition: DraftCondition,
  fields: WorkflowContextField[]
): WorkflowCondition => ({
  field: condition.field,
  op: condition.op,
  value: conditionValue(condition, fields),
})

const toPayloadStep = (
  step: DraftStep,
  fields: WorkflowContextField[]
): WorkflowStep => {
  const base = {
    key: step.key,
    name: step.name.trim(),
    type: step.type,
    description: step.description.trim() || null,
  }
  if (step.type === 'response') {
    return {
      ...base,
      assignees: step.assignees,
      requireAll: step.requireAll,
      days: step.days.trim() === '' ? null : Number(step.days),
      escalateRoles: step.escalateRoles,
      responses: step.responses.map((response) => ({
        key: response.key,
        label: response.label.trim(),
        next: response.next,
        tone: response.tone,
        requireComment: response.requireComment,
      })),
    }
  }
  if (step.type === 'condition') {
    return {
      ...base,
      condition: toCondition(step.condition, fields),
      whenTrue: step.whenTrue,
      whenFalse: step.whenFalse,
    }
  }
  return {
    ...base,
    action: {
      type: 'notify',
      roles: step.notifyRoles,
      message: step.message.trim() || null,
    },
    next: step.next,
  }
}

// ─── small pieces ──────────────────────────────────────────────────────────

const roleLabel = (role: string | null | undefined) =>
  PROJECT_ROLE_OPTIONS.find((option) => option.id === role)?.label ??
  role ??
  'Role'

export const assigneeLabel = (
  assignee: WorkflowAssignee,
  nameOf: (userId: string) => string,
  templateNameOf: (templateId: string) => string
) => {
  if (assignee.type === 'user') return nameOf(assignee.userId ?? '')
  if (assignee.type === 'party_role')
    return `${PARTY_ROLE_OPTIONS.find((role) => role.id === assignee.role)?.label ?? assignee.role} party`
  if (assignee.type === 'permission_template')
    return `Template: ${templateNameOf(assignee.templateId ?? '')}`
  return roleLabel(assignee.role)
}

function TargetSelect({
  value,
  onChange,
  steps,
  excludeKey,
  label,
}: {
  value: string
  onChange: (next: string) => void
  steps: DraftStep[]
  excludeKey?: string
  label: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className='w-full' aria-label={label}>
        <SelectValue placeholder='Then…' />
      </SelectTrigger>
      <SelectContent>
        {steps
          .filter((step) => step.key !== excludeKey)
          .map((step) => (
            <SelectItem key={step.key} value={step.key}>
              Go to: {step.name || 'Untitled step'}
            </SelectItem>
          ))}
        <SelectItem value={END_SUCCESS}>Finish – approved</SelectItem>
        <SelectItem value={END_FAIL}>Finish – not approved</SelectItem>
      </SelectContent>
    </Select>
  )
}

function ConditionFields({
  condition,
  fields,
  onChange,
}: {
  condition: DraftCondition
  fields: WorkflowContextField[]
  onChange: (next: DraftCondition) => void
}) {
  const op = CONDITION_OPS.find((item) => item.id === condition.op)
  const field = fields.find((item) => item.key === condition.field)
  return (
    <div className='grid gap-2 sm:grid-cols-[1fr_1fr_1fr]'>
      <Select
        value={condition.field}
        onValueChange={(next) => onChange({ ...condition, field: next })}
      >
        <SelectTrigger aria-label='Field'>
          <SelectValue placeholder='Field' />
        </SelectTrigger>
        <SelectContent>
          {fields.map((item) => (
            <SelectItem key={item.key} value={item.key}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={condition.op}
        onValueChange={(next) =>
          onChange({ ...condition, op: next as ConditionOp })
        }
      >
        <SelectTrigger aria-label='Operator'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONDITION_OPS.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {op?.needsValue ? (
        <Input
          aria-label='Value'
          placeholder={
            condition.op === 'in' || condition.op === 'nin'
              ? 'a, b, c'
              : field?.type === 'number'
                ? '50000'
                : 'Value'
          }
          value={condition.value}
          onChange={(event) =>
            onChange({ ...condition, value: event.target.value })
          }
        />
      ) : (
        <span className='self-center text-xs text-muted-foreground'>
          No value needed
        </span>
      )}
    </div>
  )
}

function RoleChecklist({
  value,
  onChange,
  idPrefix,
}: {
  value: string[]
  onChange: (next: string[]) => void
  idPrefix: string
}) {
  return (
    <div className='flex flex-wrap gap-x-4 gap-y-1'>
      {PROJECT_ROLE_OPTIONS.map((role) => {
        const id = `${idPrefix}-${role.id}`
        const checked = value.includes(role.id)
        return (
          <label
            key={role.id}
            htmlFor={id}
            className='flex items-center gap-1.5 text-xs'
          >
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={(state) =>
                onChange(
                  state === true
                    ? [...value, role.id]
                    : value.filter((item) => item !== role.id)
                )
              }
            />
            {role.label}
          </label>
        )
      })}
    </div>
  )
}

function AssigneeAdder({
  projectId,
  onAdd,
}: {
  projectId: string | null
  onAdd: (assignee: WorkflowAssignee) => void
}) {
  const [type, setType] = useState<WorkflowAssignee['type']>(
    projectId ? 'user' : 'role'
  )
  const [choice, setChoice] = useState('')
  const { data: templates } = usePermissionTemplates(
    {},
    { enabled: type === 'permission_template' }
  )
  const options =
    type === 'party_role'
      ? PARTY_ROLE_OPTIONS
      : type === 'permission_template'
        ? (templates?.items ?? []).map((template) => ({
            id: template.id,
            label: template.name,
          }))
        : PROJECT_ROLE_OPTIONS
  return (
    <div className='flex flex-wrap items-end gap-2'>
      <Select
        value={type}
        onValueChange={(value) => {
          setType(value as WorkflowAssignee['type'])
          setChoice('')
        }}
      >
        <SelectTrigger className='w-48' aria-label='Assignee type'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {projectId && <SelectItem value='user'>A person</SelectItem>}
          <SelectItem value='role'>Everyone with a role</SelectItem>
          <SelectItem value='party_role'>Everyone in a party</SelectItem>
          <SelectItem value='permission_template'>
            Everyone on a permission template
          </SelectItem>
        </SelectContent>
      </Select>
      {type === 'user' && projectId ? (
        <UserPicker
          projectId={projectId}
          value={null}
          onChange={(userId) => {
            if (userId) onAdd({ type: 'user', userId })
          }}
          placeholder='Pick a person'
          className='w-56'
        />
      ) : (
        <>
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger className='w-56' aria-label='Assignee'>
              <SelectValue placeholder='Choose…' />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type='button'
            size='sm'
            variant='outline'
            disabled={!choice}
            onClick={() => {
              onAdd(
                type === 'permission_template'
                  ? { type, templateId: choice }
                  : { type, role: choice }
              )
              setChoice('')
            }}
          >
            <Plus className='mr-1 h-3 w-3' />
            Add
          </Button>
        </>
      )}
    </div>
  )
}

function StepCard({
  step,
  index,
  total,
  steps,
  fields,
  projectId,
  nameOf,
  templateNameOf,
  onChange,
  onMove,
  onRemove,
}: {
  step: DraftStep
  index: number
  total: number
  steps: DraftStep[]
  fields: WorkflowContextField[]
  projectId: string | null
  nameOf: (userId: string) => string
  templateNameOf: (templateId: string) => string
  onChange: (patch: Partial<DraftStep>) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const setResponse = (responseIndex: number, patch: Partial<DraftResponse>) =>
    onChange({
      responses: step.responses.map((response, i) =>
        i === responseIndex ? { ...response, ...patch } : response
      ),
    })

  return (
    <div
      className='space-y-3 rounded-md border p-3'
      data-testid='uat-workflow-step'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <Badge variant='outline'>Step {index + 1}</Badge>
        <Select
          value={step.type}
          onValueChange={(value) =>
            onChange({ type: value as WorkflowStepType })
          }
        >
          <SelectTrigger className='w-32' aria-label='Step type'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STEP_TYPE_LABEL) as WorkflowStepType[]).map(
              (type) => (
                <SelectItem key={type} value={type}>
                  {STEP_TYPE_LABEL[type]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        <Input
          className='min-w-48 flex-1'
          placeholder='Step name'
          aria-label='Step name'
          value={step.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <div className='ml-auto flex gap-1'>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            aria-label='Move up'
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className='h-4 w-4' />
          </Button>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            aria-label='Move down'
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className='h-4 w-4' />
          </Button>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            aria-label='Remove step'
            disabled={total === 1}
            onClick={onRemove}
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      </div>

      {step.type === 'response' && (
        <>
          <div className='space-y-2'>
            <Label className='text-xs'>Who decides</Label>
            <div className='flex flex-wrap gap-1'>
              {step.assignees.length === 0 && (
                <span className='text-xs text-muted-foreground'>
                  Add at least one assignee.
                </span>
              )}
              {step.assignees.map((assignee, assigneeIndex) => (
                <Badge
                  key={`${assignee.type}-${assignee.userId ?? assignee.role ?? assignee.templateId}`}
                  variant='secondary'
                  className='gap-1'
                >
                  {assigneeLabel(assignee, nameOf, templateNameOf)}
                  <button
                    type='button'
                    aria-label='Remove assignee'
                    onClick={() =>
                      onChange({
                        assignees: step.assignees.filter(
                          (_, i) => i !== assigneeIndex
                        ),
                      })
                    }
                  >
                    <X className='h-3 w-3' />
                  </button>
                </Badge>
              ))}
            </div>
            <AssigneeAdder
              projectId={projectId}
              onAdd={(assignee) =>
                onChange({ assignees: [...step.assignees, assignee] })
              }
            />
          </div>
          <div className='grid gap-3 sm:grid-cols-3'>
            <div className='space-y-1'>
              <Label className='text-xs' htmlFor={`${step.key}-days`}>
                Days allowed
              </Label>
              <Input
                id={`${step.key}-days`}
                type='number'
                min={0}
                value={step.days}
                onChange={(event) => onChange({ days: event.target.value })}
              />
            </div>
            <label className='flex items-center gap-2 pt-5 text-sm'>
              <Switch
                checked={step.requireAll}
                onCheckedChange={(checked) => onChange({ requireAll: checked })}
              />
              Everyone must agree
            </label>
            <div className='space-y-1 sm:col-span-3'>
              <Label className='text-xs'>Escalate to when overdue</Label>
              <RoleChecklist
                idPrefix={`${step.key}-esc`}
                value={step.escalateRoles}
                onChange={(escalateRoles) => onChange({ escalateRoles })}
              />
            </div>
          </div>
          <div className='space-y-2'>
            <Label className='text-xs'>Responses</Label>
            {step.responses.map((response, responseIndex) => (
              <div
                key={response.key}
                className='grid items-center gap-2 rounded border p-2 sm:grid-cols-[1fr_1fr_130px_auto_auto]'
              >
                <Input
                  aria-label='Response label'
                  placeholder='Label'
                  value={response.label}
                  onChange={(event) =>
                    setResponse(responseIndex, { label: event.target.value })
                  }
                />
                <TargetSelect
                  label='After this response'
                  value={response.next}
                  steps={steps}
                  excludeKey={step.key}
                  onChange={(next) => setResponse(responseIndex, { next })}
                />
                <Select
                  value={response.tone}
                  onValueChange={(tone) =>
                    setResponse(responseIndex, {
                      tone: tone as DraftResponse['tone'],
                    })
                  }
                >
                  <SelectTrigger aria-label='Tone'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='positive'>Positive</SelectItem>
                    <SelectItem value='negative'>Negative</SelectItem>
                    <SelectItem value='neutral'>Neutral</SelectItem>
                  </SelectContent>
                </Select>
                <label className='flex items-center gap-1 text-xs whitespace-nowrap'>
                  <Checkbox
                    checked={response.requireComment}
                    onCheckedChange={(state) =>
                      setResponse(responseIndex, {
                        requireComment: state === true,
                      })
                    }
                  />
                  Comment
                </label>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  aria-label='Remove response'
                  disabled={step.responses.length === 1}
                  onClick={() =>
                    onChange({
                      responses: step.responses.filter(
                        (_, i) => i !== responseIndex
                      ),
                    })
                  }
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </div>
            ))}
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() =>
                onChange({
                  responses: [
                    ...step.responses,
                    {
                      key: newKey('response'),
                      label: '',
                      next: END_SUCCESS,
                      tone: 'neutral',
                      requireComment: false,
                    },
                  ],
                })
              }
            >
              <Plus className='mr-1 h-3 w-3' />
              Response
            </Button>
          </div>
        </>
      )}

      {step.type === 'condition' && (
        <div className='space-y-2'>
          <Label className='text-xs'>If the record…</Label>
          <ConditionFields
            condition={step.condition}
            fields={fields}
            onChange={(condition) => onChange({ condition })}
          />
          <div className='grid gap-2 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label className='text-xs'>When true</Label>
              <TargetSelect
                label='When true'
                value={step.whenTrue}
                steps={steps}
                excludeKey={step.key}
                onChange={(whenTrue) => onChange({ whenTrue })}
              />
            </div>
            <div className='space-y-1'>
              <Label className='text-xs'>When false</Label>
              <TargetSelect
                label='When false'
                value={step.whenFalse}
                steps={steps}
                excludeKey={step.key}
                onChange={(whenFalse) => onChange({ whenFalse })}
              />
            </div>
          </div>
        </div>
      )}

      {step.type === 'action' && (
        <div className='space-y-2'>
          <Label className='text-xs'>Notify</Label>
          <RoleChecklist
            idPrefix={`${step.key}-notify`}
            value={step.notifyRoles}
            onChange={(notifyRoles) => onChange({ notifyRoles })}
          />
          <Textarea
            rows={2}
            placeholder='Message (optional)'
            value={step.message}
            onChange={(event) => onChange({ message: event.target.value })}
          />
          <div className='space-y-1'>
            <Label className='text-xs'>Then</Label>
            <TargetSelect
              label='After notifying'
              value={step.next}
              steps={steps}
              excludeKey={step.key}
              onChange={(next) => onChange({ next })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── editor dialog ─────────────────────────────────────────────────────────

export function WorkflowTemplateDialog({
  projectId,
  template,
  tools,
  initialTool,
  open,
  onOpenChange,
}: {
  projectId: string | null
  template: WorkflowTemplate | null
  tools: WorkflowTool[]
  initialTool?: WorkflowToolKey | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: team } = useProjectTeam(projectId ?? '', {
    enabled: Boolean(projectId),
  })
  const { data: permissionTemplates } = usePermissionTemplates({})
  const nameOf = (userId: string) =>
    team?.items.find((member) => member.userId === userId)?.name ?? 'Person'
  const templateNameOf = (templateId: string) =>
    permissionTemplates?.items.find((item) => item.id === templateId)?.name ??
    'Permission template'
  const create = useCreateWorkflowTemplate(projectId)
  const update = useUpdateWorkflowTemplate(projectId)
  const [draft, setDraft] = useState<Draft>(() =>
    draftFrom(template, initialTool ?? tools[0]?.key ?? '')
  )
  const busy = create.isPending || update.isPending
  const tool = tools.find((item) => item.key === draft.tool) ?? null
  const fields = tool?.contextFields ?? []

  const setStep = (index: number, patch: Partial<DraftStep>) =>
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.map((step, i) =>
        i === index ? { ...step, ...patch } : step
      ),
    }))

  const moveStep = (index: number, direction: -1 | 1) =>
    setDraft((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.steps.length) return prev
      const steps = [...prev.steps]
      const [moved] = steps.splice(index, 1)
      steps.splice(target, 0, moved)
      return { ...prev, steps }
    })

  const validate = () => {
    if (!draft.tool) return 'Pick the tool this workflow runs on'
    if (!draft.name.trim()) return 'Give the workflow a name'
    for (const [index, step] of draft.steps.entries()) {
      const label = step.name.trim() || `Step ${index + 1}`
      if (!step.name.trim()) return `Name step ${index + 1}`
      if (step.type === 'response') {
        if (step.assignees.length === 0)
          return `"${label}" needs at least one assignee`
        if (step.responses.some((response) => !response.label.trim()))
          return `"${label}" has a response without a label`
      }
      if (step.type === 'condition' && !step.condition.field)
        return `"${label}" needs a field to test`
      if (step.type === 'action' && step.notifyRoles.length === 0)
        return `"${label}" needs at least one role to notify`
    }
    for (const rule of draft.rules) {
      if (!rule.field) return 'Every rule needs a field'
    }
    return null
  }

  const submit = async () => {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    const payload = {
      tool: draft.tool as WorkflowToolKey,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      isDefault: draft.isDefault,
      priority: Number(draft.priority) || 0,
      rules: draft.rules.map((rule) => toCondition(rule, fields)),
      steps: draft.steps.map((step) => toPayloadStep(step, fields)),
      startStep: draft.steps[0]?.key ?? null,
    }
    try {
      if (template) {
        await update.mutateAsync({ templateId: template.id, payload })
        toast.success('Workflow updated')
      } else {
        await create.mutateAsync(payload)
        toast.success('Workflow created')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>
            {template ? 'Edit workflow' : 'New workflow'}
          </DialogTitle>
          <DialogDescription>
            Decisions route to people, roles or parties; branches test the
            record; the ends approve or return the record through its own
            module.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='wf-tool'>Runs on</Label>
              <Select
                value={draft.tool}
                disabled={Boolean(template)}
                onValueChange={(value) =>
                  setDraft((prev) => ({
                    ...prev,
                    tool: value as WorkflowToolKey,
                    rules: [],
                  }))
                }
              >
                <SelectTrigger id='wf-tool' data-testid='uat-workflow-tool'>
                  <SelectValue placeholder='Pick a tool' />
                </SelectTrigger>
                <SelectContent>
                  {tools.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tool?.triggerStatus && (
                <p className='text-xs text-muted-foreground'>
                  Starts by itself when a record reaches “
                  {tool.triggerStatus.replace(/_/g, ' ')}”.
                </p>
              )}
            </div>
            <div className='space-y-1'>
              <Label htmlFor='wf-name'>Name</Label>
              <Input
                id='wf-name'
                data-testid='uat-workflow-name'
                value={draft.name}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder='e.g. Change orders above 50,000'
              />
            </div>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='wf-description'>Description</Label>
            <Textarea
              id='wf-description'
              rows={2}
              value={draft.description}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
            />
          </div>
          <div className='grid gap-3 sm:grid-cols-[auto_140px]'>
            <label className='flex items-center gap-2 text-sm'>
              <Switch
                checked={draft.isDefault}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, isDefault: checked }))
                }
              />
              Default for this tool when no rule matches
            </label>
            <div className='space-y-1'>
              <Label htmlFor='wf-priority' className='text-xs'>
                Priority (higher wins)
              </Label>
              <Input
                id='wf-priority'
                type='number'
                value={draft.priority}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    priority: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <div>
                <Label>Use this workflow when</Label>
                <p className='text-xs text-muted-foreground'>
                  All rules must hold. Leave empty for a default route.
                </p>
              </div>
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={fields.length === 0}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    rules: [
                      ...prev.rules,
                      { field: fields[0]?.key ?? '', op: 'gte', value: '' },
                    ],
                  }))
                }
              >
                <Plus className='mr-1 h-3 w-3' />
                Rule
              </Button>
            </div>
            {draft.rules.map((rule, ruleIndex) => (
              <div
                key={ruleIndex}
                className='flex items-start gap-2'
                data-testid='uat-workflow-rule'
              >
                <div className='flex-1'>
                  <ConditionFields
                    condition={rule}
                    fields={fields}
                    onChange={(next) =>
                      setDraft((prev) => ({
                        ...prev,
                        rules: prev.rules.map((item, i) =>
                          i === ruleIndex ? next : item
                        ),
                      }))
                    }
                  />
                </div>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  aria-label='Remove rule'
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      rules: prev.rules.filter((_, i) => i !== ruleIndex),
                    }))
                  }
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </div>
            ))}
          </div>

          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label>Steps (the first one starts the run)</Label>
              <div className='flex gap-1'>
                {(Object.keys(STEP_TYPE_LABEL) as WorkflowStepType[]).map(
                  (type) => (
                    <Button
                      key={type}
                      type='button'
                      size='sm'
                      variant='outline'
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          steps: [...prev.steps, emptyStep(type)],
                        }))
                      }
                    >
                      <Plus className='mr-1 h-3 w-3' />
                      {STEP_TYPE_LABEL[type]}
                    </Button>
                  )
                )}
              </div>
            </div>
            {draft.steps.map((step, index) => (
              <StepCard
                key={step.key}
                step={step}
                index={index}
                total={draft.steps.length}
                steps={draft.steps}
                fields={fields}
                projectId={projectId}
                nameOf={nameOf}
                templateNameOf={templateNameOf}
                onChange={(patch) => setStep(index, patch)}
                onMove={(direction) => moveStep(index, direction)}
                onRemove={() =>
                  setDraft((prev) => ({
                    ...prev,
                    steps: prev.steps.filter((_, i) => i !== index),
                  }))
                }
              />
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type='button'
            disabled={busy}
            data-testid='uat-workflow-save'
            onClick={submit}
          >
            {busy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {template ? 'Save changes' : 'Create workflow'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── list ──────────────────────────────────────────────────────────────────

const stepSummary = (steps: WorkflowStep[]) => {
  const decisions = steps.filter((step) => step.type === 'response').length
  const branches = steps.filter((step) => step.type === 'condition').length
  const parts = [`${decisions} decision${decisions === 1 ? '' : 's'}`]
  if (branches) parts.push(`${branches} branch${branches === 1 ? '' : 'es'}`)
  return parts.join(' · ')
}

const ruleSummary = (
  rules: WorkflowCondition[],
  fields: WorkflowContextField[]
) =>
  rules
    .map((rule) => {
      const field = fields.find((item) => item.key === rule.field)
      const op = CONDITION_OPS.find((item) => item.id === rule.op)
      const value = op?.needsValue
        ? ` ${Array.isArray(rule.value) ? rule.value.join(', ') : typeof rule.value === 'number' ? rule.value.toLocaleString() : String(rule.value ?? '')}`
        : ''
      return `${field?.label ?? rule.field} ${op?.label ?? rule.op}${value}`
    })
    .join(' and ')

/**
 * Workflow library. With `projectId` it manages that project's routes and
 * shows the company ones read-only; with `null` it manages the company
 * library.
 */
export function WorkflowTemplateList({
  projectId,
  canEdit,
}: {
  projectId: string | null
  canEdit: boolean
}) {
  const { data: tools = [] } = useWorkflowTools(projectId)
  const [toolFilter, setToolFilter] = useState<WorkflowToolKey | 'all'>('all')
  const { data, isLoading } = useWorkflowTemplates(projectId, {
    tool: toolFilter === 'all' ? null : toolFilter,
  })
  const archive = useArchiveWorkflowTemplate(projectId)
  const seed = useSeedWorkflowDefaults()
  const [editor, setEditor] = useState<{
    open: boolean
    template: WorkflowTemplate | null
    nonce: number
  }>({ open: false, template: null, nonce: 0 })
  const items = data ?? []

  return (
    <div className='space-y-3' data-testid='uat-workflow-templates'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <Select
            value={toolFilter}
            onValueChange={(value) =>
              setToolFilter(value as WorkflowToolKey | 'all')
            }
          >
            <SelectTrigger className='w-52' aria-label='Filter by tool'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All tools</SelectItem>
              {tools.map((tool) => (
                <SelectItem key={tool.key} value={tool.key}>
                  {tool.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className='text-sm text-muted-foreground'>
            {projectId
              ? 'Project routes win over company ones; the first whose rules match a record runs, else the default.'
              : 'Company routes apply on every project. Projects can add their own on top.'}
          </p>
        </div>
        {canEdit && (
          <div className='flex gap-2'>
            {!projectId && (
              <Button
                variant='outline'
                size='sm'
                disabled={seed.isPending}
                data-testid='uat-workflow-seed'
                onClick={async () => {
                  try {
                    const result = await seed.mutateAsync()
                    toast.success(
                      result.created
                        ? `${result.created} starter workflow${result.created === 1 ? '' : 's'} added`
                        : 'Starter workflows are already in the library'
                    )
                  } catch (error) {
                    toast.error(getServerErrorMessage(error))
                  }
                }}
              >
                <Sparkles className='mr-1 h-4 w-4' />
                Add starters
              </Button>
            )}
            <Button
              size='sm'
              data-testid='uat-workflow-new'
              disabled={tools.length === 0}
              onClick={() =>
                setEditor((prev) => ({
                  open: true,
                  template: null,
                  nonce: prev.nonce + 1,
                }))
              }
            >
              <Plus className='mr-1 h-4 w-4' />
              New workflow
            </Button>
          </div>
        )}
      </div>
      {isLoading ? (
        <p className='text-sm text-muted-foreground'>Loading…</p>
      ) : items.length === 0 ? (
        <p className='rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
          No workflows yet. Records keep using their built-in approval until one
          exists for their tool.
        </p>
      ) : (
        <div className='space-y-2'>
          {items.map((template) => {
            const tool = tools.find((item) => item.key === template.tool)
            const editable =
              canEdit &&
              (projectId ? template.scope === 'project' : true) &&
              !template.isSystem
            return (
              <div
                key={template.id}
                className='rounded-md border p-3'
                data-testid='uat-workflow-template-row'
              >
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium'>{template.name}</span>
                  <Badge variant='outline'>{template.toolLabel}</Badge>
                  <Badge variant='outline'>
                    {template.scope === 'company' ? 'Company' : 'Project'}
                  </Badge>
                  {template.isDefault && <Badge>Default</Badge>}
                  {template.status === 'archived' && (
                    <Badge variant='secondary'>Archived</Badge>
                  )}
                  <span className='text-xs text-muted-foreground'>
                    {stepSummary(template.steps)}
                  </span>
                  {editable && (
                    <div className='ml-auto flex gap-1'>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() =>
                          setEditor((prev) => ({
                            open: true,
                            template,
                            nonce: prev.nonce + 1,
                          }))
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={archive.isPending}
                        onClick={async () => {
                          if (!window.confirm(`Archive "${template.name}"?`))
                            return
                          try {
                            await archive.mutateAsync(template.id)
                            toast.success('Workflow archived')
                          } catch (error) {
                            toast.error(getServerErrorMessage(error))
                          }
                        }}
                      >
                        Archive
                      </Button>
                    </div>
                  )}
                </div>
                {template.rules.length > 0 && (
                  <p className='mt-1 text-xs'>
                    <span className='text-muted-foreground'>When </span>
                    {ruleSummary(template.rules, tool?.contextFields ?? [])}
                  </p>
                )}
                {template.description && (
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {template.description}
                  </p>
                )}
                <ol className='mt-2 flex flex-wrap gap-1 text-xs'>
                  {template.steps.map((step) => (
                    <li
                      key={step.key}
                      className='rounded bg-muted px-2 py-0.5'
                      title={
                        step.type === 'condition'
                          ? `Branch → ${targetLabel(step.whenTrue, template.steps)} / ${targetLabel(step.whenFalse, template.steps)}`
                          : step.type === 'action'
                            ? `Notify → ${targetLabel(step.next, template.steps)}`
                            : (step.responses ?? [])
                                .map(
                                  (response) =>
                                    `${response.label} → ${targetLabel(response.next, template.steps)}`
                                )
                                .join(' · ')
                      }
                    >
                      {STEP_TYPE_LABEL[step.type]}: {step.name}
                      {step.type === 'response' && step.days
                        ? ` (${step.days}d)`
                        : ''}
                    </li>
                  ))}
                </ol>
              </div>
            )
          })}
        </div>
      )}
      {editor.open && (
        <WorkflowTemplateDialog
          key={`${editor.template?.id ?? 'new'}-${editor.nonce}`}
          projectId={projectId}
          template={editor.template}
          tools={tools}
          initialTool={toolFilter === 'all' ? null : toolFilter}
          open={editor.open}
          onOpenChange={(open) => setEditor((prev) => ({ ...prev, open }))}
        />
      )}
    </div>
  )
}
