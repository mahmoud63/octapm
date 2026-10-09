import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const forgotForm = read(
  'src/features/auth/forgot-password/components/forgot-password-form.tsx'
)
const inviteDialog = read(
  'src/features/users/components/users-invite-dialog.tsx'
)
const authApi = read('src/services/auth/api.ts')
const resetRoute = read('src/routes/(auth)/reset-password.tsx')
const acceptInviteRoute = read('src/routes/(auth)/accept-invite.tsx')
const resetForm = read(
  'src/features/auth/reset-password/components/reset-password-form.tsx'
)
const acceptInviteForm = read(
  'src/features/auth/accept-invite/components/accept-invite-form.tsx'
)

assert.ok(
  !forgotForm.includes('sleep(') && forgotForm.includes('requestPasswordReset'),
  'forgot-password form must call the backend instead of simulating delivery'
)

assert.ok(
  !inviteDialog.includes('showSubmittedData') &&
    inviteDialog.includes('useInviteUserMutation') &&
    inviteDialog.includes('projectId'),
  'user invite dialog must call the real invitation API and support project scope'
)

assert.ok(
  authApi.includes("'/auth/reset-password'") &&
    authApi.includes("'/auth/forgot-password'") &&
    authApi.includes("'/auth/invitations/accept'") &&
    authApi.includes('getInvitationPreview'),
  'auth API client must expose reset and invite acceptance endpoints'
)

assert.ok(
  resetRoute.includes('/(auth)/reset-password') &&
    resetForm.includes('resetPassword({ token'),
  'reset-password route must submit the one-time token to the backend'
)

assert.ok(
  acceptInviteRoute.includes('/(auth)/accept-invite') &&
    acceptInviteForm.includes('setSession(session.user') &&
    acceptInviteForm.includes('invitation.requiresPassword'),
  'accept-invite route must accept invitations and establish a normal session'
)

// Owner decision L38: an e-mail that already has an account accepts with its
// own session — the form signs it in (password, then the second factor) and
// accepts with that bearer; the password is never sent as proof.
assert.ok(
  acceptInviteForm.includes('invitation.requiresSignIn') &&
    acceptInviteForm.includes('verifyMfa(') &&
    acceptInviteForm.includes('acceptInvitation({ token }, bearer') &&
    authApi.includes('Authorization: `Bearer ${options.bearer}`'),
  'accept-invite must sign an existing account in and accept with its own session'
)

// ── Owner decision D-ID-1: adding a person is always an invitation ───────
const usersHooks = read('src/features/users/hooks/use-users.ts')
const usersActionDialog = read(
  'src/features/users/components/users-action-dialog.tsx'
)
const usersProvider = read('src/features/users/components/users-provider.tsx')
const usersPrimaryButtons = read(
  'src/features/users/components/users-primary-buttons.tsx'
)
const usersRowActions = read(
  'src/features/users/components/data-table-row-actions.tsx'
)
const usersPage = read('src/features/users/index.tsx')
const pendingInvitations = read(
  'src/features/users/components/users-pending-invitations.tsx'
)
const sendResetDialog = read(
  'src/features/users/components/users-send-reset-email-dialog.tsx'
)
const securityPage = read('src/features/company/security.tsx')
const securityHooks = read('src/features/company/hooks/use-security.ts')
const acceptInvitePage = read('src/features/auth/accept-invite/index.tsx')
const acceptInviteErrors = read(
  'src/features/auth/accept-invite/invitation-errors.ts'
)
const apiClientSource = read('src/services/api/client.ts')
const mainSource = read('src/main.tsx')
const realtimeSource = read('src/lib/realtime.ts')

assert.ok(
  !usersHooks.includes("post('/users',") &&
    !usersHooks.includes('useCreateUserMutation') &&
    !/\b(password|newPassword)\??:\s*string/.test(usersHooks),
  'the web client never creates a user with a password; the add flow is the invitation'
)
assert.ok(
  !usersProvider.includes("'add'") &&
    !usersPrimaryButtons.includes("setOpen('add')") &&
    !usersPage.includes("setOpen('add')") &&
    usersPrimaryButtons.includes("setOpen('invite')"),
  'one Invite action replaces Add person and Invite by e-mail'
)
assert.ok(
  !usersActionDialog.includes('PasswordInput') &&
    !usersActionDialog.includes('confirmPassword') &&
    !usersActionDialog.includes('Person added') &&
    !usersActionDialog.includes('useCreateUserMutation'),
  'the person dialog only edits: no password fields, no "Person added" branch'
)
assert.ok(
  !/email:\s*values\.email/.test(usersActionDialog) &&
    usersActionDialog.includes('readOnly') &&
    !/payload:\s*{[^}]*email\?:/.test(usersHooks),
  'the edit dialog shows the e-mail read-only and never sends it'
)
assert.ok(
  usersActionDialog.includes('changedFields'),
  'the edit dialog sends only the fields that changed'
)
for (const code of [
  'ALREADY_MEMBER',
  'USER_PASSWORD_NOT_ACCEPTED',
  'INVITATION_EMAIL_FAILED',
  'MEMBERSHIP_WRITES_SUSPENDED',
]) {
  assert.ok(usersHooks.includes(`'${code}'`), `invitation errors handle ${code}`)
}
assert.ok(
  !usersHooks.includes('/reset-password') &&
    usersHooks.includes('/password-reset-email') &&
    usersRowActions.includes('useCanSendPasswordReset') &&
    usersHooks.includes("'user.send_password_reset'") &&
    sendResetDialog.includes('isRateLimited'),
  'the admin sends the reset e-mail (gated on user.send_password_reset, 429 handled) and never sets a password'
)
assert.ok(
  usersHooks.includes("'/users/invitations'") &&
    usersHooks.includes('/resend`') &&
    usersHooks.includes("'user.invite'") &&
    usersPage.includes('useCanInvite') &&
    usersPage.includes('UsersPendingInvitations') &&
    pendingInvitations.includes('lastDeliveryFailedAt') &&
    pendingInvitations.includes('ConfirmDialog'),
  'pending invitations are listed for inviters, with revoke (confirmed) and resend'
)
assert.ok(
  !securityPage.includes('autoProvision') &&
    !securityPage.includes('defaultRole') &&
    !/autoProvision\?:/.test(securityHooks) &&
    securityPage.includes('uat-sso-invitation-note'),
  'the SSO settings never send autoProvision and explain that people join by invitation'
)
assert.ok(
  acceptInvitePage.includes('REFUSED_INVITATION_MESSAGE') &&
    acceptInviteErrors.includes('newest invitation e-mail') &&
    acceptInviteForm.includes('acceptInvitationErrorMessage'),
  'a refused invitation link points to the newest invitation e-mail or a new invitation'
)
assert.ok(
  apiClientSource.includes("'SESSION_REVOKED'") &&
    apiClientSource.includes('sessionEndedListener?.()') &&
    mainSource.includes('onSessionEnded(') &&
    mainSource.includes('isSessionRevokedError(error)') &&
    realtimeSource.includes("'SESSION_REVOKED'"),
  'SESSION_REVOKED ends the session like an expiry: sign in again, no toast loop'
)

console.log('Auth reset and invitation UI assertions passed')
