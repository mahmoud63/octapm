import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import SearchScreen from '../../../app/(app)/search'
import { network } from '@/api/network'
import { queryClient } from '@/api/query'
import { useAuthStore } from '@/auth/store'
import { useProjectStore } from '@/projects/store'
import { envelope, fakeServer, type Call } from '@/testing/fake-server'
import { page, projects, searchItem, user } from '@/testing/fixtures'
import { renderScreen } from '@/testing/render'

import '@/auth/session'

const results = (call: Call) => ({
  status: 200,
  body: envelope({
    query: call.query.q,
    items: call.query.projectId ? [searchItem()] : [searchItem(), searchItem({ id: 'x2', projectId: 'p2', projectName: 'Harbour Bridge', identifier: 'RFI-009', title: 'Excavation support at pier 3' })],
    groups: [{ type: 'rfi', label: 'RFIs', count: call.query.projectId ? 1 : 2 }],
    filters: {},
    meta: { limit: 30, total: call.query.projectId ? 1 : 2 },
  }),
})

let calls: Call[]

beforeEach(() => {
  network.__reset(null)
  queryClient.clear()
  ;(WebBrowser.openBrowserAsync as jest.Mock).mockClear()
  ;(router.push as jest.Mock).mockClear()
  useAuthStore.setState({ status: 'signedIn', user, accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000 })
  useProjectStore.setState({ currentProjectId: 'p1', hydrated: true })
  calls = fakeServer({ 'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }), 'GET /search': results })
})

const searchCalls = () => calls.filter((c) => c.path === '/search')

describe('Search', () => {
  it('waits for two characters, then searches the current project after a short pause', async () => {
    await renderScreen(<SearchScreen />)
    expect(screen.getByText('Search across the project')).toBeTruthy()
    await fireEvent.changeText(screen.getByTestId('search-input'), 'e')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(searchCalls()).toHaveLength(0)

    await fireEvent.changeText(screen.getByTestId('search-input'), 'excav')
    expect(await screen.findByText('Founding level at grid A-D against borehole BH-3')).toBeTruthy()
    expect(searchCalls()).toHaveLength(1)
    expect(searchCalls()[0]!.query).toMatchObject({ q: 'excav', projectId: 'p1' })
    expect(screen.getByTestId('search-count').props.children.join('')).toContain('1 result')
  })

  it('widens to every project on one tap, and shows which project each hit belongs to', async () => {
    await renderScreen(<SearchScreen />)
    await fireEvent.changeText(screen.getByTestId('search-input'), 'excav')
    await screen.findByText('Founding level at grid A-D against borehole BH-3')
    await fireEvent.press(screen.getByTestId('chip-scope-all'))
    expect(await screen.findByText('Excavation support at pier 3')).toBeTruthy()
    const widened = searchCalls().at(-1)!
    expect(widened.query.projectId).toBeUndefined()
    expect(screen.getByText(/Harbour Bridge/)).toBeTruthy()
  })

  it('opens an RFI hit in the app, and a record without a screen on the web at the path the server named', async () => {
    calls = fakeServer({
      'GET /projects': () => ({ status: 200, body: envelope(page(projects)) }),
      'GET /search': () => ({ status: 200, body: envelope({ query: 'x', items: [searchItem(), searchItem({ id: 'pl1', type: 'punch_item', typeLabel: 'Punch item', module: 'quality', identifier: 'PL-004', title: 'Chipped tile at lobby', url: '/projects/p1?module=quality&child=defects&recordId=pl1&source=punch_item' })], groups: [], filters: {}, meta: { limit: 30, total: 2 } }) }),
    })
    await renderScreen(<SearchScreen />)
    await fireEvent.changeText(screen.getByTestId('search-input'), 'excav')
    await fireEvent.press(await screen.findByText('Founding level at grid A-D against borehole BH-3'))
    expect(router.push).toHaveBeenCalledWith('/rfi/r1')
    await fireEvent.press(screen.getByText('Chipped tile at lobby'))
    await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1))
    expect((WebBrowser.openBrowserAsync as jest.Mock).mock.calls[0]![0]).toMatch(/\/projects\/p1\?module=quality&child=defects&recordId=pl1&source=punch_item$/)
  })
})
