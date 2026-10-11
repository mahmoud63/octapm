import { useEffect, useRef, useState } from 'react'
import { AxiosError } from 'axios'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { ssoComplete } from '@/services/auth/api'
import type { ApiErrorEnvelope } from '@/services/auth/types'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { safeInternalPath } from '@/lib/domains'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '../auth-layout'

/** `/sso/complete?ticket=…` — exchanges the one-time ticket from the identity-provider callback for a session. */
export function SsoComplete() {
  const search = useSearch({ strict: false }) as {
    ticket?: string
    redirect?: string
  }
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const ticket = search.ticket
    if (!ticket) {
      setError(
        'This sign-in link is incomplete — start again from the sign-in page.'
      )
      return
    }
    ssoComplete(ticket)
      .then((session) => {
        auth.setSession(session.user, session.tokens.accessToken)
        toast.success(`Welcome, ${session.user.name}!`)
        const target = safeInternalPath(search.redirect) ?? '/'
        navigate({ to: target, replace: true })
      })
      .catch((err) => {
        const message =
          err instanceof AxiosError
            ? (err.response?.data as ApiErrorEnvelope | undefined)?.error
                ?.message
            : null
        setError(message || 'The sign-in link has expired — start again.')
      })
  }, [auth, navigate, search.redirect, search.ticket])

  return (
    <AuthLayout>
      <div className='space-y-3 text-center' data-testid='uat-sso-complete'>
        {error ? (
          <>
            <p className='text-sm text-destructive'>{error}</p>
            <Button onClick={() => navigate({ to: '/sign-in', replace: true })}>
              Back to sign in
            </Button>
          </>
        ) : (
          <p className='flex items-center justify-center gap-2 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Completing your
            sign-in…
          </p>
        )}
      </div>
    </AuthLayout>
  )
}
