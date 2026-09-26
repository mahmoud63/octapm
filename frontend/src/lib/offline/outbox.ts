import axios, { type AxiosResponse } from 'axios'
import { apiClient } from '@/services/api/client'
import {
  dbClear,
  dbDelete,
  dbGet,
  dbGetAll,
  dbPut,
  indexedDbAvailable,
} from './db'

/**
 * Offline outbox (OCTA-MOB-PWA-018). Writes made without signal are stored
 * in IndexedDB — body, form fields and files — and replayed in order when
 * the device is back online. Every item carries a `clientRequestId`, so a
 * replay that already reached the server returns the original record
 * instead of a duplicate. Items can depend on one another: a photo queued
 * for a punch item that only exists as a temporary id waits until the item
 * is created, then the temporary id is swapped for the real one.
 *
 * Conflict rule: server wins on status, client wins on drafts — an update
 * queued against a record whose status changed on the server replays without
 * its status field.
 */

export interface OutboxFile {
  field: string
  name: string
  type: string
  blob: Blob
}

export type OutboxStatus = 'queued' | 'syncing' | 'failed'

export interface OutboxItem {
  id: string
  projectId: string
  /**
   * Who queued it: `userId:orgId` (workspace switching doc §4). An item
   * replays only under the workspace it was queued in; items of another
   * workspace of the same person wait, and a different person's items are
   * wiped when they sign in on this browser.
   */
  ownerKey?: string | null
  /** Record family, for grouping and labels (punch, observation, form, attachment, daily_report, site_diary). */
  kind: string
  label: string
  method: 'POST' | 'PATCH' | 'PUT'
  /** API path (relative to the client base). May contain `{{tmp:<id>}}` placeholders. */
  url: string
  body?: Record<string, unknown> | null
  form?: Record<string, string> | null
  files?: OutboxFile[]
  clientRequestId: string
  /** Temporary id other items may reference before the server assigns one. */
  tempId?: string | null
  /** Temporary id of the item that must be created first. */
  dependsOn?: string | null
  /** Server wins on status: drop the field when the record moved on. */
  conflict?: { statusField: string; baseStatus: string } | null
  createdAt: string
  attempts: number
  lastError?: string | null
  status: OutboxStatus
}

export interface QueuedResult {
  queued: true
  outboxId: string
  clientRequestId: string
  tempId: string | null
}

export const isQueued = (value: unknown): value is QueuedResult =>
  Boolean(
    value &&
    typeof value === 'object' &&
    (value as QueuedResult).queued === true
  )

export interface OutboxState {
  /** Items of the active workspace: what replays, and what the header counts. */
  items: OutboxItem[]
  /** Items queued in another workspace of the same person: kept, shown, never replayed here. */
  locked: OutboxItem[]
  syncing: boolean
  lastSyncAt: string | null
  available: boolean
  /** `userId:orgId` of the active workspace, or null until a session is known. */
  ownerKey: string | null
}

type IdMapEntry = { tempId: string; serverId: string; at: string }

/** The owner key of a session (workspace switching doc §4). */
export const outboxOwnerKey = (userId: string, orgId: string) =>
  `${userId}:${orgId}`

const listeners = new Set<() => void>()
let state: OutboxState = {
  items: [],
  locked: [],
  syncing: false,
  lastSyncAt: null,
  available: indexedDbAvailable(),
  ownerKey: null,
}
let syncPromise: Promise<void> | null = null
let started = false
const syncedListeners = new Set<(projectIds: string[]) => void>()

const emit = () => {
  for (const listener of listeners) listener()
}
const setState = (patch: Partial<OutboxState>) => {
  state = { ...state, ...patch }
  emit()
}

export const subscribeOutbox = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const getOutboxState = () => state

export const onOutboxSynced = (listener: (projectIds: string[]) => void) => {
  syncedListeners.add(listener)
  return () => {
    syncedListeners.delete(listener)
  }
}

export const newClientRequestId = (prefix = 'req') =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`

export const tempPlaceholder = (tempId: string) => `{{tmp:${tempId}}}`

const PLACEHOLDER = /\{\{tmp:([^}]+)\}\}/g

const refreshFromDb = async () => {
  if (!state.available) return
  try {
    const all = await dbGetAll<OutboxItem>('outbox')
    all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    // Until a session is known nothing is the active workspace's, so nothing
    // replays (workspace switching doc §4, rule 3).
    const owner = state.ownerKey
    const items = owner ? all.filter((item) => item.ownerKey === owner) : []
    const locked = all.filter((item) => item.ownerKey !== owner)
    setState({ items, locked })
  } catch {
    setState({ available: false })
  }
}

export const listOutbox = async () => {
  await refreshFromDb()
  return state.items
}

/** The owner key replay currently runs for, or null while the outbox is locked. */
export const getOutboxOwner = () => state.ownerKey

/**
 * Locks the outbox: nothing replays until an owner is set again. Called at
 * the start of a workspace switch, so an item queued in the workspace being
 * left cannot be sent under the next workspace's token.
 */
export const lockOutbox = () => {
  const all = [...state.items, ...state.locked].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )
  setState({ ownerKey: null, items: [], locked: all })
}

/**
 * Sets the workspace whose items may replay (workspace switching doc §4).
 *
 * Items queued before this wave carry no owner. They were queued by whoever
 * is signed in on this browser — there was only ever one workspace — so the
 * first owner set after the upgrade claims them, once; an item that already
 * names an owner is never re-keyed. A different *person* signing in wipes
 * the queue, as the mobile app already does; a different *workspace* of the
 * same person locks the other workspace's items and leaves them in place.
 */
export const setOutboxOwner = async (ownerKey: string) => {
  if (!state.available) {
    setState({ ownerKey })
    return
  }
  const [userId] = ownerKey.split(':')
  try {
    const all = await dbGetAll<OutboxItem>('outbox')
    for (const item of all) {
      if (!item.ownerKey) {
        await dbPut('outbox', { ...item, ownerKey })
        continue
      }
      if (item.ownerKey.split(':')[0] !== userId) {
        await dbDelete('outbox', item.id)
      }
    }
  } catch {
    // storage may be unavailable; the owner still gates replay in memory
  }
  setState({ ownerKey })
  await refreshFromDb()
}

export const enqueue = async (
  input: Omit<OutboxItem, 'id' | 'createdAt' | 'attempts' | 'status'>
): Promise<QueuedResult> => {
  if (!state.available)
    throw new Error('Offline storage is not available on this device')
  if (!state.ownerKey)
    throw new Error('Offline changes need a workspace to be queued in')
  const item: OutboxItem = {
    ...input,
    ownerKey: input.ownerKey ?? state.ownerKey,
    id: newClientRequestId('outbox'),
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'queued',
    lastError: null,
  }
  await dbPut('outbox', item)
  await refreshFromDb()
  return {
    queued: true,
    outboxId: item.id,
    clientRequestId: item.clientRequestId,
    tempId: item.tempId ?? null,
  }
}

export const removeOutboxItem = async (id: string) => {
  await dbDelete('outbox', id)
  await refreshFromDb()
}

export const retryOutboxItem = async (id: string) => {
  const item = await dbGet<OutboxItem>('outbox', id)
  if (!item) return
  await dbPut('outbox', { ...item, status: 'queued', lastError: null })
  await refreshFromDb()
  void syncOutbox()
}

/**
 * Drops the service worker's API read cache. On a workspace switch this is
 * what stops the 8-second network-timeout fallback from ever serving the
 * previous workspace's lists (workspace switching doc §4, rule 6). The
 * worker is told as well, so its expiration index forgets the entries too.
 */
export const dropApiCache = async () => {
  if (typeof caches !== 'undefined') {
    await caches.delete('octapm-api').catch(() => false)
  }
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.controller?.postMessage({ type: 'DROP_API_CACHE' })
  }
}

export const clearOfflineData = async () => {
  try {
    await dbClear('outbox')
    await dbClear('idmap')
  } catch {
    // storage may be unavailable; nothing to clear
  }
  if (typeof caches !== 'undefined') {
    await Promise.all(
      ['octapm-api', 'octapm-files'].map((name) =>
        caches.delete(name).catch(() => false)
      )
    )
  }
  setState({ ownerKey: null })
  await refreshFromDb()
}

export const resolveTempId = async (tempId: string) =>
  (await dbGet<IdMapEntry>('idmap', tempId))?.serverId ?? null

const substitute = async (value: unknown): Promise<unknown> => {
  if (typeof value === 'string') {
    const matches = [...value.matchAll(PLACEHOLDER)]
    if (!matches.length) return value
    let next = value
    for (const match of matches) {
      const serverId = await resolveTempId(match[1])
      if (!serverId) throw new PendingDependencyError(match[1])
      next = next.replace(match[0], serverId)
    }
    return next
  }
  if (Array.isArray(value)) return Promise.all(value.map(substitute))
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(
        async ([key, entry]) => [key, await substitute(entry)]
      )
    )
    return Object.fromEntries(entries)
  }
  return value
}

class PendingDependencyError extends Error {
  tempId: string
  constructor(tempId: string) {
    super(`Waiting for ${tempId}`)
    this.tempId = tempId
  }
}

const isNetworkFailure = (error: unknown) =>
  axios.isAxiosError(error) && !error.response

const retriableStatus = (status: number) =>
  status === 408 || status === 429 || status >= 500

const applyConflictRule = async (item: OutboxItem, url: string) => {
  if (!item.conflict || !item.body) return item.body
  try {
    const current = await apiClient.get(url)
    const serverStatus = (
      current.data?.data as Record<string, unknown> | undefined
    )?.[item.conflict.statusField]
    if (
      serverStatus !== undefined &&
      serverStatus !== item.conflict.baseStatus
    ) {
      const { [item.conflict.statusField]: _dropped, ...rest } = item.body
      void _dropped
      return rest
    }
  } catch {
    // If we cannot read the record, send as queued.
  }
  return item.body
}

const send = async (item: OutboxItem): Promise<AxiosResponse> => {
  const url = (await substitute(item.url)) as string
  if (item.form || item.files?.length) {
    const form = new FormData()
    const fields = (await substitute(item.form ?? {})) as Record<string, string>
    for (const [key, value] of Object.entries(fields)) form.append(key, value)
    for (const file of item.files ?? []) {
      form.append(
        file.field,
        new File([file.blob], file.name, { type: file.type })
      )
    }
    return apiClient.request({
      method: item.method,
      url,
      data: form,
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120_000,
    })
  }
  const body = (await substitute(await applyConflictRule(item, url))) as Record<
    string,
    unknown
  >
  return apiClient.request({ method: item.method, url, data: body })
}

const errorText = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { error?: { message?: string } }
      | undefined
    return data?.error?.message || error.message
  }
  return error instanceof Error ? error.message : 'Failed'
}

/** Replays queued items in order; stops at the first network failure. */
export const syncOutbox = async () => {
  if (syncPromise) return syncPromise
  syncPromise = (async () => {
    if (!state.available) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    // Locked (no session, or a switch in progress): nothing is the active
    // workspace's, so nothing may go out under the current token.
    const owner = state.ownerKey
    if (!owner) return
    await refreshFromDb()
    const pending = state.items.filter(
      (item) => item.status !== 'failed' && item.ownerKey === owner
    )
    if (!pending.length) return
    setState({ syncing: true })
    const touched = new Set<string>()
    try {
      for (const item of pending) {
        // The workspace changed under a running replay: stop before an item
        // of the previous workspace is sent with the next workspace's token.
        if (state.ownerKey !== owner) break
        try {
          await dbPut('outbox', { ...item, status: 'syncing' })
          const response = await send(item)
          const created = response.data?.data as { id?: string } | undefined
          if (item.tempId && created?.id) {
            await dbPut<IdMapEntry>('idmap', {
              tempId: item.tempId,
              serverId: created.id,
              at: new Date().toISOString(),
            })
          }
          await dbDelete('outbox', item.id)
          touched.add(item.projectId)
        } catch (error) {
          if (error instanceof PendingDependencyError) {
            await dbPut('outbox', { ...item, status: 'queued' })
            continue
          }
          if (isNetworkFailure(error)) {
            await dbPut('outbox', { ...item, status: 'queued' })
            break
          }
          const status = axios.isAxiosError(error)
            ? (error.response?.status ?? 0)
            : 0
          // The server answers 404 for a project outside the token's
          // workspace: the item was queued elsewhere and is not retried here
          // (workspace switching doc §4, rule 5).
          const wrongWorkspace = status === 404 || status === 403
          await dbPut('outbox', {
            ...item,
            status: retriableStatus(status) ? 'queued' : 'failed',
            attempts: item.attempts + 1,
            lastError: wrongWorkspace
              ? `${errorText(error)} (wrong workspace?)`
              : errorText(error),
          })
          if (retriableStatus(status)) break
        }
      }
    } finally {
      await refreshFromDb()
      setState({ syncing: false, lastSyncAt: new Date().toISOString() })
      if (touched.size) {
        for (const listener of syncedListeners) listener([...touched])
      }
    }
  })().finally(() => {
    syncPromise = null
  })
  return syncPromise
}

/** Loads the queue and replays it whenever the device comes back online. */
export const startOutbox = () => {
  if (started || typeof window === 'undefined') return
  started = true
  void refreshFromDb().then(() => syncOutbox())
  window.addEventListener('online', () => void syncOutbox())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncOutbox()
  })
  window.setInterval(() => void syncOutbox(), 60_000)
}
