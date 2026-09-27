import { AppError } from '@/api/errors'
import { network } from '@/api/network'
import { __resetOutboxForTests, adoptOutboxOwner, backoffFor, discardItem, drainOutbox, enqueue, hydrateOutbox, lockOutbox, outboxCounts, registerSender, retryItem, useOutbox, wipeOutbox, type OutboxItem } from '@/offline/outbox'
import { __useStoreForTests, memoryStore, type KeyValueStore } from '@/offline/storage'

const ORG_A = 'org-a'
const ORG_B = 'org-b'

let store: KeyValueStore
let sent: { kind: string; clientRequestId: string; parentResult: string | null; orgId: string | null }[]
/** A scripted server: each call answers with the next script entry, or succeeds. */
let script: (Error | { resultId: string | null })[]

const sender = jest.fn(async (item: OutboxItem, parent: OutboxItem | null) => {
  sent.push({ kind: item.kind, clientRequestId: item.clientRequestId, parentResult: parent?.resultId ?? null, orgId: item.orgId })
  const next = script.shift()
  if (next instanceof Error) throw next
  return next ?? { resultId: `srv-${item.clientRequestId}` }
})

const queue = (over: Partial<Parameters<typeof enqueue>[0]> = {}) => enqueue({ projectId: 'p1', kind: 'punch.create', summary: 'Chipped tile', payload: { body: {} }, clientRequestId: `key-${Math.random().toString(36).slice(2, 8)}`, ...over })
const items = () => useOutbox.getState().items
const statusOf = (id: string) => items().find((i) => i.id === id)?.status
const settled = async () => {
  while (useOutbox.getState().draining) await new Promise((r) => setTimeout(r, 5))
}

beforeEach(async () => {
  store = memoryStore()
  __useStoreForTests(store)
  __resetOutboxForTests()
  sent = []
  script = []
  sender.mockClear()
  registerSender('punch.create', sender)
  registerSender('attachment.upload', sender)
  network.__reset(true)
  await hydrateOutbox()
  // The queue belongs to a person in a workspace before anything is sent.
  await adoptOutboxOwner('u1', ORG_A)
  await settled()
})

afterAll(() => __useStoreForTests(null))

describe('the outbox', () => {
  it('sends items oldest first, each with the replay key it was captured with, and keeps them as sent', async () => {
    const a = await queue({ clientRequestId: 'k1' })
    const b = await queue({ clientRequestId: 'k2' })
    await drainOutbox('test')
    expect(sent.map((s) => s.clientRequestId)).toEqual(['k1', 'k2'])
    expect(statusOf(a.id)).toBe('sent')
    expect(items().find((i) => i.id === b.id)?.resultId).toBe('srv-k2')
    expect(JSON.parse((await store.get('outbox:v1:items')) ?? '[]')).toHaveLength(2)
  })

  it('holds a dependant until its parent is sent, then hands it the id the server gave', async () => {
    network.__reset(false)
    const parent = await queue({ clientRequestId: 'parent' })
    const child = await queue({ kind: 'attachment.upload', clientRequestId: 'child', dependsOn: parent.id })
    network.__reset(true)
    await drainOutbox('test')
    expect(sent.map((s) => s.clientRequestId)).toEqual(['parent', 'child'])
    expect(sent[1]!.parentResult).toBe('srv-parent')
    expect(statusOf(child.id)).toBe('sent')
  })

  it('retries a lost connection with back-off and stops the drain until the signal returns', async () => {
    script = [new AppError('OFFLINE')]
    // Queued without a signal, so nothing sends until the drain below; the first send then finds the signal gone again.
    network.__reset(false)
    const a = await queue({ clientRequestId: 'k1' })
    const b = await queue({ clientRequestId: 'k2' })
    network.__reset(true)
    await drainOutbox('test')
    const first = items().find((i) => i.id === a.id)!
    expect(first.status).toBe('waiting')
    expect(first.attempts).toBe(1)
    expect(first.nextAttemptAt).toBeGreaterThan(Date.now())
    expect(first.error?.code).toBe('OFFLINE')
    // The second item was not tried: the network is gone.
    expect(statusOf(b.id)).toBe('waiting')
    expect(sent).toHaveLength(1)
    expect(backoffFor(1)).toBe(5_000)
    expect(backoffFor(3)).toBe(20_000)
    expect(backoffFor(20)).toBe(10 * 60_000)
  })

  it('retries a server error but goes on to the next item', async () => {
    script = [new AppError('SERVER_ERROR', { status: 500 })]
    const a = await queue({ clientRequestId: 'k1' })
    const b = await queue({ clientRequestId: 'k2' })
    await drainOutbox('test')
    expect(statusOf(a.id)).toBe('waiting')
    expect(statusOf(b.id)).toBe('sent')
  })

  it('stops an item the server refused for its content and says why, keeping the rest moving', async () => {
    script = [new AppError('VALIDATION', { status: 400, serverCode: 'PUNCH_TITLE_REQUIRED', message: 'A title is required', requestId: 'req-1' })]
    const a = await queue({ clientRequestId: 'k1' })
    const b = await queue({ clientRequestId: 'k2' })
    await drainOutbox('test')
    const first = items().find((i) => i.id === a.id)!
    expect(first.status).toBe('attention')
    expect(first.error).toEqual({ code: 'VALIDATION', serverCode: 'PUNCH_TITLE_REQUIRED', message: 'A title is required', requestId: 'req-1' })
    expect(statusOf(b.id)).toBe('sent')
  })

  it('marks an item refused when the right is gone or the target vanished, and blocks what depended on it', async () => {
    script = [new AppError('FORBIDDEN', { status: 403, message: 'You may not raise punch items here' })]
    const parent = await queue({ clientRequestId: 'k1' })
    network.__reset(false)
    const child = await queue({ kind: 'attachment.upload', clientRequestId: 'k2', dependsOn: parent.id })
    network.__reset(true)
    await drainOutbox('test')
    expect(statusOf(parent.id)).toBe('refused')
    expect(statusOf(child.id)).toBe('waiting')
    expect(sent).toHaveLength(1)
    await discardItem(parent.id)
    expect(items()).toHaveLength(0)
  })

  it('tries a refused item again from the start with the same replay key', async () => {
    script = [new AppError('CONFLICT', { status: 409, message: 'The form is closed' })]
    const a = await queue({ clientRequestId: 'same-key' })
    await drainOutbox('test')
    expect(statusOf(a.id)).toBe('attention')
    await retryItem(a.id)
    await drainOutbox('test')
    expect(statusOf(a.id)).toBe('sent')
    expect(sent.map((s) => s.clientRequestId)).toEqual(['same-key', 'same-key'])
  })

  it('locks the queue when the session is refused and sends nothing until the same person is back', async () => {
    script = [new AppError('AUTH_REQUIRED', { status: 401 })]
    const a = await queue({ clientRequestId: 'k1' })
    await queue({ clientRequestId: 'k2' })
    await drainOutbox('test')
    expect(useOutbox.getState().locked).toBe(true)
    expect(statusOf(a.id)).toBe('waiting')
    expect(sent).toHaveLength(1)
    lockOutbox()
    await drainOutbox('test')
    expect(sent).toHaveLength(1)
    // Signing in unlocks the queue and starts a drain without making sign-in wait for it.
    await adoptOutboxOwner('u1', ORG_A)
    await settled()
    await drainOutbox('test')
    expect(items().every((i) => i.status === 'sent')).toBe(true)
  })

  it('discards the queue when a different person signs in, and on sign-out', async () => {
    network.__reset(false)
    await queue({ clientRequestId: 'k1' })
    expect(items()).toHaveLength(1)
    await adoptOutboxOwner('u2', ORG_A)
    expect(items()).toHaveLength(0)
    expect(await store.get('outbox:v1:owner')).toBe('u2')
    await queue({ clientRequestId: 'k2' })
    await wipeOutbox()
    expect(items()).toHaveLength(0)
    expect(await store.get('outbox:v1:items')).toBeNull()
  })

  it('comes back from storage with anything mid-flight put back to waiting', async () => {
    network.__reset(false)
    const a = await queue({ clientRequestId: 'k1' })
    await store.set('outbox:v1:items', JSON.stringify(items().map((i) => ({ ...i, status: 'sending' }))))
    __resetOutboxForTests()
    await hydrateOutbox()
    expect(statusOf(a.id)).toBe('waiting')
    expect(items()[0]!.clientRequestId).toBe('k1')
  })
})

describe('the outbox across workspaces (workspace switching doc §4)', () => {
  it('stamps every item with the workspace it was captured in', async () => {
    const a = await queue({ clientRequestId: 'k1' })
    expect(a.orgId).toBe(ORG_A)
    expect(JSON.parse((await store.get('outbox:v1:items')) ?? '[]')[0].orgId).toBe(ORG_A)
  })

  it('sends nothing stamped with a workspace before a session has adopted the queue: the workspace the token names is unknown', async () => {
    __resetOutboxForTests()
    await hydrateOutbox()
    network.__reset(true)
    const a = await queue({ clientRequestId: 'k1', orgId: ORG_A })
    await settled()
    await drainOutbox('test')
    expect(sent).toHaveLength(0)
    expect(statusOf(a.id)).toBe('waiting')
    // Adopted by the workspace it belongs to, it goes.
    await adoptOutboxOwner('u1', ORG_A)
    await settled()
    expect(statusOf(a.id)).toBe('sent')
  })

  it('locks another workspace’s items: a switch never wipes them and never replays them under the new workspace', async () => {
    // Captured in A while the signal was down.
    network.__reset(false)
    const inA = await queue({ clientRequestId: 'a1' })
    // The switch: the queue holds still, then the same person adopts it in B.
    lockOutbox()
    network.__reset(true)
    await drainOutbox('switching')
    expect(sent).toHaveLength(0)
    await adoptOutboxOwner('u1', ORG_B)
    await settled()
    await drainOutbox('in-b')
    expect(sent).toHaveLength(0)
    expect(statusOf(inA.id)).toBe('waiting')
    expect(items()).toHaveLength(1)
    // B's own item goes; A's still waits.
    const inB = await queue({ clientRequestId: 'b1' })
    await settled()
    await drainOutbox('in-b')
    expect(sent.map((s) => [s.clientRequestId, s.orgId])).toEqual([['b1', ORG_B]])
    expect(statusOf(inB.id)).toBe('sent')
    expect(statusOf(inA.id)).toBe('waiting')
    expect(outboxCounts(items(), null, ORG_B)).toMatchObject({ waiting: 0, sent: 1, elsewhere: 1 })
    // Back in A: A's item is replayed, once.
    lockOutbox()
    await adoptOutboxOwner('u1', ORG_A)
    await settled()
    await drainOutbox('back-in-a')
    expect(sent.map((s) => s.clientRequestId)).toEqual(['b1', 'a1'])
    expect(statusOf(inA.id)).toBe('sent')
    expect(outboxCounts(items(), null, ORG_A)).toMatchObject({ waiting: 0, sent: 1, elsewhere: 0 })
  })

  it('a back-off retry due while another workspace is active waits for its own', async () => {
    script = [new AppError('OFFLINE')]
    const inA = await queue({ clientRequestId: 'a1' })
    await settled()
    expect(statusOf(inA.id)).toBe('waiting')
    expect(items()[0]!.nextAttemptAt).toBeGreaterThan(Date.now())
    lockOutbox()
    await adoptOutboxOwner('u1', ORG_B)
    await settled()
    // Force the retry moment and drain as B: nothing of A goes.
    useOutbox.setState((s) => ({ items: s.items.map((i) => ({ ...i, nextAttemptAt: Date.now() - 1 })) }))
    await drainOutbox('backoff')
    expect(sent).toHaveLength(1)
    expect(statusOf(inA.id)).toBe('waiting')
  })

  // A queue written by the previous version: no orgId field on the items, the owner alone.
  const previousVersionQueue = async () => {
    await store.set('outbox:v1:items', JSON.stringify([{ id: 'old-1', projectId: 'p1', kind: 'punch.create', summary: 'Old', payload: {}, dependsOn: null, status: 'waiting', attempts: 0, nextAttemptAt: null, error: null, createdAt: '2026-01-01T00:00:00.000Z', sentAt: null, resultId: null, resultRef: null, clientRequestId: 'old' }]))
    await store.set('outbox:v1:owner', 'u1')
    __resetOutboxForTests()
    network.__reset(false)
    await hydrateOutbox()
    expect(items()[0]).toMatchObject({ orgId: null, legacy: true })
  }

  it('stamps an item of the version before workspaces with the workspace it was captured in — not the one that adopts the queue first — once', async () => {
    await previousVersionQueue()
    // The person signs in to B; the device's old profile says the queue was A's.
    await adoptOutboxOwner('u1', ORG_B, ORG_A)
    expect(items()[0]!.orgId).toBe(ORG_A)
    expect(items()[0]!.legacy).toBeUndefined()
    expect(JSON.parse((await store.get('outbox:v1:items')) ?? '[]')[0].orgId).toBe(ORG_A)
    network.__reset(true)
    await drainOutbox('in-b')
    expect(sent).toHaveLength(0)
    // Back in A it goes, under A.
    lockOutbox()
    await adoptOutboxOwner('u1', ORG_A)
    await settled()
    expect(sent.map((s) => [s.clientRequestId, s.orgId])).toEqual([['old', ORG_A]])
  })

  it('holds an item of the version before workspaces when the device cannot tell its workspace: never sent, and never stamped by whichever comes first', async () => {
    await previousVersionQueue()
    await adoptOutboxOwner('u1', ORG_B)
    network.__reset(true)
    await drainOutbox('in-b')
    lockOutbox()
    await adoptOutboxOwner('u1', ORG_A)
    await drainOutbox('in-a')
    expect(sent).toHaveLength(0)
    expect(items()[0]).toMatchObject({ orgId: null, legacy: true, status: 'waiting' })
    expect(outboxCounts(items(), null, ORG_A)).toMatchObject({ waiting: 0, elsewhere: 1 })
    // An item of this version queued before any session adopted the queue is the adopting session's.
    __resetOutboxForTests()
    await hydrateOutbox()
    const early = await queue({ clientRequestId: 'early' })
    expect(early.orgId).toBeNull()
    await adoptOutboxOwner('u1', ORG_A)
    expect(items().find((i) => i.id === early.id)?.orgId).toBe(ORG_A)
  })

  it('counts what waits here and what waits elsewhere apart, so a badge never promises another workspace’s items', async () => {
    network.__reset(false)
    await queue({ clientRequestId: 'a1' })
    await queue({ clientRequestId: 'a2', projectId: 'p2' })
    lockOutbox()
    await adoptOutboxOwner('u1', ORG_B)
    await queue({ clientRequestId: 'b1' })
    expect(outboxCounts(items(), null, ORG_B)).toEqual({ waiting: 1, attention: 0, sent: 0, elsewhere: 2 })
    expect(outboxCounts(items(), 'p1', ORG_A)).toEqual({ waiting: 1, attention: 0, sent: 0, elsewhere: 1 })
    // Without a workspace the counts are the whole queue, as before.
    expect(outboxCounts(items())).toEqual({ waiting: 3, attention: 0, sent: 0, elsewhere: 0 })
  })
})
