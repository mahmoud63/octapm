import { useQuery } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { getInvitationPreview } from '@/services/auth/api'
import { MailCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { roles } from '@/features/users/data/data'
import { AuthLayout } from '../auth-layout'
import { AcceptInviteForm } from './components/accept-invite-form'
import { REFUSED_INVITATION_MESSAGE } from './invitation-errors'

const roleLabel = (role: string) =>
  roles.find((item) => item.value === role)?.label || role

const formatExpiry = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))

export function AcceptInvite() {
  const search = useSearch({ strict: false }) as { token?: string }
  const token = search.token || ''

  const invitationQuery = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => getInvitationPreview(token),
    enabled: Boolean(token),
    retry: false,
  })

  return (
    <AuthLayout>
      <Card className='gap-4'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-lg tracking-tight'>
            <MailCheck className='size-5' />
            Accept Invitation
          </CardTitle>
          <CardDescription>
            Join your team and open Octa PM with the assigned access level.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {!token ? (
            <p className='text-sm text-muted-foreground'>
              This invitation link is missing its token. Open the link in the
              newest invitation e-mail you received, or ask your administrator
              to send a new invitation.
            </p>
          ) : invitationQuery.isPending ? (
            <div className='space-y-3'>
              <Skeleton className='h-5 w-2/3' />
              <Skeleton className='h-10 w-full' />
              <Skeleton className='h-10 w-full' />
            </div>
          ) : invitationQuery.isError ? (
            <p
              className='text-sm text-muted-foreground'
              data-testid='accept-invite-refused'
            >
              {REFUSED_INVITATION_MESSAGE}
            </p>
          ) : (
            <>
              <div className='rounded-md border bg-muted/30 p-3 text-sm'>
                <div className='font-medium'>
                  {invitationQuery.data.org.name}
                </div>
                <div className='mt-2 flex flex-wrap gap-2'>
                  <Badge variant='secondary'>
                    {roleLabel(invitationQuery.data.role)}
                  </Badge>
                  {invitationQuery.data.project ? (
                    <Badge variant='outline'>
                      {invitationQuery.data.project.name}
                    </Badge>
                  ) : null}
                  {invitationQuery.data.company ? (
                    <Badge variant='outline'>
                      {invitationQuery.data.company.name}
                    </Badge>
                  ) : null}
                  {invitationQuery.data.projectParty ? (
                    <Badge variant='outline'>
                      {invitationQuery.data.projectParty.role.replace(
                        /_/g,
                        ' '
                      )}
                    </Badge>
                  ) : null}
                </div>
                <p className='mt-2 text-muted-foreground'>
                  Invitation for {invitationQuery.data.email}. Expires{' '}
                  {formatExpiry(invitationQuery.data.expiresAt)}.
                </p>
              </div>
              <AcceptInviteForm
                token={token}
                invitation={invitationQuery.data}
              />
            </>
          )}
        </CardContent>
        <CardFooter>
          <p className='mx-auto px-8 text-center text-sm text-balance text-muted-foreground'>
            Already have access?{' '}
            <Link
              to='/sign-in'
              className='underline underline-offset-4 hover:text-primary'
            >
              Sign in
            </Link>
            .
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
