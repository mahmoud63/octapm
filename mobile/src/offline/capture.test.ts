import { AppError } from '@/api/errors'
import { network } from '@/api/network'
import { captureOrQueue } from '@/offline/capture'
import { __resetOutboxForTests, hydrateOutbox, useOutbox } from '@/offline/outbox'
import { __useStoreForTests, memoryStore } from '@/offline/storage'

const input = { projectId: 'p1', kind: 'punch.create' as const, summary: 'Chipped tile', payload: { body: {} }, clientRequestId: 'k1' }

beforeEach(async () => {
  __useStoreForTests(memoryStore())
  __resetOutboxForTests()
  await hydrateOutbox()
})

afterAll(() => __useStoreForTests(null))

describe('capture or queue', () => {
  it('sends straight through when the device is online', async () => {
    network.__reset(true)
    const send = jest.fn(async () => ({ id: 'srv1' }))
    const outcome = await captureOrQueue(input, send)
    expect(outcome).toEqual({ sent: { id: 'srv1' } })
    expect(useOutbox.getState().items).toHaveLength(0)
  })

  it('queues without trying when the device knows it is offline', async () => {
    network.__reset(false)
    const send = jest.fn()
    const outcome = await captureOrQueue(input, send)
    expect(send).not.toHaveBeenCalled()
    expect(outcome.queued?.clientRequestId).toBe('k1')
    expect(useOutbox.getState().items[0]?.status).toBe('waiting')
  })

  it('queues after a lost connection or a lost reply, and rethrows anything else', async () => {
    network.__reset(true)
    const lost = await captureOrQueue(input, async () => {
      throw new AppError('TIMEOUT')
    })
    expect(lost.queued?.clientRequestId).toBe('k1')
    await expect(
      captureOrQueue({ ...input, clientRequestId: 'k2' }, async () => {
        throw new AppError('VALIDATION', { status: 400, message: 'A title is required' })
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(useOutbox.getState().items.map((i) => i.clientRequestId)).toEqual(['k1'])
  })
})
