import { useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { ChevronDownIcon } from '@radix-ui/react-icons'
import { Monitor } from 'lucide-react'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { fonts } from '@/config/fonts'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { useFont } from '@/context/font-provider'
import { useTheme } from '@/context/theme-provider'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type UserFont,
  type UserTheme,
  useUpdateAppearanceSettings,
  useUserSettings,
} from '../hooks/use-user-settings'

const appearanceFormSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  font: z.enum(fonts),
})

type AppearanceFormValues = z.infer<typeof appearanceFormSchema>

const themeOptions: Array<{
  value: UserTheme
  label: string
  description: string
}> = [
  {
    value: 'light',
    label: 'Light',
    description: 'Bright workspace surfaces.',
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Low-glare dashboard surfaces.',
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow this device setting.',
  },
]

const defaultValues: AppearanceFormValues = {
  theme: 'dark',
  font: fonts[0],
}

export function AppearanceForm() {
  const { font, setFont } = useFont()
  const { theme, setTheme } = useTheme()
  const settingsQuery = useUserSettings()
  const updateAppearance = useUpdateAppearanceSettings()
  const form = useForm<AppearanceFormValues>({
    resolver: zodResolver(appearanceFormSchema),
    defaultValues,
  })

  useEffect(() => {
    if (!settingsQuery.data) return

    form.reset(settingsQuery.data.appearance)
  }, [form, settingsQuery.data])

  async function onSubmit(data: AppearanceFormValues) {
    try {
      await updateAppearance.mutateAsync({
        theme: data.theme as UserTheme,
        font: data.font as UserFont,
      })
      if (data.font !== font) setFont(data.font as UserFont)
      if (data.theme !== theme) setTheme(data.theme as UserTheme)
      toast.success('Appearance preferences updated')
    } catch (error) {
      toast.error(
        getServerErrorMessage(error, 'Unable to update appearance.')
      )
    }
  }

  if (settingsQuery.isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-28 w-full' />
        <Skeleton className='h-10 w-40' />
      </div>
    )
  }

  if (settingsQuery.isError) {
    return (
      <Alert variant='destructive'>
        <AlertTitle>Appearance unavailable</AlertTitle>
        <AlertDescription>
          {getServerErrorMessage(
            settingsQuery.error,
            'Unable to load appearance settings.'
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
          name='font'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Font</FormLabel>
              <div className='relative w-max'>
                <FormControl>
                  <select
                    className={cn(
                      buttonVariants({ variant: 'outline' }),
                      'w-[200px] appearance-none font-normal capitalize',
                      'dark:bg-background dark:hover:bg-background'
                    )}
                    {...field}
                  >
                    {fonts.map((font) => (
                      <option key={font} value={font}>
                        {font}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <ChevronDownIcon className='absolute end-3 top-2.5 h-4 w-4 opacity-50' />
              </div>
              <FormDescription className='font-manrope'>
                Saved as your workspace font preference.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='theme'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Theme</FormLabel>
              <FormDescription>
                Saved as your workspace theme preference.
              </FormDescription>
              <FormMessage />
              <RadioGroup
                onValueChange={field.onChange}
                value={field.value}
                className='grid max-w-2xl gap-3 pt-2 sm:grid-cols-3'
              >
                {themeOptions.map((option) => (
                  <FormItem key={option.value}>
                    <FormLabel className='[&:has([data-state=checked])>div]:border-primary'>
                      <FormControl>
                        <RadioGroupItem
                          value={option.value}
                          className='sr-only'
                        />
                      </FormControl>
                      <div className='min-h-28 rounded-md border-2 border-muted p-3 hover:border-accent'>
                        <div className='mb-3 flex items-center justify-between'>
                          <span className='font-medium'>{option.label}</span>
                          <Monitor className='size-4 text-muted-foreground' />
                        </div>
                        <p className='text-sm font-normal text-muted-foreground'>
                          {option.description}
                        </p>
                      </div>
                    </FormLabel>
                  </FormItem>
                ))}
              </RadioGroup>
            </FormItem>
          )}
        />

        <Button type='submit' disabled={updateAppearance.isPending}>
          {updateAppearance.isPending ? 'Updating...' : 'Update preferences'}
        </Button>
      </form>
    </Form>
  )
}
