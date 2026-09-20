import { screen } from '@testing-library/react-native'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { Evidence } from '@/components/Evidence'
import { __resetOutboxForTests, enqueue, hydrateOutbox } from '@/offline/outbox'
import { envelope, fakeServer } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { renderScreen } from '@/testing/render'

const attachment = (over: Record<string, unknown> = {}) => ({
  id: 'att1',
  documentId: 'doc1',
  fileName: 'column-c4.jpg',
  caption: null,
  sizeBytes: 240_000,
  photo: true,
  createdAt: '2026-09-20T07:00:00.000Z',
  ...over,
})

const routes = {
  'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [attachment()] }) }),
}

beforeEach(async () => {
  network.__reset(null)
  await queryClient.cancelQueries()
  queryClient.clear()
  __resetOutboxForTests()
  await hydrateOutbox()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
})

describe('evidence on a record', () => {
  it('lists what the server holds against this record', async () => {
    fakeServer(routes)
    await renderScreen(<Evidence projectId="p1" recordType="ncr" recordId="ncr-1" recordRef="NCR-012" canAdd />)
    expect(await screen.findByText('column-c4.jpg')).toBeTruthy()
    expect(screen.getByTestId('evidence-add')).toBeTruthy()
  })

  it('offers nothing to add when the person may not', async () => {
    fakeServer(routes)
    await renderScreen(<Evidence projectId="p1" recordType="ncr" recordId="ncr-1" recordRef="NCR-012" canAdd={false} />)
    expect(await screen.findByText('column-c4.jpg')).toBeTruthy()
    expect(screen.queryByTestId('evidence-add')).toBeNull()
  })

  it('shows a photograph captured without a signal on the record itself, not only in the outbox', async () => {
    // Offline, so the queued item stays waiting instead of being attempted.
    network.__reset(false)
    fakeServer({ 'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }) })
    const item = await enqueue({
      projectId: 'p1',
      kind: 'attachment.upload',
      summary: 'Photograph for NCR-012',
      clientRequestId: 'k1',
      payload: { recordType: 'ncr', recordId: 'ncr-1', recordRef: 'NCR-012', files: [] },
    })
    await renderScreen(<Evidence projectId="p1" recordType="ncr" recordId="ncr-1" recordRef="NCR-012" canAdd />)
    expect(await screen.findByTestId(`evidence-queued-${item.id}`)).toBeTruthy()
    expect(screen.getByText('Photograph for NCR-012')).toBeTruthy()
    expect(screen.getByText(/Waiting to upload/)).toBeTruthy()
    // The record is not "empty" while something of its own is waiting.
    expect(screen.queryByText('No evidence yet.')).toBeNull()
  })

  it('says why a photograph could not be sent, on the record, rather than hiding it', async () => {
    fakeServer({ 'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }) })
    const item = await enqueue({
      projectId: 'p1',
      kind: 'attachment.upload',
      summary: 'Photograph for NCR-020',
      clientRequestId: 'k9',
      payload: { recordType: 'ncr', recordId: 'ncr-9', recordRef: 'NCR-020', files: [] },
    })
    await renderScreen(<Evidence projectId="p1" recordType="ncr" recordId="ncr-9" recordRef="NCR-020" canAdd />)
    expect(await screen.findByTestId(`evidence-queued-${item.id}`)).toBeTruthy()
    // Whatever the reason, the person is told it and the photograph is kept.
    expect(screen.getByText(/Could not be sent|Waiting to upload|Sending/)).toBeTruthy()
    expect(screen.queryByText('No evidence yet.')).toBeNull()
  })

  it('keeps another record’s queued photograph off this record', async () => {
    fakeServer({ 'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }) })
    await enqueue({
      projectId: 'p1',
      kind: 'attachment.upload',
      summary: 'Photograph for PUNCH-114',
      clientRequestId: 'k2',
      payload: { recordType: 'punch_item', recordId: 'punch-1', recordRef: 'PUNCH-114', files: [] },
    })
    await renderScreen(<Evidence projectId="p1" recordType="ncr" recordId="ncr-2" recordRef="NCR-013" canAdd />)
    expect(await screen.findByText('No evidence yet.')).toBeTruthy()
    expect(screen.queryByText('Photograph for PUNCH-114')).toBeNull()
  })

  it('says what it is in the record’s own words when a screen asks', async () => {
    fakeServer({ 'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }) })
    await renderScreen(<Evidence projectId="p1" recordType="ncr" recordId="ncr-3" recordRef="NCR-014" canAdd title="Photographs" emptyText="No photographs on this record yet." />)
    expect(await screen.findByText('Photographs')).toBeTruthy()
    expect(screen.getByText('No photographs on this record yet.')).toBeTruthy()
  })
})
