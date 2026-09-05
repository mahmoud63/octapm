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
import { useProjectTeam } from '@/features/permissions/hooks/use-permissions'
import {
  useArchiveSubmittalWorkflowTemplate,
  useCreateSubmittalWorkflowTemplate,
  useSeedSubmittalWorkflowTemplates,
  useSubmittalWorkflowTemplates,
  useUpdateSubmittalWorkflowTemplate,
  type SubmittalStepAssignee,
  type SubmittalWorkflowStep,
  type SubmittalWorkflowTemplate,
} from '../hooks/use-doc-control'
import {
  PARTY_ROLE_OPTIONS,
  PROJECT_ROLE_OPTIONS,
  assigneeLabel,
  stepSummary,
} from '../lib/submittal-workflow'

const emptyStep = (): SubmittalWorkflowStep => ({
  name: '',
  mode: 'sequential',
  days: 7,
  assignees: [],
})

type Draft = {
  name: string
  description: string
  isDefault: boolean
  steps: SubmittalWorkflowStep[]
}

const draftFrom = (template?: SubmittalWorkflowTemplate | null): Draft => ({
  name: template?.name ?? '',
  description: template?.description ?? '',
  isDefault: template?.isDefault ?? false,
  steps: template?.steps?.length
    ? template.steps.map((step) => ({
        ...step,
        assignees: [...step.assignees],
      }))
    : [emptyStep()],
})

function AssigneeAdder({
  projectId,
  onAdd,
}: {
  projectId: string | null
  onAdd: (assignee: SubmittalStepAssignee) => void
}) {
  const [type, setType] = useState<SubmittalStepAssignee['type']>(
    projectId ? 'user' : 'party_role'
  )
  const [role, setRole] = useState('')
  const roleOptions =
    type === 'party_role' ? PARTY_ROLE_OPTIONS : PROJECT_ROLE_OPTIONS
  return (
    <div className='flex flex-wrap items-end gap-2'>
      <Select
        value={type}
        onValueChange={(value) => {
          setType(value as SubmittalStepAssignee['type'])
          setRole('')
        }}
      >
        <SelectTrigger className='w-40' aria-label='Reviewer type'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {projectId && <SelectItem value='user'>A person</SelectItem>}
          <SelectItem value='party_role'>Everyone in a party</SelectItem>
          <SelectItem value='role'>Everyone with a role</SelectItem>
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
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className='w-48' aria-label='Role'>
              <SelectValue placeholder='Choose a role' />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((option) => (
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
            disabled={!role}
            onClick={() => {
              onAdd({ type, role })
              setRole('')
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

function WorkflowEditorDialog({
  projectId,
  template,
  open,
  onOpenChange,
}: {
  projectId: string | null
  template?: SubmittalWorkflowTemplate | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: team } = useProjectTeam(projectId ?? '')
  const nameOf = (userId: string) =>
    team?.items.find((member) => member.userId === userId)?.name ?? 'Person'
  const create = useCreateSubmittalWorkflowTemplate(projectId)
  const update = useUpdateSubmittalWorkflowTemplate(projectId)
  const [draft, setDraft] = useState<Draft>(() => draftFrom(template))
  const busy = create.isPending || update.isPending

  const setStep = (index: number, patch: Partial<SubmittalWorkflowStep>) =>
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.map((step, i) =>
        i === index ? { ...step, ...patch } : step
      ),
    }))
  const moveStep = (index: number, direction: -1 | 1) =>
    setDraft((prev) => {
      const steps = [...prev.steps]
      const target = index + direction
      if (target < 0 || target >= steps.length) return prev
      ;[steps[index], steps[target]] = [steps[target], steps[index]]
      return { ...prev, steps }
    })

  const problems: string[] = []
  if (!draft.name.trim()) problems.push('Give the workflow a name')
  draft.steps.forEach((step, index) => {
    if (!step.name.trim()) problems.push(`Step ${index + 1} needs a name`)
    if (!step.assignees.length)
      problems.push(`Step ${index + 1} needs at least one reviewer`)
  })

  const save = async () => {
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      isDefault: draft.isDefault,
      steps: draft.steps.map((step) => ({
        name: step.name.trim(),
        mode: step.mode,
        days: Number(step.days) || 0,
        assignees: step.assignees,
      })),
    }
    try {
      if (template) {
        await update.mutateAsync({ templateId: template.id, payload })
        toast.success('Workflow saved')
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
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-3xl'
        data-testid='uat-sub-workflow-editor'
      >
        <DialogHeader>
          <DialogTitle>
            {template ? `Edit ${template.name}` : 'New review workflow'}
          </DialogTitle>
          <DialogDescription>
            Steps run in order. A sequential step closes on the first approval;
            a parallel step waits for everyone on it. Days per step set the due
            date and the total review time used for submit-by dates.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]'>
          <div className='space-y-1'>
            <Label htmlFor='sub-workflow-name'>Name</Label>
            <Input
              id='sub-workflow-name'
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder='e.g. Consultant review'
            />
          </div>
          <div className='flex items-end gap-2 pb-1'>
            <Switch
              id='sub-workflow-default'
              checked={draft.isDefault}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, isDefault: checked })
              }
            />
            <Label htmlFor='sub-workflow-default'>
              Default for new submittals
            </Label>
          </div>
        </div>
        <div className='space-y-1'>
          <Label htmlFor='sub-workflow-description'>Description</Label>
          <Textarea
            id='sub-workflow-description'
            rows={2}
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </div>
        <div className='space-y-3'>
          {draft.steps.map((step, index) => (
            <div
              key={index}
              className='space-y-2 rounded-md border p-3'
              data-testid='uat-sub-workflow-step'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant='outline'>Step {index + 1}</Badge>
                <Input
                  className='min-w-40 flex-1'
                  value={step.name}
                  placeholder='Step name'
                  aria-label={`Step ${index + 1} name`}
                  onChange={(e) => setStep(index, { name: e.target.value })}
                />
                <Select
                  value={step.mode}
                  onValueChange={(value) =>
                    setStep(index, {
                      mode: value as SubmittalWorkflowStep['mode'],
                    })
                  }
                >
                  <SelectTrigger className='w-36' aria-label='Step mode'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='sequential'>Any one approves</SelectItem>
                    <SelectItem value='parallel'>All must approve</SelectItem>
                  </SelectContent>
                </Select>
                <div className='flex items-center gap-1'>
                  <Input
                    type='number'
                    min={0}
                    max={365}
                    className='w-20'
                    value={step.days}
                    aria-label='Days'
                    onChange={(e) =>
                      setStep(index, { days: Number(e.target.value) || 0 })
                    }
                  />
                  <span className='text-xs text-muted-foreground'>days</span>
                </div>
                <div className='ml-auto flex gap-1'>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    aria-label='Move up'
                    disabled={index === 0}
                    onClick={() => moveStep(index, -1)}
                  >
                    <ArrowUp className='h-4 w-4' />
                  </Button>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    aria-label='Move down'
                    disabled={index === draft.steps.length - 1}
                    onClick={() => moveStep(index, 1)}
                  >
                    <ArrowDown className='h-4 w-4' />
                  </Button>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    aria-label='Remove step'
                    disabled={draft.steps.length === 1}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: draft.steps.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              </div>
              <div className='flex flex-wrap gap-1'>
                {step.assignees.map((assignee, aIndex) => (
                  <Badge key={aIndex} variant='secondary' className='gap-1'>
                    {assigneeLabel(assignee, nameOf)}
                    <button
                      type='button'
                      className='rounded hover:text-destructive'
                      aria-label='Remove reviewer'
                      onClick={() =>
                        setStep(index, {
                          assignees: step.assignees.filter(
                            (_, i) => i !== aIndex
                          ),
                        })
                      }
                    >
                      <X className='h-3 w-3' />
                    </button>
                  </Badge>
                ))}
                {step.assignees.length === 0 && (
                  <span className='text-xs text-muted-foreground'>
                    No reviewers yet
                  </span>
                )}
              </div>
              <AssigneeAdder
                projectId={projectId}
                onAdd={(assignee) => {
                  const exists = step.assignees.some(
                    (row) =>
                      row.type === assignee.type &&
                      row.userId === assignee.userId &&
                      row.role === assignee.role
                  )
                  if (!exists)
                    setStep(index, { assignees: [...step.assignees, assignee] })
                }}
              />
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            size='sm'
            data-testid='uat-sub-step-add'
            disabled={draft.steps.length >= 12}
            onClick={() =>
              setDraft({ ...draft, steps: [...draft.steps, emptyStep()] })
            }
          >
            <Plus className='mr-1 h-4 w-4' />
            Add step
          </Button>
        </div>
        <DialogFooter className='items-center'>
          {problems.length > 0 && (
            <span className='mr-auto text-xs text-muted-foreground'>
              {problems[0]}
            </span>
          )}
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={busy || problems.length > 0}
            data-testid='uat-sub-workflow-save'
          >
            {busy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {template ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Review workflows for submittals. With a projectId it shows the project's
 * own workflows and the company library (read-only); with `null` it manages
 * the company library.
 */
export function SubmittalWorkflowList({
  projectId,
  canEdit,
}: {
  projectId: string | null
  canEdit: boolean
}) {
  const { data, isLoading } = useSubmittalWorkflowTemplates(projectId, {
    scope: projectId ? 'all' : 'company',
  })
  const archive = useArchiveSubmittalWorkflowTemplate(projectId)
  const seed = useSeedSubmittalWorkflowTemplates()
  const [editor, setEditor] = useState<{
    open: boolean
    template: SubmittalWorkflowTemplate | null
    nonce: number
  }>({ open: false, template: null, nonce: 0 })
  const { data: team } = useProjectTeam(projectId ?? '')
  const nameOf = (userId: string) =>
    team?.items.find((member) => member.userId === userId)?.name ?? 'Person'
  const items = data?.items ?? []

  return (
    <div className='space-y-3' data-testid='uat-sub-workflows'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm text-muted-foreground'>
          {projectId
            ? 'Project workflows plus the company library. Pick one on each submittal; the default applies to new ones.'
            : 'Every project can route submittals through these. Projects can add their own on top.'}
        </p>
        {canEdit && (
          <div className='flex gap-2'>
            {!projectId && (
              <Button
                variant='outline'
                size='sm'
                disabled={seed.isPending}
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
              data-testid='uat-sub-workflow-new'
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
          No review workflows yet.
        </p>
      ) : (
        <div className='space-y-2'>
          {items.map((template) => (
            <div
              key={template.id}
              className='rounded-md border p-3'
              data-testid='uat-sub-workflow-row'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-medium'>{template.name}</span>
                <Badge variant='outline'>
                  {template.scope === 'company' ? 'Company' : 'Project'}
                </Badge>
                {template.isDefault && <Badge>Default</Badge>}
                <span className='text-xs text-muted-foreground'>
                  {stepSummary(template.steps)}
                </span>
                {canEdit && template.editable && (
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
              {template.description && (
                <p className='mt-1 text-xs text-muted-foreground'>
                  {template.description}
                </p>
              )}
              <ol className='mt-2 space-y-1 text-xs'>
                {template.steps.map((step, index) => (
                  <li key={index} className='flex flex-wrap items-center gap-1'>
                    <span className='w-5 text-muted-foreground'>
                      {index + 1}.
                    </span>
                    <span className='font-medium'>{step.name}</span>
                    <span className='text-muted-foreground'>
                      · {step.days} d ·{' '}
                      {step.mode === 'parallel'
                        ? 'all must approve'
                        : 'any one approves'}
                    </span>
                    {step.assignees.map((assignee, aIndex) => (
                      <Badge key={aIndex} variant='secondary'>
                        {assigneeLabel(assignee, nameOf)}
                      </Badge>
                    ))}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      {editor.open && (
        <WorkflowEditorDialog
          key={`${editor.template?.id ?? 'new'}-${editor.nonce}`}
          projectId={projectId}
          template={editor.template}
          open={editor.open}
          onOpenChange={(open) => setEditor((prev) => ({ ...prev, open }))}
        />
      )}
    </div>
  )
}
