import { Link } from '@tanstack/react-router'
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
          <SignUpForm />
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
