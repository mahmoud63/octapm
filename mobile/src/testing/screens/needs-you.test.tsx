import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import * as WebBrowser from 'expo-web-browser'
import NeedsYouScreen from '../../../app/(app)/needs-you'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer } from '@/testing/fake-server'
import { assignments, page, projects, user } from '@/testing/fixtures'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(WebBrowser.openBrowserAsync as jest.Mock).mockClear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
  fakeServer({
    'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
    'GET /projects/p1/assignments/mine': () => ({ status: 200, body: envelope(assignments) }),
  })
})

describe('Needs You', () => {
  it('asks for a project first when none is chosen', async () => {
    useProjectStore.setState({ currentProjectId: null, hydrated: true })
    await renderScreen(<NeedsYouScreen />)
    expect(screen.getByText('Choose a project first')).toBeTruthy()
  })

  it('lists what is waiting, with the counts, and narrows by ball in court, overdue and type', async () => {
    await renderScreen(<NeedsYouScreen />)
    expect(await screen.findByText('Founding level at grid A-D')).toBeTruthy()
    expect(screen.getByText('Honeycombing in column C4')).toBeTruthy()
    expect(screen.getByText('Rebar mill certificates')).toBeTruthy()
    expect(screen.getByText('3 open items')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('chip-ball'))
    expect(screen.getByText('Founding level at grid A-D')).toBeTruthy()
    expect(screen.queryByText('Honeycombing in column C4')).toBeNull()

    await fireEvent.press(screen.getByTestId('chip-overdue'))
    expect(screen.queryByText('Founding level at grid A-D')).toBeNull()
    expect(screen.getByText('Honeycombing in column C4')).toBeTruthy()

    await fireEvent.press(screen.getByTestId('chip-all'))
    await fireEvent.press(screen.getByTestId('chip-type-submittal'))
    expect(screen.getByText('Rebar mill certificates')).toBeTruthy()
    expect(screen.queryByText('Founding level at grid A-D')).toBeNull()
  })

  it('opens an item on the web at the exact record until its screen exists', async () => {
    await renderScreen(<NeedsYouScreen />)
    await fireEvent.press(await screen.findByText('Honeycombing in column C4'))
    await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1))
    expect((WebBrowser.openBrowserAsync as jest.Mock).mock.calls[0]![0]).toMatch(/\/projects\/p1\/quality\/ncr\?recordId=n1&source=ncr$/)
  })

  it('says so when nothing is waiting', async () => {
    fakeServer({
      'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
      'GET /projects/p1/assignments/mine': () => ({ status: 200, body: envelope({ items: [], summary: { total: 0, overdue: 0, ballInCourt: 0, byType: {} } }) }),
    })
    await renderScreen(<NeedsYouScreen />)
    expect(await screen.findByText('Nothing is waiting on you')).toBeTruthy()
  })
})
