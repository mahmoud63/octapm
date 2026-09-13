import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { AxiosError } from 'axios'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { login, ssoLookup, ssoStart, verifyMfa } from '@/services/auth/api'
import {
  isMfaChallenge,
  type ApiErrorEnvelope,
  type AuthSession,
  type SsoLookup,
} from '@/services/auth/types'
import { Building2, KeyRound, Loader2, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { PasswordInput } from '@/components/password-input'

const formSchema = z.object({
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Please enter your email' : undefined),
  }),
  password: z.string(),
})

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof AxiosError) {
    const errorData = error.response?.data as ApiErrorEnvelope | undefined
    return errorData?.error?.message || fallback
  }
  return fallback
}

const errorCodeOf = (error: unknown) =>
  error instanceof AxiosError
    ? (error.response?.data as ApiErrorEnvelope | undefined)?.error?.code
    : undefined

const SSO_ERROR_TEXT: Record<string, string> = {
  SSO_USER_NOT_FOUND:
    'No account exists for that email — ask a company admin to invite you.',
  SSO_USER_OTHER_ORG: 'That email belongs to a different organisation.',
  SSO_DOMAIN_NOT_ALLOWED: 'That email domain cannot sign in here.',
  SSO_STATE_INVALID: 'The sign-in took too long — please try again.',
  SSO_TOKEN_INVALID: 'The identity provider’s response could not be verified.',
  SSO_TOKEN_EXCHANGE_FAILED: 'The identity provider refused the sign-in.',
  SSO_NOT_CONFIGURED: 'Single sign-on is not set up for that email.',
  USER_INACTIVE: 'Your account is not active.',
}

/**
 * Sign-in: password, then a second factor when the account has one; single
 * sign-on when the email's organisation uses it (the password field hides
 * when SSO is mandatory for that domain).
 */
export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [challenge, setChallenge] = useState<{ mfaToken: string } | null>(null)
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [sso, setSso] = useState<SsoLookup | null>(null)
  const lookupTimer = useRef<number | null>(null)
  const navigate = useNavigate()
  const { auth } = useAuthStore()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '', password: '' },
  })

  // The identity provider sends failures back as ?ssoError=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ssoError = params.get('ssoError')
    if (ssoError) {
      toast.error(
        SSO_ERROR_TEXT[ssoError] ?? `Single sign-on failed (${ssoError})`
      )
      params.delete('ssoError')
      const rest = params.toString()
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${rest ? `?${rest}` : ''}`
      )
    }
  }, [])

  const queryClient = useQueryClient()
  const finish = (session: AuthSession) => {
    // Nothing fetched before this sign-in may be shown to this person (CX21-456).
    queryClient.clear()
    auth.setSession(session.user, session.tokens.accessToken)
    navigate({ to: redirectTo || '/', replace: true })
    return `Welcome back, ${session.user.name}!`
  }

  const onEmailChange = (value: string) => {
    if (lookupTimer.current) window.clearTimeout(lookupTimer.current)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setSso(null)
      return
    }
    lookupTimer.current = window.setTimeout(() => {
      ssoLookup(value)
        .then((result) => setSso(result.sso ? result : null))
        .catch(() => setSso(null))
    }, 400)
  }

  const startSso = async (emailHint?: string) => {
    const email =
      emailHint ??
      form.getValues('email') ??
      window.prompt('Your work email (to find your organisation):') ??
      ''
    if (!email) return
    setIsLoading(true)
    try {
      const { authorizationUrl } = await ssoStart({
        email,
        redirectTo: redirectTo || null,
      })
      window.location.assign(authorizationUrl)
    } catch (error) {
      setIsLoading(false)
      toast.error(
        getErrorMessage(error, 'Single sign-on is not available for that email')
      )
    }
  }

  function onSubmit(data: z.infer<typeof formSchema>) {
    if (sso?.required) {
      void startSso(data.email)
      return
    }
    if (!data.password) {
      form.setError('password', { message: 'Please enter your password' })
      return
    }
    setIsLoading(true)
    toast.promise(login(data), {
      loading: 'Signing in...',
      success: (result) => {
        setIsLoading(false)
        if (isMfaChallenge(result)) {
          setChallenge({ mfaToken: result.mfaToken })
          setCode('')
          return 'Enter the code from your authenticator app'
        }
        return finish(result)
      },
      error: (error) => {
        setIsLoading(false)
        if (errorCodeOf(error) === 'SSO_REQUIRED') {
          setSso({ sso: true, required: true, orgName: null })
        }
        return getErrorMessage(error, 'Unable to sign in')
      },
    })
  }

  const submitCode = () => {
    if (!challenge) return
    const clean = code.trim()
    if (!clean) return
    setIsLoading(true)
    toast.promise(verifyMfa({ mfaToken: challenge.mfaToken, code: clean }), {
      loading: 'Checking the code...',
      success: (session) => {
        setIsLoading(false)
        return finish(session)
      },
      error: (error) => {
        setIsLoading(false)
        const errorCode = errorCodeOf(error)
        if (
          errorCode === 'MFA_CHALLENGE_EXPIRED' ||
          errorCode === 'MFA_CHALLENGE_INVALID'
        ) {
          setChallenge(null)
        }
        return getErrorMessage(error, 'That code is not valid')
      },
    })
  }

  if (challenge) {
    return (
      <div
        className={cn('grid gap-3', className)}
        data-testid='uat-sign-in-mfa'
      >
        <div className='space-y-1'>
          <p className='text-sm font-medium'>Two-factor authentication</p>
          <p className='text-sm text-muted-foreground'>
            {useBackup
              ? 'Enter one of your backup codes. Each code works once.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </p>
        </div>
        {useBackup ? (
          <Input
            autoFocus
            placeholder='xxxx-xxxx'
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitCode()
            }}
            data-testid='uat-sign-in-backup-code'
          />
        ) : (
          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            onComplete={submitCode}
            containerClassName='justify-center'
            autoFocus
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        )}
        <Button
          disabled={isLoading || code.trim().length < 6}
          onClick={submitCode}
          data-testid='uat-sign-in-mfa-submit'
        >
          {isLoading ? <Loader2 className='animate-spin' /> : <KeyRound />}
          Verify
        </Button>
        <div className='flex justify-between text-xs text-muted-foreground'>
          <button
            type='button'
            className='underline-offset-4 hover:underline'
            onClick={() => {
              setUseBackup((value) => !value)
              setCode('')
            }}
          >
            {useBackup ? 'Use the authenticator app' : 'Use a backup code'}
          </button>
          <button
            type='button'
            className='underline-offset-4 hover:underline'
            onClick={() => {
              setChallenge(null)
              setCode('')
            }}
          >
            Start again
          </button>
        </div>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form
        data-testid='uat-sign-in-form'
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  data-testid='uat-sign-in-email'
                  placeholder='name@example.com'
                  {...field}
                  onChange={(event) => {
                    field.onChange(event)
                    onEmailChange(event.target.value)
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {!sso?.required && (
          <FormField
            control={form.control}
            name='password'
            render={({ field }) => (
              <FormItem className='relative'>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput
                    data-testid='uat-sign-in-password'
                    placeholder='********'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
                <Link
                  to='/forgot-password'
                  className='absolute inset-e-0 -top-0.5 text-sm font-medium text-muted-foreground hover:opacity-75'
                >
                  Forgot password?
                </Link>
              </FormItem>
            )}
          />
        )}
        {sso?.sso ? (
          <Button
            type='button'
            className='mt-2'
            disabled={isLoading}
            onClick={() => startSso(form.getValues('email'))}
            data-testid='uat-sign-in-sso'
          >
            {isLoading ? <Loader2 className='animate-spin' /> : <Building2 />}
            Continue with {sso.orgName ?? 'your organisation'} SSO
          </Button>
        ) : null}
        {!sso?.required && (
          <Button
            data-testid='uat-sign-in-submit'
            className={sso?.sso ? '' : 'mt-2'}
            variant={sso?.sso ? 'outline' : 'default'}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
            Sign in{sso?.sso ? ' with password' : ''}
          </Button>
        )}

        {!sso && (
          <>
            <div className='relative my-2'>
              <div className='absolute inset-0 flex items-center'>
                <span className='w-full border-t' />
              </div>
              <div className='relative flex justify-center text-xs uppercase'>
                <span className='bg-background px-2 text-muted-foreground'>
                  Or
                </span>
              </div>
            </div>
            <Button
              variant='outline'
              type='button'
              disabled={isLoading}
              onClick={() => startSso()}
              data-testid='uat-sign-in-sso-generic'
            >
              <Building2 className='h-4 w-4' /> Sign in with company SSO
            </Button>
          </>
        )}
      </form>
    </Form>
  )
}
