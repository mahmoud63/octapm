import { useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { CaretSortIcon, CheckIcon } from '@radix-ui/react-icons'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { DatePicker } from '@/components/date-picker'
import {
  languages,
  type UserLanguage,
  useUpdateAccountSettings,
  useUserSettings,
} from '../hooks/use-user-settings'

const accountFormSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters.')
    .max(30, 'Name must not be longer than 30 characters.'),
  dob: z.date().nullable(),
  language: z.enum(['en', 'fr', 'de', 'es', 'pt', 'ru', 'ja', 'ko', 'zh']),
})

type AccountFormValues = z.infer<typeof accountFormSchema>

const defaultValues: AccountFormValues = {
  name: '',
  dob: null,
  language: 'en',
}

export function AccountForm() {
  const settingsQuery = useUserSettings()
  const updateAccount = useUpdateAccountSettings()
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues,
  })

  useEffect(() => {
    if (!settingsQuery.data) return

    form.reset({
      name: settingsQuery.data.account.name,
      dob: settingsQuery.data.account.dob
        ? new Date(settingsQuery.data.account.dob)
        : null,
      language: settingsQuery.data.account.language,
    })
  }, [form, settingsQuery.data])

  async function onSubmit(data: AccountFormValues) {
    try {
      await updateAccount.mutateAsync({
        name: data.name,
        dob: data.dob ? data.dob.toISOString() : null,
        language: data.language as UserLanguage,
      })
      toast.success('Account settings updated')
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Unable to update account.'))
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
        <AlertTitle>Account unavailable</AlertTitle>
        <AlertDescription>
          {getServerErrorMessage(
            settingsQuery.error,
            'Unable to load account settings.'
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
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder='Your name' {...field} />
              </FormControl>
              <FormDescription>
                This is the name shown in navigation, records, and emails.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='dob'
          render={({ field }) => (
            <FormItem className='flex flex-col'>
              <FormLabel>Date of birth</FormLabel>
              <DatePicker
                selected={field.value ?? undefined}
                onSelect={(date) => field.onChange(date ?? null)}
              />
              <FormDescription>Stored on your account profile.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='language'
          render={({ field }) => (
            <FormItem className='flex flex-col'>
              <FormLabel>Language</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant='outline'
                      role='combobox'
                      className={cn(
                        'w-[200px] justify-between',
                        !field.value && 'text-muted-foreground'
                      )}
                    >
                      {field.value
                        ? languages.find(
                            (language) => language.value === field.value
                          )?.label
                        : 'Select language'}
                      <CaretSortIcon className='ms-2 h-4 w-4 shrink-0 opacity-50' />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className='w-[200px] p-0'>
                  <Command>
                    <CommandInput placeholder='Search language...' />
                    <CommandEmpty>No language found.</CommandEmpty>
                    <CommandGroup>
                      <CommandList>
                        {languages.map((language) => (
                          <CommandItem
                            value={language.label}
                            key={language.value}
                            onSelect={() => {
                              form.setValue('language', language.value)
                            }}
                          >
                            <CheckIcon
                              className={cn(
                                'size-4',
                                language.value === field.value
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              )}
                            />
                            {language.label}
                          </CommandItem>
                        ))}
                      </CommandList>
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>
              <FormDescription>
                This language preference is saved with your account.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type='submit' disabled={updateAccount.isPending}>
          {updateAccount.isPending ? 'Updating...' : 'Update account'}
        </Button>
      </form>
    </Form>
  )
}
