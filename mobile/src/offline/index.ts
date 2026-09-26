/**
 * Offline, wired together: the outbox drains when the signal returns and
 * when the app comes to the front; the read cache is restored for the
 * person who signs in and written as it changes; everything goes with the
 * session. The session module calls in at sign-in, at a lost session, at a
 * workspace switch and at sign-out; the root layout calls `startOffline` once.
 *
 * Both the cache and the queue are owned per person and workspace
 * (`userId:orgId`, workspace switching doc §3-§4): a switch restores the
 * target workspace's cache document and adopts the queue under the new
 * owner key, so the previous workspace's items stay put and its cache stays
 * on disk for when it is active again.
 */
import { AppState, type AppStateStatus } from 'react-native'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { adoptOutboxOwner, drainOutbox, hydrateOutbox, lockOutbox, ownerKeyOf, wipeOutbox } from '@/offline/outbox'
import { clearPersistedCache, restoreQueryCache, startQueryPersistence } from '@/offline/persist'
import { registerSenders } from '@/offline/senders'

let started = false
let stopPersistence: (() => void) | null = null
let owner: string | null = null
let ownerUserId: string | null = null

export function startOffline(): () => void {
  if (started) return () => undefined
  started = true
  registerSenders()
  void hydrateOutbox()
  const stopNetwork = network.subscribe((online) => {
    if (online) void drainOutbox('online')
  })
  const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') void drainOutbox('foreground')
  })
  return () => {
    stopNetwork()
    sub.remove()
    started = false
  }
}

/**
 * The person is signed in, in a workspace: that workspace's cache comes
 * back, the queue is theirs under `userId:orgId`, the drain may run for
 * that workspace's items. `legacyOrgId` is the workspace a queue from the
 * version before workspaces was captured in, when the device can tell.
 */
export async function offlineSessionStarted(userId: string, orgId: string, legacyOrgId: string | null = null) {
  const key = ownerKeyOf(userId, orgId)
  if (owner !== key) {
    stopPersistence?.()
    owner = key
    ownerUserId = userId
    await restoreQueryCache(queryClient, userId, orgId)
    stopPersistence = startQueryPersistence(queryClient, userId, orgId)
  }
  await adoptOutboxOwner(userId, orgId, legacyOrgId)
}

/**
 * A switch has begun: the previous workspace's cache document stops being
 * written and the queue holds still until the new session adopts it (step 3
 * of the switch). Nothing is wiped — the items of the workspace being left
 * are its own and wait for it.
 */
export function offlineSwitchBegan() {
  stopPersistence?.()
  stopPersistence = null
  owner = null
  lockOutbox()
}

/** The session was refused: keep the queue, stop sending until the same person is back. */
export function offlineSessionLost() {
  lockOutbox()
}

/** Sign-out: nothing of the person stays on the device, in any workspace. */
export async function offlineSessionEnded() {
  stopPersistence?.()
  stopPersistence = null
  const previous = ownerUserId
  owner = null
  ownerUserId = null
  await Promise.all([wipeOutbox(), clearPersistedCache(previous)])
}

export function __resetOfflineForTests() {
  stopPersistence?.()
  stopPersistence = null
  owner = null
  ownerUserId = null
  started = false
}
