/**
 * The outbox: writes captured without a signal, sent in order when one
 * returns. Only writes the server can replay by `clientRequestId` (or a
 * natural key) are allowed in here, so a retry after a lost reply cannot
 * create a duplicate. The state machine follows the offline policy,
 * section 3: transient failures retry with back-off; a refusal the person
 * must act on stops that item and says why; a lost right or a vanished
 * target refuses the item and keeps what was captured; a lost session
 * locks the queue until the same person signs in again.
 */
import { create } from 'zustand'
import { isAppError, type AppErrorCode } from '@/api/errors'
import { network } from '@/api/network'
import { offlineStore } from '@/offline/storage'
import { log } from '@/utilities/logger'

export type OutboxKind = 'punch.create' | 'form.create' | 'daily-log.entry' | 'timesheet.create' | 'attachment.upload' | 'goods-receipt'
export type OutboxStatus = 'waiting' | 'sending' | 'sent' | 'attention' | 'refused'

export interface OutboxError {
  code: AppErrorCode | string
  serverCode?: string
  message: string
  requestId?: string
}

export interface OutboxItem {
  id: string
  projectId: string
  kind: OutboxKind
  /** One line for the person: what this is. */
  summary: string
  payload: Record<string, unknown>
  /** An item this one needs first (a photo waits for its record). */
  dependsOn: string | null
  status: OutboxStatus
  attempts: number
  nextAttemptAt: number | null
  error: OutboxError | null
  createdAt: string
  sentAt: string | null
  /** The id the server gave the created record, for dependants. */
  resultId: string | null
  /**
   * What the office calls the record the server created — "RFI-034",
   * "PUNCH-114". The id is for the app; this is for the person, so that a
   * field user can prove the office received their work.
   */
  resultRef: string | null
  clientRequestId: string
}

export type Sender = (item: OutboxItem, parent: OutboxItem | null) => Promise<{ resultId: string | null; resultRef?: string | null }>

interface OutboxState {
  items: OutboxItem[]
  owner: string | null
  hydrated: boolean
  /** A lost session: nothing sends until the same person is back. */
  locked: boolean
  draining: boolean
}

const ITEMS_KEY = 'outbox:v1:items'
const OWNER_KEY = 'outbox:v1:owner'
const SENT_KEPT = 20
const BACKOFF_BASE_MS = 5_000
const BACKOFF_CAP_MS = 10 * 60_000
const RETRYABLE: ReadonlySet<string> = new Set(['OFFLINE', 'TIMEOUT', 'SERVER_ERROR', 'RATE_LIMITED', 'UNKNOWN'])
const ATTENTION: ReadonlySet<string> = new Set(['VALIDATION', 'CONFLICT'])
const REFUSED: ReadonlySet<string> = new Set(['FORBIDDEN', 'NOT_FOUND'])

const senders = new Map<OutboxKind, Sender>()
/** Each kind registers how it is sent; the engine stays ignorant of endpoints. */
export function registerSender(kind: OutboxKind, sender: Sender) {
  senders.set(kind, sender)
}

export const useOutbox = create<OutboxState>(() => ({ items: [], owner: null, hydrated: false, locked: false, draining: false }))

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
export const backoffFor = (attempts: number) => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS)

async function persist() {
  const { items, owner } = useOutbox.getState()
  try {
    await offlineStore().set(ITEMS_KEY, JSON.stringify(items))
    if (owner) await offlineStore().set(OWNER_KEY, owner)
  } catch (error) {
    log.warn('sync', 'could not persist the outbox', { message: String(error) })
  }
}

function update(id: string, patch: Partial<OutboxItem>) {
  useOutbox.setState((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))
}

let timer: ReturnType<typeof setTimeout> | null = null
function scheduleNext() {
  if (timer) clearTimeout(timer)
  timer = null
  const pending = useOutbox.getState().items.filter((i) => i.status === 'waiting' && i.nextAttemptAt)
  if (!pending.length) return
  const at = Math.min(...pending.map((i) => i.nextAttemptAt!))
  timer = setTimeout(() => void drainOutbox('backoff'), Math.max(50, at - Date.now()))
}

/** Load what was queued before the app last closed. */
export async function hydrateOutbox() {
  try {
    const [raw, owner] = await Promise.all([offlineStore().get(ITEMS_KEY), offlineStore().get(OWNER_KEY)])
    const items = raw ? (JSON.parse(raw) as OutboxItem[]) : []
    // Nothing was mid-flight when the app closed: anything marked sending goes back to waiting.
    useOutbox.setState({ items: items.map((i) => (i.status === 'sending' ? { ...i, status: 'waiting' } : i)), owner, hydrated: true })
  } catch (error) {
    log.warn('sync', 'could not read the outbox', { message: String(error) })
    useOutbox.setState({ items: [], hydrated: true })
  }
  scheduleNext()
}

/**
 * The person who owns what is queued. A different person signing in on
 * the same device wipes the queue: nobody sends another person's work.
 */
export async function adoptOutboxOwner(userId: string) {
  const { owner, hydrated } = useOutbox.getState()
  if (!hydrated) await hydrateOutbox()
  const previous = useOutbox.getState().owner ?? owner
  if (previous && previous !== userId) {
    log.info('sync', 'a different person signed in; the previous outbox is discarded')
    useOutbox.setState({ items: [] })
  }
  useOutbox.setState({ owner: userId, locked: false })
  await persist()
  void drainOutbox('sign-in')
}

/** A lost session keeps the queue but stops it until the same person signs in again. */
export function lockOutbox() {
  useOutbox.setState({ locked: true })
}

/** Sign-out: the queue, like every other offline record, goes with the session. */
export async function wipeOutbox() {
  if (timer) clearTimeout(timer)
  timer = null
  useOutbox.setState({ items: [], owner: null, locked: false, draining: false })
  await Promise.all([offlineStore().remove(ITEMS_KEY), offlineStore().remove(OWNER_KEY)])
}

export interface EnqueueInput {
  projectId: string
  kind: OutboxKind
  summary: string
  payload: Record<string, unknown>
  clientRequestId: string
  dependsOn?: string | null
}

export async function enqueue(input: EnqueueInput): Promise<OutboxItem> {
  const item: OutboxItem = {
    id: newId(),
    projectId: input.projectId,
    kind: input.kind,
    summary: input.summary,
    payload: input.payload,
    dependsOn: input.dependsOn ?? null,
    status: 'waiting',
    attempts: 0,
    nextAttemptAt: null,
    error: null,
    createdAt: new Date().toISOString(),
    sentAt: null,
    resultId: null,
    resultRef: null,
    clientRequestId: input.clientRequestId,
  }
  useOutbox.setState((s) => ({ items: [...s.items, item] }))
  await persist()
  if (!network.isKnownOffline()) void drainOutbox('enqueue')
  return item
}

/** After a refusal the person chose to try again: the same replay key, from the start. */
export async function retryItem(id: string) {
  update(id, { status: 'waiting', attempts: 0, nextAttemptAt: null, error: null })
  await persist()
  void drainOutbox('retry')
}

/** Drop an item and everything that was waiting on it. */
export async function discardItem(id: string) {
  const gone = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const i of useOutbox.getState().items) {
      if (i.dependsOn && gone.has(i.dependsOn) && !gone.has(i.id)) {
        gone.add(i.id)
        grew = true
      }
    }
  }
  useOutbox.setState((s) => ({ items: s.items.filter((i) => !gone.has(i.id)) }))
  await persist()
}

const classify = (error: unknown): { status: OutboxStatus; detail: OutboxError; lock?: boolean } => {
  if (isAppError(error)) {
    // The outbox screen shows this line to the person, so it carries the sentence, not the server's own words.
    const detail: OutboxError = { code: error.code, serverCode: error.serverCode, message: error.userMessage, requestId: error.requestId }
    if (error.code === 'AUTH_REQUIRED') return { status: 'waiting', detail, lock: true }
    if (ATTENTION.has(error.code)) return { status: 'attention', detail }
    if (REFUSED.has(error.code)) return { status: 'refused', detail }
    if (RETRYABLE.has(error.code)) return { status: 'waiting', detail }
    return { status: 'attention', detail }
  }
  return { status: 'attention', detail: { code: 'UNKNOWN', message: 'This could not be sent. Try again, and tell support what you captured if it keeps happening.' } }
}

const nextEligible = (items: OutboxItem[], now: number): OutboxItem | null => {
  const byId = new Map(items.map((i) => [i.id, i]))
  for (const i of [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (i.status !== 'waiting') continue
    if (i.nextAttemptAt && i.nextAttemptAt > now) continue
    if (i.dependsOn) {
      const parent = byId.get(i.dependsOn)
      // A missing parent was discarded with its dependants; a parent still on its way blocks the child.
      if (!parent || parent.status !== 'sent') continue
    }
    return i
  }
  return null
}

/**
 * Send what can be sent, one item at a time, oldest first, a dependant only
 * after its parent. Stops at the first sign the network is gone or the
 * session is lost; everything else is decided per item.
 */
export async function drainOutbox(reason: string): Promise<void> {
  const state = useOutbox.getState()
  if (state.draining || state.locked || !state.hydrated) return
  if (network.isKnownOffline()) return
  useOutbox.setState({ draining: true })
  log.info('sync', `draining (${reason})`)
  try {
    for (;;) {
      const item = nextEligible(useOutbox.getState().items, Date.now())
      if (!item) break
      const sender = senders.get(item.kind)
      if (!sender) {
        update(item.id, { status: 'attention', error: { code: 'UNKNOWN', message: `Nothing knows how to send "${item.kind}" on this version of the app.` } })
        continue
      }
      const parent = item.dependsOn ? (useOutbox.getState().items.find((i) => i.id === item.dependsOn) ?? null) : null
      update(item.id, { status: 'sending', error: null })
      try {
        const result = await sender(item, parent)
        update(item.id, { status: 'sent', sentAt: new Date().toISOString(), resultId: result.resultId, resultRef: result.resultRef ?? null, error: null })
      } catch (error) {
        const verdict = classify(error)
        const attempts = item.attempts + 1
        update(item.id, { status: verdict.status, attempts, error: verdict.detail, nextAttemptAt: verdict.status === 'waiting' && !verdict.lock ? Date.now() + backoffFor(attempts) : null })
        if (verdict.lock) {
          useOutbox.setState({ locked: true })
          break
        }
        if (verdict.detail.code === 'OFFLINE') break
      }
      await persist()
    }
    // Keep the recent sent items as a receipt, not forever.
    const sent = useOutbox.getState().items.filter((i) => i.status === 'sent').sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
    if (sent.length > SENT_KEPT) {
      const drop = new Set(sent.slice(SENT_KEPT).map((i) => i.id))
      useOutbox.setState((s) => ({ items: s.items.filter((i) => !drop.has(i.id)) }))
    }
    await persist()
  } finally {
    useOutbox.setState({ draining: false })
    scheduleNext()
  }
}

export const outboxCounts = (items: OutboxItem[], projectId?: string | null) => {
  const scoped = projectId ? items.filter((i) => i.projectId === projectId) : items
  return {
    waiting: scoped.filter((i) => i.status === 'waiting' || i.status === 'sending').length,
    attention: scoped.filter((i) => i.status === 'attention' || i.status === 'refused').length,
    sent: scoped.filter((i) => i.status === 'sent').length,
  }
}

/** Tests reset the module between cases. */
export function __resetOutboxForTests() {
  if (timer) clearTimeout(timer)
  timer = null
  useOutbox.setState({ items: [], owner: null, hydrated: false, locked: false, draining: false })
}
