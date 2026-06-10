import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const authStore = read('src/stores/auth-store.ts')
const apiClient = read('src/services/api/client.ts')
const authTypes = read('src/services/auth/types.ts')
const authApi = read('src/services/auth/api.ts')
const signInForm = read('src/features/auth/sign-in/components/user-auth-form.tsx')
const signUpForm = read('src/features/auth/sign-up/components/sign-up-form.tsx')
const signOutDialog = read('src/components/sign-out-dialog.tsx')

assert.ok(
  !authStore.includes('pmc_access_token') &&
    !authStore.includes('pmc_refresh_token') &&
    !authStore.includes('setCookie('),
  'auth store must not persist access or refresh tokens in JavaScript-accessible cookies'
)

assert.ok(
  authStore.includes('accessToken: string') &&
    authStore.includes('setSession: (user: AuthUser, accessToken: string)'),
  'auth store keeps only the short-lived access token in memory'
)

assert.ok(
  !authStore.includes('refreshToken: string') &&
    !authTypes.includes('refreshToken: string'),
  'frontend auth state and API types must not model a JavaScript-readable refresh token'
)

assert.ok(
  apiClient.includes('withCredentials: true'),
  'axios clients must send and receive the httpOnly refresh cookie'
)

assert.ok(
  apiClient.includes("authlessClient.post<") &&
    apiClient.includes("('/auth/refresh'") &&
    !apiClient.includes('refreshToken: auth.refreshToken'),
  'refresh requests must rely on the httpOnly cookie instead of a request body token'
)

assert.ok(
  signInForm.includes('auth.setSession(session.user, session.tokens.accessToken)'),
  'sign-in stores only the access token returned by the API'
)

assert.ok(
  signUpForm.includes('auth.setSession(result.user, result.tokens.accessToken)'),
  'sign-up stores only the access token returned by the API'
)

assert.ok(
  authApi.includes('logout') && signOutDialog.includes('await logout()'),
  'sign-out revokes the server-side refresh session before clearing local state'
)

console.log('Auth token storage assertions passed')
