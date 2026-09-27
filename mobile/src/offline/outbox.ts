/**
 * The outbox: writes captured without a signal, sent in order when one
 * returns. Only writes the server can replay by `clientRequestId` (or a
 * natural key) are allowed in here, so a retry after a lost reply cannot
 * create a duplicate. The state machine follows the offline policy,
 * section 3: transient failures retry with back-off; a refusal the person
 * must act on stops that item and says why; a lost right or a vanished
 * target refuses the item and keeps what was captured; a lost session
 * locks the queue until the same person signs in again.
 *
 * Every item belongs to a workspace as well as a person (workspace switching
 * doc §4): the owner key is `userId:orgId`. A different identity signing in
 * on this device wipes the queue — nobody sends another person's work. A
 * different workspace of the same identity never does: the other
 * workspace's items stay queued, are never replayed under the new
 * workspace's token, and go when their own workspace is active again.
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
  /** The workspace the item was captured in; it is sent only while that workspace is active. */
  orgId: string | null
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
  /**
   * Captured by the version of the app that did not know workspaces. Its
   * workspace is not on the item; only the device's profile from that version
   * can tell it, and until it does the item is held — never sent under
   * whichever workspace happens to be active.
   */
  legacy?: boolean
}

export type Sender = (item: OutboxItem, parent: OutboxItem | null) => Promise<{ resultId: string | null; resultRef?: string | null }>

interface OutboxState {
  items: OutboxItem[]
  /** The identity the queue belongs to. */
  owner: string | null
  /** The workspace the session is in; only its items are sent. */
  activeOrgId: string | null
  hydrated: boolean
  /** A lost session, or a switch in progress: nothing sends until the session is settled again. */
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

export const useOutbox = create<OutboxState>(() => ({ items: [], owner: null, activeOrgId: null, hydrated: false, locked: false, draining: false }))

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
export const backoffFor = (attempts: number) => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS)

/** The owner key of an item or a session: who, in which workspace. */
export const ownerKeyOf = (userId: string | null, orgId: string | null) => (userId ? `${userId}:${orgId ?? ''}` : null)

/**
 * Whether an item belongs to the workspace the session is in. An item
 * stamped with a workspace goes only while that workspace is active — not
 * before a session has adopted the queue, not under another workspace. An
 * item never stamped (queued by a version before workspaces, not yet
 * adopted) and a queue no session has adopted yet match each other, which is
 * exactly the behaviour that version had.
 */
export const inActiveWorkspace = (item: Pick<OutboxItem, 'orgId'>, activeOrgId: string | null | undefined) => (item.orgId ?? null) === (activeOrgId ?? null)

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
  const { items, activeOrgId } = useOutbox.getState()
  const pending = items.filter((i) => i.status === 'waiting' && i.nextAttemptAt && inActiveWorkspace(i, activeOrgId))
  if (!pending.length) return
  const at = Math.min(...pending.map((i) => i.nextAttemptAt!))
  timer = setTimeout(() => void drainOutbox('backoff'), Math.max(50, at - Date.now()))
}

/** Load what was queued before the app last closed. Items written before workspaces carry no orgId until an owner adopts them. */
export async function hydrateOutbox() {
  try {
    const [raw, owner] = await Promise.all([offlineStore().get(ITEMS_KEY), offlineStore().get(OWNER_KEY)])
    const items = raw ? (JSON.parse(raw) as Partial<OutboxItem>[]) : []
    // Nothing was mid-flight when the app closed: anything marked sending goes back to waiting.
    // An item without the orgId field at all was written by the version before
    // workspaces; one of this version always carries the field, if only null.
    useOutbox.setState({
      items: items.map((i) => ({ ...(i as OutboxItem), orgId: i.orgId ?? null, ...(!('orgId' in i) ? { legacy: true } : {}), status: i.status === 'sending' ? 'waiting' : (i.status as OutboxStatus) })),
      owner,
      hydrated: true,
    })
  } catch (error) {
    log.warn('sync', 'could not read the outbox', { message: String(error) })
    useOutbox.setState({ items: [], hydrated: true })
  }
  scheduleNext()
}

/**
 * The person and workspace that own what is queued. A different person
 * signing in on the same device wipes the queue: nobody sends another
 * person's work. The same person in another workspace keeps every item —
 * those of the previous workspace stay, locked to it, until it is active
 * again.
 *
 * Items queued by the version before workspaces are stamped, once, with the
 * workspace they were captured in — `legacyOrgId`, the one workspace the
 * device's profile from that version names — and never with the adopting
 * workspace merely because it came first (§10). Without that knowledge they
 * stay held, and the outbox screen offers to discard them. An item of this
 * version queued before a session adopted the queue was captured in the
 * session now adopting it, and takes its workspace.
 */
export async function adoptOutboxOwner(userId: string, orgId: string, legacyOrgId: string | null = null) {
  const { owner, hydrated } = useOutbox.getState()
  if (!hydrated) await hydrateOutbox()
  const previous = useOutbox.getState().owner ?? owner
  if (previous && previous !== userId) {
    log.info('sync', 'a different person signed in; the previous outbox is discarded')
    useOutbox.setState({ items: [] })
  }
  const stampFor = (item: OutboxItem): string | null => (item.orgId != null ? item.orgId : item.legacy ? legacyOrgId : orgId)
  const migrated = useOutbox.getState().items.filter((i) => i.orgId == null && stampFor(i) != null).length
  if (migrated) log.info('sync', `stamping ${migrated} queued item${migrated === 1 ? '' : 's'} with the workspace`)
  // The owner changes first and the lock lifts second, so nothing can be sent
  // in the moment between the two under the wrong workspace.
  useOutbox.setState((s) => ({
    items: s.items.map((i) => {
      if (i.orgId != null) return i
      const stamped = stampFor(i)
      if (!stamped) return i
      const { legacy: _legacy, ...rest } = i
      return { ...rest, orgId: stamped }
    }),
    owner: userId,
    activeOrgId: orgId,
  }))
  useOutbox.setState({ locked: false })
  await persist()
  void drainOutbox('sign-in')
}

/** A lost session, or a switch under way, keeps the queue but stops it until the session is settled again. */
export function lockOutbox() {
  useOutbox.setState({ locked: true })
}

/** Sign-out: the queue, like every other offline record, goes with the session. */
export async function wipeOutbox() {
  if (timer) clearTimeout(timer)
  timer = null
  useOutbox.setState({ items: [], owner: null, activeOrgId: null, locked: false, draining: false })
  await Promise.all([offlineStore().remove(ITEMS_KEY), offlineStore().remove(OWNER_KEY)])
}

export interface EnqueueInput {
  projectId: string
  kind: OutboxKind
  summary: string
  payload: Record<string, unknown>
  clientRequestId: string
  dependsOn?: string | null
  /** The workspace the write belongs to; the active one unless the caller knows better. */
  orgId?: string | null
}

export async function enqueue(input: EnqueueInput): Promise<OutboxItem> {
  const item: OutboxItem = {
    id: newId(),
    projectId: input.projectId,
    orgId: input.orgId ?? useOutbox.getState().activeOrgId,
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

/** The next item that may go now: waiting, due, in the active workspace, its parent sent. */
const nextEligible = (items: OutboxItem[], now: number, activeOrgId: string | null): OutboxItem | null => {
  const byId = new Map(items.map((i) => [i.id, i]))
  for (const i of [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (i.status !== 'waiting') continue
    // Another workspace's item is never sent under this workspace's token (§18).
    if (!inActiveWorkspace(i, activeOrgId)) continue
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
 * session is lost; everything else is decided per item. An item stamped
 * with a workspace is sent only while that workspace is the active one:
 * never before a session has adopted the queue, never under another
 * workspace's token.
 */
export async function drainOutbox(reason: string): Promise<void> {
  const state = useOutbox.getState()
  if (state.draining || state.locked || !state.hydrated) return
  if (network.isKnownOffline()) return
  useOutbox.setState({ draining: true })
  log.info('sync', `draining (${reason})`)
  try {
    for (;;) {
      const current = useOutbox.getState()
      // The session moved on while an item was being sent: stop here; the new owner drains its own.
      if (current.locked) break
      const item = nextEligible(current.items, Date.now(), current.activeOrgId)
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

/**
 * How much is waiting: in the given project, and — when a workspace is
 * given — in that workspace only, with what is held for other workspaces
 * counted apart so a badge never promises to send what this session cannot.
 */
export const outboxCounts = (items: OutboxItem[], projectId?: string | null, orgId?: string | null) => {
  const here = orgId ? items.filter((i) => inActiveWorkspace(i, orgId)) : items
  const scoped = projectId ? here.filter((i) => i.projectId === projectId) : here
  return {
    waiting: scoped.filter((i) => i.status === 'waiting' || i.status === 'sending').length,
    attention: scoped.filter((i) => i.status === 'attention' || i.status === 'refused').length,
    sent: scoped.filter((i) => i.status === 'sent').length,
    /** Items waiting in other workspaces of the same person; they go when that workspace is active. */
    elsewhere: orgId ? items.filter((i) => !inActiveWorkspace(i, orgId) && (i.status === 'waiting' || i.status === 'sending')).length : 0,
  }
}

/** Tests reset the module between cases. */
export function __resetOutboxForTests() {
  if (timer) clearTimeout(timer)
  timer = null
  useOutbox.setState({ items: [], owner: null, activeOrgId: null, hydrated: false, locked: false, draining: false })
}
