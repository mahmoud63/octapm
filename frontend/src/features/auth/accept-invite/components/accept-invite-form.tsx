import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import {
  acceptInvitation,
  getMyProfile,
  login,
  logout,
  verifyMfa,
} from '@/services/auth/api'
import {
  isMfaChallenge,
  isSignInRequired,
  type AcceptInvitationResult,
  type InvitationPreview,
  type LoginResult,
} from '@/services/auth/types'
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
import { Label } from '@/components/ui/label'
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

/** Installs the session acceptance returned, or sends the person to sign in when the workspace asks for that. */
const useFinishAcceptance = () => {
  const navigate = useNavigate()
  const setSession = useAuthStore((state) => state.auth.setSession)
  return (result: AcceptInvitationResult) => {
    if (isSignInRequired(result)) {
      // The workspace has the person sign in its own way (single sign-on, or a
      // reopened account's new password). Signed in here already, they stay
      // where they are and open it from the workspace switcher; otherwise the
      // sign-in page (which would send a signed-in person straight home).
      const { auth } = useAuthStore.getState()
      toast.success(
        `Invitation accepted. ${result.reason?.message || 'Sign in to open the workspace.'}`
      )
      if (!auth.user) {
        navigate({ to: '/sign-in' })
        return
      }
      // The workspace list is re-read so the switcher shows the one just joined.
      void getMyProfile()
        .then((profile) => auth.setUser(profile))
        .catch(() => undefined)
        .finally(() => navigate({ to: '/' }))
      return
    }
    const session = result
    setSession(session.user, session.tokens.accessToken, {
      workspace: session.workspace,
      memberships: session.memberships,
    })
    toast.success('Invitation accepted.')
    navigate({ to: '/' })
  }
}

/** The token a sign-in step returned: a session's access token, or the identity token of a workspace choice. */
const bearerOf = (result: LoginResult): string | null => {
  if ('tokens' in result && result.tokens?.accessToken) {
    return result.tokens.accessToken
  }
  if ('identityToken' in result && result.identityToken) {
    return result.identityToken
  }
  return null
}

/**
 * An e-mail that already has an account accepts as that account (owner
 * decision L38): its owner signs in here — password, then the second factor
 * when the account has one — and the invitation is accepted with that
 * session. A person already signed in as that account just accepts.
 */
function SignInToAccept({
  className,
  token,
  invitation,
}: {
  className?: string
  token: string
  invitation: InvitationPreview
}) {
  const finish = useFinishAcceptance()
  const signedInUser = useAuthStore((state) => state.auth.user)
  const resetAuth = useAuthStore((state) => state.auth.reset)
  const signedInAsInvitee =
    signedInUser?.email?.toLowerCase() === invitation.email.toLowerCase()
  // Someone else is signed in here: signing the invitee in would replace this
  // browser's session under them, so they sign out first.
  const signedInAsSomeoneElse = Boolean(signedInUser) && !signedInAsInvitee
  const signOut = async () => {
    try {
      await logout()
    } catch {
      // the local session is cleared either way
    }
    resetAuth()
  }
  const [password, setPassword] = useState('')
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const accept = async (bearer?: string) => {
    finish(await acceptInvitation({ token }, bearer ? { bearer } : {}))
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    try {
      if (signedInAsInvitee) {
        await accept()
        return
      }
      if (mfaToken) {
        const verified = (await verifyMfa({
          mfaToken,
          code: code.trim(),
        })) as LoginResult
        const bearer = bearerOf(verified)
        if (!bearer) throw new Error('Sign-in did not return a session.')
        await accept(bearer)
        return
      }
      const result = await login({ email: invitation.email, password })
      if (isMfaChallenge(result)) {
        setMfaToken(result.mfaToken)
        return
      }
      const bearer = bearerOf(result)
      if (!bearer) throw new Error('Sign-in did not return a session.')
      await accept(bearer)
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Unable to accept invitation.'))
    } finally {
      setIsLoading(false)
    }
  }

  if (signedInAsSomeoneElse) {
    return (
      <div className={cn('grid gap-3', className)}>
        <p className='text-sm text-muted-foreground'>
          You are signed in as {signedInUser?.email}. This invitation is for{' '}
          {invitation.email}: sign out, then sign in as that account to accept
          it.
        </p>
        <Button type='button' variant='outline' onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className={cn('grid gap-3', className)}>
      {signedInAsInvitee ? (
        <p className='text-sm text-muted-foreground'>
          You are signed in as {invitation.email}.
        </p>
      ) : (
        <>
          <p className='text-sm text-muted-foreground'>
            {invitation.email} already has an Octa PM account. Sign in to
            accept this invitation. If your company signs in with single
            sign-on, sign in that way first, then open this link again.
          </p>
          <div className='grid gap-2'>
            <Label htmlFor='invite-email'>Email</Label>
            <Input id='invite-email' value={invitation.email} disabled />
          </div>
          {mfaToken ? (
            <div className='grid gap-2'>
              <Label htmlFor='invite-code'>Authentication code</Label>
              <Input
                id='invite-code'
                autoComplete='one-time-code'
                inputMode='numeric'
                placeholder='123456 or a backup code'
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
          ) : (
            <div className='grid gap-2'>
              <Label htmlFor='invite-password'>Password</Label>
              <PasswordInput
                id='invite-password'
                autoComplete='current-password'
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          )}
        </>
      )}
      <Button
        className='mt-2'
        disabled={
          isLoading ||
          (!signedInAsInvitee && (mfaToken ? !code.trim() : !password))
        }
      >
        {signedInAsInvitee || mfaToken
          ? 'Accept invitation'
          : 'Sign in and accept'}
        {isLoading ? <Loader2 className='animate-spin' /> : <ArrowRight />}
      </Button>
    </form>
  )
}

export function AcceptInviteForm({
  className,
  token,
  invitation,
  ...props
}: AcceptInviteFormProps) {
  const finish = useFinishAcceptance()
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

  if (invitation.requiresSignIn) {
    return (
      <SignInToAccept
        className={className}
        token={token}
        invitation={invitation}
      />
    )
  }

  async function onSubmit(data: AcceptInviteFormValues) {
    if (invitation.requiresPassword && !data.password) {
      form.setError('password', {
        message: 'Password is required for this invitation.',
      })
      return
    }

    setIsLoading(true)
    try {
      finish(
        await acceptInvitation({
          token,
          name: data.name,
          phone: data.phone || undefined,
          password: data.password || undefined,
        })
      )
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
