import { Link } from '@tanstack/react-router'
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
import { ForgotPasswordForm } from './components/forgot-password-form'

export function ForgotPassword() {
  const registrationOpen = useRegistrationOpen()

  return (
    <AuthLayout>
      <Card className='gap-4'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>
            Forgot Password
          </CardTitle>
          <CardDescription>
            Enter your registered email and <br /> we will send you a link to
            reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
        <CardFooter>
          <p className='mx-auto px-8 text-center text-sm text-balance text-muted-foreground'>
            Don't have an account?{' '}
            {registrationOpen ? (
              <>
                <Link
                  to='/sign-up'
                  className='underline underline-offset-4 hover:text-primary'
                >
                  Sign up
                </Link>
                .
              </>
            ) : (
              'Ask your company administrator for an invitation.'
            )}
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
