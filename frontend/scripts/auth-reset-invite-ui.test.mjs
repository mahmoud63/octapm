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

console.log('Auth reset and invitation UI assertions passed')
