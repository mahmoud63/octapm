import { useEffect } from 'react'
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
import { createProjectSchema, type Project } from '../data/schema'
import { useUpdateProject } from '../hooks/use-projects'
import {
  buildProjectPayload,
  getProjectFormValues,
  ProjectFormFields,
  projectFormDefaultValues,
  type ProjectFormValues,
} from './project-form-fields'

type ProjectEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
}

export function ProjectEditDialog({
  open,
  onOpenChange,
  project,
}: ProjectEditDialogProps) {
  const updateProject = useUpdateProject()

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: projectFormDefaultValues,
  })

  useEffect(() => {
    if (!open || !project) {
      return
    }

    form.reset(getProjectFormValues(project))
  }, [form, open, project])

  const onSubmit = async (values: ProjectFormValues) => {
    if (!project) {
      return
    }

    const payload = buildProjectPayload(values)

    try {
      await updateProject.mutateAsync({
        projectId: project.id,
        payload,
      })

      toast.success('Project updated successfully.')
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Failed to update project'))
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
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            id='project-edit-form'
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
            form='project-edit-form'
            disabled={updateProject.isPending}
          >
            {updateProject.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
