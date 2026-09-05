import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { LayoutTemplate } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useCreateProjectFromTemplate,
  useProjectTemplates,
  type ProjectTemplate,
} from '@/features/company/hooks/use-company'
import { createProjectSchema } from '../data/schema'
import { useCreateProject } from '../hooks/use-projects'
import {
  buildProjectPayload,
  ProjectFormFields,
  projectFormDefaultValues,
  type ProjectFormValues,
} from './project-form-fields'

type ProjectCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const BLANK = '__blank__'

/** Maps template settings onto the form; missing keys keep the blank defaults. */
const formValuesFromTemplate = (
  template: ProjectTemplate
): ProjectFormValues => {
  const s = template.settings as Record<string, unknown>
  const str = (value: unknown) =>
    typeof value === 'string' ? value : undefined
  const num = (value: unknown) =>
    typeof value === 'number' ? value : undefined
  return {
    ...projectFormDefaultValues,
    type: str(s.type) ?? '',
    location: str(s.location) ?? '',
    contractType: str(s.contractType) as ProjectFormValues['contractType'],
    currency: str(s.currency) ?? projectFormDefaultValues.currency,
    durationUnit:
      (str(s.durationUnit) as ProjectFormValues['durationUnit']) ??
      projectFormDefaultValues.durationUnit,
    projectCalendar:
      (str(s.projectCalendar) as ProjectFormValues['projectCalendar']) ??
      projectFormDefaultValues.projectCalendar,
    reportingCutoffDay:
      num(s.reportingCutoffDay) ?? projectFormDefaultValues.reportingCutoffDay,
    defaultRetentionRate:
      num(s.defaultRetentionRate) ??
      projectFormDefaultValues.defaultRetentionRate,
    ldRatePerDay: num(s.ldRatePerDay) ?? projectFormDefaultValues.ldRatePerDay,
    weatherAllowanceDays:
      num(s.weatherAllowanceDays) ??
      projectFormDefaultValues.weatherAllowanceDays,
  }
}

export function ProjectCreateDialog({
  open,
  onOpenChange,
}: ProjectCreateDialogProps) {
  const createProject = useCreateProject()
  const createFromTemplate = useCreateProjectFromTemplate()
  const { data: templates } = useProjectTemplates({}, { enabled: open })
  const [templateId, setTemplateId] = useState<string>(BLANK)
  const isPending = createProject.isPending || createFromTemplate.isPending

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: projectFormDefaultValues,
  })

  const applyTemplate = (value: string) => {
    setTemplateId(value)
    const template = templates?.items.find((item) => item.id === value)
    form.reset(
      template ? formValuesFromTemplate(template) : projectFormDefaultValues
    )
  }

  const onSubmit = async (values: ProjectFormValues) => {
    const payload = buildProjectPayload(values)

    try {
      if (templateId !== BLANK) {
        const result = await createFromTemplate.mutateAsync({
          templateId,
          payload,
        })
        toast.success(
          `Project created from ${result.template.name}: ${result.applied.parties} parties, ${result.applied.folders} folders, ${result.applied.locations} locations.`
        )
      } else {
        await createProject.mutateAsync(payload)
        toast.success('Project created successfully.')
      }
      form.reset()
      setTemplateId(BLANK)
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Failed to create project'))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(state) => {
        if (!state) {
          form.reset()
          setTemplateId(BLANK)
        }
        onOpenChange(state)
      }}
    >
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

        {templates?.items.length ? (
          <div className='space-y-1 rounded-md border bg-muted/30 p-3'>
            <Label
              htmlFor='project-template'
              className='flex items-center gap-2'
            >
              <LayoutTemplate className='size-4' /> Start from a template
            </Label>
            <Select value={templateId} onValueChange={applyTemplate}>
              <SelectTrigger
                id='project-template'
                data-testid='uat-project-template-picker'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BLANK}>Blank project</SelectItem>
                {templates.items.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                    {template.isDefault ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>
              Templates pre-fill the fields below and add parties, folders,
              locations and team permissions on creation.
            </p>
          </div>
        ) : null}

        <Form {...form}>
          <form
            id='project-create-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-5'
          >
            <ProjectFormFields form={form} />
          </form>
        </Form>

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type='submit'
            form='project-create-form'
            disabled={isPending}
            data-testid='uat-project-create-submit'
          >
            {isPending ? 'Creating...' : 'Create Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
