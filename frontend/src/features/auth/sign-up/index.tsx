import { Link } from '@tanstack/react-router'
import { useRegistrationState } from '@/services/config/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const registration = useRegistrationState()

  if (registration === 'closed') {
    return <InvitationOnly />
  }

  return (
    <AuthLayout>
      {/* No octagon watermark: the ground behind already carries it. */}
      <Card className='octa-card-plain gap-4 shadow-[var(--shadow-overlay)]'>
        <CardHeader>
          <CardTitle className='font-display text-xl tracking-tight'>
            Create your workspace
          </CardTitle>
          <CardDescription>
            Set up an OctaPM organisation and invite your project team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Nothing to fill in until the server has said sign-up is open:
              a form that would only be refused is worse than a blank beat. */}
          {registration === 'open' ? <SignUpForm /> : null}
        </CardContent>
        <CardFooter className='flex-col gap-4'>
          <div className='w-full border-t pt-4 text-center text-sm'>
            <span className='text-muted-foreground'>
              Already have an account?{' '}
            </span>
            <Link
              to='/sign-in'
              data-testid='uat-sign-up-to-sign-in'
              className='font-medium text-interactive underline-offset-4 hover:underline'
            >
              Sign in
            </Link>
          </div>

          <p className='text-center text-xs text-muted-foreground'>
            By creating an account you agree to our{' '}
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

/**
 * What /sign-up shows when this deployment has self-service registration
 * closed: organisations are set up by OctaPM and people join by invitation,
 * so there is no form to fill in, only the way forward.
 */
function InvitationOnly() {
  return (
    <AuthLayout>
      <Card
        className='octa-card-plain gap-4 shadow-[var(--shadow-overlay)]'
        data-testid='sign-up-invitation-only'
      >
        <CardHeader>
          <CardTitle className='font-display text-xl tracking-tight'>
            Joining is by invitation
          </CardTitle>
          <CardDescription>
            Organisations join OctaPM by invitation, not by self-service
            sign-up.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3 text-sm text-muted-foreground'>
          <p>
            If your company already uses OctaPM, ask your company administrator
            to invite you. The invitation email has a link that sets up your
            account.
          </p>
          <p>
            If your company is new to OctaPM, your workspace is set up for you
            and its first administrator receives a link to get started.
          </p>
        </CardContent>
        <CardFooter>
          <div className='w-full border-t pt-4 text-center text-sm'>
            <span className='text-muted-foreground'>
              Already have an account?{' '}
            </span>
            <Link
              to='/sign-in'
              data-testid='uat-sign-up-to-sign-in'
              className='font-medium text-interactive underline-offset-4 hover:underline'
            >
              Sign in
            </Link>
          </div>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
