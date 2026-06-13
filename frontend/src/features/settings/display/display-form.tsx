import { useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Skeleton } from '@/components/ui/skeleton'
import {
  displayNavigationItems,
  type DisplayNavigationItemId,
  useUpdateDisplaySettings,
  useUserSettings,
} from '../hooks/use-user-settings'

const displayItemIds = displayNavigationItems.map((item) => item.id) as [
  DisplayNavigationItemId,
  ...DisplayNavigationItemId[],
]

const displayFormSchema = z.object({
  items: z
    .array(z.enum(displayItemIds))
    .refine((value) => value.some((item) => item), {
      message: 'You have to select at least one item.',
    }),
})

type DisplayFormValues = z.infer<typeof displayFormSchema>

const defaultValues: DisplayFormValues = {
  items: displayNavigationItems.map((item) => item.id),
}

export function DisplayForm() {
  const settingsQuery = useUserSettings()
  const updateDisplay = useUpdateDisplaySettings()
  const form = useForm<DisplayFormValues>({
    resolver: zodResolver(displayFormSchema),
    defaultValues,
  })

  useEffect(() => {
    if (!settingsQuery.data) return

    form.reset({ items: settingsQuery.data.display.items })
  }, [form, settingsQuery.data])

  async function onSubmit(data: DisplayFormValues) {
    try {
      await updateDisplay.mutateAsync({ items: data.items })
      toast.success('Display settings updated')
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Unable to update display.'))
    }
  }

  if (settingsQuery.isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-10 w-40' />
      </div>
    )
  }

  if (settingsQuery.isError) {
    return (
      <Alert variant='destructive'>
        <AlertTitle>Display unavailable</AlertTitle>
        <AlertDescription>
          {getServerErrorMessage(
            settingsQuery.error,
            'Unable to load display settings.'
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
        <FormField
          control={form.control}
          name='items'
          render={() => (
            <FormItem>
              <div className='mb-4'>
                <FormLabel className='text-base'>Top navigation</FormLabel>
                <FormDescription>
                  Select the sections shown in your primary navigation.
                </FormDescription>
              </div>
              <div className='grid gap-3 sm:grid-cols-2'>
                {displayNavigationItems.map((item) => (
                  <FormField
                    key={item.id}
                    control={form.control}
                    name='items'
                    render={({ field }) => {
                      const currentItems = field.value ?? []
                      return (
                        <FormItem className='flex flex-row items-center gap-3 rounded-md border p-3'>
                          <FormControl>
                            <Checkbox
                              checked={currentItems.includes(item.id)}
                              onCheckedChange={(checked) => {
                                return checked
                                  ? field.onChange([...currentItems, item.id])
                                  : field.onChange(
                                      currentItems.filter(
                                        (value) => value !== item.id
                                      )
                                    )
                              }}
                            />
                          </FormControl>
                          <FormLabel className='font-normal'>
                            {item.label}
                          </FormLabel>
                        </FormItem>
                      )
                    }}
                  />
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type='submit' disabled={updateDisplay.isPending}>
          {updateDisplay.isPending ? 'Updating...' : 'Update display'}
        </Button>
      </form>
    </Form>
  )
}
