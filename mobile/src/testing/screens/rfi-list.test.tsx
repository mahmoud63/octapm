import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { router } from 'expo-router'
import RfiListScreen from '../../../app/(app)/rfi/index'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { page, projects, user } from '@/testing/fixtures'
import { pmFull, rfiList, warehouse } from '@/testing/fixtures-records'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

let calls: Call[]
const serve = (permissions = pmFull) =>
  (calls = fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /auth/me/permissions': () => ({ status: 200, body: envelope(permissions) }),
    'GET /projects/p1/rfi': (call) => ({ status: 200, body: envelope(call.query.ballInCourtUserId === 'me' ? rfiList([rfiList().rows[0]!]) : rfiList()) }),
  }))

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(router.push as jest.Mock).mockClear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
})

describe('the RFI list', () => {
  it('lists RFIs with their status, and narrows to the ones in my court through the server', async () => {
    serve()
    await renderScreen(<RfiListScreen />)
    expect(await screen.findByText('Founding level at grid A-D')).toBeTruthy()
    expect(screen.getByText('Rebar cover at the lift pit')).toBeTruthy()
    expect(screen.getByText('RFI-002')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('rfi-chip-mine'))
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/rfi' && c.query.ballInCourtUserId === 'me')).toBe(true))
    await waitFor(() => expect(screen.queryByText('Rebar cover at the lift pit')).toBeNull())
  })

  it('searches through the server and opens a row in the app', async () => {
    serve()
    await renderScreen(<RfiListScreen />)
    await screen.findByText('Founding level at grid A-D')
    await fireEvent.changeText(screen.getByTestId('rfi-search'), 'rebar')
    await fireEvent(screen.getByTestId('rfi-search'), 'submitEditing')
    await waitFor(() => expect(calls.some((c) => c.path === '/projects/p1/rfi' && c.query.search === 'rebar')).toBe(true))
    await fireEvent.press(screen.getByTestId('rfi-row-r1'))
    expect(router.push).toHaveBeenCalledWith('/rfi/r1')
  })

  it('offers New RFI only to someone the server lets create one', async () => {
    serve(warehouse)
    await renderScreen(<RfiListScreen />)
    await screen.findByText('Founding level at grid A-D')
    await waitFor(() => expect(queryClient.getQueryData(['project', 'p1', 'permissions'])).toBeDefined())
    expect(screen.queryByTestId('rfi-new')).toBeNull()
  })

  it('offers New RFI to a project manager and goes to the form', async () => {
    serve()
    await renderScreen(<RfiListScreen />)
    await fireEvent.press(await screen.findByTestId('rfi-new'))
    expect(router.push).toHaveBeenCalledWith('/rfi/new')
  })
})
