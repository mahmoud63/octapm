/**
 * Offline, wired together: the outbox drains when the signal returns and
 * when the app comes to the front; the read cache is restored for the
 * person who signs in and written as it changes; everything goes with the
 * session. The session module calls in at sign-in, at a lost session and
 * at sign-out; the root layout calls `startOffline` once.
 */
import { AppState, type AppStateStatus } from 'react-native'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { adoptOutboxOwner, drainOutbox, hydrateOutbox, lockOutbox, wipeOutbox } from '@/offline/outbox'
import { clearPersistedCache, restoreQueryCache, startQueryPersistence } from '@/offline/persist'
import { registerSenders } from '@/offline/senders'

let started = false
let stopPersistence: (() => void) | null = null
let owner: string | null = null

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

/** The person is signed in: their cache comes back, their queue is theirs, the drain may run. */
export async function offlineSessionStarted(userId: string) {
  if (owner !== userId) {
    stopPersistence?.()
    owner = userId
    await restoreQueryCache(queryClient, userId)
    stopPersistence = startQueryPersistence(queryClient, userId)
  }
  await adoptOutboxOwner(userId)
}

/** The session was refused: keep the queue, stop sending until the same person is back. */
export function offlineSessionLost() {
  lockOutbox()
}

/** Sign-out: nothing of the person stays on the device. */
export async function offlineSessionEnded() {
  stopPersistence?.()
  stopPersistence = null
  const previous = owner
  owner = null
  await Promise.all([wipeOutbox(), clearPersistedCache(previous)])
}

export function __resetOfflineForTests() {
  stopPersistence?.()
  stopPersistence = null
  owner = null
  started = false
}
