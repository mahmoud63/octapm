import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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

export function ProjectCreateDialog({
  open,
  onOpenChange,
}: ProjectCreateDialogProps) {
  const createProject = useCreateProject()

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: projectFormDefaultValues,
  })

  const onSubmit = async (values: ProjectFormValues) => {
    const payload = buildProjectPayload(values)

    try {
      await createProject.mutateAsync(payload)
      toast.success('Project created successfully.')
      form.reset()
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
        }
        onOpenChange(state)
      }}
    >
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

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
            disabled={createProject.isPending}
          >
            {createProject.isPending ? 'Creating...' : 'Create Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
