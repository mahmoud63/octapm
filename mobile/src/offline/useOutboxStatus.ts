import { useEffect, useState } from 'react'
import { network } from '@/api/network'
import { outboxCounts, useOutbox } from '@/offline/outbox'

/**
 * Whether the device is offline and how much is waiting, for badges and the
 * bar — in the workspace the session is in. What waits in another workspace
 * of the same person is counted apart (`elsewhere`): it goes when that
 * workspace is active again, and a badge must not promise to send it now.
 */
export function useOutboxStatus(projectId?: string | null) {
  const items = useOutbox((s) => s.items)
  const locked = useOutbox((s) => s.locked)
  const draining = useOutbox((s) => s.draining)
  const activeOrgId = useOutbox((s) => s.activeOrgId)
  const [offline, setOffline] = useState(network.isKnownOffline())
  useEffect(() => network.subscribe(() => setOffline(network.isKnownOffline())), [])
  return { offline, locked, draining, activeOrgId, ...outboxCounts(items, projectId, activeOrgId) }
}
