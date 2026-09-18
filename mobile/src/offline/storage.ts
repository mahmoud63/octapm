/**
 * Where offline data lives: a key-value table in the app's SQLite database
 * on a device (encrypted at rest by the OS, excluded from backups by the
 * app config), the browser's local storage on the web target, and memory
 * in tests. Never a token, never a password: those stay in the secure
 * store. See the offline policy, section 6.
 */
import { Platform } from 'react-native'

export interface KeyValueStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  keys(prefix: string): Promise<string[]>
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>()
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value)
    },
    remove: async (key) => {
      map.delete(key)
    },
    keys: async (prefix) => [...map.keys()].filter((k) => k.startsWith(prefix)),
  }
}

function webStore(): KeyValueStore {
  const storage = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage
    } catch {
      return null
    }
  }
  const NS = 'octapm.offline.'
  return {
    get: async (key) => storage()?.getItem(NS + key) ?? null,
    set: async (key, value) => {
      try {
        storage()?.setItem(NS + key, value)
      } catch {
        // Quota or private mode: the read cache is a convenience, the outbox is retried from memory.
      }
    },
    remove: async (key) => {
      storage()?.removeItem(NS + key)
    },
    keys: async (prefix) => {
      const s = storage()
      if (!s) return []
      const out: string[] = []
      for (let i = 0; i < s.length; i += 1) {
        const k = s.key(i)
        if (k && k.startsWith(NS + prefix)) out.push(k.slice(NS.length))
      }
      return out
    },
  }
}

interface SqliteLike {
  execAsync(sql: string): Promise<void>
  runAsync(sql: string, ...params: (string | number)[]): Promise<unknown>
  getFirstAsync<T>(sql: string, ...params: (string | number)[]): Promise<T | null>
  getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]>
}

function sqliteStore(): KeyValueStore {
  let opening: Promise<SqliteLike> | null = null
  const db = () => {
    if (!opening) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sqlite = require('expo-sqlite') as { openDatabaseAsync: (name: string) => Promise<SqliteLike> }
      opening = sqlite.openDatabaseAsync('octapm-offline.db').then(async (handle) => {
        await handle.execAsync('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)')
        return handle
      })
    }
    return opening
  }
  return {
    get: async (key) => (await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key))?.value ?? null,
    set: async (key, value) => {
      await (await db()).runAsync('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)', key, value, Date.now())
    },
    remove: async (key) => {
      await (await db()).runAsync('DELETE FROM kv WHERE key = ?', key)
    },
    keys: async (prefix) => (await (await db()).getAllAsync<{ key: string }>('SELECT key FROM kv WHERE key LIKE ?', `${prefix}%`)).map((r) => r.key),
  }
}

let current: KeyValueStore | null = null

/** The store for this platform, opened on first use. */
export function offlineStore(): KeyValueStore {
  if (!current) current = Platform.OS === 'web' ? webStore() : sqliteStore()
  return current
}

/** Tests swap in a memory store; the app never calls this. */
export function __useStoreForTests(store: KeyValueStore | null) {
  current = store
}
