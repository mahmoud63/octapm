import { useMemo, useState } from 'react'
import { isEndedSession } from '@/services/api/client'
import { Loader2, MailWarning, RotateCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/dates'
import { roleLabel } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useSubscription } from '@/features/billing/hooks/use-billing'
import { useProjects } from '@/features/projects/hooks/use-projects'
import {
  type PendingInvitation,
  invitationErrorMessage,
  isInvitationEmailFailed,
  useInvitationsQuery,
  useResendInvitationMutation,
  useRevokeInvitationMutation,
} from '../hooks/use-users'

/**
 * The invitations not yet accepted (owner decision D-ID-1 Q5). Shown only to
 * people who can invite; a revoked link stops working at once, and a re-send
 * sends the stored offer again — nothing is re-typed.
 */
export function UsersPendingInvitations() {
  const invitationsQuery = useInvitationsQuery(true)
  const projectsQuery = useProjects()
  const revoke = useRevokeInvitationMutation()
  const resend = useResendInvitationMutation()
  const { data: subscription } = useSubscription()
  const subscriptionAllowsWrites = subscription?.hasAccess !== false
  const [revoking, setRevoking] = useState<PendingInvitation | null>(null)

  const invitations = useMemo(
    () => invitationsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [invitationsQuery.data]
  )
  const projectNames = useMemo(
    () =>
      new Map(
        (projectsQuery.data?.items ?? []).map((project) => [
          project.id,
          project.name,
        ])
      ),
    [projectsQuery.data]
  )

  const onResend = (invitation: PendingInvitation) => {
    resend.mutate(invitation.id, {
      onSuccess: () =>
        toast.success(`Invitation sent again to ${invitation.email}.`),
      onError: (error) => {
        // An ended session was already announced by the request layer (D-ID-1 N4).
        if (isEndedSession(error)) return
        if (isInvitationEmailFailed(error)) {
          toast.warning(invitationErrorMessage(error))
        } else {
          toast.error(invitationErrorMessage(error))
        }
      },
    })
  }

  const onRevokeConfirm = () => {
    if (!revoking) return
    const invitation = revoking
    revoke.mutate(invitation.id, {
      onSuccess: () => {
        toast.success(
          `Invitation to ${invitation.email} revoked. Its link no longer works.`
        )
        setRevoking(null)
      },
      onError: (error) => {
        setRevoking(null)
        // An ended session was already announced by the request layer (D-ID-1 N4).
        if (isEndedSession(error)) return
        toast.error(invitationErrorMessage(error))
      },
    })
  }

  if (invitationsQuery.isLoading) {
    return (
      <p className='flex items-center gap-2 py-6 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Loading invitations…
      </p>
    )
  }

  if (invitationsQuery.isError) {
    return (
      <p className='py-6 text-sm text-destructive'>
        {invitationErrorMessage(invitationsQuery.error)}
      </p>
    )
  }

  if (invitations.length === 0) {
    return (
      <p
        className='py-12 text-center text-sm text-muted-foreground'
        data-testid='uat-pending-invitations-empty'
      >
        No invitations are waiting to be accepted.
      </p>
    )
  }

  return (
    <div className='space-y-3' data-testid='uat-pending-invitations'>
      <div className='overflow-x-auto rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className='text-end'>
                <span className='sr-only'>Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => {
              const busy =
                (resend.isPending && resend.variables === invitation.id) ||
                (revoke.isPending && revoke.variables === invitation.id)
              return (
                <TableRow
                  key={invitation.id}
                  data-testid={`uat-pending-invitation-${invitation.id}`}
                >
                  <TableCell>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='font-medium'>{invitation.email}</span>
                      {invitation.lastDeliveryFailedAt && (
                        <Badge
                          variant='outline'
                          className='border-amber-300 text-amber-700 dark:text-amber-300'
                          title={`The last e-mail failed ${formatDateTime(
                            invitation.lastDeliveryFailedAt
                          )}`}
                          data-testid='uat-invitation-delivery-failed'
                        >
                          <MailWarning className='me-1 h-3 w-3' /> Delivery
                          failed
                        </Badge>
                      )}
                    </div>
                    {invitation.note && (
                      <p className='mt-1 line-clamp-1 text-xs text-muted-foreground'>
                        {invitation.note}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>{roleLabel(invitation.role)}</TableCell>
                  <TableCell>
                    {invitation.projectId ? (
                      <div className='flex flex-wrap items-center gap-1'>
                        <span>
                          {projectNames.get(invitation.projectId) ??
                            'A project'}
                        </span>
                        {invitation.projectPartyId && (
                          <Badge variant='outline' className='text-[10px]'>
                            external party
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className='text-muted-foreground'>
                        Organization only
                      </span>
                    )}
                  </TableCell>
                  <TableCell className='text-sm text-muted-foreground'>
                    {formatDateTime(invitation.expiresAt)}
                  </TableCell>
                  <TableCell className='text-end'>
                    {subscriptionAllowsWrites && (
                      <div className='flex justify-end gap-1'>
                        <Button
                          size='sm'
                          variant='ghost'
                          disabled={busy}
                          onClick={() => onResend(invitation)}
                          data-testid='uat-invitation-resend'
                        >
                          <RotateCw className='me-1 h-3.5 w-3.5' /> Resend
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          className='text-destructive'
                          disabled={busy}
                          onClick={() => setRevoking(invitation)}
                          data-testid='uat-invitation-revoke'
                        >
                          <XCircle className='me-1 h-3.5 w-3.5' /> Revoke
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {invitationsQuery.hasNextPage && (
        <div className='flex justify-center'>
          <Button
            variant='outline'
            size='sm'
            disabled={invitationsQuery.isFetchingNextPage}
            onClick={() => invitationsQuery.fetchNextPage()}
          >
            {invitationsQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title='Revoke invitation?'
        desc={
          <p>
            The invitation to {revoking?.email} stops working at once. You can
            invite them again later.
          </p>
        }
        destructive
        confirmText={revoke.isPending ? 'Revoking…' : 'Revoke'}
        isLoading={revoke.isPending}
        handleConfirm={onRevokeConfirm}
      />
    </div>
  )
}
