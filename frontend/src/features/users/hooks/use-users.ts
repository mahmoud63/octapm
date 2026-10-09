import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { REPORTS_OWN_ERROR } from '@/lib/mutation-meta'
import { useCanPerform } from '@/lib/permissions'
import { apiClient } from '@/services/api/client'
import type { User } from '../data/schema'

interface UsersResponse {
  items: User[]
  pagination: {
    limit: number
    nextCursor: string | null
  }
}

export type UsersQueryParams = {
  status?: string
  search?: string
  role?: string
  sortBy?: 'name' | 'email' | 'projects' | 'created'
  sortDir?: 'asc' | 'desc'
}

/** An invitation as the server answers it (POST /users/invitations, resend). */
export type Invitation = {
  id: string
  email: string
  role: string
  status: string
  projectId: string | null
  companyId: string | null
  projectPartyId: string | null
  invitedById: string | null
  expiresAt: string
  createdAt: string
}

/** A row of GET /users/invitations: pending, unexpired, with its last delivery failure. */
export type PendingInvitation = Invitation & {
  note: string | null
  lastDeliveryFailedAt: string | null
}

interface InvitationsResponse {
  items: PendingInvitation[]
  pagination: {
    limit: number
    nextCursor: string | null
  }
}

const USERS_KEY = ['users'] as const
const INVITATIONS_KEY = ['users', 'invitations'] as const

export const useUsersQuery = (params: UsersQueryParams = {}) =>
  useQuery<UsersResponse>({
    queryKey: ['users', params],
    queryFn: () =>
      apiClient
        .get('/users', {
          params,
        })
        .then((r) => r.data.data),
  })

const errorCode = (error: unknown) =>
  error instanceof AxiosError
    ? (error.response?.data as { error?: { code?: string } } | undefined)
        ?.error?.code
    : undefined

/** The invitation was saved but its e-mail failed (502 INVITATION_EMAIL_FAILED). */
export const isInvitationEmailFailed = (error: unknown) =>
  errorCode(error) === 'INVITATION_EMAIL_FAILED'

/**
 * The sentence a refused invitation (or re-send) shows. Adding a person is
 * always an invitation (owner decision D-ID-1): the person chooses their own
 * password when they accept, and nothing here says whether an account exists.
 */
export const invitationErrorMessage = (error: unknown) => {
  switch (errorCode(error)) {
    case 'ALREADY_MEMBER':
      return 'This person is already part of this workspace. If they are deactivated, activate them from the People list instead of inviting them.'
    case 'INVITATION_EMAIL_FAILED':
      return 'The invitation was saved but the e-mail could not be sent. Resend it from Pending invitations.'
    case 'MEMBERSHIP_WRITES_SUSPENDED':
      return 'Adding people is paused on this OctaPM deployment at the moment. Please try again later.'
    case 'USER_PASSWORD_NOT_ACCEPTED':
      return 'People choose their own password when they accept. Reload the page and send the invitation again.'
    case 'INVITATION_NOT_PENDING':
      return 'This invitation is no longer pending: it was accepted, revoked or replaced.'
    default:
      return getServerErrorMessage(error, 'Unable to send the invitation.')
  }
}

/**
 * POST /users/invitations — the one way a person is added. A 502 means the
 * invitation was saved but its e-mail failed, so the lists are refreshed
 * whatever the outcome.
 */
export const useInviteUserMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    meta: REPORTS_OWN_ERROR,
    mutationFn: (payload: {
      email: string
      role: string
      projectId?: string
      companyId?: string
      projectPartyId?: string
      note?: string
    }): Promise<Invitation & { invited: true }> =>
      apiClient.post('/users/invitations', payload).then((r) => r.data.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: USERS_KEY })
    },
  })
}

/**
 * GET /users/invitations, a cursor page at a time — only for people who can
 * invite (submit + user.invite); nobody else asks for it.
 */
export const useInvitationsQuery = (enabled: boolean) =>
  useInfiniteQuery({
    queryKey: INVITATIONS_KEY,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }): Promise<InvitationsResponse> =>
      apiClient
        .get('/users/invitations', {
          params: pageParam ? { cursor: pageParam } : undefined,
        })
        .then((r) => r.data.data),
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor ?? null,
  })

export const useRevokeInvitationMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    meta: REPORTS_OWN_ERROR,
    mutationFn: (
      invitationId: string
    ): Promise<{ id: string; revoked: true }> =>
      apiClient
        .delete(`/users/invitations/${invitationId}`)
        .then((r) => r.data.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY })
    },
  })
}

/** The server re-sends the stored offer; nothing is re-typed here. */
export const useResendInvitationMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    meta: REPORTS_OWN_ERROR,
    mutationFn: (invitationId: string): Promise<Invitation> =>
      apiClient
        .post(`/users/invitations/${invitationId}/resend`)
        .then((r) => r.data.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY })
    },
  })
}

export const useDeactivateUserMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.patch(`/users/${userId}/deactivate`).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export const useActivateUserMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.patch(`/users/${userId}/activate`).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

/**
 * PATCH /users/:id carries only the fields that changed. A person's sign-in
 * e-mail is theirs (owner decision D-ID-1): it is never part of this payload.
 */
export type UserUpdatePayload = {
  name?: string
  phone?: string
  role?: string
  isCompanyAdmin?: boolean
}

export const useUpdateUserMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    meta: REPORTS_OWN_ERROR,
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: string
      payload: UserUpdatePayload
    }) => apiClient.patch(`/users/${userId}`, payload).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

/**
 * POST /users/:id/password-reset-email: OctaPM sends the person the ordinary
 * self-service reset e-mail (owner decision D-ID-1 Q4). The administrator
 * never sets or sees a password; the answer is the same for every person.
 */
export const useSendPasswordResetEmailMutation = () =>
  useMutation({
    meta: REPORTS_OWN_ERROR,
    mutationFn: (userId: string): Promise<{ sent: true }> =>
      apiClient
        .post(`/users/${userId}/password-reset-email`)
        .then((r) => r.data.data),
  })

/**
 * Inviting — and managing the invitations not yet accepted — is one gate on
 * the server: user_management submit + the user.invite transition.
 */
export const useCanInvite = () => {
  const canSubmit = useCanPerform('user_management', 'submit')
  const canInvite = useCanPerform('user_management', 'submit', 'user.invite')
  return canSubmit && canInvite
}

/** Sending the reset e-mail: user_management update + user.send_password_reset. */
export const useCanSendPasswordReset = () => {
  const canUpdate = useCanPerform('user_management', 'update')
  const canSend = useCanPerform(
    'user_management',
    'update',
    'user.send_password_reset'
  )
  return canUpdate && canSend
}

/** 429 on the reset e-mail: too many asked for recently. */
export const isRateLimited = (error: unknown) =>
  error instanceof AxiosError && error.response?.status === 429
