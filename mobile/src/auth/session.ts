/**
 * The session: signing in, staying in, switching workspace, and leaving.
 *
 * Sign-in exchanges credentials for an access token and a refresh token. The
 * access token stays in memory; the refresh token goes to the keychain. On a
 * cold start the keychain is consulted, the refresh token is presented to the
 * server, and only if the server still honours it does the app open. Biometric
 * unlock sits in front of that exchange, not instead of it.
 *
 * The server rotates refresh tokens and revokes the family on reuse, so a
 * token is used exactly once: whatever comes back replaces it immediately.
 *
 * A session is bound to one workspace (membership doc §6). A sign-in with a
 * single workspace answers tokens as it always did; with several it answers
 * an identity token and the list, and the person chooses — or the workspace
 * they last worked in on this device is entered for them. Switching later is
 * one sequence, `switchWorkspace`, that the switching doc §3 lays out.
 */
import { api, bindTokenSource, run } from '@/api/client'
import { AppError, isAppError } from '@/api/errors'
import { forgetEverything, queryClient } from '@/api/query'
import { offlineSessionEnded, offlineSessionLost, offlineSessionStarted, offlineSwitchBegan } from '@/offline'
import { registerPushDevice, unregisterPushDevice } from '@/notifications/push'
import { clearPersistedCache } from '@/offline/persist'
import { analytics } from '@/analytics'
import { promptBiometric } from '@/auth/biometric'
import { STORAGE_KEYS, secureStorage } from '@/auth/secure-storage'
import { useProjectStore } from '@/projects/store'
import { useAuthStore, workspaceFromUser, type SessionUser, type WorkspaceMembership } from '@/auth/store'
import { log } from '@/utilities/logger'

interface TokenPayload {
  accessToken: string
  expiresIn: number
  refreshToken?: string
  refreshTokenExpiresAt?: string
}

interface AuthResult {
  user: SessionUser
  tokens: TokenPayload
  /** Sent by a workspace session (POST /auth/workspaces/:orgId/session); a plain login names the workspace through the user. */
  workspace?: WorkspaceMembership | null
  memberships?: WorkspaceMembership[] | null
}

/** A login that proved the identity but has no single workspace to enter (membership doc §6). */
interface LoginChoice {
  chooseWorkspace?: boolean
  needsWorkspace?: boolean
  identityToken: string
  memberships?: WorkspaceMembership[]
}

type LoginResponse = AuthResult | LoginChoice

export type SignInOutcome =
  | { kind: 'signedIn' }
  /** The person belongs to several workspaces: the chooser screen takes over (auth store `pendingChoice`). */
  | { kind: 'chooseWorkspace'; memberships: WorkspaceMembership[] }
  /** The identity exists but has no workspace it can enter; the app has nothing to show. */
  | { kind: 'noWorkspace' }

/** The profile kept on the device for an offline start: the user and the workspace they were in. Never a token. */
interface StoredProfile extends SessionUser {
  workspace?: WorkspaceMembership | null
}

let refreshing: Promise<string | null> | null = null

const store = () => useAuthStore.getState()

const isChoice = (result: LoginResponse): result is LoginChoice => 'identityToken' in result && !('tokens' in result)

async function keepRefreshToken(payload: TokenPayload | undefined) {
  if (payload?.refreshToken) await secureStorage.set(STORAGE_KEYS.refreshToken, payload.refreshToken)
}

async function rememberProfile(user: SessionUser, workspace: WorkspaceMembership | null) {
  const profile: StoredProfile = { ...user, workspace }
  await secureStorage.set(STORAGE_KEYS.profile, JSON.stringify(profile))
}

async function lastKnownProfile(): Promise<StoredProfile | null> {
  const raw = await secureStorage.get(STORAGE_KEYS.profile)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredProfile
  } catch {
    return null
  }
}

// ── The last workspace, per identity ──

interface LastWorkspace {
  identity: string
  orgId: string
}

const identityKey = (email: string) => email.trim().toLowerCase()

/** The workspace this identity last worked in on this device, or null. Another identity's hint is never used. */
export async function rememberedWorkspace(email: string): Promise<string | null> {
  const raw = await secureStorage.get(STORAGE_KEYS.lastWorkspace).catch(() => null)
  if (!raw) return null
  try {
    const hint = JSON.parse(raw) as LastWorkspace
    return hint.identity === identityKey(email) ? hint.orgId : null
  } catch {
    return null
  }
}

async function rememberWorkspace(email: string, orgId: string) {
  const hint: LastWorkspace = { identity: identityKey(email), orgId }
  await secureStorage.set(STORAGE_KEYS.lastWorkspace, JSON.stringify(hint)).catch(() => undefined)
}

/** The workspace a session result puts the person in: named by the result, listed by their memberships, or derived from the user. */
const workspaceOf = (result: AuthResult): WorkspaceMembership => result.workspace ?? workspaceFromUser(result.user, result.memberships ?? result.user.memberships)

async function applyResult(result: AuthResult, method: 'password' | 'biometric' | 'restored') {
  await keepRefreshToken(result.tokens)
  const workspace = workspaceOf(result)
  const memberships = result.memberships ?? result.user.memberships ?? null
  await rememberProfile(result.user, workspace)
  store().setSignedIn(result.user, result.tokens.accessToken, result.tokens.expiresIn, { workspace, memberships })
  await secureStorage.set(STORAGE_KEYS.lastEmail, result.user.email)
  await rememberWorkspace(result.user.email, workspace.orgId)
  analytics.track({ name: 'mobile_login', method })
  // A project remembered in another workspace is not this session's.
  await useProjectStore.getState().ensureWorkspace(workspace.orgId)
  // The read cache and the outbox belong to this person in this workspace; a different person's queue is discarded here.
  await offlineSessionStarted(result.user.id, workspace.orgId).catch((error) => log.warn('sync', 'offline data could not be attached to the session', { message: String(error) }))
  // Push registration never holds sign-in up and never fails it.
  void registerPushDevice()
  // A plain login names no memberships; the list for the switcher arrives behind the screen.
  if (!memberships) void refreshWorkspaces()
}

/**
 * Trade the stored refresh token for a new pair. Shared, so that ten requests
 * hitting a 401 together cause one refresh, not ten.
 */
export function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const stored = await secureStorage.get(STORAGE_KEYS.refreshToken)
    if (!stored) return null
    try {
      const result = await run<AuthResult>(
        () => api.POST('/auth/refresh', { body: { refreshToken: stored } as never }) as never,
        { retryOnUnauthorized: false }
      )
      await keepRefreshToken(result.tokens)
      const current = store()
      // A refresh answers the user alone. After a restart the workspace the
      // device last knew — named, with its handle — is the one to show while
      // GET /auth/me catches up, provided the token is still bound to it.
      const derived = workspaceOf(result)
      const known = current.workspace ? null : (await lastKnownProfile())?.workspace
      const workspace = current.workspace ?? (known && known.orgId === derived.orgId ? known : derived)
      if (result.user) await rememberProfile(result.user, workspace)
      if (current.status === 'signedIn' || current.status === 'booting' || current.status === 'locked') {
        if (current.user) current.setAccessToken(result.tokens.accessToken, result.tokens.expiresIn)
        else current.setSignedIn(result.user, result.tokens.accessToken, result.tokens.expiresIn, { workspace })
      }
      return result.tokens.accessToken
    } catch (error) {
      if (isAppError(error) && (error.code === 'AUTH_REQUIRED' || error.code === 'FORBIDDEN')) {
        log.info('auth', 'refresh refused; session is over', { code: error.code, serverCode: error.serverCode })
        await endLocally(error.code === 'FORBIDDEN' ? 'revoked' : 'expired')
        return null
      }
      // Offline or a server hiccup: keep the session, keep the token, try later.
      log.warn('auth', 'refresh failed transiently', { message: String(error) })
      throw error
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

async function endLocally(reason: 'user' | 'expired' | 'revoked') {
  const userId = store().user?.id ?? null
  forgetEverything()
  // Sign-out takes the outbox with it; a refused session keeps the queue locked for the same person, but the cached records go.
  if (reason === 'user') await offlineSessionEnded().catch(() => undefined)
  else {
    offlineSessionLost()
    await clearPersistedCache(userId).catch(() => undefined)
  }
  await useProjectStore.getState().clear()
  const removals = [secureStorage.remove(STORAGE_KEYS.refreshToken), secureStorage.remove(STORAGE_KEYS.profile)]
  // Signing out forgets the workspace hint too; a refused session keeps it for the same person's next sign-in.
  if (reason === 'user') removals.push(secureStorage.remove(STORAGE_KEYS.lastWorkspace))
  await Promise.all(removals)
  store().setSignedOut(reason)
  if (reason !== 'user') analytics.track({ name: 'mobile_logout' })
}

/**
 * The workspace-bound session for one of the identity's workspaces
 * (workspace switching doc §2). With an identity token — from a sign-in
 * that returned several workspaces — it completes that sign-in; without one
 * the session's own access token is presented.
 */
async function requestWorkspaceSession(orgId: string, identityToken?: string): Promise<AuthResult> {
  return run<AuthResult>(
    () =>
      api.POST('/auth/workspaces/{orgId}/session' as never, {
        params: { path: { orgId } },
        ...(identityToken ? { headers: { Authorization: `Bearer ${identityToken}` } } : {}),
      } as never) as never,
    { retryOnUnauthorized: !identityToken }
  )
}

export async function signIn(email: string, password: string): Promise<SignInOutcome> {
  const result = await run<LoginResponse>(
    () => api.POST('/auth/login', { body: { email, password } as never }) as never,
    { retryOnUnauthorized: false }
  )
  if (!isChoice(result)) {
    await applyResult(result, 'password')
    return { kind: 'signedIn' }
  }
  const memberships = result.memberships ?? []
  const enterable = memberships.filter((m) => m.status === 'active')
  if (result.needsWorkspace || enterable.length === 0) return { kind: 'noWorkspace' }
  // The workspace this person last worked in on this device is entered
  // without asking, as the web remembers it; anything else is asked.
  const remembered = await rememberedWorkspace(email)
  if (remembered && enterable.some((m) => m.orgId === remembered)) {
    await enterWorkspace(remembered, result.identityToken)
    return { kind: 'signedIn' }
  }
  store().setPendingChoice({ identity: identityKey(email), identityToken: result.identityToken, memberships })
  return { kind: 'chooseWorkspace', memberships }
}

/** Complete a sign-in that returned several workspaces: the chosen one becomes the session. */
export async function enterWorkspace(orgId: string, identityToken?: string): Promise<void> {
  const token = identityToken ?? store().pendingChoice?.identityToken
  if (!token) throw new AppError('AUTH_REQUIRED')
  const result = await requestWorkspaceSession(orgId, token)
  await applyResult(result, 'password')
}

/** The chooser was left without choosing: nothing was signed in, nothing is kept. */
export function abandonWorkspaceChoice() {
  store().setPendingChoice(null)
}

/** Refresh the identity's workspace list and the active membership from GET /auth/me. Never fails the session. */
export async function refreshWorkspaces(): Promise<void> {
  try {
    const me = await run<SessionUser>(() => api.GET('/auth/me') as never)
    const current = store()
    if (current.status !== 'signedIn' || current.switching) return
    const workspace = workspaceFromUser(me, me.memberships)
    current.setWorkspace(workspace, me.memberships ?? [])
    if (current.user) await rememberProfile(current.user, workspace)
  } catch (error) {
    log.debug('auth', 'workspace list not refreshed', { message: String(error) })
  }
}

/**
 * Switch the session to another workspace of the same identity, in the
 * order the switching doc §3 gives, and as one step from the person's point
 * of view: nothing of the old workspace is fetched, sent or shown once the
 * switch has begun, and nothing of the new one until it has completed.
 *
 *   1. freeze — `switching` stops queries; the realtime socket disconnects
 *      and forgets its rooms (realtime/index follows the store);
 *   2. the outbox holds still; the previous workspace's items are kept,
 *      never wiped, and are not replayed under the new token (§18);
 *   3. new tokens bound to the target membership;
 *   4. in-flight answers are cancelled and the query cache emptied;
 *   5. the active project is cleared — a project belongs to one workspace;
 *   6. the session is the new workspace's: profile, hint, cache document
 *      and outbox owner `userId:orgId` (its own items replay now);
 *   7. unfreeze — the socket reconnects with the new token.
 *
 * A failed switch leaves the previous session exactly as it was.
 */
export async function switchWorkspace(orgId: string): Promise<void> {
  const current = store()
  if (current.status !== 'signedIn' || !current.user) throw new AppError('AUTH_REQUIRED')
  const previous = current.workspace
  if (previous?.orgId === orgId) return
  if (current.switching) throw new AppError('CONFLICT', { message: 'A workspace switch is already in progress.' })
  const userId = current.user.id
  current.setSwitching(true)
  offlineSwitchBegan()
  try {
    const result = await requestWorkspaceSession(orgId)
    const workspace = workspaceOf(result)
    // Nothing in flight under the old token may land once the new one is in:
    // the answers are dropped before the token changes, and the cache goes
    // right after it, in the same tick.
    await queryClient.cancelQueries()
    await keepRefreshToken(result.tokens)
    await rememberProfile(result.user, workspace)
    // The freeze flag stays up through this: setSignedIn does not touch it.
    store().setSignedIn(result.user, result.tokens.accessToken, result.tokens.expiresIn, { workspace, memberships: result.memberships ?? null })
    forgetEverything()
    await useProjectStore.getState().clear()
    await rememberWorkspace(result.user.email, workspace.orgId)
    await offlineSessionStarted(userId, workspace.orgId).catch((error) => log.warn('sync', 'offline data could not be attached after the switch', { message: String(error) }))
    log.info('auth', 'workspace switched', { from: previous?.orgId ?? null, to: workspace.orgId })
    if (!result.memberships) void refreshWorkspaces()
  } catch (error) {
    // The previous workspace stays the session: its queue is its own again.
    if (previous) await offlineSessionStarted(userId, previous.orgId).catch(() => undefined)
    throw error
  } finally {
    store().setSwitching(false)
  }
}

export async function signOut(): Promise<void> {
  const stored = await secureStorage.get(STORAGE_KEYS.refreshToken)
  // While the session can still be presented, take this device off the person's push list.
  await unregisterPushDevice().catch(() => undefined)
  try {
    if (stored) await run(() => api.POST('/auth/logout', { body: { refreshToken: stored } as never }) as never, { retryOnUnauthorized: false })
  } catch (error) {
    // The server may be unreachable; the local session ends regardless.
    log.warn('auth', 'logout call failed; ending locally', { message: String(error) })
  }
  analytics.track({ name: 'mobile_logout' })
  await endLocally('user')
}

/** On launch: is there a session to resume, and is it still honoured? */
export async function bootstrap(): Promise<void> {
  const [stored, biometric] = await Promise.all([secureStorage.get(STORAGE_KEYS.refreshToken), secureStorage.get(STORAGE_KEYS.biometricUnlock)])
  store().setBiometricEnabled(biometric === 'on')
  if (!stored) {
    store().setSignedOut(null)
    return
  }
  if (biometric === 'on') {
    store().setLocked()
    return
  }
  await resume('restored')
}

async function resume(method: 'biometric' | 'restored') {
  try {
    const token = await refreshSession()
    if (!token) return
    const me = await run<SessionUser>(() => api.GET('/auth/me') as never, { retryOnUnauthorized: false })
    const workspace = workspaceFromUser(me, me.memberships)
    const current = store()
    current.setUser(me)
    current.setWorkspace(workspace, me.memberships ?? [])
    await rememberProfile(me, workspace)
    await rememberWorkspace(me.email, workspace.orgId)
    await useProjectStore.getState().ensureWorkspace(workspace.orgId)
    // A resumed session owns the same outbox and read cache a password sign-in does.
    await offlineSessionStarted(me.id, workspace.orgId).catch((error) => log.warn('sync', 'offline data could not be attached to the resumed session', { message: String(error) }))
    void registerPushDevice()
    analytics.track({ name: 'mobile_login', method })
  } catch (error) {
    if (isAppError(error) && error.retryable) {
      // Offline at launch with a saved session: open with what is cached. The
      // next successful request will refresh; a refusal then ends the session.
      const current = store()
      const profile = current.user ? { ...current.user, workspace: current.workspace } : await lastKnownProfile()
      if (profile) {
        const { workspace: stored, ...user } = profile
        const workspace = stored ?? workspaceFromUser(user)
        current.setSignedIn(user, current.accessToken ?? '', 0, { workspace })
        await useProjectStore.getState().ensureWorkspace(workspace.orgId)
        // Without a signal this is the only way the cached records reach the screens.
        await offlineSessionStarted(user.id, workspace.orgId).catch(() => undefined)
        log.info('auth', 'opened offline with the last known session')
      } else {
        // Nothing is known about this person yet; the token stays for next time.
        current.setSignedOut(null)
      }
      return
    }
    if (!isAppError(error)) throw error
  }
}

export async function unlock(): Promise<boolean> {
  const passed = await promptBiometric()
  if (!passed) return false
  store().setBooting()
  await resume('biometric')
  return store().status === 'signedIn'
}

export async function setBiometricUnlock(enabled: boolean): Promise<void> {
  if (enabled) await secureStorage.set(STORAGE_KEYS.biometricUnlock, 'on')
  else await secureStorage.remove(STORAGE_KEYS.biometricUnlock)
  store().setBiometricEnabled(enabled)
}

/** Ends the session when the server has said so, wherever that happened. */
export async function sessionLost(): Promise<void> {
  if (store().status === 'signedOut') return
  await endLocally('expired')
}

bindTokenSource({
  accessToken: () => store().accessToken,
  hasSession: () => store().status === 'signedIn',
  refresh: refreshSession,
  onSessionLost: () => {
    void sessionLost()
  },
})

export { AppError }
