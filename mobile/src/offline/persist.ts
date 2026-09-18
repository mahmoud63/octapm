/**
 * The read cache, kept across launches so a screen the person has seen
 * draws at once without a signal, marked with its age. Only settled
 * answers are written; searches, scans and the approvals inbox are not,
 * since they are momentary. The whole cache is one document under the
 * person's id, written a little after it changes and never past a budget.
 */
import { dehydrate, hydrate, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { offlineStore } from '@/offline/storage'
import { log } from '@/utilities/logger'

const BUDGET_BYTES = 4 * 1024 * 1024
const DEBOUNCE_MS = 1_500
const EXCLUDED_HEADS = new Set(['search'])
const EXCLUDED_PAIRS: [string, string][] = [
  ['inventory', 'scan'],
  ['workflow', 'my-steps'],
]

const cacheKey = (userId: string) => `cache:v1:${userId}`

export const isPersistable = (queryKey: QueryKey): boolean => {
  const [head, second] = queryKey as [unknown, unknown]
  if (typeof head !== 'string') return false
  if (EXCLUDED_HEADS.has(head)) return false
  return !EXCLUDED_PAIRS.some(([a, b]) => head === a && second === b)
}

/** Put back what was saved for this person. Older entries look stale to the cache and refresh behind the screen. */
export async function restoreQueryCache(client: QueryClient, userId: string): Promise<number> {
  try {
    const raw = await offlineStore().get(cacheKey(userId))
    if (!raw) return 0
    const state = JSON.parse(raw) as { queries?: unknown[] }
    hydrate(client, state as never)
    return state.queries?.length ?? 0
  } catch (error) {
    log.warn('sync', 'could not restore the read cache', { message: String(error) })
    return 0
  }
}

/** Write the cache whenever it settles, within the budget; returns a stop function. */
export function startQueryPersistence(client: QueryClient, userId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const write = async () => {
    timer = null
    try {
      const state = dehydrate(client, { shouldDehydrateQuery: (q) => q.state.status === 'success' && isPersistable(q.queryKey) })
      let json = JSON.stringify(state)
      // Over budget: drop the largest answers until it fits; the outbox never competes with this.
      while (json.length > BUDGET_BYTES && state.queries.length) {
        state.queries.sort((a, b) => JSON.stringify(b.state.data ?? null).length - JSON.stringify(a.state.data ?? null).length)
        state.queries.shift()
        json = JSON.stringify(state)
      }
      await offlineStore().set(cacheKey(userId), json)
    } catch (error) {
      log.warn('sync', 'could not persist the read cache', { message: String(error) })
    }
  }
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' && event.type !== 'removed' && event.type !== 'added') return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void write(), DEBOUNCE_MS)
  })
  return () => {
    unsubscribe()
    if (timer) clearTimeout(timer)
  }
}

export async function clearPersistedCache(userId?: string | null) {
  if (userId) await offlineStore().remove(cacheKey(userId))
  for (const key of await offlineStore().keys('cache:v1:')) await offlineStore().remove(key)
}
