import { useSyncExternalStore } from 'react'
import {
  getOutboxState,
  subscribeOutbox,
  type OutboxState,
} from '@/lib/offline/outbox'

const subscribeOnline = (listener: () => void) => {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** True while the browser reports a network connection. */
export const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  )

/** Live view of the offline outbox. */
export const useOutbox = (): OutboxState =>
  useSyncExternalStore(subscribeOutbox, getOutboxState, getOutboxState)
