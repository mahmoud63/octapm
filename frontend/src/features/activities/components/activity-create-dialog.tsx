import { z } from 'zod'
import { AxiosError } from 'axios'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { createActivitySchema, type CreateActivityInput } from '../data/schema'
import { useCreateActivity } from '../hooks/use-activities'

const CATEGORIES = [
  'civil',
  'structural',
  'mechanical',
  'electrical',
  'plumbing',
  'finishing',
  'landscaping',
  'demolition',
  'inspection',
  'other',
] as const

const ENGINEER_ROLES = new Set(['site_engineer', 'planning_eng'])

type ActivityCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectStartDate?: string | null
  projectEndDate?: string | null
}

type EngineerUser = {
  id: string
  name: string
  email: string
  role: string
  status: 'active' | 'inactive'
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof AxiosError) {
    const errorData = error.response?.data as
      | { error?: { message?: string } }
      | undefined

    return errorData?.error?.message ?? 'Failed to create activity'
  }

  return 'Failed to create activity'
}

type ActivityFormValues = z.input<typeof createActivitySchema>

export function ActivityCreateDialog({
  open,
  onOpenChange,
  projectId,
  projectStartDate,
  projectEndDate,
}: ActivityCreateDialogProps) {
  const createActivity = useCreateActivity(projectId)

  const { data: usersData } = useQuery<{ items: EngineerUser[] }>({
    queryKey: ['users', 'activity-create-engineers'],
    queryFn: () =>
      apiClient
        .get('/users', {
          params: {
            status: 'active',
            limit: 200,
          },
        })
        .then((response) => response.data.data),
    enabled: open,
  })

  const engineers = (usersData?.items ?? []).filter((user) =>
    ENGINEER_ROLES.has(user.role)
  )

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(createActivitySchema),
    defaultValues: {
      name: '',
      category: '',
      wbsCode: '',
      startDate: '',
      endDate: '',
      engineerIds: [],
      budget: undefined,
      isMilestone: false,
    },
  })

  const onSubmit = async (values: ActivityFormValues) => {
    const parsed = createActivitySchema.parse(values)

    const payload: CreateActivityInput = {
      ...parsed,
      category: parsed.category?.trim() || undefined,
      wbsCode: parsed.wbsCode?.trim() || undefined,
    }

    try {
      await createActivity.mutateAsync(payload)
      toast.success('Activity created successfully.')
      form.reset()
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const watchedStartDate = form.watch('startDate')
  const watchedEndDate = form.watch('endDate')

  const outsideDates = Boolean(
    (projectStartDate &&
      watchedStartDate &&
      new Date(watchedStartDate) < new Date(projectStartDate)) ||
    (projectEndDate &&
      watchedEndDate &&
      new Date(watchedEndDate) > new Date(projectEndDate))
  )

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
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Add Activity</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            id='activity-create-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-4'
          >
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Activity Name *</FormLabel>
                  <FormControl>
                    <Input placeholder='e.g. Foundation Works' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='category'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <select
                        className='h-9 w-full rounded-md border bg-background px-3 text-sm'
                        {...field}
                      >
                        <option value=''>Select category...</option>
                        {CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category.charAt(0).toUpperCase() +
                              category.slice(1)}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='wbsCode'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>WBS Code</FormLabel>
                    <FormControl>
                      <Input placeholder='e.g. A-01-02' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='startDate'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date *</FormLabel>
                    <FormControl>
                      <Input type='date' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='endDate'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date *</FormLabel>
                    <FormControl>
                      <Input type='date' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {outsideDates && (
              <p className='rounded-md bg-yellow-50 p-2 text-sm text-yellow-700'>
                Activity dates are outside the project date range.
              </p>
            )}

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='budget'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Budget</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step='0.01'
                        placeholder='e.g. 250000'
                        value={field.value ?? ''}
                        onChange={(event) => {
                          const nextValue = event.target.value
                          field.onChange(
                            nextValue === '' ? undefined : Number(nextValue)
                          )
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='isMilestone'
                render={({ field }) => (
                  <FormItem className='rounded-md border px-3 py-2'>
                    <FormLabel>Milestone</FormLabel>
                    <div className='flex items-center gap-2'>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked === true)
                        }}
                      />
                      <span className='text-sm text-muted-foreground'>
                        Mark this as milestone activity
                      </span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormItem>
              <FormLabel>Assigned Engineers *</FormLabel>
              <Controller
                control={form.control}
                name='engineerIds'
                render={({ field }) => (
                  <div className='max-h-44 space-y-2 overflow-y-auto rounded-md border p-3'>
                    {engineers.length === 0 && (
                      <p className='text-sm text-muted-foreground'>
                        No active engineers available
                      </p>
                    )}

                    {engineers.map((engineer) => (
                      <label
                        key={engineer.id}
                        className='flex cursor-pointer items-center gap-2'
                      >
                        <Checkbox
                          checked={field.value.includes(engineer.id)}
                          onCheckedChange={(checked) => {
                            if (checked === true) {
                              field.onChange([...field.value, engineer.id])
                              return
                            }

                            field.onChange(
                              field.value.filter((id) => id !== engineer.id)
                            )
                          }}
                        />
                        <span className='text-sm'>
                          {engineer.name}{' '}
                          <span className='text-muted-foreground'>
                            ({engineer.email})
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              />
              {form.formState.errors.engineerIds && (
                <p className='text-sm text-destructive'>
                  {form.formState.errors.engineerIds.message}
                </p>
              )}
            </FormItem>
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
            form='activity-create-form'
            disabled={createActivity.isPending}
          >
            {createActivity.isPending ? 'Creating...' : 'Create Activity'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
