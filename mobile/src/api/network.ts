/**
 * What the device knows about its connection.
 *
 * The platform reports connectivity changes; the request layer reports what
 * actually happened when it tried. Both feed one answer, and the answer errs
 * on the side of trying: "unknown" is treated as online, because a basement
 * with one bar is still a basement where a request might get through.
 */
import * as Network from 'expo-network'
import { Platform } from 'react-native'

type Listener = (online: boolean) => void

let known: boolean | null = null
let lastFailureAt = 0
const listeners = new Set<Listener>()

const announce = () => {
  const online = !network.isKnownOffline()
  for (const l of listeners) l(online)
}

export const network = {
  /** True only when the platform has said there is no connection and nothing has succeeded since. */
  isKnownOffline(): boolean {
    if (known === false) return true
    // A very recent failure with no platform signal: assume a flaky link, not a dead one.
    return false
  },

  /** A request got through: whatever the platform said, we are online. */
  noteSuccess() {
    if (known === false) {
      known = true
      announce()
    }
  },

  /** A request could not reach the server. Recorded, not treated as proof. */
  noteFailure() {
    lastFailureAt = Date.now()
  },

  lastFailureAt: () => lastFailureAt,

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  /** Start listening to the platform. Safe to call more than once. */
  start(): () => void {
    if (Platform.OS === 'web') {
      const on = () => {
        known = true
        announce()
      }
      const off = () => {
        known = false
        announce()
      }
      globalThis.addEventListener?.('online', on)
      globalThis.addEventListener?.('offline', off)
      known = typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : null
      return () => {
        globalThis.removeEventListener?.('online', on)
        globalThis.removeEventListener?.('offline', off)
      }
    }
    Network.getNetworkStateAsync()
      .then((state) => {
        known = state.isConnected === false ? false : true
        announce()
      })
      .catch(() => undefined)
    const sub = Network.addNetworkStateListener((state) => {
      known = state.isConnected === false ? false : true
      announce()
    })
    return () => sub.remove()
  },

  /** For tests. */
  __reset(value: boolean | null = null) {
    known = value
    lastFailureAt = 0
  },
}
