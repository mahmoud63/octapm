import type { z } from 'zod'
import { AxiosError } from 'axios'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createProjectSchema, type CreateProjectInput } from '../data/schema'
import { useCreateProject } from '../hooks/use-projects'

type ProjectCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof AxiosError) {
    const errorData = error.response?.data as
      | { error?: { message?: string } }
      | undefined

    return errorData?.error?.message ?? 'Failed to create project'
  }

  return 'Failed to create project'
}

type ProjectFormValues = z.input<typeof createProjectSchema>

export function ProjectCreateDialog({
  open,
  onOpenChange,
}: ProjectCreateDialogProps) {
  const createProject = useCreateProject()

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: '',
      startDate: '',
      endDate: '',
      type: '',
      location: '',
      contractValue: undefined,
      duration: undefined,
      durationUnit: 'months',
      currency: 'USD',
    },
  })

  const onSubmit = async (values: ProjectFormValues) => {
    const parsed = createProjectSchema.parse(values)

    const payload: CreateProjectInput = {
      ...parsed,
      type: parsed.type?.trim() || undefined,
      location: parsed.location?.trim() || undefined,
      currency: parsed.currency.toUpperCase(),
    }

    try {
      await createProject.mutateAsync(payload)
      toast.success('Project created successfully.')
      form.reset()
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
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
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            id='project-create-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-4'
          >
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Name *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='e.g. Tower A Construction'
                      autoComplete='off'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='type'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='e.g. Residential'
                        autoComplete='off'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='location'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='e.g. Dubai, UAE'
                        autoComplete='off'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='contractValue'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contract Value</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step='0.01'
                        placeholder='e.g. 5000000'
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
                name='duration'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={1}
                        step='1'
                        placeholder='e.g. 18'
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
            </div>

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='durationUnit'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration Unit</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value ?? 'months'}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder='Select duration unit' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value='days'>Days</SelectItem>
                        <SelectItem value='weeks'>Weeks</SelectItem>
                        <SelectItem value='months'>Months</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='currency'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='USD'
                        maxLength={3}
                        value={field.value ?? 'USD'}
                        onChange={(event) =>
                          field.onChange(event.target.value.toUpperCase())
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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
