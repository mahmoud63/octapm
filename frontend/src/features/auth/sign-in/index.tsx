import { Link, useSearch } from '@tanstack/react-router'
import { useRegistrationOpen } from '@/services/config/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const registrationOpen = useRegistrationOpen()

  return (
    <AuthLayout>
      {/* No octagon watermark here: the ground behind already carries it. */}
      <Card className='octa-card-plain gap-4 shadow-[var(--shadow-overlay)]'>
        <CardHeader>
          <CardTitle className='font-display text-xl tracking-tight'>
            Sign in
          </CardTitle>
          <CardDescription>
            Enter your email and password to open your workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserAuthForm redirectTo={redirect} />
        </CardContent>
        <CardFooter className='flex-col gap-4'>
          {/* Creating an account is a real path, not a footnote — where this
              deployment offers it. Where it does not, say how people join. */}
          <div className='w-full border-t pt-4 text-center text-sm'>
            <span className='text-muted-foreground'>
              New to OctaPM?{' '}
            </span>
            {registrationOpen ? (
              <Link
                to='/sign-up'
                data-testid='uat-sign-in-to-sign-up'
                className='font-medium text-interactive underline-offset-4 hover:underline'
              >
                Create an account
              </Link>
            ) : (
              <span
                className='text-muted-foreground'
                data-testid='sign-in-invitation-only'
              >
                Ask your company administrator for an invitation.
              </span>
            )}
          </div>

          <p className='text-center text-xs text-muted-foreground'>
            By signing in you agree to our{' '}
            <Link
              to='/terms'
              className='underline underline-offset-4 hover:text-primary'
            >
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link
              to='/privacy'
              className='underline underline-offset-4 hover:text-primary'
            >
              Privacy Policy
            </Link>
            .
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
