import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useProjects } from '@/features/projects/hooks/use-projects'
import { useUsersQuery } from '@/features/users/hooks/use-users'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { SelectDropdown } from '@/components/select-dropdown'
import { labels, priorities, statuses } from '../data/data'
import { type Task } from '../data/schema'
import { useCreateTask, useUpdateTask } from '../hooks/use-tasks'

type TaskMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: Task
}

const NONE_VALUE = '__none__'

const formSchema = z.object({
  projectId: z.string().min(1, 'Project is required.'),
  title: z.string().min(1, 'Title is required.'),
  description: z.string().optional(),
  status: z.string().min(1, 'Please select a status.'),
  label: z.string().min(1, 'Please select a label.'),
  priority: z.string().min(1, 'Please choose a priority.'),
  dueDate: z.string().optional(),
  assigneeId: z.string().optional(),
  activityId: z.string().optional(),
  comment: z.string().optional(),
  attachmentDocumentIds: z.string().optional(),
})

type TaskForm = z.infer<typeof formSchema>

const dateValue = (value?: string | null) => (value ? value.slice(0, 10) : '')

const parseAttachmentIds = (value?: string) =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((projectDocumentId) => ({ projectDocumentId }))

export function TasksMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: TaskMutateDrawerProps) {
  const isUpdate = !!currentRow
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const { data: users, isLoading: usersLoading } = useUsersQuery({
    status: 'active',
    sortBy: 'name',
    sortDir: 'asc',
  })

  const form = useForm<TaskForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectId: currentRow?.projectId ?? '',
      title: currentRow?.title ?? '',
      description: currentRow?.description ?? '',
      status: currentRow?.status ?? 'todo',
      label: currentRow?.label ?? 'action',
      priority: currentRow?.priority ?? 'medium',
      dueDate: dateValue(currentRow?.dueDate),
      assigneeId: currentRow?.assigneeId ?? NONE_VALUE,
      activityId: currentRow?.activityId ?? '',
      comment: '',
      attachmentDocumentIds: '',
    },
  })

  const isPending = createTask.isPending || updateTask.isPending
  const projectItems =
    projects?.items.map((project) => ({
      label: project.name,
      value: project.id,
    })) ?? []
  const userItems = [
    { label: 'Unassigned', value: NONE_VALUE },
    ...(users?.items.map((user) => ({
      label: `${user.name} (${user.role.replace(/_/g, ' ')})`,
      value: user.id,
    })) ?? []),
  ]

  const onSubmit = async (data: TaskForm) => {
    const attachments = parseAttachmentIds(data.attachmentDocumentIds)
    const payload = {
      projectId: data.projectId,
      title: data.title,
      description: data.description || null,
      status: data.status,
      label: data.label,
      priority: data.priority,
      dueDate: data.dueDate || null,
      assigneeId:
        data.assigneeId && data.assigneeId !== NONE_VALUE
          ? data.assigneeId
          : null,
      activityId: data.activityId || null,
      comment: data.comment || null,
      ...(attachments.length ? { attachments } : {}),
    }

    try {
      if (isUpdate && currentRow) {
        await updateTask.mutateAsync({ taskId: currentRow.id, payload })
        toast.success(`Updated ${currentRow.taskNumber}`)
      } else {
        const created = await createTask.mutateAsync(payload)
        toast.success(`Created ${created.taskNumber}`)
      }
      onOpenChange(false)
      form.reset()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Task could not be saved.'
      toast.error(message)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value)
        if (!value) form.reset()
      }}
    >
      <SheetContent className='flex flex-col sm:max-w-xl'>
        <SheetHeader className='text-start'>
          <SheetTitle>{isUpdate ? 'Update' : 'Create'} Task</SheetTitle>
          <SheetDescription>
            {isUpdate
              ? 'Change assignment, status, due date, or add a comment.'
              : 'Create a project task with assignment and due-date tracking.'}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='tasks-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex-1 space-y-5 overflow-y-auto px-4'
          >
            <FormField
              control={form.control}
              name='projectId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project</FormLabel>
                  <SelectDropdown
                    isControlled
                    defaultValue={field.value}
                    onValueChange={field.onChange}
                    placeholder='Select project'
                    items={projectItems}
                    isPending={projectsLoading}
                    disabled={isUpdate || isPending}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='title'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='Resolve site access issue' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder='Add enough context for the accountable person.'
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='grid gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='status'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <SelectDropdown
                      isControlled
                      defaultValue={field.value}
                      onValueChange={field.onChange}
                      placeholder='Select status'
                      items={statuses}
                      disabled={isPending}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='priority'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <SelectDropdown
                      isControlled
                      defaultValue={field.value}
                      onValueChange={field.onChange}
                      placeholder='Select priority'
                      items={priorities}
                      disabled={isPending}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='label'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Label</FormLabel>
                    <SelectDropdown
                      isControlled
                      defaultValue={field.value}
                      onValueChange={field.onChange}
                      placeholder='Select label'
                      items={labels}
                      disabled={isPending}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='dueDate'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due date</FormLabel>
                    <FormControl>
                      <Input {...field} type='date' disabled={isPending} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name='assigneeId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assignee</FormLabel>
                  <SelectDropdown
                    isControlled
                    defaultValue={field.value}
                    onValueChange={field.onChange}
                    placeholder='Select assignee'
                    items={userItems}
                    isPending={usersLoading}
                    disabled={isPending}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='activityId'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Activity ID</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder='Optional activity UUID'
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='attachmentDocumentIds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Attachment document IDs</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder='Comma-separated project document UUIDs'
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='comment'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comment</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder='Optional note for history'
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isUpdate && currentRow && (
              <div className='space-y-3 rounded-md border p-3'>
                <div>
                  <p className='text-sm font-medium'>Recent comments</p>
                  <div className='mt-2 space-y-2'>
                    {currentRow.comments?.length ? (
                      currentRow.comments.slice(-3).map((comment) => (
                        <div key={comment.id} className='text-sm'>
                          <p>{comment.body}</p>
                          <p className='text-xs text-muted-foreground'>
                            {comment.author?.name || 'User'} -{' '}
                            {new Date(comment.createdAt).toLocaleString()}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className='text-sm text-muted-foreground'>
                        No comments yet.
                      </p>
                    )}
                  </div>
                </div>
                <p className='text-xs text-muted-foreground'>
                  {currentRow.attachmentCount || 0} attachment references
                </p>
              </div>
            )}
          </form>
        </Form>
        <SheetFooter className='gap-2'>
          <SheetClose asChild>
            <Button variant='outline' disabled={isPending}>
              Close
            </Button>
          </SheetClose>
          <Button form='tasks-form' type='submit' disabled={isPending}>
            {isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
