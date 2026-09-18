import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams } from 'expo-router'
import RfiDetailScreen from '../../../app/(app)/rfi/[id]'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { PermissionMatrix } from '@/api/types'
import type { RfiDetail } from '@/api/record-types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { answeredRfi, pmFull, rfiDetail, siteEngineer, warehouse } from '@/testing/fixtures-records'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let current: RfiDetail

const serve = (permissions: PermissionMatrix, record: RfiDetail) => {
  current = record
  calls = fakeServer({
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/rfi/r1': () => ({ status: 200, body: envelope(current) }),
    'GET /projects/p1/comments': () => ({ status: 200, body: envelope({ items: [], pagination: { limit: 100, nextCursor: null } }) }),
    'GET /projects/p1/audit': () => ({ status: 200, body: envelope({ events: [{ id: 'e1', source: 'status', entityType: 'rfi', entityId: 'r1', action: 'status_changed', decision: null, actorId: 'u2', actorName: 'Priya Raman', actorRole: 'site_engineer', occurredAt: '2026-09-12T00:00:00.000Z', fromStatus: null, toStatus: 'open', reason: null, comment: null }], nextCursor: null }) }),
    'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }),
    'POST /projects/p1/rfi/r1/responses': (call) => {
      const body = call.body as { body: string; isOfficial?: boolean }
      const response = { id: 'resp9', rfiId: 'r1', body: body.body, isOfficial: !!body.isOfficial, revision: 0, authorId: 'u1', author: { id: 'u1', name: 'Dana Okafor' }, createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z' }
      current = { ...current, responses: [...current.responses, response], officialResponse: body.isOfficial ? response : current.officialResponse, status: body.isOfficial ? 'answered' : current.status }
      return { status: 201, body: envelope(response) }
    },
    'POST /projects/p1/rfi/r1/approve': () => {
      current = { ...current, status: 'closed' }
      return { status: 200, body: envelope(current) }
    },
    'POST /projects/p1/rfi/r1/reject': () => {
      current = { ...current, status: 'open' }
      return { status: 200, body: envelope(current) }
    },
    'POST /projects/p1/rfi/r1/close': () => {
      current = { ...current, status: 'closed' }
      return { status: 200, body: envelope(current) }
    },
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'r1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('an RFI record', () => {
  it('shows the question, who holds it, the people and the history', async () => {
    serve(pmFull, rfiDetail())
    await renderScreen(<RfiDetailScreen />)
    expect(await screen.findByText('Founding level at grid A-D')).toBeTruthy()
    expect(screen.getByText(/Borehole BH-3/)).toBeTruthy()
    // Ball in court and assigned to: the same person, shown in both places.
    expect(screen.getAllByText('Ravi Menon').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Waiting for an answer.')).toBeTruthy()
    expect(screen.getByText('Sofia Lindqvist')).toBeTruthy()
    expect(await screen.findByText('Status changed: — → Open')).toBeTruthy()
  })

  it('gives a project manager the answer, close and response actions on an open RFI, and none of the approve ones', async () => {
    serve(pmFull, rfiDetail())
    await renderScreen(<RfiDetailScreen />)
    await screen.findByText('Founding level at grid A-D')
    await waitFor(() => expect(screen.getByTestId('action-answer')).toBeTruthy())
    expect(screen.getByTestId('action-close')).toBeTruthy()
    expect(screen.getByTestId('action-respond')).toBeTruthy()
    expect(screen.queryByTestId('action-approve')).toBeNull()
    expect(screen.queryByTestId('action-reject')).toBeNull()
  })

  it('on an answered RFI a project manager may approve, reject or reopen; approving closes it through the transition route', async () => {
    serve(pmFull, answeredRfi())
    await renderScreen(<RfiDetailScreen />)
    expect(await screen.findByTestId('rfi-official-answer')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('action-approve')).toBeTruthy())
    expect(screen.getByTestId('action-reject')).toBeTruthy()
    expect(screen.getByTestId('action-reopen')).toBeTruthy()
    expect(screen.getByTestId('action-convert')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('action-approve'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/projects/p1/rfi/r1/approve')).toBe(true))
    // The status badge and the ball-in-court line both read Closed.
    await waitFor(() => expect(screen.getAllByText('Closed').length).toBeGreaterThanOrEqual(2))
    expect(calls.every((c) => c.method !== 'PATCH')).toBe(true)
  })

  it('rejecting needs a reason and sends it', async () => {
    serve(pmFull, answeredRfi())
    await renderScreen(<RfiDetailScreen />)
    await fireEvent.press(await screen.findByTestId('action-reject'))
    const confirm = await screen.findByTestId('prompt-reject-confirm')
    expect(confirm.props.accessibilityState?.disabled).toBe(true)
    await fireEvent.changeText(screen.getByTestId('prompt-reject-input'), 'Does not address the pad thickness')
    await fireEvent.press(confirm)
    await waitFor(() => expect(calls.find((c) => c.path === '/projects/p1/rfi/r1/reject')?.body).toEqual({ reason: 'Does not address the pad thickness' }))
  })

  it('a site engineer can answer and respond, but cannot close, approve or reject', async () => {
    serve(siteEngineer, rfiDetail())
    await renderScreen(<RfiDetailScreen />)
    await screen.findByText('Founding level at grid A-D')
    await waitFor(() => expect(screen.getByTestId('action-answer')).toBeTruthy())
    expect(screen.getByTestId('action-respond')).toBeTruthy()
    expect(screen.queryByTestId('action-close')).toBeNull()
    expect(screen.queryByTestId('action-approve')).toBeNull()
  })

  it('a warehouse person sees the record and no actions at all', async () => {
    serve(warehouse, rfiDetail())
    await renderScreen(<RfiDetailScreen />)
    await screen.findByText('Founding level at grid A-D')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('action-bar')).toBeNull()
  })

  it('posting a response marked official sends isOfficial and the record moves to answered', async () => {
    serve(pmFull, rfiDetail())
    await renderScreen(<RfiDetailScreen />)
    await fireEvent.press(await screen.findByTestId('action-respond'))
    await fireEvent.changeText(await screen.findByTestId('prompt-respond-input'), 'Lower the founding level by 150mm.')
    await fireEvent.press(screen.getByTestId('prompt-respond-toggle'))
    await fireEvent.press(screen.getByTestId('prompt-respond-confirm'))
    await waitFor(() => expect(calls.find((c) => c.path === '/projects/p1/rfi/r1/responses')?.body).toEqual({ body: 'Lower the founding level by 150mm.', isOfficial: true }))
    expect(await screen.findByTestId('rfi-official-answer')).toBeTruthy()
  })
})
