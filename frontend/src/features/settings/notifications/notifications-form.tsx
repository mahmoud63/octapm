import { useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  type NotificationPreference,
  notificationCategories,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/features/notifications/hooks/use-notifications'

const categorySchema = z.object({
  inAppEnabled: z.boolean(),
  emailEnabled: z.boolean(),
})

const notificationsFormSchema = z.object({
  dueSoonDays: z.number().int().min(1).max(30),
  assignment: categorySchema,
  due: categorySchema,
  overdue: categorySchema,
  approval: categorySchema,
  commercial: categorySchema,
  quality: categorySchema,
  safety: categorySchema,
  task: categorySchema,
  workflow: categorySchema,
})

type NotificationsFormValues = z.infer<typeof notificationsFormSchema>
type PreferenceCategory = Exclude<keyof NotificationsFormValues, 'dueSoonDays'>

const categoryCopy: Array<{
  category: PreferenceCategory
  label: string
  description: string
}> = [
  {
    category: 'assignment',
    label: 'Assignments',
    description: 'Owner, reviewer, approver, and task assignment changes.',
  },
  {
    category: 'due',
    label: 'Due soon',
    description: 'Open items approaching their contractual response date.',
  },
  {
    category: 'overdue',
    label: 'Overdue',
    description: 'Open items past their due or response-required date.',
  },
  {
    category: 'approval',
    label: 'Approvals',
    description: 'Submitted, approved, certified, rejected, and closed items.',
  },
  {
    category: 'commercial',
    label: 'Commercial',
    description: 'Change order, IPC, EOT, and payment workflow events.',
  },
  {
    category: 'quality',
    label: 'Quality',
    description: 'NCR, ITP, defect, and material-test workflow events.',
  },
  {
    category: 'safety',
    label: 'Safety',
    description: 'Safety incident closeout and approval workflow events.',
  },
  {
    category: 'task',
    label: 'Tasks',
    description: 'Task assignment, due, overdue, and completion events.',
  },
  {
    category: 'workflow',
    label: 'Workflow updates',
    description: 'Lower-priority status changes across project records.',
  },
]

const defaultCategory = {
  inAppEnabled: true,
  emailEnabled: true,
}

const buildDefaultValues = (): NotificationsFormValues => ({
  dueSoonDays: 3,
  assignment: { ...defaultCategory },
  due: { ...defaultCategory },
  overdue: { ...defaultCategory },
  approval: { ...defaultCategory },
  commercial: { ...defaultCategory },
  quality: { ...defaultCategory },
  safety: { ...defaultCategory },
  task: { ...defaultCategory },
  workflow: { inAppEnabled: true, emailEnabled: false },
})

const defaultValues = buildDefaultValues()

function toFormValues(
  preferences: NotificationPreference[]
): NotificationsFormValues {
  const values = buildDefaultValues()
  const byCategory = new Map(preferences.map((pref) => [pref.category, pref]))

  notificationCategories.forEach((category) => {
    const pref = byCategory.get(category)
    if (!pref) return
    values[category] = {
      inAppEnabled: pref.inAppEnabled,
      emailEnabled: pref.emailEnabled,
    }
  })

  values.dueSoonDays =
    byCategory.get('due')?.dueSoonDays ??
    byCategory.get('overdue')?.dueSoonDays ??
    3

  return values
}

function toPreferencePayload(
  values: NotificationsFormValues
): NotificationPreference[] {
  return notificationCategories.map((category) => ({
    category,
    inAppEnabled: values[category].inAppEnabled,
    emailEnabled: values[category].emailEnabled,
    digestEnabled: false,
    dueSoonDays: values.dueSoonDays,
    quietHoursStart: null,
    quietHoursEnd: null,
  }))
}

export function NotificationsForm() {
  const preferencesQuery = useNotificationPreferences()
  const updatePreferences = useUpdateNotificationPreferences()
  const form = useForm<NotificationsFormValues>({
    resolver: zodResolver(notificationsFormSchema),
    defaultValues,
  })

  useEffect(() => {
    if (preferencesQuery.data?.preferences) {
      form.reset(toFormValues(preferencesQuery.data.preferences))
    }
  }, [form, preferencesQuery.data?.preferences])

  async function onSubmit(values: NotificationsFormValues) {
    try {
      await updatePreferences.mutateAsync(toPreferencePayload(values))
      toast.success('Notification preferences updated')
    } catch (error) {
      toast.error(
        getServerErrorMessage(error, 'Unable to update notification settings.')
      )
    }
  }

  if (preferencesQuery.isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-20 w-full' />
      </div>
    )
  }

  if (preferencesQuery.isError) {
    return (
      <Alert variant='destructive'>
        <AlertTitle>Notifications unavailable</AlertTitle>
        <AlertDescription>
          {getServerErrorMessage(
            preferencesQuery.error,
            'Unable to load notification settings.'
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
        <FormField
          control={form.control}
          name='dueSoonDays'
          render={({ field }) => (
            <FormItem className='max-w-48'>
              <FormLabel>Due soon window</FormLabel>
              <FormControl>
                <Input
                  type='number'
                  min={1}
                  max={30}
                  inputMode='numeric'
                  value={field.value}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  onChange={(event) =>
                    field.onChange(event.currentTarget.valueAsNumber)
                  }
                />
              </FormControl>
              <FormDescription>Days before due date.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className='space-y-3'>
          {categoryCopy.map(({ category, label, description }) => (
            <div key={category} className='rounded-lg border p-4'>
              <div className='mb-4 space-y-1'>
                <h3 className='text-sm font-medium'>{label}</h3>
                <p className='text-sm text-muted-foreground'>{description}</p>
              </div>
              <div className='grid gap-4 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name={`${category}.inAppEnabled` as const}
                  render={({ field }) => (
                    <FormItem className='flex items-center justify-between gap-4 rounded-md border bg-muted/20 px-3 py-2'>
                      <FormLabel className='text-sm font-normal'>
                        In-app
                      </FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`${category}.emailEnabled` as const}
                  render={({ field }) => (
                    <FormItem className='flex items-center justify-between gap-4 rounded-md border bg-muted/20 px-3 py-2'>
                      <FormLabel className='text-sm font-normal'>
                        Email
                      </FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>
          ))}
        </div>

        <Button type='submit' disabled={updatePreferences.isPending}>
          {updatePreferences.isPending ? 'Updating...' : 'Update notifications'}
        </Button>
      </form>
    </Form>
  )
}
