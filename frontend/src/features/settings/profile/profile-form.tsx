import { useEffect } from 'react'
import { z } from 'zod'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
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
import { Textarea } from '@/components/ui/textarea'
import {
  useUpdateProfileSettings,
  useUserSettings,
} from '../hooks/use-user-settings'

const profileFormSchema = z.object({
  username: z
    .string()
    .min(2, 'Username must be at least 2 characters.')
    .max(30, 'Username must not be longer than 30 characters.'),
  email: z.email(),
  bio: z.string().max(160, 'Bio must be 160 characters or less.').optional(),
  urls: z
    .array(
      z.object({
        value: z.url('Please enter a valid URL.'),
      })
    )
    .max(10, 'You can add up to 10 links.')
    .optional(),
})

type ProfileFormValues = z.infer<typeof profileFormSchema>

const defaultValues: ProfileFormValues = {
  username: '',
  email: '',
  bio: '',
  urls: [],
}

export function ProfileForm() {
  const settingsQuery = useUserSettings()
  const updateProfile = useUpdateProfileSettings()
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues,
    mode: 'onChange',
  })

  const { fields, append, remove } = useFieldArray({
    name: 'urls',
    control: form.control,
  })

  useEffect(() => {
    if (!settingsQuery.data) return

    form.reset({
      username: settingsQuery.data.profile.username,
      email: settingsQuery.data.profile.email,
      bio: settingsQuery.data.profile.bio,
      urls: settingsQuery.data.profile.urls,
    })
  }, [form, settingsQuery.data])

  async function onSubmit(values: ProfileFormValues) {
    try {
      await updateProfile.mutateAsync({
        username: values.username,
        bio: values.bio || '',
        urls: values.urls?.filter((url) => url.value.trim()) ?? [],
      })
      toast.success('Profile settings updated')
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Unable to update profile.'))
    }
  }

  if (settingsQuery.isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-10 w-40' />
      </div>
    )
  }

  if (settingsQuery.isError) {
    return (
      <Alert variant='destructive'>
        <AlertTitle>Profile unavailable</AlertTitle>
        <AlertDescription>
          {getServerErrorMessage(
            settingsQuery.error,
            'Unable to load profile settings.'
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
          name='username'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder='Project manager' {...field} />
              </FormControl>
              <FormDescription>
                This is your public display name inside the workspace.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type='email' readOnly disabled {...field} />
              </FormControl>
              <FormDescription>
                Sign-in email changes require a verified account-change flow.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='bio'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bio</FormLabel>
              <FormControl>
                <Textarea
                  placeholder='Tell the team a little bit about your project role.'
                  className='resize-none'
                  {...field}
                />
              </FormControl>
              <FormDescription>Shown on your profile card.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='space-y-3'>
          {fields.map((field, index) => (
            <FormField
              control={form.control}
              key={field.id}
              name={`urls.${index}.value`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className={cn(index !== 0 && 'sr-only')}>
                    Links
                  </FormLabel>
                  <div className='flex gap-2'>
                    <FormControl>
                      <Input
                        placeholder='https://example.com'
                        className='flex-1'
                        {...field}
                      />
                    </FormControl>
                    <Button
                      type='button'
                      variant='outline'
                      size='icon'
                      onClick={() => remove(index)}
                      aria-label='Remove link'
                    >
                      <X className='size-4' />
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => append({ value: '' })}
          >
            Add link
          </Button>
        </div>
        <Button type='submit' disabled={updateProfile.isPending}>
          {updateProfile.isPending ? 'Updating...' : 'Update profile'}
        </Button>
      </form>
    </Form>
  )
}
