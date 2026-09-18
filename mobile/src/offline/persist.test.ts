import { QueryClient } from '@tanstack/react-query'
import { clearPersistedCache, isPersistable, restoreQueryCache, startQueryPersistence } from '@/offline/persist'
import { __useStoreForTests, memoryStore, type KeyValueStore } from '@/offline/storage'

let store: KeyValueStore

beforeEach(() => {
  store = memoryStore()
  __useStoreForTests(store)
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

afterAll(() => __useStoreForTests(null))

describe('the read cache on disk', () => {
  it('knows which answers are worth keeping', () => {
    expect(isPersistable(['project', 'p1', 'rfis'])).toBe(true)
    expect(isPersistable(['projects'])).toBe(true)
    expect(isPersistable(['search', 'excav'])).toBe(false)
    expect(isPersistable(['inventory', 'scan', 'CEM'])).toBe(false)
    expect(isPersistable(['workflow', 'my-steps'])).toBe(false)
  })

  it('writes settled answers a moment after they change and reads them back for the same person', async () => {
    const client = new QueryClient()
    const stop = startQueryPersistence(client, 'u1')
    client.setQueryData(['project', 'p1', 'rfis'], [{ id: 'r1', title: 'Founding level' }])
    client.setQueryData(['search', 'x'], [{ id: 'nope' }])
    jest.advanceTimersByTime(2_000)
    await Promise.resolve()
    await Promise.resolve()
    const raw = await store.get('cache:v1:u1')
    expect(raw).toBeTruthy()
    expect(raw).toContain('Founding level')
    expect(raw).not.toContain('nope')
    stop()

    const fresh = new QueryClient()
    expect(await restoreQueryCache(fresh, 'u1')).toBe(1)
    expect(fresh.getQueryData(['project', 'p1', 'rfis'])).toEqual([{ id: 'r1', title: 'Founding level' }])
    expect(await restoreQueryCache(new QueryClient(), 'u2')).toBe(0)
  })

  it('goes with the session', async () => {
    await store.set('cache:v1:u1', '{"queries":[]}')
    await store.set('cache:v1:u2', '{"queries":[]}')
    await clearPersistedCache('u1')
    expect(await store.get('cache:v1:u1')).toBeNull()
    expect(await store.get('cache:v1:u2')).toBeNull()
  })
})
