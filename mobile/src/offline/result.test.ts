import { __resetOutboxForTests, drainOutbox, enqueue, hydrateOutbox, registerSender, useOutbox } from '@/offline/outbox'

/**
 * What the office calls the record a queued write became.
 *
 * A field person who captures work without a signal has no way to know it
 * landed unless the app carries the server's own reference back. The id is
 * for the app; the reference is the proof.
 */
describe('a queued write comes back with the record it became', () => {
  beforeEach(async () => {
    __resetOutboxForTests()
    await hydrateOutbox()
  })

  it('keeps the reference the server gave, not only the id', async () => {
    registerSender('punch.create', async () => ({ resultId: 'srv-1', resultRef: 'PUNCH-114' }))
    const item = await enqueue({ projectId: 'p1', kind: 'punch.create', summary: 'Chipped tile', clientRequestId: 'k1', payload: { body: {} } })
    await drainOutbox('test')
    const sent = useOutbox.getState().items.find((i) => i.id === item.id)!
    expect(sent.status).toBe('sent')
    expect(sent.resultId).toBe('srv-1')
    expect(sent.resultRef).toBe('PUNCH-114')
  })

  it('records no reference when the server gives none, rather than inventing one', async () => {
    registerSender('timesheet.create', async () => ({ resultId: 'srv-2' }))
    const item = await enqueue({ projectId: 'p1', kind: 'timesheet.create', summary: 'Tuesday crew', clientRequestId: 'k2', payload: { body: {} } })
    await drainOutbox('test')
    const sent = useOutbox.getState().items.find((i) => i.id === item.id)!
    expect(sent.resultId).toBe('srv-2')
    expect(sent.resultRef).toBeNull()
  })

  it('gives a photograph the record it was attached to, so it can be opened there', async () => {
    registerSender('attachment.upload', async (item) => {
      const payload = item.payload as { recordId: string; recordRef?: string | null }
      return { resultId: payload.recordId, resultRef: payload.recordRef ?? null }
    })
    const item = await enqueue({
      projectId: 'p1',
      kind: 'attachment.upload',
      summary: 'Photograph for NCR-012',
      clientRequestId: 'k3',
      payload: { recordType: 'ncr', recordId: 'ncr-1', recordRef: 'NCR-012', files: [] },
    })
    await drainOutbox('test')
    const sent = useOutbox.getState().items.find((i) => i.id === item.id)!
    expect(sent.resultId).toBe('ncr-1')
    expect(sent.resultRef).toBe('NCR-012')
  })

  it('carries the parent record through to a photograph queued behind it', async () => {
    // The punch item is created first; its photograph takes the id the server
    // gave, which is the CERT-01 contract and must not regress.
    registerSender('punch.create', async () => ({ resultId: 'srv-punch', resultRef: 'PUNCH-200' }))
    const seen: (string | null)[] = []
    registerSender('attachment.upload', async (item, parent) => {
      const payload = item.payload as { recordId: string | null }
      const recordId = payload.recordId ?? parent?.resultId ?? null
      seen.push(recordId)
      return { resultId: recordId, resultRef: parent?.resultRef ?? null }
    })
    const parent = await enqueue({ projectId: 'p1', kind: 'punch.create', summary: 'Cracked screed', clientRequestId: 'k4', payload: { body: {} } })
    const photo = await enqueue({ projectId: 'p1', kind: 'attachment.upload', summary: 'Photograph', clientRequestId: 'k5', dependsOn: parent.id, payload: { recordType: 'punch_item', recordId: null, files: [] } })
    await drainOutbox('test')
    expect(seen).toEqual(['srv-punch'])
    const sent = useOutbox.getState().items.find((i) => i.id === photo.id)!
    expect(sent.resultRef).toBe('PUNCH-200')
  })
})
