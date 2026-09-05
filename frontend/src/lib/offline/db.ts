/**
 * Minimal promise wrapper over IndexedDB for the offline outbox. Two stores:
 * `outbox` (queued writes) and `idmap` (temporary id → server id).
 */

const DB_NAME = 'octapm-offline'
const DB_VERSION = 1

export type StoreName = 'outbox' | 'idmap'

let dbPromise: Promise<IDBDatabase> | null = null

export const indexedDbAvailable = () =>
  typeof indexedDB !== 'undefined' && indexedDB !== null

export const openDb = () => {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (!indexedDbAvailable()) {
        reject(new Error('IndexedDB is not available'))
        return
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('idmap')) {
          db.createObjectStore('idmap', { keyPath: 'tempId' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('IndexedDB open blocked'))
    })
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

const run = async <T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (objectStore: IDBObjectStore) => IDBRequest<T>
) => {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const request = fn(transaction.objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const dbGetAll = <T>(store: StoreName) =>
  run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
export const dbGet = <T>(store: StoreName, key: string) =>
  run<T | undefined>(
    store,
    'readonly',
    (s) => s.get(key) as IDBRequest<T | undefined>
  )
export const dbPut = <T>(store: StoreName, value: T) =>
  run<IDBValidKey>(store, 'readwrite', (s) => s.put(value))
export const dbDelete = (store: StoreName, key: string) =>
  run<undefined>(store, 'readwrite', (s) => s.delete(key))
export const dbClear = (store: StoreName) =>
  run<undefined>(store, 'readwrite', (s) => s.clear())
