import { QueryClient } from '@tanstack/react-query'
import { AppError, fromStatus, userMessage } from '@/api/errors'
import { keys } from '@/api/query'
import { appRouteForRecord, destinationForNotification } from '@/navigation/links'
import { invalidateForEvent } from '@/realtime'
import { __resetOutboxForTests, drainOutbox, enqueue, hydrateOutbox, registerSender, useOutbox } from '@/offline/outbox'
import { network } from '@/api/network'
import { __useStoreForTests, memoryStore } from '@/offline/storage'
import { registerSenders } from '@/offline/senders'
import { envelope, fakeServer } from '@/testing/fake-server'
import { useAuthStore } from '@/auth/store'
import { user } from '@/testing/fixtures'

/**
 * Regression tests for the defects the 2026-09-18 certification phase
 * confirmed. Each one fails if its fix is reverted; the certification report
 * names them by the same defect id.
 */
/** The drain runs in the background; wait for it as the outbox's own tests do. */
const settled = async () => {
  while (useOutbox.getState().draining) await new Promise((r) => setTimeout(r, 5))
}

describe('certification fixes', () => {
  // The outbox sends on behalf of a signed-in person. Without a session in
  // memory the request layer refuses to send at all and the item waits, which
  // is right in the app and merely unhelpful here.
  beforeEach(() => {
    useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  })

  it('MOB-P2: a refused sign-in is not reported as an ended session, and a disabled account says so', () => {
    expect(fromStatus(401, { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }).userMessage).toMatch(/do not match/i)
    expect(fromStatus(401, { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }).userMessage).not.toMatch(/session/i)
    expect(fromStatus(401, { code: 'USER_INACTIVE', message: 'User is inactive' }).userMessage).toMatch(/turned off/i)
    // An expired session still reads as one.
    expect(fromStatus(401, { code: 'TOKEN_EXPIRED' }).userMessage).toMatch(/session has ended/i)
  })

  it('MOB-P3: a generic validation failure names the field the server named, and a subscription refusal is a sentence', () => {
    const generic = fromStatus(422, { code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ field: 'trade', message: 'Trade is required for a manpower entry' }] })
    expect(generic.userMessage).toBe('Trade is required for a manpower entry')
    const noDetail = fromStatus(422, { code: 'VALIDATION_ERROR', message: 'Validation failed' })
    expect(noDetail.userMessage).toMatch(/missing or not valid/i)
    const subscription = fromStatus(402, { code: 'SUBSCRIPTION_REQUIRED', message: 'Your trial or subscription has ended. Subscribe to continue.' })
    expect(subscription.code).toBe('SUBSCRIPTION_REQUIRED')
    expect(subscription.userMessage).toMatch(/subscription has ended/i)
    expect(subscription.userMessage).not.toMatch(/[A-Z]{2,}_[A-Z]/)
  })

  it('MOB-P2: record types whose ids belong to another table hand over to the web instead of opening a screen that always fails', () => {
    // Legacy ITP and defect records, and a progress submission, are not form instances, punch items or activities.
    expect(appRouteForRecord('itp', 'itp-1')).toBeNull()
    expect(appRouteForRecord('defect', 'def-1')).toBeNull()
    expect(appRouteForRecord('progress_submission', 'sub-1')).toBeNull()
    // The types that do match their screens still open in the app.
    expect(appRouteForRecord('form_instance', 'f1')).toBe('/quality/inspections/f1')
    expect(appRouteForRecord('punch_item', 'p1')).toBe('/quality/punch/p1')
    expect(appRouteForRecord('activity', 'a1')).toBe('/activities/a1')
    // A notification for one of the handed-over types goes to the web platform's own path.
    const handed = destinationForNotification({ entityType: 'itp', entityId: 'itp-1', actionUrl: '/projects/p1/quality/itp?recordId=itp-1' } as never)
    expect(handed).toEqual({ web: '/projects/p1/quality/itp?recordId=itp-1' })
  })

  it('MOB-P2: an inventory event refetches the inventory keys, which sit outside the project scope', () => {
    const client = new QueryClient()
    const spy = jest.spyOn(client, 'invalidateQueries')
    const touched = invalidateForEvent(client, { type: 'record.changed', projectId: 'p1', entityType: 'stock_transaction', entityId: 'm1' })
    expect(touched).toContain('inventory')
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['inventory'] }))
    expect(invalidateForEvent(client, { type: 'record.changed', projectId: 'p1', entityType: 'delivery_receipt', entityId: 'r1' })).toContain('inventory')
    // A record that is not inventory does not drag the inventory keys with it.
    expect(invalidateForEvent(client, { type: 'record.changed', projectId: 'p1', entityType: 'rfi', entityId: 'r1' })).not.toContain('inventory')
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: keys.projectScoped('p1') }))
  })

  it('MOB-P2: the outbox keeps the sentence a person can read, not the server’s own words', async () => {
    __useStoreForTests(memoryStore())
    __resetOutboxForTests()
    network.__reset(true)
    await hydrateOutbox()
    network.__reset(false)
    registerSender('punch.create', async () => {
      throw new AppError('VALIDATION', { status: 422, serverCode: 'PUNCH_TITLE_REQUIRED', message: 'Invalid `prisma.punchItem.create()` invocation', requestId: 'req-1' })
    })
    await enqueue({ projectId: 'p1', kind: 'punch.create', summary: 'Chipped tile', payload: { body: {} }, clientRequestId: 'c1' })
    network.__reset(true)
    await drainOutbox('test')
    await settled()
    const item = useOutbox.getState().items[0]!
    expect(item.status).toBe('attention')
    expect(item.error?.message).not.toMatch(/prisma|invocation/i)
    expect(item.error?.message).toBe(userMessage(new AppError('VALIDATION', { status: 422, serverCode: 'PUNCH_TITLE_REQUIRED', message: 'Invalid `prisma.punchItem.create()` invocation' })))
    // The code and the request id stay on the item for support.
    expect(item.error?.serverCode).toBe('PUNCH_TITLE_REQUIRED')
    expect(item.error?.requestId).toBe('req-1')
    network.__reset(true)
  })

  it('MOB-P1: a photo queued behind a daily-log entry is sent against the log the real sender created', async () => {
    __useStoreForTests(memoryStore())
    __resetOutboxForTests()
    network.__reset(true)
    await hydrateOutbox()
    network.__reset(false)
    // The real senders, against a fake server: the daily-log sender must hand its log id to the photo behind it.
    registerSenders()
    const calls = fakeServer({
      'POST /projects/p1/daily-logs/2026-09-18/entries/notes': () => ({ status: 201, body: envelope({ id: 'log-77', date: '2026-09-18', exists: true, sections: {}, totals: {} }) }),
      'POST /projects/p1/attachments': () => ({ status: 201, body: envelope({ items: [] }) }),
    })
    const note = await enqueue({ projectId: 'p1', kind: 'daily-log.entry', summary: 'Site photos note', payload: { date: '2026-09-18', section: 'notes', body: {} }, clientRequestId: 'n1' })
    await enqueue({ projectId: 'p1', kind: 'attachment.upload', summary: '2 photos', payload: { recordType: 'daily_log', recordId: null, files: [] }, clientRequestId: 'u1', dependsOn: note.id })
    network.__reset(true)
    await drainOutbox('test')
    await settled()
    const upload = calls.find((c) => c.path === '/projects/p1/attachments')
    expect(upload).toBeTruthy()
    // The multipart body carries the log id the entry created, not a missing record.
    expect(String(upload!.body)).toContain('log-77')
    expect(useOutbox.getState().items.every((i) => i.status === 'sent')).toBe(true)
  })
})
