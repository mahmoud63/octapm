import { AxiosError } from 'axios'
import { getServerErrorMessage } from '@/lib/handle-server-error'

/**
 * A link the server no longer honours. Every new or re-sent invitation
 * replaces the earlier link (owner decision D-ID-1), and a revoked, expired
 * or accepted one stops working — so the way forward is the newest e-mail,
 * or a new invitation.
 */
export const REFUSED_INVITATION_MESSAGE =
  'This invitation link no longer works. It may have expired, been revoked, been accepted already, or been replaced by a newer invitation. Open the link in the newest invitation e-mail you received, or ask your administrator to send a new one.'

const REFUSED_CODES = new Set(['INVITATION_TOKEN_INVALID', 'INVITATION_OFFER_CHANGED'])

/** The sentence a failed acceptance shows. */
export const acceptInvitationErrorMessage = (error: unknown) => {
  const code =
    error instanceof AxiosError
      ? (error.response?.data as { error?: { code?: string } } | undefined)
          ?.error?.code
      : undefined
  if (code && REFUSED_CODES.has(code)) return REFUSED_INVITATION_MESSAGE
  return getServerErrorMessage(error, 'Unable to accept invitation.')
}
