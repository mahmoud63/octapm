import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import PunchItemScreen from '../../../app/(app)/quality/punch/[id]'
import PunchListScreen from '../../../app/(app)/quality/punch/index'
import NewPunchScreen from '../../../app/(app)/quality/punch/new'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import type { PunchItem } from '@/api/quality-types'
import type { PermissionMatrix } from '@/api/types'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { user } from '@/testing/fixtures'
import { pmQuality, punchItem, punchList, siteEngineerQuality } from '@/testing/fixtures-quality'
import { activities } from '@/testing/fixtures-site'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
let current: PunchItem

const serve = (permissions: PermissionMatrix = pmQuality, item: PunchItem = punchItem()) => {
  current = item
  calls = fakeServer({
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/punch': (call) => ({ status: 200, body: envelope(punchList(punchList().items.filter((p) => call.query.kind === 'all' || p.kind === call.query.kind))) }),
    'GET /projects/p1/punch/pi1': () => ({ status: 200, body: envelope(current) }),
    'GET /projects/p1/team': () => ({ status: 200, body: envelope({ items: [{ userId: 'u2', name: 'Priya Raman', email: 'priya@octapm.demo', orgRole: 'site_engineer', assignmentRole: 'site_engineer' }] }) }),
    'GET /projects/p1/locations': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/activities': () => ({ status: 200, body: envelope(activities) }),
    'GET /projects/p1/attachments': () => ({ status: 200, body: envelope({ items: [] }) }),
    'GET /projects/p1/comments': () => ({ status: 200, body: envelope({ items: [], pagination: { limit: 100, nextCursor: null } }) }),
    'GET /projects/p1/audit': () => ({ status: 200, body: envelope({ events: [], nextCursor: null }) }),
    'POST /projects/p1/punch': (call) => {
      const body = call.body as Record<string, unknown>
      return { status: 201, body: envelope(punchItem({ id: 'pi9', ref: 'PL-014', title: String(body.title), kind: String(body.kind) as 'punch', status: String(body.status) })) }
    },
    'POST /projects/p1/punch/pi1/transition': (call) => {
      const { action } = call.body as { action: string; reason?: string }
      const next: Record<string, string> = { open: 'open', ready_for_review: 'ready_for_review', close: 'closed', reopen: 'open', dispute: 'in_dispute', resolve_dispute: 'open', void: 'void' }
      current = { ...current, status: next[action] ?? current.status, ballInCourtUser: action === 'ready_for_review' ? { id: 'u1', name: 'Dana Okafor' } : current.ballInCourtUser }
      return { status: 200, body: envelope(current) }
    },
  })
}

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'pi1' })
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('the punch list', () => {
  it('shows punch items by default and observations on their chip', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
    await renderScreen(<PunchListScreen />)
    expect(await screen.findByText('Honeycombing at column C4 base')).toBeTruthy()
    expect(screen.queryByText('Unprotected edge at level 3')).toBeNull()
    await fireEvent.press(screen.getByTestId('punch-kind-observation'))
    expect(await screen.findByText('Unprotected edge at level 3')).toBeTruthy()
    expect(calls.some((c) => c.path === '/projects/p1/punch' && c.query.kind === 'observation')).toBe(true)
    await fireEvent.press(screen.getByTestId('punch-chip-mine'))
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/punch' && c.query.ballInCourtUserId === 'me')).toBe(true))
  })

  it('opens on observations when asked to', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ kind: 'observation' })
    await renderScreen(<PunchListScreen />)
    expect(await screen.findByText('Unprotected edge at level 3')).toBeTruthy()
    expect(screen.getByTestId('punch-new').props.accessibilityLabel ?? screen.getByText('New observation')).toBeTruthy()
  })
})

describe('raising a punch item', () => {
  it('creates it open with a replay key and goes to the record', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
    const router = useRouter() as unknown as { replace: jest.Mock }
    await renderScreen(<NewPunchScreen />)
    expect((await screen.findByTestId('punch-raise')).props.accessibilityState?.disabled).toBe(true)
    await fireEvent.changeText(screen.getByTestId('punch-title'), 'Chipped tile at lobby entrance')
    await fireEvent.press(screen.getByTestId('punch-priority-high'))
    await fireEvent.changeText(screen.getByTestId('punch-trade'), 'Tiling')
    await fireEvent.press(screen.getByTestId('punch-raise'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/projects/p1/punch')).toBe(true))
    const sent = calls.find((c) => c.method === 'POST' && c.path === '/projects/p1/punch')!.body as Record<string, unknown>
    expect(sent).toMatchObject({ title: 'Chipped tile at lobby entrance', priority: 'high', trade: 'Tiling', kind: 'punch', status: 'open', managerUserId: 'u1' })
    expect(String(sent.clientRequestId)).toMatch(/[0-9a-f-]{20,}/)
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/quality/punch/pi9'))
  })

  it('needs a type for an observation and sends the hazard', async () => {
    serve()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ kind: 'observation' })
    await renderScreen(<NewPunchScreen />)
    await fireEvent.changeText(await screen.findByTestId('punch-title'), 'Unprotected edge at level 3')
    expect(screen.getByTestId('punch-raise').props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(screen.getByTestId('punch-obs-safety'))
    await fireEvent.changeText(screen.getByTestId('punch-hazard'), 'Fall from height')
    expect(screen.getByTestId('punch-raise').props.accessibilityState?.disabled).toBe(false)
    await fireEvent.press(screen.getByTestId('punch-raise'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/projects/p1/punch')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ kind: 'observation', observationType: 'safety', hazard: 'Fall from height' })
  })
})

describe('a punch item', () => {
  it('shows what, who holds it, where, and the transitions the PM may take', async () => {
    serve()
    await renderScreen(<PunchItemScreen />)
    expect(await screen.findByText('Honeycombing at column C4 base')).toBeTruthy()
    expect(screen.getAllByText('Priya Raman').length).toBeGreaterThan(0)
    expect(screen.getByText('Foundation zone, grid A-D · Column C4')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('action-ready')).toBeTruthy())
    expect(screen.getByTestId('action-close')).toBeTruthy()
    expect(screen.getByTestId('action-dispute')).toBeTruthy()
    expect(screen.getByTestId('action-void')).toBeTruthy()
    expect(screen.queryByTestId('action-reopen')).toBeNull()
  })

  it('moves through ready for review and close on the transition route, never a status patch', async () => {
    serve()
    await renderScreen(<PunchItemScreen />)
    await fireEvent.press(await screen.findByTestId('action-ready'))
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/transition')).length).toBe(1))
    expect(calls.find((c) => c.path.endsWith('/transition'))!.body).toEqual({ action: 'ready_for_review' })
    expect(await screen.findByText('Ready for review')).toBeTruthy()
    await fireEvent.press(await screen.findByTestId('action-close'))
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/transition')).length).toBe(2))
    expect(await screen.findByTestId('action-reopen')).toBeTruthy()
    expect(screen.queryByTestId('action-close')).toBeNull()
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('asks for a reason before voiding and sends it', async () => {
    serve()
    await renderScreen(<PunchItemScreen />)
    await fireEvent.press(await screen.findByTestId('action-void'))
    expect((await screen.findByTestId('prompt-punch-confirm')).props.accessibilityState?.disabled).toBe(true)
    await fireEvent.changeText(screen.getByTestId('prompt-punch-input'), 'Duplicate of PL-011')
    await fireEvent.press(screen.getByTestId('prompt-punch-confirm'))
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/transition'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/transition'))!.body).toEqual({ action: 'void', reason: 'Duplicate of PL-011' })
  })

  it('a site engineer may mark it ready but not close, dispute or void', async () => {
    serve(siteEngineerQuality)
    await renderScreen(<PunchItemScreen />)
    await screen.findByTestId('action-ready')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('action-close')).toBeNull()
    expect(screen.queryByTestId('action-dispute')).toBeNull()
    expect(screen.queryByTestId('action-void')).toBeNull()
  })
})
