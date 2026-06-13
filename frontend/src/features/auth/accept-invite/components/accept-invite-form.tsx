import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { acceptInvitation } from '@/services/auth/api'
import type { InvitationPreview } from '@/services/auth/types'
import { ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
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
import { PasswordInput } from '@/components/password-input'

const formSchema = z
  .object({
    name: z.string().min(1, 'Name is required.'),
    phone: z.string().optional(),
    password: z.string().optional(),
    confirmPassword: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.password && !data.confirmPassword) return

    if (!data.password || data.password.length < 8) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password must be at least 8 characters.',
      })
    }
    if (data.password && !/[a-z]/.test(data.password)) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password must contain a lowercase letter.',
      })
    }
    if (data.password && !/[0-9]/.test(data.password)) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password must contain a number.',
      })
    }
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match.',
      })
    }
  })

type AcceptInviteFormValues = z.infer<typeof formSchema>

type AcceptInviteFormProps = React.HTMLAttributes<HTMLFormElement> & {
  token: string
  invitation: InvitationPreview
}

export function AcceptInviteForm({
  className,
  token,
  invitation,
  ...props
}: AcceptInviteFormProps) {
  const navigate = useNavigate()
  const setSession = useAuthStore((state) => state.auth.setSession)
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<AcceptInviteFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      phone: '',
      password: '',
      confirmPassword: '',
    },
  })

  async function onSubmit(data: AcceptInviteFormValues) {
    if (invitation.requiresPassword && !data.password) {
      form.setError('password', {
        message: 'Password is required for this invitation.',
      })
      return
    }

    setIsLoading(true)
    try {
      const session = await acceptInvitation({
        token,
        name: data.name,
        phone: data.phone || undefined,
        password: data.password || undefined,
      })
      setSession(session.user, session.tokens.accessToken)
      toast.success('Invitation accepted.')
      navigate({ to: '/' })
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Unable to accept invitation.'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input autoComplete='name' placeholder='Your name' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='phone'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone (optional)</FormLabel>
              <FormControl>
                <Input
                  autoComplete='tel'
                  placeholder='+1 555 0100'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {invitation.requiresPassword ? (
          <>
            <FormField
              control={form.control}
              name='password'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='new-password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='confirmPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm password</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='new-password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        ) : null}
        <Button className='mt-2' disabled={isLoading}>
          Accept invitation
          {isLoading ? <Loader2 className='animate-spin' /> : <ArrowRight />}
        </Button>
      </form>
    </Form>
  )
}
